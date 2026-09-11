"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_WINDOW_DAYS,
  isWindowDays,
  type WindowDays,
} from "@/lib/spend-window";

const STORAGE_KEY = "the-tab:spend-window";

let cachedSnapshot: WindowDays | null = null;

function readWindow(): WindowDays {
  if (typeof window === "undefined") return DEFAULT_WINDOW_DAYS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    cachedSnapshot = isWindowDays(parsed) ? parsed : DEFAULT_WINDOW_DAYS;
  } catch {
    cachedSnapshot = DEFAULT_WINDOW_DAYS;
  }
  return cachedSnapshot;
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

function getSnapshot(): WindowDays {
  return cachedSnapshot ?? readWindow();
}

function getServerSnapshot(): WindowDays {
  return DEFAULT_WINDOW_DAYS;
}

function writeWindow(days: WindowDays) {
  cachedSnapshot = days;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(days));
  } catch {
    // localStorage unavailable (e.g. private mode) — in-memory only.
  }
  for (const listener of listeners) listener();
}

/**
 * Which window (7 or 30 days) the cost deep dive is showing — persisted to
 * localStorage, same `useSyncExternalStore` pattern as `useDialModes` /
 * `useGraphBoardPositions`. Defaults to 30 days (`DEFAULT_WINDOW_DAYS`) —
 * see the README and `lib/spend-window.ts` for why "lifetime from day one"
 * isn't the default anymore.
 */
export function useSpendWindow() {
  const windowDays = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setWindowDays = useCallback((days: WindowDays) => writeWindow(days), []);
  return { windowDays, setWindowDays };
}
