import { afterEach, describe, expect, it, vi } from "vitest";
import LIVE from "./shortsEpisodeCast.fixture.json";
import { isOlderShortsEpisode, SHORTS_OWN_CAST_SINCE_MS, shortsCardMadeAt, shortsEpisodeScopeOf } from "./shortsEpisodeCast";
import { normalizeAdultShortsState } from "./adultShorts";
import { deckLocationPictureTarget } from "./deckLocations";
import { characterMediaOwner } from "./deckMediaPaths";
import { episodeNameFirstMessage } from "./episodeCast";

/**
 * Stuart's check (2026-10-04): Shorts works like Skidmarks after #245.
 * Every Shorts episode has its own Cast and Locations. The live shape is
 * loaded (sanitized: Blob host `abc123`, made-up voice ID): EP01 and EP02
 * keep Skye, SKYLAR, their shots and clips; the open "Backpackers"
 * (no card yet) and any "+ New" start empty. Every network call is
 * mocked; nothing real is written.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com";
const EP01 = LIVE.adultShorts.saved.find((s) => s.title === "BLONDE GIRL _1")!;
const EP02 = LIVE.adultShorts.saved.find((s) => s.title === "EP02 - BLONDE BEAUTY")!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("which Shorts episodes are the older ones", () => {
  it("reads when a card was made from its id; EP01 and EP02 are older, a card made today is not", () => {
    expect(new Date(shortsCardMadeAt(EP01.id)!).toISOString().slice(0, 10)).toBe("2026-09-29");
    expect(new Date(shortsCardMadeAt(EP02.id)!).toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(isOlderShortsEpisode(EP01)).toBe(true);
    expect(isOlderShortsEpisode(EP02)).toBe(true);
    expect(isOlderShortsEpisode({ id: `short_${(SHORTS_OWN_CAST_SINCE_MS + 60_000).toString(36)}_abcd1234` })).toBe(false);
    // An id that can't be read is treated as older (it can only be from before).
    expect(isOlderShortsEpisode({ id: "weird" })).toBe(true);
  });

  it("the editor with no card (Backpackers right now) is a new episode with no folder yet", () => {
    const adult = normalizeAdultShortsState(LIVE.adultShorts);
    expect(shortsEpisodeScopeOf(adult)).toEqual({ episode: null, legacy: false, tickedIds: [] });
    expect(shortsEpisodeScopeOf({ ...adult!, currentSavedId: EP01.id, mediaSlug: EP01.mediaSlug })).toEqual({
      episode: "blonde-girl-1",
      legacy: true,
      tickedIds: [],
    });
  });

  it("a new episode's Cast cards and places are filed with the episode", () => {
    const owner = characterMediaOwner({ slug: "kate", name: "Kate", sourceKey: "asx:x1" }, () => null, (id, genre) =>
      genre === "shorts" && id === "x1" ? "ep03-backpackers" : null,
    );
    expect(owner.folder).toBe("deck/shorts/episodes/ep03-backpackers/characters/kate");
    // Older Shorts cards keep their folder.
    expect(characterMediaOwner({ slug: "skye", name: "Skye", sourceKey: "asx:skye" }, () => null).folder).toBe("deck/shorts/characters/skye");
    expect(characterMediaOwner({ slug: "skylar", name: "SKYLAR", sourceKey: "as:skylar" }, () => null).folder).toBe("deck/shorts/characters/skylar");
    expect(deckLocationPictureTarget("adult-shorts", "woolshed", "ep03-backpackers")).toEqual({
      folder: "deck/shorts/episodes/ep03-backpackers/locations",
      name: "woolshed",
    });
    expect(deckLocationPictureTarget("adult-shorts", "woolshed").folder).toBe("deck/shorts/locations");
  });

  it("the name-first message is the same words as Skidmarks", () => {
    expect(episodeNameFirstMessage("skidmarks", "characters")).toBe("Give the episode a name first (the # EPISODE: line), then add its characters.");
    expect(episodeNameFirstMessage("adult-shorts", "characters")).toBe("Give the episode a name first (tap + New and type it), then add its characters.");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Call = { method: string; url: string; body: unknown };

async function boot(server: { session: unknown }) {
  vi.resetModules();
  const calls: Call[] = [];
  // Test stand-ins for the browser globals the store touches.
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
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.startsWith("/api/skidmarks/session")) {
        if (method === "GET") return j({ configured: true, state: server.session, revision: 10, updatedAt: new Date().toISOString() });
        server.session = (JSON.parse(String(init!.body)) as { state: unknown }).state;
        return j({ ok: true, configured: true, revision: 11 });
      }
      if (url.startsWith("/api/deck/items")) {
        if (method === "GET") return j({ ok: true, configured: true, ready: true, seeded: false, items: [], deleted: [] });
        return j({ ok: true, revision: 1 });
      }
      return j({ unexpected: url }, 404);
    }),
  );
  const sk = await import("./skidmarks");
  const roster = await import("./characterRoster");
  const rosterExtras = await import("./rosterExtras");
  const shortsCast = await import("./shortsCast");
  const adultShorts = await import("./adultShorts");
  const locationsRow = await import("../components/LocationsRow");
  const locationEdits = await import("./locationEdits");
  const extras = await import("./episodeExtrasProject");
  const folders = await import("./episodeFolders");
  const targets = await import("./deckMediaTargets");
  const edits = await import("./characterEdits");
  sk.subscribeSkidmarks(() => {});
  sk.getSkidmarksSnapshot();
  await wait(200);
  /** What the Shorts screen shows for the open episode. */
  const screen = () => {
    const snap = sk.getSkidmarksSnapshot();
    const a = sk.getAdultShortsState(snap);
    return {
      cast: roster.buildCharacterRoster(snap)["adult-shorts"].map((c) => c.name),
      starring: shortsCast.shortsEpisodeStarringList(snap).map((p) => p.name),
      locations: locationsRow.locationsOnRow("adult-shorts", snap).map((l) => l.key),
      shots: a.shots.length,
      clips: a.shots.map((s) => s.clipUrl).filter(Boolean),
      extrasFolder: extras.episodeExtrasProjectFor(snap, "shorts").folder,
    };
  };
  return { sk, roster, rosterExtras, shortsCast, adultShorts, locationsRow, locationEdits, folders, targets, edits, calls, screen };
}

const session = () => ({
  bands: [],
  removedSeedBandIds: [],
  session: { projectKind: "adult-shorts", bandId: null, mp3: null, scriptSequenceDraft: null },
  adultShorts: LIVE.adultShorts,
  characterLoras: LIVE.characterLoras,
  rosterExtras: LIVE.rosterExtras,
  locations: LIVE.locations,
});

const EMPTY = { cast: [], starring: [], locations: [], shots: 1, clips: [], extrasFolder: null };

describe("Shorts: + New is empty; EP01 and EP02 are unchanged", () => {
  it("new empty, EP01/EP02 full, a new episode's own people and places stay in it, and it survives a reload", async () => {
    const server = { session: session() as unknown };
    let page = await boot(server);
    const sunnyBefore = page.roster.buildCharacterRoster(page.sk.getSkidmarksSnapshot())["sunny-banks"].map((c) => c.name);

    // Right now: Backpackers, no card yet. Skye and SKYLAR aren't on its
    // Cast row and its stale "starring" (from before) doesn't count.
    expect(page.screen()).toEqual(EMPTY);
    expect(page.sk.getAdultShortsState().starring?.map((p) => p.name)).toEqual(["Skye", "SKYLAR"]); // still saved as it was
    expect(page.calls.filter((c) => c.method !== "GET")).toEqual([]); // nothing written on load

    // EP01: Skye, SKYLAR, its 10 shots and 9 clips, exactly as saved.
    page.sk.openAdultShortEpisode(EP01.id);
    const ep01 = page.screen();
    expect(ep01.cast.slice().sort()).toEqual(["SKYLAR", "Skye"]);
    expect(ep01.starring).toEqual(["SKYLAR"]);
    expect(ep01.shots).toBe(10);
    expect(ep01.clips).toEqual(EP01.shots.map((s) => s.clipUrl).filter(Boolean));
    expect(ep01.clips).toHaveLength(9);
    expect(ep01.extrasFolder).toBe("deck/shorts/shorts/blonde-girl-1");
    expect(page.sk.getAdultShortsState().shots).toEqual(page.adultShorts.normalizeAdultShortsState({ ...LIVE.adultShorts, shots: EP01.shots })!.shots);
    // EP02 too.
    page.sk.openAdultShortEpisode(EP02.id);
    expect(page.screen()).toMatchObject({ starring: ["SKYLAR"], shots: 2, clips: EP02.shots.map((s) => s.clipUrl) });
    expect(page.screen().cast.slice().sort()).toEqual(["SKYLAR", "Skye"]);

    // + New with no name: empty, and adding has to wait for a name.
    page.sk.startNewAdultShortEpisode("");
    expect(page.screen()).toEqual(EMPTY);
    expect(page.folders.pinOpenEpisodeFolder("adult-shorts")).toBeNull();

    // + New "Backpackers": its own folder, then its own Kate and woolshed.
    page.sk.startNewAdultShortEpisode("Backpackers");
    expect(page.screen()).toEqual(EMPTY);
    const folder = page.folders.pinOpenEpisodeFolder("adult-shorts");
    expect(folder).toBe("ep03-backpackers");
    expect(page.screen().extrasFolder).toBe("deck/shorts/episodes/ep03-backpackers");
    expect(page.targets.rosterPictureTargetFor("adult-shorts", "Kate", null, 1)).toEqual({
      folder: "deck/shorts/episodes/ep03-backpackers/characters/kate/pictures",
      name: "kate-picture-01",
    });
    const kate = page.rosterExtras.buildRosterExtraCharacter(
      "Kate",
      "",
      { pictureUrls: [`${BLOB}/deck/shorts/episodes/ep03-backpackers/characters/kate/pictures/kate-picture-01.jpg`], episode: folder },
      5,
      "x_kate",
    );
    page.sk.patchRosterExtras((st) => ({ ...st, "adult-shorts": [...st["adult-shorts"], kate] }));
    const placed = page.locationEdits.addDeckLocation("adult-shorts", "Woolshed", `${BLOB}/deck/shorts/episodes/ep03-backpackers/locations/woolshed.jpg`, {
      episode: folder,
      nameScope: [],
    });
    expect(placed.ok).toBe(true);
    const kateTile = page.roster.buildCharacterRoster(page.sk.getSkidmarksSnapshot())["adult-shorts"];
    expect(kateTile).toEqual([expect.objectContaining({ name: "Kate", sourceKey: "asx:x_kate", style: "photo" })]);
    expect(page.screen()).toMatchObject({ cast: ["Kate"], locations: ["woolshed"], starring: [] });

    // Starring: Kate on, then off again. Nobody has to star.
    const kateCast = page.shortsCast.shortsCastList(page.sk.getSkidmarksSnapshot())[0];
    page.sk.patchAdultShorts((st) => page.adultShorts.setAdultShortStarring(st, [page.shortsCast.shortsCharacterFromCast(kateCast)]));
    expect(page.screen().starring).toEqual(["Kate"]);
    page.sk.patchAdultShorts((st) => page.adultShorts.setAdultShortStarring(st, []));
    expect(page.screen().starring).toEqual([]);
    page.sk.patchAdultShorts((st) => page.adultShorts.setAdultShortStarring(st, [page.shortsCast.shortsCharacterFromCast(kateCast)]));
    // A shot with something in it gives the episode its card.
    page.sk.patchAdultShorts((st) => ({ ...st, shots: st.shots.map((s, i) => (i === 0 ? { ...s, prompt: "Kate runs through the spinifex at dusk" } : s)) }));
    const card = page.sk.getAdultShortsState().saved.find((s) => s.mediaSlug === "ep03-backpackers")!;
    expect(card).toBeTruthy();
    expect(isOlderShortsEpisode(card)).toBe(false);
    expect(page.screen()).toMatchObject({ cast: ["Kate"], starring: ["Kate"], locations: ["woolshed"] });

    // A rename follows Kate into this episode's Starring only.
    const renamed = page.edits.renameRosterCharacter(page.roster.buildCharacterRoster(page.sk.getSkidmarksSnapshot())["adult-shorts"][0], "Katie");
    expect(renamed.ok).toBe(true);
    expect(page.screen()).toMatchObject({ cast: ["Katie"], starring: ["Katie"] });

    // Back to EP01: unchanged (no Katie, no woolshed).
    page.sk.openAdultShortEpisode(EP01.id);
    expect(page.screen()).toEqual(ep01);
    // Nothing was deleted anywhere.
    const after = page.sk.getSkidmarksSnapshot();
    expect(page.sk.getAdultShortsState(after).saved.map((s) => s.id)).toEqual(expect.arrayContaining([EP01.id, EP02.id]));
    expect(page.sk.getCharacterLorasState(after).characters.map((c) => c.sourceKey)).toEqual(expect.arrayContaining(["asx:skye", "as:skylar"]));
    expect(page.sk.getDeckLocationsState(after).locations.map((l) => `${l.genre}:${l.key}`)).toEqual([
      "skidmarks:town_street",
      "skidmarks:park",
      "adult-shorts:woolshed",
    ]);
    // Sunnybank didn't notice.
    expect(page.roster.buildCharacterRoster(after)["sunny-banks"].map((c) => c.name)).toEqual(sunnyBefore);
    // No delete was ever sent.
    expect(page.calls.filter((c) => c.method === "DELETE")).toEqual([]);

    // Reload from what was saved.
    page.sk.flushSkidmarksSessionNow();
    await wait(300);
    page = await boot(server);
    page.sk.openAdultShortEpisode(EP01.id);
    expect(page.screen()).toEqual(ep01);
    const saved = page.sk.getAdultShortsState().saved.find((s) => s.mediaSlug === "ep03-backpackers")!;
    page.sk.openAdultShortEpisode(saved.id);
    expect(page.screen()).toMatchObject({ cast: ["Katie"], starring: ["Katie"], locations: ["woolshed"], extrasFolder: "deck/shorts/episodes/ep03-backpackers" });
  }, 20000);
});
