/**
 * One zip of a Shorts episode's finished clips (2026-09-30): the download
 * icon on each card in the Shorts EPISODES row, the same as Sunnybank's
 * zip. The server builds it (`POST /api/skidmarks/adult-shorts/clips-zip`,
 * `lib/clipsZipResponse.ts`) from the clips' saved URLs and streams it
 * straight to the download, so it works the same on iPhone Safari.
 *
 * Names are readable and in shot order: `ep01-blonde-girl-1-shot-02-skylar.mp4`
 * inside `ep01-blonde-girl-1.zip`. Pure: the route and the page share it.
 *
 * Episode Extras (2026-10-04, `lib/episodeExtras.ts`) go in an `extras/`
 * folder after the clips: `extras/act-3-between-8-and-9 - container-drop.mp4`.
 */
import { adultShortEpisodeSlug, deckMediaSlug, isSafeDeckMediaSlug } from "./deckMediaPaths";
import { isAllowedSunnyBanksClipUrl } from "./sunnyBanksClipProxy";
import { submitZipDownloadForm } from "./zipFormDownload";
import { episodeExtrasZipEntries, parseEpisodeExtraZipItems, type EpisodeExtraZipItem } from "./episodeExtras";

export const SHORTS_CLIPS_ZIP_PATH = "/api/skidmarks/adult-shorts/clips-zip";
export const SHORTS_CLIPS_ZIP_MAX = 100;

export interface ShortsClipsZipRequest {
  /** The episode's file name part, `ep01-blonde-girl-1` (`shortsZipEpisodeName`). */
  episode: string;
  clips: { url: string; shot: number; character: string }[];
  /** The episode's extras (`episodeExtraZipItems`), named on the server. */
  extras?: EpisodeExtraZipItem[];
}

export type ShortsClipsZipPlan =
  | { ok: true; zipName: string; entries: { name: string; url: string }[] }
  | { ok: false; error: string };

/** The episode's pinned folder name when it has one, else `ep01-<title>`. */
export function shortsZipEpisodeName(episodeNumber: number, title: string, mediaSlug?: string | null): string {
  if (isSafeDeckMediaSlug(mediaSlug) && /^ep\d{2,3}-/.test(mediaSlug)) return mediaSlug;
  return adultShortEpisodeSlug(episodeNumber, title);
}

export function planShortsClipsZip(input: unknown): ShortsClipsZipPlan {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to zip." };
  const v = input as Partial<ShortsClipsZipRequest>;
  const episode = deckMediaSlug(typeof v.episode === "string" ? v.episode : "", "short").slice(0, 60);
  const extras = parseEpisodeExtraZipItems(v.extras, isAllowedSunnyBanksClipUrl);
  if (!extras.ok) return extras;
  const rawClips = Array.isArray(v.clips) ? v.clips : [];
  if (rawClips.length === 0 && extras.items.length === 0) return { ok: false, error: "This episode has no finished clips yet." };
  if (rawClips.length > SHORTS_CLIPS_ZIP_MAX) return { ok: false, error: `Keep it to ${SHORTS_CLIPS_ZIP_MAX} clips.` };
  const clips: { url: string; shot: number; character: string }[] = [];
  for (const c of rawClips) {
    const url = typeof c?.url === "string" ? c.url.trim() : "";
    const shot = typeof c?.shot === "number" && Number.isInteger(c.shot) && c.shot >= 1 && c.shot <= 999 ? c.shot : 0;
    if (!shot || !isAllowedSunnyBanksClipUrl(url)) return { ok: false, error: "A clip's link isn't one of Deck's saved clips." };
    clips.push({ url, shot, character: typeof c.character === "string" ? c.character : "" });
  }
  clips.sort((a, b) => a.shot - b.shot);
  // Shorts can have 100 shots: pad to three digits then, so shot-100
  // sorts after shot-099 in any file list. Two digits otherwise, as before.
  const pad = clips.some((c) => c.shot > 99) ? 3 : 2;
  const used = new Set<string>();
  const entries = clips.map((c) => {
    const who = c.character.trim() ? `-${deckMediaSlug(c.character, "clip")}` : "";
    const base = `${episode}-shot-${String(c.shot).padStart(pad, "0")}${who}`;
    let name = `${base}.mp4`;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}.mp4`;
    used.add(name);
    return { name, url: c.url };
  });
  return { ok: true, zipName: `${episode}.zip`, entries: [...entries, ...episodeExtrasZipEntries(extras.items)] };
}

/**
 * Browser only: checks the request first (so a bad one never navigates
 * the page away), then asks the server for the zip with a plain form POST.
 */
export function downloadShortsEpisodeZip(
  request: ShortsClipsZipRequest,
): { ok: true; clipCount: number; extraCount: number } | { ok: false; error: string } {
  const plan = planShortsClipsZip(request);
  if (!plan.ok) return plan;
  submitZipDownloadForm(SHORTS_CLIPS_ZIP_PATH, request);
  const extraCount = plan.entries.filter((e) => e.name.startsWith("extras/")).length;
  return { ok: true, clipCount: plan.entries.length - extraCount, extraCount };
}
