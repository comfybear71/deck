/**
 * Shorts: the girl in an episode comes from the Cast row (Stuart,
 * 2026-09-30). The old "Character" box in the Shorts editor (name, look,
 * three pictures) is gone; the Cast row does that job, the same way as
 * every other genre.
 *
 * Each episode still keeps its own copy of her (`AdultShortsState.character`,
 * saved on the episode's `adult-short` row), untouched. That copy is also
 * what puts her on the Cast row (`buildCharacterRoster`, the `as:` tiles),
 * so Skylar's three pictures and look show on her Cast card with nothing
 * moved or written.
 *
 * Renders read her through the Cast card (`resolveShortsRenderCharacter`):
 * the episode's own pictures stay first and in the same order, so a
 * shot's "From 2" still means the same picture, then any pictures her Cast
 * card has on top (added from the Cast row, or a card-only girl like
 * Skye). Nothing here writes anything.
 */

import { ADULT_SHORTS_MAX_REFERENCES, normalizeAdultShortsState, type AdultShortsCharacter } from "./adultShorts";
import { slugifyCharacterName } from "./characterLoras";
import { buildCharacterRoster, type RosterCharacter } from "./characterRoster";
import type { SkidmarksState } from "./skidmarks";

const EMPTY: AdultShortsCharacter = { name: "", look: "", referenceUrls: [] };

function usablePicture(u: unknown): u is string {
  return typeof u === "string" && /^(https:|data:image\/)/.test(u);
}

/** The Shorts Cast row, in the same order it's shown (empty until the 18+ confirm). */
export function shortsCastList(state: SkidmarksState): RosterCharacter[] {
  return buildCharacterRoster(state)["adult-shorts"];
}

/** A Cast card's pictures, first (the face) first, at most the three a shot can pick from. */
export function shortsCastPictures(c: Pick<RosterCharacter, "thumbUrl" | "extraPictureUrls">): string[] {
  return [...new Set([c.thumbUrl, ...c.extraPictureUrls].filter(usablePicture))].slice(0, ADULT_SHORTS_MAX_REFERENCES);
}

/** The Cast card with this name (names match the way the Cast row matches them), or `null`. */
export function findShortsCastCharacter(state: SkidmarksState, name: string): RosterCharacter | null {
  const slug = slugifyCharacterName(name);
  if (!name.trim() || !slug) return null;
  return shortsCastList(state).find((c) => slugifyCharacterName(c.name) === slug) ?? null;
}

/** The episode character for a girl picked from the Cast row ("Starring"). */
export function shortsCharacterFromCast(c: Pick<RosterCharacter, "name" | "look" | "thumbUrl" | "extraPictureUrls">): AdultShortsCharacter {
  return { name: c.name.trim(), look: c.look.trim(), referenceUrls: shortsCastPictures(c) };
}

/**
 * Who the open episode's plates and clips are made of: her name, look and
 * pictures, read through her Cast card. The episode's own pictures stay
 * first (same order, so shots keep pointing at the same picture); her
 * Cast card fills any gaps. Her look comes from the episode, else from
 * her Cast card. A girl who isn't on the Cast row keeps the episode's copy.
 */
export function resolveShortsRenderCharacter(state: SkidmarksState): AdultShortsCharacter {
  const adult = normalizeAdultShortsState(state.adultShorts);
  const own = adult?.character ?? EMPTY;
  const cast = adult?.ageConfirmed ? findShortsCastCharacter(state, own.name) : null;
  if (!cast) return { ...own, referenceUrls: own.referenceUrls.slice() };
  const pictures = [...new Set([...own.referenceUrls, ...shortsCastPictures(cast)].filter(usablePicture))].slice(
    0,
    ADULT_SHORTS_MAX_REFERENCES,
  );
  return { name: own.name.trim() || cast.name, look: own.look.trim() || cast.look.trim(), referenceUrls: pictures };
}
