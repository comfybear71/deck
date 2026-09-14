/**
 * Shared pathname convention for a clip's persisted video render in
 * Vercel Blob — the "durable, real storage for media" half of Stuart's
 * post-#42 hard lock ("never localStorage for clips/plates/studio
 * state; Neon for state later, Vercel Blob for media now" — see
 * AGENTS.md and `app/api/skidmarks/generate-clip/route.ts`'s module
 * doc comment for the full story of why this replaced the ephemeral
 * React-state-only render this feature shipped with in #42).
 *
 * **Per-plate, not per-clip, as of the per-plate-select rework** — a
 * clip's plate strip can hold several independent stills (door →
 * keyhole → Jack), and each plate now renders separately off its own
 * selected still + its own motion text (see `lib/clipGeneration.ts`'s
 * module doc comment for why this isn't multi-reference continuity
 * anymore). That means the persisted-render identity has to be
 * `(segmentId, plateId)`, not just `segmentId` — this is a **breaking
 * pathname-scheme change** from the original `{segmentId}/{filename}`
 * layout (now `{segmentId}/{plateId}/{filename}`). A render already
 * sitting in Blob under the old scheme simply won't be picked up by
 * `parseClipRenderPathname` anymore (it's not deleted — it's just an
 * orphaned blob under the shared prefix that this app no longer lists
 * or links to). Flagged explicitly here and in AGENTS.md as a
 * deliberate migration note, not an oversight.
 *
 * **Each plate still keeps exactly **one** persisted render**, always
 * overwritten by its latest (`allowOverwrite: true` where this pathname
 * is written) — there is no history of past takes to browse,
 * re-download, or clean up. That matches this app's "smallest possible
 * surface" chrome lock (see AGENTS.md's plating-UX section) and avoids
 * Blob storage growing without bound every time Stuart tweaks a motion
 * line and re-renders the same plate.
 *
 * The pathname's own basename doubles as the exact download filename
 * Resolve wants (`{clipIndex}{plateLetter}_{startSec}-{endSec}_render.mp4`,
 * e.g. `01_0000-0040_render.mp4` for a clip's only plate, or
 * `01a_0000-0040_render.mp4`/`01b_...`/`01c_...` for a clip with more
 * than one plate — the letter suffix only appears once a clip actually
 * has more than one plate, so a single-plate clip's filename is
 * unchanged from before this rework) — Vercel Blob's `?download=1`
 * query param serves a blob with `Content-Disposition: attachment;
 * filename="<basename>"` set to exactly this string
 * (https://vercel.com/docs/vercel-blob/public-storage), so the numeric
 * name Resolve needs is guaranteed by the server response itself, not
 * left to a browser's own handling of an HTML anchor's `download`
 * attribute against a cross-origin URL (which historically hasn't been
 * fully reliable across browsers).
 */

const CLIP_RENDER_PATH_PREFIX = "skidmarks/clip-renders/";

const SEGMENT_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_SEGMENT_ID_LENGTH = 200;

/** `segmentId`/`plateId` ultimately come from `crypto.randomUUID()`-based
 * ids minted by `generateId` in `lib/skidmarks.ts` (e.g.
 * `segment_3fae...`, `plate_9c1b...`), but they arrive here over an
 * untrusted HTTP request body — this is the actual guard against either
 * being used to construct a path-traversal or otherwise unsafe Blob
 * pathname (`../../something`, a slash, control characters, an absurd
 * length). Shared by both ids — they're the same shape. */
export function isSafeSegmentId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SEGMENT_ID_LENGTH && SEGMENT_ID_RE.test(value);
}

function padNumber(value: number, minWidth: number): string {
  const rounded = Math.max(0, Math.round(value));
  return String(rounded).padStart(minWidth, "0");
}

/**
 * The exact filename Resolve gets, both as this pathname's basename and
 * as the `download=` filename `?download=1` serves — see this module's
 * doc comment. `clipIndex` is **1-based** (this clip's position in the
 * timeline, counting from 1) so the very first clip reads `01`,
 * matching how Stuart would count clips by eye rather than a
 * programmer's 0-based index. `startSec`/`endSec` are rounded to whole
 * seconds and zero-padded to at least 4 digits (matches the task's own
 * `0000`–`0040` example; a track past ~2h47m would just grow past 4
 * digits rather than truncating). `plateLetterIndex` (0-based: 0 → "a",
 * 1 → "b", …) is only appended when given — a clip with just one plate
 * keeps the exact filename shape this feature always used, so nothing
 * changes for the common case.
 */
function plateLetterSuffix(plateLetterIndex?: number): string {
  return typeof plateLetterIndex === "number" && Number.isFinite(plateLetterIndex) && plateLetterIndex >= 0
    ? String.fromCharCode(97 + Math.floor(plateLetterIndex))
    : "";
}

export function buildClipRenderFilename(
  clipIndex: number,
  startSec: number,
  endSec: number,
  plateLetterIndex?: number
): string {
  return `${padNumber(clipIndex, 2)}${plateLetterSuffix(plateLetterIndex)}_${padNumber(startSec, 4)}-${padNumber(endSec, 4)}_render.mp4`;
}

/** Sibling filename for the render's own extracted last frame (see
 * `buildClipRenderLastFramePathname`'s doc comment) — same numbering
 * scheme as `buildClipRenderFilename`, `_lastframe.jpg` instead of
 * `_render.mp4` so the two are trivially told apart by eye in a Blob
 * listing. */
export function buildClipRenderLastFrameFilename(
  clipIndex: number,
  startSec: number,
  endSec: number,
  plateLetterIndex?: number
): string {
  return `${padNumber(clipIndex, 2)}${plateLetterSuffix(plateLetterIndex)}_${padNumber(startSec, 4)}-${padNumber(endSec, 4)}_lastframe.jpg`;
}

/** Builds this plate's one persisted-render pathname — stable across
 * repeated renders of the *same* plate **as long as `clipIndex`/
 * `startSec`/`endSec`/`plateLetterIndex` don't themselves shift between
 * two renders** (`allowOverwrite: true` only replaces the blob already
 * sitting at this *exact* pathname — see this module's doc comment and
 * `buildClipRenderPlatePrefix`'s doc comment for what covers the case
 * where one of those *does* shift, e.g. the timeline reordering or a
 * plate count changing between takes). */
export function buildClipRenderPathname(
  segmentId: string,
  plateId: string,
  clipIndex: number,
  startSec: number,
  endSec: number,
  plateLetterIndex?: number
): string {
  return `${CLIP_RENDER_PATH_PREFIX}${segmentId}/${plateId}/${buildClipRenderFilename(clipIndex, startSec, endSec, plateLetterIndex)}`;
}

/**
 * Sibling pathname, same `(segmentId, plateId)` directory, for the JPEG
 * `app/api/skidmarks/generate-clip/route.ts` extracts server-side (via
 * ffmpeg, `lib/serverVideoFrame.ts`) from this render's own last frame —
 * the real replacement for the old client-side `<video>`+`<canvas>`
 * capture (`lib/videoFrame.ts`, removed 2026-09-14 after three separate
 * live failures on Stuart's iPhone: generation already runs in the
 * cloud, so frame carry belongs in the cloud too, not in Safari). Lives
 * under the exact same plate prefix as the video itself
 * (`buildClipRenderPlatePrefix`), so one `pruneStaleRendersForPlate` call
 * already covers both — see that route's `persistRenderBytesToBlob`.
 */
export function buildClipRenderLastFramePathname(
  segmentId: string,
  plateId: string,
  clipIndex: number,
  startSec: number,
  endSec: number,
  plateLetterIndex?: number
): string {
  return `${CLIP_RENDER_PATH_PREFIX}${segmentId}/${plateId}/${buildClipRenderLastFrameFilename(clipIndex, startSec, endSec, plateLetterIndex)}`;
}

/**
 * This plate's own directory prefix — everything before the filename in
 * `buildClipRenderPathname`'s output. **The real, position-independent
 * identity of "this plate's one persisted render"**: `clipIndex`/
 * `startSec`/`endSec`/`plateLetterIndex` all feed into the *filename*
 * (so a download/Resolve-friendly name can encode a clip's numeric
 * position), but none of them are supposed to change what counts as
 * "the same plate's render" — a live bug report showed they sometimes
 * do drift between two renders of what's still the same plate (a
 * timeline re-sort, a plate added/removed elsewhere in the same clip's
 * strip shifting `plateIndex`/`plateCount`), which changes the
 * *filename* and therefore the full pathname `allowOverwrite` keys off
 * of \u2014 producing a second, orphaned blob under this same prefix
 * instead of genuinely overwriting the first. `app/api/skidmarks/
 * generate-clip/route.ts` uses this prefix right after a successful
 * `put()` to actively delete every *other* blob already sitting under
 * it, so "exactly one persisted render per `(segmentId, plateId)`" is a
 * real invariant enforced at write time, not just true in the common
 * case where nothing else happened to shift in between.
 */
export function buildClipRenderPlatePrefix(segmentId: string, plateId: string): string {
  return `${CLIP_RENDER_PATH_PREFIX}${segmentId}/${plateId}/`;
}

export interface ParsedClipRenderPathname {
  segmentId: string;
  plateId: string;
  clipIndex: number;
  startSec: number;
  endSec: number;
  /** The basename this render was actually stored under — the exact
   * download/Resolve filename, already lettered if this clip had more
   * than one plate at render time. Trusting the stored basename here
   * (rather than re-deriving it from `clipIndex`/`plateLetterIndex`
   * alone) means a listing never has to know how many plates a clip
   * currently has to report the right filename. */
  filename: string;
}

const PATHNAME_RE = new RegExp(
  `^${CLIP_RENDER_PATH_PREFIX.replace(/[/]/g, "\\/")}([^/]+)\\/([^/]+)\\/(\\d+)[a-z]?_(\\d+)-(\\d+)_render\\.mp4$`
);

/**
 * Parses this module's own pathname convention back into its parts —
 * `app/api/skidmarks/clip-renders/route.ts` uses this to turn a Blob
 * `list()` result back into `{ segmentId, plateId, clipIndex, startSec,
 * endSec, filename }` without needing a second metadata store (a JSON
 * sidecar file, a database row) alongside the video itself. A pathname
 * that doesn't match this shape (a stray/legacy blob under this prefix
 * — including one from the pre-per-plate scheme, see this module's doc
 * comment — or one from a future format change) is honestly dropped
 * (`null`) rather than guessed at or partially trusted.
 */
export function parseClipRenderPathname(pathname: string): ParsedClipRenderPathname | null {
  const match = PATHNAME_RE.exec(pathname);
  if (!match) return null;
  const [, segmentId, plateId, clipIndex, startSec, endSec] = match;
  if (!isSafeSegmentId(segmentId) || !isSafeSegmentId(plateId)) return null;
  const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
  return {
    segmentId,
    plateId,
    clipIndex: Number(clipIndex),
    startSec: Number(startSec),
    endSec: Number(endSec),
    filename,
  };
}

export { CLIP_RENDER_PATH_PREFIX };
