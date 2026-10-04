/**
 * Standalone episodes (2026-10-04, Stuart: "every genre the same
 * structure"): in Skidmarks and Shorts every episode has its OWN Cast and
 * its OWN Locations. A new episode starts with empty Cast and Locations
 * rows. Sunnybank keeps one shared Cast across its episodes and Music video
 * keeps its bands; neither is ever read through this file.
 *
 * One rule for both genres (no list is copied, nothing is moved, nothing
 * is deleted):
 *
 * - A Cast card or place made in an episode carries that episode's pinned
 *   media folder name (`episode: "ep03-backpackers"`, the same name its
 *   clips folder uses, fixed when first pinned). It is only ever in that
 *   episode.
 * - Cards and places from before the change carry no episode. They belong
 *   to the genre's older episodes (`legacy`): the Skidmarks pilot, Shorts
 *   EP01 and EP02. Every picture, voice ID and Blob file stays where it is.
 *   An older episode can also keep cards it had ticked (`tickedIds`).
 *
 * Which episode is "older" is worked out on every read from what is
 * already saved (`lib/skidmarksEpisodeCast.ts`, `lib/shortsEpisodeCast.ts`),
 * so it is the same on every device, needs no database script and never
 * runs twice differently: nothing is written to migrate.
 *
 * Pure.
 */
import type { DeckLocation, DeckLocationGenre, DeckLocationsState } from "./deckLocations";

/** The genres whose episodes are standalone. */
export type EpisodeCastGenre = "skidmarks" | "adult-shorts";

export const EPISODE_CAST_GENRES: readonly EpisodeCastGenre[] = ["skidmarks", "adult-shorts"];

export function isEpisodeCastGenre(genre: unknown): genre is EpisodeCastGenre {
  return typeof genre === "string" && (EPISODE_CAST_GENRES as readonly string[]).includes(genre);
}

/** Which episode a Cast card or place is being looked up for. */
export interface EpisodeScope {
  /** The episode's pinned media folder name, or `null` for a new episode
   * that has no folder yet (it has no Cast or Locations of its own yet). */
  episode: string | null;
  /** One of the genre's older episodes: every card and place saved before
   * the change (no episode on it) is in it. */
  legacy: boolean;
  /** Older cards ticked onto this episode before the change, by id. */
  tickedIds: readonly string[];
}

export const NO_EPISODE_SCOPE: EpisodeScope = { episode: null, legacy: false, tickedIds: [] };

/** Is this Cast card (any genre's own shape: an id and maybe an episode) in the episode? */
export function isInEpisode(item: { id?: string; episode?: string | null }, scope: EpisodeScope): boolean {
  if (item.episode) return item.episode === scope.episode;
  return scope.legacy || (typeof item.id === "string" && scope.tickedIds.includes(item.id));
}

/** The episode's own Cast cards, in their saved order. */
export function episodeOwnItems<T extends { id?: string; episode?: string | null }>(list: readonly T[], scope: EpisodeScope): T[] {
  return list.filter((item) => isInEpisode(item, scope));
}

/** Is this place in the episode? Only the genre's own places count. */
export function isLocationInEpisode(
  location: Pick<DeckLocation, "genre" | "episode">,
  genre: EpisodeCastGenre,
  scope: EpisodeScope,
): boolean {
  if (location.genre !== genre) return false;
  if (location.episode) return location.episode === scope.episode;
  return scope.legacy;
}

/** The episode's own Locations, in saved order. */
export function episodeOwnLocations(
  state: DeckLocationsState | null | undefined,
  genre: EpisodeCastGenre,
  scope: EpisodeScope,
): DeckLocation[] {
  return (state?.locations ?? []).filter((l) => isLocationInEpisode(l, genre, scope));
}

/** Where each genre's episode gets its name, for the message below. */
const NAME_HINT: Record<EpisodeCastGenre, string> = {
  skidmarks: "the # EPISODE: line",
  "adult-shorts": "tap + New and type it",
};

/** The one message when "+" on the Cast or Locations row can't add yet. */
export function episodeNameFirstMessage(
  genre: EpisodeCastGenre,
  what: "characters" | "locations",
  /** Shorts' script studio is open (2026-10-04): named on the # EPISODE: line, as Skidmarks. */
  scriptEditor = false,
): string {
  const hint = genre === "adult-shorts" && scriptEditor ? NAME_HINT.skidmarks : NAME_HINT[genre];
  return `Give the episode a name first (${hint}), then add its ${what}.`;
}

/** A location genre whose places are per episode, as an `EpisodeCastGenre`. */
export function episodeLocationGenre(genre: DeckLocationGenre): EpisodeCastGenre | null {
  return isEpisodeCastGenre(genre) ? genre : null;
}
