import { describe, expect, it } from "vitest";
import GOLDEN from "./sunnyBanksGenre.golden.fixture.json";
import {
  SKIDMARKS_BANNED_WORDS,
  SKIDMARKS_LOOK,
  SKIDMARKS_PICTURE_STYLE,
  SKIDMARKS_STYLE_LOCK,
  parseStudioGenre,
  studioCastGroup,
  studioGenreProfile,
} from "./studioGenre";
import {
  SUNNY_BANKS_CAST,
  SUNNY_BANKS_LOOK,
  buildSunnyBanksCompositePlatePrompt,
  buildSunnyBanksHoldBeatPathname,
  buildSunnyBanksHoldPrompt,
  buildSunnyBanksSpeakBeatPathname,
  buildSunnyBanksSpeakingPrompt,
} from "./sunnyBanks";
import { buildSunnyBanksMultiCastPlatePrompt } from "./sunnyBanksShotCast";
import { sunnybankBeatTarget, sunnybankPlateTarget } from "./deckMediaPaths";
import {
  buildDefaultSunnyBanksLive,
  buildEmptySunnyBanksLive,
  buildSunnyBanksWorkspaceFromLive,
  fingerprintWorkspace,
  normalizeSunnyBanksLive,
  normalizeSunnyBanksWorkspace,
} from "./sunnyBanksWorkspace";
import { SKIDMARKS_GOD_SCRIPT_NOTE, buildSunnyBanksGodScriptPrompt } from "./sunnyBanksGodScriptGuide";
import { sunnyBanksLocationList, sunnyBanksLocationProblem } from "./sunnyBanksLocations";
import { CHARACTER_TRAINING_STYLES } from "./characterLoras";

/**
 * One episode studio, two shows (2026-10-04). Sunny Banks must be exactly
 * what it was: the golden strings in `sunnyBanksGenre.golden.fixture.json`
 * were printed by the code on origin/master (5b611ce) before this change.
 */

function bannedHits(text: string): string[] {
  // "not a cartoon" is the lock's own negation (as in STYLE_LOCK.md).
  const cleaned = text.replace(/not a cartoon/gi, "");
  return SKIDMARKS_BANNED_WORDS.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(cleaned);
  });
}

const shazza = SUNNY_BANKS_CAST["Shazza"];
const dazza = SUNNY_BANKS_CAST["Dazza"];
const loc = { id: "park_site_4", label: "Park Site 4", image: "" };
const people = [
  { name: "Stuie", look: "thin bloke", pictureUrl: "https://x.public.blob.vercel-storage.com/a.jpg", position: "on the right" },
  { name: "Bloom", look: "man-bun", pictureUrl: "https://x.public.blob.vercel-storage.com/b.jpg", position: "front left" },
];
const dap = { name: "DAP", look: "skinny man in a tracksuit, white beanie", voiceId: "21m00Tcm4TlvDq8ikWAM" };
const street = { id: "town_street", label: "Town Street", image: "" };

describe("which show", () => {
  it("only the word skidmarks means Skidmarks; anything else is Sunny Banks", () => {
    expect(parseStudioGenre("skidmarks")).toBe("skidmarks");
    for (const v of [undefined, null, "", "sunnybank", "Skidmarks", 3, {}]) expect(parseStudioGenre(v)).toBe("sunnybank");
    expect(studioGenreProfile(undefined).genre).toBe("sunnybank");
    expect(studioGenreProfile("skidmarks").builtIns).toBe(false);
    expect(studioGenreProfile("skidmarks").legacyBlobPrefix).toBe("skidmarks/studio");
    expect(studioGenreProfile("sunnybank").legacyBlobPrefix).toBe("sunnybanks");
    expect(studioCastGroup("skidmarks")).toBe("skidmarks");
    expect(studioCastGroup("sunnybank")).toBe("sunny-banks");
  });
});

describe("the Skidmarks style lock (STYLE_LOCK.md at 60–80% photoreal)", () => {
  it("says semi-photoreal, 60 to 80 percent, a 3D feature render with caricature in the anatomy", () => {
    expect(SKIDMARKS_STYLE_LOCK).toMatch(/semi-photoreal/);
    expect(SKIDMARKS_STYLE_LOCK).toMatch(/60 to 80 percent photographic/);
    expect(SKIDMARKS_STYLE_LOCK).toMatch(/3D feature film render/);
    expect(SKIDMARKS_STYLE_LOCK).toMatch(/caricature modelled into the anatomy/);
    expect(SKIDMARKS_STYLE_LOCK).toMatch(/Not a photograph and not a cartoon$/);
  });

  it("keeps the banned words out (the lock's own 'not a cartoon' aside), and the picture style has none at all", () => {
    expect(bannedHits(SKIDMARKS_STYLE_LOCK)).toEqual([]);
    expect(SKIDMARKS_STYLE_LOCK.toLowerCase().split("cartoon")).toHaveLength(2);
    expect(bannedHits(SKIDMARKS_PICTURE_STYLE)).toEqual([]);
    expect(SKIDMARKS_PICTURE_STYLE).not.toMatch(/cartoon/i);
    // Word-bounded: "cel" never matches "excellent", "2D" never "2Dx".
    expect(bannedHits("an excellent day")).toEqual([]);
    expect(bannedHits("flat 2D look")).toEqual(["2D"]);
  });

  it("drops Sunny Banks' outback (no heat haze, no flies)", () => {
    expect(SKIDMARKS_LOOK.ambienceSentence).toBe("");
    expect(SKIDMARKS_LOOK.idleAmbience).toBe("");
    expect(SKIDMARKS_LOOK.keepPlaceLine).not.toMatch(/street|Aussie/i);
  });

  it("Skidmarks Cast training pictures are captioned semi-photoreal, not 3D cartoon", () => {
    expect(CHARACTER_TRAINING_STYLES).toContain("semireal");
  });
});

describe("Sunny Banks prompts are byte-for-byte what they were", () => {
  it("speaking, hold, composite and multi-cast prompts match origin/master", () => {
    expect(buildSunnyBanksSpeakingPrompt(shazza, "You right?")).toBe(GOLDEN.speak);
    expect(buildSunnyBanksSpeakingPrompt(dazza, "Yeah nah")).toBe(GOLDEN.speakDazza);
    expect(buildSunnyBanksHoldPrompt(shazza)).toBe(GOLDEN.hold);
    expect(buildSunnyBanksHoldPrompt(shazza, "walks away")).toBe(GOLDEN.holdAction);
    expect(buildSunnyBanksCompositePlatePrompt(shazza, loc)).toBe(GOLDEN.composite);
    expect(buildSunnyBanksCompositePlatePrompt(shazza, loc, "holding a pie", "walks away")).toBe(GOLDEN.compositeAction);
    expect(
      buildSunnyBanksMultiCastPlatePrompt({ people, location: loc, speaker: "Stuie", sceneSpeakers: ["Stuie", "Bloom"], shotAction: "both nod" }),
    ).toBe(GOLDEN.multi);
  });

  it("passing the Sunny Banks look explicitly changes nothing", () => {
    expect(buildSunnyBanksSpeakingPrompt(shazza, "You right?", SUNNY_BANKS_LOOK)).toBe(GOLDEN.speak);
    expect(buildSunnyBanksHoldPrompt(shazza, "walks away", SUNNY_BANKS_LOOK)).toBe(GOLDEN.holdAction);
    expect(buildSunnyBanksCompositePlatePrompt(shazza, loc, undefined, undefined, SUNNY_BANKS_LOOK)).toBe(GOLDEN.composite);
  });

  it("empty-episode and seed fingerprints are unchanged (no castIds = same fingerprint)", () => {
    expect(fingerprintWorkspace(buildEmptySunnyBanksLive())).toBe(GOLDEN.fpEmpty);
    expect(fingerprintWorkspace(buildDefaultSunnyBanksLive())).toBe(GOLDEN.fpDefault);
    expect(fingerprintWorkspace({ ...buildEmptySunnyBanksLive(), castIds: [] })).toBe(GOLDEN.fpEmpty);
  });

  it("old clip paths keep their sunnybanks/ prefix", () => {
    expect(buildSunnyBanksSpeakBeatPathname("Shazza", 1)).toMatch(/^sunnybanks\//);
    expect(buildSunnyBanksHoldBeatPathname("Shazza", 1)).toMatch(/^sunnybanks\//);
    expect(buildSunnyBanksSpeakBeatPathname("DAP", 1, "skidmarks/studio")).toMatch(/^skidmarks\/studio\//);
  });
});

describe("Skidmarks prompts use the Skidmarks look", () => {
  const prompts = () => [
    buildSunnyBanksSpeakingPrompt(dap, "Alright?", SKIDMARKS_LOOK),
    buildSunnyBanksHoldPrompt(dap, undefined, SKIDMARKS_LOOK),
    buildSunnyBanksHoldPrompt(dap, "walks off", SKIDMARKS_LOOK),
    buildSunnyBanksCompositePlatePrompt(dap, street, undefined, undefined, SKIDMARKS_LOOK),
    buildSunnyBanksCompositePlatePrompt(dap, street, "holding a pasty", "walks off", SKIDMARKS_LOOK),
    buildSunnyBanksMultiCastPlatePrompt({
      people: [{ ...people[0], name: "DAP" }, { ...people[1], name: "Sparrow" }],
      location: street,
      speaker: "DAP",
      sceneSpeakers: ["DAP"],
      look: SKIDMARKS_LOOK,
    }),
  ];

  it("every prompt carries the semi-photoreal lock and none of Sunny Banks' cartoon words or outback", () => {
    for (const p of prompts()) {
      expect(p).toContain(SKIDMARKS_STYLE_LOCK);
      expect(p).not.toContain(SUNNY_BANKS_LOOK.styleLock);
      expect(p).not.toMatch(/heat haze|flies|rubbery|thick black outlines|cel colour|Aussie/i);
      expect(bannedHits(p)).toEqual([]);
    }
  });
});

describe("clip folders by show", () => {
  it("Skidmarks clips go under deck/skidmarks/episodes/<episode>/act-x; Sunny Banks unchanged", () => {
    const sk = sunnybankBeatTarget({ episodeSlug: "cornish-arsehole", actId: "I", beatNumber: 3, characterName: "DAP", kind: "speak", genre: "skidmarks" });
    expect(sk?.folder).toBe("deck/skidmarks/episodes/cornish-arsehole/act-i");
    expect(sk?.name).toMatch(/^cornish-arsehole-act-i-beat-03-dap-speak$/);
    const sb = sunnybankBeatTarget({ episodeSlug: "ep02", actId: "II", beatNumber: 3, characterName: "Shazza", kind: "hold" });
    expect(sb?.folder).toBe("deck/sunnybank/episodes/ep02/act-ii");
    expect(sunnybankBeatTarget({ episodeSlug: "ep02", actId: "II", beatNumber: 3, characterName: "Shazza", kind: "hold", genre: "sunnybank" })).toEqual(sb);
    const plate = sunnybankPlateTarget({ episodeSlug: "cornish-arsehole", actId: "II", beatNumber: 1, castNames: ["DAP", "Sparrow"], genre: "skidmarks" });
    expect(plate?.folder).toBe("deck/skidmarks/episodes/cornish-arsehole/act-ii");
    expect(plate?.name).toBe("cornish-arsehole-act-ii-beat-01-dap-sparrow-plate");
  });
});

describe("Skidmarks episodes: blank start, who's in it, its own locations", () => {
  it("a new Skidmarks episode is blank with no location; Sunny Banks' new episode is unchanged", () => {
    const sk = buildEmptySunnyBanksLive("skidmarks");
    expect(sk.defaultLocationId).toBe("");
    expect(Object.values(sk.actScripts).every((s) => s === "")).toBe(true);
    expect(buildEmptySunnyBanksLive("sunnybank")).toEqual(buildEmptySunnyBanksLive());
  });

  it("junk Skidmarks data falls back to blank, never the Drop Bears seed", () => {
    const sk = normalizeSunnyBanksLive({ actIds: "junk" }, "skidmarks");
    expect(sk === null || Object.values(sk.actScripts).every((s) => !/Nan|Shazza|Dazza/.test(s))).toBe(true);
  });

  it("castIds: kept, cleaned, saved on the card, and part of the fingerprint only when ticked", () => {
    const live = { ...buildEmptySunnyBanksLive("skidmarks"), workspaceTitle: "Cornish Arsehole", castIds: ["c_dap", "c_dap", "", "c_sparrow"] };
    const norm = normalizeSunnyBanksLive(live, "skidmarks")!;
    expect(norm.castIds).toEqual(["c_dap", "c_sparrow"]);
    const card = buildSunnyBanksWorkspaceFromLive(norm, 1000, 1, "skidmarks");
    expect(card.castIds).toEqual(["c_dap", "c_sparrow"]);
    expect(normalizeSunnyBanksWorkspace(JSON.parse(JSON.stringify(card)), "skidmarks")?.castIds).toEqual(["c_dap", "c_sparrow"]);
    const without = { ...norm, castIds: undefined };
    expect(fingerprintWorkspace(norm)).not.toBe(fingerprintWorkspace(without));
  });

  it("Skidmarks has no built-in locations; an empty location id says what to do", () => {
    expect(sunnyBanksLocationList(null, "skidmarks")).toEqual([]);
    expect(sunnyBanksLocationList(null).length).toBeGreaterThan(0);
    expect(sunnyBanksLocationProblem([], "")).toMatch(/No location yet/);
    const mine = {
      locations: [
        { id: "loc_skidmarks_town_street", genre: "skidmarks" as const, key: "town_street", name: "Town Street", pictureUrl: null, createdAt: 1 },
        { id: "loc_sunnybank_x", genre: "sunnybank" as const, key: "x", name: "X", pictureUrl: null, createdAt: 1 },
      ],
    };
    expect(sunnyBanksLocationList(mine, "skidmarks").map((l) => l.id)).toEqual(["town_street"]);
  });
});

describe("the Cheat Sheet prompt", () => {
  it("Sunny Banks has no Skidmarks note; Skidmarks has it and its name", () => {
    expect(buildSunnyBanksGodScriptPrompt()).toBe(buildSunnyBanksGodScriptPrompt(undefined, undefined, "sunnybank"));
    expect(buildSunnyBanksGodScriptPrompt()).not.toContain(SKIDMARKS_GOD_SCRIPT_NOTE);
    const sk = buildSunnyBanksGodScriptPrompt([], [{ name: "DAP", look: "tracksuit", voiceId: "21m00Tcm4TlvDq8ikWAM" }], "skidmarks");
    expect(sk).toContain(SKIDMARKS_GOD_SCRIPT_NOTE);
    expect(sk).toContain("Skidmarks");
    expect(sk).toContain("DAP");
    // The cast and location lists are Skidmarks' own (the worked example stays the Sunny Banks one, and the note says so).
    expect(sk).toMatch(/Sunny Banks names: write with the Skidmarks Cast/);
    const castLine = sk.split("\n").find((l) => l.includes("DAP")) ?? "";
    expect(castLine).not.toMatch(/Shazza|Dazza|Ranger Bazza/);
  });
});
