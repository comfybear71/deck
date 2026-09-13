/**
 * Client-side half of persisted clip-render lookup/download —
 * `app/api/skidmarks/clip-renders/route.ts` is the server half. Mirrors
 * `lib/clipGeneration.ts`/`lib/plateGeneration.ts`'s established shape
 * (pure request/response helpers, never throwing, always an honest
 * outcome object) rather than inventing a new pattern for this one
 * feature.
 *
 * **Why this exists as its own module**: `SkidmarksClipTimeline` needs
 * to know, for *every* clip on the timeline (not just whichever one is
 * currently expanded), whether it already has a persisted render —
 * that's what lets "show it after refresh" work at the timeline level
 * too (the "Download all rendered clips" bundle button below), not
 * only inside a clip's own already-expanded panel.
 */

import { buildClipRenderFilename } from "./clipRenderBlob";
import { buildStoreZip } from "./zipDownload";

export interface PersistedClipRender {
  segmentId: string;
  url: string;
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
    typeof v.url === "string" &&
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
 * renders: [] }` shape rather than blowing up the timeline that called
 * it. Returns `{ ok: true, renders: [] }` (not `ok: false`) when Blob
 * *is* configured but genuinely nothing has been rendered yet — that's
 * a real, successful "nothing to show" answer, not a failure.
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

export { buildClipRenderFilename };

export interface ClipRenderBundleEntry extends PersistedClipRender {
  filename: string;
}

export function toBundleEntries(renders: PersistedClipRender[]): ClipRenderBundleEntry[] {
  return renders.map((render) => ({
    ...render,
    filename: buildClipRenderFilename(render.clipIndex, render.startSec, render.endSec),
  }));
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
 * this feature's own numeric convention. Never throws — a fetch failure
 * (offline, a since-deleted blob, a real CORS regression on Vercel's
 * side) comes back as an honest `{ ok: false }` so the caller can fall
 * back to plain sequential downloads instead (see this module's doc
 * comment and `components/SkidmarksClipRender.tsx`'s "Download all" —
 * "sequential downloads with numeric names is OK for v1" is the task's
 * own explicit fallback for exactly this case).
 */
export async function buildRendersZip(renders: PersistedClipRender[]): Promise<BuildRendersZipOutcome> {
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const render of toBundleEntries(renders)) {
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
