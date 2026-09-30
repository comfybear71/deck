/**
 * Browser-side: works out where a new file for a given thing (a
 * character's plate, a band's cover, a short's clip…) belongs in the
 * readable Blob tree, reading the live studio state. Paths themselves
 * come from `lib/deckMediaPaths.ts`; this only looks things up and pins
 * a band/member or short folder name the first time it's needed.
 *
 * Every function returns `null` when the owner can't be found (a blank
 * new band, a song with no MP3 attached…); callers pass that straight to
 * the upload helper, which then uses the old flat path. Nothing here
 * uploads, and nothing here changes any existing link.
 */

import { adultShortEpisodeNumbers, nextAdultShortEpisodeNumber } from "./adultShorts";
import type { CharacterLoraEntry } from "./characterLoras";
import {
  adultShortEpisodeSlug,
  adultShortTarget,
  bandCoverTarget,
  characterMediaOwner,
  characterPictureTarget,
  characterPlateTarget,
  characterReferenceCandidateTarget,
  characterReferenceTarget,
  deckCharacterOwner,
  deckMediaSlug,
  isSafeDeckMediaSlug,
  memberAvatarTarget,
  memberLookTarget,
  memberMediaOwner,
  songMediaSlug,
  songPlateTarget,
  uniqueDeckMediaSlug,
  type DeckMediaOwner,
  type DeckMediaTarget,
} from "./deckMediaPaths";
import { isRosterExtraGroup, rosterExtraSourceKey } from "./rosterExtras";
import {
  getAdultShortsState,
  getCharacterLorasState,
  getSkidmarksSnapshot,
  patchAdultShorts,
  pinSkidmarksBandMediaSlugs,
} from "./skidmarks";

type CardLike = Pick<CharacterLoraEntry, "slug" | "name" | "sourceKey">;

/** A band member's pinned character folder name, found by member id. */
function memberSlugById(memberId: string): string | null {
  const band = getSkidmarksSnapshot().bands.find((b) => b.members.some((m) => m.id === memberId));
  if (!band) return null;
  return pinSkidmarksBandMediaSlugs(band.id, memberId)?.member ?? null;
}

/** A character card's folder, `deck/<genre>/characters/<char>` for every genre. */
export function characterMediaOwnerFor(card: CardLike): DeckMediaOwner {
  return characterMediaOwner(card, memberSlugById);
}

/** Training plate number `n` (1-based) for this card. */
export function characterPlateTargetFor(card: CardLike, n: number): DeckMediaTarget {
  return characterPlateTarget(characterMediaOwnerFor(card), n);
}

export function characterReferenceTargetFor(card: CardLike): DeckMediaTarget {
  return characterReferenceTarget(characterMediaOwnerFor(card));
}

export function characterReferenceCandidateTargetFor(card: CardLike): DeckMediaTarget {
  return characterReferenceCandidateTarget(characterMediaOwnerFor(card));
}

/**
 * Pictures added from "+ Add a character" before the card exists. The
 * folder follows the character they join (a Sunnybank regular, a band
 * member, a Skidmarks cast member) or, for a brand-new one, the group's
 * section and the typed name — the same name the card's own fixed slug
 * is made from. `n` is the picture's 1-based number. `null` → old path.
 */
export function rosterPictureTargetFor(
  group: string,
  name: string,
  existingSourceKey: string | null | undefined,
  n: number,
  bandId?: string | null,
): DeckMediaTarget | null {
  if (group === "music-video" && bandId) {
    // Joins (or becomes) a member of this band.
    const band = getSkidmarksSnapshot().bands.find((b) => b.id === bandId);
    const key = name.trim().toLowerCase();
    const existing = band?.members.find((m) => m.name.trim().toLowerCase() === key);
    const slugs = pinSkidmarksBandMediaSlugs(bandId, existing?.id);
    if (!band || !slugs) return null;
    const memberSlug =
      slugs.member ??
      uniqueDeckMediaSlug(
        deckMediaSlug(name, "member"),
        getSkidmarksSnapshot()
          .bands.flatMap((b) => b.members.map((m) => m.mediaSlug))
          .filter((slug): slug is string => isSafeDeckMediaSlug(slug)),
      );
    return characterPictureTarget(memberMediaOwner(memberSlug), n);
  }
  let sourceKey = existingSourceKey || null;
  if (!sourceKey) {
    if (group === "skidmarks") sourceKey = "sk:new";
    else if (isRosterExtraGroup(group)) sourceKey = rosterExtraSourceKey(group, "new");
    else return null;
  }
  const card = getCharacterLorasState().characters.find((c) => c.sourceKey === sourceKey);
  const slug = card?.slug ?? deckMediaSlug(name, "character");
  return characterPictureTarget(characterMediaOwner({ slug, name, sourceKey }, memberSlugById), n);
}

// ---- Music video ------------------------------------------------------------

export function bandCoverTargetFor(bandId: string): DeckMediaTarget | null {
  const slugs = pinSkidmarksBandMediaSlugs(bandId);
  return slugs ? bandCoverTarget(slugs.band) : null;
}

export function memberAvatarTargetFor(bandId: string, memberId: string): DeckMediaTarget | null {
  const slugs = pinSkidmarksBandMediaSlugs(bandId, memberId);
  return slugs?.member ? memberAvatarTarget(slugs.member) : null;
}

/** The member's next look (numbered by how many looks they already have). */
export function memberLookTargetFor(bandId: string, memberId: string): DeckMediaTarget | null {
  const slugs = pinSkidmarksBandMediaSlugs(bandId, memberId);
  if (!slugs?.member) return null;
  const member = getSkidmarksSnapshot()
    .bands.find((b) => b.id === bandId)
    ?.members.find((m) => m.id === memberId);
  return memberLookTarget(slugs.member, (member?.looks.length ?? 0) + 1);
}

/** A plate still for one clip of the attached song:
 * `deck/music-video/songs/crack-haul/plates/crack-haul-clip-03a`. */
export function songPlateTargetFor(segmentId: string, plateId: string): DeckMediaTarget | null {
  const mp3 = getSkidmarksSnapshot().session.mp3;
  if (!mp3?.fileName) return null;
  const segmentIndex = mp3.segments.findIndex((s) => s.id === segmentId);
  if (segmentIndex < 0) return null;
  const plateIndex = mp3.segments[segmentIndex].plates.findIndex((p) => p.id === plateId);
  return songPlateTarget(songMediaSlug(mp3.fileName), segmentIndex + 1, Math.max(0, plateIndex));
}

// ---- Adult shorts -----------------------------------------------------------

/** The open short's folder name: pinned (and saved) the first time it
 * makes a file. Since 2026-09-30 it is the episode's number and title,
 * `ep01-blonde-girl-1` (`deck/shorts/episodes/ep01-blonde-girl-1/`): the
 * open card's number, or the next one for an episode with no card yet,
 * then its title or else its character's name, with `-2`, `-3`… if
 * another saved short already uses it. A short pinned before keeps its
 * old folder name. */
function pinAdultShortMediaSlug(): string {
  const state = getAdultShortsState();
  if (isSafeDeckMediaSlug(state.mediaSlug)) return state.mediaSlug;
  const card = state.saved.find((x) => x.id === state.currentSavedId);
  if (card && isSafeDeckMediaSlug(card.mediaSlug)) {
    const pinned = card.mediaSlug;
    patchAdultShorts((s) => (isSafeDeckMediaSlug(s.mediaSlug) ? s : { ...s, mediaSlug: pinned }));
    return getAdultShortsState().mediaSlug ?? pinned;
  }
  const episodeNumber = card
    ? (adultShortEpisodeNumbers(state.saved).get(card.id) ?? nextAdultShortEpisodeNumber(state.saved))
    : nextAdultShortEpisodeNumber(state.saved);
  const base = adultShortEpisodeSlug(episodeNumber, card?.title || state.title || state.character.name);
  const taken = state.saved
    .filter((x) => x.id !== state.currentSavedId)
    .map((x) => x.mediaSlug)
    .filter((slug): slug is string => isSafeDeckMediaSlug(slug));
  const slug = uniqueDeckMediaSlug(base, taken);
  patchAdultShorts((s) => (isSafeDeckMediaSlug(s.mediaSlug) ? s : { ...s, mediaSlug: slug }));
  return getAdultShortsState().mediaSlug ?? slug;
}

/** `blonde-girl-1-plate-02` etc. for the open short; `n` is 1-based. */
export function adultShortTargetFor(role: "ref" | "plate" | "clip" | "voice", n: number): DeckMediaTarget {
  return adultShortTarget(pinAdultShortMediaSlug(), role, n);
}

/** A picture of the open short's character, filed with the other Shorts
 * characters (`deck/shorts/characters/blonde-girl-1/pictures/
 * blonde-girl-1-picture-01`) the same way every genre files its cast.
 * No name yet → the short's own folder. `n` is 1-based. */
export function adultShortCharacterPictureTargetFor(n: number): DeckMediaTarget {
  const name = getAdultShortsState().character.name.trim();
  if (!name) return adultShortTargetFor("ref", n);
  return characterPictureTarget(deckCharacterOwner("shorts", deckMediaSlug(name, "character")), n);
}
