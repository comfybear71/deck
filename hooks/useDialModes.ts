"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DialMode, Suit } from "@/lib/types";
import {
  DEFAULT_MODES,
  getModesSnapshot,
  setMode as setPlaneMode,
  subscribeModes,
} from "@/lib/control-plane";

/**
 * Tracks each suit lane's dial position (full | slow | pause). The actual
 * storage/subscription/sync logic now lives in `lib/control-plane.ts` —
 * `setMode` here calls straight into the control plane's `setMode`, so the
 * dial and the plane can never drift apart. See `lib/control-plane.ts` for
 * how `check(lane)` uses this same state to gate the "Simulate spend" demo
 * (and, later, real callers).
 */
export function useDialModes() {
  const modes = useSyncExternalStore(
    subscribeModes,
    getModesSnapshot,
    () => DEFAULT_MODES
  );

  const setMode = useCallback((suit: Suit, mode: DialMode) => {
    setPlaneMode(suit, mode);
  }, []);

  return { modes, setMode };
}
