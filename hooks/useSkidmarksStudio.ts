"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { analyzeVocalActivity } from "@/lib/audioAnalysis";
import { transcribeAudio } from "@/lib/transcription";
import {
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
  markSkidmarksTranscriptionFailed,
  markSkidmarksTranscriptionUnconfigured,
  removeSkidmarksBand,
  removeSkidmarksMember,
  renameSkidmarksMember,
  selectSkidmarksBand,
  selectSkidmarksProjectKind,
  setSkidmarksBandCoverImage,
  setSkidmarksMemberAvatarImage,
  setSkidmarksMp3Duration,
  setSkidmarksSegmentShotPrompt,
  setSkidmarksSegmentStill,
  subscribeSkidmarks,
  type SkidmarksLook,
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

  /** Sets/replaces (`still` non-null) or clears (`still: null`) a clip's
   * plate still — see `setSkidmarksSegmentStill`'s doc comment. Actually
   * calling xAI's Grok Imagine API (`lib/plateGeneration.ts`) happens in
   * `SkidmarksClipStub` itself, not here — this store setter only ever
   * commits whichever result (an uploaded photo, a generated still, or a
   * clear) the component already resolved. */
  const setSegmentStill = useCallback(
    (segmentId: string, still: SkidmarksPlateStill | null) => setSkidmarksSegmentStill(segmentId, still),
    []
  );

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
    setSegmentStill,
  };
}
