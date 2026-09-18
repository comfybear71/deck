import { describe, expect, it } from "vitest";
import { parseSunnyBanksScriptBlock } from "@/components/SkidmarksSunnyBanksPanel";
import { SUNNY_BANKS_CAST, SUNNY_BANKS_LOCATIONS } from "./sunnyBanks";
import {
  buildSunnyBanksGodScriptPrompt,
  listSunnyBanksLocationIds,
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

  it("leaves Hans out — he has no locked voice, so he cannot speak a beat", () => {
    expect(SUNNY_BANKS_CAST.Hans.voiceId).toBeUndefined();
    expect(listSunnyBanksSpeakingCast()).not.toContain("Hans");
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

    expect(chunks[3]).toMatchObject({ characterName: "Dazza", kind: "speak" });

    // The location set once at the top sticks for every following row.
    for (const chunk of chunks) expect(chunk.locationId).toBe("office_storefront");
  });

  it("never demonstrates a tag the parser doesn't know — no line is silently read aloud", () => {
    for (const chunk of parseSunnyBanksScriptBlock(SUNNY_BANKS_GOD_SCRIPT_EXAMPLE)) {
      expect(chunk.line).not.toMatch(/\[(Outfit|silence|beat|SFX|pause)\b/i);
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
    expect(prompt).not.toContain("Hans");
  });

  it("carries the three real tags and explicitly forbids the invented ones", () => {
    const prompt = buildSunnyBanksGodScriptPrompt();
    expect(prompt).toContain("[Location: <id>]");
    expect(prompt).toContain("[Character <Name>: <description>]");
    expect(prompt).toContain("[Action: <text>]");
    // The two that actually cost a paid render in live QA (2026-09-18).
    expect(prompt).toContain("[Outfit: ...]");
    expect(prompt).toContain("[silence]");
    expect(prompt).toContain("Never invent a tag.");
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
