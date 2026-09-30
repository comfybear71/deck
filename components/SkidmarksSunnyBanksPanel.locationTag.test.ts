import { describe, expect, it } from "vitest";
import {
  collectSunnyBanksEpisodePrompts,
  parseSunnyBanksScriptBlock,
  pickSunnyBanksRowLocation,
  resolveSunnyBanksRowLocationId,
  sunnyBanksQueueChunks,
} from "./SkidmarksSunnyBanksPanel";
import { buildSunnyBanksDropBearsSeed } from "@/lib/sunnyBanksDropBears";
import {
  buildDefaultSunnyBanksLive,
  buildSunnyBanksWorkspaceFromLive,
  fingerprintWorkspace,
  liveFromSunnyBanksWorkspace,
  normalizeSunnyBanksStudio,
} from "@/lib/sunnyBanksWorkspace";

// EP02 Act II as it's saved in Stuart's session (2026-10-01), cut down.
const EP02_ACT_II = [
  "=== ACT II — SCENE 1 — PARK SITE 4 ===",
  "[Location: park_site_4]",
  "[Action: Wide. Nuggets walks slowly away from the Unit 4 caravan across the red dirt, hands in pockets, side on. Camera still. No other people]",
  "Nuggets:",
  "[Character Shazza: standing by the Unit 4 caravan]",
  "Shazza: [yells] Nuggets! Don't you walk away from me.",
  "Shazza: I need a favour, and you're gonna do it.",
].join("\n");
// The old Crash Lab demo seed's saved row locations, still on every row.
const STALE_SEED_OVERRIDES = { 0: "tin_shed_mower", 1: "tin_shed_mower", 2: "tin_shed_mower" };

describe("a row's [Location: …] tag beats a saved row location (2026-10-01)", () => {
  it("EP02 Act II: all three rows render at Park Site 4, not the stale Tin Shed", () => {
    const prompts = collectSunnyBanksEpisodePrompts({
      actIds: ["II"],
      actScripts: { II: EP02_ACT_II },
      characterOverrides: { II: {} },
      locationOverrides: { II: STALE_SEED_OVERRIDES },
      defaultLocationId: "main_entrance_sign",
    });
    expect(prompts.map((p) => p.characterName)).toEqual(["Nuggets", "Shazza", "Shazza"]);
    expect(prompts.map((p) => p.locationId)).toEqual(["park_site_4", "park_site_4", "park_site_4"]);
  });

  it("the parser marks rows under a tag (own or inherited) and leaves rows above any tag unmarked", () => {
    const chunks = sunnyBanksQueueChunks(
      parseSunnyBanksScriptBlock("Shazza: before any tag\n[Location: site_laundry]\nShazza: tagged\nDazza: still tagged")
    );
    expect(chunks[0].locationTag).toBeUndefined();
    expect(chunks[1].locationTag).toBe("site_laundry");
    expect(chunks[2].locationTag).toBe("site_laundry");
  });

  it("a row with no tag still uses its saved dropdown pick, then the default", () => {
    const [chunk] = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock("Shazza: no tag here"));
    expect(resolveSunnyBanksRowLocationId(chunk, "office_booth", undefined, "main_entrance_sign")).toBe("office_booth");
    expect(resolveSunnyBanksRowLocationId(chunk, undefined, undefined, "main_entrance_sign")).toBe(chunk.locationId);
  });

  it("a dropdown pick made on a tagged row counts, until the tag itself is changed", () => {
    const tagged = { locationId: "park_site_4", locationTag: "park_site_4" };
    const picked = pickSunnyBanksRowLocation({ locationOverrides: {}, locationPickTags: {} }, 1, "park_site_4", "office_booth");
    expect(picked).toEqual({ locationOverrides: { 1: "office_booth" }, locationPickTags: { 1: "park_site_4" } });
    // Picked after the tag: the pick wins.
    expect(resolveSunnyBanksRowLocationId(tagged, picked.locationOverrides[1], picked.locationPickTags[1], "main_entrance_sign")).toBe(
      "office_booth"
    );
    // Tag changed after the pick: the new tag wins.
    const retagged = { locationId: "site_laundry", locationTag: "site_laundry" };
    expect(
      resolveSunnyBanksRowLocationId(retagged, picked.locationOverrides[1], picked.locationPickTags[1], "main_entrance_sign")
    ).toBe("site_laundry");
    // A saved location with no pick tag (every row saved before this) never beats the tag.
    expect(resolveSunnyBanksRowLocationId(tagged, "tin_shed_mower", undefined, "main_entrance_sign")).toBe("park_site_4");
  });

  it("picking the tag's own location clears the row's pick; picking on an untagged row saves no tag", () => {
    const start = { locationOverrides: { 1: "tin_shed_mower", 2: "office_booth" }, locationPickTags: { 2: "park_site_4" } };
    const back = pickSunnyBanksRowLocation(start, 1, "park_site_4", "park_site_4");
    expect(back.locationOverrides).toEqual({ 2: "office_booth" });
    expect(back.locationPickTags).toEqual({ 2: "park_site_4" });
    const untagged = pickSunnyBanksRowLocation(start, 0, undefined, "site_laundry");
    expect(untagged.locationOverrides[0]).toBe("site_laundry");
    expect(untagged.locationPickTags[0]).toBeUndefined();
    // The input maps are never mutated.
    expect(start.locationOverrides).toEqual({ 1: "tin_shed_mower", 2: "office_booth" });
  });
});

describe("pick tags are saved with the episode, without touching existing cards", () => {
  it("round-trips through the saved card and the session", () => {
    const live = {
      ...buildDefaultSunnyBanksLive(),
      locationOverrides: { I: { 2: "office_booth" }, II: {}, III: {} },
      locationPickTags: { I: { 2: "main_entrance_sign" } },
    };
    const card = buildSunnyBanksWorkspaceFromLive(live, 1, 1);
    expect(card.locationPickTags).toEqual({ I: { 2: "main_entrance_sign" } });
    expect(liveFromSunnyBanksWorkspace(card).locationPickTags).toEqual({ I: { 2: "main_entrance_sign" } });
    const studio = normalizeSunnyBanksStudio({ live, workspaces: [card], saveSeq: 1 });
    expect(studio?.live.locationPickTags).toEqual({ I: { 2: "main_entrance_sign" } });
    expect(studio?.workspaces[0].locationPickTags).toEqual({ I: { 2: "main_entrance_sign" } });
    expect(studio?.workspaces[0].fingerprint).toBe(fingerprintWorkspace(studio!.live));
  });

  it("an episode with no pick tags fingerprints exactly as before (no card reads as changed)", () => {
    const live = buildDefaultSunnyBanksLive();
    const before = fingerprintWorkspace(live);
    expect(fingerprintWorkspace({ ...live, locationPickTags: {} })).toBe(before);
    expect(fingerprintWorkspace({ ...live, locationPickTags: { I: {}, II: {} } })).toBe(before);
    expect(buildSunnyBanksWorkspaceFromLive({ ...live, locationPickTags: { II: {} } }, 1, 1).locationPickTags).toBeUndefined();
  });

  it("drops a malformed pick tag rather than guessing", () => {
    const studio = normalizeSunnyBanksStudio({
      live: { ...buildDefaultSunnyBanksLive(), locationPickTags: { I: { 0: "Bad Key!", 1: 7, 2: "park_site_4" } } },
      workspaces: [],
    });
    expect(studio?.live.locationPickTags).toEqual({ I: { 2: "park_site_4" } });
  });
});

describe("the EP02 demo seed saves no row locations (2026-10-01)", () => {
  it("writes [Location: …] lines instead, and every row still lands where it did", () => {
    const seed = buildSunnyBanksDropBearsSeed();
    expect("locationOverrides" in seed).toBe(false);
    const live = buildDefaultSunnyBanksLive();
    for (const act of live.actIds) expect(live.locationOverrides[act]).toEqual({});
    const places = (act: "I" | "II" | "III") =>
      new Set(sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(seed.actScripts[act])).map((c) => c.locationTag));
    expect([...places("I")]).toEqual(["main_entrance_sign"]);
    expect([...places("II")]).toEqual(["tin_shed_mower"]);
    expect(places("III")).toEqual(new Set(["caravan_interior", "main_entrance_sign"]));
    expect(seed.actScripts.II.startsWith("[Location: tin_shed_mower]\n")).toBe(true);
  });
});
