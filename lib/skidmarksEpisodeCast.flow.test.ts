import { afterEach, describe, expect, it, vi } from "vitest";
import PILOT from "./skidmarksEpisodeCast.pilot.fixture.json";

/**
 * Stuart's check (2026-10-04), through the real store with the live
 * pilot's shape loaded from a mocked server: Skidmarks "+ New" gives a
 * clean workspace (empty Cast, Locations, script, clips, Extras); back to
 * EP00 shows Dap, Sparrow, town_street, park and its 10 clips unchanged.
 * Every network call is mocked; nothing real is written.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.unstubAllGlobals();
});

async function boot(server: { session: unknown }) {
  vi.resetModules();
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
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.startsWith("/api/skidmarks/session")) {
        if (method === "GET") return j({ configured: true, state: server.session, revision: 10, updatedAt: new Date().toISOString() });
        server.session = (JSON.parse(String(init!.body)) as { state: unknown }).state;
        return j({ ok: true, configured: true, revision: 11 });
      }
      if (url.startsWith("/api/deck/items")) {
        if (method === "GET") return j({ ok: true, configured: true, ready: true, seeded: false, items: [], deleted: [] });
        return j({ ok: true });
      }
      return j({ unexpected: url }, 404);
    }),
  );
  const sk = await import("./skidmarks");
  const roster = await import("./characterRoster");
  const locationsRow = await import("../components/LocationsRow");
  const voices = await import("./sunnyBanksVoices");
  const places = await import("./sunnyBanksLocations");
  const extras = await import("./episodeExtrasProject");
  const locationEdits = await import("./locationEdits");
  const episodes = await import("./skidmarksEpisodes");
  sk.subscribeSkidmarks(() => {});
  sk.getSkidmarksSnapshot();
  await wait(200);
  /** What the Skidmarks screen shows for the open episode. */
  const screen = () => {
    const snap = sk.getSkidmarksSnapshot();
    const live = sk.getSunnyBanksLiveOrDefault(snap, "skidmarks");
    return {
      title: live.workspaceTitle,
      cast: roster.buildCharacterRoster(snap).skidmarks.map((c) => c.name),
      locations: locationsRow.locationsOnRow("skidmarks", snap).map((l) => l.key),
      script: Object.values(live.actScripts).join(""),
      clips: Object.values(live.runtimeMap).flatMap((m) => Object.values(m).filter((r) => r.status === "done").map((r) => r.videoUrl)),
      extrasFolder: extras.episodeExtrasProjectFor(snap, "skidmarks").folder,
    };
  };
  return { sk, voices, places, locationEdits, episodes, screen };
}

const session = () => ({
  bands: [],
  removedSeedBandIds: [],
  session: { projectKind: "skidmarks", bandId: null, mp3: null, scriptSequenceDraft: null },
  skidmarksStudio: PILOT.skidmarksStudio,
  skidmarksEpisodes: PILOT.skidmarksEpisodes,
  locations: PILOT.locations,
  characterLoras: PILOT.characterLoras,
});

const pilotId = PILOT.skidmarksStudio.workspaces[0].id;
const pilotClips = Object.values(PILOT.skidmarksStudio.workspaces[0].runtimeMap.I).map((r) => r.videoUrl);

describe("Skidmarks: + New is a clean workspace; EP00 is unchanged", () => {
  it("new episode empty, EP00 full, a new episode's own Dap and park stay in it, and it all survives a reload", async () => {
    const server = { session: session() as unknown };
    let page = await boot(server);
    const sunnyBefore = { names: page.voices.sunnyBanksSpeakerNames(page.sk.getSkidmarksSnapshot()) };

    // What's open live right now: a blank new episode.
    expect(page.screen()).toEqual({ title: "", cast: [], locations: [], script: "", clips: [], extrasFolder: null });

    // Back to EP00.
    page.sk.openSunnyBanksWorkspace(pilotId, "skidmarks");
    const ep00 = page.screen();
    expect(ep00.title).toBe("EP00 — Cornish Arsehole");
    expect(ep00.cast).toEqual(["Dap", "Sparrow"]);
    expect(ep00.locations).toEqual(["town_street", "park"]);
    expect(ep00.clips).toEqual(pilotClips);
    expect(ep00.clips).toHaveLength(10);
    expect(ep00.extrasFolder).toBe("deck/skidmarks/episodes/ep00-cornish-arsehole");
    const snap = page.sk.getSkidmarksSnapshot();
    expect(page.voices.resolveSunnyBanksSpeaker("Dap", snap, "skidmarks")?.voiceId).toBe("mvdA70bfQ2Ivt1OXHJqC");
    expect(page.voices.sunnyBanksSpeakerNames(snap, "skidmarks")).toEqual(["Sparrow", "Dap"]);

    // + New: clean.
    page.sk.startNewSunnyBanksEpisode("skidmarks");
    expect(page.screen()).toEqual({ title: "", cast: [], locations: [], script: "", clips: [], extrasFolder: null });

    // Name it and give it its own Dap and its own park.
    page.sk.patchSunnyBanksLive((live) => ({ ...live, workspaceTitle: "EP01 — Container Drop" }), "skidmarks");
    const folder = page.sk.pinSkidmarksEpisodeFolder();
    expect(folder).toBe("ep01-container-drop");
    // Extras still use the same episode folder as its clips, Cast and Locations.
    expect(page.screen().extrasFolder).toBe("deck/skidmarks/episodes/ep01-container-drop");
    const newDap = page.episodes.buildSkidmarksCastMember("Dap", "", "supporting", 5, "cast_ep01_dap", {
      pictureUrls: [`${BLOB}/deck/skidmarks/episodes/ep01-container-drop/characters/dap/pictures/dap-picture-01.jpg`],
      episode: folder,
    });
    page.sk.patchSkidmarksEpisodes((st) => ({ ...st, cast: [...st.cast, newDap] }));
    const added = page.locationEdits.addDeckLocation("skidmarks", "park", `${BLOB}/deck/skidmarks/episodes/ep01-container-drop/locations/park-2.jpg`, {
      episode: folder,
      nameScope: [],
    });
    expect(added.ok).toBe(true);
    const ep01 = page.screen();
    expect(ep01.cast).toEqual(["Dap"]);
    expect(ep01.locations).toEqual(["park_2"]);
    const ep01Snap = page.sk.getSkidmarksSnapshot();
    expect(page.voices.resolveSunnyBanksSpeaker("Dap", ep01Snap, "skidmarks")?.castPicture).toBe(newDap.pictureUrls![0]);
    expect(page.places.findSunnyBanksLocation(page.places.studioLocationList(ep01Snap, "skidmarks"), "park")?.id).toBe("park_2");

    // Back to EP00: still Dap (the old one), Sparrow, town_street, park and its 10 clips.
    page.sk.openSunnyBanksWorkspace(pilotId, "skidmarks");
    expect(page.screen()).toEqual(ep00);
    expect(page.voices.resolveSunnyBanksSpeaker("Dap", page.sk.getSkidmarksSnapshot(), "skidmarks")?.castPicture).not.toBe(newDap.pictureUrls![0]);
    // Nothing was deleted anywhere.
    expect(page.sk.getSkidmarksEpisodesState().cast.map((c) => c.id)).toEqual([...PILOT.skidmarksEpisodes.cast.map((c) => c.id), "cast_ep01_dap"]);
    expect(page.sk.getDeckLocationsState().locations.map((l) => l.key)).toEqual(["town_street", "park", "park_2"]);
    // Sunny Banks didn't notice.
    expect(page.voices.sunnyBanksSpeakerNames(page.sk.getSkidmarksSnapshot())).toEqual(sunnyBefore.names);

    // Reload from what was saved.
    page.sk.flushSkidmarksSessionNow();
    await wait(300);
    page = await boot(server);
    expect(page.screen()).toEqual(ep00);
    const ep01Card = page.sk.getStudioState("skidmarks")!.workspaces.find((w) => w.mediaSlug === "ep01-container-drop")!;
    page.sk.openSunnyBanksWorkspace(ep01Card.id, "skidmarks");
    expect(page.screen()).toMatchObject({ title: "EP01 — Container Drop", cast: ["Dap"], locations: ["park_2"], clips: [] });
  }, 20000);
});
