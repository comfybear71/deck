import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdultShortsShot, type AdultShortsSaved } from "./adultShorts";
import { ADULT_SHORT_ITEMS } from "./adultShortItems";
import type { DeckItemRecord } from "./deckItems";
import {
  changedDeckItemIds,
  createDeckItemSync,
  overlayDeckItems,
  sameDeckItem,
  type DeckItemEntry,
  type DeckItemKindConfig,
  type DeckItemSync,
} from "./deckItemSync";
import {
  buildEmptySunnyBanksLive,
  buildSunnyBanksWorkspaceFromLive,
  type SunnyBanksWorkspaceSnapshot,
} from "./sunnyBanksWorkspace";
import { SKIDMARKS_EPISODE_ITEMS } from "./skidmarksEpisodeItems";

/**
 * The same rules `lib/characterItems.test.ts` pins for characters, run
 * once for every other kind that saves per item, so every genre is held
 * to exactly the same behaviour.
 */

interface KindFixture<T extends DeckItemEntry> {
  name: string;
  config: DeckItemKindConfig<T>;
  /** A fresh entry with this id and visible label. */
  make: (id: string, label: string) => T;
  /** The label Stuart sees (episode title, short title). */
  label: (entry: T) => string;
  relabel: (entry: T, label: string) => T;
  /** An edit that isn't the label (so "only the changed item" is tested on real fields). */
  otherEdit: (entry: T) => T;
}

// Skidmarks episode cards (2026-10-04: the Sunny Banks structure).
const episodes: KindFixture<SunnyBanksWorkspaceSnapshot> = {
  name: "Skidmarks episodes",
  config: SKIDMARKS_EPISODE_ITEMS,
  make: (id, label) => ({
    ...buildSunnyBanksWorkspaceFromLive(
      { ...buildEmptySunnyBanksLive("skidmarks"), workspaceTitle: label },
      1_759_000_000_000,
      1,
      "skidmarks"
    ),
    id,
  }),
  label: (e) => e.label,
  relabel: (e, label) => ({ ...e, label }),
  otherEdit: (e) => ({ ...e, actScripts: { ...e.actScripts, I: "[Action: he kicks the bin]\nDap:" } }),
};

const shorts: KindFixture<AdultShortsSaved> = {
  name: "shorts",
  config: ADULT_SHORT_ITEMS,
  make: (id, label) => ({
    id,
    title: label,
    savedAt: "2026-09-29T10:00:00.000Z",
    character: { name: "Skye", look: "auburn hair", referenceUrls: [] },
    shots: [{ ...buildAdultShortsShot("shot_1"), prompt: "walks along the beach" }],
  }),
  label: (s) => s.title,
  relabel: (s, title) => ({ ...s, title }),
  otherEdit: (s) => ({ ...s, shots: s.shots.map((x) => ({ ...x, clipUrl: "https://x.public.blob.vercel-storage.com/c.mp4" })) }),
};

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A tiny fake of `/api/deck/items` over an in-memory table. */
function fakeServer(initial: DeckItemRecord[] = [], opts: { seeded?: boolean } = {}) {
  const rows = new Map(initial.map((r) => [r.itemId, { ...r }]));
  const calls: Call[] = [];
  let override: ((call: Call) => Response | Promise<Response> | null) | null = null;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const call = { method, url, body };
    calls.push(call);
    const o = override?.(call);
    if (o) return o;
    if (method === "GET") {
      const all = [...rows.values()];
      return jsonResponse(200, {
        ok: true,
        configured: true,
        ready: true,
        seeded: opts.seeded ?? all.length > 0,
        items: all.filter((r) => !r.deletedAt),
        deleted: all.filter((r) => r.deletedAt).map((r) => ({ itemId: r.itemId, revision: r.revision })),
      });
    }
    if (method === "PUT") {
      const id = body!.itemId as string;
      const expected = body!.expectedRevision as number;
      const cur = rows.get(id);
      const ok = expected === 0 ? !cur : !!cur && !cur.deletedAt && cur.revision === expected;
      if (!ok) return jsonResponse(409, { ok: false, conflict: true, item: cur ?? null });
      const next: DeckItemRecord = { itemId: id, folder: "f", data: body!.data, revision: (cur?.revision ?? 0) + 1, updatedAt: "t", deletedAt: null };
      rows.set(id, next);
      return jsonResponse(200, { ok: true, item: next });
    }
    if (method === "DELETE") {
      const q = new URL(url, "http://x").searchParams;
      const id = q.get("itemId")!;
      const cur = rows.get(id);
      if (!cur) return jsonResponse(404, { ok: false, notFound: true });
      if (cur.revision !== Number(q.get("expectedRevision"))) return jsonResponse(409, { ok: false, conflict: true, item: cur });
      const next = { ...cur, revision: cur.revision + 1, deletedAt: "t" };
      rows.set(id, next);
      return jsonResponse(200, { ok: true, item: next });
    }
    return jsonResponse(405, {});
  });
  return {
    rows,
    calls,
    fetch,
    writes: () => calls.filter((c) => c.method !== "GET"),
    setOverride(fn: typeof override) {
      override = fn;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function suite<T extends DeckItemEntry>(fx: KindFixture<T>) {
  const { config } = fx;
  const item = (e: T, revision: number, deletedAt: string | null = null): DeckItemRecord => ({
    itemId: e.id,
    folder: "f",
    data: e,
    revision,
    updatedAt: "2026-09-30T00:00:00Z",
    deletedAt,
  });
  const labels = (list: readonly T[]) => list.map(fx.label);
  const ids = (list: readonly T[]) => list.map((e) => e.id);

  /** A stand-in for the store in `lib/skidmarks.ts`. */
  function harness(initialLocal: T[], server: ReturnType<typeof fakeServer>) {
    let local = initialLocal.slice();
    const applied: T[][] = [];
    const sync: DeckItemSync<T> = createDeckItemSync(config, {
      fetch: server.fetch as unknown as (input: string, init?: RequestInit) => Promise<Response>,
      getEntries: () => local,
      applyServerEntries: (next) => {
        applied.push(next);
        local = next;
      },
      debounceMs: 1000,
    });
    /** What the store's patch function does. */
    const patch = (fn: (list: T[]) => T[]) => {
      const before = local;
      local = fn(before.map((c) => ({ ...c })));
      sync.noteLocalChange(before, local);
    };
    const edit = (id: string, fn: (e: T) => T) => patch((list) => list.map((e) => (e.id === id ? fn(e) : e)));
    return { sync, patch, edit, applied, local: () => local };
  }

  describe(`${fx.name}: pure helpers`, () => {
    const a = fx.make("id_a", "A");
    const b = fx.make("id_b", "B");

    it("lists only what changed, never what is missing", () => {
      expect(changedDeckItemIds(config, [a, b], [{ ...a }, { ...b }])).toEqual([]);
      expect(changedDeckItemIds(config, [a, b], [a, fx.otherEdit(b)])).toEqual(["id_b"]);
      expect(changedDeckItemIds(config, [a], [a, b])).toEqual(["id_b"]);
      expect(changedDeckItemIds(config, [a, b], [a])).toEqual([]);
      expect(changedDeckItemIds(config, [a, b], [])).toEqual([]);
    });

    it("ignores key order", () => {
      const shuffled = Object.fromEntries(Object.entries(a).reverse()) as unknown as T;
      expect(sameDeckItem(config, a, shuffled)).toBe(true);
    });

    it("overlay: server wins, adds what's missing here, keeps unknown local items, drops deleted ones", () => {
      const serverA = fx.relabel(a, "A (server)");
      const c = fx.make("id_c", "C");
      const out = overlayDeckItems(config, [a, b, c], [item(serverA, 4), item(fx.make("id_d", "D"), 1)], ["id_b"]);
      expect(out.changed).toBe(true);
      expect(labels(out.entries)).toEqual(["A (server)", "C", "D"]);
    });

    it("overlay: nothing changes when everything already matches", () => {
      const out = overlayDeckItems(config, [a, b], [item(b, 3), item(a, 1)], []);
      expect(out.changed).toBe(false);
      expect(out.entries).toEqual([a, b]);
    });
  });

  describe(`${fx.name}: loading never writes, the client never seeds`, () => {
    it("a load that changes what's on screen sends only the GET, for this kind", async () => {
      const a = fx.make("id_a", "A");
      const b = fx.make("id_b", "B");
      const server = fakeServer([item(fx.relabel(a, "A v2"), 3), item(b, 1)]);
      const h = harness([a], server);
      await h.sync.refreshFromServer();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(server.writes()).toEqual([]);
      expect(server.calls[0].url).toBe(`/api/deck/items?kind=${config.kind}`);
      expect(labels(h.local())).toEqual(["A v2", "B"]);
      expect(h.sync.debugState()).toMatchObject({ mode: "ready", revisions: { id_a: 3, id_b: 1 }, dirty: [] });
    });

    it("with no rows yet (seed not run) it stays off and never uploads this device's items", async () => {
      const server = fakeServer([]);
      const h = harness([fx.make("id_a", "A")], server);
      await h.sync.refreshFromServer();
      h.edit("id_a", (e) => fx.relabel(e, "A2"));
      h.patch((list) => [...list, fx.make("id_new", "New")]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.sync.debugState().mode).toBe("unavailable");
      expect(server.writes()).toEqual([]);
    });

    it("table missing: quietly off, nothing written, nothing changed on screen", async () => {
      const server = fakeServer([]);
      server.setOverride((c) => (c.method === "GET" ? jsonResponse(503, { ok: false, configured: true, ready: false, tableMissing: true }) : null));
      const h = harness([fx.make("id_a", "A")], server);
      await h.sync.refreshFromServer();
      h.edit("id_a", (e) => fx.relabel(e, "x"));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.sync.debugState().mode).toBe("unavailable");
      expect(server.writes()).toEqual([]);
      expect(h.applied).toEqual([]);
    });
  });

  describe(`${fx.name}: real changes write, one item at a time`, () => {
    it("debounces a burst of edits into one PUT with the known revision and this kind", async () => {
      const a = fx.make("id_a", "A");
      const b = fx.make("id_b", "B");
      const server = fakeServer([item(a, 5), item(b, 2)]);
      const h = harness([a, b], server);
      await h.sync.refreshFromServer();
      h.edit("id_a", (e) => fx.relabel(e, "A1"));
      h.edit("id_a", (e) => fx.relabel(e, "A12"));
      h.edit("id_a", (e) => fx.relabel(e, "A123"));
      await vi.advanceTimersByTimeAsync(999);
      expect(server.writes()).toEqual([]);
      await vi.advanceTimersByTimeAsync(10);
      expect(server.writes()).toHaveLength(1);
      expect(server.writes()[0].body).toMatchObject({ kind: config.kind, itemId: "id_a", expectedRevision: 5 });
      expect(fx.label(server.writes()[0].body!.data as T)).toBe("A123");
      expect(h.sync.debugState()).toMatchObject({ revisions: { id_a: 6, id_b: 2 }, dirty: [] });
    });

    it("only the item that changed is sent; a new one goes with expectedRevision 0", async () => {
      const a = fx.make("id_a", "A");
      const b = fx.make("id_b", "B");
      const server = fakeServer([item(a, 1), item(b, 1)]);
      const h = harness([a, b], server);
      await h.sync.refreshFromServer();
      h.edit("id_b", fx.otherEdit);
      h.patch((list) => [...list, fx.make("id_new", "New")]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(server.writes().map((w) => [w.body!.itemId, w.body!.expectedRevision])).toEqual([
        ["id_b", 1],
        ["id_new", 0],
      ]);
    });

    it("an edit made while a save is in flight goes up next, on the new revision", async () => {
      const a = fx.make("id_a", "A");
      const server = fakeServer([item(a, 1)]);
      const h = harness([a], server);
      await h.sync.refreshFromServer();
      h.edit("id_a", (e) => fx.relabel(e, "one"));
      await vi.advanceTimersByTimeAsync(1000);
      h.edit("id_a", (e) => fx.relabel(e, "two"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(server.writes().map((w) => w.body!.expectedRevision)).toEqual([1, 2]);
      expect(fx.label(server.rows.get("id_a")!.data as T)).toBe("two");
    });

    it("retries a network failure, then succeeds; flush sends at once", async () => {
      const a = fx.make("id_a", "A");
      const server = fakeServer([item(a, 1)]);
      const h = harness([a], server);
      await h.sync.refreshFromServer();
      let fail = true;
      server.setOverride((c) => {
        if (c.method === "PUT" && fail) {
          fail = false;
          throw new TypeError("Load failed");
        }
        return null;
      });
      h.edit("id_a", (e) => fx.relabel(e, "x"));
      h.sync.flush();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.sync.hasUnsavedWork()).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(server.rows.get("id_a")!.revision).toBe(2);
      expect(h.sync.hasUnsavedWork()).toBe(false);
    });
  });

  describe(`${fx.name}: 409 means this device adopts the server's copy`, () => {
    it("takes the server's item and drops this device's edit, with no retry on top", async () => {
      const a = fx.make("id_a", "A");
      const server = fakeServer([item(a, 1)]);
      const h = harness([a], server);
      await h.sync.refreshFromServer();
      server.rows.set("id_a", item(fx.relabel(a, "From the PC"), 2));
      h.edit("id_a", (e) => fx.relabel(e, "Old phone edit"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(labels(h.local())).toEqual(["From the PC"]);
      expect(h.sync.debugState()).toMatchObject({ revisions: { id_a: 2 }, dirty: [] });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(server.writes()).toHaveLength(1);
      expect(fx.label(server.rows.get("id_a")!.data as T)).toBe("From the PC");
    });

    it("an item deleted on another device disappears here instead of coming back", async () => {
      const a = fx.make("id_a", "A");
      const server = fakeServer([item(a, 1)]);
      const h = harness([a], server);
      await h.sync.refreshFromServer();
      server.rows.set("id_a", item(a, 2, "t"));
      h.edit("id_a", (e) => fx.relabel(e, "stale"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.local()).toEqual([]);
    });
  });

  describe(`${fx.name}: an item missing from a device never deletes`, () => {
    it("a thin list drops an item without a delete tap: nothing is written", async () => {
      const a = fx.make("id_a", "A");
      const b = fx.make("id_b", "B");
      const server = fakeServer([item(a, 1), item(b, 4)]);
      const h = harness([a, b], server);
      await h.sync.refreshFromServer();
      h.patch((list) => list.filter((e) => e.id !== "id_b"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(server.writes()).toEqual([]);
      expect(server.rows.get("id_b")).toMatchObject({ revision: 4, deletedAt: null });
    });

    it("a session load that lacks an item gets it back from the server, with no write", async () => {
      const a = fx.make("id_a", "A");
      const b = fx.make("id_b", "B");
      const server = fakeServer([item(a, 1), item(b, 1)]);
      const h = harness([a], server);
      await h.sync.refreshFromServer();
      expect(ids(h.local())).toEqual(["id_a", "id_b"]);
      expect(server.writes()).toEqual([]);
    });

    it("only a real delete tap sends a DELETE, with this kind and the known revision", async () => {
      const a = fx.make("id_a", "A");
      const b = fx.make("id_b", "B");
      const server = fakeServer([item(a, 1), item(b, 3)]);
      const h = harness([a, b], server);
      await h.sync.refreshFromServer();
      h.patch((list) => list.filter((e) => e.id !== "id_b"));
      h.sync.deleteItem("id_b", b);
      await vi.advanceTimersByTimeAsync(0);
      const del = server.writes();
      expect(del).toHaveLength(1);
      expect(del[0].method).toBe("DELETE");
      expect(del[0].url).toContain(`kind=${config.kind}`);
      expect(del[0].url).toContain("itemId=id_b");
      expect(del[0].url).toContain("expectedRevision=3");
      expect(server.rows.get("id_b")!.deletedAt).toBe("t");
    });

    it("a delete refused because the item changed elsewhere brings the newer copy back", async () => {
      const b = fx.make("id_b", "B");
      const server = fakeServer([item(b, 3)]);
      const h = harness([b], server);
      await h.sync.refreshFromServer();
      server.rows.set("id_b", item(fx.relabel(b, "B (PC)"), 4));
      h.patch((list) => list.filter((e) => e.id !== "id_b"));
      h.sync.deleteItem("id_b", b);
      await vi.advanceTimersByTimeAsync(0);
      expect(labels(h.local())).toEqual(["B (PC)"]);
      expect(server.rows.get("id_b")!.deletedAt).toBeNull();
    });
  });

  describe(`${fx.name}: edits made before the server's items arrive`, () => {
    it("keeps an edit made on top of the server's current copy and sends it", async () => {
      const a = fx.make("id_a", "A");
      const server = fakeServer([item(a, 2)]);
      const h = harness([a], server);
      h.edit("id_a", (e) => fx.relabel(e, "edited early"));
      await vi.advanceTimersByTimeAsync(5000);
      expect(server.writes()).toEqual([]);
      await h.sync.refreshFromServer();
      await vi.advanceTimersByTimeAsync(1000);
      expect(server.writes()[0].body).toMatchObject({ itemId: "id_a", expectedRevision: 2 });
      expect(labels(h.local())).toEqual(["edited early"]);
    });

    it("drops an edit made on top of an older copy: the server's copy wins, nothing is written", async () => {
      const stale = fx.make("id_a", "A (old phone)");
      const server = fakeServer([item(fx.relabel(stale, "A (newer, PC)"), 9)]);
      const h = harness([stale], server);
      h.edit("id_a", fx.otherEdit);
      await h.sync.refreshFromServer();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(server.writes()).toEqual([]);
      expect(labels(h.local())).toEqual(["A (newer, PC)"]);
    });
  });
}

suite(episodes);
suite(shorts);

describe("orderMissing: shorts this device didn't have go in newest first, after its own", () => {
  it("orders only the added ones, by savedAt, newest first", () => {
    const mine = { ...shorts.make("short_mine", "Mine"), savedAt: "2026-09-01T00:00:00.000Z" };
    const older = { ...shorts.make("short_old", "Old"), savedAt: "2026-09-10T00:00:00.000Z" };
    const newer = { ...shorts.make("short_new", "New"), savedAt: "2026-09-20T00:00:00.000Z" };
    const rec = (e: AdultShortsSaved, revision = 1): DeckItemRecord => ({ itemId: e.id, folder: "adult-shorts", data: e, revision, updatedAt: null, deletedAt: null });
    const out = overlayDeckItems(ADULT_SHORT_ITEMS, [mine], [rec(older), rec(mine), rec(newer)], []);
    expect(out.entries.map((e) => e.id)).toEqual(["short_mine", "short_new", "short_old"]);
  });

  it("a kind with no orderMissing keeps the server's order (Skidmarks episodes)", () => {
    const a = episodes.make("ep_a", "A");
    const b = episodes.make("ep_b", "B");
    const rec = (e: SunnyBanksWorkspaceSnapshot): DeckItemRecord => ({ itemId: e.id, folder: "skidmarks", data: e, revision: 1, updatedAt: null, deletedAt: null });
    expect(overlayDeckItems(SKIDMARKS_EPISODE_ITEMS, [], [rec(b), rec(a)], []).entries.map((e) => e.id)).toEqual(["ep_b", "ep_a"]);
  });
});
