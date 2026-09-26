"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseStoredOpenSheet } from "@/lib/openSheetRestore";

const STORAGE_KEY = "deck:open-sheet";

// `undefined` = not read yet. Same `useSyncExternalStore` + localStorage
// pattern as `useSpendWindow` / `useDialModes`, so there's no hydration
// mismatch: the server always renders the Deck with no sheet open, then
// the client snaps Skidmarks back open if it was open before the refresh.
let cachedOpen: string | null | undefined;
let sessionOpen: string | null | undefined;

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredOpenSheet(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  if (sessionOpen !== undefined) return sessionOpen;
  if (cachedOpen === undefined) cachedOpen = readStored();
  return cachedOpen;
}

function getServerSnapshot(): string | null {
  return null;
}

function writeOpen(id: string | null) {
  sessionOpen = id;
  try {
    const keep = parseStoredOpenSheet(id);
    if (keep) window.localStorage.setItem(STORAGE_KEY, keep);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode) — works for this visit only.
  }
  for (const listener of listeners) listener();
}

/**
 * Which Deck detail sheet is open. Any sheet can open and close as
 * before; only Skidmarks is remembered across a refresh (see
 * `RESTORABLE_SHEET_IDS`). Tapping X / Escape closes it and forgets it,
 * so the next refresh lands back on the Deck.
 */
export function useOpenDeckSheet() {
  const openNodeId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setOpenNodeId = useCallback((id: string | null) => writeOpen(id), []);
  return [openNodeId, setOpenNodeId] as const;
}
