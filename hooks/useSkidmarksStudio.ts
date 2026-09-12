"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  addSkidmarksLook,
  addSkidmarksMember,
  attachSkidmarksMp3,
  clearSkidmarksMp3,
  createSkidmarksBand,
  getSkidmarksSnapshot,
  markSkidmarksChecklistDone,
  removeSkidmarksMember,
  renameSkidmarksMember,
  selectSkidmarksBand,
  selectSkidmarksProjectKind,
  setSkidmarksBandCoverImage,
  setSkidmarksMemberAvatarImage,
  setSkidmarksMp3Duration,
  SKIDMARKS_CHECKLIST_DELAY_MS,
  SKIDMARKS_CHECKLIST_ORDER,
  subscribeSkidmarks,
  type SkidmarksChecklistKey,
  type SkidmarksLook,
  type SkidmarksMp3Attachment,
  type SkidmarksProjectKind,
  type SkidmarksState,
} from "@/lib/skidmarks";

const EMPTY_STATE: SkidmarksState = {
  bands: [],
  session: { projectKind: null, bandId: null, mp3: null },
};

/**
 * React binding for the Skidmarks Music-video studio store
 * (`lib/skidmarks.ts`) — same `useSyncExternalStore` shape as
 * `useDialModes`/the old `useSkidmarksProjects`, so SSR always sees the
 * empty state and the client re-renders with whatever's in
 * `localStorage` right after hydration.
 *
 * Also owns the one piece of real side-effecting logic this flow needs:
 * staging the MP3 checklist's "background sniff" (`attachMp3` kicks off
 * timers that flip `lyrics` → `timing` → `ready` after
 * `SKIDMARKS_CHECKLIST_DELAY_MS`, mirroring the old chat build's
 * `revealNext` staged-reveal pattern). Timers are cleared on unmount so a
 * closed sheet can't keep marking checklist items done in the background.
 */
export function useSkidmarksStudio() {
  const state = useSyncExternalStore(
    subscribeSkidmarks,
    getSkidmarksSnapshot,
    () => EMPTY_STATE
  );

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const selectProjectKind = useCallback(
    (kind: SkidmarksProjectKind) => selectSkidmarksProjectKind(kind),
    []
  );
  const selectBand = useCallback((bandId: string) => selectSkidmarksBand(bandId), []);
  const createBand = useCallback(() => createSkidmarksBand(), []);
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

  const attachMp3 = useCallback(
    (mp3: SkidmarksMp3Attachment) => {
      clearTimers();
      attachSkidmarksMp3(mp3);
      const orderedKeys: SkidmarksChecklistKey[] = [...SKIDMARKS_CHECKLIST_ORDER].sort(
        (a, b) => SKIDMARKS_CHECKLIST_DELAY_MS[a] - SKIDMARKS_CHECKLIST_DELAY_MS[b]
      );
      for (const key of orderedKeys) {
        const timer = setTimeout(() => {
          markSkidmarksChecklistDone(key);
        }, SKIDMARKS_CHECKLIST_DELAY_MS[key]);
        timersRef.current.push(timer);
      }
    },
    [clearTimers]
  );

  const removeMp3 = useCallback(() => {
    clearTimers();
    clearSkidmarksMp3();
  }, [clearTimers]);

  const setMp3Duration = useCallback(
    (durationSec: number) => setSkidmarksMp3Duration(durationSec),
    []
  );

  return {
    bands: state.bands,
    session: state.session,
    selectProjectKind,
    selectBand,
    createBand,
    addMember,
    removeMember,
    renameMember,
    setBandCoverImage,
    setMemberAvatarImage,
    addLook,
    attachMp3,
    removeMp3,
    setMp3Duration,
  };
}
