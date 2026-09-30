/**
 * Pure half of the one-time "copy the old flat Blob pictures into the
 * readable deck/ tree" script (`scripts/copy-blob-to-deck-tree.ts`).
 * No network, no database: reading the move plan CSV, checking every
 * new path against Stuart's layout, and swapping old links for new ones
 * inside a saved JSON value while listing every field it touched.
 *
 * Layout checked here (the same for every genre, no random tags):
 *   deck/<genre>/characters/<char>/<char>-reference.jpg
 *   deck/<genre>/characters/<char>/plates/<char>-plate-NN.jpg
 *   deck/<genre>/<episodes|songs|shorts>/<project>/<project>-....jpg
 *   deck/music-video/bands/<band>/<band>-cover.jpg
 * with Shorts under deck/shorts/, and `-v2`, `-v3`… only when a name
 * is already taken.
 */

import {
  DECK_GENRE_PROJECTS_FOLDER,
  DECK_MEDIA_MAX_VERSION,
  isDeckMediaPathname,
  type DeckGenre,
} from "./deckMediaPaths";

/** The three flat folders the old uploads went into. */
export const OLD_BLOB_FOLDERS = ["skidmarks/member-photos", "skidmarks/plate-stills", "skidmarks/adult-shorts"] as const;

/** The store every Deck picture lives on today. */
export const DECK_BLOB_STORE_HOST = "klpgwmpsxnp9aoca.public.blob.vercel-storage.com";

export interface MovePlanRow {
  /** 1-based line in the CSV (the header is line 1). */
  line: number;
  old: string;
  new: string;
  owner: string;
  role: string;
  also: string;
  alsoInSongArchives: string;
  bytes: number | null;
}

const EXPECTED_HEADER = ["old", "new", "owner", "role", "also", "also_in_song_archives", "bytes"];

/** A small RFC 4180 reader: commas, double quotes, `""` inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\n") + "\n";
}

/** Reads the move plan. Throws on a wrong header or a short row. */
export function parseMovePlanCsv(text: string): MovePlanRow[] {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim());
  if (!header || EXPECTED_HEADER.some((h, i) => header[i] !== h)) {
    throw new Error(`Move plan header must be: ${EXPECTED_HEADER.join(",")}`);
  }
  return rows.slice(1).map((r, i) => {
    if (r.length < EXPECTED_HEADER.length) throw new Error(`Move plan line ${i + 2} has ${r.length} fields, expected ${EXPECTED_HEADER.length}.`);
    const bytes = Number(r[6]);
    return {
      line: i + 2,
      old: r[0].trim(),
      new: r[1].trim(),
      owner: r[2],
      role: r[3],
      also: r[4],
      alsoInSongArchives: r[5],
      bytes: r[6].trim() !== "" && Number.isFinite(bytes) ? bytes : null,
    };
  });
}

const OLD_PATH_RE = /^skidmarks\/(member-photos|plate-stills|adult-shorts)\/[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp|mp4)$/;

export function isOldFlatPathname(pathname: string): boolean {
  return OLD_PATH_RE.test(pathname);
}

function extension(pathname: string): string {
  const file = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
}

/**
 * Anything that looks like a random tag or id in a name: a dash-separated
 * part of 4+ hex characters that mixes digits and letters (`3f9a2c`,
 * `7b1e04`, a UUID chunk). Readable names like `unit-4s`, `plate-03`,
 * `blonde-girl-1` never match.
 */
export function findRandomTag(pathname: string): string | null {
  for (const segment of pathname.replace(/\.[a-z0-9]+$/i, "").split("/")) {
    for (const part of segment.split("-")) {
      if (part.length >= 4 && /^[0-9a-f]+$/.test(part) && /[0-9]/.test(part) && /[a-f]/.test(part)) return part;
    }
  }
  return null;
}

const GENRES: readonly DeckGenre[] = ["sunnybank", "music-video", "skidmarks", "shorts"];
const NN = "\\d{2}";
const VERSION = "(?:-v(?:[2-9]|[1-9]\\d))?";

/** Why a new path breaks the layout, or `null` when it fits. */
export function deckTreeLayoutProblem(pathname: string): string | null {
  if (!isDeckMediaPathname(pathname)) return "not a safe deck/ pathname (lowercase slugs, known extension)";
  const tag = findRandomTag(pathname);
  if (tag) return `has a random-looking tag "${tag}"`;
  const parts = pathname.split("/");
  const genre = parts[1] as DeckGenre;
  if (!GENRES.includes(genre)) return `unknown genre folder "${parts[1]}"`;
  const file = parts[parts.length - 1].replace(/\.[a-z0-9]+$/, "");
  const area = parts[2];

  if (area === "characters") {
    const char = parts[3];
    if (!char) return "no character folder";
    const rest = parts.slice(4);
    const ok =
      (rest.length === 1 && new RegExp(`^${char}-(reference|reference-candidate|avatar)${VERSION}$`).test(file)) ||
      (rest.length === 2 &&
        ((rest[0] === "plates" && new RegExp(`^${char}-plate-${NN}${VERSION}$`).test(file)) ||
          (rest[0] === "pictures" && new RegExp(`^${char}-picture-${NN}${VERSION}$`).test(file)) ||
          (rest[0] === "looks" && new RegExp(`^${char}-look-${NN}${VERSION}$`).test(file)) ||
          (rest[0] === "stills" && new RegExp(`^${char}-still-${NN}${VERSION}$`).test(file))));
    return ok ? null : `character file must be ${char}-reference / plates/${char}-plate-NN / pictures / looks / stills`;
  }
  if (area === "bands") {
    if (genre !== "music-video") return "only Music video has bands";
    const band = parts[3];
    return parts.length === 5 && new RegExp(`^${band}-cover${VERSION}$`).test(file) ? null : `band file must be bands/${band}/${band}-cover`;
  }
  // Shorts episodes (2026-09-30) live in `deck/shorts/episodes/`, next to
  // the older `deck/shorts/shorts/` folders.
  if (area === DECK_GENRE_PROJECTS_FOLDER[genre] || (genre === "shorts" && area === "episodes")) {
    const project = parts[3];
    if (!project || parts.length < 5) return "no project folder";
    return file.startsWith(`${project}-`) ? null : `project file must start with "${project}-"`;
  }
  return `"${area}" is not characters, bands or ${DECK_GENRE_PROJECTS_FOLDER[genre]} for ${genre}`;
}

/** Every problem with the plan as a whole. Empty means it's safe to use. */
export function validateMovePlan(rows: MovePlanRow[], expectedCount?: number): string[] {
  const problems: string[] = [];
  if (expectedCount !== undefined && rows.length !== expectedCount) {
    problems.push(`plan has ${rows.length} rows, expected ${expectedCount}`);
  }
  const seenOld = new Map<string, number>();
  const seenNew = new Map<string, number>();
  for (const r of rows) {
    const at = `line ${r.line}`;
    if (!isOldFlatPathname(r.old)) problems.push(`${at}: old path "${r.old}" is not in ${OLD_BLOB_FOLDERS.join(", ")}`);
    const layout = deckTreeLayoutProblem(r.new);
    if (layout) problems.push(`${at}: new path "${r.new}" ${layout}`);
    if (extension(r.old) !== extension(r.new)) problems.push(`${at}: extension changes (${r.old} -> ${r.new})`);
    if (seenOld.has(r.old)) problems.push(`${at}: old path repeats line ${seenOld.get(r.old)}`);
    if (seenNew.has(r.new)) problems.push(`${at}: new path repeats line ${seenNew.get(r.new)}`);
    seenOld.set(r.old, r.line);
    seenNew.set(r.new, r.line);
  }
  return problems;
}

/** `folder/name.ext` → `folder/name-v2.ext` (version 1 is the name itself). */
export function versionedPathname(pathname: string, version: number): string {
  if (version <= 1) return pathname;
  const dot = pathname.lastIndexOf(".");
  return `${pathname.slice(0, dot)}-v${Math.floor(version)}${pathname.slice(dot)}`;
}

/** The names a copy tries, in order: the plan's name, then `-v2`… */
export function candidatePathnames(pathname: string, max = DECK_MEDIA_MAX_VERSION): string[] {
  return Array.from({ length: max }, (_, i) => versionedPathname(pathname, i + 1));
}

export function blobPublicUrl(pathname: string, host = DECK_BLOB_STORE_HOST): string {
  return `https://${host}/${pathname}`;
}

/** Old URL → new URL for every row, using `finalPath` when a copy landed on a `-vN` name. */
export function buildUrlMap(rows: MovePlanRow[], finalPath: (row: MovePlanRow) => string = (r) => r.new, host = DECK_BLOB_STORE_HOST) {
  return new Map(rows.map((r) => [blobPublicUrl(r.old, host), blobPublicUrl(finalPath(r), host)] as const));
}

export interface LinkChange {
  /** Where in the JSON value, e.g. `$.characterLoras[3].plates[0].url`. */
  field: string;
  from: string;
  to: string;
  /** Each link swapped inside this field: [old URL, new URL]. */
  links: [string, string][];
}

export interface LinkRewrite<T> {
  value: T;
  changes: LinkChange[];
  /** Old-folder links on this store that the plan doesn't cover. */
  unmapped: { field: string; url: string }[];
  /** Old-folder links used as an object key (never rewritten). */
  inKeys: { field: string; key: string }[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function oldLinkRe(host: string): RegExp {
  return new RegExp(`https://${escapeRe(host)}/skidmarks/(?:member-photos|plate-stills|adult-shorts)/[A-Za-z0-9._-]+`, "g");
}

function fieldPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

/**
 * Swaps every old link inside `value` (any JSON) for its new one and
 * says exactly which fields changed. Only whole links on `host` are
 * matched, so a link inside a longer string (a prompt, a query string)
 * is swapped in place and the rest of the string is kept. Returns a new
 * value; `value` itself is never modified.
 */
export function rewriteBlobLinks<T>(value: T, urlMap: ReadonlyMap<string, string>, host = DECK_BLOB_STORE_HOST): LinkRewrite<T> {
  const changes: LinkChange[] = [];
  const unmapped: { field: string; url: string }[] = [];
  const inKeys: { field: string; key: string }[] = [];
  const re = oldLinkRe(host);

  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "string") {
      re.lastIndex = 0;
      if (!re.test(v)) return v;
      re.lastIndex = 0;
      const links: [string, string][] = [];
      const next = v.replace(re, (url) => {
        const to = urlMap.get(url);
        if (!to) {
          unmapped.push({ field: path, url });
          return url;
        }
        links.push([url, to]);
        return to;
      });
      if (next !== v) changes.push({ field: path, from: v, to: next, links });
      return next;
    }
    if (Array.isArray(v)) return v.map((item, i) => walk(item, fieldPath(path, i)));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
        re.lastIndex = 0;
        if (re.test(k)) inKeys.push({ field: fieldPath(path, k), key: k });
        out[k] = walk(item, fieldPath(path, k));
      }
      return out;
    }
    return v;
  };

  return { value: walk(value, "$") as T, changes, unmapped, inKeys };
}

/** How many old-folder links on `host` a JSON value still holds. */
export function countOldLinks(value: unknown, host = DECK_BLOB_STORE_HOST): number {
  return (JSON.stringify(value ?? null).match(oldLinkRe(host)) ?? []).length;
}

/** Top-level genre of a new path, for the summary. */
export function planGenre(pathname: string): string {
  return pathname.split("/")[1] ?? "?";
}

/**
 * The one statement (so one transaction) `--write` runs. Params:
 * $1 owner, $2 session revision read, $3 deck_items rows as JSON
 * `[{kind,item_id,revision,data}]`, $4 new session state JSON,
 * $5 whether the session changes, $6 expected session rows (0/1),
 * $7 expected deck_items rows. Every UPDATE is a compare-and-swap on
 * the revision that was read; if any row moved on, the guard divides by
 * zero, the statement fails and nothing is written.
 */
export const LINK_UPDATE_SQL = `
  WITH input AS (
    SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(kind text, item_id text, revision int, data jsonb)
  ),
  -- The before-version of each row, read from the statement's snapshot.
  -- No FOR UPDATE here: in the same statement as the UPDATE below it
  -- sees the rows as "already updated by this command", skips them all,
  -- and the guard then always failed (division by zero, nothing written).
  -- The UPDATE's own revision check is the compare-and-swap.
  prior AS (
    SELECT d.* FROM deck_items d JOIN input x
      ON d.owner_id = $1 AND d.kind = x.kind AND d.item_id = x.item_id AND d.revision = x.revision
  ),
  items_written AS (
    UPDATE deck_items d SET data = x.data, revision = d.revision + 1, updated_at = now()
    FROM input x
    WHERE d.owner_id = $1 AND d.kind = x.kind AND d.item_id = x.item_id AND d.revision = x.revision
    RETURNING d.item_id
  ),
  items_history AS (
    INSERT INTO deck_item_history (owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at)
    SELECT owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at FROM prior
    RETURNING 1
  ),
  session_before AS (
    INSERT INTO skidmarks_session_history (owner_id, revision, state)
    SELECT owner_id, revision, state FROM skidmarks_sessions
    WHERE $5::boolean AND owner_id = $1 AND revision = $2
      AND NOT EXISTS (SELECT 1 FROM skidmarks_session_history h WHERE h.owner_id = $1 AND h.revision = $2)
    RETURNING 1
  ),
  session_written AS (
    UPDATE skidmarks_sessions SET state = $4::jsonb, revision = revision + 1, updated_at = now()
    WHERE $5::boolean AND owner_id = $1 AND revision = $2
    RETURNING revision
  ),
  session_after AS (
    INSERT INTO skidmarks_session_history (owner_id, revision, state)
    SELECT $1, revision, $4::jsonb FROM session_written
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM session_written)::int AS sessions,
    (SELECT max(revision) FROM session_written) AS session_revision,
    (SELECT count(*) FROM items_written)::int AS items,
    (SELECT count(*) FROM items_history)::int AS item_history,
    (SELECT count(*) FROM session_after)::int AS session_history,
    -- Guard: anything but the exact expected counts divides by zero,
    -- which fails the whole statement, so nothing at all is written.
    1 / (CASE WHEN (SELECT count(*) FROM session_written) = $6
               AND (SELECT count(*) FROM items_written) = $7
               AND (SELECT count(*) FROM items_history) = $7
          THEN 1 ELSE 0 END) AS guard`;
