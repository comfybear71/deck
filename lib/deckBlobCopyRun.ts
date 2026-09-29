/**
 * Network + database half of the one-time "copy the old flat Blob
 * pictures into the readable deck/ tree" job. Shared, line for line, by
 * the CLI (`scripts/copy-blob-to-deck-tree.ts`) and the ONE-OFF route
 * (`app/api/deck/admin/copy-blob-tree/route.ts`), so both run exactly the
 * same checks, the same copy loop and the same single SQL statement. The
 * pure half (CSV, layout checks, link rewriting, the SQL text) stays in
 * `lib/deckBlobCopyPlan.ts`.
 *
 * Nothing in here deletes a file, ever, and every copy is
 * `allowOverwrite: false`. The only database write is `commitLinks`,
 * one compare-and-swap statement that fails as a whole if anything was
 * saved after it was read.
 *
 * Remove together with the route once the copy has been run (the CLI
 * can keep using it, or go too — it is also a one-time script).
 */
import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { copy, head, type HeadBlobResult } from "@vercel/blob";
import { isBlobAlreadyExistsError } from "./deckMediaPaths";
import {
  DECK_BLOB_STORE_HOST,
  LINK_UPDATE_SQL,
  OLD_BLOB_FOLDERS,
  blobPublicUrl,
  buildUrlMap,
  candidatePathnames,
  countOldLinks,
  formatCsv,
  parseMovePlanCsv,
  planGenre,
  rewriteBlobLinks,
  validateMovePlan,
  type LinkChange,
  type MovePlanRow,
} from "./deckBlobCopyPlan";

export type CopyRunSql = NeonQueryFunction<false, false>;
export type CopyRunLog = (line: string) => void;

export const COPY_RUN_HOST = DECK_BLOB_STORE_HOST;
const STORE_ID = COPY_RUN_HOST.split(".")[0];

export const pathOf = (url: string) => url.replace(`https://${COPY_RUN_HOST}/`, "");

// ---- The plan ----------------------------------------------------------------

export interface LoadedPlan {
  rows: MovePlanRow[];
  /** Empty means the plan is safe to use. */
  problems: string[];
  bySource: { folder: string; count: number }[];
  byGenre: { genre: string; count: number }[];
}

/** Reads and checks the move plan CSV text (from a file or the bundled module). */
export function loadPlan(csvText: string, expectedCount: number | undefined): LoadedPlan {
  const rows = parseMovePlanCsv(csvText);
  const problems = validateMovePlan(rows, expectedCount);
  const bySource = OLD_BLOB_FOLDERS.map((folder) => ({ folder, count: rows.filter((r) => r.old.startsWith(`${folder}/`)).length }));
  const byGenre = [...new Set(rows.map((r) => planGenre(r.new)))].map((genre) => ({
    genre,
    count: rows.filter((r) => planGenre(r.new) === genre).length,
  }));
  return { rows, problems, bySource, byGenre };
}

// ---- Small helpers -------------------------------------------------------------

export async function inBatches<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Plain public HEAD, no token. `null` size when the file isn't there. */
export async function publicHead(pathname: string): Promise<{ status: number; size: number | null }> {
  const res = await fetch(`${blobPublicUrl(pathname)}?deck-copy-check=${Date.now()}`, { method: "HEAD", cache: "no-store" });
  const len = res.headers.get("content-length");
  return { status: res.status, size: res.ok && len ? Number(len) : null };
}

/** sha256 of a public file, streamed (some of these are videos). */
export async function sha256OfUrl(url: string): Promise<string> {
  const res = await fetch(`${url}?deck-copy-check=${Date.now()}`, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`GET ${pathOf(url)} failed: HTTP ${res.status}`);
  const hash = createHash("sha256");
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return hash.digest("hex");
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, log: CopyRunLog = () => {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient = /rate limit|service.*(unavailable|not available)|ECONNRESET|ETIMEDOUT|fetch failed|5\d\d/i.test(msg);
      if (!transient || attempt >= 4 || isBlobAlreadyExistsError(err)) throw err;
      log(`  (retrying ${label} after: ${msg})`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// ---- The database, read-only -----------------------------------------------------

export interface ItemRow {
  kind: string;
  item_id: string;
  folder: string;
  revision: number | string;
  deleted_at: unknown;
  data: unknown;
}

export interface DbSnapshot {
  owner: string;
  sessionRevision: number;
  /** As stored (UTC). */
  sessionUpdatedAt: string;
  sessionState: unknown;
  itemRows: ItemRow[];
}

/**
 * The session row and every `deck_items` row holding an old link, read
 * inside one READ ONLY transaction. `null` when the owner has no session row.
 */
export async function readDbSnapshot(sql: CopyRunSql, owner: string): Promise<DbSnapshot | null> {
  const oldLinkPattern = `https://${COPY_RUN_HOST.replace(/\./g, "\\.")}/skidmarks/(member-photos|plate-stills|adult-shorts)/`;
  const [sessionRows, itemRows] = (await sql.transaction(
    [
      sql`SELECT state, revision, updated_at FROM skidmarks_sessions WHERE owner_id = ${owner} LIMIT 1`,
      sql`SELECT kind, item_id, folder, revision, deleted_at, data FROM deck_items
          WHERE owner_id = ${owner} AND data::text ~ ${oldLinkPattern}
          ORDER BY kind, folder, item_id`,
    ],
    { readOnly: true },
  )) as [{ state: unknown; revision: string | number; updated_at: unknown }[], ItemRow[]];
  const session = sessionRows[0];
  if (!session) return null;
  return {
    owner,
    sessionRevision: Number(session.revision),
    sessionUpdatedAt: session.updated_at instanceof Date ? session.updated_at.toISOString() : String(session.updated_at),
    sessionState: session.state,
    itemRows,
  };
}

export interface PlannedChange {
  table: "skidmarks_sessions" | "deck_items";
  key: string;
  changes: LinkChange[];
}

/** Works out every database change for a given old -> new URL map. */
export function planDb(snap: DbSnapshot, urlMap: Map<string, string>) {
  const s = rewriteBlobLinks(snap.sessionState, urlMap, COPY_RUN_HOST);
  const items = snap.itemRows.map((r) => ({ row: r, ...rewriteBlobLinks(r.data, urlMap, COPY_RUN_HOST) }));
  const unmapped = [...s.unmapped.map((u) => `skidmarks_sessions ${u.field}: ${pathOf(u.url)}`)];
  const inKeys = [...s.inKeys.map((k) => `skidmarks_sessions ${k.field}`)];
  for (const it of items) {
    unmapped.push(...it.unmapped.map((u) => `deck_items ${it.row.kind}/${it.row.item_id} ${u.field}: ${pathOf(u.url)}`));
    inKeys.push(...it.inKeys.map((k) => `deck_items ${it.row.kind}/${it.row.item_id} ${k.field}`));
  }
  const planned: PlannedChange[] = [];
  if (s.changes.length > 0) planned.push({ table: "skidmarks_sessions", key: `owner=${snap.owner} (revision ${snap.sessionRevision})`, changes: s.changes });
  for (const it of items) {
    if (it.changes.length === 0) continue;
    const deleted = it.row.deleted_at ? ", deleted" : "";
    planned.push({
      table: "deck_items",
      key: `${it.row.kind}/${it.row.item_id} [folder ${it.row.folder}, revision ${it.row.revision}${deleted}]`,
      changes: it.changes,
    });
  }
  return { session: s, items: items.filter((it) => it.changes.length > 0), planned, unmapped, inKeys };
}

export type DbPlan = ReturnType<typeof planDb>;

export interface PlanSummary {
  filesToCopy: number;
  filesReferenced: number;
  /** Plan rows no saved link points at (still copied). */
  unreferenced: string[];
  sessionRowsToUpdate: number;
  sessionFields: number;
  sessionLinks: number;
  itemRowsToUpdate: number;
  itemFields: number;
  itemLinks: number;
  /** `kind/folder` -> rows. */
  itemRowsByKind: Record<string, number>;
  originalsDeleted: 0;
}

export function summarizePlan(rows: MovePlanRow[], dbPlan: DbPlan): PlanSummary {
  const referenced = new Set<string>();
  for (const p of dbPlan.planned) for (const c of p.changes) for (const [from] of c.links) referenced.add(pathOf(from));
  const unreferenced = rows.filter((r) => !referenced.has(r.old)).map((r) => r.old);
  const perKind: Record<string, number> = {};
  for (const it of dbPlan.items) perKind[`${it.row.kind}/${it.row.folder}`] = (perKind[`${it.row.kind}/${it.row.folder}`] ?? 0) + 1;
  const sessionFields = dbPlan.session.changes.length;
  return {
    filesToCopy: rows.length,
    filesReferenced: rows.length - unreferenced.length,
    unreferenced,
    sessionRowsToUpdate: sessionFields > 0 ? 1 : 0,
    sessionFields,
    sessionLinks: dbPlan.session.changes.reduce((n, c) => n + c.links.length, 0),
    itemRowsToUpdate: dbPlan.items.length,
    itemFields: dbPlan.items.reduce((n, it) => n + it.changes.length, 0),
    itemLinks: dbPlan.items.reduce((n, it) => n + it.changes.reduce((m, c) => m + c.links.length, 0), 0),
    itemRowsByKind: perKind,
    originalsDeleted: 0,
  };
}

/** Reasons a real run would refuse, from the database side. Empty = fine. */
export function dbRefusals(dbPlan: DbPlan): string[] {
  const refused: string[] = [];
  if (dbPlan.unmapped.length > 0) refused.push(`${dbPlan.unmapped.length} old link(s) in the database are not in the plan:\n      ${dbPlan.unmapped.join("\n      ")}`);
  if (dbPlan.inKeys.length > 0) refused.push(`${dbPlan.inKeys.length} old link(s) are used as JSON keys (not handled):\n      ${dbPlan.inKeys.join("\n      ")}`);
  return refused;
}

// ---- Blob, looked at only ------------------------------------------------------------

export interface PublicBlobCheck {
  /** Plan line -> note (only rows with something to say). */
  notes: Map<number, string>;
  missingSources: number;
  takenTargets: number;
}

/** Dry run: plain public HEADs of every source and every new name. Needs no token, writes nothing. */
export async function checkBlobPublicly(rows: MovePlanRow[]): Promise<PublicBlobCheck> {
  const notes = new Map<number, string>();
  let missingSources = 0;
  let takenTargets = 0;
  await inBatches(rows, 8, async (r) => {
    const [src, dst] = await Promise.all([withRetry(`HEAD ${r.old}`, () => publicHead(r.old)), withRetry(`HEAD ${r.new}`, () => publicHead(r.new))]);
    const n: string[] = [];
    if (src.size === null) {
      missingSources++;
      n.push(`SOURCE MISSING (HTTP ${src.status})`);
    } else if (r.bytes !== null && src.size !== r.bytes) n.push(`source is ${src.size} bytes, plan says ${r.bytes}`);
    if (dst.size !== null) {
      takenTargets++;
      n.push(`new name already taken (${dst.size} bytes): a real run reuses it if identical, otherwise uses -v2`);
    }
    if (n.length > 0) notes.set(r.line, n.join("; "));
  });
  return { notes, missingSources, takenTargets };
}

// ---- Write: copy ---------------------------------------------------------------------

/** Why this token can't be used, or `null` when it's fine. */
export function writeTokenProblem(token: string | undefined): string | null {
  if (!token) return "BLOB_READ_WRITE_TOKEN is not set.";
  const tokenStore = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token)?.[1];
  if (tokenStore && tokenStore.toLowerCase() !== STORE_ID) return `BLOB_READ_WRITE_TOKEN is for a different store than ${COPY_RUN_HOST}.`;
  return null;
}

/** HEAD of every source with the token; throws if any is missing. */
export async function headSources(rows: MovePlanRow[], token: string, log: CopyRunLog = () => {}): Promise<HeadBlobResult[]> {
  const sources = await inBatches(rows, 8, (r) => withRetry(`head ${r.old}`, () => head(blobPublicUrl(r.old), { token }), log));
  for (const [i, s] of sources.entries()) {
    if (rows[i].bytes !== null && s.size !== rows[i].bytes) log(`  note: ${rows[i].old} is ${s.size} bytes, plan says ${rows[i].bytes}`);
  }
  return sources;
}

export type CopyOutcome = "copied" | "reused";

/**
 * Copies one file to its planned name, never overwriting: if the name is
 * taken by a byte-identical copy (a re-run) it is reused; if it is taken
 * by anything else the next `-vN` name is tried. `claimed` holds every
 * name already spoken for (all planned names plus every landed one) and
 * gets the landed name added. Never deletes anything.
 */
export async function copyRow(
  row: MovePlanRow,
  src: HeadBlobResult,
  claimed: Set<string>,
  token: string,
  log: CopyRunLog = () => {},
): Promise<{ landed: string; outcome: CopyOutcome }> {
  const fromUrl = blobPublicUrl(row.old);
  for (const candidate of candidatePathnames(row.new)) {
    if (candidate !== row.new && claimed.has(candidate)) continue;
    try {
      const res = await withRetry(
        `copy ${row.old}`,
        () => copy(fromUrl, candidate, { access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: src.contentType, token }),
        log,
      );
      if (new URL(res.url).host !== COPY_RUN_HOST || res.pathname !== candidate) {
        throw new Error(`copy landed at ${res.url}, expected ${blobPublicUrl(candidate)}. Stopping before any database change.`);
      }
      claimed.add(candidate);
      return { landed: candidate, outcome: "copied" };
    } catch (err) {
      if (!isBlobAlreadyExistsError(err)) throw err;
      const existing = await withRetry(`head ${candidate}`, () => head(blobPublicUrl(candidate), { token }), log);
      if (existing.size === src.size && (await sha256OfUrl(existing.url)) === (await sha256OfUrl(fromUrl))) {
        claimed.add(candidate);
        return { landed: candidate, outcome: "reused" };
      }
      log(`  ${candidate} is taken by a different file; trying the next -vN name.`);
    }
  }
  throw new Error(`No free name for ${row.old} (tried ${row.new} to -v30). Stopping before any database change.`);
}

export function resultCsv(rows: MovePlanRow[], finalPath: Map<number, string>, outcome: Map<number, CopyOutcome>): string {
  return formatCsv([
    ["old", "new", "planned_new", "outcome", "url"],
    ...rows.map((r) => [r.old, finalPath.get(r.line)!, r.new, outcome.get(r.line)!, blobPublicUrl(finalPath.get(r.line)!)]),
  ]);
}

// ---- Write: one transaction ----------------------------------------------------------

/** The statement failed because a row was saved after it was read; nothing was written. */
export class CopyRunConflictError extends Error {
  constructor() {
    super(
      "Nothing was written to the database: the session or a deck_items row was saved after it was read. " +
        "Close the Deck on every device and run the write again (the copies are reused, not duplicated).",
    );
    this.name = "CopyRunConflictError";
  }
}

export interface CommitResult {
  sessions: number;
  session_revision: unknown;
  items: number;
  item_history: number;
  session_history: number;
  expectedSessions: number;
  expectedItems: number;
}

/**
 * Points every saved link at the landed copies in ONE statement (one
 * transaction), each row only if its revision is still the one in
 * `snap`. Throws `CopyRunConflictError` (nothing written) if anything moved on.
 */
export async function commitLinks(
  sql: CopyRunSql,
  snap: DbSnapshot,
  rows: MovePlanRow[],
  finalPath: Map<number, string>,
): Promise<CommitResult> {
  const finalPlan = planDb(snap, buildUrlMap(rows, (r) => finalPath.get(r.line)!, COPY_RUN_HOST));
  if (finalPlan.unmapped.length > 0 || finalPlan.inKeys.length > 0) throw new Error("Old links not covered by the plan appeared. Nothing was written to the database.");
  const updateSession = finalPlan.session.changes.length > 0;
  const itemsPayload = JSON.stringify(
    finalPlan.items.map((it) => ({ kind: it.row.kind, item_id: it.row.item_id, revision: Number(it.row.revision), data: it.value })),
  );
  const newState = JSON.stringify(finalPlan.session.value);
  const expectedItems = finalPlan.items.length;
  const expectedSessions = updateSession ? 1 : 0;
  try {
    const [res] = (await sql.transaction([
      sql.query(LINK_UPDATE_SQL, [snap.owner, snap.sessionRevision, itemsPayload, newState, updateSession, expectedSessions, expectedItems]),
    ])) as [Omit<CommitResult, "expectedSessions" | "expectedItems">[]];
    return { ...res[0], expectedSessions, expectedItems };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/division by zero/i.test(msg)) throw new CopyRunConflictError();
    throw new Error(`Database update failed, nothing was written: ${msg}`);
  }
}

/** Old-folder links left in the session and deck_items (read-only). */
export async function countOldLinksLeft(sql: CopyRunSql, owner: string): Promise<number> {
  const [after, afterItems] = (await sql.transaction(
    [sql`SELECT state FROM skidmarks_sessions WHERE owner_id = ${owner}`, sql`SELECT data FROM deck_items WHERE owner_id = ${owner}`],
    { readOnly: true },
  )) as [{ state: unknown }[], { data: unknown }[]];
  return countOldLinks(after[0]?.state, COPY_RUN_HOST) + afterItems.reduce((n, r) => n + countOldLinks(r.data, COPY_RUN_HOST), 0);
}
