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
  getSkidmarksSessionSyncSnapshot,
  getSkidmarksSnapshot,
  markSkidmarksAnalysisFailed,
  markSkidmarksMp3AudioFailed,
  markSkidmarksMp3AudioUnconfigured,
  markSkidmarksSessionArchived,
  markSkidmarksTranscriptionFailed,
  markSkidmarksTranscriptionUnconfigured,
  nudgeSkidmarksSegmentEnd,
  nudgeSkidmarksSegmentStart,
  removeSkidmarksBand,
  removeSkidmarksClipPlate,
  removeSkidmarksMember,
  renameSkidmarksBand,
  renameSkidmarksMember,
  resetSkidmarksSessionAfterArchive,
  restoreSkidmarksArchivedSession,
  selectSkidmarksBand,
  selectSkidmarksProjectKind,
  setSkidmarksBandCoverImage,
  setSkidmarksClipPlateLastSent,
  setSkidmarksClipPlateMotionPrompt,
  setSkidmarksClipPlateStill,
  setSkidmarksMemberAvatarImage,
  setSkidmarksMp3AudioUrl,
  setSkidmarksMp3Duration,
  setSkidmarksScriptSequence,
  setSkidmarksScriptSequenceDraft,
  setSkidmarksSegmentInstrumentalVideoModel,
  setSkidmarksSegmentSelectedPlate,
  setSkidmarksSegmentShotPrompt,
  subscribeSkidmarks,
  subscribeSkidmarksSessionSync,
  type SkidmarksBand,
  type SkidmarksClipSegment,
  type SkidmarksClipSentPayload,
  type SkidmarksInstrumentalVideoModel,
  type SkidmarksLook,
  type SkidmarksMp3Attachment,
  type SkidmarksPlateStill,
  type SkidmarksProjectKind,
  type SkidmarksScriptSequenceDraft,
  type SkidmarksSessionSyncState,
  type SkidmarksState,
} from "@/lib/skidmarks";

const EMPTY_STATE: SkidmarksState = {
  bands: [],
  session: { projectKind: null, bandId: null, mp3: null, scriptSequenceDraft: null },
  removedSeedBandIds: [],
};

const LOADING_SESSION_SYNC_STATE: SkidmarksSessionSyncState = { status: "loading" };

/**
 * React binding for the Skidmarks Music-video studio store
 * (`lib/skidmarks.ts`) — same `useSyncExternalStore` shape as
 * `useDialModes`/the old `useSkidmarksProjects`, so SSR always sees the
 * empty state and the client re-renders with whatever Neon's `GET /api/
 * skidmarks/session` returns right after the store's one-time hydrate
 * (see `lib/skidmarks.ts`'s "Neon-backed session persistence" doc
 * comment — `localStorage` is gone outright as this feature's state of
 * record now).
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
 *
 * `sessionSync` is a second, independent `useSyncExternalStore` binding
 * onto `lib/skidmarks.ts`'s ephemeral Neon round-trip status (never
 * part of `state`, never persisted) — exposed so `SkidmarksDetailSheet`
 * can show an honest "not saving here right now" line instead of
 * silently implying every edit is durable.
 */
export function useSkidmarksStudio() {
  const state = useSyncExternalStore(
    subscribeSkidmarks,
    getSkidmarksSnapshot,
    () => EMPTY_STATE
  );
  const sessionSync = useSyncExternalStore(
    subscribeSkidmarksSessionSync,
    getSkidmarksSessionSyncSnapshot,
    () => LOADING_SESSION_SYNC_STATE
  );

  /* The `persistFailure` and `storageWarning` subscriptions that used
   * to sit here are gone — they reported on `localStorage` quota, and
   * `persist()` no longer writes to `localStorage` (see
   * `lib/skidmarks.ts`). `sessionSync` above covers the same need
   * against the store that actually exists now. */

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
  const renameBand = useCallback(
    (bandId: string, name: string) => renameSkidmarksBand(bandId, name),
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
   *
   * Every one of these resolve callbacks is passed this attach's own
   * `mp3.attachId` and the store itself (`lib/skidmarks.ts`) re-checks
   * it against `session.mp3.attachId` before applying anything — the
   * durable, real guard against a slow real-API result landing on a
   * *different* attach later. `analysisTokenRef` below is kept as a
   * cheap same-instance early-bail (skips even building the result),
   * but it is **not** the safety guarantee: it lives on this hook
   * instance and is orphaned the moment `SkidmarksDetailSheet` unmounts
   * (closing the sheet — `GraphView`'s `{openNode && ... &&
   * <SkidmarksDetailSheet />}`), while any promise already in flight
   * keeps running and would otherwise still land on whatever's live
   * after a reopen. See `SkidmarksMp3Attachment.attachId`'s doc comment.
   */
  const attachMp3 = useCallback((file: File) => {
    const token = (analysisTokenRef.current += 1);
    const mp3 = createMp3Attachment(file.name, null);
    const attachId = mp3.attachId;
    attachSkidmarksMp3(mp3);

    // Real, client-side-direct-to-Blob upload of the audio itself (see
    // `lib/mp3Blob.ts`'s doc comment) — the fix for "play survives a
    // refresh." Runs in the background alongside analysis/
    // transcription; a slow or failed upload never blocks anything else
    // about this attach.
    uploadSkidmarksMp3Audio(file).then((outcome) => {
      if (analysisTokenRef.current !== token) return; // superseded — drop it
      if (outcome.ok) {
        setSkidmarksMp3AudioUrl(attachId, outcome.url);
      } else if (outcome.unconfigured) {
        markSkidmarksMp3AudioUnconfigured(attachId, outcome.message);
      } else {
        markSkidmarksMp3AudioFailed(attachId, outcome.message);
      }
    });

    analyzeVocalActivity(file).then(
      (result) => {
        if (analysisTokenRef.current !== token) return; // superseded — drop it
        applySkidmarksAnalysisResult(attachId, result);
      },
      (err: unknown) => {
        if (analysisTokenRef.current !== token) return;
        const message = err instanceof Error ? err.message : "Vocal analysis failed.";
        markSkidmarksAnalysisFailed(attachId, message);
      }
    );

    transcribeAudio(file).then((outcome) => {
      if (analysisTokenRef.current !== token) return; // superseded — drop it
      if (outcome.ok) {
        applySkidmarksTranscriptionResult(
          attachId,
          outcome.result.words,
          outcome.result.durationSec,
          outcome.result.provider
        );
      } else if (outcome.unconfigured) {
        markSkidmarksTranscriptionUnconfigured(attachId, outcome.message);
      } else {
        markSkidmarksTranscriptionFailed(attachId, outcome.message);
      }
    });
  }, []);

  const removeMp3 = useCallback(() => {
    analysisTokenRef.current += 1; // invalidate any in-flight analysis
    clearSkidmarksMp3();
  }, []);

  const setMp3Duration = useCallback(
    (attachId: string, durationSec: number) => setSkidmarksMp3Duration(attachId, durationSec),
    []
  );

  const setSegmentShotPrompt = useCallback(
    (segmentId: string, shotPrompt: string) => setSkidmarksSegmentShotPrompt(segmentId, shotPrompt),
    []
  );

  /** The compact −1s/+1s stepper's own handlers — see
   * `nudgeSkidmarksSegmentStart`/`nudgeSkidmarksSegmentEnd`'s doc
   * comments. Stuart's 2026-09-13 ask: ElevenLabs Scribe timing is
   * "mostly right but sometimes 3-4 seconds off," so he wants to slip a
   * clip's start/end after transcription — never a re-run of Scribe or
   * the energy heuristic, just a local edit to the already-resolved
   * segment times. */
  const nudgeSegmentStart = useCallback(
    (segmentId: string, deltaSec: number) => nudgeSkidmarksSegmentStart(segmentId, deltaSec),
    []
  );
  const nudgeSegmentEnd = useCallback(
    (segmentId: string, deltaSec: number) => nudgeSkidmarksSegmentEnd(segmentId, deltaSec),
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

  /** Stuart's "paste a script, get a real timeline" automation
   * (2026-09-14) — wholesale-replaces the active song's clip list with
   * a parsed script sequence's segments. See
   * `setSkidmarksScriptSequence`'s doc comment. */
  const setScriptSequence = useCallback(
    (segments: SkidmarksClipSegment[]) => setSkidmarksScriptSequence(segments),
    []
  );

  /** The script-sequence panel's own persisted draft (pasted text + clip
   * 1's starting image) — see `setSkidmarksScriptSequenceDraft`'s doc
   * comment. */
  const setScriptSequenceDraft = useCallback(
    (draft: SkidmarksScriptSequenceDraft | null) => setSkidmarksScriptSequenceDraft(draft),
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

  /** What a plate's render just sent — see `SkidmarksClipSentPayload`. */
  const setClipPlateLastSent = useCallback(
    (segmentId: string, plateId: string, sent: SkidmarksClipSentPayload) =>
      setSkidmarksClipPlateLastSent(segmentId, plateId, sent),
    []
  );

  /** The H3/Grok switch inside `SkidmarksClipRender`'s Render confirm —
   * see `setSkidmarksSegmentInstrumentalVideoModel`'s doc comment. */
  const setClipInstrumentalModel = useCallback(
    (segmentId: string, model: SkidmarksInstrumentalVideoModel) =>
      setSkidmarksSegmentInstrumentalVideoModel(segmentId, model),
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

  /** Right after a successful Archive that left the desk alone — records
   * that the live song is now on the shelf unchanged, so leaving it
   * later doesn't upload the same checkpoint twice. */
  const markSessionArchived = useCallback((attachId: string, fingerprint: string) => {
    markSkidmarksSessionArchived(attachId, fingerprint);
  }, []);

  return {
    bands: state.bands,
    session: state.session,
    removedSeedBandIds: state.removedSeedBandIds,
    /** The live Neon session round-trip status — see this hook's doc
     * comment and `lib/skidmarks.ts`'s `SkidmarksSessionSyncState`. */
    sessionSync,
    selectProjectKind,
    selectBand,
    createBand,
    removeBand,
    addMember,
    removeMember,
    renameMember,
    renameBand,
    setBandCoverImage,
    setMemberAvatarImage,
    addLook,
    attachMp3,
    removeMp3,
    setMp3Duration,
    setSegmentShotPrompt,
    nudgeSegmentStart,
    nudgeSegmentEnd,
    setClipPlateStill,
    setScriptSequence,
    setScriptSequenceDraft,
    addClipPlate,
    removeClipPlate,
    selectClipPlate,
    setClipPlateMotionPrompt,
    setClipPlateLastSent,
    setClipInstrumentalModel,
    restoreArchivedSession,
    clearSessionAfterArchive,
    markSessionArchived,
  };
}
