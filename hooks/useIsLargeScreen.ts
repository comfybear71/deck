"use client";

import { useSyncExternalStore } from "react";

/**
 * "Larger than a phone" breakpoint for the v0 project graph — md/lg-ish,
 * ~768px+. Below this, GraphView keeps the mobile-first stacked list;
 * at/above it, GraphView switches to the draggable GraphBoard. See the
 * README's "Graph (v0 map)" section.
 */
const QUERY = "(min-width: 768px)";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribe(listener: () => void): () => void {
  if (!isBrowser()) return () => {};
  const mql = window.matchMedia(QUERY);
  // Safari <14 only supports the deprecated addListener/removeListener pair;
  // iPadOS Safari has supported addEventListener here for a while, but this
  // keeps older WebKit from silently never re-rendering on rotate/resize.
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

/** SSR/first-paint snapshot always assumes phone-sized — matches the
 * default stacked list markup so hydration never has to reconcile a
 * server-rendered board against a phone-rendered client (or vice versa);
 * useSyncExternalStore re-renders with the real snapshot right after
 * mount, same trick as useSpendWindow. */
function getServerSnapshot(): boolean {
  return false;
}

export function useIsLargeScreen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
