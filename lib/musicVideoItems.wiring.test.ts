import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end through the real store (`lib/skidmarks.ts`) with a fake
 * browser and a fake server: the session loads, the server's band and
 * song rows are laid over it with no write, a rename sends one PUT for
 * that band on its known revision, and only the two real delete taps
 * (the MP3 card's remove, the band's trash) send DELETEs.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Music video per-item saving, wired into the store", () => {
  it("load reads only, an edit writes that one band, deletes only on the real taps", async () => {
    const store = new Map<string, string>();
    const listeners: Record<string, (() => void)[]> = {};
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
      addEventListener: (t: string, fn: () => void) => ((listeners[t] ??= []).push(fn)),
      setInterval: () => 0,
      setTimeout, clearTimeout,
    });
    vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
    const band = { id: "band_b", name: "BIGSEXY", tagline: "", coverSeed: 1, editIcon: "pencil", members: [{ id: "member_1", name: "BIG SEXY", emoji: "x", looks: [] }] };
    const mp3 = { attachId: "mp3_a", fileName: "CRACK HAUL.mp3", durationSec: 100, attachedAt: 1, segments: [], segmentsSource: "transcription", analysisStatus: "done", transcriptionStatus: "done" };
    const sessionState = { bands: [band], removedSeedBandIds: [], session: { projectKind: "music-video", bandId: "band_b", mp3, scriptSequenceDraft: null } };
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const rows: Record<string, { itemId: string; folder: string; data: unknown; revision: number; updatedAt: string; deletedAt: null }[]> = {
      "music-video-band": [
        { itemId: "band_b", folder: "music-video", data: { ...band, name: "BIGSEXY (server)" }, revision: 3, updatedAt: "t", deletedAt: null },
        // Missing from this (old, thin) session copy: comes back from its row.
        { itemId: "band_c", folder: "music-video", data: { ...band, id: "band_c", name: "STUBALLS" }, revision: 1, updatedAt: "t", deletedAt: null },
      ],
      "music-video-song": [{ itemId: "mp3_a", folder: "music-video", data: { id: "mp3_a", bandId: "band_b", mp3: { ...mp3, durationSec: 222 }, scriptSequenceDraft: { script: "server" } }, revision: 2, updatedAt: "t", deletedAt: null }],
      character: [],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.startsWith("/api/skidmarks/session")) {
        if (method === "GET") return j({ configured: true, state: sessionState, revision: 10, updatedAt: new Date().toISOString() });
        return j({ ok: true, configured: true, revision: 11 });
      }
      if (url.startsWith("/api/deck/items")) {
        if (method === "GET") {
          const kind = new URL(url, "http://x").searchParams.get("kind")!;
          return j({ ok: true, configured: true, ready: true, seeded: kind.startsWith("music-video-"), items: rows[kind] ?? [], deleted: [] });
        }
        if (method === "PUT") {
          const b = JSON.parse(String(init!.body));
          return j({ ok: true, item: { itemId: b.itemId, folder: "music-video", data: b.data, revision: b.expectedRevision + 1, updatedAt: "t", deletedAt: null } });
        }
        if (method === "DELETE") return j({ ok: true, item: { itemId: "x", folder: "music-video", data: {}, revision: 9, updatedAt: "t", deletedAt: "t" } });
      }
      return j({}, 404);
    }));
    const sk = await import("./skidmarks");
    sk.subscribeSkidmarks(() => {});
    sk.getSkidmarksSnapshot();
    await new Promise((r) => setTimeout(r, 200));
    const snap = sk.getSkidmarksSnapshot();
    expect(snap.bands.find((b) => b.id === "band_b")?.name).toBe("BIGSEXY (server)");
    expect(snap.bands.find((b) => b.id === "band_c")?.name).toBe("STUBALLS");
    expect(snap.session.mp3?.durationSec).toBe(222);
    expect(snap.session.scriptSequenceDraft).toEqual({ script: "server" });
    expect(calls.filter((c) => c.url.startsWith("/api/deck/items") && c.method !== "GET")).toEqual([]);

    sk.renameSkidmarksBand("band_b", "RENAMED");
    await new Promise((r) => setTimeout(r, 1300));
    const puts = calls.filter((c) => c.url.startsWith("/api/deck/items") && c.method === "PUT");
    expect(puts.map((p) => (p.body as { kind: string; itemId: string; expectedRevision: number }))).toMatchObject([{ kind: "music-video-band", itemId: "band_b", expectedRevision: 3 }]);

    sk.clearSkidmarksMp3();
    await new Promise((r) => setTimeout(r, 50));
    const dels = calls.filter((c) => c.method === "DELETE");
    expect(dels.map((d) => d.url)).toEqual(["/api/deck/items?kind=music-video-song&itemId=mp3_a&expectedRevision=2"]);

    sk.removeSkidmarksBand("band_b");
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.method === "DELETE").map((d) => d.url)[1]).toContain("kind=music-video-band&itemId=band_b&expectedRevision=4");
    // Loading read each kind once (characters, Sunnybank episodes, bands,
    // songs) and the session once; nothing else was read again.
    const gets = calls.filter((c) => c.method === "GET").map((c) => c.url);
    expect(gets.filter((u) => u.startsWith("/api/skidmarks/session"))).toHaveLength(1);
    const kinds = gets.filter((u) => u.startsWith("/api/deck/items")).map((u) => new URL(u, "http://x").searchParams.get("kind"));
    expect(kinds.filter((k) => k === "music-video-band")).toHaveLength(1);
    expect(kinds.filter((k) => k === "music-video-song")).toHaveLength(1);
    expect(new Set(kinds).size).toBe(kinds.length);
  }, 10000);
});
