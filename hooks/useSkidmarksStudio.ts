"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { analyzeVocalActivity } from "@/lib/audioAnalysis";
import {
  addSkidmarksLook,
  addSkidmarksMember,
  applySkidmarksAnalysisResult,
  attachSkidmarksMp3,
  clearSkidmarksMp3,
  createMp3Attachment,
  createSkidmarksBand,
  getSkidmarksSnapshot,
  markSkidmarksAnalysisFailed,
  removeSkidmarksBand,
  removeSkidmarksMember,
  renameSkidmarksMember,
  selectSkidmarksBand,
  selectSkidmarksProjectKind,
  setSkidmarksBandCoverImage,
  setSkidmarksMemberAvatarImage,
  setSkidmarksMp3Duration,
  setSkidmarksSegmentCameraAngle,
  setSkidmarksSegmentModel,
  setSkidmarksSegmentPlate,
  subscribeSkidmarks,
  type SkidmarksCameraAngleId,
  type SkidmarksLook,
  type SkidmarksModelId,
  type SkidmarksPlateId,
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
 * Also owns the one piece of real side-effecting logic this flow needs:
 * kicking off `analyzeVocalActivity` (`lib/audioAnalysis.ts`) against the
 * just-attached file, and writing its result (or failure) back to the
 * store once it settles. `analysisTokenRef` is a generation counter, not
 * a timer id — it exists so a slow analysis for a file the user has
 * since removed or replaced can't land its result on top of whatever's
 * current; every `attachMp3`/`removeMp3` bumps it, and any in-flight
 * analysis whose captured token no longer matches just gets dropped.
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
   * Attach a picked MP3 `File` and kick off real vocal/instrumental
   * analysis against it in the background. The store gets the seed-
   * fallback attachment immediately (so the card/checklist render right
   * away), then either `applySkidmarksAnalysisResult` (success) or
   * `markSkidmarksAnalysisFailed` (any rejection — unsupported browser,
   * bad decode, or the analysis's own timeout) once it settles.
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
  }, []);

  const removeMp3 = useCallback(() => {
    analysisTokenRef.current += 1; // invalidate any in-flight analysis
    clearSkidmarksMp3();
  }, []);

  const setMp3Duration = useCallback(
    (durationSec: number) => setSkidmarksMp3Duration(durationSec),
    []
  );

  const setSegmentModel = useCallback(
    (segmentId: string, model: SkidmarksModelId) => setSkidmarksSegmentModel(segmentId, model),
    []
  );
  const setSegmentPlate = useCallback(
    (segmentId: string, plateId: SkidmarksPlateId) => setSkidmarksSegmentPlate(segmentId, plateId),
    []
  );
  const setSegmentCameraAngle = useCallback(
    (segmentId: string, cameraAngle: SkidmarksCameraAngleId) =>
      setSkidmarksSegmentCameraAngle(segmentId, cameraAngle),
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
    setSegmentModel,
    setSegmentPlate,
    setSegmentCameraAngle,
  };
}
