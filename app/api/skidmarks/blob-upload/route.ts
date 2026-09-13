import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

/**
 * POST /api/skidmarks/blob-upload — the one shared token-issuing route
 * behind every *client-side, direct-to-Blob* upload this feature makes:
 * the attached MP3's own audio bytes (`lib/mp3Blob.ts`, "play survives a
 * refresh"), a finished song's full archive snapshot
 * (`lib/skidmarksArchive.ts`, "Archive" → the bottom song shelf), and
 * (2026-09-14) a plate still's own image bytes (`lib/plateStillBlob.ts`
 * — the fix for the live session's Neon PUT 413'ing once a few real
 * stills pushed it past Vercel's Function-body cap; see that module's
 * own doc comment).
 *
 * **Why client-side-direct, not a normal POST to a Next.js route
 * (the pattern every *other* Skidmarks upload in this app uses —
 * `generate-still`/`generate-clip` both take a `data:` URL inside a
 * plain JSON body)**: both of these payloads can be genuinely large — a
 * real song-length MP3 is several MB, and an archive snapshot embeds
 * every plate still as a `data:` URL, which can add up to several more.
 * Vercel enforces a **hard 4.5MB cap on a Function's own request body**
 * (see `lib/audioCompression.ts`'s module doc comment for the exact
 * docs/sources — this app already hit that cap once, for the
 * transcription upload). `@vercel/blob/client`'s `upload()` sidesteps it
 * entirely: the actual bytes go straight from the browser to Blob's own
 * storage endpoint, never through this (or any) serverless function —
 * this route's only job is issuing the short-lived client token
 * `upload()` needs first, which is itself a tiny JSON round trip. This
 * is exactly the "upload directly to storage instead of through the
 * function" option `lib/audioCompression.ts`'s doc comment flagged as
 * out-of-scope back when no Blob store was provisioned for this
 * project yet — it is now (clip-render persistence already uses it),
 * so this is that fix, applied where it was always the right shape.
 *
 * **Scoped to this feature's own two pathname prefixes only** —
 * `skidmarks/mp3-audio/` and `skidmarks/archive/` — so a client token
 * minted here can never be used to write anywhere else in this
 * project's Blob store (e.g. `skidmarks/clip-renders/`, which only the
 * server-side `generate-clip` route ever writes to). `allowOverwrite:
 * true` mirrors the "one live artifact per stable pathname" pattern
 * `lib/clipRenderBlob.ts` already uses for renders — a re-attached MP3
 * or a re-archived song simply replaces its own prior upload rather
 * than accumulating orphaned blobs under a fresh random suffix.
 *
 * **Never claims to be configured when it isn't**: if no Blob store is
 * connected (`BLOB_READ_WRITE_TOKEN` unset), `handleUpload` itself
 * throws before ever contacting Blob — caught below and returned as a
 * plain `400` with a real message, which `lib/mp3Blob.ts`/
 * `lib/skidmarksArchive.ts` surface as an honest "not saved this time"
 * outcome, never a silent success.
 */
export const runtime = "nodejs";

const ALLOWED_PATHNAME_PREFIXES = ["skidmarks/mp3-audio/", "skidmarks/archive/", "skidmarks/plate-stills/"];

function isAllowedPathname(pathname: string): boolean {
  if (pathname.includes("..") || pathname.includes("\\")) return false;
  return ALLOWED_PATHNAME_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!isAllowedPathname(pathname)) {
          throw new Error(
            `Rejected upload target "${pathname}" \u2014 this route only issues tokens for this feature's own ` +
              "mp3-audio/archive pathnames."
          );
        }
        return {
          allowedContentTypes: [
            "audio/mpeg",
            "audio/mp3",
            "audio/wav",
            "audio/x-wav",
            "application/json",
            "image/jpeg",
            "image/png",
            "image/webp",
          ],
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not generate an upload token." },
      { status: 400 }
    );
  }
}
