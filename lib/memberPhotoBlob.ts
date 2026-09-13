/**
 * Client-side helper for uploading a band member's avatar photo or a
 * band's cover photo to Vercel Blob — the second half of the 2026-09-14
 * session-save-413 fix. `lib/plateStillBlob.ts` fixed *plate* stills,
 * but missed this: `setSkidmarksMemberAvatarImage`/
 * `setSkidmarksBandCoverImage` (`lib/skidmarks.ts`) were still taking a
 * raw, already-resized-but-still-inline `data:` URL straight off
 * `readImageFileAsDataUrl` and writing it directly into the session —
 * and a member's avatar photo is exactly the "master still" reference
 * Auto-plate's whole Siray/17-positions path depends on, so it's
 * typically a real, sizeable photo, not a small generated still. A
 * session with one of these still embeds enough bytes to push the Neon
 * PUT back over Vercel's ~4.5MB Function-body cap on its own — the same
 * `HTTP 413` this feature already fixed once for plate stills.
 *
 * Every consumer that needs real base64 bytes (the xAI/Siray identity
 * reference) already resolves whatever `avatarImage` holds via
 * `lib/plateGeneration.ts`'s `resolvePlateReferenceDataUrl` — built
 * generically enough from the start to already handle a real Blob URL
 * here with no changes needed on that side.
 */

import { upload } from "@vercel/blob/client";

const MEMBER_PHOTO_PATH_PREFIX = "skidmarks/member-photos/";
const HANDLE_UPLOAD_URL = "/api/skidmarks/blob-upload";

function generateMemberPhotoId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export type UploadMemberPhotoOutcome = { ok: true; url: string } | { ok: false; unconfigured: boolean; message: string };

/** Same classification regex `lib/mp3Blob.ts`/`lib/plateStillBlob.ts` use
 * for "no Blob store connected here" vs. a genuine upload failure. */
const UNCONFIGURED_MESSAGE_RE = /token|credentials/i;

function extensionForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/**
 * Uploads a member avatar's or band cover's photo bytes to a fresh,
 * durable Blob pathname and returns its public URL — or an honest,
 * non-throwing failure. Takes the already-resized `data:` URL
 * `readImageFileAsDataUrl` produces (both callers already have one on
 * hand — no reason to re-read the original `File`).
 */
export async function uploadSkidmarksMemberPhoto(dataUrl: string): Promise<UploadMemberPhotoOutcome> {
  try {
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`Could not read the picked photo (HTTP ${res.status}).`);
    const body = await res.blob();
    const contentType = body.type || "image/jpeg";
    const pathname = `${MEMBER_PHOTO_PATH_PREFIX}${generateMemberPhotoId()}.${extensionForContentType(contentType)}`;
    const result = await upload(pathname, body, {
      access: "public",
      handleUploadUrl: HANDLE_UPLOAD_URL,
      contentType,
    });
    return { ok: true, url: result.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not upload the photo.";
    return { ok: false, unconfigured: UNCONFIGURED_MESSAGE_RE.test(message), message };
  }
}

export { MEMBER_PHOTO_PATH_PREFIX };
