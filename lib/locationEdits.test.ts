import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Locations row through the real store, with a fake server
 * (2026-09-30): each location is its own `deck_items` row (kind
 * `location`, folder by genre); Sunnybank's built-ins are copied in on
 * the first edit; a delete is a tombstone; nothing here calls Blob.
 */

type Row = { itemId: string; folder: string; data: unknown; revision: number; updatedAt: string; deletedAt: string | null };
type Call = { method: string; url: string; body?: Record<string, unknown> };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot(server: { session: unknown; rows: Row[] }) {
  vi.resetModules();
  const calls: Call[] = [];
  const local = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v), removeItem: (k: string) => local.delete(k) },
    addEventListener: () => {},
    setInterval: () => 0,
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, url, body });
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.startsWith("/api/skidmarks/session")) {
        if (method === "GET") return j({ configured: true, state: server.session, revision: 10, updatedAt: new Date().toISOString() });
        server.session = body?.state;
        return j({ ok: true, configured: true, revision: 11 });
      }
      if (url.startsWith("/api/deck/items")) {
        const q = new URL(url, "http://x").searchParams;
        if (method === "GET") {
          const mine = q.get("kind") === "location";
          return j({
            ok: true,
            configured: true,
            ready: true,
            seeded: mine,
            items: mine ? server.rows.filter((r) => !r.deletedAt) : [],
            deleted: mine ? server.rows.filter((r) => r.deletedAt).map((r) => ({ itemId: r.itemId, revision: r.revision })) : [],
          });
        }
        if (method === "PUT") {
          const at = server.rows.findIndex((r) => r.itemId === body!.itemId);
          const current = at >= 0 ? server.rows[at] : null;
          if ((current?.revision ?? 0) !== body!.expectedRevision) return j({ conflict: true, item: current }, 409);
          const data = body!.data as { genre: string };
          const row: Row = { itemId: String(body!.itemId), folder: data.genre, data, revision: (current?.revision ?? 0) + 1, updatedAt: "t", deletedAt: null };
          if (at >= 0) server.rows[at] = row;
          else server.rows.push(row);
          return j({ ok: true, item: row });
        }
        if (method === "DELETE") {
          const at = server.rows.findIndex((r) => r.itemId === q.get("itemId"));
          const current = server.rows[at];
          if (!current || String(current.revision) !== q.get("expectedRevision")) return j({ conflict: true, item: current ?? null }, 409);
          server.rows[at] = { ...current, revision: current.revision + 1, deletedAt: "t" };
          return j({ ok: true, item: server.rows[at] });
        }
      }
      return j({ unexpected: url }, 404);
    }),
  );
  const sk = await import("./skidmarks");
  const edits = await import("./locationEdits");
  const locs = await import("./deckLocations");
  sk.subscribeSkidmarks(() => {});
  sk.getSkidmarksSnapshot();
  await wait(200);
  const list = (genre: "sunnybank" | "music-video") => locs.effectiveDeckLocations(sk.getDeckLocationsState(), genre);
  return { sk, edits, calls, list };
}

const SESSION = { bands: [], removedSeedBandIds: [], session: { projectKind: "sunnybank", bandId: null, mp3: null, scriptSequenceDraft: null } };

describe("Locations row, saved per item", () => {
  it("Sunnybank: the first add copies the nine built-ins in, then each is its own row; it survives a reload", async () => {
    const server = { session: structuredClone(SESSION), rows: [] as Row[] };
    let page = await boot(server);
    expect(page.list("sunnybank")).toHaveLength(9);
    expect(page.calls.filter((c) => c.url.startsWith("/api/deck/items") && c.method !== "GET")).toEqual([]);

    const pic = "https://abc.public.blob.vercel-storage.com/deck/sunnybank/locations/boat-ramp.jpg";
    const added = page.edits.addDeckLocation("sunnybank", "Boat Ramp", pic);
    expect(added.ok && added.value.id).toBe("loc_sunnybank_boat_ramp");
    await wait(150);
    const puts = page.calls.filter((c) => c.method === "PUT" && c.url.startsWith("/api/deck/items"));
    expect(puts.every((p) => p.body?.kind === "location" && p.body?.expectedRevision === 0)).toBe(true);
    expect(puts.map((p) => p.body!.itemId)).toHaveLength(10);
    expect(server.rows.find((r) => r.itemId === "loc_sunnybank_boat_ramp")).toMatchObject({ folder: "sunnybank", data: { name: "Boat Ramp", pictureUrl: pic } });
    expect(server.rows.find((r) => r.itemId === "loc_sunnybank_park_site_4")?.data).toMatchObject({ key: "park_site_4", name: "Park Site 4" });

    page = await boot(server);
    expect(page.list("sunnybank").map((l) => l.key)).toContain("boat_ramp");
    expect(page.list("sunnybank")).toHaveLength(10);

    // Rename keeps the key (scripts still say [Location: boat_ramp]); a row update.
    expect(page.edits.renameDeckLocation("sunnybank", "loc_sunnybank_boat_ramp", "Old Boat Ramp")).toEqual({ ok: true, value: "Old Boat Ramp" });
    expect(page.edits.renameDeckLocation("sunnybank", "loc_sunnybank_boat_ramp", "park site 4").ok).toBe(false);
    await wait(150);
    const renamed = page.calls.filter((c) => c.method === "PUT" && c.url.startsWith("/api/deck/items"));
    expect(renamed.map((p) => p.body)).toMatchObject([{ itemId: "loc_sunnybank_boat_ramp", expectedRevision: 1, data: { key: "boat_ramp", name: "Old Boat Ramp" } }]);

    // Delete (the second bin tap) is a tombstone.
    expect(page.edits.deleteDeckLocation("sunnybank", "loc_sunnybank_boat_ramp").ok).toBe(true);
    await wait(300);
    expect(page.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      "/api/deck/items?kind=location&itemId=loc_sunnybank_boat_ramp&expectedRevision=2",
    ]);
    expect(page.list("sunnybank").map((l) => l.key)).not.toContain("boat_ramp");
    // Never Blob.
    expect(page.calls.every((c) => c.url.startsWith("/api/skidmarks/session") || c.url.startsWith("/api/deck/items"))).toBe(true);
  }, 20000);

  it("Music video starts empty; its locations are its own, foldered music-video", async () => {
    const server = { session: structuredClone(SESSION), rows: [] as Row[] };
    const page = await boot(server);
    expect(page.list("music-video")).toEqual([]);
    expect(page.edits.addDeckLocation("music-video", "Roadside Motel", null).ok).toBe(true);
    await wait(150);
    expect(server.rows.map((r) => [r.itemId, r.folder])).toEqual([["loc_music_video_roadside_motel", "music-video"]]);
    // Sunnybank is untouched: still its built-ins, nothing saved for it.
    expect(page.list("sunnybank")).toHaveLength(9);
  }, 20000);
});
