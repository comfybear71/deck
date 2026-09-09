/**
 * v0 control-plane stub, local to this app.
 *
 * This is deliberately thin: it exists so the suit dials (Full / Slow /
 * Pause) actually gate something instead of being display-only, and so a
 * future real control plane (Skidmarks / aiglitch-api) has an obvious shape
 * to drop into. See the README's "Control plane (v0 stub)" section for the
 * intended migration path.
 *
 * Persistence model:
 * - Mode (the dial position) and the spend log are both kept in
 *   `localStorage` on the client — that's the source of truth the UI reads
 *   synchronously, so dials/checks work instantly and offline.
 * - Every `setMode`/`report` call also best-effort mirrors to the
 *   `/api/control-plane/*` routes (server-side, in-memory — see
 *   `control-plane-server.ts`), so a server round trip exists and behaves
 *   the same way a future real service call would, without blocking the UI
 *   on it.
 */

import type { DialMode, Suit } from "./types";
import { SUIT_ORDER } from "./constants";

export type Lane = Suit;
export type PlaneMode = DialMode;

export interface CheckResult {
  allowed: boolean;
  mode: PlaneMode;
  reason?: string;
  /** Present when mode === "slow": hint for how a caller should throttle. */
  maxConcurrent?: number;
  delayMs?: number;
}

export interface SpendEvent {
  lane: Lane;
  amount?: number;
  meta?: Record<string, unknown>;
  at: number;
}

const DIAL_STORAGE_KEY = "the-tab:dial-modes";
const SPEND_LOG_KEY = "the-tab:spend-log";
const SPEND_LOG_LIMIT = 100;
const MODE_API_URL = "/api/control-plane/mode";
const REPORT_API_URL = "/api/control-plane/report";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function defaultModes(): Record<Lane, PlaneMode> {
  const seeded = {} as Record<Lane, PlaneMode>;
  for (const suit of SUIT_ORDER) seeded[suit] = "full";
  return seeded;
}

/** Stable, frozen fallback used as the SSR/initial snapshot. */
export const DEFAULT_MODES: Readonly<Record<Lane, PlaneMode>> = Object.freeze(
  defaultModes()
);

let cachedModes: Record<Lane, PlaneMode> | null = null;

function loadModesFromStorage(): Record<Lane, PlaneMode> {
  if (!isBrowser()) return DEFAULT_MODES;
  try {
    const raw = window.localStorage.getItem(DIAL_STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    return { ...defaultModes(), ...stored };
  } catch {
    return defaultModes();
  }
}

/**
 * Current dial-mode-per-lane snapshot, shared by `useDialModes` (via
 * `useSyncExternalStore`) and by anything reading state outside React (the
 * demo console, `check`). Cached by reference so repeated reads between
 * writes don't allocate a new object every call.
 */
export function getModesSnapshot(): Record<Lane, PlaneMode> {
  if (!cachedModes) cachedModes = loadModesFromStorage();
  return cachedModes;
}

export function getMode(lane: Lane): PlaneMode {
  return getModesSnapshot()[lane];
}

const modeListeners = new Set<() => void>();

function onStorageEvent(e: StorageEvent) {
  if (e.key !== DIAL_STORAGE_KEY) return;
  cachedModes = null;
  for (const listener of modeListeners) listener();
}

export function subscribeModes(listener: () => void): () => void {
  modeListeners.add(listener);
  if (isBrowser() && modeListeners.size === 1) {
    window.addEventListener("storage", onStorageEvent);
  }
  return () => {
    modeListeners.delete(listener);
    if (isBrowser() && modeListeners.size === 0) {
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}

function writeLocalMode(lane: Lane, mode: PlaneMode) {
  const next = { ...getModesSnapshot(), [lane]: mode };
  cachedModes = next;
  if (isBrowser()) {
    try {
      window.localStorage.setItem(DIAL_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (e.g. private mode) — in-memory only.
    }
  }
  for (const listener of modeListeners) listener();
}

function postBestEffort(url: string, body: unknown) {
  if (!isBrowser() || typeof fetch !== "function") return;
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // Server mirror is best-effort — local state (and the UI) already
      // reflects the change either way.
    });
  } catch {
    // fetch unavailable in this environment — ignore.
  }
}

/**
 * Pure evaluation of what a dial mode means for a would-be call. No I/O —
 * used by both the client stub (`check`) and the server stub
 * (`control-plane-server.ts`) so the two never disagree on semantics.
 */
export function evaluate(mode: PlaneMode): CheckResult {
  switch (mode) {
    case "pause":
      return { allowed: false, mode, reason: "Lane is paused." };
    case "slow":
      return {
        allowed: true,
        mode,
        maxConcurrent: 1,
        delayMs: 1200,
        reason: "Lane is throttled to Slow.",
      };
    case "full":
    default:
      return { allowed: true, mode };
  }
}

/**
 * check(lane): may this lane spend/call right now? Synchronous and local —
 * reads the same mode a dial just set, so it's instant on a flaky mobile
 * connection. `pause` denies, `slow` allows with a throttle hint, `full`
 * allows outright.
 */
export function check(lane: Lane): CheckResult {
  return evaluate(getMode(lane));
}

/**
 * setMode(lane, mode): persists the dial position (the same store
 * `useDialModes` reads) and mirrors it to the server stub. This is the hook
 * the suit dials call so the UI and the plane never drift apart.
 */
export function setMode(lane: Lane, mode: PlaneMode): void {
  writeLocalMode(lane, mode);
  postBestEffort(MODE_API_URL, { lane, mode });
}

function readSpendLog(): SpendEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(SPEND_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSpendLog(events: SpendEvent[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(SPEND_LOG_KEY, JSON.stringify(events));
  } catch {
    // localStorage unavailable — the event still gets posted server-side.
  }
}

/**
 * report(lane, amount?, meta?): records a spend event to the local log and
 * mirrors it to the server stub. Callers should generally `check` first —
 * `report` doesn't itself refuse a paused lane, it just records that
 * something happened (a future real caller decides for itself whether to
 * call `report` after a denied `check`).
 */
export function report(
  lane: Lane,
  amount?: number,
  meta?: Record<string, unknown>
): SpendEvent {
  const event: SpendEvent = { lane, amount, meta, at: Date.now() };
  const next = [...readSpendLog(), event].slice(-SPEND_LOG_LIMIT);
  writeSpendLog(next);
  postBestEffort(REPORT_API_URL, event);
  return event;
}

export function getSpendLog(): SpendEvent[] {
  return readSpendLog();
}
