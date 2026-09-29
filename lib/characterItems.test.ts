import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCharacterLoraEntry, SKYE_SEED, type CharacterLoraEntry } from "./characterLoras";
import {
  changedCharacterIds,
  createCharacterItemSync,
  overlayCharacterItems,
  sameCharacter,
  type CharacterItemSync,
} from "./characterItems";
import type { DeckItemRecord } from "./deckItems";

function card(id: string, name: string, extra: Partial<CharacterLoraEntry> = {}): CharacterLoraEntry {
  return { ...buildCharacterLoraEntry(name, [], new Date("2026-09-30T00:00:00Z")), id, ...extra };
}

function item(c: CharacterLoraEntry, revision: number, deletedAt: string | null = null): DeckItemRecord {
  return { itemId: c.id, folder: "deck", data: c, revision, updatedAt: "2026-09-30T00:00:00Z", deletedAt };
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

describe("changedCharacterIds (diff logic)", () => {
  const a = card("clora_a", "Shazza");
  const b = card("clora_b", "Jack");

  it("lists nothing when nothing changed", () => {
    expect(changedCharacterIds([a, b], [{ ...a }, { ...b, trainingImageUrls: [...b.trainingImageUrls] }])).toEqual([]);
  });

  it("lists only the card that changed", () => {
    expect(changedCharacterIds([a, b], [a, { ...b, name: "Jack Ash" }])).toEqual(["clora_b"]);
  });

  it("lists a new card", () => {
    const c = card("clora_c", "Big Sexy");
    expect(changedCharacterIds([a, b], [a, b, c])).toEqual(["clora_c"]);
  });

  it("never lists a card that is missing from the new list", () => {
    expect(changedCharacterIds([a, b], [a])).toEqual([]);
    expect(changedCharacterIds([a, b], [])).toEqual([]);
  });

  it("ignores key order and defaults the loader fills in", () => {
    const reordered = JSON.parse(JSON.stringify({ ...a, autoTrain: false, pictureRound: 0 })) as CharacterLoraEntry;
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as CharacterLoraEntry;
    expect(sameCharacter(a, shuffled)).toBe(true);
    expect(changedCharacterIds([a], [shuffled])).toEqual([]);
  });

  it("sees a picture added as a change", () => {
    const withPic = { ...a, trainingImageUrls: ["https://x.public.blob.vercel-storage.com/p.png"] };
    expect(changedCharacterIds([a], [withPic])).toEqual(["clora_a"]);
  });
});

describe("overlayCharacterItems", () => {
  const a = card("clora_a", "Shazza");
  const b = card("clora_b", "Jack");

  it("server cards win over this device's copy", () => {
    const serverA = { ...a, name: "Shazza (server)" };
    const out = overlayCharacterItems([a, b], [item(serverA, 4), item(b, 1)], []);
    expect(out.changed).toBe(true);
    expect(out.characters.map((c) => c.name)).toEqual(["Shazza (server)", "Jack"]);
  });

  it("adds server cards this device doesn't have", () => {
    const out = overlayCharacterItems([a], [item(a, 1), item(b, 1)], []);
    expect(out.characters.map((c) => c.id)).toEqual(["clora_a", "clora_b"]);
  });

  it("keeps a local card the server doesn't know (never removes it)", () => {
    const out = overlayCharacterItems([a, b], [item(a, 1)], []);
    expect(out.characters.map((c) => c.id)).toEqual(["clora_a", "clora_b"]);
    expect(out.changed).toBe(false);
  });

  it("drops a card the server has deleted", () => {
    const out = overlayCharacterItems([a, b], [item(a, 1)], ["clora_b"]);
    expect(out.characters.map((c) => c.id)).toEqual(["clora_a"]);
  });

  it("keeps this device's version for ids in keepLocal, and doesn't re-add them", () => {
    const localA = { ...a, name: "Mine" };
    const out = overlayCharacterItems([localA], [item(a, 2), item(b, 1)], [], new Set(["clora_a", "clora_b"]));
    expect(out.characters.map((c) => c.name)).toEqual(["Mine"]);
  });

  it("reports no change when everything already matches", () => {
    const out = overlayCharacterItems([a, b], [item(b, 3), item(a, 1)], []);
    expect(out.changed).toBe(false);
    expect(out.characters).toEqual([a, b]);
  });

  it("replaces the Skye seed on a session with no characterLoras", () => {
    const skye = { ...SKYE_SEED, trainingImageUrls: ["https://x.public.blob.vercel-storage.com/s.png"] };
    const out = overlayCharacterItems([{ ...SKYE_SEED }], [item(skye, 2), item(a, 1)], []);
    expect(out.characters[0].trainingImageUrls).toHaveLength(1);
    expect(out.characters.map((c) => c.id)).toEqual(["clora_skye", "clora_a"]);
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
      const next: DeckItemRecord = { itemId: id, folder: "deck", data: body!.data, revision: (cur?.revision ?? 0) + 1, updatedAt: "t", deletedAt: null };
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
function harness(initialLocal: CharacterLoraEntry[], server: ReturnType<typeof fakeServer>) {
  let local = initialLocal.slice();
  const applied: CharacterLoraEntry[][] = [];
  const sync: CharacterItemSync = createCharacterItemSync({
    fetch: server.fetch as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    getCharacters: () => local,
    applyServerCharacters: (next) => {
      applied.push(next);
      local = next;
    },
    debounceMs: 1000,
  });
  /** What `patchCharacterLoras` does. */
  const patch = (fn: (list: CharacterLoraEntry[]) => CharacterLoraEntry[]) => {
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

describe("createCharacterItemSync: loading never writes", () => {
  it("a load that changes what's on screen sends only the GET", async () => {
    const a = card("clora_a", "Shazza");
    const b = card("clora_b", "Jack");
    const server = fakeServer([item({ ...a, name: "Shazza v2" }, 3), item(b, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.writes()).toEqual([]);
    expect(h.local().map((c) => c.name)).toEqual(["Shazza v2", "Jack"]);
    expect(h.sync.debugState()).toMatchObject({ mode: "ready", revisions: { clora_a: 3, clora_b: 1 }, dirty: [] });
  });

  it("a second load (after a session reload) doesn't write either", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 2)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.writes()).toEqual([]);
  });

  it("never seeds: with no rows yet (seed not run) it stays off and never uploads this device's cards", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, name: "Shazza B" })));
    h.patch((list) => [...list, card("clora_new", "New")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sync.debugState().mode).toBe("unavailable");
    expect(server.writes()).toEqual([]);
  });

  it("table missing: quietly off, no writes, the whole-session save is untouched", async () => {
    const server = fakeServer([]);
    server.setOverride((c) => (c.method === "GET" ? jsonResponse(503, { ok: false, configured: true, ready: false, tableMissing: true }) : null));
    const h = harness([card("clora_a", "Shazza")], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, name: "x" })));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sync.debugState().mode).toBe("unavailable");
    expect(server.writes()).toEqual([]);
    expect(h.applied).toEqual([]);
  });

  it("no database here: quietly off", async () => {
    const server = fakeServer([]);
    server.setOverride((c) => (c.method === "GET" ? jsonResponse(200, { ok: false, configured: false }) : null));
    const h = harness([card("clora_a", "Shazza")], server);
    await h.sync.refreshFromServer();
    expect(h.sync.debugState().mode).toBe("unavailable");
  });
});

describe("createCharacterItemSync: real changes write, one card at a time", () => {
  it("debounces a burst of edits to one card into one PUT with the known revision", async () => {
    const a = card("clora_a", "Shazza");
    const b = card("clora_b", "Jack");
    const server = fakeServer([item(a, 5), item(b, 2)]);
    const h = harness([a, b], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => (c.id === "clora_a" ? { ...c, name: "S" } : c)));
    h.patch((list) => list.map((c) => (c.id === "clora_a" ? { ...c, name: "Sh" } : c)));
    h.patch((list) => list.map((c) => (c.id === "clora_a" ? { ...c, name: "Sha" } : c)));
    await vi.advanceTimersByTimeAsync(999);
    expect(server.writes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(server.writes()).toHaveLength(1);
    expect(server.writes()[0].body).toMatchObject({ kind: "character", itemId: "clora_a", expectedRevision: 5 });
    expect((server.writes()[0].body!.data as CharacterLoraEntry).name).toBe("Sha");
    expect(h.sync.debugState()).toMatchObject({ revisions: { clora_a: 6, clora_b: 2 }, dirty: [] });
  });

  it("an unchanged card is never sent", async () => {
    const a = card("clora_a", "Shazza");
    const b = card("clora_b", "Jack");
    const server = fakeServer([item(a, 1), item(b, 1)]);
    const h = harness([a, b], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => (c.id === "clora_b" ? { ...c, status: "ready" } : c)));
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.writes().map((w) => w.body!.itemId)).toEqual(["clora_b"]);
  });

  it("a new card is sent with expectedRevision 0", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => [...list, card("clora_new", "Big Sexy")]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "clora_new", expectedRevision: 0 });
    expect(server.rows.get("clora_new")?.revision).toBe(1);
  });

  it("an edit made while a save is in flight goes up next, on the new revision", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, name: "one" })));
    await vi.advanceTimersByTimeAsync(1000);
    h.patch((list) => list.map((c) => ({ ...c, name: "two" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes().map((w) => w.body!.expectedRevision)).toEqual([1, 2]);
    expect((server.rows.get("clora_a")!.data as CharacterLoraEntry).name).toBe("two");
  });

  it("retries a network failure, then succeeds", async () => {
    const a = card("clora_a", "Shazza");
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
    h.patch((list) => list.map((c) => ({ ...c, name: "x" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sync.hasUnsavedWork()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.rows.get("clora_a")!.revision).toBe(2);
    expect(h.sync.hasUnsavedWork()).toBe(false);
  });

  it("flush sends a waiting card immediately", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, name: "x" })));
    h.sync.flush(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.writes()).toHaveLength(1);
  });
});

describe("createCharacterItemSync: 409 adopts the server's copy", () => {
  it("takes the server's card and drops this device's edit to it", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    // Another device saves first.
    server.rows.set("clora_a", item({ ...a, name: "From the PC" }, 2));
    h.patch((list) => list.map((c) => ({ ...c, name: "Old phone edit" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()).toHaveLength(1);
    expect(h.local()[0].name).toBe("From the PC");
    expect(h.sync.debugState()).toMatchObject({ revisions: { clora_a: 2 }, dirty: [] });
    // And nothing is retried on top of it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toHaveLength(1);
    expect((server.rows.get("clora_a")!.data as CharacterLoraEntry).name).toBe("From the PC");
  });

  it("a card deleted on another device disappears here instead of being brought back", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    server.rows.set("clora_a", item(a, 2, "t"));
    h.patch((list) => list.map((c) => ({ ...c, name: "stale edit" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.local()).toEqual([]);
    expect(server.rows.get("clora_a")!.deletedAt).toBe("t");
  });

  it("a new card whose id already exists on the server takes the server's copy", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(card("clora_x", "X"), 1)]);
    const h = harness([], server);
    await h.sync.refreshFromServer();
    server.rows.set("clora_a", item({ ...a, name: "Server" }, 7));
    h.patch((list) => [...list, a]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.local().find((c) => c.id === "clora_a")?.name).toBe("Server");
    expect(h.sync.debugState().revisions.clora_a).toBe(7);
  });
});

describe("createCharacterItemSync: a missing character never deletes", () => {
  it("a card missing from this device's list is never deleted or overwritten", async () => {
    const a = card("clora_a", "Shazza");
    const b = card("clora_b", "Jack");
    const server = fakeServer([item(a, 1), item(b, 4)]);
    const h = harness([a, b], server);
    await h.sync.refreshFromServer();
    // An old copy / thin list drops Jack without a delete tap.
    h.patch((list) => list.filter((c) => c.id !== "clora_b"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toEqual([]);
    expect(server.rows.get("clora_b")).toMatchObject({ revision: 4, deletedAt: null });
  });

  it("a session load that lacks a card gets it back from the server, with no write", async () => {
    const a = card("clora_a", "Shazza");
    const b = card("clora_b", "Jack");
    const server = fakeServer([item(a, 1), item(b, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    expect(h.local().map((c) => c.id)).toEqual(["clora_a", "clora_b"]);
    expect(server.writes()).toEqual([]);
  });

  it("an edit to a card that then vanishes locally sends nothing", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.map((c) => ({ ...c, name: "x" })));
    h.patch(() => []);
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.writes()).toEqual([]);
  });

  it("only a real delete tap sends a DELETE, with the known revision", async () => {
    const a = card("clora_a", "Shazza");
    const b = card("clora_b", "Jack");
    const server = fakeServer([item(a, 1), item(b, 3)]);
    const h = harness([a, b], server);
    await h.sync.refreshFromServer();
    h.patch((list) => list.filter((c) => c.id !== "clora_b"));
    h.sync.deleteCharacter("clora_b", b);
    await vi.advanceTimersByTimeAsync(0);
    const del = server.writes();
    expect(del).toHaveLength(1);
    expect(del[0].method).toBe("DELETE");
    expect(del[0].url).toContain("itemId=clora_b");
    expect(del[0].url).toContain("expectedRevision=3");
    expect(server.rows.get("clora_b")!.deletedAt).toBe("t");
  });

  it("a delete refused because the card changed elsewhere brings the newer card back", async () => {
    const b = card("clora_b", "Jack");
    const server = fakeServer([item(b, 3)]);
    const h = harness([b], server);
    await h.sync.refreshFromServer();
    server.rows.set("clora_b", item({ ...b, name: "Jack (PC)" }, 4));
    h.patch((list) => list.filter((c) => c.id !== "clora_b"));
    h.sync.deleteCharacter("clora_b", b);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.local().map((c) => c.name)).toEqual(["Jack (PC)"]);
    expect(server.rows.get("clora_b")!.deletedAt).toBeNull();
  });
});

describe("createCharacterItemSync: edits made before the server's cards arrive", () => {
  it("keeps an edit made on top of the server's current copy and sends it", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 2)]);
    const h = harness([a], server);
    h.patch((list) => list.map((c) => ({ ...c, name: "edited early" })));
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.writes()).toEqual([]); // held until the load
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "clora_a", expectedRevision: 2 });
    expect(h.local()[0].name).toBe("edited early");
  });

  it("drops an edit made on top of an older copy: the server's copy wins, nothing is written", async () => {
    const stale = card("clora_a", "Shazza (old phone)");
    const server = fakeServer([item({ ...stale, name: "Shazza (newer, PC)" }, 9)]);
    const h = harness([stale], server);
    h.patch((list) => list.map((c) => ({ ...c, status: "ready" })));
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.writes()).toEqual([]);
    expect(h.local()[0].name).toBe("Shazza (newer, PC)");
  });

  it("a card created before the load is sent as new", async () => {
    const a = card("clora_a", "Shazza");
    const server = fakeServer([item(a, 1)]);
    const h = harness([a], server);
    h.patch((list) => [...list, card("clora_new", "New")]);
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "clora_new", expectedRevision: 0 });
    expect(h.local().map((c) => c.id)).toEqual(["clora_a", "clora_new"]);
  });

  it("a failed load retries and holds edits until it succeeds", async () => {
    const a = card("clora_a", "Shazza");
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
    h.patch((list) => list.map((c) => ({ ...c, name: "x" })));
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.writes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.debugState().mode).toBe("ready");
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()).toHaveLength(1);
  });
});
