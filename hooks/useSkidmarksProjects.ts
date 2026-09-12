"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  createSkidmarksProject,
  getSkidmarksSnapshot,
  setActiveSkidmarksProject,
  subscribeSkidmarks,
  type SkidmarksState,
} from "@/lib/skidmarks";

const EMPTY_STATE: SkidmarksState = { projects: [], activeProjectId: null };

/**
 * React binding for the Skidmarks project store (`lib/skidmarks.ts`) —
 * same `useSyncExternalStore` shape as `useDialModes`/`useGraphBoardPositions`,
 * so SSR always sees the empty state and the client re-renders with
 * whatever's in `localStorage` right after hydration (no project history
 * on first paint, same as a fresh browser).
 */
export function useSkidmarksProjects() {
  const state = useSyncExternalStore(
    subscribeSkidmarks,
    getSkidmarksSnapshot,
    () => EMPTY_STATE
  );

  const createProject = useCallback(
    (brief: string) => createSkidmarksProject(brief),
    []
  );
  const setActiveProject = useCallback(
    (id: string) => setActiveSkidmarksProject(id),
    []
  );

  return {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    createProject,
    setActiveProject,
  };
}
