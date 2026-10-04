/**
 * The open episode's folder name for a standalone genre (Skidmarks or
 * Shorts, 2026-10-04, `lib/episodeCast.ts`), for a new Cast card or place
 * made in it. One pair of functions for both genres, so the Cast row and
 * the Locations row ask the same question the same way.
 *
 * - `getOpenEpisodeFolder`: read-only; `null` for a new episode with no
 *   folder yet.
 * - `pinOpenEpisodeFolder`: the same, pinned first (the folder the
 *   episode's clips will use), so the card's pictures and its episode tag
 *   match. `null` while the episode has no name: the caller then shows
 *   `episodeNameFirstMessage`.
 *
 * Browser-side (it reads and pins the live studio state).
 */
import type { EpisodeCastGenre } from "./episodeCast";
import { openEpisodeScopeIn } from "./episodeScopes";
import { pinAdultShortMediaSlug } from "./deckMediaTargets";
import { shortsEpisodeHasName } from "./shortsEpisodeCast";
import { getAdultShortsState, getSkidmarksSnapshot, pinSkidmarksEpisodeFolder, type SkidmarksState } from "./skidmarks";

export function getOpenEpisodeFolder(genre: EpisodeCastGenre, state: SkidmarksState = getSkidmarksSnapshot()): string | null {
  return openEpisodeScopeIn(state, genre).episode;
}

export function pinOpenEpisodeFolder(genre: EpisodeCastGenre): string | null {
  if (genre === "skidmarks") return pinSkidmarksEpisodeFolder();
  const existing = getOpenEpisodeFolder(genre);
  if (existing) return existing;
  if (!shortsEpisodeHasName(getAdultShortsState())) return null;
  return pinAdultShortMediaSlug();
}
