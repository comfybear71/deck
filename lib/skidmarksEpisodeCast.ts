/**
 * Each Skidmarks episode has its own Cast and Locations (2026-10-04,
 * Stuart: "Skidmarks episodes are standalone shows"). A new episode starts
 * with empty Cast and Locations rows; Sunny Banks keeps its one shared
 * Cast across episodes and is never read through this file.
 *
 * How an episode's own Cast and Locations are found (no list is copied,
 * nothing is moved, nothing is deleted):
 *
 * - A Cast card or place made in an episode carries that episode's pinned
 *   media folder name (`episode: "ep01-the-big-wet"`, the same name its
 *   clips folder uses, fixed when first pinned). It is only ever in that
 *   episode.
 * - Cards and places made before 2026-10-04 carry no episode. They belong
 *   to the pilot, **EP00 — Cornish Arsehole** (`ep00-cornish-arsehole`):
 *   Dap, Sparrow, town_street and park keep every picture, voice ID and
 *   Blob file exactly where they are. Any other episode saved before then
 *   keeps the old cards that were ticked "In this episode" on it
 *   (`castIds`), or none.
 *
 * Worked out on every read from what is already saved, so it is the same
 * on every device, needs no database script and never runs twice
 * differently (nothing is written to migrate).
 *
 * Pure: pass the session state in.
 */
import { deckMediaSlug, isSafeDeckMediaSlug } from "./deckMediaPaths";
import type { DeckLocation, DeckLocationsState } from "./deckLocations";
import type { SkidmarksState } from "./skidmarks";
import type { SkidmarksCastMember } from "./skidmarksEpisodes";
import type { SkidmarksSunnyBanksState, SunnyBanksLiveState, SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";

/** The pilot's pinned media folder: `deck/skidmarks/episodes/ep00-cornish-arsehole/`. */
export const SKIDMARKS_PILOT_MEDIA_SLUG = "ep00-cornish-arsehole";

/** Which Skidmarks episode a Cast card or place is being looked up for. */
export interface SkidmarksEpisodeScope {
  /** The episode's pinned media folder name, or `null` for a new episode
   * with no name yet (it has no Cast or Locations of its own yet). */
  episode: string | null;
  /** The pilot: every card and place from before 2026-10-04 is in it. */
  pilot: boolean;
  /** Old cards ticked "In this episode" before 2026-10-04 (PR 242). */
  tickedCastIds: readonly string[];
}

export const NO_SKIDMARKS_EPISODE: SkidmarksEpisodeScope = { episode: null, pilot: false, tickedCastIds: [] };

type EpisodeLike = Pick<SunnyBanksLiveState, "mediaSlug" | "castIds" | "episodeId"> & {
  workspaceTitle?: string;
  label?: string;
};

/** One episode (the live copy or a saved card) as a scope. */
export function skidmarksEpisodeScopeOf(
  episode: EpisodeLike | null | undefined,
  cards: readonly SunnyBanksWorkspaceSnapshot[] = [],
): SkidmarksEpisodeScope {
  if (!episode) return NO_SKIDMARKS_EPISODE;
  const card = episode.episodeId ? cards.find((c) => c.id === episode.episodeId) : undefined;
  const pinned = isSafeDeckMediaSlug(episode.mediaSlug) ? episode.mediaSlug : isSafeDeckMediaSlug(card?.mediaSlug) ? card!.mediaSlug! : null;
  const title = (episode.workspaceTitle ?? episode.label ?? card?.label ?? "").trim();
  // Only a card that was never pinned is recognised by its name; once
  // pinned, the folder name decides (a second "EP00 — Cornish Arsehole"
  // is pinned as `ep00-cornish-arsehole-2`, a different episode).
  const pilot = pinned ? pinned === SKIDMARKS_PILOT_MEDIA_SLUG : deckMediaSlug(title, "") === SKIDMARKS_PILOT_MEDIA_SLUG;
  const ticked = episode.castIds ?? card?.castIds ?? [];
  return { episode: pilot && !pinned ? SKIDMARKS_PILOT_MEDIA_SLUG : pinned, pilot, tickedCastIds: [...ticked] };
}

/** The episode open in the Skidmarks studio (`skidmarksStudio.live`). */
export function openSkidmarksEpisodeScope(studio: SkidmarksSunnyBanksState | null | undefined): SkidmarksEpisodeScope {
  if (!studio) return NO_SKIDMARKS_EPISODE;
  return skidmarksEpisodeScopeOf(studio.live, studio.workspaces);
}

/** The open Skidmarks episode, from the whole session. */
export function openSkidmarksEpisodeScopeIn(state: Pick<SkidmarksState, "skidmarksStudio">): SkidmarksEpisodeScope {
  return openSkidmarksEpisodeScope(state.skidmarksStudio);
}

/** Is this Cast card in the episode? */
export function isCastInSkidmarksEpisode(member: Pick<SkidmarksCastMember, "id" | "episode">, scope: SkidmarksEpisodeScope): boolean {
  if (member.episode) return member.episode === scope.episode;
  return scope.pilot || scope.tickedCastIds.includes(member.id);
}

/** Is this place in the episode? (Skidmarks places only.) */
export function isLocationInSkidmarksEpisode(location: Pick<DeckLocation, "genre" | "episode">, scope: SkidmarksEpisodeScope): boolean {
  if (location.genre !== "skidmarks") return false;
  if (location.episode) return location.episode === scope.episode;
  return scope.pilot;
}

/** The episode's own Cast, in Cast order. */
export function skidmarksEpisodeCast<T extends Pick<SkidmarksCastMember, "id" | "episode">>(
  cast: readonly T[],
  scope: SkidmarksEpisodeScope,
): T[] {
  return cast.filter((m) => isCastInSkidmarksEpisode(m, scope));
}

/** The episode's own Locations, in saved order. */
export function skidmarksEpisodeLocations(state: DeckLocationsState | null | undefined, scope: SkidmarksEpisodeScope): DeckLocation[] {
  return (state?.locations ?? []).filter((l) => isLocationInSkidmarksEpisode(l, scope));
}

/** Why the "+" on the Cast or Locations row can't add yet, or `null`. */
export function skidmarksEpisodeAddBlockedReason(scope: SkidmarksEpisodeScope, liveTitle: string, what: "characters" | "locations"): string | null {
  if (scope.episode || liveTitle.trim()) return null;
  return `Give the episode a name first (the # EPISODE: line), then add its ${what}.`;
}
