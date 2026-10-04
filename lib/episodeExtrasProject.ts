/**
 * Which episode an Extras row belongs to, for every genre (2026-10-04,
 * `lib/episodeExtras.ts`). The only per-genre part of Extras: each genre
 * already keeps its episode's Blob folder name somewhere, and this reads
 * it. Everything else (the row, the upload, the saving, the zip names)
 * is shared.
 *
 * - Sunnybank / Skidmarks: the open episode's pinned `mediaSlug`
 *   (`deck/<genre>/episodes/<episode>`), pinned from its name when first
 *   needed, the same as its first clip.
 * - Shorts: the open short's pinned folder (`deck/shorts/episodes/ep01-…`).
 * - Music video: the attached song's folder (`deck/music-video/songs/<song>`).
 */

import {
  ensureSunnyBanksEpisodeMediaSlug,
  getAdultShortsState,
  getStudioState,
  getSunnyBanksLiveOrDefault,
  type SkidmarksState,
} from "./skidmarks";
import { pinAdultShortMediaSlug } from "./deckMediaTargets";
import type { DeckGenre } from "./deckMediaPaths";
import { episodeFolderFor, songEpisodeFolder } from "./episodeExtras";

export interface EpisodeExtrasProject {
  /** The episode's Blob folder; `null` until it has one (no extras can exist yet). */
  folder: string | null;
  /** Can a file be added right now (the folder exists or can be pinned)? */
  canAdd: boolean;
  /** Why not, in plain words. */
  blockedReason: string | null;
}

/** Read-only: what the row shows. Never writes. */
export function episodeExtrasProjectFor(state: SkidmarksState, genre: DeckGenre): EpisodeExtrasProject {
  if (genre === "sunnybank" || genre === "skidmarks") {
    const studio = getStudioState(genre, state);
    const live = getSunnyBanksLiveOrDefault(state, genre);
    const card = live.episodeId ? studio?.workspaces.find((w) => w.id === live.episodeId) : undefined;
    const folder = episodeFolderFor(genre, live.mediaSlug ?? card?.mediaSlug);
    const named = Boolean(folder || live.workspaceTitle.trim());
    return {
      folder,
      canAdd: named,
      blockedReason: named ? null : "Give the episode a name first (the # EPISODE: line), then add extras.",
    };
  }
  if (genre === "shorts") {
    const shorts = getAdultShortsState(state);
    const card = shorts.saved.find((x) => x.id === shorts.currentSavedId);
    const folder = episodeFolderFor("shorts", shorts.mediaSlug ?? card?.mediaSlug);
    return { folder, canAdd: true, blockedReason: null };
  }
  const folder = songEpisodeFolder(state.session.mp3?.fileName);
  return {
    folder,
    canAdd: Boolean(folder),
    blockedReason: folder ? null : "Attach the song first, then add extras.",
  };
}

/** Browser only: the folder to upload into, pinning the episode's folder
 * name the first time (saved with the episode, like its first clip). */
export function pinEpisodeExtrasFolder(state: SkidmarksState, genre: DeckGenre): string | null {
  const shown = episodeExtrasProjectFor(state, genre);
  if (shown.folder || !shown.canAdd) return shown.folder;
  if (genre === "sunnybank" || genre === "skidmarks") return episodeFolderFor(genre, ensureSunnyBanksEpisodeMediaSlug(genre));
  if (genre === "shorts") return episodeFolderFor("shorts", pinAdultShortMediaSlug());
  return null;
}
