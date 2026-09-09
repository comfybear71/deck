"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DialMode, Suit } from "@/lib/types";
import { SUIT_ORDER } from "@/lib/constants";

const STORAGE_KEY = "the-tab:dial-modes";

type DialModeMap = Record<Suit, DialMode>;

function defaultModes(): DialModeMap {
  const seeded = {} as DialModeMap;
  for (const suit of SUIT_ORDER) seeded[suit] = "full";
  return seeded;
}

const SERVER_SNAPSHOT = defaultModes();

let cachedSnapshot: DialModeMap | null = null;

function readModes(): DialModeMap {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  let next: DialModeMap;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    next = { ...defaultModes(), ...stored };
  } catch {
    next = defaultModes();
  }
  cachedSnapshot = next;
  return next;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): DialModeMap {
  return cachedSnapshot ?? readModes();
}

function writeMode(suit: Suit, mode: DialMode) {
  const next = { ...readModes(), [suit]: mode };
  cachedSnapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (e.g. private mode) — in-memory only.
  }
  for (const listener of listeners) listener();
}

/**
 * Tracks each suit lane's dial position (full | slow | pause), persisted in
 * localStorage via useSyncExternalStore so the client can read/write outside
 * React's render without falling into the "setState inside an effect"
 * anti-pattern. Dials are UI-only in v0 — see lib/meters.ts
 * `dialAffectsBurn` for the stubbed spot where a future control-plane
 * `setMode(suit, mode)` call belongs (e.g. pausing/throttling a lane's live
 * integrations).
 */
export function useDialModes() {
  const modes = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);

  const setMode = useCallback((suit: Suit, mode: DialMode) => {
    writeMode(suit, mode);
    // Stub for a future control-plane hook. In v0 dials never change spend:
    //   await setMode(suit, mode);
  }, []);

  return { modes, setMode };
}
