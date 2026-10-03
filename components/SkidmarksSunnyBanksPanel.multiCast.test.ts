import { describe, expect, it, vi } from "vitest";
import type { SkidmarksState } from "@/lib/skidmarks";

/**
 * Multi-cast shots, Sunnybank side (2026-10-03): the parser keeps each
 * `[Character Name: …]` look with its own character, marks two-hander
 * scenes, and the row's cast comes from the shared helper. Stuart's two
 * must-pass examples, plus EP02 staying one person per row.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com/deck/sunnybank/characters";
const BLOOM_PIC = `${BLOB}/bloom/bloom-picture-01.jpg`;
const STUIE_PIC = `${BLOB}/stuie/stuie-picture-01.jpg`;
const BAZZA_PIC = `${BLOB}/ranger-bazza/ranger-bazza-reference.jpg`;
const VOICE_A = "21m00Tcm4TlvDq8ikWAM";
const VOICE_B = "AZnzlk1XvdvUeBnXmlld";

function card(name: string, sourceKey: string, voiceId?: string, referenceUrl?: string) {
  return {
    id: `clora_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    slug: name.toLowerCase(),
    sourceKey,
    status: "idle",
    trainingImageUrls: [],
    version: 1,
    createdAt: "2026-10-03T00:00:00.000Z",
    ...(voiceId ? { voiceId } : {}),
    ...(referenceUrl ? { referenceUrl } : {}),
  };
}

const STATE = {
  bands: [],
  session: { projectKind: "sunnybank", bandId: null, mp3: null, scriptSequenceDraft: null },
  removedSeedBandIds: [],
  rosterExtras: {
    "music-video": [],
    "sunny-banks": [
      { id: "chr_bloom", name: "Bloom", look: "long blond man-bun, grey harem pants", pictureUrls: [BLOOM_PIC], fictionalAdultConfirmed: true, createdAt: 1 },
      { id: "chr_stuie", name: "Stuie", look: "thin bloke in a faded singlet", pictureUrls: [STUIE_PIC], fictionalAdultConfirmed: true, createdAt: 2 },
    ],
    "adult-shorts": [],
  },
  characterLoras: {
    characters: [
      card("Bloom", "sbx:chr_bloom", VOICE_A),
      card("Stuie", "sbx:chr_stuie", VOICE_B),
      card("Ranger Bazza", "sb:ranger_bazza", undefined, BAZZA_PIC),
    ],
  },
} as unknown as SkidmarksState;

vi.mock("@/lib/skidmarks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skidmarks")>();
  return { ...actual, getSkidmarksSnapshot: () => STATE };
});

const panel = await import("./SkidmarksSunnyBanksPanel");
const { parseSunnyBanksScriptBlock, sunnyBanksQueueChunks, parseCharacterLookTag, buildSunnyBanksHighlightSegments } = panel;
const { resolveSunnyBanksRowCast, sunnyBanksMultiCastRequest } = await import("@/lib/sunnyBanksShotCast");
const { sunnyBanksCastCards } = await import("@/lib/sunnyBanksVoices");
const { buildSunnyBanksDropBearsSeed } = await import("@/lib/sunnyBanksDropBears");

const EXAMPLE_1 = [
  "[Location: water_tank_dam]",
  "[Character Bloom: long blond man-bun, grey harem pants, back to camera, yoga tree pose, foreground]",
  "[Action: Ranger Bazza rising out of the muddy dam with a snorkel, holding up a ticket book… Camera still.]",
  "Ranger Bazza:",
  "[Location: water_tank_dam]",
].join("\n");

const EXAMPLE_2 = [
  "=== ACT V — SCENE 6 — PARK SITE 4 ===",
  "[Location: park_site_4]",
  "[Action: Both men stay in frame the whole time, mouths closed. BLOOM, the man-bun guy front left, folds his arms and nods slowly; STUIE, on the right, scratches his head and shifts his weight. Camera holds, no cuts.]",
  "STUIE: Hello BLOOM",
  "BLOOM: Namaste STUIE",
  "[Location: park_site_4]",
].join("\n");

type Chunk = ReturnType<typeof sunnyBanksQueueChunks>[number];
function rowCast(chunk: Chunk) {
  return resolveSunnyBanksRowCast(
    {
      kind: chunk.kind,
      characterName: chunk.characterName,
      cutaway: false,
      action: chunk.action,
      sceneAction: chunk.sceneAction,
      castNames: chunk.castNames,
      castLooks: chunk.castLooks,
      sceneSpeakers: chunk.sceneSpeakers,
      appearanceModifier: chunk.appearanceModifier,
    },
    sunnyBanksCastCards(STATE),
  );
}

describe("parseCharacterLookTag keeps the name", () => {
  it("returns the name with the look instead of throwing it away", () => {
    expect(parseCharacterLookTag("Bloom: long blond man-bun")).toEqual({ name: "Bloom", look: "long blond man-bun" });
    expect(parseCharacterLookTag("Shazza holding a tin")).toEqual({ name: "Shazza", look: "holding a tin" });
    expect(parseCharacterLookTag("holding a tin")).toEqual({ name: null, look: "holding a tin" });
  });
});

describe("must-pass example 1 (silent, Grok/H3)", () => {
  it("one shot: Bloom's look stays with Bloom, not Ranger Bazza; both are in the shot", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(EXAMPLE_1));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ characterName: "Ranger Bazza", kind: "hold" });
    // The bug: this used to be Bloom's man-bun, landing on Bazza.
    expect(row.appearanceModifier).toBeUndefined();
    expect(row.castLooks).toEqual([
      { name: "Bloom", look: "long blond man-bun, grey harem pants, back to camera, yoga tree pose, foreground" },
    ]);
    const cast = rowCast(row);
    expect(cast.cast.names).toEqual(["Ranger Bazza", "Bloom"]);
    expect(cast.cast.missingPicture).toEqual([]);
    expect(cast.people.map((p) => [p.name, p.pictureUrl, p.position ?? ""])).toEqual([
      ["Ranger Bazza", BAZZA_PIC, ""],
      ["Bloom", BLOOM_PIC, "foreground"],
    ]);
    expect(cast.people[1].shotLook).toContain("yoga tree pose");
  });
});

describe("must-pass example 2 (talking two-hander, LTX)", () => {
  it("two lines, one scene: same shared action, both people on each line, roles flipped", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(EXAMPLE_2));
    expect(rows.map((r) => [r.characterName, r.line, r.kind])).toEqual([
      ["Stuie", "Hello BLOOM", "speak"],
      ["Bloom", "Namaste STUIE", "speak"],
    ]);
    expect(rows[0].sceneKey).toBeDefined();
    expect(rows[1].sceneKey).toBe(rows[0].sceneKey);
    expect(rows[0].action).toContain("Both men stay in frame");
    // The [Action] is still used up by line 1's motion text…
    expect(rows[1].action).toBeUndefined();
    // …but line 2 still knows the scene, for who's in it and the shared plate.
    expect(rows[1].sceneAction).toBe(rows[0].action);
    expect(rows[0].sceneSpeakers).toEqual(["Stuie", "Bloom"]);

    const line1 = rowCast(rows[0]);
    const line2 = rowCast(rows[1]);
    expect(line1.cast.names).toEqual(["Stuie", "Bloom"]);
    expect(line2.cast.names).toEqual(["Bloom", "Stuie"]);
    expect(line1.people.map((p) => p.position)).toEqual(["on the right", "front left"]);
    expect(line2.people.map((p) => p.position)).toEqual(["front left", "on the right"]);
    expect(line1.sceneSpeakers).toEqual(["Stuie", "Bloom"]);
  });

  it("the request carries the cast, the scene's action (line 2 only) and the shared plate", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(EXAMPLE_2));
    const line2 = rowCast(rows[1]);
    const plate = `${BLOB}/../episodes/ep05/act-v/ep05-act-v-beat-01-stuie-bloom-plate.jpg`;
    const req = sunnyBanksMultiCastRequest({
      people: line2.people,
      sceneAction: rows[1].sceneAction,
      sceneSpeakers: line2.sceneSpeakers,
      scenePlateUrl: plate,
      plateTarget: { folder: "deck/sunnybank/episodes/ep05/act-v", name: "ep05-act-v-beat-01-stuie-bloom-plate" },
    });
    expect((req.cast as Array<{ name: string }>).map((p) => p.name)).toEqual(["Bloom", "Stuie"]);
    expect(req).toMatchObject({ sceneSpeakers: ["Stuie", "Bloom"], scenePlateUrl: plate });
    expect(req.sceneAction).toContain("BLOOM, the man-bun guy front left");
  });
});

describe("rows with one character behave exactly as today", () => {
  it("[Character <speaker>: …] is still the speaker's own look, and the row stays one person", () => {
    const rows = sunnyBanksQueueChunks(
      parseSunnyBanksScriptBlock(
        "[Location: park_site_4]\n[Character Stuie: alone nearest camera, medium shot from the waist up, mouth open talking]\nStuie: G'day",
      ),
    );
    expect(rows[0].appearanceModifier).toBe("alone nearest camera, medium shot from the waist up, mouth open talking");
    expect(rows[0].castLooks).toBeUndefined();
    expect(rows[0].sceneKey).toBeUndefined();
    expect(rowCast(rows[0]).cast.isMulti).toBe(false);
    expect(sunnyBanksMultiCastRequest({ people: rowCast(rows[0]).people })).toEqual({});
  });

  it("a [Character] tag with no Cast name still goes on the speaker", () => {
    const [row] = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock("[Character Name: holding a tin]\nShazza: Oi"));
    expect(row.appearanceModifier).toBe("holding a tin");
  });

  it("names said inside the spoken words don't add anyone (EP02: 'catch up with shazza')", () => {
    const rows = sunnyBanksQueueChunks(
      parseSunnyBanksScriptBlock("[Location: main_entrance_sign]\nRanger Bazza: Let's go and catch up with shazza"),
    );
    expect(rowCast(rows[0]).cast.names).toEqual(["Ranger Bazza"]);
  });

  it("lines with a tag above each one stay separate shots", () => {
    const rows = sunnyBanksQueueChunks(
      parseSunnyBanksScriptBlock("[Location: park_site_4]\nStuie: one\n[Location: park_site_4]\nBloom: two"),
    );
    expect(rows.map((r) => r.sceneKey)).toEqual([undefined, undefined]);
    expect(rows.map((r) => rowCast(r).cast.names)).toEqual([["Stuie"], ["Bloom"]]);
  });

  it("EP02 seed: every row is still one person", () => {
    const seed = buildSunnyBanksDropBearsSeed();
    for (const script of Object.values(seed.actScripts)) {
      for (const row of sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(script))) {
        expect(row.sceneKey).toBeUndefined();
        expect(row.castLooks).toBeUndefined();
        expect(rowCast(row).cast.names).toEqual([row.characterName]);
      }
    }
  });

  it("a silent hold then a talking line under one [Action] is not a scene", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock("[Action: slams the clipboard down]\nShazza:\nDazza: What was that?"));
    expect(rows.map((r) => r.sceneKey)).toEqual([undefined, undefined]);
  });
});

describe("[Cast: A, B]", () => {
  it("is parsed, coloured as a character tag, and is exact", () => {
    const [row] = sunnyBanksQueueChunks(
      parseSunnyBanksScriptBlock("[Cast: STUIE, Bloom]\n[Action: Nan waves in the distance]\nStuie: hi"),
    );
    expect(row.castNames).toEqual(["STUIE", "Bloom"]);
    expect(rowCast(row).cast.names).toEqual(["Stuie", "Bloom"]);
    expect(buildSunnyBanksHighlightSegments("[Cast: STUIE, Bloom]")).toEqual([{ kind: "character", text: "[Cast: STUIE, Bloom]" }]);
  });

  it("a Crowd cutaway never gets cast", () => {
    const [row] = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock("[Cast: Stuie, Bloom]\nCrowd:"));
    const cast = resolveSunnyBanksRowCast({ kind: "hold", characterName: row.characterName, cutaway: true, castNames: row.castNames }, sunnyBanksCastCards(STATE));
    expect(cast.cast.names).toEqual([]);
  });
});

describe("Cheat Sheet teaches the tags, and its examples parse the way it says", () => {
  it("the rule examples become one silent two-person shot and one two-line scene", async () => {
    const { SUNNY_BANKS_GOD_SCRIPT_RULES, buildSunnyBanksGodScriptPrompt } = await import("@/lib/sunnyBanksGodScriptGuide");
    const rule = (title: string) => SUNNY_BANKS_GOD_SCRIPT_RULES.find((r) => r.title === title)!;
    const silent = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(rule("Up to four people in one shot").example!));
    expect(silent).toHaveLength(1);
    expect(rowCast(silent[0]).cast.names).toEqual(["Ranger Bazza", "Bloom"]);
    const talk = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(rule("Two people talking in one shot").example!));
    expect(talk.map((r) => rowCast(r).cast.names)).toEqual([
      ["Stuie", "Bloom"],
      ["Bloom", "Stuie"],
    ]);
    expect(talk[1].sceneKey).toBe(talk[0].sceneKey);
    const prompt = buildSunnyBanksGodScriptPrompt();
    expect(prompt).toContain("[Cast: <Name>, <Name>]");
    expect(prompt).toContain("=== MORE THAN ONE PERSON IN A SHOT ===");
  });
});
