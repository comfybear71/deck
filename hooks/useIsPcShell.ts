"use client";

import { useSyncExternalStore } from "react";

/**
 * PC shell breakpoint for Skidmarks — ~1024px+ (Tailwind `lg`).
 * Below this, Skidmarks keeps the existing phone/tablet sheet
 * (`sm:max-w-md` centered modal). At/above it, SkidmarksDetailSheet
 * switches to the left-rail shell (Home / Create / Library).
 *
 * Separate from `useIsLargeScreen` (~768px), which only drives the
 * GraphView board vs stacked list.
 */
const QUERY = "(min-width: 1024px)";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribe(listener: () => void): () => void {
  if (!isBrowser()) return () => {};
  const mql = window.matchMedia(QUERY);
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }
  mql.addListener(listener);
  return () => mql.removeListener(listener);
}

function getSnapshot(): boolean {
  if (!isBrowser()) return false;
  return window.matchMedia(QUERY).matches;
}

/** SSR/first-paint assumes phone — hydration-safe; real snapshot after mount. */
function getServerSnapshot(): boolean {
  return false;
}

export function useIsPcShell(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
