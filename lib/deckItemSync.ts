/**
 * Per-item saving: the ONE client engine every kind uses (characters,
 * Sunnybank episodes, Skidmarks episodes, shorts; 2026-09-30). The card
 * type, its cleaner and its `kind` are passed in (a `DeckItemKindConfig`,
 * one small file per kind), so every genre follows exactly the same steps
 * and rules through the same code. It works
 * out which items really changed, sends one debounced
 * `PUT /api/deck/items` per changed item, lays the server's items over
 * whatever a session load put on screen, and adopts the server's copy
 * whenever a save is refused (409).
 *
 * The rules this file exists to keep, each covered by a test
 * (`lib/deckItemSync.test.ts` run once per kind, plus
 * `lib/characterItems.test.ts` and `lib/sunnybankEpisodeItems.test.ts`
 * through their kind wrappers):
 *
 * - **Only a real change writes.** The store's patch function hands
 *   every edit here with the before/after lists; only items that are new
 *   or differ are sent. Loading never writes, and laying server items
 *   over the screen never writes.
 * - **A missing item never deletes.** An item that is simply not in this
 *   device's list (an old phone copy, a thin session) is never deleted or
 *   overwritten on the server. Only `deleteItem`, called from a real
 *   delete tap, sends a DELETE.
 * - **The server's copy wins.** A 409 means another device saved that
 *   item first, so this device takes the server's copy and drops its own
 *   unsent edit to it. An edit made before the server's items arrived is
 *   only kept if it was made on top of the very copy the server still
 *   has (a three-way check), otherwise the server's copy wins.
 * - **The client never seeds.** Until a one-time seed script has put the
 *   kind's items in `deck_items` (`seeded: false`), or while the tables
 *   don't exist, this stays off and the whole-session save keeps working
 *   exactly as before. There is no "server is empty, upload mine" path.
 *
 * No `localStorage`: the only state here is in memory; Neon is the
 * source of truth. Written as a factory with its `fetch`/timers passed
 * in so every rule above is unit-tested without a browser.
 */
import {
  DECK_ITEM_NEW_REVISION,
  DECK_ITEMS_ENDPOINT,
  type DeckItemKind,
  type DeckItemRecord,
  type DeckItemTombstone,
} from "./deckItems";

/** Anything saved per item: it only needs a stable `id`. */
export interface DeckItemEntry {
  id: string;
}

/**
 * What differs between kinds: which `kind` it is and how one entry is
 * cleaned. Everything else is the same for every kind.
 */
export interface DeckItemKindConfig<T extends DeckItemEntry> {
  kind: DeckItemKind;
  /** The same cleaner the session loader uses; `null` = not one of these. */
  normalize: (value: unknown) => T | null;
  /** Word used in a problem message ("episode", "short"). */
  noun: string;
  /**
   * Where server items this device didn't have go in its list. They are
   * always added after the device's own items; this only orders them
   * among themselves (e.g. newest first for a newest-first shelf). Left
   * out, they keep the server's order.
   */
  orderMissing?: (a: T, b: T) => number;
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

function canonical<T extends DeckItemEntry>(config: DeckItemKindConfig<T>, entry: T): string {
  const clean = config.normalize(entry);
  return JSON.stringify(clean ?? entry);
}

/** Same item, field for field, once both are cleaned the same way. */
export function sameDeckItem<T extends DeckItemEntry>(config: DeckItemKindConfig<T>, a: T, b: T): boolean {
  return canonical(config, a) === canonical(config, b);
}

/**
 * Ids of items in `after` that are new or different from `before`.
 * An item that is in `before` but not in `after` is **never** listed:
 * a missing item is not a change to save (and certainly not a delete).
 */
export function changedDeckItemIds<T extends DeckItemEntry>(
  config: DeckItemKindConfig<T>,
  before: readonly T[],
  after: readonly T[],
): string[] {
  const prior = new Map(before.map((c) => [c.id, c]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of after) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const old = prior.get(c.id);
    if (!old || !sameDeckItem(config, old, c)) out.push(c.id);
  }
  return out;
}

/** A server row as an entry, or `null` if it isn't a usable one. */
export function entryFromDeckItem<T extends DeckItemEntry>(config: DeckItemKindConfig<T>, item: DeckItemRecord): T | null {
  const entry = config.normalize(item.data);
  if (!entry || entry.id !== item.itemId) return null;
  return entry;
}

/**
 * Lays the server's items over this device's list. Server items win,
 * except for ids in `keepLocal` (this device's own edits that are still
 * on their way up, or items it is deleting). Items the server has
 * deleted are dropped. Items the server doesn't know at all are kept as
 * they are, never removed. Server items this device doesn't have are
 * added at the end (ordered by the kind's `orderMissing`, if it has one).
 * Order otherwise follows this device's list.
 */
export function overlayDeckItems<T extends DeckItemEntry>(
  config: DeckItemKindConfig<T>,
  local: readonly T[],
  items: readonly DeckItemRecord[],
  deletedIds: Iterable<string>,
  keepLocal: ReadonlySet<string> = new Set(),
): { entries: T[]; changed: boolean } {
  const server = new Map<string, T>();
  for (const item of items) {
    const entry = entryFromDeckItem(config, item);
    if (entry) server.set(entry.id, entry);
  }
  const deleted = new Set(deletedIds);
  let changed = false;
  const out: T[] = [];
  const placed = new Set<string>();
  for (const c of local) {
    if (placed.has(c.id)) continue;
    placed.add(c.id);
    if (keepLocal.has(c.id)) {
      out.push(c);
      continue;
    }
    const s = server.get(c.id);
    if (s) {
      if (!sameDeckItem(config, s, c)) changed = true;
      out.push(sameDeckItem(config, s, c) ? c : s);
    } else if (deleted.has(c.id)) {
      changed = true;
    } else {
      out.push(c);
    }
  }
  const missing: T[] = [];
  for (const [id, s] of server) {
    if (placed.has(id) || keepLocal.has(id)) continue;
    missing.push(s);
    changed = true;
  }
  if (config.orderMissing) missing.sort(config.orderMissing);
  out.push(...missing);
  return { entries: changed ? out : local.slice(), changed };
}

/* ------------------------------------------------------------------ */
/* The sync engine                                                      */
/* ------------------------------------------------------------------ */

export type DeckItemSyncMode =
  /** Never asked the server yet (before the first session load). */
  | "idle"
  /** Asking the server for its items. Edits are held, not sent. */
  | "loading"
  /** Per-item saving is on: edits go up one item at a time. */
  | "ready"
  /** The last read failed (network, 5xx); retrying. Edits are held. */
  | "stale"
  /** Not set up here (no database, no tables yet, or not seeded yet):
   * off, the whole-session save carries on as before. */
  | "unavailable";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type TimerHandle = unknown;

export interface DeckItemSyncDeps<T extends DeckItemEntry> {
  fetch: FetchLike;
  /** This device's current item list. */
  getEntries: () => T[];
  /** Put server items on screen. Must NOT go through the store's patch
   * function (that would count as a local edit and write it back up). */
  applyServerEntries: (next: T[]) => void;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** Wait after the last edit to an item before sending it. */
  debounceMs?: number;
  /** Back-off for a save that failed on the network or a 5xx. */
  retryDelaysMs?: readonly number[];
  /** Back-off for a failed read of the server's items. */
  refreshRetryDelaysMs?: readonly number[];
  onProblem?: (message: string) => void;
}

export interface DeckItemSync<T extends DeckItemEntry> {
  /** Every edit to this kind, with the list before and after it. */
  noteLocalChange(before: readonly T[], after: readonly T[]): void;
  /** A real delete tap on one item. `snapshot` is the item as it was just before. */
  deleteItem(id: string, snapshot: T | null): void;
  /** Read the server's items and lay them over the screen. Never writes by itself. */
  refreshFromServer(): Promise<void>;
  /** Send any waiting item now (`keepalive` when the page is going away). */
  flush(keepalive?: boolean): void;
  /** Something waiting to go up (for the browser's own leave-page prompt). */
  hasUnsavedWork(): boolean;
  /** For tests and debugging. */
  debugState(): { mode: DeckItemSyncMode; revisions: Record<string, number>; dirty: string[]; pendingDeletes: string[] };
}

export const DECK_ITEM_DEBOUNCE_MS = 1000;
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const DEFAULT_REFRESH_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];
const SLOW_RETRY_MS = 60_000;

interface ListBody {
  ok?: unknown;
  configured?: unknown;
  ready?: unknown;
  seeded?: unknown;
  tableMissing?: unknown;
  items?: unknown;
  deleted?: unknown;
  error?: unknown;
}

interface WriteBody {
  ok?: unknown;
  conflict?: unknown;
  notFound?: unknown;
  configured?: unknown;
  tableMissing?: unknown;
  item?: unknown;
  error?: unknown;
}

function asRecord(value: unknown): DeckItemRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<DeckItemRecord>;
  if (typeof v.itemId !== "string" || typeof v.revision !== "number") return null;
  return {
    itemId: v.itemId,
    folder: typeof v.folder === "string" ? v.folder : "deck",
    data: v.data,
    revision: v.revision,
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null,
    deletedAt: typeof v.deletedAt === "string" ? v.deletedAt : null,
  };
}

function asTombstones(value: unknown): DeckItemTombstone[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((t) =>
    t && typeof t === "object" && typeof (t as DeckItemTombstone).itemId === "string"
      ? [{ itemId: (t as DeckItemTombstone).itemId, revision: Number((t as DeckItemTombstone).revision) || 0 }]
      : [],
  );
}

/**
 * The server says per-item saving isn't set up here (no database, the
 * tables haven't been created, or an older deploy without the route):
 * stop quietly. A plain 5xx is not this; that is retried.
 */
function isUnavailableAnswer(res: Response, body: { configured?: unknown; tableMissing?: unknown; notFound?: unknown }): boolean {
  if (body.configured === false || body.tableMissing === true) return true;
  return res.status === 404 && body.notFound !== true;
}

export function createDeckItemSync<T extends DeckItemEntry>(config: DeckItemKindConfig<T>, deps: DeckItemSyncDeps<T>): DeckItemSync<T> {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounceMs = deps.debounceMs ?? DECK_ITEM_DEBOUNCE_MS;
  const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const refreshRetryDelays = deps.refreshRetryDelaysMs ?? DEFAULT_REFRESH_RETRY_DELAYS_MS;
  const problem = (m: string) => deps.onProblem?.(m);

  let mode: DeckItemSyncMode = "idle";
  let generation = 0;
  let refreshAttempt = 0;
  let refreshTimer: TimerHandle | null = null;
  /** Server revision of every live item, as last seen. */
  const revisions = new Map<string, number>();
  /** Items the server has soft-deleted. */
  const tombstones = new Set<string>();
  /** Items with an edit not yet on the server; `base` is the copy the
   * first unsent edit was made on top of (`null` = the item was new). */
  const dirty = new Map<string, { base: T | null }>();
  /** Delete taps not yet on the server, with the item as it was. */
  const pendingDeletes = new Map<string, { snapshot: T | null }>();
  const timers = new Map<string, TimerHandle>();
  const inFlight = new Set<string>();
  const attempts = new Map<string, number>();

  const localEntry = (id: string) => deps.getEntries().find((c) => c.id === id) ?? null;

  function clearItemTimer(id: string) {
    const t = timers.get(id);
    if (t !== undefined) {
      clearTimer(t);
      timers.delete(id);
    }
  }

  function schedule(id: string, ms: number = debounceMs) {
    clearItemTimer(id);
    timers.set(
      id,
      setTimer(() => {
        timers.delete(id);
        void pump(id, false);
      }, ms),
    );
  }

  function scheduleRetry(id: string) {
    const n = attempts.get(id) ?? 0;
    attempts.set(id, n + 1);
    schedule(id, n < retryDelays.length ? retryDelays[n] : SLOW_RETRY_MS);
  }

  function goUnavailable(message?: string) {
    mode = "unavailable";
    for (const id of [...timers.keys()]) clearItemTimer(id);
    dirty.clear();
    pendingDeletes.clear();
    attempts.clear();
    if (message) problem(message);
  }

  /** Replace (or drop) one item on screen with the server's copy. */
  function adopt(id: string, item: DeckItemRecord | null, sentExpected: number) {
    clearItemTimer(id);
    attempts.delete(id);
    if (!item) {
      // No row at all, though this device thought there was one. Keep the
      // item on screen (a missing row never deletes anything) and send it
      // once more as new. If it was already sent as new, give up quietly.
      revisions.delete(id);
      pendingDeletes.delete(id);
      if (sentExpected !== DECK_ITEM_NEW_REVISION && localEntry(id)) {
        dirty.set(id, { base: null });
        schedule(id);
      } else {
        dirty.delete(id);
      }
      return;
    }
    dirty.delete(id);
    pendingDeletes.delete(id);
    const list = deps.getEntries();
    if (item.deletedAt !== null) {
      revisions.delete(id);
      tombstones.add(id);
      if (list.some((c) => c.id === id)) deps.applyServerEntries(list.filter((c) => c.id !== id));
      return;
    }
    revisions.set(id, item.revision);
    tombstones.delete(id);
    const entry = entryFromDeckItem(config, item);
    if (!entry) return;
    const at = list.findIndex((c) => c.id === id);
    if (at >= 0) {
      if (sameDeckItem(config, list[at], entry)) return;
      const next = list.slice();
      next[at] = entry;
      deps.applyServerEntries(next);
    } else {
      deps.applyServerEntries([...list, entry]);
    }
  }

  async function pump(id: string, keepalive: boolean): Promise<void> {
    if (mode !== "ready" || inFlight.has(id)) return;
    if (pendingDeletes.has(id)) return sendDelete(id, keepalive);
    if (dirty.has(id)) return sendPut(id, keepalive);
  }

  async function afterWrite(id: string) {
    inFlight.delete(id);
    if (mode !== "ready") return;
    if (pendingDeletes.has(id)) await pump(id, false);
    else if (dirty.has(id) && !timers.has(id)) schedule(id);
  }

  async function sendPut(id: string, keepalive: boolean): Promise<void> {
    const sent = localEntry(id);
    if (!sent) {
      // Gone from this device's list without a delete tap: nothing to
      // send, and certainly nothing to delete.
      dirty.delete(id);
      return;
    }
    const expectedRevision = revisions.get(id) ?? DECK_ITEM_NEW_REVISION;
    inFlight.add(id);
    let res: Response;
    let body: WriteBody;
    try {
      res = await deps.fetch(DECK_ITEMS_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: config.kind, itemId: id, expectedRevision, data: sent }),
        keepalive,
      });
      body = ((await res.json().catch(() => ({}))) ?? {}) as WriteBody;
    } catch {
      inFlight.delete(id);
      if (!keepalive) scheduleRetry(id);
      return;
    }
    if (res.ok && body.ok === true) {
      const item = asRecord(body.item);
      if (item) revisions.set(id, item.revision);
      tombstones.delete(id);
      attempts.delete(id);
      const now = localEntry(id);
      if (!now || sameDeckItem(config, now, sent)) dirty.delete(id);
      else dirty.set(id, { base: sent });
    } else if (res.status === 409 || body.conflict === true) {
      adopt(id, asRecord(body.item), expectedRevision);
    } else if (isUnavailableAnswer(res, body)) {
      inFlight.delete(id);
      goUnavailable(typeof body.error === "string" ? body.error : undefined);
      return;
    } else if (res.status === 400) {
      // Can never succeed as sent; don't loop on it.
      dirty.delete(id);
      problem(typeof body.error === "string" ? body.error : `A ${config.noun} couldn't be saved.`);
    } else {
      inFlight.delete(id);
      if (!keepalive) scheduleRetry(id);
      return;
    }
    await afterWrite(id);
  }

  async function sendDelete(id: string, keepalive: boolean): Promise<void> {
    const rev = revisions.get(id);
    if (rev === undefined) {
      // Not a live row on the server (never saved, or already deleted).
      pendingDeletes.delete(id);
      return;
    }
    inFlight.add(id);
    let res: Response;
    let body: WriteBody;
    try {
      const q = new URLSearchParams({ kind: config.kind, itemId: id, expectedRevision: String(rev) });
      res = await deps.fetch(`${DECK_ITEMS_ENDPOINT}?${q.toString()}`, { method: "DELETE", keepalive });
      body = ((await res.json().catch(() => ({}))) ?? {}) as WriteBody;
    } catch {
      inFlight.delete(id);
      if (!keepalive) scheduleRetry(id);
      return;
    }
    if ((res.ok && body.ok === true) || body.notFound === true) {
      pendingDeletes.delete(id);
      revisions.delete(id);
      tombstones.add(id);
      attempts.delete(id);
    } else if (res.status === 409 || body.conflict === true) {
      // Changed on another device since: the server's copy wins, so the
      // item comes back. A second tap deletes the newer copy.
      adopt(id, asRecord(body.item), rev);
    } else if (isUnavailableAnswer(res, body)) {
      inFlight.delete(id);
      goUnavailable(typeof body.error === "string" ? body.error : undefined);
      return;
    } else if (res.status === 400) {
      pendingDeletes.delete(id);
    } else {
      inFlight.delete(id);
      if (!keepalive) scheduleRetry(id);
      return;
    }
    await afterWrite(id);
  }

  function scheduleRefreshRetry() {
    if (refreshTimer !== null) clearTimer(refreshTimer);
    const ms = refreshAttempt < refreshRetryDelays.length ? refreshRetryDelays[refreshAttempt] : SLOW_RETRY_MS;
    refreshAttempt += 1;
    refreshTimer = setTimer(() => {
      refreshTimer = null;
      void refreshFromServer();
    }, ms);
  }

  async function refreshFromServer(): Promise<void> {
    const gen = ++generation;
    if (refreshTimer !== null) {
      clearTimer(refreshTimer);
      refreshTimer = null;
    }
    mode = "loading";
    // Held until the server's items are in; rescheduled below.
    for (const id of [...timers.keys()]) clearItemTimer(id);
    let res: Response;
    let body: ListBody;
    try {
      res = await deps.fetch(`${DECK_ITEMS_ENDPOINT}?kind=${encodeURIComponent(config.kind)}`, { cache: "no-store" });
      body = ((await res.json().catch(() => ({}))) ?? {}) as ListBody;
    } catch {
      if (gen !== generation) return;
      mode = "stale";
      scheduleRefreshRetry();
      return;
    }
    if (gen !== generation) return;
    if (isUnavailableAnswer(res, body)) {
      goUnavailable();
      return;
    }
    if (!res.ok || body.ok !== true || !Array.isArray(body.items)) {
      mode = "stale";
      scheduleRefreshRetry();
      return;
    }
    refreshAttempt = 0;
    if (body.seeded !== true) {
      // The seed hasn't run: stay off. Never "upload mine".
      goUnavailable();
      return;
    }

    const items = body.items.map(asRecord).filter((r): r is DeckItemRecord => r !== null && r.deletedAt === null);
    const tombs = asTombstones(body.deleted);
    revisions.clear();
    tombstones.clear();
    const serverEntries = new Map<string, T>();
    for (const item of items) {
      revisions.set(item.itemId, item.revision);
      const entry = entryFromDeckItem(config, item);
      if (entry) serverEntries.set(item.itemId, entry);
    }
    for (const t of tombs) tombstones.add(t.itemId);

    const local = deps.getEntries();
    const localById = new Map(local.map((c) => [c.id, c]));
    const keepLocal = new Set<string>(inFlight);

    for (const [id, { base }] of [...dirty]) {
      if (inFlight.has(id)) continue;
      const mine = localById.get(id);
      if (!mine) {
        dirty.delete(id);
        continue;
      }
      const theirs = serverEntries.get(id);
      if (theirs) {
        if (sameDeckItem(config, theirs, mine)) dirty.delete(id);
        else if (base && sameDeckItem(config, theirs, base)) keepLocal.add(id);
        else dirty.delete(id); // the server moved on: its copy wins
      } else if (tombstones.has(id)) {
        dirty.delete(id); // deleted elsewhere: the delete wins
      } else {
        keepLocal.add(id); // new here, not on the server yet
      }
    }
    for (const [id, { snapshot }] of [...pendingDeletes]) {
      if (inFlight.has(id)) {
        keepLocal.add(id);
        continue;
      }
      const theirs = serverEntries.get(id);
      if (!theirs) {
        pendingDeletes.delete(id);
        continue;
      }
      if (snapshot && sameDeckItem(config, theirs, snapshot)) keepLocal.add(id);
      else pendingDeletes.delete(id); // changed elsewhere since: it comes back
    }

    const { entries, changed } = overlayDeckItems(config, local, items, tombstones, keepLocal);
    if (changed) deps.applyServerEntries(entries);
    mode = "ready";
    for (const id of pendingDeletes.keys()) void pump(id, false);
    for (const id of dirty.keys()) if (!inFlight.has(id)) schedule(id);
  }

  return {
    noteLocalChange(before, after) {
      if (mode === "unavailable") return;
      const priorById = new Map(before.map((c) => [c.id, c]));
      for (const id of changedDeckItemIds(config, before, after)) {
        if (!dirty.has(id)) dirty.set(id, { base: priorById.get(id) ?? null });
        if (mode === "ready") schedule(id);
      }
    },
    deleteItem(id, snapshot) {
      if (mode === "unavailable") return;
      clearItemTimer(id);
      dirty.delete(id);
      pendingDeletes.set(id, { snapshot });
      if (mode === "ready") void pump(id, false);
    },
    refreshFromServer,
    flush(keepalive = false) {
      if (mode !== "ready") return;
      for (const id of [...timers.keys()]) {
        clearItemTimer(id);
        void pump(id, keepalive);
      }
    },
    hasUnsavedWork() {
      return mode === "ready" && (dirty.size > 0 || pendingDeletes.size > 0 || inFlight.size > 0);
    },
    debugState() {
      return {
        mode,
        revisions: Object.fromEntries(revisions),
        dirty: [...dirty.keys()],
        pendingDeletes: [...pendingDeletes.keys()],
      };
    },
  };
}
