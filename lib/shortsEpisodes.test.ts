import { afterEach, describe, expect, it, vi } from "vitest";
import type { RosterCharacter } from "./characterRoster";

/**
 * Shorts episodes and Shorts cast profiles (2026-09-30) through the real
 * store with a fake server: the short Stuart already has becomes EP01
 * with the editor's five shots (nothing written on load, no shot lost on
 * the first save), "+ New" starts a blank, named EP02, deleting
 * the open episode clears the editor without it coming back, and a cast
 * profile is saved on the character's own row. Never Blob.
 */

type Row = { kind: string; itemId: string; folder: string; data: unknown; revision: number; updatedAt: string; deletedAt: string | null };
type Call = { method: string; url: string; body?: Record<string, unknown> };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BLOB = "https://abc123.public.blob.vercel-storage.com";

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
          const kind = q.get("kind");
          const mine = server.rows.filter((r) => r.kind === kind);
          const seeded = kind === "character" || kind === "adult-short";
          return j({
            ok: true,
            configured: true,
            ready: true,
            seeded,
            items: mine.filter((r) => !r.deletedAt),
            deleted: mine.filter((r) => r.deletedAt).map((r) => ({ itemId: r.itemId, revision: r.revision })),
          });
        }
        if (method === "PUT") {
          const at = server.rows.findIndex((r) => r.kind === body!.kind && r.itemId === body!.itemId);
          const current = at >= 0 ? server.rows[at] : null;
          if ((current?.revision ?? 0) !== body!.expectedRevision) return j({ conflict: true, item: current }, 409);
          const row: Row = { kind: String(body!.kind), itemId: String(body!.itemId), folder: "adult-shorts", data: body!.data, revision: (current?.revision ?? 0) + 1, updatedAt: "t", deletedAt: null };
          if (at >= 0) server.rows[at] = row;
          else server.rows.push(row);
          return j({ ok: true, item: row });
        }
        if (method === "DELETE") {
          const at = server.rows.findIndex((r) => r.kind === q.get("kind") && r.itemId === q.get("itemId"));
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
  const shorts = await import("./adultShorts");
  const edits = await import("./characterEdits");
  const roster = await import("./characterRoster");
  sk.subscribeSkidmarks(() => {});
  sk.getSkidmarksSnapshot();
  await wait(200);
  const writes = () => calls.filter((c) => c.url.startsWith("/api/deck/items") && c.method !== "GET");
  const tileNamed = (group: RosterCharacter["group"], name: string) =>
    roster.buildCharacterRoster(sk.getSkidmarksSnapshot())[group].find((c) => c.name === name) ?? null;
  return { sk, shorts, edits, calls, writes, tileNamed };
}

function shot(id: string, prompt: string, clip: boolean, plate: boolean, durationSec = 5) {
  return {
    id,
    prompt,
    durationSec,
    referenceIndex: 0,
    plateUrl: plate ? `${BLOB}/skidmarks/adult-shorts/${id}-plate.jpg` : null,
    clipUrl: clip ? `${BLOB}/skidmarks/adult-shorts/${id}.mp4` : null,
    lastFrameUrl: clip ? `${BLOB}/skidmarks/adult-shorts/${id}-last.jpg` : null,
    sirayTaskId: null,
    chainFromPrevious: false,
  };
}

/** The same shape as Stuart's live data (2026-09-30, read-only check). */
const SKYLAR_SHOTS = [
  shot("shot_1", "Lounging on a worn velvet couch in a band rehearsal room", false, true),
  shot("shot_2", "Sitting in a white wicker chair on a sunny terrace", true, true),
  shot("shot_3", "She rises gracefully from the white wicker chair", true, false),
  shot("shot_4", "Seen only from behind, she stands at the foot of the bed", true, false),
  shot("shot_5", "Standing at the foot of the bed, she slowly turns", true, false, 10),
];
const REFS = [`${BLOB}/deck/shorts/characters/skylar/pictures/skylar-picture-01.jpg`];
const SAVED_SHORT = {
  id: "short_mumdrqaw_97e2b2ad",
  title: "BLONDE GIRL _1",
  savedAt: "2026-09-29T07:54:24.872Z",
  character: { name: "", look: "", referenceUrls: REFS },
  shots: SKYLAR_SHOTS,
};

function liveLikeServer() {
  return {
    session: {
      bands: [],
      removedSeedBandIds: [],
      session: { projectKind: "adult-shorts", bandId: null, mp3: null, scriptSequenceDraft: null },
      adultShorts: {
        ageConfirmed: true,
        character: { name: "SKYLAR", look: "blonde", referenceUrls: REFS },
        shots: structuredClone(SKYLAR_SHOTS),
        saved: [structuredClone(SAVED_SHORT)],
        currentSavedId: SAVED_SHORT.id,
      },
    },
    rows: [
      { kind: "adult-short", itemId: SAVED_SHORT.id, folder: "adult-shorts", data: structuredClone(SAVED_SHORT), revision: 2, updatedAt: "t", deletedAt: null },
    ] as Row[],
  };
}

describe("Shorts episodes, saved per item", () => {
  it("Skylar's five shots are EP01: nothing written on load, then saved onto EP01 with nothing lost", async () => {
    const server = liveLikeServer();
    const page = await boot(server);
    expect(page.writes()).toEqual([]);

    const state = page.sk.getAdultShortsState();
    const numbers = page.shorts.adultShortEpisodeNumbers(state.saved);
    expect(numbers.get(SAVED_SHORT.id)).toBe(1);
    expect(page.shorts.adultShortEpisodeCode(1)).toBe("EP01");
    const view = page.shorts.adultShortEpisodeView(state, state.saved[0]);
    expect(view.character.name).toBe("SKYLAR");
    expect(view.shots.map((s) => s.id)).toEqual(SKYLAR_SHOTS.map((s) => s.id));
    expect(page.shorts.describeAdultShortEpisode(view.shots)).toBe("5 shots · 4 clips");

    // The first edit saves the editor onto the same EP01 row.
    page.sk.patchAdultShorts((s) => ({ ...s, shots: s.shots.map((x, i) => (i === 0 ? { ...x, durationSec: 6 } : x)) }));
    await wait(1200);
    const puts = page.writes().filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toMatchObject({ kind: "adult-short", itemId: SAVED_SHORT.id, expectedRevision: 2 });
    const data = puts[0].body!.data as { character: { name: string }; shots: { id: string; clipUrl: string | null; plateUrl: string | null }[]; episodeNumber: number; title: string };
    expect(data.character.name).toBe("SKYLAR");
    expect(data.title).toBe("BLONDE GIRL _1");
    expect(data.episodeNumber).toBe(1);
    expect(data.shots.map((s) => s.id)).toEqual(SKYLAR_SHOTS.map((s) => s.id));
    expect(data.shots.map((s) => s.clipUrl)).toEqual(SKYLAR_SHOTS.map((s) => s.clipUrl));
    expect(data.shots.map((s) => s.plateUrl)).toEqual(SKYLAR_SHOTS.map((s) => s.plateUrl));
    expect(page.sk.getAdultShortsState().saved).toHaveLength(1);
    expect(page.calls.every((c) => c.url.startsWith("/api/skidmarks/session") || c.url.startsWith("/api/deck/items"))).toBe(true);
  }, 15000);

  it("+ New is a blank workspace with its typed name; EP02 only appears once a shot has something in it", async () => {
    const page = await boot(liveLikeServer());
    page.sk.startNewAdultShortEpisode("Brother vs Rambo");
    await wait(1200);
    expect(page.writes()).toEqual([]);
    let state = page.sk.getAdultShortsState();
    // Blank: no one starring, one empty shot, 18+ off, just the name.
    expect(state.character.name).toBe("");
    expect(state.starring).toEqual([]);
    expect(state.shots).toHaveLength(1);
    expect(state.shots[0].prompt).toBe("");
    expect(state.adult).toBe(false);
    expect(state.title).toBe("Brother vs Rambo");
    expect(state.currentSavedId).toBeNull();
    expect(state.saved).toHaveLength(1);

    page.sk.patchAdultShorts((s) => ({ ...s, shots: s.shots.map((x) => ({ ...x, prompt: "Two brothers arm-wrestle in a garage" })) }));
    await wait(1200);
    state = page.sk.getAdultShortsState();
    expect(state.saved).toHaveLength(2);
    const ep2 = state.saved.find((x) => x.id === state.currentSavedId)!;
    expect(ep2.title).toBe("Brother vs Rambo");
    expect(ep2.adult).toBe(false);
    expect(page.shorts.adultShortEpisodeNumbers(state.saved).get(ep2.id)).toBe(2);
    const puts = page.writes().filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toMatchObject({ kind: "adult-short", itemId: ep2.id, expectedRevision: 0, data: { episodeNumber: 2, title: "Brother vs Rambo", adult: false } });
    // Its files go in a readable folder named after it.
    const targets = await import("./deckMediaTargets");
    expect(targets.adultShortTargetFor("plate", 1).folder).toBe("deck/shorts/episodes/ep02-brother-vs-rambo");

    // Open EP01 again: it's the editor's again, unchanged, and still 18+.
    page.sk.openAdultShortEpisode(SAVED_SHORT.id);
    state = page.sk.getAdultShortsState();
    expect(state.currentSavedId).toBe(SAVED_SHORT.id);
    expect(state.shots.map((s) => s.id)).toEqual(SKYLAR_SHOTS.map((s) => s.id));
    expect(page.shorts.adultShortIsAdult(state)).toBe(true);
    // Let the debounced saves finish here, not in the next test.
    await wait(1500);
  }, 15000);

  it("deleting the open episode is one tombstone and clears the editor so it isn't saved straight back", async () => {
    const server = liveLikeServer();
    const page = await boot(server);
    page.sk.removeSavedAdultShort(SAVED_SHORT.id);
    await wait(1200);
    expect(page.writes().map((c) => `${c.method} ${c.url}`)).toEqual([
      `DELETE /api/deck/items?kind=adult-short&itemId=${SAVED_SHORT.id}&expectedRevision=2`,
    ]);
    const state = page.sk.getAdultShortsState();
    expect(state.saved).toEqual([]);
    expect(state.currentSavedId).toBeNull();
    expect(state.shots.every((s) => !s.prompt && !s.clipUrl)).toBe(true);
  }, 15000);
});

describe("Shorts cast profile, saved per item", () => {
  it("refuses an age under 21, then saves age, bio, personality and the AI-generated label on her own row", async () => {
    const server = liveLikeServer();
    server.rows.push({
      kind: "character",
      itemId: "clora_skye",
      folder: "adult-shorts",
      data: { id: "clora_skye", name: "Skye", slug: "skye", sourceKey: "asx:skye", status: "ready", trainingImageUrls: [`${BLOB}/skye.jpg`], version: 1, createdAt: "2026-09-29T00:00:00.000Z" },
      revision: 10,
      updatedAt: "t",
      deletedAt: null,
    });
    let page = await boot(server);
    const skye = page.tileNamed("adult-shorts", "Skye")!;
    expect(page.edits.characterCanHaveProfile(skye, page.sk.getSkidmarksSnapshot())).toBe(true);
    expect(page.edits.characterProfile(null)).toEqual({ aiGenerated: true });

    const young = page.edits.setCharacterProfile(skye, { age: "19", bio: "", chatPersonality: "", aiGenerated: true });
    expect(young).toEqual({ ok: false, error: "Age must be 21 or over." });
    await wait(1200);
    expect(page.writes()).toEqual([]);

    const ok = page.edits.setCharacterProfile(skye, { age: "24", bio: "  Surf photographer from Byron. ", chatPersonality: "playful, teasing", aiGenerated: true });
    expect(ok.ok).toBe(true);
    await wait(1200);
    expect(page.writes().filter((c) => c.method === "PUT").map((c) => c.body)).toMatchObject([
      {
        kind: "character",
        itemId: "clora_skye",
        expectedRevision: 10,
        data: { name: "Skye", profile: { age: 24, bio: "Surf photographer from Byron.", chatPersonality: "playful, teasing", aiGenerated: true } },
      },
    ]);

    // Reload: still there.
    page = await boot(server);
    const card = page.sk.getCharacterLorasState().characters.find((c) => c.id === "clora_skye")!;
    expect(card.profile).toEqual({ age: 24, bio: "Surf photographer from Byron.", chatPersonality: "playful, teasing", aiGenerated: true });
    // Other genres don't get the profile fields.
    expect(page.edits.characterCanHaveProfile({ group: "sunny-banks", sourceKey: "sb:shazza", name: "Shazza" }, page.sk.getSkidmarksSnapshot())).toBe(false);
  }, 20000);
});
