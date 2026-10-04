import { describe, expect, it } from "vitest";
import { preSendBlocks, preSendChecks, type PreSendRow } from "./preSendChecks";

/** The free pre-send check (2026-10-04): one list of rules for every show. */

const base: PreSendRow = {
  kind: "speak",
  speakerName: "Ned",
  inShotNames: ["Ned"],
  castNames: ["Ned", "Kai", "Rae"],
  promptText: "Gritty 16mm film. Ned faces the camera at the bar, head level.",
  line: "[soft] No worries mate, I'll see ya around the hostel tomorrow arvo then. [pause]",
};
const codes = (row: Partial<PreSendRow>) => preSendChecks({ ...base, ...row }).map((i) => i.code);

describe("preSendChecks", () => {
  it("a clean talking row has nothing to say", () => {
    expect(preSendChecks(base)).toEqual([]);
  });

  it("1. the speaker isn't in the shot: blocks (EP03 shot 4: Kai's line on Ned)", () => {
    const issues = preSendChecks({ ...base, speakerName: "Kai" });
    expect(issues[0]).toMatchObject({ code: "speaker_not_in_shot", level: "block" });
    expect(issues[0].message).toMatch(/Kai says this line but isn't in the shot/);
    expect(preSendBlocks(issues)).toBe(true);
    // A silent row has no speaker to check.
    expect(codes({ kind: "hold", line: "", speakerName: "Kai" })).not.toContain("speaker_not_in_shot");
  });

  it("2. a Cast name in the prompt that isn't in the shot: a made-up stranger (warn)", () => {
    const issues = preSendChecks({ ...base, promptText: "Ned and Rae at the bar, Ned faces the camera" });
    expect(issues.map((i) => [i.code, i.level])).toEqual([["cast_not_in_shot", "warn"]]);
    expect(issues[0].message).toMatch(/Rae/);
    // Whole words only: "Raeburn" is not Rae.
    expect(codes({ promptText: "Ned in Raeburn, head level" })).not.toContain("cast_not_in_shot");
    expect(preSendBlocks(issues)).toBe(false);
  });

  it("3. smile / grin / looking down / head down / eyes on: warn on a talking row only", () => {
    for (const words of ["a half smile", "smiling", "grins", "looking down at his beer", "head down", "eyes on the road"]) {
      expect(codes({ promptText: `Ned, ${words}` })).toContain("lipsync_freeze_words");
    }
    expect(preSendChecks({ ...base, promptText: "Ned, a half smile" }).find((i) => i.code === "lipsync_freeze_words")!.message).toMatch(
      /"half smile" on a talking shot/,
    );
    expect(codes({ kind: "hold", line: "", promptText: "Ned looking down at his beer, smiling" })).toEqual([]);
  });

  it("4. 'film still' (a strip of frames) and 'no panels / no split screen' (white bars)", () => {
    expect(codes({ promptText: "cinematic film still of Ned" })).toContain("film_still");
    expect(codes({ promptText: "Ned at the bar, no split screen, no panels" })).toContain("negated_panels");
    expect(codes({ kind: "hold", line: "", promptText: "film still, no panels" })).toEqual(["film_still", "negated_panels"]);
  });

  it("5. no tag at the end of the Line, or a [laugh] in the middle", () => {
    expect(codes({ line: "No worries mate, I'll see ya around the hostel tomorrow arvo then." })).toContain("line_no_trailing_tag");
    expect(codes({ line: "No worries mate [laughs] I'll see ya around the hostel tomorrow arvo then. [pause]" })).toContain("line_mid_laugh");
    expect(codes({ line: "No worries mate, I'll see ya around the hostel tomorrow arvo then. [laughs]" })).not.toContain("line_mid_laugh");
  });

  it("6. a talking shot too short for its Line", () => {
    expect(codes({ line: "Yeah. [pause]" })).toContain("talking_too_short");
    expect(codes({ durationSec: 4 })).toContain("talking_too_short");
    const many = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen [pause]";
    expect(preSendChecks({ ...base, line: many, durationSec: 6 }).find((i) => i.code === "talking_too_short")!.message).toMatch(/about 9s/);
    expect(codes({ durationSec: 8 })).not.toContain("talking_too_short");
  });

  it("blocks come first", () => {
    const issues = preSendChecks({ ...base, speakerName: "Kai", promptText: "film still of Rae smiling" });
    expect(issues[0].level).toBe("block");
    expect(issues.slice(1).every((i) => i.level === "warn")).toBe(true);
  });
});
