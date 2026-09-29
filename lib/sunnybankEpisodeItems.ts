/**
 * Per-item saving for Sunnybank episodes (step 2 of Stuart's "save each
 * thing on its own" plan; step 1 was characters, `lib/characterItems.ts`,
 * and this file mirrors it rule for rule). One saved episode card (a
 * `SunnyBanksWorkspaceSnapshot` on the episode shelf) is one `deck_items`
 * row, kind `sunnybank-episode`, item id = the card's own `id`, which
 * never changes once minted (not on re-save, not on rename; see
 * `upsertSunnyBanksWorkspace`). The live working copy is not an item; it
 * keeps riding in the whole-session save as before.
 *
 * Client side: works out which cards really changed, sends one debounced
 * `PUT /api/deck/items` per changed card, lays the server's cards over
 * whatever a session load put on screen, and adopts the server's copy
 * whenever a save is refused (409).
 *
 * The rules this file exists to keep, each covered by a test:
 *
 * - **Only a real change writes.** `saveSunnyBanksProjectWorkspace` hands
 *   every save here with the shelf before/after; only cards that are new
 *   or differ are sent. Loading never writes, and laying server cards
 *   over the screen never writes.
 * - **A missing card never deletes.** A card that is simply not in this
 *   device's shelf (an old phone copy, a thin session) is never deleted
 *   or overwritten on the server. Only `deleteEpisode`, called from the
 *   card's real ✕ tap (`deleteSunnyBanksWorkspace`), sends a DELETE.
 * - **The server's copy wins.** A 409 means another device saved that
 *   card first, so this device takes the server's copy and drops its own
 *   unsent edit to it. An edit made before the server's cards arrived is
 *   only kept if it was made on top of the very copy the server still
 *   has (a three-way check), otherwise the server's copy wins.
 * - **The client never seeds.** Until the one-time seed script
 *   (`scripts/seed-deck-items-sunnybank-episodes.ts`) has run
 *   (`seeded: false`), or while the tables don't exist, this stays off
 *   and the whole-session save keeps working exactly as before. There is
 *   no "server is empty, upload mine" path anywhere.
 *
 * No `localStorage`: the only state here is in memory; Neon is the
 * source of truth. Written as a factory with its `fetch`/timers passed
 * in so every rule above is unit-tested without a browser.
 */
import { normalizeSunnyBanksWorkspace, type SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";
import {
  DECK_ITEM_NEW_REVISION,
  DECK_ITEMS_ENDPOINT,
  type DeckItemRecord,
  type DeckItemTombstone,
} from "./deckItems";

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

function canonical(entry: SunnyBanksWorkspaceSnapshot): string {
  const clean = normalizeSunnyBanksWorkspace(entry);
  return JSON.stringify(clean ?? entry);
}

/** Same card, field for field, once both are cleaned the same way. */
export function sameEpisode(a: SunnyBanksWorkspaceSnapshot, b: SunnyBanksWorkspaceSnapshot): boolean {
  return canonical(a) === canonical(b);
}

/**
 * Ids of cards in `after` that are new or different from `before`.
 * A card that is in `before` but not in `after` is **never** listed:
 * a missing card is not a change to save (and certainly not a delete).
 */
export function changedEpisodeIds(
  before: readonly SunnyBanksWorkspaceSnapshot[],
  after: readonly SunnyBanksWorkspaceSnapshot[],
): string[] {
  const prior = new Map(before.map((c) => [c.id, c]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of after) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const old = prior.get(c.id);
    if (!old || !sameEpisode(old, c)) out.push(c.id);
  }
  return out;
}

/** A server row as a card, or `null` if it isn't a usable one. */
export function episodeFromItem(item: DeckItemRecord): SunnyBanksWorkspaceSnapshot | null {
  const entry = normalizeSunnyBanksWorkspace(item.data);
  if (!entry || entry.id !== item.itemId) return null;
  return entry;
}

/**
 * Lays the server's cards over this device's list. Server cards win,
 * except for ids in `keepLocal` (this device's own edits that are still
 * on their way up, or cards it is deleting). Cards the server has
 * deleted are dropped. Cards the server doesn't know at all are kept as
 * they are, never removed. Server cards this device doesn't have are
 * added at the end (newest first). Order otherwise follows this device's
 * list.
 */
export function overlayEpisodeItems(
  local: readonly SunnyBanksWorkspaceSnapshot[],
  items: readonly DeckItemRecord[],
  deletedIds: Iterable<string>,
  keepLocal: ReadonlySet<string> = new Set(),
): { episodes: SunnyBanksWorkspaceSnapshot[]; changed: boolean } {
  const server = new Map<string, SunnyBanksWorkspaceSnapshot>();
  for (const item of items) {
    const entry = episodeFromItem(item);
    if (entry) server.set(entry.id, entry);
  }
  const deleted = new Set(deletedIds);
  let changed = false;
  const out: SunnyBanksWorkspaceSnapshot[] = [];
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
      if (!sameEpisode(s, c)) changed = true;
      out.push(sameEpisode(s, c) ? c : s);
    } else if (deleted.has(c.id)) {
      changed = true;
    } else {
      out.push(c);
    }
  }
  const missing: SunnyBanksWorkspaceSnapshot[] = [];
  for (const [id, s] of server) {
    if (placed.has(id) || keepLocal.has(id)) continue;
    missing.push(s);
    changed = true;
  }
  // The shelf is newest first, so episodes this device didn't have go
  // after its own, newest of them first.
  missing.sort((x, y) => y.savedAt - x.savedAt);
  out.push(...missing);
  return { episodes: changed ? out : local.slice(), changed };
}

/* ------------------------------------------------------------------ */
/* The sync engine                                                      */
/* ------------------------------------------------------------------ */

export type SunnybankEpisodeItemSyncMode =
  /** Never asked the server yet (before the first session load). */
  | "idle"
  /** Asking the server for its cards. Edits are held, not sent. */
  | "loading"
  /** Per-item saving is on: edits go up one card at a time. */
  | "ready"
  /** The last read failed (network, 5xx); retrying. Edits are held. */
  | "stale"
  /** Not set up here (no database, no tables yet, or not seeded yet):
   * off, the whole-session save carries on as before. */
  | "unavailable";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type TimerHandle = unknown;

export interface SunnybankEpisodeItemSyncDeps {
  fetch: FetchLike;
  /** This device's current card list. */
  getEpisodes: () => SunnyBanksWorkspaceSnapshot[];
  /** Put server cards on screen. Must NOT go through `persist()` /
   * `saveSunnyBanksProjectWorkspace` (that would count as a local edit
   * and write it back up). */
  applyServerEpisodes: (next: SunnyBanksWorkspaceSnapshot[]) => void;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** Wait after the last edit to a card before sending it. */
  debounceMs?: number;
  /** Back-off for a save that failed on the network or a 5xx. */
  retryDelaysMs?: readonly number[];
  /** Back-off for a failed read of the server's cards. */
  refreshRetryDelaysMs?: readonly number[];
  onProblem?: (message: string) => void;
}

export interface SunnybankEpisodeItemSync {
  /** Every shelf change, with the shelf before and after it. */
  noteLocalChange(before: readonly SunnyBanksWorkspaceSnapshot[], after: readonly SunnyBanksWorkspaceSnapshot[]): void;
  /** A real delete tap on one card. `snapshot` is the card as it was just before. */
  deleteEpisode(id: string, snapshot: SunnyBanksWorkspaceSnapshot | null): void;
  /** Read the server's cards and lay them over the screen. Never writes by itself. */
  refreshFromServer(): Promise<void>;
  /** Send any waiting card now (`keepalive` when the page is going away). */
  flush(keepalive?: boolean): void;
  /** Something waiting to go up (for the browser's own leave-page prompt). */
  hasUnsavedWork(): boolean;
  /** For tests and debugging. */
  debugState(): { mode: SunnybankEpisodeItemSyncMode; revisions: Record<string, number>; dirty: string[]; pendingDeletes: string[] };
}

export const SUNNYBANK_EPISODE_ITEM_DEBOUNCE_MS = 1000;
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

export function createSunnybankEpisodeItemSync(deps: SunnybankEpisodeItemSyncDeps): SunnybankEpisodeItemSync {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounceMs = deps.debounceMs ?? SUNNYBANK_EPISODE_ITEM_DEBOUNCE_MS;
  const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const refreshRetryDelays = deps.refreshRetryDelaysMs ?? DEFAULT_REFRESH_RETRY_DELAYS_MS;
  const problem = (m: string) => deps.onProblem?.(m);

  let mode: SunnybankEpisodeItemSyncMode = "idle";
  let generation = 0;
  let refreshAttempt = 0;
  let refreshTimer: TimerHandle | null = null;
  /** Server revision of every live card, as last seen. */
  const revisions = new Map<string, number>();
  /** Cards the server has soft-deleted. */
  const tombstones = new Set<string>();
  /** Cards with an edit not yet on the server; `base` is the copy the
   * first unsent edit was made on top of (`null` = the card was new). */
  const dirty = new Map<string, { base: SunnyBanksWorkspaceSnapshot | null }>();
  /** Delete taps not yet on the server, with the card as it was. */
  const pendingDeletes = new Map<string, { snapshot: SunnyBanksWorkspaceSnapshot | null }>();
  const timers = new Map<string, TimerHandle>();
  const inFlight = new Set<string>();
  const attempts = new Map<string, number>();

  const localCard = (id: string) => deps.getEpisodes().find((c) => c.id === id) ?? null;

  function clearCardTimer(id: string) {
    const t = timers.get(id);
    if (t !== undefined) {
      clearTimer(t);
      timers.delete(id);
    }
  }

  function schedule(id: string, ms: number = debounceMs) {
    clearCardTimer(id);
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
    for (const id of [...timers.keys()]) clearCardTimer(id);
    dirty.clear();
    pendingDeletes.clear();
    attempts.clear();
    if (message) problem(message);
  }

  /** Replace (or drop) one card on screen with the server's copy. */
  function adopt(id: string, item: DeckItemRecord | null, sentExpected: number) {
    clearCardTimer(id);
    attempts.delete(id);
    if (!item) {
      // No row at all, though this device thought there was one. Keep the
      // card on screen (a missing row never deletes anything) and send it
      // once more as new. If it was already sent as new, give up quietly.
      revisions.delete(id);
      pendingDeletes.delete(id);
      if (sentExpected !== DECK_ITEM_NEW_REVISION && localCard(id)) {
        dirty.set(id, { base: null });
        schedule(id);
      } else {
        dirty.delete(id);
      }
      return;
    }
    dirty.delete(id);
    pendingDeletes.delete(id);
    const list = deps.getEpisodes();
    if (item.deletedAt !== null) {
      revisions.delete(id);
      tombstones.add(id);
      if (list.some((c) => c.id === id)) deps.applyServerEpisodes(list.filter((c) => c.id !== id));
      return;
    }
    revisions.set(id, item.revision);
    tombstones.delete(id);
    const entry = episodeFromItem(item);
    if (!entry) return;
    const at = list.findIndex((c) => c.id === id);
    if (at >= 0) {
      if (sameEpisode(list[at], entry)) return;
      const next = list.slice();
      next[at] = entry;
      deps.applyServerEpisodes(next);
    } else {
      deps.applyServerEpisodes([...list, entry]);
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
    const sent = localCard(id);
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
        body: JSON.stringify({ kind: "sunnybank-episode", itemId: id, expectedRevision, data: sent }),
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
      const now = localCard(id);
      if (!now || sameEpisode(now, sent)) dirty.delete(id);
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
      problem(typeof body.error === "string" ? body.error : "A Sunnybank episode couldn't be saved.");
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
      const q = new URLSearchParams({ kind: "sunnybank-episode", itemId: id, expectedRevision: String(rev) });
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
      // card comes back. A second tap deletes the newer copy.
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
    // Held until the server's cards are in; rescheduled below.
    for (const id of [...timers.keys()]) clearCardTimer(id);
    let res: Response;
    let body: ListBody;
    try {
      res = await deps.fetch(`${DECK_ITEMS_ENDPOINT}?kind=sunnybank-episode`, { cache: "no-store" });
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
    const serverCards = new Map<string, SunnyBanksWorkspaceSnapshot>();
    for (const item of items) {
      revisions.set(item.itemId, item.revision);
      const entry = episodeFromItem(item);
      if (entry) serverCards.set(item.itemId, entry);
    }
    for (const t of tombs) tombstones.add(t.itemId);

    const local = deps.getEpisodes();
    const localById = new Map(local.map((c) => [c.id, c]));
    const keepLocal = new Set<string>(inFlight);

    for (const [id, { base }] of [...dirty]) {
      if (inFlight.has(id)) continue;
      const mine = localById.get(id);
      if (!mine) {
        dirty.delete(id);
        continue;
      }
      const theirs = serverCards.get(id);
      if (theirs) {
        if (sameEpisode(theirs, mine)) dirty.delete(id);
        else if (base && sameEpisode(theirs, base)) keepLocal.add(id);
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
      const theirs = serverCards.get(id);
      if (!theirs) {
        pendingDeletes.delete(id);
        continue;
      }
      if (snapshot && sameEpisode(theirs, snapshot)) keepLocal.add(id);
      else pendingDeletes.delete(id); // changed elsewhere since: it comes back
    }

    const { episodes, changed } = overlayEpisodeItems(local, items, tombstones, keepLocal);
    if (changed) deps.applyServerEpisodes(episodes);
    mode = "ready";
    for (const id of pendingDeletes.keys()) void pump(id, false);
    for (const id of dirty.keys()) if (!inFlight.has(id)) schedule(id);
  }

  return {
    noteLocalChange(before, after) {
      if (mode === "unavailable") return;
      const priorById = new Map(before.map((c) => [c.id, c]));
      for (const id of changedEpisodeIds(before, after)) {
        if (!dirty.has(id)) dirty.set(id, { base: priorById.get(id) ?? null });
        if (mode === "ready") schedule(id);
      }
    },
    deleteEpisode(id, snapshot) {
      if (mode === "unavailable") return;
      clearCardTimer(id);
      dirty.delete(id);
      pendingDeletes.set(id, { snapshot });
      if (mode === "ready") void pump(id, false);
    },
    refreshFromServer,
    flush(keepalive = false) {
      if (mode !== "ready") return;
      for (const id of [...timers.keys()]) {
        clearCardTimer(id);
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
