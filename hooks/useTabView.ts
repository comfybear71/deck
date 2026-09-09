"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "the-tab:view-mode";

export type TabViewMode = "chip" | "expanded";

const SERVER_SNAPSHOT: TabViewMode = "chip";

let cachedSnapshot: TabViewMode | null = null;

function readMode(): TabViewMode {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  let next: TabViewMode;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    next = raw === "expanded" ? "expanded" : "chip";
  } catch {
    next = "chip";
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

function getSnapshot(): TabViewMode {
  return cachedSnapshot ?? readMode();
}

function writeMode(mode: TabViewMode) {
  cachedSnapshot = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable (e.g. private mode) — in-memory only.
  }
  for (const listener of listeners) listener();
}

/**
 * Tracks whether The Tab is shown as the compact chip or the full expanded
 * card, persisted to localStorage (same useSyncExternalStore pattern as
 * useDialModes). Defaults to "chip" — the full-screen card was impractical
 * to glance at on iPhone.
 */
export function useTabView() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);

  const expand = useCallback(() => writeMode("expanded"), []);
  const collapse = useCallback(() => writeMode("chip"), []);

  return { mode, expand, collapse };
}
