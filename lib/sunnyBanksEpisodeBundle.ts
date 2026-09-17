import { buildStoreZip } from "./zipDownload";

/**
 * Client-side Sunny Banks episode zip (2026-09-17) — scripts, the gold
 * Speak/Hold prompt array, and finished clip **URL paths**. Does not
 * fetch MP4 bytes (those stay on Crash Lab / Blob). In-memory panel
 * state only; not a Neon episode table.
 */

export interface SunnyBanksEpisodePromptEntry {
  act: "I" | "II" | "III";
  index: number;
  characterName: string;
  kind: "speak" | "hold";
  line: string;
  locationId: string;
  prompt: string;
}

export interface SunnyBanksEpisodeClipEntry {
  act: "I" | "II" | "III";
  index: number;
  characterName: string;
  lineLabel: string;
  videoUrl: string;
  durationSec?: number;
}

export interface SunnyBanksEpisodeBundleInput {
  title: string;
  defaultLocationId: string;
  actScripts: { I: string; II: string; III: string };
  prompts: SunnyBanksEpisodePromptEntry[];
  clips: SunnyBanksEpisodeClipEntry[];
}

export function slugifySunnyBanksEpisodeFilename(title: string): string {
  const slug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "sunny-banks-episode";
  return `${slug}.zip`;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function buildScriptTxt(actScripts: SunnyBanksEpisodeBundleInput["actScripts"]): string {
  return (["I", "II", "III"] as const)
    .map((act) => `# Act ${act}\n${actScripts[act].trimEnd()}`)
    .join("\n\n");
}

export function buildSunnyBanksEpisodeBundle(input: SunnyBanksEpisodeBundleInput): {
  zipBytes: Uint8Array;
  filename: string;
} {
  const title = input.title.trim() || "Sunny Banks episode";
  const clips = input.clips.map((clip) => ({
    act: clip.act,
    index: clip.index,
    characterName: clip.characterName,
    lineLabel: clip.lineLabel,
    videoUrl: clip.videoUrl,
    durationSec: clip.durationSec ?? null,
  }));
  const zipBytes = buildStoreZip([
    { name: "script.txt", data: encodeUtf8(buildScriptTxt(input.actScripts)) },
    {
      name: "prompts.json",
      data: encodeUtf8(`${JSON.stringify(input.prompts, null, 2)}\n`),
    },
    {
      name: "clips.json",
      data: encodeUtf8(`${JSON.stringify({ title, defaultLocationId: input.defaultLocationId, clips }, null, 2)}\n`),
    },
  ]);
  return { zipBytes, filename: slugifySunnyBanksEpisodeFilename(title) };
}
