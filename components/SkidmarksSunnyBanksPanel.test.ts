import { describe, expect, it } from "vitest";
import { parseSunnyBanksScriptBlock, SUNNY_BANKS_ACTS } from "./SkidmarksSunnyBanksPanel";
import { SUNNY_BANKS_CAST } from "@/lib/sunnyBanks";

describe("parseSunnyBanksScriptBlock", () => {
  it("skips blank lines and splits on newlines", () => {
    const chunks = parseSunnyBanksScriptBlock("Shazza: You right?\n\nDazza: Yeah nah.\n");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ characterName: "Shazza", line: "You right?", kind: "speak" });
    expect(chunks[1]).toMatchObject({ characterName: "Dazza", line: "Yeah nah.", kind: "speak" });
  });

  it("matches Name says: as well as Name:", () => {
    const chunks = parseSunnyBanksScriptBlock('Nan says: "Cuppa?"');
    expect(chunks[0]).toMatchObject({ characterName: "Nan", line: '"Cuppa?"', kind: "speak" });
  });

  it("uses the canonical SUNNY_BANKS_CAST key for spaced names, not a synthetic id", () => {
    const chunks = parseSunnyBanksScriptBlock("ranger bazza: Move along.\nUnit 4S: Yup yup. Naaah.");
    expect(chunks[0].characterName).toBe("Ranger Bazza");
    expect(chunks[0].characterName).toBe(SUNNY_BANKS_CAST["Ranger Bazza"].name);
    expect(chunks[1].characterName).toBe("Unit 4S");
    expect(chunks[1].characterName).toBe(SUNNY_BANKS_CAST["Unit 4S"].name);
  });

  it("empty dialogue after the speaker is a Hold, not a guessed line", () => {
    const chunks = parseSunnyBanksScriptBlock("Ranger Bazza:");
    expect(chunks).toEqual([
      { raw: "Ranger Bazza:", characterName: "Ranger Bazza", line: "", kind: "hold" },
    ]);
  });

  it("continuation lines keep the previous speaker", () => {
    const chunks = parseSunnyBanksScriptBlock("Shazza: You right?\nDon't start.");
    expect(chunks[1]).toMatchObject({ characterName: "Shazza", line: "Don't start.", kind: "speak" });
  });

  it("looks up the whole character record by name — Unit 4S stays bare feet, no invented shoes", () => {
    const chunks = parseSunnyBanksScriptBlock("Unit 4S: Yup yup. Naaah.");
    const lock = SUNNY_BANKS_CAST[chunks[0].characterName];
    expect(lock).toBe(SUNNY_BANKS_CAST["Unit 4S"]);
    expect(lock.look).toContain("bare feet");
    expect(lock.look).not.toMatch(/shoe|boot|sneaker/i);
    expect(chunks[0].line).not.toMatch(/shoe|boot|sneaker/i);
  });

  it("does not invent a speaker that is not a CAST key", () => {
    const chunks = parseSunnyBanksScriptBlock("Some Guest: hello");
    expect(chunks[0].characterName).toBe("Shazza");
    expect(chunks[0].line).toBe("Some Guest: hello");
    expect(SUNNY_BANKS_CAST["Some Guest"]).toBeUndefined();
  });
});

describe("SUNNY_BANKS_ACTS", () => {
  it("is three in-panel act buffers, not a persisted episode schema", () => {
    expect(SUNNY_BANKS_ACTS).toEqual(["I", "II", "III"]);
  });
});
