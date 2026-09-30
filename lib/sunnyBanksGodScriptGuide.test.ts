import { describe, expect, it } from "vitest";
import { parseSunnyBanksScriptBlock } from "@/components/SkidmarksSunnyBanksPanel";
import { SUNNY_BANKS_CAST, SUNNY_BANKS_LOCATIONS } from "./sunnyBanks";
import { sunnyBanksSpeakerList } from "./sunnyBanksVoices";
import type { SkidmarksState } from "./skidmarks";
import {
  buildSunnyBanksGodScriptPrompt,
  listSunnyBanksLocationIds,
  listSunnyBanksNonSpeakingCast,
  listSunnyBanksSpeakingCast,
  SUNNY_BANKS_GOD_SCRIPT_EXAMPLE,
  SUNNY_BANKS_GOD_SCRIPT_RULES,
} from "./sunnyBanksGodScriptGuide";

describe("listSunnyBanksSpeakingCast", () => {
  it("is the six regulars, derived from the real cast lock — never a retyped list", () => {
    expect(listSunnyBanksSpeakingCast().sort()).toEqual(
      ["Dazza", "Nan", "Nuggets", "Ranger Bazza", "Shazza", "Unit 4S"].sort()
    );
  });

  it("with no saved characters, Hans has no voice, so he is listed as not speaking yet", () => {
    expect(SUNNY_BANKS_CAST.Hans.voiceId).toBeUndefined();
    expect(listSunnyBanksSpeakingCast()).not.toContain("Hans");
    expect(listSunnyBanksNonSpeakingCast().map((c) => c.name)).toContain("Hans");
  });

  it("real ask (2026-09-30): comes from the saved characters, so Hans with a voice on his card can speak", () => {
    const hansCard = {
      id: "clora_hans",
      name: "Hans",
      slug: "hans",
      sourceKey: "sb:hans",
      status: "draft",
      trainingImageUrls: [],
      referenceUrl: "https://abc.public.blob.vercel-storage.com/deck/sunnybank/characters/hans/hans.jpg",
      voiceId: "abcdefghij0123456789",
      version: 1,
      createdAt: "2026-09-30T00:00:00.000Z",
    };
    const state = { characterLoras: { characters: [hansCard] } } as unknown as SkidmarksState;
    const saved = sunnyBanksSpeakerList(state);
    expect(listSunnyBanksSpeakingCast(saved)).toContain("Hans");
    expect(buildSunnyBanksGodScriptPrompt(undefined, saved)).toMatch(/THE CAST[^]*Hans/);
  });
});

describe("the 2026-09-30 rules", () => {
  it("lists the new built-ins and says an unknown id won't render", () => {
    const ids = listSunnyBanksLocationIds().map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["park_site_4", "office_booth", "rock_art_outcrop"]));
    const prompt = buildSunnyBanksGodScriptPrompt();
    expect(prompt).toContain("park_site_4");
    expect(prompt).toMatch(/red\s+warning[^]*WILL NOT RENDER/);
    const sheet = JSON.stringify(SUNNY_BANKS_GOD_SCRIPT_RULES);
    expect(sheet).toMatch(/red warning on its row and won't render/);
  });

  it("no # lines except # EPISODE:, acts are === ACT II ===", () => {
    expect(buildSunnyBanksGodScriptPrompt()).toMatch(/NO "#" LINES except "# EPISODE: Title"[^]*=== ACT II ===/);
    expect(JSON.stringify(SUNNY_BANKS_GOD_SCRIPT_RULES)).toContain("Don't write # Act II");
  });

  it("[Character …] on a talking line is a still pose, repeated word for word; movement goes in silent holds", () => {
    const prompt = buildSunnyBanksGodScriptPrompt();
    expect(prompt).toMatch(/STILL POSE only/);
    expect(prompt).toMatch(/repeat the exact same words/);
    expect(prompt).toMatch(/movement in a silent hold/);
    const rule = SUNNY_BANKS_GOD_SCRIPT_RULES.find((r) => r.title.includes("still pose"))!;
    // The rule's own example parses as it says: two talking lines with the
    // same pose, then a silent hold carrying the movement.
    const rows = parseSunnyBanksScriptBlock(rule.example!);
    expect(rows.map((r) => r.kind)).toEqual(["speak", "speak", "hold"]);
    expect(rows[0].appearanceModifier).toBe(rows[1].appearanceModifier);
    expect(rows[2].action).toMatch(/storms out/);
    expect(rows[2].appearanceModifier).toBeUndefined();
  });
});

describe("listSunnyBanksLocationIds", () => {
  it("covers every locked park plate, id and label alike", () => {
    const listed = listSunnyBanksLocationIds();
    expect(listed).toHaveLength(Object.keys(SUNNY_BANKS_LOCATIONS).length);
    for (const location of Object.values(SUNNY_BANKS_LOCATIONS)) {
      expect(listed).toContainEqual({ id: location.id, label: location.label });
    }
  });
});

describe("SUNNY_BANKS_GOD_SCRIPT_EXAMPLE", () => {
  /** The whole point of a cheat sheet is that following it works. This
   * runs the documented example through the parser the panel actually
   * uses, so a parser change that breaks the documented shape fails
   * here instead of quietly teaching a format that costs paid renders. */
  it("really parses into the rows the cheat sheet claims it does", () => {
    const chunks = parseSunnyBanksScriptBlock(SUNNY_BANKS_GOD_SCRIPT_EXAMPLE);

    expect(chunks.map((chunk) => chunk.kind)).toEqual(["scene", "hold", "speak", "speak"]);

    // The scene header renders nothing and is not a queue row.
    expect(chunks[0].line).toBe("ACT IV — SCENE A1 — THE PAYOFF");

    // `Shazza:` with nothing after it is the silent hold, and it picks
    // up the staged look plus the action tag above it.
    expect(chunks[1]).toMatchObject({ characterName: "Shazza", line: "", kind: "hold" });
    expect(chunks[1].appearanceModifier).toContain("pile of $50 notes");
    expect(chunks[1].action).toContain("wetting her thumb");

    // Rule 4 in action: the repeated `[Character ...]` is what keeps the
    // money pile on the spoken line. Without it this row would render
    // Shazza at her plain default look.
    expect(chunks[2]).toMatchObject({
      characterName: "Shazza",
      line: "Are you bloody kidding me?! We made an absolute killing on this stuff!",
      kind: "speak",
    });
    expect(chunks[2].appearanceModifier).toContain("pile of $50 notes");

    // A voice tag after the colon stays in the spoken line — Eleven v3
    // performs it (lib/elevenLabsSpeech.ts), so it must reach ElevenLabs.
    expect(chunks[3]).toMatchObject({
      characterName: "Dazza",
      line: "[laughs] Yeah nah, told ya it'd work.",
      kind: "speak",
    });

    // The location set once at the top sticks for every following row.
    for (const chunk of chunks) expect(chunk.locationId).toBe("office_storefront");
  });

  it("never demonstrates a tag the parser doesn't know — no line is silently read aloud", () => {
    for (const chunk of parseSunnyBanksScriptBlock(SUNNY_BANKS_GOD_SCRIPT_EXAMPLE)) {
      // Voice tags ([laughs], [short pause]) are allowed inside a line
      // since the Eleven v3 switch; invented picture tags still aren't.
      expect(chunk.line).not.toMatch(/\[(Outfit|silence|beat|SFX)\b/i);
      // A real tag that survived into the spoken line means the parser
      // stopped stripping it — exactly the bug this guide warns about.
      expect(chunk.line).not.toMatch(/\[(Location|Character|Action)\b/i);
    }
  });
});

describe("buildSunnyBanksGodScriptPrompt", () => {
  it("names every speaking cast member and every location id, straight from the locks", () => {
    const prompt = buildSunnyBanksGodScriptPrompt();
    for (const name of listSunnyBanksSpeakingCast()) expect(prompt).toContain(name);
    for (const { id, label } of listSunnyBanksLocationIds()) {
      expect(prompt).toContain(id);
      expect(prompt).toContain(label);
    }
    // Hans has no voice in the built-in table, so he's only in the "not speaking yet" line.
    const castLine = prompt.split("=== THE CAST")[1].split("\n").find((l) => l.includes("Shazza"))!;
    expect(castLine).not.toContain("Hans");
    expect(prompt).toContain("Not speaking yet: Hans (");
  });

  it("carries the three real tags and explicitly forbids the invented ones", () => {
    const prompt = buildSunnyBanksGodScriptPrompt();
    expect(prompt).toContain("[Location: <id>]");
    expect(prompt).toContain("[Character <Name>: <description>]");
    expect(prompt).toContain("[Action: <text>]");
    // The two that actually cost a paid render in live QA (2026-09-18).
    expect(prompt).toContain("[Outfit: ...]");
    expect(prompt).toContain("[silence]");
    expect(prompt).toContain("Never invent another picture tag");
  });

  it("teaches voice tags inside the line, after the colon — never on their own line", () => {
    const prompt = buildSunnyBanksGodScriptPrompt();
    expect(prompt).toContain("VOICE TAGS");
    expect(prompt).toContain("[whispers]");
    expect(prompt).toContain("Never put a voice tag on its own line or before the name.");
    // The prompt's own voice-tag example must parse into one Speak row
    // that keeps its tags.
    const exampleLine = "Shazza: oi, here we go, [short pause] [whispers] another bus load of suckers...";
    expect(prompt).toContain(exampleLine);
    expect(parseSunnyBanksScriptBlock(exampleLine)).toEqual([
      expect.objectContaining({
        characterName: "Shazza",
        kind: "speak",
        line: "oi, here we go, [short pause] [whispers] another bus load of suckers...",
      }),
    ]);
  });

  it("embeds the same worked example the cheat sheet shows, so the two can't drift", () => {
    expect(buildSunnyBanksGodScriptPrompt()).toContain(SUNNY_BANKS_GOD_SCRIPT_EXAMPLE);
  });

  it("asks for bare text — a fenced code block would paste back in as dialogue", () => {
    expect(buildSunnyBanksGodScriptPrompt()).toContain("No markdown code fences");
  });
});

describe("SUNNY_BANKS_GOD_SCRIPT_RULES", () => {
  it("every rule has a title and at least one line of body", () => {
    expect(SUNNY_BANKS_GOD_SCRIPT_RULES.length).toBeGreaterThan(0);
    for (const rule of SUNNY_BANKS_GOD_SCRIPT_RULES) {
      expect(rule.title.trim().length).toBeGreaterThan(0);
      expect(rule.body.length).toBeGreaterThan(0);
      for (const paragraph of rule.body) expect(paragraph.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers the four rules that actually cost money when broken", () => {
    const text = SUNNY_BANKS_GOD_SCRIPT_RULES.map((rule) => `${rule.title} ${rule.body.join(" ")}`).join(" ");
    expect(text).toContain("line break");
    expect(text).toContain("[silence]");
    expect(text).toContain("[Outfit:]");
    expect(text).toMatch(/used up by the next row|attach to the next row/i);
  });
});

describe("the video engine tag rule (2026-09-30)", () => {
  it("its example parses to three silent rows on the engines it names", async () => {
    const { parseSunnyBanksScriptBlock, sunnyBanksQueueChunks } = await import("@/components/SkidmarksSunnyBanksPanel");
    const rule = SUNNY_BANKS_GOD_SCRIPT_RULES.find((r) => r.title.includes("[GROK]"))!;
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(rule.example!));
    expect(rows.map((row) => [row.kind, row.videoBackend])).toEqual([
      ["hold", "h3"],
      ["hold", "ltx"],
      ["hold", "grok"],
    ]);
  });

  it("the LLM prompt says the tags are optional and never spoken", () => {
    const prompt = buildSunnyBanksGodScriptPrompt();
    expect(prompt).toContain("[GROK], [LTX] and [H3] are optional");
    expect(prompt).toContain("never\n   spoken");
  });
});
