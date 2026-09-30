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

import {
  ADULT_SHORTS_MAX_PEOPLE_PER_SHOT,
  ADULT_SHORTS_MAX_REFERENCES,
  adultShortShotPeople,
  adultShortStarring,
  normalizeAdultShortsState,
  type AdultShortsCharacter,
  type AdultShortsPerson,
  type AdultShortsShot,
} from "./adultShorts";
import { emptyCharacterLorasState, slugifyCharacterName } from "./characterLoras";
import { buildCharacterRoster, entryForRosterCharacter, type RosterCharacter } from "./characterRoster";
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
  const lead = resolvePerson(state, adult?.character ?? EMPTY, Boolean(adult?.ageConfirmed));
  return { name: lead.name, look: lead.look, referenceUrls: lead.referenceUrls };
}

/** One starring person read through their Cast card (see `resolveShortsRenderCharacter`). */
function resolvePerson(state: SkidmarksState, own: AdultShortsCharacter, confirmed: boolean): AdultShortsPerson {
  const cast = confirmed ? findShortsCastCharacter(state, own.name) : null;
  if (!cast) return { ...own, referenceUrls: own.referenceUrls.slice() };
  const pictures = [...new Set([...own.referenceUrls, ...shortsCastPictures(cast)].filter(usablePicture))].slice(
    0,
    ADULT_SHORTS_MAX_REFERENCES,
  );
  // Their own card's word (woman, man, person) goes in the prompt's adult line.
  const card = entryForRosterCharacter((state.characterLoras ?? emptyCharacterLorasState()).characters, cast.sourceKey);
  const subjectWord = (card?.subjectWord || cast.subjectWord || "person").trim();
  return { name: own.name.trim() || cast.name, look: own.look.trim() || cast.look.trim(), referenceUrls: pictures, subjectWord };
}

/**
 * Everyone starring in the open episode (2026-09-30: more than one
 * person can star), each read through their own Cast card, in order.
 */
export function resolveShortsStarring(state: SkidmarksState): AdultShortsPerson[] {
  const adult = normalizeAdultShortsState(state.adultShorts);
  if (!adult) return [];
  return adultShortStarring(adult).map((p) => resolvePerson(state, p, adult.ageConfirmed));
}

/** The people in one shot (its own picks, else everyone starring), at most the four one plate can use. */
export function shortsShotPeople(starring: readonly AdultShortsPerson[], shot: Pick<AdultShortsShot, "castNames">): AdultShortsPerson[] {
  return adultShortShotPeople(starring, shot).slice(0, ADULT_SHORTS_MAX_PEOPLE_PER_SHOT);
}

/**
 * The pictures a shot's plate is made from: one per person in the shot,
 * in the same order as the prompt names them. "From N" picks each
 * person's Nth picture (their first when they have fewer).
 */
export function shortsPlateReferences(people: readonly AdultShortsCharacter[], referenceIndex: number): string[] {
  const out: string[] = [];
  for (const p of people) {
    const url = p.referenceUrls[referenceIndex] ?? p.referenceUrls[0];
    if (url && !out.includes(url)) out.push(url);
  }
  return out.slice(0, ADULT_SHORTS_MAX_PEOPLE_PER_SHOT);
}
