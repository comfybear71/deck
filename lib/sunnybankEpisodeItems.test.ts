import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmptySunnyBanksLive,
  buildSunnyBanksWorkspaceFromLive,
  type SunnyBanksWorkspaceSnapshot,
} from "./sunnyBanksWorkspace";
import {
  changedEpisodeIds,
  createSunnybankEpisodeItemSync,
  overlayEpisodeItems,
  sameEpisode,
  type SunnybankEpisodeItemSync,
} from "./sunnybankEpisodeItems";
import type { DeckItemRecord } from "./deckItems";

/** A saved episode card, as `saveSunnyBanksProjectWorkspace` makes one. */
function ep(id: string, label: string, extra: Partial<SunnyBanksWorkspaceSnapshot> = {}): SunnyBanksWorkspaceSnapshot {
  const live = { ...buildEmptySunnyBanksLive(), workspaceTitle: label };
  live.actScripts = { ...live.actScripts, I: `SHAZZA: ${label}` };
  return { ...buildSunnyBanksWorkspaceFromLive(live, Date.parse("2026-09-30T00:00:00Z"), 1), id, ...extra };
}

function withClip(e: SunnyBanksWorkspaceSnapshot, url: string): SunnyBanksWorkspaceSnapshot {
  return { ...e, runtimeMap: { ...e.runtimeMap, I: { 0: { lineKey: "SHAZZA: x", status: "done", videoUrl: url } } } };
}

function item(c: SunnyBanksWorkspaceSnapshot, revision: number, deletedAt: string | null = null): DeckItemRecord {
  return { itemId: c.id, folder: "sunnybank", data: c, revision, updatedAt: "2026-09-30T00:00:00Z", deletedAt };
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

describe("changedEpisodeIds (diff logic)", () => {
  const a = ep("ws-a", "Shazza");
  const b = ep("ws-b", "Jack");

  it("lists nothing when nothing changed", () => {
    expect(changedEpisodeIds([a, b], [{ ...a }, { ...b, actIds: [...b.actIds] }])).toEqual([]);
  });

  it("lists only the card that changed", () => {
    expect(changedEpisodeIds([a, b], [a, { ...b, label: "Jack Ash" }])).toEqual(["ws-b"]);
  });

  it("lists a new card", () => {
    const c = ep("ws-c", "Big Sexy");
    expect(changedEpisodeIds([a, b], [a, b, c])).toEqual(["ws-c"]);
  });

  it("never lists a card that is missing from the new list", () => {
    expect(changedEpisodeIds([a, b], [a])).toEqual([]);
    expect(changedEpisodeIds([a, b], [])).toEqual([]);
  });

  it("ignores key order and defaults the loader fills in", () => {
    const reordered = JSON.parse(JSON.stringify(a)) as SunnyBanksWorkspaceSnapshot;
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as SunnyBanksWorkspaceSnapshot;
    expect(sameEpisode(a, shuffled)).toBe(true);
    expect(changedEpisodeIds([a], [shuffled])).toEqual([]);
  });

  it("sees a finished clip added as a change", () => {
    const withPic = withClip(a, "https://x.public.blob.vercel-storage.com/c.mp4");
    expect(changedEpisodeIds([a], [withPic])).toEqual(["ws-a"]);
  });
});

describe("overlayEpisodeItems", () => {
  const a = ep("ws-a", "Shazza");
  const b = ep("ws-b", "Jack");

  it("server cards win over this device's copy", () => {
    const serverA = { ...a, label: "Shazza (server)" };
    const out = overlayEpisodeItems([a, b], [item(serverA, 4), item(b, 1)], []);
    expect(out.changed).toBe(true);
    expect(out.episodes.map((c) => c.label)).toEqual(["Shazza (server)", "Jack"]);
  });

  it("adds server cards this device doesn't have", () => {
    const out = overlayEpisodeItems([a], [item(a, 1), item(b, 1)], []);
    expect(out.episodes.map((c) => c.id)).toEqual(["ws-a", "ws-b"]);
  });

  it("keeps a local card the server doesn't know (never removes it)", () => {
    const out = overlayEpisodeItems([a, b], [item(a, 1)], []);
    expect(out.episodes.map((c) => c.id)).toEqual(["ws-a", "ws-b"]);
    expect(out.changed).toBe(false);
  });

  it("drops a card the server has deleted", () => {
    const out = overlayEpisodeItems([a, b], [item(a, 1)], ["ws-b"]);
    expect(out.episodes.map((c) => c.id)).toEqual(["ws-a"]);
  });

  it("keeps this device's version for ids in keepLocal, and doesn't re-add them", () => {
    const localA = { ...a, label: "Mine" };
    const out = overlayEpisodeItems([localA], [item(a, 2), item(b, 1)], [], new Set(["ws-a", "ws-b"]));
    expect(out.episodes.map((c) => c.label)).toEqual(["Mine"]);
  });

  it("reports no change when everything already matches", () => {
    const out = overlayEpisodeItems([a, b], [item(b, 3), item(a, 1)], []);
    expect(out.changed).toBe(false);
    expect(out.episodes).toEqual([a, b]);
  });

  it("puts server episodes this device doesn't have after its own, newest first", () => {
    const older = ep("ws-old", "Older", { savedAt: 1000 });
    const newer = ep("ws-new", "Newer", { savedAt: 2000 });
    const out = overlayEpisodeItems([a], [item(older, 1), item(a, 1), item(newer, 1)], []);
    expect(out.episodes.map((c) => c.id)).toEqual(["ws-a", "ws-new", "ws-old"]);
  });

  it("fills an empty shelf (a session with no Sunnybank) from the server, with no write needed", () => {
    const out = overlayEpisodeItems([], [item(a, 2), item(b, 1)], []);
    expect(out.changed).toBe(true);
    expect(out.episodes.map((c) => c.id)).toEqual(["ws-a", "ws-b"]);
  });

  it("ignores a server row whose data id doesn't match its item id", () => {
    const out = overlayEpisodeItems([], [{ ...item(a, 1), itemId: "ws-other" }], []);
    expect(out.episodes).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The engine                                                           */
/* ------------------------------------------------------------------ */

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
      const next: DeckItemRecord = { itemId: id, folder: "sunnybank", data: body!.data, revision: (cur?.revision ?? 0) + 1, updatedAt: "t", deletedAt: null };
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

/** A stand-in for the store in `lib/skidmarks.ts`. */
function harness(initialLocal: SunnyBanksWorkspaceSnapshot[], server: ReturnType<typeof fakeServer>) {
  let local = initialLocal.slice();
  const applied: SunnyBanksWorkspaceSnapshot[][] = [];
  const sync: SunnybankEpisodeItemSync = createSunnybankEpisodeItemSync({
    fetch: server.fetch as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    getEpisodes: () => local,
    applyServerEpisodes: (next) => {
      applied.push(next);
      local = next;
    },
    debounceMs: 1000,
  });
  /** What `saveSunnyBanksProjectWorkspace` does to the shelf. */
  const patch = (fn: (list: SunnyBanksWorkspaceSnapshot[]) => SunnyBanksWorkspaceSnapshot[]) => {
    const before = local;
    local = fn(before.map((c) => ({ ...c })));
    sync.noteLocalChange(before, local);
  };
  return { sync, patch, applied, local: () => local };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createSunnybankEpisodeItemSync: loading never writes", () => {
  it("a load that changes what's on screen sends only the GET", async () => {
    const a = ep("ws-a", "Shazza");
    const b = ep("ws-b", "Jack");
    const server = fakeServer([item({ ...a, label: "Shazza v2" }, 3), item(b, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.writes()).toEqual([]);
    expect(h.local().map((c) => c.label)).toEqual(["Shazza v2", "Jack"]);
    expect(h.sync.debugState()).toMatchObject({ mode: "ready", revisions: { "ws-a": 3, "ws-b": 1 }, dirty: [] });
  });

  it("a second load (after a session reload) doesn't write either", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 2)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.writes()).toEqual([]);
  });

  it("never seeds: with no rows yet (seed not run) it stays off and never uploads this device's cards", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, label: "Shazza B" })));
    h.patch((list) => [...list, ep("ws-new", "New")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sync.debugState().mode).toBe("unavailable");
    expect(server.writes()).toEqual([]);
  });

  it("table missing: quietly off, no writes, the whole-session save is untouched", async () => {
    const server = fakeServer([]);
    server.setOverride((c) => (c.method === "GET" ? jsonResponse(503, { ok: false, configured: true, ready: false, tableMissing: true }) : null));
    const h = harness([ep("ws-a", "Shazza")], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, label: "x" })));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sync.debugState().mode).toBe("unavailable");
    expect(server.writes()).toEqual([]);
    expect(h.applied).toEqual([]);
  });

  it("no database here: quietly off", async () => {
    const server = fakeServer([]);
    server.setOverride((c) => (c.method === "GET" ? jsonResponse(200, { ok: false, configured: false }) : null));
    const h = harness([ep("ws-a", "Shazza")], server);
    await h.sync.refreshFromServer();
    expect(h.sync.debugState().mode).toBe("unavailable");
  });
});

describe("createSunnybankEpisodeItemSync: real changes write, one card at a time", () => {
  it("debounces a burst of edits to one card into one PUT with the known revision", async () => {
    const a = ep("ws-a", "Shazza");
    const b = ep("ws-b", "Jack");
    const server = fakeServer([item(a, 5), item(b, 2)]);
    const h = harness([a, b], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => (c.id === "ws-a" ? { ...c, label: "S" } : c)));
    h.patch((list) => list.map((c) => (c.id === "ws-a" ? { ...c, label: "Sh" } : c)));
    h.patch((list) => list.map((c) => (c.id === "ws-a" ? { ...c, label: "Sha" } : c)));
    await vi.advanceTimersByTimeAsync(999);
    expect(server.writes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(server.writes()).toHaveLength(1);
    expect(server.writes()[0].body).toMatchObject({ kind: "sunnybank-episode", itemId: "ws-a", expectedRevision: 5 });
    expect((server.writes()[0].body!.data as SunnyBanksWorkspaceSnapshot).label).toBe("Sha");
    expect(h.sync.debugState()).toMatchObject({ revisions: { "ws-a": 6, "ws-b": 2 }, dirty: [] });
  });

  it("an unchanged card is never sent", async () => {
    const a = ep("ws-a", "Shazza");
    const b = ep("ws-b", "Jack");
    const server = fakeServer([item(a, 1), item(b, 1)]);
    const h = harness([a, b], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => (c.id === "ws-b" ? { ...c, savedAt: 999 } : c)));
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.writes().map((w) => w.body!.itemId)).toEqual(["ws-b"]);
  });

  it("a new card is sent with expectedRevision 0", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => [...list, ep("ws-new", "Big Sexy")]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "ws-new", expectedRevision: 0 });
    expect(server.rows.get("ws-new")?.revision).toBe(1);
  });

  it("an edit made while a save is in flight goes up next, on the new revision", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, label: "one" })));
    await vi.advanceTimersByTimeAsync(1000);
    h.patch((list) => list.map((c) => ({ ...c, label: "two" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes().map((w) => w.body!.expectedRevision)).toEqual([1, 2]);
    expect((server.rows.get("ws-a")!.data as SunnyBanksWorkspaceSnapshot).label).toBe("two");
  });

  it("retries a network failure, then succeeds", async () => {
    const a = ep("ws-a", "Shazza");
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
    h.patch((list) => list.map((c) => ({ ...c, label: "x" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sync.hasUnsavedWork()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.rows.get("ws-a")!.revision).toBe(2);
    expect(h.sync.hasUnsavedWork()).toBe(false);
  });

  it("flush sends a waiting card immediately", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, label: "x" })));
    h.sync.flush(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.writes()).toHaveLength(1);
  });
});

describe("createSunnybankEpisodeItemSync: 409 adopts the server's copy", () => {
  it("takes the server's card and drops this device's edit to it", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    // Another device saves first.
    server.rows.set("ws-a", item({ ...a, label: "From the PC" }, 2));
    h.patch((list) => list.map((c) => ({ ...c, label: "Old phone edit" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()).toHaveLength(1);
    expect(h.local()[0].label).toBe("From the PC");
    expect(h.sync.debugState()).toMatchObject({ revisions: { "ws-a": 2 }, dirty: [] });
    // And nothing is retried on top of it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toHaveLength(1);
    expect((server.rows.get("ws-a")!.data as SunnyBanksWorkspaceSnapshot).label).toBe("From the PC");
  });

  it("a card deleted on another device disappears here instead of being brought back", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    server.rows.set("ws-a", item(a, 2, "t"));
    h.patch((list) => list.map((c) => ({ ...c, label: "stale edit" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.local()).toEqual([]);
    expect(server.rows.get("ws-a")!.deletedAt).toBe("t");
  });

  it("a new card whose id already exists on the server takes the server's copy", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(ep("ws-x", "X"), 1)]);
    const h = harness([], server);
    await h.sync.refreshFromServer();
    server.rows.set("ws-a", item({ ...a, label: "Server" }, 7));
    h.patch((list) => [...list, a]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.local().find((c) => c.id === "ws-a")?.label).toBe("Server");
    expect(h.sync.debugState().revisions["ws-a"]).toBe(7);
  });
});

describe("createSunnybankEpisodeItemSync: a missing episode never deletes", () => {
  it("a card missing from this device's list is never deleted or overwritten", async () => {
    const a = ep("ws-a", "Shazza");
    const b = ep("ws-b", "Jack");
    const server = fakeServer([item(a, 1), item(b, 4)]);
    const h = harness([a, b], server);
    await h.sync.refreshFromServer();
    // An old copy / thin list drops Jack without a delete tap.
    h.patch((list) => list.filter((c) => c.id !== "ws-b"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toEqual([]);
    expect(server.rows.get("ws-b")).toMatchObject({ revision: 4, deletedAt: null });
  });

  it("a session load that lacks a card gets it back from the server, with no write", async () => {
    const a = ep("ws-a", "Shazza");
    const b = ep("ws-b", "Jack");
    const server = fakeServer([item(a, 1), item(b, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    expect(h.local().map((c) => c.id)).toEqual(["ws-a", "ws-b"]);
    expect(server.writes()).toEqual([]);
  });

  it("an edit to a card that then vanishes locally sends nothing", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, label: "x" })));
    h.patch(() => []);
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.writes()).toEqual([]);
  });

  it("only a real delete tap sends a DELETE, with the known revision", async () => {
    const a = ep("ws-a", "Shazza");
    const b = ep("ws-b", "Jack");
    const server = fakeServer([item(a, 1), item(b, 3)]);
    const h = harness([a, b], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.filter((c) => c.id !== "ws-b"));
    h.sync.deleteEpisode("ws-b", b);
    await vi.advanceTimersByTimeAsync(0);
    const del = server.writes();
    expect(del).toHaveLength(1);
    expect(del[0].method).toBe("DELETE");
    expect(del[0].url).toContain("kind=sunnybank-episode");
    expect(del[0].url).toContain("itemId=ws-b");
    expect(del[0].url).toContain("expectedRevision=3");
    expect(server.rows.get("ws-b")!.deletedAt).toBe("t");
  });

  it("a delete refused because the card changed elsewhere brings the newer card back", async () => {
    const b = ep("ws-b", "Jack");
    const server = fakeServer([item(b, 3)]);
    const h = harness([b], server);
    await h.sync.refreshFromServer();
    server.rows.set("ws-b", item({ ...b, label: "Jack (PC)" }, 4));
    h.patch((list) => list.filter((c) => c.id !== "ws-b"));
    h.sync.deleteEpisode("ws-b", b);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.local().map((c) => c.label)).toEqual(["Jack (PC)"]);
    expect(server.rows.get("ws-b")!.deletedAt).toBeNull();
  });
});

describe("createSunnybankEpisodeItemSync: edits made before the server's cards arrive", () => {
  it("keeps an edit made on top of the server's current copy and sends it", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 2)]);
    const h = harness([a], server);
    h.patch((list) => list.map((c) => ({ ...c, label: "edited early" })));
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.writes()).toEqual([]); // held until the load
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "ws-a", expectedRevision: 2 });
    expect(h.local()[0].label).toBe("edited early");
  });

  it("drops an edit made on top of an older copy: the server's copy wins, nothing is written", async () => {
    const stale = ep("ws-a", "Shazza (old phone)");
    const server = fakeServer([item({ ...stale, label: "Shazza (newer, PC)" }, 9)]);
    const h = harness([stale], server);
    h.patch((list) => list.map((c) => ({ ...c, savedAt: 999 })));
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.writes()).toEqual([]);
    expect(h.local()[0].label).toBe("Shazza (newer, PC)");
  });

  it("a card created before the load is sent as new", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    h.patch((list) => [...list, ep("ws-new", "New")]);
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "ws-new", expectedRevision: 0 });
    expect(h.local().map((c) => c.id)).toEqual(["ws-a", "ws-new"]);
  });

  it("a failed load retries and holds edits until it succeeds", async () => {
    const a = ep("ws-a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    let down = true;
    server.setOverride((c) => {
      if (c.method === "GET" && down) {
        down = false;
        return jsonResponse(502, { ok: false, configured: true, error: "boom" });
      }
      return null;
    });
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    expect(h.sync.debugState().mode).toBe("stale");
    h.patch((list) => list.map((c) => ({ ...c, label: "x" })));
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.writes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.debugState().mode).toBe("ready");
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()).toHaveLength(1);
  });
});
