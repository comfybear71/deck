/**
 * Client-side half of persisted clip-render lookup/download —
 * `app/api/skidmarks/clip-renders/route.ts` is the server half. Mirrors
 * `lib/clipGeneration.ts`/`lib/plateGeneration.ts`'s established shape
 * (pure request/response helpers, never throwing, always an honest
 * outcome object) rather than inventing a new pattern for this one
 * feature.
 *
 * **Why this exists as its own module**: both `SkidmarksClipTimeline`
 * (for each plate's rendered/not-rendered tick) and
 * `SkidmarksRenderedClipsShelf` (the page-bottom "Rendered clips" shelf)
 * need to know, for *every* plate across the whole song — not just
 * whichever clip is currently expanded — whether it already has a
 * persisted render. That's what lets "show it after refresh" work at
 * both levels, not only inside a clip's own already-expanded panel.
 *
 * **Per-plate, not per-clip** (see `lib/clipRenderBlob.ts`'s module doc
 * comment): a render is identified by the pair `(segmentId, plateId)`,
 * and its `filename` is whatever basename it was actually stored under
 * — already lettered (`01a_...`) when its clip had more than one plate
 * — so nothing on the client has to re-derive the filename from
 * `clipIndex` plus a guessed plate position.
 */

import { buildStoreZip } from "./zipDownload";

export interface PersistedClipRender {
  segmentId: string;
  plateId: string;
  url: string;
  filename: string;
  clipIndex: number;
  startSec: number;
  endSec: number;
}

const CLIP_RENDERS_ENDPOINT = "/api/skidmarks/clip-renders";

interface ClipRendersRouteBody {
  configured?: unknown;
  renders?: unknown;
  error?: unknown;
}

function isPersistedClipRenderShape(value: unknown): value is PersistedClipRender {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PersistedClipRender>;
  return (
    typeof v.segmentId === "string" &&
    typeof v.plateId === "string" &&
    typeof v.url === "string" &&
    typeof v.filename === "string" &&
    typeof v.clipIndex === "number" &&
    typeof v.startSec === "number" &&
    typeof v.endSec === "number"
  );
}

export type FetchPersistedClipRendersOutcome =
  | { ok: true; renders: PersistedClipRender[] }
  | { ok: false; renders: []; message?: string };

/**
 * Looks up every currently-persisted render across the given clip ids
 * in one request — never throws; a network error, an unconfigured Blob
 * store, or any other failure all come back as the honest `{ ok: false,
 * renders: [] }` shape rather than blowing up whatever called it.
 * Returns `{ ok: true, renders: [] }` (not `ok: false`) when Blob *is*
 * configured but genuinely nothing has been rendered yet — that's a
 * real, successful "nothing to show" answer, not a failure.
 */
export async function fetchPersistedClipRenders(segmentIds: string[]): Promise<FetchPersistedClipRendersOutcome> {
  if (segmentIds.length === 0) return { ok: true, renders: [] };

  let res: Response;
  try {
    res = await fetch(`${CLIP_RENDERS_ENDPOINT}?segmentIds=${encodeURIComponent(segmentIds.join(","))}`);
  } catch (err) {
    return { ok: false, renders: [], message: err instanceof Error ? err.message : "Network error." };
  }

  let body: ClipRendersRouteBody | null = null;
  try {
    body = (await res.json()) as ClipRendersRouteBody;
  } catch {
    // Handled by the checks below either way.
  }

  if (!res.ok || !body || body.configured !== true) {
    const message = typeof body?.error === "string" ? body.error : undefined;
    return { ok: false, renders: [], message };
  }

  const renders = Array.isArray(body.renders) ? body.renders.filter(isPersistedClipRenderShape) : [];
  return { ok: true, renders };
}

export type DeletePersistedClipRenderOutcome = { ok: true } | { ok: false; message: string };

interface DeleteClipRenderRouteBody {
  deleted?: unknown;
  error?: unknown;
}

/**
 * Stuart's explicit "remove old MP4s from the shelf" ask — deletes the
 * one persisted render for `(segmentId, plateId)` (every blob under
 * that plate's own prefix, via `DELETE /api/skidmarks/clip-renders`),
 * leaving that plate's still, shot prompt, and motion text completely
 * untouched (all `localStorage`-only, in `lib/skidmarks.ts`, entirely
 * separate from Blob). Never throws — never silently claims success
 * either: a network error, an unconfigured Blob store, or a real
 * delete failure all come back as an honest `{ ok: false, message }` so
 * `SkidmarksRenderedClipsShelf` can tell Stuart the removal didn't
 * actually happen instead of clearing the tick/shelf row for a render
 * that's still sitting there.
 */
export async function deletePersistedClipRender(segmentId: string, plateId: string): Promise<DeletePersistedClipRenderOutcome> {
  let res: Response;
  try {
    res = await fetch(
      `${CLIP_RENDERS_ENDPOINT}?segmentId=${encodeURIComponent(segmentId)}&plateId=${encodeURIComponent(plateId)}`,
      { method: "DELETE" }
    );
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error." };
  }

  let body: DeleteClipRenderRouteBody | null = null;
  try {
    body = (await res.json()) as DeleteClipRenderRouteBody;
  } catch {
    // Handled by the checks below either way.
  }

  if (!res.ok) {
    const message = typeof body?.error === "string" ? body.error : `Could not remove this render (HTTP ${res.status}).`;
    return { ok: false, message };
  }
  if (!body || body.deleted !== true) {
    return { ok: false, message: typeof body?.error === "string" ? body.error : "Could not remove this render." };
  }
  return { ok: true };
}

/** Builds the `${segmentId}:${plateId}` key every "which plates are
 * already rendered" lookup in this feature uses — a plain string key
 * rather than a nested `Map<string, Map<string, ...>>`, since a flat
 * map is all either caller (`SkidmarksClipTimeline`'s per-plate tick,
 * `SkidmarksRenderedClipsShelf`'s listing) needs. */
export function persistedRenderKey(segmentId: string, plateId: string): string {
  return `${segmentId}:${plateId}`;
}

/**
 * The one, shared "what order does the shelf read in" rule —
 * **timeline/plate position, never "most recently rendered."** Sorts by
 * `clipIndex` first (a clip's literal 1-based position in the
 * timeline — the thing Stuart actually means by "order"), then
 * `startSec`/`endSec` as a defensive tie-break for any caller that
 * built a `PersistedClipRender` without a real `clipIndex`, then the
 * stored `filename` last — that's what actually orders more than one
 * *plate* on the same clip (`01a_...` before `01b_...`, see
 * `lib/clipRenderBlob.ts`'s `buildClipRenderFilename`).
 *
 * **Why this has to be a pure function of each render's own fields,
 * not of `Map` insertion order**: a re-render of an already-rendered
 * plate calls `Map.set()` on that plate's *existing* key
 * (`hooks/useSkidmarksClipRenders.ts`'s `addRender`) — which updates
 * the value in place without moving it in iteration order — but this
 * function doesn't even rely on that: recomputing the sort from
 * scratch off `(clipIndex, startSec, endSec, filename)` every time
 * means the result is identical no matter what order the caller's
 * array/map happened to hand renders in, so "just-rendered" can never
 * jump to the front/back the way it would if this instead sorted by,
 * say, insertion order or a "last updated" timestamp.
 *
 * Returns a new array — never mutates the input.
 */
export function sortPersistedRenders<T extends PersistedClipRender>(renders: T[]): T[] {
  return [...renders].sort(
    (a, b) =>
      a.clipIndex - b.clipIndex ||
      a.startSec - b.startSec ||
      a.endSec - b.endSec ||
      a.filename.localeCompare(b.filename)
  );
}

/** Appends Vercel Blob's documented `?download=1` query param
 * (https://vercel.com/docs/vercel-blob/public-storage), which serves
 * the blob with `Content-Disposition: attachment` using this
 * pathname's own basename as the filename — the mechanism that
 * actually guarantees Resolve sees the numeric name this feature
 * builds, rather than depending on a browser's own handling of an
 * HTML anchor's `download` attribute against a cross-origin URL. */
export function buildForceDownloadUrl(blobUrl: string): string {
  return blobUrl.includes("?") ? `${blobUrl}&download=1` : `${blobUrl}?download=1`;
}

export type BuildRendersZipOutcome =
  | { ok: true; zipBytes: Uint8Array }
  | { ok: false; message: string };

/**
 * Fetches every listed render's actual video bytes (a plain, no-custom-
 * headers `GET` against each blob's public `url` — Vercel Blob serves
 * successful blob reads with `Access-Control-Allow-Origin: *`, so this
 * works cross-origin from the browser without a server-side proxy) and
 * bundles them into one ZIP via `buildStoreZip`, each entry named with
 * its own already-resolved `filename`. Never throws — a fetch failure
 * (offline, a since-deleted blob, a real CORS regression on Vercel's
 * side) comes back as an honest `{ ok: false }` so the caller can fall
 * back to plain sequential downloads instead (see this module's doc
 * comment and `components/SkidmarksRenderedClipsShelf.tsx`'s "Download
 * all" — "sequential downloads with numeric names is OK for v1" is the
 * task's own explicit fallback for exactly this case).
 */
export async function buildRendersZip(renders: PersistedClipRender[]): Promise<BuildRendersZipOutcome> {
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const render of renders) {
    let res: Response;
    try {
      res = await fetch(render.url);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Could not download a rendered clip." };
    }
    if (!res.ok) {
      return { ok: false, message: `Downloading ${render.filename} returned HTTP ${res.status}.` };
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch {
      return { ok: false, message: `Could not read ${render.filename}'s bytes.` };
    }
    entries.push({ name: render.filename, data: new Uint8Array(bytes) });
  }

  try {
    return { ok: true, zipBytes: buildStoreZip(entries) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not build the zip archive." };
  }
}

/**
 * Triggers a browser download of a real server URL (as opposed to
 * in-memory data — see `triggerBlobDownload` below) via a programmatic,
 * off-DOM anchor click — the same mechanism a plain `<a href download>`
 * uses, just fired from an event handler (the "Download rendered
 * clips" bundle button) instead of a literal link the user clicked.
 * Browser-only by construction (needs `document`).
 */
export function triggerAnchorDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * Triggers a browser "Save As"/download for an in-memory `Blob` —
 * `URL.createObjectURL` + a programmatic anchor click, the standard
 * pattern for downloading client-generated data (as opposed to
 * navigating to a real server URL, which every other download in this
 * feature does with a plain `<a href download>`). Browser-only by
 * construction (needs `document`); deliberately kept this tiny and
 * side-effecting so every actual *decision* above it (what bytes to
 * zip, what to name each entry, when to fall back) stays in the pure,
 * unit-tested functions instead.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // Revoked on a short delay, not immediately — some browsers have
    // historically canceled an in-flight save if the object URL is
    // revoked synchronously right after `.click()`.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
