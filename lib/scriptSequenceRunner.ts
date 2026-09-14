/**
 * The "render all 16, one after another, automatically" orchestrator
 * behind Stuart's script-sequence automation (2026-09-14) — the actual
 * sequencing/stop-on-failure control flow, kept pure of any real
 * network/DOM call so it's fully unit-testable with fakes before ever
 * spending real money. `components/SkidmarksScriptSequencePanel.tsx`
 * supplies the real implementations (`generateSkidmarksClip`,
 * `uploadSkidmarksPlateStill`, `generatePlateStill`,
 * `setSkidmarksClipPlateStill`) as `deps`.
 *
 * **Frame carry is server-side now, not a `deps` function** (2026-09-14
 * — three separate live failures on Stuart's iPhone with the old
 * client-side `<video>`+`<canvas>` capture, `lib/videoFrame.ts`, now
 * removed — see `lib/serverVideoFrame.ts`'s module doc comment for the
 * full story). `renderClip`'s own outcome carries `lastFrameUrl`
 * straight from the server when extraction succeeded; the chaining step
 * below just reads it, rather than calling a separate extraction dep.
 *
 * **Stops on the first real failure — never keeps spending after
 * something's already broken.** Stuart explicitly asked for this to be
 * fully automatic (his own call, after I flagged the risk) — "fully
 * automatic" still doesn't mean "blind": a render that fails, or a
 * frame-chain that fails partway through, halts the whole run right
 * there rather than silently skipping ahead and burning more real money
 * on clips chained from nothing. `onProgress` reports every step either
 * way, live, so a caller can show exactly where it stopped and why.
 */

import { SKIDMARKS_SEGMENT_LABEL_META, type SkidmarksClipSegment, type SkidmarksMember, type SkidmarksPlateStill } from "./skidmarks";
import type { PersistedClipRender } from "./clipRenders";
import { buildClipGenerationRequest } from "./clipGeneration";

export interface ScriptSequenceRunnerDeps {
  /** Resolves any still's `dataUrl` (already-`data:`, or a real Blob
   * URL) into a guaranteed `data:` URL — same contract as
   * `lib/plateGeneration.ts`'s `resolvePlateReferenceDataUrl`. */
  resolveIdentityDataUrl: (dataUrl: string) => Promise<string>;
  /** Generates the very first clip's starting still from its own shot
   * prompt — nothing to chain from yet at clip 1. `vocal` picks the
   * same still-generation framing a manual Generate would for a
   * clip in that position (see `lib/plateGeneration.ts`'s
   * `buildPlateGenerationRequest`), and `vocalist` carries a locked
   * character's identity reference/hallmarks through when clip 1
   * itself turns out to be Vocal. */
  generateFirstStill: (
    shotPrompt: string,
    bandName: string,
    vocal: boolean,
    vocalist: SkidmarksMember | undefined
  ) => Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>;
  /** Uploads a still's bytes to durable storage — same contract as
   * `lib/plateStillBlob.ts`'s `uploadSkidmarksPlateStill`. */
  uploadStill: (dataUrl: string) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;
  /** Renders one clip — same contract as `lib/clipGeneration.ts`'s
   * `generateSkidmarksClip`, called with an already-built request.
   * `lastFrameUrl`, when present, is the render's own last frame
   * already extracted and saved server-side
   * (`app/api/skidmarks/generate-clip/route.ts`, `lib/
   * serverVideoFrame.ts`) — the chaining step below reads it directly
   * rather than calling out to a separate client-side extraction (see
   * this module's doc comment for why that old approach was removed). */
  renderClip: (request: ReturnType<typeof buildClipGenerationRequest>) => Promise<
    | { ok: true; videoUrl: string; persisted: boolean; persistError?: string; lastFrameUrl?: string }
    | { ok: false; message: string }
  >;
  /** Turns a persisted render's own `PersistedClipRender` shape (what
   * `renderClip` on success implies) — the runner builds this itself,
   * this dep just records it wherever the caller keeps the render shelf
   * (`addRender` in `SkidmarksDetailSheet.tsx`). */
  recordRender: (render: PersistedClipRender) => void;
  /** Writes a still onto a plate slot — same contract as
   * `lib/skidmarks.ts`'s `setSkidmarksClipPlateStill`. */
  setPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill) => void;
  onProgress?: (event: ScriptSequenceRunEvent) => void;
}

export type ScriptSequenceRunEvent =
  | { type: "generating-first-still" }
  | { type: "rendering"; clipIndex: number; clipCount: number; title?: string }
  | { type: "chaining"; clipIndex: number; clipCount: number }
  | { type: "clip-done"; clipIndex: number; clipCount: number };

export type ScriptSequenceRunOutcome =
  | { ok: true; renderedCount: number }
  | { ok: false; failedAtClipIndex: number; message: string; renderedCount: number };

const SCRIPT_SEQUENCE_DURATION_SEC = 15;

/**
 * Runs the whole sequence: generates clip 1's starting still if it
 * doesn't have one yet, then renders every segment in order, chaining
 * each render's closing frame into the next segment's plate before
 * moving on. Stops immediately on any real failure (first-still
 * generation, a render, or a chain-fill) — see this module's doc
 * comment. Never throws; every outcome, including a mid-run stop, comes
 * back as this function's own return value.
 *
 * **Vocal clips need the song's real audio** (`lib/skidmarks.ts`'s
 * `buildScriptSequenceSegments`/`resolveScriptPartVocal` already
 * decided which segments those are, off the song's own real
 * transcription — this function just trusts each segment's own
 * `label`). `mp3AudioUrl`/`vocalist` are only read for a segment that's
 * actually Vocal; a Vocal segment with no `mp3AudioUrl` available fails
 * that clip honestly rather than sending a request the server can't
 * fulfill.
 *
 * **`startAtClipIndex`** (default `0`) lets a caller resume an earlier,
 * partially-completed run at a real failure (a real live example,
 * 2026-09-14: xAI's own content-moderation rejecting one generated
 * clip, 12 of 16 already rendered fine) without re-spending on the
 * clips that already rendered — `i` stays each clip's real, absolute
 * position throughout (so progress events, filenames, and Blob
 * pathnames all still read correctly), the loop just starts partway
 * through, and the "generate clip 1's starting still" step is skipped
 * entirely whenever `startAtClipIndex > 0` (clip 1 already has one from
 * the original run). The caller is responsible for passing the *same*
 * `segments` array clips 1..`startAtClipIndex - 1` already rendered
 * into (`components/SkidmarksScriptSequencePanel.tsx`'s `handleResume`
 * reads it straight back off the stored session, not a fresh
 * `buildScriptSequenceSegments` call — a fresh build would mint new
 * segment/plate ids and have no starting stills at all).
 */
export async function runScriptSequence(
  segments: SkidmarksClipSegment[],
  bandName: string,
  deps: ScriptSequenceRunnerDeps,
  mp3AudioUrl: string | undefined,
  vocalist: SkidmarksMember | undefined,
  startAtClipIndex: number = 0
): Promise<ScriptSequenceRunOutcome> {
  const report = (event: ScriptSequenceRunEvent) => deps.onProgress?.(event);

  if (segments.length === 0) {
    return { ok: false, failedAtClipIndex: 0, message: "No clips to render.", renderedCount: 0 };
  }

  if (startAtClipIndex === 0) {
    const first = segments[0];
    const firstIsVocal = SKIDMARKS_SEGMENT_LABEL_META[first.label]?.vocal ?? false;
    if (!first.plates[0]?.still) {
      report({ type: "generating-first-still" });
      const stillOutcome = await deps.generateFirstStill(first.shotPrompt, bandName, firstIsVocal, vocalist);
      if (!stillOutcome.ok) {
        return { ok: false, failedAtClipIndex: 0, message: stillOutcome.message, renderedCount: 0 };
      }
      const uploadOutcome = await deps.uploadStill(stillOutcome.dataUrl);
      const firstStill: SkidmarksPlateStill = {
        dataUrl: uploadOutcome.ok ? uploadOutcome.url : stillOutcome.dataUrl,
        source: "generated",
        createdAt: Date.now(),
      };
      deps.setPlateStill(first.id, first.plates[0].id, firstStill);
      first.plates[0].still = firstStill; // so the loop below sees it immediately, without a store re-read
    }
  }

  for (let i = Math.max(0, Math.min(startAtClipIndex, segments.length)); i < segments.length; i++) {
    const segment = segments[i];
    const plate = segment.plates[0];
    const still = plate?.still;
    if (!plate || !still) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Clip ${i + 1} has no starting image to render from.`,
        renderedCount: i,
      };
    }

    report({ type: "rendering", clipIndex: i, clipCount: segments.length });

    const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label]?.vocal ?? false;
    if (vocal && !mp3AudioUrl) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Clip ${i + 1} lands on real singing in the song, so it needs to render as Vocal (LTX) — but no attached MP3 audio is available yet.`,
        renderedCount: i,
      };
    }

    const resolvedStillDataUrl = await deps.resolveIdentityDataUrl(still.dataUrl);
    const request = buildClipGenerationRequest({
      shotPrompt: segment.shotPrompt,
      bandName,
      plateStillDataUrl: resolvedStillDataUrl,
      durationSec: SCRIPT_SEQUENCE_DURATION_SEC,
      vocal,
      instrumentalVideoModel: vocal ? undefined : "grok",
      vocalist: vocal ? vocalist : undefined,
      mp3AudioUrl: vocal ? mp3AudioUrl : undefined,
      segmentId: segment.id,
      plateId: plate.id,
      plateIndex: 0,
      plateCount: 1,
      clipIndex: i,
      startSec: segment.startSec,
      endSec: segment.endSec,
    });

    const outcome = await deps.renderClip(request);
    if (!outcome.ok) {
      return { ok: false, failedAtClipIndex: i, message: outcome.message, renderedCount: i };
    }
    if (!outcome.persisted) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: outcome.persistError
          ? `Clip ${i + 1} rendered but couldn't be saved: ${outcome.persistError}`
          : `Clip ${i + 1} rendered but couldn't be saved.`,
        renderedCount: i,
      };
    }

    const render: PersistedClipRender = {
      segmentId: segment.id,
      plateId: plate.id,
      url: outcome.videoUrl,
      filename: `${String(i + 1).padStart(2, "0")}_${segment.startSec}-${segment.endSec}.mp4`,
      clipIndex: i,
      startSec: segment.startSec,
      endSec: segment.endSec,
      ...(outcome.lastFrameUrl ? { lastFrameUrl: outcome.lastFrameUrl } : {}),
    };
    deps.recordRender(render);
    report({ type: "clip-done", clipIndex: i, clipCount: segments.length });

    const nextSegment = segments[i + 1];
    if (!nextSegment) break; // last clip — nothing left to chain into

    const nextPlate = nextSegment.plates[0];
    if (!nextPlate || nextPlate.still) continue; // already has a still (shouldn't happen on a fresh build, but never overwrite it

    report({ type: "chaining", clipIndex: i, clipCount: segments.length });
    if (!outcome.lastFrameUrl) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Couldn't carry clip ${i + 1}'s last frame into clip ${i + 2}: the server couldn't capture this render's last frame.`,
        renderedCount: i + 1,
      };
    }
    // `outcome.lastFrameUrl` is already a durable Blob URL (server-side
    // extraction — see this module's doc comment) — no upload left to
    // do here, unlike a freshly-generated first still.
    const chainedStill: SkidmarksPlateStill = {
      dataUrl: outcome.lastFrameUrl,
      source: "chained",
      createdAt: Date.now(),
    };
    deps.setPlateStill(nextSegment.id, nextPlate.id, chainedStill);
    nextPlate.still = chainedStill; // so the next loop iteration sees it immediately, without a store re-read
  }

  return { ok: true, renderedCount: segments.length };
}
