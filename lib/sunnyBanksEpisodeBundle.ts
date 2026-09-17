import { crashLabClipUrl } from "./sunnyBanksDropBears";
import fixture from "./sunnyBanksDropBears.fixture.json";
import { buildStoreZip } from "./zipDownload";

/**
 * Client-side Sunny Banks episode zip (2026-09-17) — scripts, the gold
 * Speak/Hold prompt array, clip URL records under `data/`, plus a
 * best-effort fetch of each clip's own MP4 / driving-audio MP3 into
 * `video/` and `audio/`. A dropped stream or empty URL is skipped so
 * the zip still downloads. In-memory panel state only; not a Neon
 * episode table. Uses `buildStoreZip` (store method 0), not JSZip.
 */

export interface SunnyBanksEpisodePromptEntry {
  act: string;
  index: number;
  characterName: string;
  kind: "speak" | "hold";
  line: string;
  locationId: string;
  prompt: string;
}

export interface SunnyBanksEpisodeClipEntry {
  act: string;
  index: number;
  characterName: string;
  lineLabel: string;
  videoUrl: string;
  /** Driving TTS / padded-silence MP3 when the panel already has one. */
  audioUrl?: string;
  durationSec?: number;
}

export interface SunnyBanksEpisodeBundleInput {
  title: string;
  defaultLocationId: string;
  actIds: readonly string[];
  actScripts: Record<string, string>;
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

function buildScriptTxt(actIds: readonly string[], actScripts: Record<string, string>): string {
  return actIds
    .map((act) => `# Act ${act}\n${(actScripts[act] ?? "").trimEnd()}`)
    .join("\n\n");
}

/** Sequential zip stem for clip row `0` → `"01"`. */
export function formatSunnyBanksEpisodeRowIndex(rowIndex: number): string {
  return String(rowIndex + 1).padStart(2, "0");
}

export function isSunnyBanksMediaUrl(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return false;
  return /^(https?:|blob:|data:)/i.test(trimmed);
}

function crashLabFileNameFromUrl(url: string): string | null {
  try {
    const fileName = new URL(url).searchParams.get("fileName");
    return fileName?.trim() ? fileName : null;
  } catch {
    return null;
  }
}

/**
 * Driving audio for a clip row: an explicit `audioUrl` wins, otherwise
 * the Crash Lab EP02 fixture's matching `voiceFile` (same clip route,
 * padded-silence holds included when that file is the beat's voice).
 * Returns null when there is nothing real to fetch.
 */
export function resolveSunnyBanksEpisodeAudioUrl(clip: SunnyBanksEpisodeClipEntry): string | null {
  const explicit = clip.audioUrl?.trim() ?? "";
  if (isSunnyBanksMediaUrl(explicit)) return explicit;
  const clipFile = crashLabFileNameFromUrl(clip.videoUrl);
  if (!clipFile) return null;
  const beat = fixture.beats.find((entry) => entry.clipFile === clipFile);
  if (!beat?.voiceFile) return null;
  return crashLabClipUrl(beat.voiceFile);
}

/**
 * Fetch equivalent of axios `responseType: 'arraybuffer'`. A network
 * drop, a non-OK status, or an empty body returns null — never throws
 * — so one missing stream cannot sink the zip.
 */
export async function fetchSunnyBanksBinaryAsset(url: string): Promise<Uint8Array | null> {
  if (!isSunnyBanksMediaUrl(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

export async function buildSunnyBanksEpisodeBundle(input: SunnyBanksEpisodeBundleInput): Promise<{
  zipBytes: Uint8Array;
  filename: string;
}> {
  const title = input.title.trim() || "Sunny Banks episode";
  const actIds = input.actIds.length > 0 ? [...input.actIds] : Object.keys(input.actScripts);
  const clips = input.clips.map((clip) => ({
    act: clip.act,
    index: clip.index,
    characterName: clip.characterName,
    lineLabel: clip.lineLabel,
    videoUrl: clip.videoUrl,
    audioUrl: resolveSunnyBanksEpisodeAudioUrl(clip),
    durationSec: clip.durationSec ?? null,
  }));
  const dataEntries = [
    { name: "data/script.txt", data: encodeUtf8(buildScriptTxt(actIds, input.actScripts)) },
    {
      name: "data/prompts.json",
      data: encodeUtf8(`${JSON.stringify(input.prompts, null, 2)}\n`),
    },
    {
      name: "data/clips.json",
      data: encodeUtf8(
        `${JSON.stringify({ title, defaultLocationId: input.defaultLocationId, actIds, clips }, null, 2)}\n`
      ),
    },
  ];
  const videoEntries: { name: string; data: Uint8Array }[] = [];
  const audioEntries: { name: string; data: Uint8Array }[] = [];

  for (let rowIndex = 0; rowIndex < input.clips.length; rowIndex += 1) {
    const clip = input.clips[rowIndex];
    const stem = formatSunnyBanksEpisodeRowIndex(rowIndex);
    const audioUrl = resolveSunnyBanksEpisodeAudioUrl(clip);
    const [videoBytes, audioBytes] = await Promise.all([
      fetchSunnyBanksBinaryAsset(clip.videoUrl),
      audioUrl ? fetchSunnyBanksBinaryAsset(audioUrl) : Promise.resolve(null),
    ]);
    if (videoBytes) videoEntries.push({ name: `video/${stem}.mp4`, data: videoBytes });
    if (audioBytes) audioEntries.push({ name: `audio/${stem}.mp3`, data: audioBytes });
  }

  const zipBytes = buildStoreZip([...dataEntries, ...videoEntries, ...audioEntries]);
  return { zipBytes, filename: slugifySunnyBanksEpisodeFilename(title) };
}
