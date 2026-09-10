/**
 * Server-side half of the Ask-Grok bridge. Backs `POST`/`GET
 * /api/deck/ask` with a small local store.
 *
 * `data/deck-asks.json` on disk is the source of truth, read fresh on
 * every access rather than cached in a module-level variable — same
 * reasoning as `lib/overrides-server.ts`: each API route is its own server
 * module, so a long-lived in-memory cache in one would never see writes
 * made via another. The file is what lets them agree.
 *
 * On a read-only deploy filesystem (e.g. Vercel), the file write silently
 * no-ops and an in-memory fallback (scoped to this one module instance)
 * takes over for the rest of that warm instance's life — an accepted v0
 * limitation, same as `lib/overrides-server.ts` and
 * `lib/control-plane-server.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import type { DeckAsk, DeckAskInput } from "./deck-ask";

const ASKS_FILE = path.join(process.cwd(), "data", "deck-asks.json");
const ASK_LOG_LIMIT = 200;

interface AsksState {
  asks: DeckAsk[];
}

/** Per-module-instance fallback, only ever used when the file write below fails. */
let memoryFallback: AsksState | null = null;

function emptyState(): AsksState {
  return { asks: [] };
}

function normalizeState(parsed: unknown): AsksState {
  const p = (parsed ?? {}) as Partial<AsksState>;
  return { asks: Array.isArray(p.asks) ? p.asks : [] };
}

function readFromDisk(): AsksState | null {
  try {
    const raw = fs.readFileSync(ASKS_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    // Missing/unreadable/invalid file — the caller falls back from here.
    return null;
  }
}

/** Always prefers the on-disk file (shared across all route modules); falls back to this instance's own memory when the file can't be read. */
function getState(): AsksState {
  return readFromDisk() ?? memoryFallback ?? emptyState();
}

function persist(next: AsksState): void {
  memoryFallback = next;
  try {
    fs.mkdirSync(path.dirname(ASKS_FILE), { recursive: true });
    fs.writeFileSync(ASKS_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // Read-only filesystem (deployed) — this instance's in-memory fallback
    // is still correct for its own remaining requests; it just won't be
    // visible to other instances/modules and won't survive a cold start.
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ask_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Stores one normalized ask and returns the full stored record (with its assigned `id` + `receivedAt`). */
export function recordAsk(input: DeckAskInput): DeckAsk {
  const ask: DeckAsk = {
    id: generateId(),
    project: input.project,
    message: input.message,
    statusSnapshot: input.statusSnapshot ?? null,
    ts: input.ts ?? Date.now(),
    receivedAt: Date.now(),
  };

  const current = getState();
  const asks = [...current.asks, ask].slice(-ASK_LOG_LIMIT);
  persist({ asks });

  return ask;
}

/** Most-recent-last asks, optionally filtered to one project, capped to `limit`. */
export function getRecentAsks(limit = 50, project?: string): DeckAsk[] {
  const asks = getState().asks;
  const filtered = project ? asks.filter((a) => a.project === project) : asks;
  return filtered.slice(-limit);
}
