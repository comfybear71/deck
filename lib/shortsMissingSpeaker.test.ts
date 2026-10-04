import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adultShortMissingSpeaker, adultShortMissingSpeakerMessage, adultShortSpeaker } from "./adultShorts";

/**
 * EP03 Backpackers, 2026-10-04: shot 4's Line was picked for Liam, then
 * Liam left Starring. The shot quietly fell back to Jack, so Jack's voice
 * said Liam's line and LTX was told "Jack speaks" on a plate where Jack is
 * the back of a head in the foreground: no lips moved. Now a talking shot
 * whose picked speaker isn't in it says so and doesn't render.
 */
const JACK = { name: "Jack", voiceId: "zXKCpzVoice" };
const LIAM = { name: "Liam", voiceId: "rbc1FTVoice" };

describe("a talking shot's picked speaker who isn't in the shot", () => {
  it("is reported by name (EP03 shot 4: Liam picked, only Jack starring)", () => {
    expect(adultShortMissingSpeaker([JACK], { speakerName: "Liam" })).toBe("Liam");
    expect(adultShortMissingSpeaker([JACK], { speakerName: " liam " })).toBe("liam");
  });

  it("is fine when the speaker is in the shot, or none was picked (the first person says it)", () => {
    expect(adultShortMissingSpeaker([JACK, LIAM], { speakerName: "Liam" })).toBeNull();
    expect(adultShortMissingSpeaker([JACK, LIAM], { speakerName: "LIAM" })).toBeNull();
    expect(adultShortMissingSpeaker([JACK], {})).toBeNull();
    expect(adultShortMissingSpeaker([JACK], { speakerName: "  " })).toBeNull();
    expect(adultShortMissingSpeaker([], {})).toBeNull();
  });

  it("the fallback that caused it is unchanged for picking, so the guard has to run first", () => {
    // adultShortSpeaker still answers Jack; the panel checks the missing speaker before using it.
    expect(adultShortSpeaker([JACK], { speakerName: "Liam" })?.name).toBe("Jack");
    expect(adultShortSpeaker([JACK, LIAM], { speakerName: "Liam" })?.name).toBe("Liam");
  });

  it("the message says who and what to do", () => {
    expect(adultShortMissingSpeakerMessage("Liam")).toBe(
      "Liam is picked to say this Line but isn't in this shot. Add Liam to Starring (and to this shot), or let someone in the shot say it."
    );
  });

  it("the panel blocks the render, Render all, and offers the fix", () => {
    const panel = readFileSync(new URL("../components/AdultShortsPanel.tsx", import.meta.url), "utf8");
    const talking = panel.slice(panel.indexOf("const renderTalking = async"), panel.indexOf("const unfinished ="));
    // The guard comes before the speaker is resolved (and before any paid call).
    expect(talking.indexOf("adultShortMissingSpeaker(people, shot)")).toBeGreaterThan(-1);
    expect(talking.indexOf("adultShortMissingSpeaker(people, shot)")).toBeLessThan(talking.indexOf("adultShortSpeaker(people, shot)"));
    expect(talking.indexOf("adultShortMissingSpeaker(people, shot)")).toBeLessThan(talking.indexOf("render-talking"));
    expect(panel).toContain("voiceless.length > 0 || missingSpeakers.length > 0");
    expect(panel).toContain("Boolean(missingSpeaker || noVoice) && !shot.sirayTaskId");
    expect(panel).toContain("{speaker.name} says it");
  });
});
