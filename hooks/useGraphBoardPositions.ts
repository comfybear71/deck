"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { BoardPositions, NodePosition } from "@/lib/graphLayout";
import {
  DEFAULT_BOARD_POSITIONS,
  commitPosition,
  getPositionsSnapshot,
  resetPositions,
  setNodePositionLive,
  subscribePositions,
} from "@/lib/graphLayout";

/**
 * React binding for the GraphBoard position store (`lib/graphLayout.ts`) —
 * same `useSyncExternalStore` shape as `useDialModes`/`useSpendWindow`, so SSR
 * always sees `DEFAULT_BOARD_POSITIONS` and the client re-renders with
 * whatever's in `localStorage` right after hydration.
 */
export function useGraphBoardPositions() {
  const positions: BoardPositions = useSyncExternalStore(
    subscribePositions,
    getPositionsSnapshot,
    () => DEFAULT_BOARD_POSITIONS
  );

  const moveNode = useCallback((id: string, pos: NodePosition) => {
    setNodePositionLive(id, pos);
  }, []);

  const dropNode = useCallback((id: string, pos: NodePosition) => {
    commitPosition(id, pos);
  }, []);

  const reset = useCallback(() => {
    resetPositions();
  }, []);

  return { positions, moveNode, dropNode, reset };
}
