/**
 * Each Shorts episode has its own Cast and Locations (2026-10-04, Stuart:
 * "every Shorts episode is standalone", the same as Skidmarks). A new
 * episode starts with an empty Cast row, an empty Locations row and no one
 * starring. The rule itself is shared with Skidmarks (`lib/episodeCast.ts`);
 * this file only says which Shorts episode is open and whether it is one of
 * the older ones.
 *
 * The older episodes are the cards made before 2026-10-04: EP01 (Blonde
 * Girl) and EP02 (Blonde Beauty). A card's id says when it was made
 * (`short_<time>_<random>`, `mintAdultShortsId`) and never changes, so
 * this needs nothing written. Those episodes keep exactly the Cast they
 * have now (Skye, SKYLAR and anyone else from before), and their own
 * shots, plates and clips. Cards with an id that carries no time (none
 * exist outside tests) count as older too.
 *
 * The open editor with no card yet (a "+ New" episode before its first
 * shot) is always a new episode. Its folder is the one its clips will use
 * (`pinAdultShortMediaSlug`, `deck/shorts/episodes/ep03-backpackers/`).
 *
 * Pure: pass the session state in.
 */
import { editorHasContent, normalizeAdultShortsState, type AdultShortsSaved, type AdultShortsState } from "./adultShorts";
import { isSafeDeckMediaSlug } from "./deckMediaPaths";
import { NO_EPISODE_SCOPE, type EpisodeScope } from "./episodeCast";
import type { SkidmarksState } from "./skidmarks";

/** Cards made from this moment on (2026-10-04 00:00 UTC) are standalone episodes. */
export const SHORTS_OWN_CAST_SINCE_MS = Date.UTC(2026, 9, 4);

/** When a card was made, from its id (`short_mumdrqaw_97e2b2ad`), or `null`. */
export function shortsCardMadeAt(id: string): number | null {
  const m = /^short_([0-9a-z]+)_/.exec(id);
  if (!m) return null;
  const t = parseInt(m[1], 36);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** One of the Shorts episodes from before 2026-10-04 (EP01, EP02). */
export function isOlderShortsEpisode(card: Pick<AdultShortsSaved, "id">): boolean {
  const t = shortsCardMadeAt(card.id);
  return t === null || t < SHORTS_OWN_CAST_SINCE_MS;
}

/** The open Shorts episode as a scope. */
export function shortsEpisodeScopeOf(adult: AdultShortsState | null | undefined): EpisodeScope {
  if (!adult) return NO_EPISODE_SCOPE;
  const card = adult.currentSavedId ? adult.saved.find((x) => x.id === adult.currentSavedId) : undefined;
  const episode = isSafeDeckMediaSlug(adult.mediaSlug)
    ? adult.mediaSlug
    : card && isSafeDeckMediaSlug(card.mediaSlug)
      ? card.mediaSlug
      : null;
  return { episode, legacy: card ? isOlderShortsEpisode(card) : false, tickedIds: [] };
}

/** Shorts' two editors (2026-10-04): the script studio, or the shot cards (EP01–EP03). */
export type ShortsEditor = "script" | "cards";

/**
 * Which Shorts editor is open. Script episodes are the default
 * (2026-10-04, Stuart: "Shorts must work exactly like Skidmarks"):
 * "+ New" always starts one. The shot cards are open when their
 * episode was picked on the EPISODES row, or, when nothing was ever
 * picked, while a shot-card episode is open (a card, a name, a folder
 * or work in it), so a
 * session with EP03 open looks exactly as it did before.
 */
export function shortsOpenEditor(adultShorts: unknown): ShortsEditor {
  const adult = normalizeAdultShortsState(adultShorts);
  if (!adult) return "script";
  if (adult.editor) return adult.editor;
  const shotCardEpisodeOpen = Boolean(adult.currentSavedId || adult.title || adult.mediaSlug || editorHasContent(adult));
  return shotCardEpisodeOpen ? "cards" : "script";
}

/** Is Shorts' script studio the open editor (2026-10-04)? See `shortsOpenEditor`. */
export function shortsScriptEditorOpen(state: Pick<SkidmarksState, "adultShorts">): boolean {
  return shortsOpenEditor(state.adultShorts) === "script";
}

/**
 * The open Shorts script episode as a scope (2026-10-04): its pinned
 * folder, or its card's. A script episode is standalone, except one
 * converted from an older shot-card episode (2026-10-05, EP01/EP02: it
 * keeps the shot cards' folder), which keeps that episode's Cast exactly
 * as before. Pass `adultShorts` to know which folders those are.
 */
export function shortsStudioEpisodeScopeOf(studio: SkidmarksState["shortsStudio"], adultShorts?: unknown): EpisodeScope {
  if (!studio) return { episode: null, legacy: false, tickedIds: [] };
  const live = studio.live;
  const card = live?.episodeId ? studio.workspaces.find((w) => w.id === live.episodeId) : undefined;
  const episode = isSafeDeckMediaSlug(live?.mediaSlug)
    ? live.mediaSlug
    : card && isSafeDeckMediaSlug(card.mediaSlug)
      ? card.mediaSlug
      : null;
  const adult = adultShorts === undefined ? null : normalizeAdultShortsState(adultShorts);
  const folderOf = (x: AdultShortsSaved) => x.mediaSlug ?? (adult && x.id === adult.currentSavedId ? adult.mediaSlug : undefined);
  const shotCards = episode && adult ? adult.saved.filter((x) => folderOf(x) === episode) : [];
  const legacy = shotCards.length > 0 && shotCards.every((x) => isOlderShortsEpisode(x));
  return { episode, legacy, tickedIds: [] };
}

/** The open Shorts episode (shot cards or script, whichever is open), from the whole session. */
export function openShortsEpisodeScopeIn(state: Pick<SkidmarksState, "adultShorts"> & Partial<Pick<SkidmarksState, "shortsStudio">>): EpisodeScope {
  if (shortsScriptEditorOpen(state)) return shortsStudioEpisodeScopeOf(state.shortsStudio ?? null, state.adultShorts);
  return shortsEpisodeScopeOf(normalizeAdultShortsState(state.adultShorts));
}

/** Does the open Shorts episode have a name yet (its card's, the one typed on "+ New", or a pinned folder)? */
export function shortsEpisodeHasName(adult: AdultShortsState | null | undefined): boolean {
  if (!adult) return false;
  if (isSafeDeckMediaSlug(adult.mediaSlug) || adult.title?.trim()) return true;
  const card = adult.currentSavedId ? adult.saved.find((x) => x.id === adult.currentSavedId) : undefined;
  return Boolean(card);
}
