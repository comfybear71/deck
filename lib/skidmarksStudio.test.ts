import { describe, expect, it } from "vitest";
import {
  legacySkidmarksBeatToScript,
  legacySkidmarksEpisodeToWorkspace,
  normalizeSkidmarksEpisodeCard,
  withLegacySkidmarksEpisodes,
} from "./skidmarksStudio";
import { normalizeSkidmarksEpisode, SKIDMARKS_STARTER_SCRIPTS, type SkidmarksEpisode } from "./skidmarksEpisodes";
import { buildEmptySunnyBanksLive, buildSunnyBanksWorkspaceFromLive, fingerprintWorkspace, liveFromSunnyBanksWorkspace } from "./sunnyBanksWorkspace";
import { normalizeSkidmarksShow } from "./skidmarks";
import type { SkidmarksState } from "./skidmarks";
import {
  resolveSpeakBeatCharacter,
  resolveSunnyBanksSpeaker,
  sunnyBanksCastCards,
  sunnyBanksSpeakerList,
  sunnyBanksSpeakerNames,
} from "./sunnyBanksVoices";
import { SUNNY_BANKS_CAST } from "./sunnyBanks";

/**
 * Skidmarks on the Sunny Banks structure (2026-10-04): old nine-beat
 * episodes (PR 216's `skidmarks-episode` save type) still load, turned
 * into episode cards in code, and the Skidmarks Cast is the only cast.
 */

const CAST = [
  { id: "c_dap", name: "DAP", role: "antihero", look: "skinny man, white tracksuit, beanie", fictionalAdultConfirmed: true, createdAt: 1 },
  { id: "c_sparrow", name: "Sparrow", role: "supporting", look: "a small brown sparrow", fictionalAdultConfirmed: true, createdAt: 2, isAnimal: true },
] as const;

function legacy(over: Partial<Record<string, string>> = {}): SkidmarksEpisode {
  const beats: Record<string, { script: string; durationSec: number }> = {};
  for (const [id, script] of Object.entries(over)) beats[id] = { script: script ?? "", durationSec: 30 };
  const ep = normalizeSkidmarksEpisode({
    id: "skep_1",
    title: "Cornish Arsehole",
    antiheroId: "c_dap",
    castIds: ["c_sparrow"],
    beats,
    createdAt: 100,
    updatedAt: 200,
  });
  if (!ep) throw new Error("fixture did not normalize");
  return ep;
}

describe("old nine-beat text in the new script's words", () => {
  it("[Shot:] → [Action:], [SFX:] dropped, empty [Location:] dropped, [Name: look] → [Character Name: look]", () => {
    const text = [
      "[Location: ]",
      "[Shot: wide on the high street]",
      "[SFX: gulls]",
      "[DAP: grinning, pasty in hand]",
      "DAP: Alright?",
      "[Location: town_street]",
    ].join("\n");
    expect(legacySkidmarksBeatToScript(text, ["DAP", "Sparrow"])).toBe(
      ["[Action: wide on the high street]", "[Character DAP: grinning, pasty in hand]", "DAP: Alright?", "[Location: town_street]"].join("\n"),
    );
  });
});

describe("an old episode becomes an episode card", () => {
  it("one act per written beat, its title, same id, who's in it", () => {
    const card = legacySkidmarksEpisodeToWorkspace(
      legacy({ intro: SKIDMARKS_STARTER_SCRIPTS.intro, b1: "[Shot: DAP on the street]\nDAP: Alright?", b8: "DAP: Ow." }),
      CAST,
    );
    expect(card.id).toBe("skep_1");
    expect(card.label).toBe("Cornish Arsehole");
    expect(card.savedAt).toBe(200);
    expect(card.actIds).toEqual(["I", "II"]);
    expect(card.actScripts.I).toBe("=== 1. HE SHOWS UP ===\n[Action: DAP on the street]\nDAP: Alright?");
    expect(card.actScripts.II).toBe("=== 8. GETS SMASHED ===\nDAP: Ow.");
    expect(card.castIds).toEqual(["c_dap", "c_sparrow"]);
    expect(card.defaultLocationId).toBe("");
    // Opened, it reads as saved (nothing to re-save).
    expect(fingerprintWorkspace(liveFromSunnyBanksWorkspace(card))).toBe(card.fingerprint);
  });

  it("an episode with nothing written gets one blank act", () => {
    const card = legacySkidmarksEpisodeToWorkspace(legacy(), CAST);
    expect(card.actIds).toEqual(["I"]);
    expect(card.actScripts.I).toBe("");
  });

  it("a per-item row (deck_items kind skidmarks-episode) of either shape reads as a card", () => {
    const fromOld = normalizeSkidmarksEpisodeCard(JSON.parse(JSON.stringify(legacy({ b1: "DAP: Alright?" }))));
    expect(fromOld?.id).toBe("skep_1");
    expect(fromOld?.actScripts.I).toContain("DAP: Alright?");
    const live = { ...buildEmptySunnyBanksLive("skidmarks"), workspaceTitle: "Pilot", castIds: ["c_dap"] };
    live.actScripts = { ...live.actScripts, I: "DAP: Alright?" };
    const card = buildSunnyBanksWorkspaceFromLive(live, 5, 1, "skidmarks");
    expect(normalizeSkidmarksEpisodeCard(JSON.parse(JSON.stringify(card)))).toEqual(card);
    expect(normalizeSkidmarksEpisodeCard(null)).toBeNull();
    expect(normalizeSkidmarksEpisodeCard("junk")).toBeNull();
  });

  it("session load moves old episodes onto the card shelf once, in memory (no duplicates)", () => {
    const old = legacy({ b1: "DAP: Alright?" });
    const loaded = normalizeSkidmarksShow({ episodes: [old], cast: CAST }, null);
    expect(loaded.skidmarksEpisodes?.episodes).toEqual([]);
    expect(loaded.skidmarksEpisodes?.cast.map((c) => c.id)).toEqual(["c_dap", "c_sparrow"]);
    expect(loaded.skidmarksStudio?.workspaces.map((w) => w.id)).toEqual(["skep_1"]);
    // Already a card: left alone.
    const again = withLegacySkidmarksEpisodes(loaded.skidmarksStudio ?? null, [old], CAST, () => {
      throw new Error("not needed");
    });
    expect(again).toBe(loaded.skidmarksStudio);
    // Nothing old, nothing studio: stays null (no empty shelf invented).
    expect(normalizeSkidmarksShow({ episodes: [], cast: CAST }, null).skidmarksStudio).toBeNull();
  });
});

describe("the Skidmarks Cast is Skidmarks' only cast", () => {
  const PIC = "https://abc123.public.blob.vercel-storage.com/deck/skidmarks/characters/dap/dap-reference.jpg";
  const VOICE = "21m00Tcm4TlvDq8ikWAM";
  const card = (name: string, sourceKey: string, voiceId?: string, referenceUrl?: string) => ({
    id: `clora_${name.toLowerCase()}`,
    name,
    slug: name.toLowerCase(),
    sourceKey,
    status: "idle",
    trainingImageUrls: [],
    version: 1,
    createdAt: "2026-10-04T00:00:00.000Z",
    ...(voiceId ? { voiceId } : {}),
    ...(referenceUrl ? { referenceUrl } : {}),
  });
  const STATE = {
    bands: [],
    skidmarksEpisodes: { episodes: [], cast: CAST },
    rosterExtras: { "music-video": [], "sunny-banks": [], "adult-shorts": [] },
    characterLoras: {
      characters: [
        card("DAP", "sk:c_dap", VOICE, PIC),
        card("Sparrow", "sk:c_sparrow"),
        card("Shazza", "sb:shazza", "AZnzlk1XvdvUeBnXmlld"),
      ],
    },
  } as unknown as SkidmarksState;

  it("Skidmarks speakers are only Skidmarks cards with a voice; no Sunny Banks built-ins", () => {
    expect(sunnyBanksSpeakerNames(STATE, "skidmarks")).toEqual(["DAP"]);
    expect(sunnyBanksSpeakerList(STATE, "skidmarks").map((c) => c.name)).toEqual(["DAP"]);
    const dap = resolveSunnyBanksSpeaker("dap", STATE, "skidmarks");
    expect(dap).toMatchObject({ name: "DAP", look: CAST[0].look, voiceId: VOICE, castPicture: PIC });
    expect(resolveSunnyBanksSpeaker("Shazza", STATE, "skidmarks")).toBeUndefined();
    expect(resolveSunnyBanksSpeaker("Sparrow", STATE, "skidmarks")).toBeUndefined();
  });

  it("every Skidmarks card can still be in a shot (multi-character), voice or not", () => {
    expect(sunnyBanksCastCards(STATE, "skidmarks")).toEqual([
      { name: "DAP", look: CAST[0].look, picture: PIC, speaks: true },
      { name: "Sparrow", look: CAST[1].look, picture: null, speaks: false },
    ]);
  });

  it("Sunny Banks ignores Skidmarks cards and keeps its built-ins", () => {
    const names = sunnyBanksSpeakerNames(STATE);
    expect(names).not.toContain("DAP");
    for (const n of Object.keys(SUNNY_BANKS_CAST)) expect(names).toContain(n);
    expect(sunnyBanksCastCards(STATE).map((c) => c.name)).not.toContain("DAP");
  });

  it("the route side: a Skidmarks card with a voice is the character; a Sunny Banks name is not", () => {
    const sent = { name: "DAP", look: CAST[0].look, pictureUrl: PIC };
    expect(resolveSpeakBeatCharacter("DAP", sent, VOICE, "skidmarks")).toMatchObject({ name: "DAP", voiceId: VOICE, castPicture: PIC });
    expect(resolveSpeakBeatCharacter("Shazza", null, null, "skidmarks")).toBeUndefined();
    expect(resolveSpeakBeatCharacter("Shazza", null, null)?.name).toBe("Shazza");
  });
});
