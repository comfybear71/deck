import { list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { buildMp3AudioPathname, isSafeMp3AudioId, MP3_AUDIO_PATH_PREFIX } from "@/lib/mp3AudioPath";

/**
 * GET /api/skidmarks/mp3-audio?audioId=... — looks up the attached
 * MP3's own durable audio Blob, if it exists, by a live `list()` call.
 *
 * **Why this route exists at all, instead of just persisting the Blob
 * URL `lib/mp3Blob.ts`'s `uploadSkidmarksMp3Audio` already returns**:
 * Stuart's hard lock is that nothing about the attached MP3 — including
 * its audio — may depend on `localStorage` for durability.
 * `lib/skidmarks.ts`'s session store is still `localStorage`-mirrored
 * (pre-existing debt, out of scope to fully migrate here — see
 * AGENTS.md), so writing the real playable URL into that object would
 * have quietly made "can Stuart hear his song after a refresh" depend
 * on `localStorage` surviving intact, exactly what he's ruling out.
 * This route is what lets `SkidmarksMp3Attachment` carry only a small,
 * inert `audioId` routing key instead — the actual answer to "is this
 * audio really there, and where" always comes from a fresh Blob call,
 * mirroring `app/api/skidmarks/clip-renders/route.ts`'s exact same
 * "never trust a cached copy" shape for clip renders.
 *
 * **Never claims to be live without Blob actually being configured**,
 * same honest shape as every other real backend this app calls: no
 * `BLOB_READ_WRITE_TOKEN` (or no Blob store connected at all) makes
 * `list()` throw, which this route turns into
 * `{ configured: false, url: null }` — not a 500, and not a silent
 * empty answer pretending everything's fine. A genuinely-not-uploaded-
 * yet id (Blob *is* configured, nothing found) is the distinct, real
 * `{ configured: true, url: null }` answer — not a failure either.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const audioId = url.searchParams.get("audioId") ?? "";

  if (!isSafeMp3AudioId(audioId)) {
    return NextResponse.json(
      { error: "Missing or invalid `audioId`.", code: "invalid_request" },
      { status: 400 }
    );
  }

  const pathname = buildMp3AudioPathname(audioId);

  try {
    const { blobs } = await list({ prefix: `${MP3_AUDIO_PATH_PREFIX}${audioId}` });
    const match = blobs.find((b) => b.pathname === pathname);
    return NextResponse.json({ configured: true, url: match?.url ?? null });
  } catch (err) {
    return NextResponse.json({
      configured: false,
      url: null,
      error: err instanceof Error ? err.message : "Vercel Blob is not configured.",
    });
  }
}
