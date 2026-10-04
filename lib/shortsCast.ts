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
 * her Cast card's pictures first, main face first (2026-09-30, the
 * "From 1/2/3" picker is gone), then any of the episode's own she
 * doesn't have there. Nothing here writes anything.
 *
 * Each Shorts episode has its own Cast (2026-10-04, `lib/episodeCast.ts`):
 * the Cast row and "Starring" show only the open episode's people. The
 * older episodes (EP01, EP02) read exactly as before.
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
import { emptyCharacterLorasState, normalizeElevenLabsVoiceId, slugifyCharacterName } from "./characterLoras";
import { buildCharacterRoster, entryForRosterCharacter, type RosterCharacter } from "./characterRoster";
import { openShortsEpisodeScopeIn } from "./shortsEpisodeCast";
import type { SkidmarksState } from "./skidmarks";
import { resolveShotCast, sameShotCastName, type ShotCast } from "./shotCast";

const EMPTY: AdultShortsCharacter = { name: "", look: "", referenceUrls: [] };

function usablePicture(u: unknown): u is string {
  return typeof u === "string" && /^(https:|data:image\/)/.test(u);
}

/** The Shorts Cast row, in the same order it's shown (empty until the 18+
 * confirm): only the open episode's own people (2026-10-04). */
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
 * Who the open episode's plates and clips are made of: their name, look
 * and pictures, read through their Cast card. The Cast card's pictures
 * come first, main face first; the episode's own copy fills any gaps.
 * Their look comes from the episode, else from their Cast card. Someone
 * who isn't on the Cast row keeps the episode's copy.
 */
export function resolveShortsRenderCharacter(state: SkidmarksState): AdultShortsCharacter {
  const adult = normalizeAdultShortsState(state.adultShorts);
  const own = adult && adult.ageConfirmed && !openShortsEpisodeScopeIn(state).legacy ? (shortsEpisodeStarringList(state)[0] ?? EMPTY) : (adult?.character ?? EMPTY);
  const lead = resolvePerson(state, own, Boolean(adult?.ageConfirmed));
  return { name: lead.name, look: lead.look, referenceUrls: lead.referenceUrls };
}

/** One starring person read through their Cast card (see `resolveShortsRenderCharacter`). */
function resolvePerson(state: SkidmarksState, own: AdultShortsCharacter, confirmed: boolean): AdultShortsPerson {
  const cast = confirmed ? findShortsCastCharacter(state, own.name) : null;
  if (!cast) return { ...own, referenceUrls: own.referenceUrls.slice() };
  const pictures = [...new Set([...shortsCastPictures(cast), ...own.referenceUrls].filter(usablePicture))].slice(
    0,
    ADULT_SHORTS_MAX_REFERENCES,
  );
  // Their own card's word (woman, man, person) goes in the prompt's adult line.
  const card = entryForRosterCharacter((state.characterLoras ?? emptyCharacterLorasState()).characters, cast.sourceKey);
  const subjectWord = (card?.subjectWord || cast.subjectWord || "person").trim();
  // Their Cast card's voice (2026-09-30), for a shot with a Line.
  const voiceId = normalizeElevenLabsVoiceId(card?.voiceId);
  return {
    name: own.name.trim() || cast.name,
    look: own.look.trim() || cast.look.trim(),
    referenceUrls: pictures,
    subjectWord,
    ...(voiceId ? { voiceId } : {}),
  };
}

/**
 * Everyone starring in the open episode (2026-09-30: more than one
 * person can star), each read through their own Cast card, in order.
 */
export function resolveShortsStarring(state: SkidmarksState): AdultShortsPerson[] {
  const adult = normalizeAdultShortsState(state.adultShorts);
  if (!adult) return [];
  return shortsEpisodeStarringList(state).map((p) => resolvePerson(state, p, adult.ageConfirmed));
}

/**
 * Who's starring in the open episode, as saved on it (2026-10-04). An
 * older episode (EP01, EP02) reads exactly as before. In any other episode
 * only people on its own Cast row count, so someone from another episode's
 * Cast never stars here (and "Starring" can be empty: no one is forced).
 * Nothing is written; the next tap on "Starring" saves the shorter list.
 */
export function shortsEpisodeStarringList(state: SkidmarksState): AdultShortsCharacter[] {
  const adult = normalizeAdultShortsState(state.adultShorts);
  if (!adult) return [];
  const list = adultShortStarring(adult);
  if (!adult.ageConfirmed || openShortsEpisodeScopeIn(state).legacy) return list;
  const cast = shortsCastList(state).map((c) => slugifyCharacterName(c.name));
  return list.filter((p) => cast.includes(slugifyCharacterName(p.name)));
}

/**
 * Who is in one Shorts shot, through the shared helper every genre uses
 * (`resolveShotCast`, lib/shotCast.ts, 2026-10-03). The "In this shot"
 * picker is the explicit list (its picks, else everyone starring), in
 * starring order, capped at four. Each person's picture is their main
 * Cast card face; a person with none is in `missingPicture`.
 */
export function shortsShotCast(starring: readonly AdultShortsPerson[], shot: Pick<AdultShortsShot, "castNames">): ShotCast {
  const cards = starring.map((p) => ({ name: p.name, picture: p.referenceUrls[0] ?? null }));
  return resolveShotCast({
    cards,
    explicit: adultShortShotPeople(starring, shot).map((p) => p.name),
    max: ADULT_SHORTS_MAX_PEOPLE_PER_SHOT,
  });
}

/** The people in one shot (its own picks, else everyone starring), at most the four one plate can use. */
export function shortsShotPeople(starring: readonly AdultShortsPerson[], shot: Pick<AdultShortsShot, "castNames">): AdultShortsPerson[] {
  const cast = shortsShotCast(starring, shot);
  return cast.members
    .map((m) => starring.find((p) => sameShotCastName(p.name, m.name)))
    .filter((p): p is AdultShortsPerson => Boolean(p));
}

/**
 * The pictures a shot's plate is made from: one per person in the shot,
 * in the same order as the prompt names them. Each person's main Cast
 * card face, or their next picture if that one is already used by
 * someone before them. (2026-09-30: the "From 1/2/3" picker is gone, so
 * a shot's old saved `referenceIndex` is ignored, not deleted.)
 */
export function shortsPlateReferences(people: readonly AdultShortsCharacter[]): string[] {
  const out: string[] = [];
  for (const p of people) {
    const url = p.referenceUrls.find((u) => !out.includes(u));
    if (url) out.push(url);
  }
  return out.slice(0, ADULT_SHORTS_MAX_PEOPLE_PER_SHOT);
}
