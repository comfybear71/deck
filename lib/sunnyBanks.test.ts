import { describe, expect, it } from "vitest";
import {
  buildSunnyBanksHoldPrompt,
  buildSunnyBanksSpeakingPrompt,
  buildUnit4sLine,
  getSunnyBanksCharacterLock,
  SUNNY_BANKS_CAST,
  SUNNY_BANKS_STYLE_LOCK,
} from "./sunnyBanks";

describe("SUNNY_BANKS_CAST", () => {
  it("real reported ask (2026-09-15): all six series regulars plus the aliens have a real voice id, except Hans", () => {
    expect(SUNNY_BANKS_CAST.Shazza.voiceId).toBe("Vuun8WKmo2MZSUXgLPGw");
    expect(SUNNY_BANKS_CAST.Nuggets.voiceId).toBe("URQwIuGxmxWfCgwXuDxA");
    expect(SUNNY_BANKS_CAST.Nan.voiceId).toBe("u57uR2xbwGdASNetz0GB");
    expect(SUNNY_BANKS_CAST.Dazza.voiceId).toBe("Kn29eGLhsovCLwKvKi2q");
    expect(SUNNY_BANKS_CAST["Ranger Bazza"].voiceId).toBe("lT1zujgSfYwPzAlTNE9z");
    expect(SUNNY_BANKS_CAST["Unit 4S"].voiceId).toBe("9AMMyX2GM74yY0KQwYkF");
    expect(SUNNY_BANKS_CAST.Hans.voiceId).toBeUndefined();
  });

  it("getSunnyBanksCharacterLock is a real lookup, not a guess for an unknown name", () => {
    expect(getSunnyBanksCharacterLock("Shazza")).toBe(SUNNY_BANKS_CAST.Shazza);
    expect(getSunnyBanksCharacterLock("Some Guest")).toBeUndefined();
  });

  it("real reported ask (2026-09-15): five cast members have Stuart's real reference plates", () => {
    expect(SUNNY_BANKS_CAST.Shazza.referenceImage).toBe("/skidmarks/sunnybanks/shazza-reference.jpg");
    expect(SUNNY_BANKS_CAST.Dazza.referenceImage).toBe("/skidmarks/sunnybanks/dazza-reference.jpg");
    expect(SUNNY_BANKS_CAST.Nan.referenceImage).toBe("/skidmarks/sunnybanks/nan-reference.jpg");
    expect(SUNNY_BANKS_CAST.Nuggets.referenceImage).toBe("/skidmarks/sunnybanks/nuggets-reference.jpg");
    expect(SUNNY_BANKS_CAST["Ranger Bazza"].referenceImage).toBe("/skidmarks/sunnybanks/ranger-bazza-reference.jpg");
    // Not sent yet — an undefined reference must stay undefined, never a
    // guessed/invented path a caller could 404 on.
    expect(SUNNY_BANKS_CAST.Hans.referenceImage).toBeUndefined();
    expect(SUNNY_BANKS_CAST["Unit 4S"].referenceImage).toBeUndefined();
  });
});

describe("buildSunnyBanksSpeakingPrompt", () => {
  it("matches the worked gold example (Shazza) field-for-field", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(
      SUNNY_BANKS_CAST.Shazza,
      "We haven't got any shade, Dazza. So it's forty-seven degrees of structural integrity. Stop complaining and finish your breakfast"
    );
    expect(prompt).toBe(
      "Use the provided start image as the first frame. Shazza, big blonde hair, leopard-print top, cigarette, " +
        "arms folded is prominent, mouth and head move naturally while speaking, subtle gesture. Props and " +
        "background stay exactly as the start image, nothing new enters frame. Shazza says: \"We haven't got " +
        "any shade, Dazza. So it's forty-seven degrees of structural integrity. Stop complaining and finish " +
        "your breakfast\". Camera holds. Same person and objects as the start image. " +
        SUNNY_BANKS_STYLE_LOCK
    );
  });

  it("never emits [SPEECH] or [VISUAL] — the gold doc's own explicit \"do not\"", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Nuggets, "G'day");
    expect(prompt).not.toContain("[SPEECH]");
    expect(prompt).not.toContain("[VISUAL]");
  });

  it("trims the line before quoting it", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Nan, "  put the kettle on  ");
    expect(prompt).toContain('Nan says: "put the kettle on".');
  });
});

describe("buildSunnyBanksHoldPrompt", () => {
  it("carries no dialogue and locks the camera, matching the gold hold shape", () => {
    const prompt = buildSunnyBanksHoldPrompt(SUNNY_BANKS_CAST["Ranger Bazza"]);
    expect(prompt).toContain("No dialogue. Camera holds, no cuts.");
    expect(prompt).toContain(SUNNY_BANKS_STYLE_LOCK);
    expect(prompt).not.toContain(" says:");
  });
});

describe("buildUnit4sLine", () => {
  it("real reported shape (2026-09-15): yup-yups and a drawn-out nah, not an English line", () => {
    const line = buildUnit4sLine(8);
    expect(line).toMatch(/^(Yup yup(, )?)+\. Na+h\.$/);
  });

  it("scales up with a longer beat — more reps and a longer nah", () => {
    const short = buildUnit4sLine(4);
    const long = buildUnit4sLine(24);
    const shortYupCount = short.split("Yup yup").length - 1;
    const longYupCount = long.split("Yup yup").length - 1;
    expect(longYupCount).toBeGreaterThan(shortYupCount);
    const shortNahLength = short.match(/Na+h/)?.[0].length ?? 0;
    const longNahLength = long.match(/Na+h/)?.[0].length ?? 0;
    expect(longNahLength).toBeGreaterThan(shortNahLength);
  });

  it("clamps a nonsense/out-of-range duration instead of producing an empty or absurd line", () => {
    expect(buildUnit4sLine(0)).toMatch(/^Yup yup\. Naa+h\.$/);
    expect(buildUnit4sLine(-5)).toMatch(/^Yup yup\. Naa+h\.$/);
    expect(buildUnit4sLine(9999)).toMatch(/^(Yup yup(, )?)+\. Na{8}h\.$/);
  });
});
