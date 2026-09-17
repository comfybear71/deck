import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUNNY_BANKS_CAST, buildSunnyBanksSpeakingPrompt } from "./sunnyBanks";
import { crashLabClipUrl } from "./sunnyBanksDropBears";
import fixture from "./sunnyBanksDropBears.fixture.json";
import {
  buildSunnyBanksEpisodeBundle,
  resolveSunnyBanksEpisodeAudioUrl,
  slugifySunnyBanksEpisodeFilename,
} from "./sunnyBanksEpisodeBundle";

const firstBeat = fixture.beats[0];
const videoBytes = new Uint8Array([0, 0, 0, 1, 0x6d, 0x70, 0x34]);
const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

function mockFetchFromUrl(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(".mp3") || url.includes(firstBeat.voiceFile)) {
        return new Response(audioBytes, { status: 200 });
      }
      if (url.includes(".mp4") || url.includes(firstBeat.clipFile)) {
        return new Response(videoBytes, { status: 200 });
      }
      return new Response(null, { status: 404 });
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildSunnyBanksEpisodeBundle", () => {
  it("zips fetched MP4/MP3 bytes into video/ and audio/, with layout records under data/", async () => {
    mockFetchFromUrl();
    const unitLook = SUNNY_BANKS_CAST["Unit 4S"].look;
    expect(unitLook).toContain("bare feet");
    expect(unitLook).not.toMatch(/shoe|boot|sneaker/i);

    const videoUrl = crashLabClipUrl(firstBeat.clipFile);
    const { zipBytes, filename } = await buildSunnyBanksEpisodeBundle({
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
          videoUrl,
        },
      ],
    });

    expect(filename).toBe("ep02-drop-bears-dilemma.zip");
    expect(resolveSunnyBanksEpisodeAudioUrl({
      act: "I",
      index: 0,
      characterName: "Ranger Bazza",
      lineLabel: "Well here we go.",
      videoUrl,
    })).toBe(crashLabClipUrl(firstBeat.voiceFile));

    const dir = mkdtempSync(join(tmpdir(), "sunny-banks-episode-zip-"));
    const zipPath = join(dir, filename);
    writeFileSync(zipPath, zipBytes);
    execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
    execFileSync("unzip", ["-o", zipPath, "-d", dir], { stdio: "pipe" });

    expect(existsSync(join(dir, "script.txt"))).toBe(false);
    expect(existsSync(join(dir, "prompts.json"))).toBe(false);
    expect(existsSync(join(dir, "clips.json"))).toBe(false);

    const script = readFileSync(join(dir, "data", "script.txt"), "utf8");
    expect(script).toContain("# Act I");
    expect(script).toContain("Unit 4S: Yup yup. Naaah.");
    expect(script).not.toMatch(/shoe|boot|sneaker/i);

    const prompts = JSON.parse(readFileSync(join(dir, "data", "prompts.json"), "utf8")) as Array<{
      prompt: string;
    }>;
    expect(prompts[0].prompt).toContain("bare feet");
    expect(prompts[0].prompt).not.toMatch(/shoe|boot|sneaker/i);

    const clips = JSON.parse(readFileSync(join(dir, "data", "clips.json"), "utf8")) as {
      clips: Array<{ videoUrl: string; audioUrl: string | null }>;
    };
    expect(clips.clips[0].videoUrl).toContain("skidmarks.aiglitch.app");
    expect(clips.clips[0].audioUrl).toContain(firstBeat.voiceFile);

    expect(new Uint8Array(readFileSync(join(dir, "video", "01.mp4")))).toEqual(videoBytes);
    expect(new Uint8Array(readFileSync(join(dir, "audio", "01.mp3")))).toEqual(audioBytes);
  });

  it("still writes data/ when a stream 404s or throws, without failing the zip", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("throw-me")) {
          throw new TypeError("Failed to fetch");
        }
        return new Response(null, { status: 404 });
      })
    );

    const { zipBytes } = await buildSunnyBanksEpisodeBundle({
      title: "Partial fetch",
      defaultLocationId: "office_storefront",
      actIds: ["I"],
      actScripts: { I: "Unit 4S: Yup yup. Naaah." },
      prompts: [],
      clips: [
        {
          act: "I",
          index: 0,
          characterName: "Unit 4S",
          lineLabel: "Yup yup. Naaah.",
          videoUrl: "https://example.test/throw-me.mp4",
          audioUrl: "https://example.test/missing.mp3",
        },
        {
          act: "I",
          index: 1,
          characterName: "Unit 4S",
          lineLabel: "",
          videoUrl: "",
        },
      ],
    });

    const dir = mkdtempSync(join(tmpdir(), "sunny-banks-episode-zip-miss-"));
    const zipPath = join(dir, "partial.zip");
    writeFileSync(zipPath, zipBytes);
    execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
    execFileSync("unzip", ["-o", zipPath, "-d", dir], { stdio: "pipe" });

    expect(existsSync(join(dir, "data", "script.txt"))).toBe(true);
    expect(existsSync(join(dir, "data", "clips.json"))).toBe(true);
    expect(existsSync(join(dir, "video", "01.mp4"))).toBe(false);
    expect(existsSync(join(dir, "audio", "01.mp3"))).toBe(false);
    expect(existsSync(join(dir, "video", "02.mp4"))).toBe(false);
  });

  it("includes a dynamically added Act IV script block in data/script.txt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(videoBytes, { status: 200 })));
    const { zipBytes } = await buildSunnyBanksEpisodeBundle({
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
    const script = readFileSync(join(dir, "data", "script.txt"), "utf8");
    expect(script).toContain("# Act IV");
    expect(script).toContain("Unit 4S: Yup yup. Naaah.");
    const clips = JSON.parse(readFileSync(join(dir, "data", "clips.json"), "utf8")) as {
      actIds: string[];
      clips: Array<{ act: string }>;
    };
    expect(clips.actIds).toEqual(["I", "II", "III", "IV"]);
    expect(clips.clips[0].act).toBe("IV");
    expect(existsSync(join(dir, "video", "01.mp4"))).toBe(true);
  });

  it("falls back to a generic zip name when the title is blank", () => {
    expect(slugifySunnyBanksEpisodeFilename("   ")).toBe("sunny-banks-episode.zip");
  });
});
