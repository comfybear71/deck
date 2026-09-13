import { list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { CLIP_RENDER_PATH_PREFIX, isSafeSegmentId, parseClipRenderPathname } from "@/lib/clipRenderBlob";

/**
 * GET /api/skidmarks/clip-renders?segmentIds=a,b,c — looks up every
 * currently-persisted clip render (see `app/api/skidmarks/generate-
 * clip/route.ts`'s module doc comment for how/why a render lands in
 * Vercel Blob in the first place) for the given clip ids in one call.
 *
 * **Why this exists as its own route, separate from `generate-clip`**:
 * `components/SkidmarksClipTimeline.tsx` needs to know, for *every*
 * clip on the timeline — not just whichever one is currently expanded —
 * whether it already has a saved render, so "show it after refresh"
 * works for the timeline's own "Download all rendered clips" bundle
 * button too, not only inside an already-open clip panel. That's a
 * plain read, with no xAI call and no cost implication at all, so it
 * gets its own lightweight `GET` rather than piggybacking on the real,
 * paid `POST /api/skidmarks/generate-clip`.
 *
 * Lists the whole `skidmarks/clip-renders/` prefix once (cheap — this
 * is a single-user/single-band app's worth of small video blobs, nowhere
 * near Blob's 1000-per-call default page size) rather than one `list()`
 * call per segment id, then filters in memory to the ids actually asked
 * for.
 *
 * **Never claims to be live without Blob actually being configured**,
 * same honest shape as every other real backend this app calls (see
 * AGENTS.md's "Env vars" section): no `BLOB_READ_WRITE_TOKEN` (or no
 * Blob store connected at all) makes `list()` throw, which this route
 * turns into `{ configured: false, renders: [] }` — not a 500, and not
 * a silent empty list pretending everything's fine.
 */
export const runtime = "nodejs";

export interface ClipRenderListItem {
  segmentId: string;
  /** Which plate slot within `segmentId`'s strip this render belongs to
   * — a clip's plates now render (and persist) independently, so a
   * render is only ever really identified by the pair, not `segmentId`
   * alone. See `lib/clipRenderBlob.ts`'s module doc comment. */
  plateId: string;
  url: string;
  /** The exact basename this render is stored under — already lettered
   * (`01a_...`) if this clip had more than one plate at render time.
   * Trusting the stored basename here means a listing never has to
   * re-derive the right filename from `clipIndex` alone. */
  filename: string;
  clipIndex: number;
  startSec: number;
  endSec: number;
}

function parseSegmentIdsParam(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(isSafeSegmentId)
    )
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const segmentIds = parseSegmentIdsParam(url.searchParams.get("segmentIds"));

  if (segmentIds.length === 0) {
    return NextResponse.json(
      {
        error: "Missing or invalid `segmentIds` \u2014 expected a comma-separated list of clip ids.",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }

  const segmentIdSet = new Set(segmentIds);

  try {
    const { blobs } = await list({ prefix: CLIP_RENDER_PATH_PREFIX });
    const renders: ClipRenderListItem[] = [];
    for (const blob of blobs) {
      const parsed = parseClipRenderPathname(blob.pathname);
      if (!parsed || !segmentIdSet.has(parsed.segmentId)) continue;
      renders.push({
        segmentId: parsed.segmentId,
        plateId: parsed.plateId,
        url: blob.url,
        filename: parsed.filename,
        clipIndex: parsed.clipIndex,
        startSec: parsed.startSec,
        endSec: parsed.endSec,
      });
    }
    return NextResponse.json({ configured: true, renders });
  } catch (err) {
    return NextResponse.json({
      configured: false,
      renders: [],
      error: err instanceof Error ? err.message : "Vercel Blob is not configured.",
    });
  }
}
