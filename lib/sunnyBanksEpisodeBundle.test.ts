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
  fetchSunnyBanksBinaryAsset,
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

describe("buildSunnyBanksEpisodeBundle progress + honest clip counts (2026-09-18)", () => {
  const baseInput = {
    title: "EP02 — Drop Bears Dilemma",
    defaultLocationId: "main_entrance_sign",
    actIds: ["I"] as const,
    actScripts: { I: "Ranger Bazza: One.\nRanger Bazza: Two.\nRanger Bazza: Three." },
    prompts: [],
  };

  function clip(index: number, videoUrl: string) {
    return {
      act: "I",
      index,
      characterName: "Ranger Bazza",
      lineLabel: `Line ${index + 1}`,
      videoUrl,
    };
  }

  it("reports progress once per clip so a long download can't look like a dead button", async () => {
    mockFetchFromUrl();
    const seen: { done: number; total: number }[] = [];
    const videoUrl = crashLabClipUrl(firstBeat.clipFile);
    const result = await buildSunnyBanksEpisodeBundle({
      ...baseInput,
      clips: [clip(0, videoUrl), clip(1, videoUrl), clip(2, videoUrl)],
      onProgress: ({ done, total }) => seen.push({ done, total }),
    });

    // Live QA: a 64-clip episode pulled 64 MP4s in silence for minutes.
    expect(seen).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
    expect(result.clipCount).toBe(3);
    expect(result.fetchedClipCount).toBe(3);
  });

  it("counts what actually arrived, not what was asked for, when a stream drops", async () => {
    mockFetchFromUrl();
    const result = await buildSunnyBanksEpisodeBundle({
      ...baseInput,
      clips: [
        clip(0, crashLabClipUrl(firstBeat.clipFile)),
        // A real URL shape the mock 404s — one dropped stream must not
        // sink the zip, and must not be counted as downloaded either.
        clip(1, "https://skidmarks.aiglitch.app/media/missing.mov"),
      ],
    });
    expect(result.clipCount).toBe(2);
    expect(result.fetchedClipCount).toBe(1);
    expect(result.zipBytes.byteLength).toBeGreaterThan(0);
  });

  it("still builds a zip, and reports zero fetched, for an episode with no clips yet", async () => {
    mockFetchFromUrl();
    const result = await buildSunnyBanksEpisodeBundle({ ...baseInput, clips: [] });
    expect(result.clipCount).toBe(0);
    expect(result.fetchedClipCount).toBe(0);
    expect(result.filename).toBe("ep02-drop-bears-dilemma.zip");
    expect(result.zipBytes.byteLength).toBeGreaterThan(0);
  });
});

describe("fetchSunnyBanksBinaryAsset proxy fallback (2026-09-18)", () => {
  /** The exact live failure: "Downloaded EP02 — 18 of 64 clips". The 18
   * were Vercel Blob renders; the 46 that failed were Crash Lab seed
   * clips on another host, where the browser blocks reading the bytes. */
  const CROSS_ORIGIN = crashLabClipUrl(firstBeat.clipFile);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries a CORS-blocked clip through the same-origin proxy and gets the bytes", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        // A CORS block surfaces as a thrown TypeError, not a status —
        // the browser deliberately hides why.
        if (url === CROSS_ORIGIN) throw new TypeError("Load failed");
        if (url.startsWith("/api/skidmarks/sunnybank/clip-proxy")) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }
        return new Response(null, { status: 404 });
      })
    );

    const bytes = await fetchSunnyBanksBinaryAsset(CROSS_ORIGIN);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0]).toBe(CROSS_ORIGIN);
    expect(calls[1]).toContain("/api/skidmarks/sunnybank/clip-proxy?url=");
    expect(decodeURIComponent(calls[1].split("url=")[1])).toBe(CROSS_ORIGIN);
  });

  it("does not spend a second request when the direct fetch already worked", async () => {
    // A Blob URL is readable cross-origin already; proxying it too
    // would double the bytes for nothing.
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([7]), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const bytes = await fetchSunnyBanksBinaryAsset(
      "https://abc.public.blob.vercel-storage.com/sunnybanks/speak-beats/1-shazza.mp4"
    );
    expect(bytes).toEqual(new Uint8Array([7]));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry a URL the proxy would refuse — that request can only fail", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Load failed");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchSunnyBanksBinaryAsset("https://example.com/clip.mp4")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns null, never throws, when the proxy fails too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === CROSS_ORIGIN) throw new TypeError("Load failed");
        return new Response(null, { status: 502 });
      })
    );
    expect(await fetchSunnyBanksBinaryAsset(CROSS_ORIGIN)).toBeNull();
  });
});
