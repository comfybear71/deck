"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { analyzeVocalActivity } from "@/lib/audioAnalysis";
import { transcribeAudio } from "@/lib/transcription";
import { uploadSkidmarksMp3Audio } from "@/lib/mp3Blob";
import {
  addSkidmarksClipPlate,
  addSkidmarksLook,
  addSkidmarksMember,
  applySkidmarksAnalysisResult,
  applySkidmarksTranscriptionResult,
  attachSkidmarksMp3,
  clearSkidmarksMp3,
  createMp3Attachment,
  createSkidmarksBand,
  getSkidmarksSnapshot,
  markSkidmarksAnalysisFailed,
  markSkidmarksMp3AudioFailed,
  markSkidmarksMp3AudioUnconfigured,
  markSkidmarksTranscriptionFailed,
  markSkidmarksTranscriptionUnconfigured,
  removeSkidmarksBand,
  removeSkidmarksClipPlate,
  removeSkidmarksMember,
  renameSkidmarksMember,
  resetSkidmarksSessionAfterArchive,
  restoreSkidmarksArchivedSession,
  selectSkidmarksBand,
  selectSkidmarksProjectKind,
  setSkidmarksBandCoverImage,
  setSkidmarksClipPlateMotionPrompt,
  setSkidmarksClipPlateStill,
  setSkidmarksMemberAvatarImage,
  setSkidmarksMp3AudioUrl,
  setSkidmarksMp3Duration,
  setSkidmarksSegmentSelectedPlate,
  setSkidmarksSegmentShotPrompt,
  subscribeSkidmarks,
  type SkidmarksBand,
  type SkidmarksLook,
  type SkidmarksMp3Attachment,
  type SkidmarksPlateStill,
  type SkidmarksProjectKind,
  type SkidmarksState,
} from "@/lib/skidmarks";

const EMPTY_STATE: SkidmarksState = {
  bands: [],
  session: { projectKind: null, bandId: null, mp3: null },
  removedSeedBandIds: [],
};

/**
 * React binding for the Skidmarks Music-video studio store
 * (`lib/skidmarks.ts`) — same `useSyncExternalStore` shape as
 * `useDialModes`/the old `useSkidmarksProjects`, so SSR always sees the
 * empty state and the client re-renders with whatever's in
 * `localStorage` right after hydration.
 *
 * Also owns the real side-effecting logic this flow needs: kicking off
 * both `analyzeVocalActivity` (`lib/audioAnalysis.ts`, the energy
 * heuristic) *and* `transcribeAudio` (`lib/transcription.ts`, real
 * word-level STT) against the just-attached file **in parallel**, and
 * writing whichever settles back to the store as it happens —
 * transcription always wins over the heuristic once it lands, per
 * `lib/skidmarks.ts`'s priority order, regardless of which finishes
 * first. `analysisTokenRef` is a generation counter, not a timer id —
 * it exists so a slow result for a file the user has since removed or
 * replaced can't land on top of whatever's current; every
 * `attachMp3`/`removeMp3` bumps it, and any in-flight analysis or
 * transcription whose captured token no longer matches just gets
 * dropped.
 */
export function useSkidmarksStudio() {
  const state = useSyncExternalStore(
    subscribeSkidmarks,
    getSkidmarksSnapshot,
    () => EMPTY_STATE
  );

  const analysisTokenRef = useRef(0);

  const selectProjectKind = useCallback(
    (kind: SkidmarksProjectKind) => selectSkidmarksProjectKind(kind),
    []
  );
  const selectBand = useCallback((bandId: string) => selectSkidmarksBand(bandId), []);
  const createBand = useCallback(() => createSkidmarksBand(), []);
  const removeBand = useCallback(
    (bandId: string) => {
      // Deleting the active band drops its MP3 too — invalidate any
      // in-flight analysis so a late result can't land on a session that
      // no longer exists.
      if (state.session.bandId === bandId) analysisTokenRef.current += 1;
      removeSkidmarksBand(bandId);
    },
    [state.session.bandId]
  );
  const addMember = useCallback((bandId: string) => addSkidmarksMember(bandId), []);
  const removeMember = useCallback(
    (bandId: string, memberId: string) => removeSkidmarksMember(bandId, memberId),
    []
  );
  const renameMember = useCallback(
    (bandId: string, memberId: string, name: string) =>
      renameSkidmarksMember(bandId, memberId, name),
    []
  );
  const setBandCoverImage = useCallback(
    (bandId: string, dataUrl: string) => setSkidmarksBandCoverImage(bandId, dataUrl),
    []
  );
  const setMemberAvatarImage = useCallback(
    (bandId: string, memberId: string, dataUrl: string) =>
      setSkidmarksMemberAvatarImage(bandId, memberId, dataUrl),
    []
  );
  const addLook = useCallback(
    (bandId: string, memberId: string, look: SkidmarksLook) =>
      addSkidmarksLook(bandId, memberId, look),
    []
  );

  /**
   * Attach a picked MP3 `File` and kick off both real signals against it
   * in the background, in parallel: `analyzeVocalActivity` (the energy
   * heuristic, no key needed) and `transcribeAudio` (real word-level
   * STT, needs `ELEVENLABS_API_KEY` (or `ELEVEN_LABS_API_KEY`) set
   * server-side — see `app/api/skidmarks/transcribe/route.ts`; there is
   * no other-provider fallback, only the energy heuristic below). The
   * store gets the
   * seed-fallback attachment immediately (so the card/checklist render
   * right away), then each signal writes back independently as it
   * settles — `applySkidmarksAnalysisResult`/`markSkidmarksAnalysisFailed`
   * for the heuristic, `applySkidmarksTranscriptionResult`/
   * `markSkidmarksTranscriptionUnconfigured`/
   * `markSkidmarksTranscriptionFailed` for transcription. A *useful*
   * transcription result always wins over the heuristic once it lands
   * (see `lib/skidmarks.ts`'s `applySkidmarksTranscriptionResult` —
   * "useful" meaning it clears `hasUsefulVocalCoverage`, not just "a
   * provider returned words"), so it doesn't matter which of the two
   * `.then()`s below actually runs first.
   */
  const attachMp3 = useCallback((file: File) => {
    const token = (analysisTokenRef.current += 1);
    attachSkidmarksMp3(createMp3Attachment(file.name, null));

    // Real, client-side-direct-to-Blob upload of the audio itself (see
    // `lib/mp3Blob.ts`'s doc comment) — the fix for "play survives a
    // refresh." Runs in the background alongside analysis/
    // transcription; a slow or failed upload never blocks anything else
    // about this attach.
    uploadSkidmarksMp3Audio(file).then((outcome) => {
      if (analysisTokenRef.current !== token) return; // superseded — drop it
      if (outcome.ok) {
        setSkidmarksMp3AudioUrl(outcome.url);
      } else if (outcome.unconfigured) {
        markSkidmarksMp3AudioUnconfigured(outcome.message);
      } else {
        markSkidmarksMp3AudioFailed(outcome.message);
      }
    });

    analyzeVocalActivity(file).then(
      (result) => {
        if (analysisTokenRef.current !== token) return; // superseded — drop it
        applySkidmarksAnalysisResult(result);
      },
      (err: unknown) => {
        if (analysisTokenRef.current !== token) return;
        const message = err instanceof Error ? err.message : "Vocal analysis failed.";
        markSkidmarksAnalysisFailed(message);
      }
    );

    transcribeAudio(file).then((outcome) => {
      if (analysisTokenRef.current !== token) return; // superseded — drop it
      if (outcome.ok) {
        applySkidmarksTranscriptionResult(
          outcome.result.words,
          outcome.result.durationSec,
          outcome.result.provider
        );
      } else if (outcome.unconfigured) {
        markSkidmarksTranscriptionUnconfigured(outcome.message);
      } else {
        markSkidmarksTranscriptionFailed(outcome.message);
      }
    });
  }, []);

  const removeMp3 = useCallback(() => {
    analysisTokenRef.current += 1; // invalidate any in-flight analysis
    clearSkidmarksMp3();
  }, []);

  const setMp3Duration = useCallback(
    (durationSec: number) => setSkidmarksMp3Duration(durationSec),
    []
  );

  const setSegmentShotPrompt = useCallback(
    (segmentId: string, shotPrompt: string) => setSkidmarksSegmentShotPrompt(segmentId, shotPrompt),
    []
  );

  /** Sets/replaces (`still` non-null) or clears (`still: null`) one plate
   * slot's still — see `setSkidmarksClipPlateStill`'s doc comment.
   * Actually calling xAI's Grok Imagine API (`lib/plateGeneration.ts`)
   * happens in `SkidmarksClipStub` itself, not here — this store setter
   * only ever commits whichever result (an uploaded photo, a generated
   * still, or a clear) the component already resolved. */
  const setClipPlateStill = useCallback(
    (segmentId: string, plateId: string, still: SkidmarksPlateStill | null) =>
      setSkidmarksClipPlateStill(segmentId, plateId, still),
    []
  );

  /** The "+" control — appends one more empty plate slot to a clip's
   * strip (`addSkidmarksClipPlate`'s doc comment covers the cap). */
  const addClipPlate = useCallback((segmentId: string) => addSkidmarksClipPlate(segmentId), []);

  /** Removes an empty plate slot outright — see
   * `removeSkidmarksClipPlate`'s doc comment for the "empty slot only,
   * never the last one" guard. */
  const removeClipPlate = useCallback(
    (segmentId: string, plateId: string) => removeSkidmarksClipPlate(segmentId, plateId),
    []
  );

  /** The corner select control on a filled plate tile — see
   * `setSkidmarksSegmentSelectedPlate`'s doc comment. */
  const selectClipPlate = useCallback(
    (segmentId: string, plateId: string) => setSkidmarksSegmentSelectedPlate(segmentId, plateId),
    []
  );

  /** This plate's own stored camera-motion direction — see
   * `setSkidmarksClipPlateMotionPrompt`'s doc comment. */
  const setClipPlateMotionPrompt = useCallback(
    (segmentId: string, plateId: string, motionPrompt: string) =>
      setSkidmarksClipPlateMotionPrompt(segmentId, plateId, motionPrompt),
    []
  );

  /** "Open in editor" on an archived song row — restores its band + mp3
   * snapshot into the live top workspace. Invalidates any in-flight
   * analysis/transcription/audio-upload for whatever was live before
   * (same "a late result can't land on a session that no longer
   * exists" guard `removeBand`/`removeMp3` already use). */
  const restoreArchivedSession = useCallback((band: SkidmarksBand, mp3: SkidmarksMp3Attachment) => {
    analysisTokenRef.current += 1;
    restoreSkidmarksArchivedSession(band, mp3);
  }, []);

  /** Right after a successful Archive — clears the live workspace back
   * to "choose a band," ready for a new/different song. Also
   * invalidates any in-flight analysis/transcription/audio-upload for
   * the just-archived session, same reasoning as `restoreArchivedSession`. */
  const clearSessionAfterArchive = useCallback(() => {
    analysisTokenRef.current += 1;
    resetSkidmarksSessionAfterArchive();
  }, []);

  return {
    bands: state.bands,
    session: state.session,
    removedSeedBandIds: state.removedSeedBandIds,
    selectProjectKind,
    selectBand,
    createBand,
    removeBand,
    addMember,
    removeMember,
    renameMember,
    setBandCoverImage,
    setMemberAvatarImage,
    addLook,
    attachMp3,
    removeMp3,
    setMp3Duration,
    setSegmentShotPrompt,
    setClipPlateStill,
    addClipPlate,
    removeClipPlate,
    selectClipPlate,
    setClipPlateMotionPrompt,
    restoreArchivedSession,
    clearSessionAfterArchive,
  };
}
