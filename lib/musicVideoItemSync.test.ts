import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckItemRecord } from "./deckItems";
import { changedDeckItemIds, createDeckItemSync, overlayDeckItems, sameDeckItem, type DeckItemSync } from "./deckItemSync";
import type { MusicVideoSongItem } from "./musicVideoItemData";
import { MUSIC_VIDEO_SONG_ITEMS, musicVideoBandItems } from "./musicVideoItems";
import type { SkidmarksBand, SkidmarksMp3Attachment } from "./skidmarks";

/**
 * The shared per-item engine (`lib/deckItemSync.ts`), exercised the way
 * Music video uses it (bands, and the song on the desk). Mirrors
 * `lib/characterItems.test.ts` rule for rule: loading never writes, the client never seeds, only real
 * changes write, a 409 adopts the server's copy, a missing item never
 * deletes, and only a real delete tap sends a DELETE.
 */

const characters = [{ id: "clora_jack", sourceKey: "mv:jack-ash-frontman" }];
const BAND_ITEMS = musicVideoBandItems(() => characters);

function band(id: string, name: string, extra: Partial<SkidmarksBand> = {}): SkidmarksBand {
  return {
    id,
    name,
    tagline: "",
    coverSeed: 1,
    editIcon: "pencil",
    members: [{ id: `${id}-m1`, name: `${name} singer`, emoji: "🎸", looks: [] }],
    ...extra,
  };
}

function record(data: unknown, itemId: string, revision: number, deletedAt: string | null = null): DeckItemRecord {
  return { itemId, folder: "music-video", data, revision, updatedAt: "2026-09-30T00:00:00Z", deletedAt };
}
const bandRow = (b: SkidmarksBand, revision: number, deletedAt: string | null = null) => record(b, b.id, revision, deletedAt);

function mp3(attachId: string, fileName: string, extra: Partial<SkidmarksMp3Attachment> = {}): SkidmarksMp3Attachment {
  return {
    fileName,
    durationSec: 120,
    attachedAt: 1,
    attachId,
    segments: [],
    segmentsSource: "transcription",
    analysisStatus: "done",
    transcriptionStatus: "done",
    ...extra,
  } as SkidmarksMp3Attachment;
}
function song(id: string, fileName: string, bandId = "jack-ash", script = ""): MusicVideoSongItem {
  return { id, bandId, mp3: mp3(id, fileName), scriptSequenceDraft: script ? { script } : null };
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

describe("changedDeckItemIds (diff logic)", () => {
  const a = band("jack-ash", "Jack Ash");
  const b = band("band_b", "BIGSEXY");

  it("lists nothing when nothing changed, whatever the key order", () => {
    const shuffled = Object.fromEntries(Object.entries(a).reverse()) as unknown as SkidmarksBand;
    expect(changedDeckItemIds(BAND_ITEMS, [a, b], [shuffled, { ...b }])).toEqual([]);
    expect(sameDeckItem(BAND_ITEMS, a, shuffled)).toBe(true);
  });

  it("lists only the band that changed, and a new band", () => {
    const c = band("band_c", "STUBALLS");
    expect(changedDeckItemIds(BAND_ITEMS, [a, b], [a, { ...b, name: "BIG SEXY" }, c])).toEqual(["band_b", "band_c"]);
  });

  it("never lists a band that is missing from the new list", () => {
    expect(changedDeckItemIds(BAND_ITEMS, [a, b], [a])).toEqual([]);
    expect(changedDeckItemIds(BAND_ITEMS, [a, b], [])).toEqual([]);
  });

  it("doesn't count a member's characterId reference as a change", () => {
    const withRef = { ...a, members: a.members.map((m) => ({ ...m, characterId: "clora_x" })) } as SkidmarksBand;
    expect(changedDeckItemIds(BAND_ITEMS, [a], [withRef])).toEqual([]);
  });

  it("ignores the key order Postgres hands back", () => {
    const fromJsonb = JSON.parse(JSON.stringify(a, Object.keys(a).sort())) as SkidmarksBand;
    expect(changedDeckItemIds(BAND_ITEMS, [a], [{ ...fromJsonb, members: a.members }])).toEqual([]);
  });
});

describe("overlayDeckItems", () => {
  const a = band("jack-ash", "Jack Ash");
  const b = band("band_b", "BIGSEXY");

  it("server bands win, server-only bands are added, local-only bands are kept", () => {
    const c = band("band_c", "STUBALLS");
    const out = overlayDeckItems(BAND_ITEMS, [a, c], [bandRow({ ...a, name: "Jack Ash (server)" }, 2), bandRow(b, 1)], []);
    expect(out.changed).toBe(true);
    expect(out.entries.map((x) => x.name)).toEqual(["Jack Ash (server)", "STUBALLS", "BIGSEXY"]);
  });

  it("drops a band the server has deleted", () => {
    const out = overlayDeckItems(BAND_ITEMS, [a, b], [bandRow(a, 1)], ["band_b"]);
    expect(out.entries.map((x) => x.id)).toEqual(["jack-ash"]);
  });

  it("reports no change when everything matches (the stored characterId is not a difference)", () => {
    const stored = { ...a, members: a.members.map((m) => ({ ...m, characterId: "clora_jack" })) };
    const out = overlayDeckItems(BAND_ITEMS, [a, b], [record(stored, a.id, 3), bandRow(b, 1)], []);
    expect(out.changed).toBe(false);
    expect(out.entries).toEqual([a, b]);
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

/** A tiny fake of `/api/deck/items` over an in-memory table (one kind). */
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
      const next = record(body!.data, id, (cur?.revision ?? 0) + 1);
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

/** A stand-in for the band list in `lib/skidmarks.ts` (`persist` hands every edit over). */
function bandHarness(initialLocal: SkidmarksBand[], server: ReturnType<typeof fakeServer>) {
  let local = initialLocal.slice();
  const applied: SkidmarksBand[][] = [];
  const sync: DeckItemSync<SkidmarksBand> = createDeckItemSync(BAND_ITEMS, {
    fetch: server.fetch as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    getEntries: () => local,
    applyServerEntries: (next) => {
      applied.push(next);
      local = next;
    },
    debounceMs: 1000,
  });
  const edit = (fn: (list: SkidmarksBand[]) => SkidmarksBand[]) => {
    const before = local;
    local = fn(before.map((b) => ({ ...b })));
    sync.noteLocalChange(before, local);
  };
  return { sync, edit, applied, local: () => local };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("bands: loading never writes", () => {
  it("a load that changes what's on screen sends only the GET", async () => {
    const a = band("jack-ash", "Jack Ash");
    const b = band("band_b", "BIGSEXY");
    const server = fakeServer([bandRow({ ...a, name: "Jack Ash v2" }, 3), bandRow(b, 1)]);
    const h = bandHarness([a], server);
    await h.sync.refreshFromServer();
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls.map((c) => c.url)).toEqual(["/api/deck/items?kind=music-video-band", "/api/deck/items?kind=music-video-band"]);
    expect(server.writes()).toEqual([]);
    expect(h.local().map((x) => x.name)).toEqual(["Jack Ash v2", "BIGSEXY"]);
    expect(h.sync.debugState()).toMatchObject({ mode: "ready", revisions: { "jack-ash": 3, band_b: 1 }, dirty: [] });
  });

  it("never seeds: with the seed not run it stays off and never uploads this device's bands", async () => {
    const server = fakeServer([]);
    const h = bandHarness([band("jack-ash", "Jack Ash")], server);
    await h.sync.refreshFromServer();
    h.edit((list) => [...list.map((x) => ({ ...x, name: "renamed" })), band("band_new", "New")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sync.debugState().mode).toBe("unavailable");
    expect(server.writes()).toEqual([]);
  });

  it("table missing: quietly off, nothing applied, nothing written", async () => {
    const server = fakeServer([]);
    server.setOverride((c) => (c.method === "GET" ? jsonResponse(503, { ok: false, configured: true, ready: false, tableMissing: true }) : null));
    const h = bandHarness([band("jack-ash", "Jack Ash")], server);
    await h.sync.refreshFromServer();
    h.edit((list) => list.map((x) => ({ ...x, name: "x" })));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sync.debugState().mode).toBe("unavailable");
    expect(server.writes()).toEqual([]);
    expect(h.applied).toEqual([]);
  });
});

describe("bands: real changes write, one band at a time", () => {
  it("debounces a burst of edits into one PUT with the known revision, carrying member references", async () => {
    const a = band("jack-ash", "Jack Ash", {
      members: [{ id: "jack-ash-frontman", name: "Jack Ash", emoji: "🎸", looks: [] }],
    });
    const b = band("band_b", "BIGSEXY");
    const server = fakeServer([bandRow(a, 5), bandRow(b, 2)]);
    const h = bandHarness([a, b], server);
    await h.sync.refreshFromServer();
    h.edit((list) => list.map((x) => (x.id === "jack-ash" ? { ...x, tagline: "n" } : x)));
    h.edit((list) => list.map((x) => (x.id === "jack-ash" ? { ...x, tagline: "noir" } : x)));
    await vi.advanceTimersByTimeAsync(999);
    expect(server.writes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(server.writes()).toHaveLength(1);
    const body = server.writes()[0].body!;
    expect(body).toMatchObject({ kind: "music-video-band", itemId: "jack-ash", expectedRevision: 5 });
    expect(body.data).toMatchObject({ tagline: "noir", members: [{ id: "jack-ash-frontman", characterId: "clora_jack" }] });
    expect(h.sync.debugState()).toMatchObject({ revisions: { "jack-ash": 6, band_b: 2 }, dirty: [] });
  });

  it("a new band is sent with expectedRevision 0", async () => {
    const server = fakeServer([bandRow(band("jack-ash", "Jack Ash"), 1)]);
    const h = bandHarness([band("jack-ash", "Jack Ash")], server);
    await h.sync.refreshFromServer();
    h.edit((list) => [band("band_new", ""), ...list]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "band_new", expectedRevision: 0 });
  });

  it("a rename keeps the same row (stable id) and the pinned media folder", async () => {
    const a = band("band_b", "BIGSEXY", { mediaSlug: "bigsexy" });
    const server = fakeServer([bandRow(a, 1)]);
    const h = bandHarness([a], server);
    await h.sync.refreshFromServer();
    h.edit((list) => list.map((x) => ({ ...x, name: "BIG SEXY BAND" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "band_b", expectedRevision: 1, data: { mediaSlug: "bigsexy" } });
    expect([...server.rows.keys()]).toEqual(["band_b"]);
  });

  it("never sends inline picture bytes", async () => {
    const a = band("band_b", "BIGSEXY");
    const server = fakeServer([bandRow(a, 1)]);
    const h = bandHarness([a], server);
    await h.sync.refreshFromServer();
    h.edit((list) => list.map((x) => ({ ...x, name: "B", coverImage: "data:image/jpeg;base64,AAAA" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.stringify(server.writes()[0].body)).not.toContain("data:");
  });
});

describe("bands: 409 adopts the server's copy", () => {
  it("takes the server's band and drops this device's edit to it", async () => {
    const a = band("jack-ash", "Jack Ash");
    const server = fakeServer([bandRow(a, 1)]);
    const h = bandHarness([a], server);
    await h.sync.refreshFromServer();
    server.rows.set("jack-ash", bandRow({ ...a, name: "From the PC" }, 2));
    h.edit((list) => list.map((x) => ({ ...x, name: "Old phone edit" })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.local()[0].name).toBe("From the PC");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toHaveLength(1);
    expect((server.rows.get("jack-ash")!.data as SkidmarksBand).name).toBe("From the PC");
  });
});

describe("bands: a missing band never deletes", () => {
  it("a band missing from this device's list is never deleted or overwritten", async () => {
    const a = band("jack-ash", "Jack Ash");
    const b = band("band_b", "BIGSEXY");
    const server = fakeServer([bandRow(a, 1), bandRow(b, 4)]);
    const h = bandHarness([a, b], server);
    await h.sync.refreshFromServer();
    h.edit((list) => list.filter((x) => x.id !== "band_b")); // e.g. the "New" cap dropping the oldest
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toEqual([]);
    expect(server.rows.get("band_b")).toMatchObject({ revision: 4, deletedAt: null });
  });

  it("only the trash tap sends a DELETE, with the known revision", async () => {
    const a = band("jack-ash", "Jack Ash");
    const b = band("band_b", "BIGSEXY");
    const server = fakeServer([bandRow(a, 1), bandRow(b, 3)]);
    const h = bandHarness([a, b], server);
    await h.sync.refreshFromServer();
    h.edit((list) => list.filter((x) => x.id !== "band_b"));
    h.sync.deleteItem("band_b", b);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.writes()).toHaveLength(1);
    expect(server.writes()[0].method).toBe("DELETE");
    expect(server.writes()[0].url).toBe("/api/deck/items?kind=music-video-band&itemId=band_b&expectedRevision=3");
  });
});

describe("bands: edits made before the server's bands arrive", () => {
  it("keeps an edit made on top of the server's current copy", async () => {
    const a = band("jack-ash", "Jack Ash");
    const server = fakeServer([bandRow(a, 2)]);
    const h = bandHarness([a], server);
    h.edit((list) => list.map((x) => ({ ...x, tagline: "early" })));
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.writes()).toEqual([]);
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "jack-ash", expectedRevision: 2 });
  });

  it("drops an edit made on top of an older copy: the server's copy wins", async () => {
    const stale = band("jack-ash", "Jack Ash (old phone)");
    const server = fakeServer([bandRow({ ...stale, name: "Jack Ash (PC)" }, 9)]);
    const h = bandHarness([stale], server);
    h.edit((list) => list.map((x) => ({ ...x, tagline: "x" })));
    await h.sync.refreshFromServer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.writes()).toEqual([]);
    expect(h.local()[0].name).toBe("Jack Ash (PC)");
  });
});

/** Songs: this device's list is just the song on the desk (none or one). */
function songHarness(desk: MusicVideoSongItem | null, server: ReturnType<typeof fakeServer>) {
  let current = desk;
  const sync: DeckItemSync<MusicVideoSongItem> = createDeckItemSync(MUSIC_VIDEO_SONG_ITEMS, {
    fetch: server.fetch as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    getEntries: () => (current ? [current] : []),
    applyServerEntries: (next) => {
      // What `withServerDeskSong` does: only the desk's own song is refreshed.
      if (current) current = next.find((s) => s.id === current!.id) ?? null;
    },
    debounceMs: 1000,
  });
  const set = (next: MusicVideoSongItem | null) => {
    const before = current ? [current] : [];
    current = next;
    sync.noteLocalChange(before, next ? [next] : []);
  };
  return { sync, set, desk: () => current };
}

describe("songs", () => {
  it("a load refreshes the desk's song from the server and never puts another song on the desk", async () => {
    const mine = song("mp3_a", "CRACK HAUL.mp3");
    const server = fakeServer([record({ ...mine, scriptSequenceDraft: { script: "server" } }, "mp3_a", 4), record(song("mp3_b", "OTHER.mp3"), "mp3_b", 1)]);
    const h = songHarness(mine, server);
    await h.sync.refreshFromServer();
    expect(h.desk()?.scriptSequenceDraft).toEqual({ script: "server" });
    expect(server.writes()).toEqual([]);

    const empty = songHarness(null, server);
    await empty.sync.refreshFromServer();
    expect(empty.desk()).toBeNull();
    expect(server.writes()).toEqual([]);
  });

  it("songs switch on with the Music video seed even with no song rows yet (seeded comes from the server)", async () => {
    const server = fakeServer([], { seeded: true });
    const h = songHarness(null, server);
    await h.sync.refreshFromServer();
    expect(h.sync.debugState().mode).toBe("ready");
    h.set(song("mp3_new", "NEW.mp3"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ kind: "music-video-song", itemId: "mp3_new", expectedRevision: 0 });
  });

  it("a Script Sequence edit saves the song on its own revision", async () => {
    const mine = song("mp3_a", "CRACK HAUL.mp3");
    const server = fakeServer([record(mine, "mp3_a", 2)]);
    const h = songHarness(mine, server);
    await h.sync.refreshFromServer();
    h.set({ ...mine, scriptSequenceDraft: { script: "Verse 1" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.writes()[0].body).toMatchObject({ itemId: "mp3_a", expectedRevision: 2, data: { scriptSequenceDraft: { script: "Verse 1" } } });
  });

  it("a song leaving the desk (band switch, New, after Archive) is never a delete", async () => {
    const mine = song("mp3_a", "CRACK HAUL.mp3");
    const server = fakeServer([record(mine, "mp3_a", 2)]);
    const h = songHarness(mine, server);
    await h.sync.refreshFromServer();
    h.set(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toEqual([]);
    expect(server.rows.get("mp3_a")?.deletedAt).toBeNull();
  });

  it("the MP3 card's remove tap soft-deletes that song's row", async () => {
    const mine = song("mp3_a", "CRACK HAUL.mp3");
    const server = fakeServer([record(mine, "mp3_a", 2)]);
    const h = songHarness(mine, server);
    await h.sync.refreshFromServer();
    h.set(null);
    h.sync.deleteItem("mp3_a", mine);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.writes().map((w) => w.method)).toEqual(["DELETE"]);
    expect(server.rows.get("mp3_a")?.deletedAt).toBe("t");
  });

  it("a 409 on the desk's song adopts the server's copy", async () => {
    const mine = song("mp3_a", "CRACK HAUL.mp3");
    const server = fakeServer([record(mine, "mp3_a", 1)]);
    const h = songHarness(mine, server);
    await h.sync.refreshFromServer();
    server.rows.set("mp3_a", record({ ...mine, scriptSequenceDraft: { script: "PC" } }, "mp3_a", 2));
    h.set({ ...mine, scriptSequenceDraft: { script: "phone" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.desk()?.scriptSequenceDraft).toEqual({ script: "PC" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toHaveLength(1);
  });
});
