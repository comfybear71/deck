/**
 * Client-side helper for the attached MP3's own durable audio copy —
 * uploading it to Vercel Blob at attach time, and looking its real
 * playable URL back up fresh from Blob whenever it's needed (never from
 * a cached copy — see `lib/mp3AudioPath.ts`'s module doc comment for
 * exactly why: Stuart's hard lock is that nothing about the attached
 * MP3, including its audio, may depend on `localStorage` for
 * durability, so the actual URL is never written into
 * `lib/skidmarks.ts`'s `localStorage`-mirrored session object — only
 * the small, inert `audioId` routing key is).
 *
 * Uses `@vercel/blob/client`'s `upload()` for the write side — a
 * genuine client-side-direct-to-Blob upload, not a normal POST through
 * this app's own serverless function — via the shared token route
 * `app/api/skidmarks/blob-upload/route.ts` (see that route's module doc
 * comment for exactly why this needs to bypass Vercel's ~4.5MB
 * Function-body cap for a real song-length file). The read side
 * (`fetchSkidmarksMp3AudioUrl`) hits a small dedicated GET route
 * (`app/api/skidmarks/mp3-audio/route.ts`) that does a live Blob
 * `list()` lookup — the same "always ask Blob fresh" pattern
 * `lib/clipRenders.ts`'s `fetchPersistedClipRenders` already uses for
 * clip renders, applied here to the MP3's own audio.
 */

import { upload } from "@vercel/blob/client";
import { buildMp3AudioPathname } from "./mp3AudioPath";

const HANDLE_UPLOAD_URL = "/api/skidmarks/blob-upload";
const MP3_AUDIO_ENDPOINT = "/api/skidmarks/mp3-audio";

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
 * Uploads one attached MP3's audio bytes to this session's own
 * (caller-minted, see `lib/mp3AudioPath.ts`'s `generateMp3AudioId`)
 * Blob pathname and returns its public URL — or an honest, non-throwing
 * failure. The returned `url` is used for *this session's* immediate
 * fallback only; it is never written into the persisted session
 * object — see this module's doc comment.
 */
export async function uploadSkidmarksMp3Audio(file: File | Blob, audioId: string): Promise<UploadMp3AudioOutcome> {
  const pathname = buildMp3AudioPathname(audioId);
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

interface Mp3AudioRouteBody {
  configured?: unknown;
  url?: unknown;
  error?: unknown;
}

export type FetchMp3AudioUrlOutcome =
  | { ok: true; url: string | null }
  | { ok: false; message?: string };

/**
 * Looks up this MP3's real, current Blob URL fresh — never trusting a
 * cached copy (there isn't one; see this module's doc comment). Returns
 * `{ ok: true, url: null }` (a real, successful "not there" answer, not
 * a failure) when Blob is configured but this id genuinely has nothing
 * uploaded yet (e.g. the upload is still in flight, or never
 * succeeded). Never throws.
 */
export async function fetchSkidmarksMp3AudioUrl(audioId: string): Promise<FetchMp3AudioUrlOutcome> {
  let res: Response;
  try {
    res = await fetch(`${MP3_AUDIO_ENDPOINT}?audioId=${encodeURIComponent(audioId)}`);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error." };
  }

  let body: Mp3AudioRouteBody | null = null;
  try {
    body = (await res.json()) as Mp3AudioRouteBody;
  } catch {
    // Handled by the checks below either way.
  }

  if (!res.ok || !body || body.configured !== true) {
    return { ok: false, message: typeof body?.error === "string" ? body.error : undefined };
  }
  return { ok: true, url: typeof body.url === "string" ? body.url : null };
}

export { generateMp3AudioId } from "./mp3AudioPath";
