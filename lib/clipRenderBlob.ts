/**
 * Shared pathname convention for a clip's persisted video render in
 * Vercel Blob — the "durable, real storage for media" half of Stuart's
 * post-#42 hard lock ("never localStorage for clips/plates/studio
 * state; Neon for state later, Vercel Blob for media now" — see
 * AGENTS.md and `app/api/skidmarks/generate-clip/route.ts`'s module
 * doc comment for the full story of why this replaced the ephemeral
 * React-state-only render this feature shipped with in #42).
 *
 * **One deliberate scope call worth flagging explicitly**: each clip
 * keeps exactly **one** persisted render, always overwritten by its
 * latest (`allowOverwrite: true` where this pathname is written) —
 * there is no history of past takes to browse, re-download, or clean
 * up. That matches this app's "smallest possible surface" chrome lock
 * (see AGENTS.md's plating-UX section) and avoids Blob storage growing
 * without bound every time Stuart tweaks a shot prompt and re-renders
 * the same clip. If Stuart later wants to keep every take instead of
 * just the latest, that is a fresh explicit ask, not something this
 * pathname scheme quietly assumed away.
 *
 * The pathname's own basename doubles as the exact download filename
 * Resolve wants (`{clipIndex}_{startSec}-{endSec}_render.mp4`, e.g.
 * `01_0000-0040_render.mp4` for clip 1 spanning 0:00–0:40) — Vercel
 * Blob's `?download=1` query param serves a blob with
 * `Content-Disposition: attachment; filename="<basename>"` set to
 * exactly this string
 * (https://vercel.com/docs/vercel-blob/public-storage), so the numeric
 * name Resolve needs is guaranteed by the server response itself, not
 * left to a browser's own handling of an HTML anchor's `download`
 * attribute against a cross-origin URL (which historically hasn't been
 * fully reliable across browsers). **One naming deviation from the
 * task's own example worth calling out**: the suffix here is
 * `_render`, not `_plate` — a rendered *video* clip is a different
 * artifact from a plate *still* image (`SkidmarksPlateStill`, already a
 * distinct concept in this codebase), and reusing "plate" for the video
 * output risked reading as if it were the same kind of file. Flagging
 * this now in case Stuart specifically wants the literal `_plate`
 * string instead.
 */

const CLIP_RENDER_PATH_PREFIX = "skidmarks/clip-renders/";

const SEGMENT_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_SEGMENT_ID_LENGTH = 200;

/** `segmentId` ultimately comes from `crypto.randomUUID()`-based ids
 * minted by `generateId` in `lib/skidmarks.ts` (e.g.
 * `segment_3fae...`), but it arrives here over an untrusted HTTP
 * request body — this is the actual guard against it being used to
 * construct a path-traversal or otherwise unsafe Blob pathname
 * (`../../something`, a slash, control characters, an absurd length). */
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
 * digits rather than truncating).
 */
export function buildClipRenderFilename(clipIndex: number, startSec: number, endSec: number): string {
  return `${padNumber(clipIndex, 2)}_${padNumber(startSec, 4)}-${padNumber(endSec, 4)}_render.mp4`;
}

/** Builds this clip's one persisted-render pathname — stable across
 * repeated renders of the *same* clip (same `segmentId`/`clipIndex`/
 * `startSec`/`endSec` always resolves to the same path), which is what
 * lets `allowOverwrite: true` replace the previous take instead of
 * accumulating one Blob object per render. */
export function buildClipRenderPathname(
  segmentId: string,
  clipIndex: number,
  startSec: number,
  endSec: number
): string {
  return `${CLIP_RENDER_PATH_PREFIX}${segmentId}/${buildClipRenderFilename(clipIndex, startSec, endSec)}`;
}

export interface ParsedClipRenderPathname {
  segmentId: string;
  clipIndex: number;
  startSec: number;
  endSec: number;
}

const PATHNAME_RE = new RegExp(
  `^${CLIP_RENDER_PATH_PREFIX.replace(/[/]/g, "\\/")}([^/]+)\\/(\\d+)_(\\d+)-(\\d+)_render\\.mp4$`
);

/**
 * Parses this module's own pathname convention back into its parts —
 * `app/api/skidmarks/clip-renders/route.ts` uses this to turn a Blob
 * `list()` result back into `{ segmentId, clipIndex, startSec, endSec }`
 * without needing a second metadata store (a JSON sidecar file, a
 * database row) alongside the video itself. A pathname that doesn't
 * match this shape (a stray/legacy blob under this prefix, or one from
 * a future format change) is honestly dropped (`null`) rather than
 * guessed at or partially trusted.
 */
export function parseClipRenderPathname(pathname: string): ParsedClipRenderPathname | null {
  const match = PATHNAME_RE.exec(pathname);
  if (!match) return null;
  const [, segmentId, clipIndex, startSec, endSec] = match;
  if (!isSafeSegmentId(segmentId)) return null;
  return {
    segmentId,
    clipIndex: Number(clipIndex),
    startSec: Number(startSec),
    endSec: Number(endSec),
  };
}

export { CLIP_RENDER_PATH_PREFIX };
