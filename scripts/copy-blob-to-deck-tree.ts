/**
 * ONE-TIME COPY of Deck's existing pictures from the old flat Blob
 * folders into the readable `deck/` tree, then ONE database transaction
 * that points the saved links at the copies. Run by hand, never by the
 * app, never on deploy.
 *
 *   skidmarks/member-photos/<uuid>.jpg -> deck/sunnybank/characters/shazza/plates/shazza-plate-03.jpg
 *   skidmarks/plate-stills/<uuid>.jpg  -> deck/music-video/characters/big-sexy/stills/big-sexy-still-07.jpg
 *   skidmarks/adult-shorts/<uuid>.jpg  -> deck/shorts/shorts/blonde-girl-1/blonde-girl-1-plate-02.jpg
 *
 * The old -> new list is the move plan CSV (default
 * /workspace/deck-blob-plan/move-plan-207.csv; header
 * `old,new,owner,role,also,also_in_song_archives,bytes`). Every new path
 * is checked against the layout in `lib/deckBlobCopyPlan.ts` (same shape
 * for every genre, no random tags) before anything else happens.
 *
 *   # Dry run (the default). Writes nothing anywhere: the database is
 *   # read inside a READ ONLY transaction, and Blob is only looked at
 *   # with plain public HEAD requests (no token needed).
 *   DECK_DATABASE_URL=... npx vite-node scripts/copy-blob-to-deck-tree.ts
 *
 *   # Really copy, then update the links (only after checking the dry run):
 *   DECK_DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     npx vite-node scripts/copy-blob-to-deck-tree.ts --write
 *
 * Options: `--plan <csv>`, `--owner <id>` (default `stuart`),
 * `--expect <n>` (default 207; `--expect any` to skip the count check),
 * `--no-blob-check` (dry run: skip the public HEAD requests).
 *
 * Only `DECK_DATABASE_URL` is read for the database. `DATABASE_URL` is
 * deliberately ignored so this can never hit a different database by
 * accident.
 *
 * What `--write` does, in order, and what it never does:
 * 1. Reads the session row and the `deck_items` rows that hold old links
 *    (read-only) and refuses if any old link isn't in the plan.
 * 2. Copies each file with `copy()`, `allowOverwrite: false`. If the name
 *    is taken by a byte-identical copy (a re-run) it reuses it; if it is
 *    taken by anything else it tries `-v2`, `-v3`… It never overwrites
 *    and NEVER deletes: the originals stay where they are (saved songs
 *    still point at about 41 of them).
 * 3. Writes a result CSV next to the plan with the final paths.
 * 4. One SQL statement (one transaction) that updates the session row
 *    and every affected `deck_items` row, each only if its revision is
 *    still the one read in step 1, saves the before-version of each
 *    `deck_items` row to `deck_item_history`, and keeps a
 *    `skidmarks_session_history` copy of the session before and after.
 *    If anything was saved in between, the whole statement fails and
 *    nothing in the database changes. Run it again: the copies from
 *    step 2 are reused, not duplicated.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { copy, head } from "@vercel/blob";
import { isBlobAlreadyExistsError } from "../lib/deckMediaPaths";
import {
  DECK_BLOB_STORE_HOST,
  OLD_BLOB_FOLDERS,
  blobPublicUrl,
  buildUrlMap,
  candidatePathnames,
  LINK_UPDATE_SQL,
  countOldLinks,
  formatCsv,
  parseMovePlanCsv,
  planGenre,
  rewriteBlobLinks,
  validateMovePlan,
  type LinkChange,
} from "../lib/deckBlobCopyPlan";

const DEFAULT_PLAN = "/workspace/deck-blob-plan/move-plan-207.csv";
const DEFAULT_EXPECT = 207;
const HOST = DECK_BLOB_STORE_HOST;
const STORE_ID = HOST.split(".")[0];

function usage(message?: string): never {
  if (message) console.error(message);
  console.log(
    [
      "Usage:",
      "  npx vite-node scripts/copy-blob-to-deck-tree.ts [--dry-run] [--plan file.csv] [--owner stuart] [--expect 207|any] [--no-blob-check]",
      "  npx vite-node scripts/copy-blob-to-deck-tree.ts --write   [--plan file.csv] [--owner stuart] [--expect 207|any]",
      "Needs DECK_DATABASE_URL (DATABASE_URL is ignored). --write also needs BLOB_READ_WRITE_TOKEN.",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const known = new Set(["--dry-run", "--write", "--plan", "--owner", "--expect", "--no-blob-check", "--help"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known.has(a)) usage(`Unknown option: ${a}`);
    if (a === "--plan" || a === "--owner" || a === "--expect") i++;
  }
  if (argv.includes("--help")) usage();
  const write = argv.includes("--write");
  if (write && argv.includes("--dry-run")) usage("Pick one of --dry-run or --write.");
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    if (at < 0) return undefined;
    const v = argv[at + 1];
    if (!v || v.startsWith("--")) usage(`${flag} needs a value.`);
    return v;
  };
  const expectRaw = value("--expect");
  const expect = expectRaw === "any" ? undefined : expectRaw ? Number(expectRaw) : DEFAULT_EXPECT;
  if (expect !== undefined && !Number.isInteger(expect)) usage("--expect must be a number or 'any'.");
  return {
    write,
    plan: value("--plan") ?? DEFAULT_PLAN,
    owner: value("--owner") ?? "stuart",
    expect,
    blobCheck: !argv.includes("--no-blob-check"),
  };
}

const pathOf = (url: string) => url.replace(`https://${HOST}/`, "");

async function inBatches<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
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
async function publicHead(pathname: string): Promise<{ status: number; size: number | null }> {
  const res = await fetch(`${blobPublicUrl(pathname)}?deck-copy-check=${Date.now()}`, { method: "HEAD", cache: "no-store" });
  const len = res.headers.get("content-length");
  return { status: res.status, size: res.ok && len ? Number(len) : null };
}

async function sha256OfUrl(url: string): Promise<string> {
  const res = await fetch(`${url}?deck-copy-check=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${pathOf(url)} failed: HTTP ${res.status}`);
  return createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient = /rate limit|service.*(unavailable|not available)|ECONNRESET|ETIMEDOUT|fetch failed|5\d\d/i.test(msg);
      if (!transient || attempt >= 4 || isBlobAlreadyExistsError(err)) throw err;
      console.log(`  (retrying ${label} after: ${msg})`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

interface ItemRow {
  kind: string;
  item_id: string;
  folder: string;
  revision: number | string;
  deleted_at: unknown;
  data: unknown;
}

interface Planned {
  table: "skidmarks_sessions" | "deck_items";
  key: string;
  changes: LinkChange[];
}

function printChanges(planned: Planned[]) {
  for (const p of planned) {
    console.log(`  ${p.table} ${p.key}: ${p.changes.length} field(s)`);
    for (const c of p.changes) {
      for (const [from, to] of c.links) console.log(`    ${c.field}\n      ${pathOf(from)}\n   -> ${pathOf(to)}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.write ? "WRITE (copies files, then one database transaction)" : "DRY RUN (nothing will be written anywhere)";
  console.log(`Copy old Blob pictures into the deck/ tree: ${mode}`);
  console.log(`Plan: ${args.plan}`);
  console.log(`Owner: ${args.owner}`);
  console.log(`Store: ${HOST}`);

  // ---- 1. The plan --------------------------------------------------------
  const rows = parseMovePlanCsv(fs.readFileSync(args.plan, "utf8"));
  const problems = validateMovePlan(rows, args.expect);
  if (problems.length > 0) {
    console.error(`The plan has ${problems.length} problem(s); fix the CSV first:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const bySource = OLD_BLOB_FOLDERS.map((f) => `${f} ${rows.filter((r) => r.old.startsWith(`${f}/`)).length}`);
  const genres = [...new Set(rows.map((r) => planGenre(r.new)))];
  console.log(`\nPlan OK: ${rows.length} file(s) (${bySource.join(", ")}).`);
  console.log(`New homes: ${genres.map((g) => `deck/${g} ${rows.filter((r) => planGenre(r.new) === g).length}`).join(", ")}.`);

  // ---- 2. The database, read-only ------------------------------------------
  const conn = process.env.DECK_DATABASE_URL?.trim();
  if (!conn) {
    console.error("DECK_DATABASE_URL is not set. (DATABASE_URL is deliberately not used.)");
    process.exit(2);
  }
  const sql = neon(conn);
  const oldLinkPattern = `https://${HOST.replace(/\./g, "\\.")}/skidmarks/(member-photos|plate-stills|adult-shorts)/`;
  const [sessionRows, itemRows] = (await sql.transaction(
    [
      sql`SELECT state, revision, updated_at FROM skidmarks_sessions WHERE owner_id = ${args.owner} LIMIT 1`,
      sql`SELECT kind, item_id, folder, revision, deleted_at, data FROM deck_items
          WHERE owner_id = ${args.owner} AND data::text ~ ${oldLinkPattern}
          ORDER BY kind, folder, item_id`,
    ],
    { readOnly: true },
  )) as [{ state: unknown; revision: string | number; updated_at: unknown }[], ItemRow[]];

  const session = sessionRows[0];
  if (!session) {
    console.error(`No skidmarks_sessions row for owner "${args.owner}".`);
    process.exit(1);
  }
  const sessionRevision = Number(session.revision);
  const updatedAt = session.updated_at instanceof Date ? session.updated_at.toISOString() : String(session.updated_at);
  console.log(`\nSession row: revision ${sessionRevision}, last saved ${updatedAt} (UTC).`);

  /** Works out every change for a given old -> new map. */
  const planDb = (urlMap: Map<string, string>) => {
    const s = rewriteBlobLinks(session.state, urlMap, HOST);
    const items = itemRows.map((r) => ({ row: r, ...rewriteBlobLinks(r.data, urlMap, HOST) }));
    const unmapped = [...s.unmapped.map((u) => `skidmarks_sessions ${u.field}: ${pathOf(u.url)}`)];
    const inKeys = [...s.inKeys.map((k) => `skidmarks_sessions ${k.field}`)];
    for (const it of items) {
      unmapped.push(...it.unmapped.map((u) => `deck_items ${it.row.kind}/${it.row.item_id} ${u.field}: ${pathOf(u.url)}`));
      inKeys.push(...it.inKeys.map((k) => `deck_items ${it.row.kind}/${it.row.item_id} ${k.field}`));
    }
    const planned: Planned[] = [];
    if (s.changes.length > 0) planned.push({ table: "skidmarks_sessions", key: `owner=${args.owner} (revision ${sessionRevision})`, changes: s.changes });
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
  };

  const firstMap = buildUrlMap(rows, (r) => r.new, HOST);
  const dbPlan = planDb(firstMap);
  const refused: string[] = [];
  if (dbPlan.unmapped.length > 0) refused.push(`${dbPlan.unmapped.length} old link(s) in the database are not in the plan:\n      ${dbPlan.unmapped.join("\n      ")}`);
  if (dbPlan.inKeys.length > 0) refused.push(`${dbPlan.inKeys.length} old link(s) are used as JSON keys (not handled):\n      ${dbPlan.inKeys.join("\n      ")}`);

  const referenced = new Set<string>();
  for (const p of dbPlan.planned) for (const c of p.changes) for (const [from] of c.links) referenced.add(pathOf(from));
  const unreferenced = rows.filter((r) => !referenced.has(r.old));

  // ---- 3. Blob, looked at only -----------------------------------------------
  const blobNotes = new Map<number, string>();
  let missingSources = 0;
  let takenTargets = 0;
  if (!args.write && args.blobCheck) {
    console.log("\nChecking Blob with public HEAD requests (read-only)...");
    await inBatches(rows, 8, async (r) => {
      const [src, dst] = await Promise.all([publicHead(r.old), publicHead(r.new)]);
      const notes: string[] = [];
      if (src.size === null) {
        missingSources++;
        notes.push(`SOURCE MISSING (HTTP ${src.status})`);
      } else if (r.bytes !== null && src.size !== r.bytes) notes.push(`source is ${src.size} bytes, plan says ${r.bytes}`);
      if (dst.size !== null) {
        takenTargets++;
        notes.push(`new name already taken (${dst.size} bytes): a real run reuses it if identical, otherwise uses -v2`);
      }
      if (notes.length > 0) blobNotes.set(r.line, notes.join("; "));
    });
  }

  // ---- 4. Print the plan ---------------------------------------------------
  console.log(`\nFiles (${rows.length}), old -> new:`);
  for (const r of rows) {
    const note = blobNotes.get(r.line);
    console.log(`  ${r.old}\n   -> ${r.new}${note ? `\n      ! ${note}` : ""}`);
  }
  console.log(`\nDatabase fields that would change:`);
  printChanges(dbPlan.planned);

  const sessionFields = dbPlan.session.changes.length;
  const sessionLinks = dbPlan.session.changes.reduce((n, c) => n + c.links.length, 0);
  const itemFields = dbPlan.items.reduce((n, it) => n + it.changes.length, 0);
  const itemLinks = dbPlan.items.reduce((n, it) => n + it.changes.reduce((m, c) => m + c.links.length, 0), 0);
  const perKind = new Map<string, number>();
  for (const it of dbPlan.items) perKind.set(`${it.row.kind}/${it.row.folder}`, (perKind.get(`${it.row.kind}/${it.row.folder}`) ?? 0) + 1);
  const pad = (s: string) => s.padEnd(34);
  console.log("\nSummary:");
  console.log(`  ${pad("Files to copy:")}${rows.length}`);
  console.log(`  ${pad("Files referenced in the database:")}${rows.length - unreferenced.length}`);
  if (unreferenced.length > 0) console.log(`  ${pad("Files not referenced (still copied):")}${unreferenced.length}\n      ${unreferenced.map((r) => r.old).join("\n      ")}`);
  console.log(`  ${pad("Session rows to update:")}${sessionFields > 0 ? 1 : 0} (${sessionFields} field(s), ${sessionLinks} link(s))`);
  console.log(`  ${pad("deck_items rows to update:")}${dbPlan.items.length} (${itemFields} field(s), ${itemLinks} link(s))`);
  for (const [k, n] of perKind) console.log(`      ${k}: ${n} row(s)`);
  if (!args.write && args.blobCheck) {
    console.log(`  ${pad("Sources missing on Blob:")}${missingSources}`);
    console.log(`  ${pad("New names already taken:")}${takenTargets}`);
  }
  console.log(`  ${pad("Originals deleted:")}0 (never)`);

  if (refused.length > 0 || missingSources > 0) {
    const all = [...refused, ...(missingSources > 0 ? [`${missingSources} source file(s) are missing on Blob.`] : [])];
    console.log(`\nA real run would REFUSE:`);
    for (const r of all) console.log(`  - ${r}`);
    process.exit(1);
  }
  if (!args.write) {
    console.log("\nDry run: nothing was copied, nothing was written. Run with --write to do it.");
    return;
  }

  // ---- 5. --write: copy -------------------------------------------------------
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    console.error("\nBLOB_READ_WRITE_TOKEN is not set. Nothing was copied or written.");
    process.exit(2);
  }
  const tokenStore = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token)?.[1];
  if (tokenStore && tokenStore.toLowerCase() !== STORE_ID) {
    console.error(`\nBLOB_READ_WRITE_TOKEN is for a different store than ${HOST}. Nothing was copied or written.`);
    process.exit(2);
  }

  console.log("\nChecking every source file with the token...");
  const sources = await inBatches(rows, 8, (r) => withRetry(`head ${r.old}`, () => head(blobPublicUrl(r.old), { token })));
  for (const [i, s] of sources.entries()) {
    if (rows[i].bytes !== null && s.size !== rows[i].bytes) console.log(`  note: ${rows[i].old} is ${s.size} bytes, plan says ${rows[i].bytes}`);
  }

  const claimed = new Set(rows.map((r) => r.new));
  const finalPath = new Map<number, string>();
  const outcome = new Map<number, "copied" | "reused">();
  console.log("Copying (never overwriting, never deleting)...");
  for (const [i, r] of rows.entries()) {
    const src = sources[i];
    const fromUrl = blobPublicUrl(r.old);
    let landed: string | null = null;
    for (const candidate of candidatePathnames(r.new)) {
      if (candidate !== r.new && claimed.has(candidate)) continue;
      try {
        const res = await withRetry(`copy ${r.old}`, () =>
          copy(fromUrl, candidate, { access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: src.contentType, token }),
        );
        if (new URL(res.url).host !== HOST || res.pathname !== candidate) {
          throw new Error(`copy landed at ${res.url}, expected ${blobPublicUrl(candidate)}. Stopping before any database change.`);
        }
        outcome.set(r.line, "copied");
        landed = candidate;
        break;
      } catch (err) {
        if (!isBlobAlreadyExistsError(err)) throw err;
        const existing = await withRetry(`head ${candidate}`, () => head(blobPublicUrl(candidate), { token }));
        if (existing.size === src.size && (await sha256OfUrl(existing.url)) === (await sha256OfUrl(fromUrl))) {
          outcome.set(r.line, "reused");
          landed = candidate;
          break;
        }
        console.log(`  ${candidate} is taken by a different file; trying the next -vN name.`);
      }
    }
    if (!landed) throw new Error(`No free name for ${r.old} (tried ${r.new} to -v30). Stopping before any database change.`);
    claimed.add(landed);
    finalPath.set(r.line, landed);
    console.log(`  [${i + 1}/${rows.length}] ${outcome.get(r.line)} ${r.old} -> ${landed}`);
  }

  const resultFile = path.join(
    path.dirname(args.plan),
    `${path.basename(args.plan, ".csv")}-result-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
  );
  fs.writeFileSync(
    resultFile,
    formatCsv([
      ["old", "new", "planned_new", "outcome", "url"],
      ...rows.map((r) => [r.old, finalPath.get(r.line)!, r.new, outcome.get(r.line)!, blobPublicUrl(finalPath.get(r.line)!)]),
    ]),
  );
  const versioned = rows.filter((r) => finalPath.get(r.line) !== r.new);
  console.log(`\nCopies done: ${[...outcome.values()].filter((o) => o === "copied").length} copied, ${[...outcome.values()].filter((o) => o === "reused").length} reused, ${versioned.length} on a -vN name.`);
  console.log(`Result CSV: ${resultFile}`);

  // ---- 6. --write: one transaction ----------------------------------------------
  const finalPlan = planDb(buildUrlMap(rows, (r) => finalPath.get(r.line)!, HOST));
  if (finalPlan.unmapped.length > 0 || finalPlan.inKeys.length > 0) throw new Error("Old links not covered by the plan appeared. Nothing was written to the database.");
  const updateSession = finalPlan.session.changes.length > 0;
  const itemsPayload = JSON.stringify(
    finalPlan.items.map((it) => ({ kind: it.row.kind, item_id: it.row.item_id, revision: Number(it.row.revision), data: it.value })),
  );
  const newState = JSON.stringify(finalPlan.session.value);
  const expectedItems = finalPlan.items.length;
  const expectedSessions = updateSession ? 1 : 0;

  console.log(`\nUpdating the database in one transaction: ${expectedSessions} session row, ${expectedItems} deck_items row(s)...`);

  let result: { sessions: number; session_revision: unknown; items: number; item_history: number; session_history: number }[];
  try {
    const [res] = (await sql.transaction([
      sql.query(LINK_UPDATE_SQL, [args.owner, sessionRevision, itemsPayload, newState, updateSession, expectedSessions, expectedItems]),
    ])) as [typeof result];
    result = res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/division by zero/i.test(msg)) {
      console.error(
        "\nNothing was written to the database: the session or a deck_items row was saved after it was read. " +
          "Close the Deck on every device and run --write again (the copies are reused, not duplicated).",
      );
    } else console.error(`\nDatabase update failed, nothing was written: ${msg}`);
    process.exit(1);
  }
  const r0 = result[0];
  console.log(
    `Done: ${r0.sessions} session row (now revision ${r0.session_revision ?? "unchanged"}), ${r0.items} deck_items row(s), ` +
      `${r0.item_history} deck_item_history row(s), ${r0.session_history} session backup(s).`,
  );

  // ---- 7. Check -----------------------------------------------------------
  const [after, afterItems] = (await sql.transaction(
    [
      sql`SELECT state FROM skidmarks_sessions WHERE owner_id = ${args.owner}`,
      sql`SELECT data FROM deck_items WHERE owner_id = ${args.owner}`,
    ],
    { readOnly: true },
  )) as [{ state: unknown }[], { data: unknown }[]];
  const left = countOldLinks(after[0]?.state, HOST) + afterItems.reduce((n, r) => n + countOldLinks(r.data, HOST), 0);
  console.log(`Old-folder links left in the session and deck_items: ${left}.`);
  console.log("The original files were not touched.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
