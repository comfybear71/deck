import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  buildClipRenderPlatePrefix,
  CLIP_RENDER_PATH_PREFIX,
  isSafeSegmentId,
  parseClipRenderPathname,
} from "@/lib/clipRenderBlob";

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
 *
 * **Returns at most one render per `(segmentId, plateId)`, always the
 * most recently uploaded one** — a defensive de-dupe on top of
 * `app/api/skidmarks/generate-clip/route.ts`'s own write-time cleanup
 * (`pruneStaleRendersForPlate`), not a replacement for it: that cleanup
 * is best-effort (a failed `del()` there doesn't fail the render), so
 * this route still has to cope with two blobs occasionally sitting
 * under the same plate's prefix rather than assuming the write side
 * always left exactly one. Picking `uploadedAt`'s max is what actually
 * satisfies "the shelf/tick shows the latest take" even on that rarer
 * path — never an arbitrary one Blob's `list()` ordering happened to
 * return.
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
    // `(segmentId, plateId)` \u2014 keyed exactly like `lib/clipRenders.ts`'s
    // client-side `persistedRenderKey` \u2014 mapped to the latest-uploaded
    // blob seen for that plate so far, so two blobs ever sitting under
    // the same plate's prefix (the write-time cleanup is best-effort,
    // not a hard guarantee) still resolve to a single, correct "latest
    // render" per plate rather than whichever one `list()` happened to
    // return last.
    const latestByPlate = new Map<string, { blob: (typeof blobs)[number]; parsed: NonNullable<ReturnType<typeof parseClipRenderPathname>> }>();
    for (const blob of blobs) {
      const parsed = parseClipRenderPathname(blob.pathname);
      if (!parsed || !segmentIdSet.has(parsed.segmentId)) continue;
      const key = `${parsed.segmentId}:${parsed.plateId}`;
      const existing = latestByPlate.get(key);
      if (!existing || blob.uploadedAt > existing.blob.uploadedAt) {
        latestByPlate.set(key, { blob, parsed });
      }
    }
    const renders: ClipRenderListItem[] = Array.from(latestByPlate.values()).map(({ blob, parsed }) => ({
      segmentId: parsed.segmentId,
      plateId: parsed.plateId,
      url: blob.url,
      filename: parsed.filename,
      clipIndex: parsed.clipIndex,
      startSec: parsed.startSec,
      endSec: parsed.endSec,
    }));
    return NextResponse.json({ configured: true, renders });
  } catch (err) {
    return NextResponse.json({
      configured: false,
      renders: [],
      error: err instanceof Error ? err.message : "Vercel Blob is not configured.",
    });
  }
}

/**
 * DELETE /api/skidmarks/clip-renders?segmentId=...&plateId=... \u2014
 * Stuart's explicit "remove old MP4s from the shelf" ask, live-QA'd
 * alongside the overwrite/de-dupe fixes above: he needed a way to clear
 * a render he no longer wants *without* touching that plate's still,
 * shot prompt, or motion text \u2014 those all live in `localStorage` via
 * `lib/skidmarks.ts`, entirely separate from this Blob-only prefix, so
 * deleting every blob under `buildClipRenderPlatePrefix(segmentId,
 * plateId)` can never touch them.
 *
 * Deletes **every** blob under this one plate's own prefix, not just
 * whichever the last `GET` happened to report \u2014 the same real gap
 * `pruneStaleRendersForPlate` (`app/api/skidmarks/generate-clip/
 * route.ts`) exists to prevent applies here too: if a stale sibling
 * ever did slip through, "Remove" has to actually clear it, not leave
 * an orphan that reappears on the next refresh.
 *
 * Honest outcomes, no exceptions swallowed into a fake success:
 * `{ deleted: true }` only when the delete call actually ran (including
 * the case where there was nothing to delete \u2014 removing an
 * already-gone render is not an error); `{ deleted: false, error }`
 * (still HTTP 200, matching this route's own `GET` honesty shape) when
 * Blob isn't configured or the delete itself failed, so the UI can
 * report a real failure instead of silently pretending the render is
 * gone when it might not be.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const segmentId = (url.searchParams.get("segmentId") ?? "").trim();
  const plateId = (url.searchParams.get("plateId") ?? "").trim();

  if (!isSafeSegmentId(segmentId) || !isSafeSegmentId(plateId)) {
    return NextResponse.json(
      {
        error: "Missing or invalid `segmentId`/`plateId`.",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }

  try {
    const { blobs } = await list({ prefix: buildClipRenderPlatePrefix(segmentId, plateId) });
    if (blobs.length > 0) {
      await del(blobs.map((b) => b.pathname));
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({
      deleted: false,
      error: err instanceof Error ? err.message : "Vercel Blob is not configured.",
    });
  }
}
