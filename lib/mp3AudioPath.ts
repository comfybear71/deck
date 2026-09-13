/**
 * Shared, pure pathname convention for the attached MP3's own durable
 * audio copy in Vercel Blob — the server (`app/api/skidmarks/mp3-audio/
 * route.ts`) and client (`lib/mp3Blob.ts`) halves both import this
 * instead of each hand-rolling their own string, same "one small shared
 * module, no drift" pattern as `lib/clipRenderBlob.ts` for clip renders.
 *
 * **Why a lookup-by-id, not a stored URL** — see `lib/mp3Blob.ts`'s
 * module doc comment for the full story: Stuart's hard lock is that
 * *nothing* about the attached MP3, including its audio, may depend on
 * `localStorage` for durability. Storing the resulting Blob URL string
 * inside `lib/skidmarks.ts`'s `localStorage`-mirrored session object
 * would have quietly made "can Stuart hear his song after a refresh"
 * depend on `localStorage` surviving intact — exactly what he's ruling
 * out. Keeping only this small, inert `audioId` in that session object
 * (the same category of plain routing string `segmentId`/`plateId`
 * already are, not "audio" or "the archive of record" in any real
 * sense) and re-deriving the actual playable URL fresh from Blob on
 * every load (`fetchSkidmarksMp3AudioUrl`) means the one thing that
 * actually matters — "is this audio really durably there, and where" —
 * is answered by Blob itself, every time, never by a locally cached
 * copy that could go stale or simply not be trusted.
 */

export const MP3_AUDIO_PATH_PREFIX = "skidmarks/mp3-audio/";

const AUDIO_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_AUDIO_ID_LENGTH = 200;

/** `audioId` arrives at the server over an untrusted query string —
 * this is the actual guard against it being used to construct a
 * path-traversal or otherwise unsafe Blob pathname/prefix, same shape
 * as `lib/clipRenderBlob.ts`'s `isSafeSegmentId`. */
export function isSafeMp3AudioId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_AUDIO_ID_LENGTH && AUDIO_ID_RE.test(value);
}

export function buildMp3AudioPathname(audioId: string): string {
  return `${MP3_AUDIO_PATH_PREFIX}${audioId}.mp3`;
}

/** A fresh, random id minted once per attach — deliberately not derived
 * from the file's own name (two different songs could share a
 * filename) and deliberately not reused across attaches (a re-attached
 * MP3 gets its own fresh id/pathname rather than overwriting whatever
 * the previous attach in this session saved, in case Stuart re-attaches
 * to swap songs but the old one is still referenced from an
 * already-created archive snapshot). */
export function generateMp3AudioId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
