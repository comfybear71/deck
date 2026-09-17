import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUNNY_BANKS_CAST, buildSunnyBanksSpeakingPrompt } from "./sunnyBanks";
import {
  buildSunnyBanksEpisodeBundle,
  slugifySunnyBanksEpisodeFilename,
} from "./sunnyBanksEpisodeBundle";

describe("buildSunnyBanksEpisodeBundle", () => {
  it("zips script text, gold prompt array, and clip URL paths — not MP4 bytes", () => {
    const unitLook = SUNNY_BANKS_CAST["Unit 4S"].look;
    expect(unitLook).toContain("bare feet");
    expect(unitLook).not.toMatch(/shoe|boot|sneaker/i);

    const { zipBytes, filename } = buildSunnyBanksEpisodeBundle({
      title: "EP02 — Drop Bears Dilemma",
      defaultLocationId: "main_entrance_sign",
      actIds: ["I", "II", "III"],
      actScripts: {
        I: "Ranger Bazza: Well here we go.\nUnit 4S: Yup yup. Naaah.",
        II: "Dazza: Yeah nah.",
        III: "Shazza:",
      },
      prompts: [
        {
          act: "I",
          index: 1,
          characterName: "Unit 4S",
          kind: "speak",
          line: "Yup yup. Naaah.",
          locationId: "main_entrance_sign",
          prompt: buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST["Unit 4S"], "Yup yup. Naaah."),
        },
      ],
      clips: [
        {
          act: "I",
          index: 0,
          characterName: "Ranger Bazza",
          lineLabel: "Well here we go.",
          videoUrl: "https://skidmarks.aiglitch.app/api/crash/mobile/clip?fileName=clip.mp4",
        },
      ],
    });

    expect(filename).toBe("ep02-drop-bears-dilemma.zip");

    const dir = mkdtempSync(join(tmpdir(), "sunny-banks-episode-zip-"));
    const zipPath = join(dir, filename);
    writeFileSync(zipPath, zipBytes);
    execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
    execFileSync("unzip", ["-o", zipPath, "-d", dir], { stdio: "pipe" });

    const script = readFileSync(join(dir, "script.txt"), "utf8");
    expect(script).toContain("# Act I");
    expect(script).toContain("Unit 4S: Yup yup. Naaah.");
    expect(script).not.toMatch(/shoe|boot|sneaker/i);

    const prompts = JSON.parse(readFileSync(join(dir, "prompts.json"), "utf8")) as Array<{
      prompt: string;
    }>;
    expect(prompts[0].prompt).toContain("bare feet");
    expect(prompts[0].prompt).not.toMatch(/shoe|boot|sneaker/i);

    const clips = JSON.parse(readFileSync(join(dir, "clips.json"), "utf8")) as {
      clips: Array<{ videoUrl: string }>;
    };
    expect(clips.clips[0].videoUrl).toContain("skidmarks.aiglitch.app");
    expect(zipBytes.byteLength).toBeLessThan(16_000);
  });

  it("includes a dynamically added Act IV script block in script.txt", () => {
    const { zipBytes } = buildSunnyBanksEpisodeBundle({
      title: "Act IV check",
      defaultLocationId: "office_storefront",
      actIds: ["I", "II", "III", "IV"],
      actScripts: {
        I: "Shazza: You right?",
        II: "",
        III: "",
        IV: "Unit 4S: Yup yup. Naaah.",
      },
      prompts: [],
      clips: [
        {
          act: "IV",
          index: 0,
          characterName: "Unit 4S",
          lineLabel: "Yup yup. Naaah.",
          videoUrl: "https://example.test/iv.mp4",
        },
      ],
    });
    const dir = mkdtempSync(join(tmpdir(), "sunny-banks-act-iv-zip-"));
    const zipPath = join(dir, "act-iv.zip");
    writeFileSync(zipPath, zipBytes);
    execFileSync("unzip", ["-o", zipPath, "-d", dir], { stdio: "pipe" });
    const script = readFileSync(join(dir, "script.txt"), "utf8");
    expect(script).toContain("# Act IV");
    expect(script).toContain("Unit 4S: Yup yup. Naaah.");
    const clips = JSON.parse(readFileSync(join(dir, "clips.json"), "utf8")) as {
      actIds: string[];
      clips: Array<{ act: string }>;
    };
    expect(clips.actIds).toEqual(["I", "II", "III", "IV"]);
    expect(clips.clips[0].act).toBe("IV");
  });

  it("falls back to a generic zip name when the title is blank", () => {
    expect(slugifySunnyBanksEpisodeFilename("   ")).toBe("sunny-banks-episode.zip");
  });
});
