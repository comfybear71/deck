import { describe, expect, it } from "vitest";
import {
  collectRenderedClips,
  fingerprintWorkspace,
  mintWorkspaceId,
  parseSunnyBanksScriptBlock,
  SUNNY_BANKS_ACTS,
} from "./SkidmarksSunnyBanksPanel";
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

describe("workspace save ids", () => {
  const emptyActs = { I: "", II: "", III: "" };
  const emptyMaps = { I: {}, II: {}, III: {} };
  const base = {
    defaultLocationId: "office_storefront",
    activeAct: "I",
    actScripts: emptyActs,
    characterOverrides: emptyMaps,
    locationOverrides: emptyMaps,
    runtimeMap: emptyMaps,
  };

  it("mints a fresh id for every save even when the snapshot fingerprint matches", () => {
    const fingerprint = fingerprintWorkspace(base);
    const first = mintWorkspaceId(1_700_000_000_000, 1, fingerprint);
    const second = mintWorkspaceId(1_700_000_000_000, 2, fingerprint);
    expect(first).not.toBe(second);
    expect(first).toContain(fingerprint);
    expect(second).toContain(fingerprint);
  });

  it("changes the fingerprint when a clip URL lands, so a later save is a distinct card", () => {
    const before = fingerprintWorkspace(base);
    const after = fingerprintWorkspace({
      ...base,
      runtimeMap: {
        I: { 0: { lineKey: "Shazza: You right?", status: "done", videoUrl: "https://blob.example/a.mp4" } },
        II: {},
        III: {},
      },
    });
    expect(after).not.toBe(before);
  });
});

describe("collectRenderedClips", () => {
  it("only returns done clips with a video URL, grouped by the act they were rendered on", () => {
    const clips = collectRenderedClips({
      actScripts: {
        I: "Shazza: You right?\nDazza: Yeah nah.",
        II: "Nan:",
        III: "",
      },
      characterOverrides: { I: {}, II: {}, III: {} },
      runtimeMap: {
        I: {
          0: { lineKey: "Shazza: You right?", status: "done", videoUrl: "https://blob.example/i0.mp4" },
          1: { lineKey: "Dazza: Yeah nah.", status: "failed", error: "nope" },
        },
        II: {
          0: { lineKey: "Nan:", status: "done", videoUrl: "https://blob.example/ii0.mp4" },
        },
        III: {},
      },
    });
    expect(clips).toEqual([
      {
        act: "I",
        index: 0,
        characterName: "Shazza",
        lineLabel: "You right?",
        videoUrl: "https://blob.example/i0.mp4",
        durationSec: undefined,
      },
      {
        act: "II",
        index: 0,
        characterName: "Nan",
        lineLabel: "Silent hold",
        videoUrl: "https://blob.example/ii0.mp4",
        durationSec: undefined,
      },
    ]);
  });
});
