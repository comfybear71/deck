import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDeckLocation, deckLocationPictureTarget, normalizeDeckLocation, type DeckLocation } from "./deckLocations";
import { characterMediaOwner, characterPictureTarget } from "./deckMediaPaths";
import type { SkidmarksState } from "./skidmarks";
import {
  NO_SKIDMARKS_EPISODE,
  SKIDMARKS_PILOT_MEDIA_SLUG,
  isCastInSkidmarksEpisode,
  openSkidmarksEpisodeScope,
  skidmarksEpisodeCast,
  skidmarksEpisodeLocations,
  skidmarksEpisodeScopeOf,
} from "./skidmarksEpisodeCast";
import { buildSkidmarksCastMember, normalizeSkidmarksEpisodesState } from "./skidmarksEpisodes";
import { liveFromSunnyBanksWorkspace, type SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";
import { studioLocationList, sunnyBanksLocationList } from "./sunnyBanksLocations";
import { sunnyBanksCastCards, sunnyBanksSpeakerList, sunnyBanksSpeakerNames, resolveSunnyBanksSpeaker } from "./sunnyBanksVoices";
import PILOT from "./skidmarksEpisodeCast.pilot.fixture.json";

/**
 * Each Skidmarks episode has its own Cast and Locations (2026-10-04).
 * The fixture is the live pilot's shape on 4 Oct 2026: EP00 — Cornish
 * Arsehole with 10 rendered Act I clips, Dap (voice) and Sparrow (no
 * voice), town_street and park, and a blank new episode open.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com";
const pilotCard = PILOT.skidmarksStudio.workspaces[0] as unknown as SunnyBanksWorkspaceSnapshot;

function stateWithLive(live: unknown, extra: Partial<SkidmarksState> = {}): SkidmarksState {
  return {
    bands: [],
    session: { projectKind: "skidmarks", bandId: null, mp3: null, scriptSequenceDraft: null },
    removedSeedBandIds: [],
    rosterExtras: { "music-video": [], "sunny-banks": [], "adult-shorts": [] },
    sunnyBanks: null,
    skidmarksStudio: { ...PILOT.skidmarksStudio, live },
    skidmarksEpisodes: PILOT.skidmarksEpisodes,
    locations: PILOT.locations,
    characterLoras: PILOT.characterLoras,
    ...extra,
  } as unknown as SkidmarksState;
}

const BLANK_LIVE = PILOT.skidmarksStudio.live;
const PILOT_LIVE = liveFromSunnyBanksWorkspace(pilotCard);

describe("which episode is open", () => {
  it("the pilot by its pinned folder; a new unnamed episode is no episode", () => {
    expect(pilotCard.mediaSlug).toBe(SKIDMARKS_PILOT_MEDIA_SLUG);
    expect(skidmarksEpisodeScopeOf(PILOT_LIVE)).toEqual({ episode: SKIDMARKS_PILOT_MEDIA_SLUG, legacy: true, tickedIds: [] });
    expect(openSkidmarksEpisodeScope(stateWithLive(BLANK_LIVE).skidmarksStudio)).toEqual(NO_SKIDMARKS_EPISODE);
    expect(openSkidmarksEpisodeScope(null)).toEqual(NO_SKIDMARKS_EPISODE);
  });

  it("an unpinned card is the pilot by its name; a second one pinned -2 is not", () => {
    expect(skidmarksEpisodeScopeOf({ label: "EP00 — Cornish Arsehole" }).legacy).toBe(true);
    expect(skidmarksEpisodeScopeOf({ workspaceTitle: "EP00 — Cornish Arsehole", mediaSlug: "ep00-cornish-arsehole-2" }).legacy).toBe(false);
    expect(skidmarksEpisodeScopeOf({ workspaceTitle: "EP01 — Container Drop", mediaSlug: "ep01-container-drop" })).toEqual({
      episode: "ep01-container-drop",
      legacy: false,
      tickedIds: [],
    });
    // The live copy finds its pin on its card.
    expect(skidmarksEpisodeScopeOf({ episodeId: pilotCard.id }, [pilotCard]).legacy).toBe(true);
  });
});

describe("the migration: worked out on read, nothing deleted or moved", () => {
  it("the pilot keeps Dap, Sparrow, town_street and park, with their pictures and voice", () => {
    const state = stateWithLive(PILOT_LIVE);
    expect(sunnyBanksSpeakerList(state, "skidmarks").map((c) => c.name)).toEqual(["Dap", "Sparrow"]);
    const dap = resolveSunnyBanksSpeaker("Dap", state, "skidmarks")!;
    expect(dap.voiceId).toBe("mvdA70bfQ2Ivt1OXHJqC");
    expect(dap.castPicture).toMatch(/^https:\/\/abc123\.public\.blob\.vercel-storage\.com\/deck\/skidmarks\/characters\/dap\//);
    const sparrow = resolveSunnyBanksSpeaker("Sparrow", state, "skidmarks")!;
    expect(sparrow.voiceId).toBeUndefined();
    expect(sparrow.castPicture).toBeTruthy();
    expect(studioLocationList(state, "skidmarks").map((l) => [l.id, l.image])).toEqual([
      ["town_street", `${BLOB}/deck/skidmarks/locations/town-street.jpg`],
      ["park", `${BLOB}/deck/skidmarks/locations/park.jpg`],
    ]);
  });

  it("its 10 rendered clips are untouched", () => {
    const done = Object.values(pilotCard.runtimeMap.I).filter((r) => r.status === "done");
    expect(done).toHaveLength(10);
    expect(Object.values(PILOT_LIVE.runtimeMap.I)).toEqual(Object.values(pilotCard.runtimeMap.I));
    for (const r of done) expect(r.videoUrl).toMatch(/\/deck\/skidmarks\/episodes\/ep00-cornish-arsehole\/act-i\//);
  });

  it("a new episode starts with empty Cast and Locations", () => {
    const state = stateWithLive(BLANK_LIVE);
    expect(sunnyBanksSpeakerNames(state, "skidmarks")).toEqual([]);
    expect(sunnyBanksCastCards(state, "skidmarks")).toEqual([]);
    expect(studioLocationList(state, "skidmarks")).toEqual([]);
    // Nothing was removed to get there.
    expect(normalizeSkidmarksEpisodesState(state.skidmarksEpisodes)?.cast.map((c) => c.name)).toEqual(["Dap", "Sparrow"]);
    expect(state.locations?.locations).toHaveLength(2);
  });

  it("another episode saved with PR 242 ticks keeps the ticked cards, or none", () => {
    const [dap, sparrow] = PILOT.skidmarksEpisodes.cast;
    const ticked = skidmarksEpisodeScopeOf({ workspaceTitle: "EP01", mediaSlug: "ep01", castIds: [sparrow.id] });
    expect(skidmarksEpisodeCast(PILOT.skidmarksEpisodes.cast, ticked).map((c) => c.name)).toEqual(["Sparrow"]);
    expect(isCastInSkidmarksEpisode(dap, ticked)).toBe(false);
    const none = skidmarksEpisodeScopeOf({ workspaceTitle: "EP02", mediaSlug: "ep02" });
    expect(skidmarksEpisodeCast(PILOT.skidmarksEpisodes.cast, none)).toEqual([]);
    // Old places stay the pilot's.
    expect(skidmarksEpisodeLocations(PILOT.locations as never, ticked)).toEqual([]);
  });

  it("is the same every time it's read (nothing to run twice)", () => {
    const a = stateWithLive(PILOT_LIVE);
    const b = JSON.parse(JSON.stringify(a)) as SkidmarksState;
    expect(sunnyBanksCastCards(b, "skidmarks")).toEqual(sunnyBanksCastCards(a, "skidmarks"));
    expect(studioLocationList(b, "skidmarks")).toEqual(studioLocationList(a, "skidmarks"));
  });
});

describe("renders in an episode only see that episode's Cast and Locations", () => {
  const ep01 = "ep01-container-drop";
  const newDap = buildSkidmarksCastMember("Dap", "", "supporting", 5, "cast_ep01_dap", {
    pictureUrls: [`${BLOB}/deck/skidmarks/episodes/${ep01}/characters/dap/pictures/dap-picture-01.jpg`],
    episode: ep01,
  });
  const newPark: DeckLocation = {
    id: "loc_skidmarks_park_2",
    genre: "skidmarks",
    key: "park_2",
    name: "park",
    pictureUrl: `${BLOB}/deck/skidmarks/episodes/${ep01}/locations/park-2.jpg`,
    createdAt: 9,
    episode: ep01,
  };
  const withEp01 = (live: unknown) =>
    stateWithLive(live, {
      skidmarksEpisodes: { episodes: [], cast: [...PILOT.skidmarksEpisodes.cast, newDap] } as never,
      locations: { locations: [...(PILOT.locations.locations as DeckLocation[]), newPark] },
    });
  const ep01Live = { ...BLANK_LIVE, workspaceTitle: "EP01 — Container Drop", mediaSlug: ep01 };

  it("EP01's own Dap and park; the pilot's Dap and park are not in it", () => {
    const state = withEp01(ep01Live);
    expect(sunnyBanksCastCards(state, "skidmarks")).toEqual([
      { name: "Dap", look: "as in their picture", picture: newDap.pictureUrls![0], speaks: false },
    ]);
    expect(studioLocationList(state, "skidmarks")).toEqual([{ id: "park_2", label: "park", image: newPark.pictureUrl }]);
  });

  it("back in the pilot, EP01's cards are not there", () => {
    const state = withEp01(PILOT_LIVE);
    expect(sunnyBanksCastCards(state, "skidmarks").map((c) => c.picture)).not.toContain(newDap.pictureUrls![0]);
    expect(studioLocationList(state, "skidmarks").map((l) => l.id)).toEqual(["town_street", "park"]);
  });
});

describe("new cards and places are saved under the episode, readable names", () => {
  it("a new episode's character pictures go in deck/skidmarks/episodes/<episode>/characters/<name>/…; old cards stay put", () => {
    const byEpisode = (id: string) => (id === "cast_ep01" ? "ep01-container-drop" : null);
    const fresh = characterMediaOwner({ slug: "dap", name: "Dap", sourceKey: "sk:cast_ep01" }, () => null, byEpisode);
    expect(characterPictureTarget(fresh, 1)).toEqual({
      folder: "deck/skidmarks/episodes/ep01-container-drop/characters/dap/pictures",
      name: "dap-picture-01",
    });
    const old = characterMediaOwner({ slug: "dap", name: "Dap", sourceKey: "sk:cast_692c" }, () => null, byEpisode);
    expect(old.folder).toBe("deck/skidmarks/characters/dap");
    // Sunny Banks unchanged.
    expect(characterMediaOwner({ slug: "shazza", name: "Shazza", sourceKey: "sb:shazza" }, () => null, byEpisode).folder).toBe(
      "deck/sunnybank/characters/shazza",
    );
  });

  it("a new episode's place: its own name, a key nobody else has, a picture in the episode's locations folder", () => {
    const all = PILOT.locations.locations as DeckLocation[];
    const built = buildDeckLocation("skidmarks", all, "park", null, 9, { episode: "ep01-container-drop", nameScope: [] });
    expect(built).toMatchObject({ ok: true, value: { key: "park_2", name: "park", episode: "ep01-container-drop" } });
    // In the pilot the same name is still refused.
    expect(buildDeckLocation("skidmarks", all, "park", null).ok).toBe(false);
    expect(deckLocationPictureTarget("skidmarks", "park_2", "ep01-container-drop")).toEqual({
      folder: "deck/skidmarks/episodes/ep01-container-drop/locations",
      name: "park-2",
    });
    expect(deckLocationPictureTarget("skidmarks", "park")).toEqual({ folder: "deck/skidmarks/locations", name: "park" });
    expect(deckLocationPictureTarget("sunnybank", "park_site_4", "ep01")).toEqual({ folder: "deck/sunnybank/locations", name: "park-site-4" });
    // The episode survives a save and reload; never on another genre.
    expect(normalizeDeckLocation(JSON.parse(JSON.stringify(built.ok && built.value)))?.episode).toBe("ep01-container-drop");
    expect(normalizeDeckLocation({ ...all[0], genre: "sunnybank", id: "loc_sunnybank_town_street", episode: "x" })?.episode).toBeUndefined();
  });

  it("a new Cast card keeps its episode through a save and reload", () => {
    const m = buildSkidmarksCastMember("Dap", "", "supporting", 1, "c1", { episode: "ep01-container-drop" });
    expect(normalizeSkidmarksEpisodesState({ episodes: [], cast: [JSON.parse(JSON.stringify(m))] })?.cast[0].episode).toBe("ep01-container-drop");
    expect(buildSkidmarksCastMember("Dap", "", "supporting", 1, "c2", { episode: "../x" }).episode).toBeUndefined();
  });
});

describe("Sunny Banks is exactly as it was", () => {
  it("its cast and locations don't change whichever Skidmarks episode is open", () => {
    const sunny = (live: unknown) => {
      const s = stateWithLive(live, {
        rosterExtras: {
          "music-video": [],
          "sunny-banks": [{ id: "chr_hans", name: "Hans", look: "", pictureUrls: [`${BLOB}/deck/sunnybank/characters/hans/pictures/hans-picture-01.jpg`], fictionalAdultConfirmed: true, createdAt: 1 }],
          "adult-shorts": [],
        } as never,
      });
      return {
        names: sunnyBanksSpeakerNames(s),
        cards: sunnyBanksCastCards(s),
        places: studioLocationList(s, "sunnybank"),
        oldPlaces: sunnyBanksLocationList(s.locations),
      };
    };
    const a = sunny(BLANK_LIVE);
    const b = sunny(PILOT_LIVE);
    expect(b).toEqual(a);
    expect(a.places).toEqual(a.oldPlaces);
    expect(a.names).toContain("Shazza");
    expect(a.names).toContain("Hans");
    expect(a.names).not.toContain("Dap");
  });
});

describe("the 'In this episode' ticks are gone", () => {
  it("the panel has no tick row; every name the script reads comes from the episode's Cast", () => {
    const src = readFileSync(new URL("../components/SkidmarksSunnyBanksPanel.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("In this episode");
    expect(src).not.toContain("toggleEpisodeCast");
    const guide = readFileSync(new URL("./sunnyBanksGodScriptGuide.ts", import.meta.url), "utf8");
    expect(guide).not.toContain("In this episode");
  });
});
