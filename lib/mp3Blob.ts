/**
 * Client-side helper for the one thing `useSkidmarksStudio.attachMp3`
 * needs from Vercel Blob beyond clip-render persistence: uploading the
 * just-attached MP3's own audio bytes so playback survives a refresh
 * (see `lib/skidmarks.ts`'s `SkidmarksMp3Attachment.audioUrl` doc
 * comment for the full "why" — the raw `File` never persists, so before
 * this existed, a reload always lost real playback even though every
 * other bit of session state did survive).
 *
 * Uses `@vercel/blob/client`'s `upload()` — a genuine client-side-
 * direct-to-Blob upload, not a normal POST through this app's own
 * serverless function — via the shared token route
 * `app/api/skidmarks/blob-upload/route.ts` (see that route's module doc
 * comment for exactly why this needs to bypass Vercel's ~4.5MB
 * Function-body cap for a real song-length file).
 */

import { upload } from "@vercel/blob/client";

const MP3_AUDIO_PATH_PREFIX = "skidmarks/mp3-audio/";
const HANDLE_UPLOAD_URL = "/api/skidmarks/blob-upload";

function generateMp3AudioId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export type UploadMp3AudioOutcome =
  | { ok: true; url: string }
  | { ok: false; unconfigured: boolean; message: string };

/** Regex over `handleUpload`'s own real error text for "no Blob store
 * connected here" — distinct from any other genuine upload failure
 * (network, an actual Blob API error). Matches both of `@vercel/blob`'s
 * documented missing-credential messages ("No blob credentials found…",
 * "No read-write token found…") without hardcoding either string
 * verbatim, so a future wording tweak upstream doesn't silently break
 * this classification. */
const UNCONFIGURED_MESSAGE_RE = /token|credentials/i;

/**
 * Uploads one attached MP3's audio bytes to a fresh, durable Blob
 * pathname and returns its public URL — or an honest, non-throwing
 * failure. A fresh, random pathname per attach (rather than something
 * derived from the file's own name) is deliberate: two different songs
 * that happen to share a filename should never overwrite each other's
 * saved audio.
 */
export async function uploadSkidmarksMp3Audio(file: File | Blob): Promise<UploadMp3AudioOutcome> {
  const pathname = `${MP3_AUDIO_PATH_PREFIX}${generateMp3AudioId()}.mp3`;
  try {
    const result = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: HANDLE_UPLOAD_URL,
      contentType: "audio/mpeg",
    });
    return { ok: true, url: result.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not upload the audio file.";
    return { ok: false, unconfigured: UNCONFIGURED_MESSAGE_RE.test(message), message };
  }
}

export { MP3_AUDIO_PATH_PREFIX };
