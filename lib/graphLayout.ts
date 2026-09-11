/**
 * v0 GraphBoard layout store — the >=768px "larger than a phone" surface
 * where graph nodes are freely draggable (see components/GraphBoard.tsx +
 * the README's "Graph (v0 map)" section).
 *
 * Positions are stored as **percentages of the board canvas**, not raw
 * pixels — that's what lets a saved layout still make sense across iPad
 * portrait/landscape rotation and different window widths, instead of
 * pinning nodes to whatever pixel grid happened to be on screen when they
 * were dragged.
 *
 * Persistence model mirrors `lib/control-plane.ts`: an in-memory cache is
 * the synchronous source of truth the UI reads via `useSyncExternalStore`,
 * mirrored to `localStorage` (key: `the-tab:graph-positions`) so a layout
 * survives a refresh. Unlike the dial modes, position *drags* update the
 * cache on every pointermove (so the board feels live) but only write to
 * `localStorage` once, on drag end (`commitPosition`) — dragging shouldn't
 * hammer storage 60 times a second.
 */

export interface NodePosition {
  /** Left edge, as a percentage of the canvas width (0–100). */
  x: number;
  /** Top edge, as a percentage of the canvas height (0–100). */
  y: number;
}

export type BoardPositions = Record<string, NodePosition>;

const STORAGE_KEY = "the-tab:graph-positions";

/**
 * Sensible v0 default spread — a clean two-column grid, tuned to still fit
 * without overlap at the *narrow* end of the "larger than a phone" range
 * (~768px-wide iPad portrait, ~660px of usable canvas once you subtract
 * the board's own padding — not just a spacious iPad-landscape canvas).
 * Budju/Propfolio/SGM (all visually independent, no wires) sit in the
 * first two rows; Skidmarks/AIG!itch and the placeholder/hub round out
 * the two columns below them. Column x's (3%, 50%) are chosen so two
 * 280px-wide cards never overlap even at ~660px of canvas width — see the
 * "GraphBoard default layout" note in the README's "Graph (v0 map)"
 * section before changing these. Any node id not listed here (a future
 * new node) falls back to a small top-left offset in `getNodePosition`.
 */
export const DEFAULT_BOARD_POSITIONS: Readonly<BoardPositions> = Object.freeze({
  budju: { x: 3, y: 4 },
  propfolio: { x: 50, y: 4 },
  sgm: { x: 3, y: 40 },
  skidmarks: { x: 50, y: 40 },
  aiglitch: { x: 3, y: 64 },
  "new-project": { x: 50, y: 64 },
  tab: { x: 3, y: 84 },
});

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isValidPosition(p: unknown): p is NodePosition {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof (p as NodePosition).x === "number" &&
    typeof (p as NodePosition).y === "number" &&
    Number.isFinite((p as NodePosition).x) &&
    Number.isFinite((p as NodePosition).y)
  );
}

function loadFromStorage(): BoardPositions {
  const base: BoardPositions = { ...DEFAULT_BOARD_POSITIONS };
  if (!isBrowser()) return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    if (typeof stored !== "object" || stored === null) return base;
    for (const [id, pos] of Object.entries(stored)) {
      if (isValidPosition(pos)) {
        base[id] = { x: clamp(pos.x, 0, 100), y: clamp(pos.y, 0, 100) };
      }
    }
    return base;
  } catch {
    return base;
  }
}

let cachedPositions: BoardPositions | null = null;

/**
 * Current board-positions snapshot, cached by reference so
 * `useSyncExternalStore` doesn't re-render on every read — only when
 * `setNodePositionLive`/`commitPosition` actually swap it out.
 */
export function getPositionsSnapshot(): BoardPositions {
  if (!cachedPositions) cachedPositions = loadFromStorage();
  return cachedPositions;
}

/** A single node's position, falling back to a small top-left offset for
 * any id not covered by `DEFAULT_BOARD_POSITIONS` (e.g. a future node
 * added to `data/graph.json` without a hand-picked spot yet). */
export function getNodePosition(id: string): NodePosition {
  return getPositionsSnapshot()[id] ?? { x: 4, y: 4 };
}

const listeners = new Set<() => void>();

export function subscribePositions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

function persistToStorage(positions: BoardPositions) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // localStorage unavailable (e.g. private mode) — the drag still
    // "sticks" for the rest of this session via the in-memory cache.
  }
}

/**
 * Updates one node's position in the live, in-memory snapshot without
 * touching `localStorage` — call this on every pointermove during a drag
 * so the board tracks the pointer, without a write-per-frame.
 */
export function setNodePositionLive(id: string, pos: NodePosition): void {
  const current = getPositionsSnapshot();
  const next: BoardPositions = {
    ...current,
    [id]: { x: clamp(pos.x, 0, 100), y: clamp(pos.y, 0, 100) },
  };
  cachedPositions = next;
  notify();
}

/**
 * Finalizes a node's position and writes the whole board to
 * `localStorage` — call this once, on drag end (pointerup/cancel).
 */
export function commitPosition(id: string, pos: NodePosition): void {
  setNodePositionLive(id, pos);
  persistToStorage(getPositionsSnapshot());
}

/** Clears any saved layout back to `DEFAULT_BOARD_POSITIONS`. */
export function resetPositions(): void {
  cachedPositions = { ...DEFAULT_BOARD_POSITIONS };
  if (isBrowser()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable — in-memory reset still applies this session.
    }
  }
  notify();
}
