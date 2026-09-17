import { describe, expect, it } from "vitest";
import { SUNNY_BANKS_CAST } from "./sunnyBanks";
import fixture from "./sunnyBanksDropBears.fixture.json";
import {
  buildSunnyBanksDropBearsSeed,
  crashLabClipUrl,
  DROP_BEARS_JOB_ID,
} from "./sunnyBanksDropBears";
import { collectRenderedClips, parseSunnyBanksScriptBlock, sunnyBanksQueueChunks } from "@/components/SkidmarksSunnyBanksPanel";

describe("Drop Bears EP02 seed", () => {
  it("is the Crash Lab job Stuart pointed at, not a new Neon episode", () => {
    expect(DROP_BEARS_JOB_ID).toBe("mgen_20260827092841004_ea9");
    expect(fixture.beats).toHaveLength(46);
  });

  it("remaps The Unit 4s onto the locked CAST key and keeps bare feet", () => {
    const speakers = new Set(fixture.beats.map((beat) => beat.speaker));
    expect(speakers.has("The Unit 4s")).toBe(false);
    expect(speakers.has("Unit 4S")).toBe(true);
    for (const speaker of speakers) {
      expect(SUNNY_BANKS_CAST[speaker]).toBeDefined();
    }
    expect(SUNNY_BANKS_CAST["Unit 4S"].look).toContain("bare feet");
    expect(SUNNY_BANKS_CAST["Unit 4S"].look).not.toMatch(/shoe|boot|sneaker/i);
  });

  it("splits Caravan park / BBQ / Unit 9+tag into Act I / II / III", () => {
    const seed = buildSunnyBanksDropBearsSeed();
    expect(sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(seed.actScripts.I))).toHaveLength(13);
    expect(sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(seed.actScripts.II))).toHaveLength(23);
    expect(sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(seed.actScripts.III))).toHaveLength(10);
  });

  it("points every done line at the existing Crash Lab mp4, not a paid re-render", () => {
    const seed = buildSunnyBanksDropBearsSeed();
    const first = fixture.beats[0];
    expect(crashLabClipUrl(first.clipFile)).toContain("skidmarks.aiglitch.app/api/crash/mobile/clip");
    expect(crashLabClipUrl(first.clipFile)).toContain(first.clipFile);

    const clips = collectRenderedClips({
      actIds: ["I", "II", "III"],
      actScripts: seed.actScripts,
      runtimeMap: seed.runtimeMap,
      characterOverrides: { I: {}, II: {}, III: {} },
    });
    expect(clips).toHaveLength(46);
    expect(clips.every((clip) => clip.videoUrl.includes("/api/crash/mobile/clip"))).toBe(true);
    expect(clips.filter((clip) => clip.act === "I")).toHaveLength(13);
    expect(clips.filter((clip) => clip.act === "II")).toHaveLength(23);
    expect(clips.filter((clip) => clip.act === "III")).toHaveLength(10);
  });

  it("keeps parser lineKeys in lockstep so the Clips strip actually shows", () => {
    const seed = buildSunnyBanksDropBearsSeed();
    for (const act of ["I", "II", "III"] as const) {
      const chunks = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(seed.actScripts[act]));
      chunks.forEach((chunk, index) => {
        expect(seed.runtimeMap[act][index]?.lineKey).toBe(chunk.raw);
        expect(seed.runtimeMap[act][index]?.status).toBe("done");
      });
    }
  });
});
