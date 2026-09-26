"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DeckPcRailId } from "@/components/DeckPcRail";

const STORAGE_KEY = "deck:skidmarks-rail";
const DEFAULT_RAIL: DeckPcRailId = "create";

function parseRail(raw: string | null): DeckPcRailId {
  return raw === "home" || raw === "create" || raw === "library" ? raw : DEFAULT_RAIL;
}

let cached: DeckPcRailId | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DeckPcRailId {
  if (cached === undefined) {
    try {
      cached = parseRail(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      cached = DEFAULT_RAIL;
    }
  }
  return cached;
}

function getServerSnapshot(): DeckPcRailId {
  return DEFAULT_RAIL;
}

function write(id: DeckPcRailId) {
  cached = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode: this visit only
  }
  for (const l of listeners) l();
}

/**
 * Which Skidmarks section is showing (Home / Create / Library), shared
 * by the PC rail and the phone slide-out menu, and remembered across a
 * refresh so you land back where you were.
 */
export function useSkidmarksRail() {
  const rail = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setRail = useCallback((id: DeckPcRailId) => write(id), []);
  return [rail, setRail] as const;
}
