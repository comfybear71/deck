/**
 * Client-side helper for uploading a plate still's own image bytes to
 * Vercel Blob — the fix for a real live bug (2026-09-14): the Neon
 * session PUT (`lib/skidmarks.ts`'s `pushSkidmarksSessionNow`) embeds
 * the *entire* live session as one JSON body on every debounce, and a
 * plate still's own `dataUrl` used to be stored inline as a full base64
 * `data:` URL right there. A handful of real generated/uploaded stills
 * across a song's clips was enough to push that one request past
 * Vercel's ~4.5MB Function-body cap — the session stopped saving
 * entirely, with a bare `HTTP 413` (no JSON body, so `pushSkidmarksSessionNow`
 * can only report the raw status code) and no way to recover short of
 * deleting plates. Same root cause, same fix shape `lib/mp3Blob.ts`
 * already applied for a real song-length MP3, and the one
 * `lib/skidmarksArchive.ts`'s own snapshot upload already uses too — see
 * `app/api/skidmarks/blob-upload/route.ts`'s module doc comment for the
 * full "why client-side-direct" story.
 *
 * Every plate-still *consumer* that needs real base64 bytes (xAI/Siray/
 * Comfy Cloud reference images, `lib/skidmarksArchive.ts`'s zip) already
 * resolves whatever URL `SkidmarksPlateStill.dataUrl` holds via
 * `lib/plateGeneration.ts`'s `resolvePlateReferenceDataUrl` (a no-op for
 * an already-`data:` value, a fetch-and-convert for a real URL) — this
 * module only ever produces the *storage* value that field holds now;
 * nothing here changes what those callers do with it.
 */

import { upload } from "@vercel/blob/client";

const PLATE_STILL_PATH_PREFIX = "skidmarks/plate-stills/";
const HANDLE_UPLOAD_URL = "/api/skidmarks/blob-upload";

function generatePlateStillId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export type UploadPlateStillOutcome = { ok: true; url: string } | { ok: false; unconfigured: boolean; message: string };

/** Same classification regex `lib/mp3Blob.ts` uses for "no Blob store
 * connected here" vs. a genuine upload failure — see that module's own
 * doc comment. */
const UNCONFIGURED_MESSAGE_RE = /token|credentials/i;

function extensionForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/**
 * Uploads one plate still's image bytes to a fresh, durable Blob
 * pathname and returns its public URL — or an honest, non-throwing
 * failure. Accepts either a real `File`/`Blob` (the manual-upload path,
 * which already has one — no base64 round trip needed) or a `data:`
 * URL string (the generated-still path, whose result already comes back
 * as one). A fresh, random pathname per still, same "never let two
 * different stills collide" reasoning `lib/mp3Blob.ts` uses for audio.
 */
export async function uploadSkidmarksPlateStill(source: File | Blob | string): Promise<UploadPlateStillOutcome> {
  try {
    let body: File | Blob;
    let contentType = "image/jpeg";
    if (typeof source === "string") {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`Could not read the generated still (HTTP ${res.status}).`);
      body = await res.blob();
      contentType = body.type || contentType;
    } else {
      body = source;
      contentType = source.type || contentType;
    }
    const pathname = `${PLATE_STILL_PATH_PREFIX}${generatePlateStillId()}.${extensionForContentType(contentType)}`;
    const result = await upload(pathname, body, {
      access: "public",
      handleUploadUrl: HANDLE_UPLOAD_URL,
      contentType,
    });
    return { ok: true, url: result.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not upload the still.";
    return { ok: false, unconfigured: UNCONFIGURED_MESSAGE_RE.test(message), message };
  }
}

export { PLATE_STILL_PATH_PREFIX };
