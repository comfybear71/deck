/**
 * The open episode of a standalone genre (Skidmarks or Shorts) as the one
 * shared `EpisodeScope` (`lib/episodeCast.ts`), so the Cast row, the
 * Locations row and every save ask the same question the same way.
 *
 * Pure: pass the session state in.
 */
import { NO_EPISODE_SCOPE, type EpisodeCastGenre, type EpisodeScope } from "./episodeCast";
import type { SkidmarksState } from "./skidmarks";
import { openSkidmarksEpisodeScopeIn } from "./skidmarksEpisodeCast";
import { openShortsEpisodeScopeIn } from "./shortsEpisodeCast";

export function openEpisodeScopeIn(state: Pick<SkidmarksState, "skidmarksStudio" | "adultShorts">, genre: EpisodeCastGenre): EpisodeScope {
  if (genre === "skidmarks") return openSkidmarksEpisodeScopeIn(state);
  if (genre === "adult-shorts") return openShortsEpisodeScopeIn(state);
  return NO_EPISODE_SCOPE;
}
