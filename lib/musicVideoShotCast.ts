/**
 * Music video multi-cast plates (2026-10-03, Stuart's multi-cast spec).
 * The band's members are the Cast cards; the vocalist is the primary; a
 * shot prompt's `[Cast: A, B]` tag or a member's name in it adds them.
 * Same shared helper (`resolveShotCast`, lib/shotCast.ts) as Sunnybank
 * and Shorts. A member's picture is their avatar (the roster thumbnail).
 *
 * Only used when the plate already holds the vocalist's identity: a
 * person-less B-roll plate is unchanged. One person = the plate request
 * is byte for byte what it was before.
 */

import {
  MAX_SHOT_CAST,
  parseCastTagNames,
  resolveShotCast,
  resolveShotCastPositions,
  type ShotCast,
} from "./shotCast";
import type { SkidmarksMember } from "./skidmarks";

/** `[Cast: Jack Ash, Soul Rebel]` in a shot prompt. */
export function castTagNamesIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\[Cast:\s*([^\]]*)\]/gi)) out.push(...parseCastTagNames(match[1] ?? ""));
  return out;
}

export interface MusicVideoShotCast {
  cast: ShotCast;
  /** Everyone after the vocalist, with their avatar as it's stored. */
  extras: Array<{ name: string; avatarImage: string; position?: string }>;
  vocalistPosition?: string;
}

/** Nobody extra: the one-person (or person-less) plate. */
export const NO_MUSIC_VIDEO_CAST: MusicVideoShotCast = {
  cast: { members: [], names: [], missingPicture: [], dropped: [], isMulti: false },
  extras: [],
};

/** Who is in one Music video plate. No vocalist = nobody (nothing to hold). */
export function resolveMusicVideoShotCast(args: {
  members: readonly SkidmarksMember[];
  vocalist?: SkidmarksMember;
  shotPrompt: string;
}): MusicVideoShotCast {
  const empty = NO_MUSIC_VIDEO_CAST;
  if (!args.vocalist?.name.trim()) return empty;
  const cards = args.members
    .filter((m) => m.name.trim())
    .map((m) => ({ name: m.name.trim(), picture: m.avatarImage?.trim() || null }));
  const cast = resolveShotCast({
    cards,
    explicit: castTagNamesIn(args.shotPrompt),
    primary: args.vocalist.name,
    shotText: [args.shotPrompt],
    max: MAX_SHOT_CAST,
  });
  if (!cast.isMulti) return { ...empty, cast };
  const positions = resolveShotCastPositions(
    cast.members.map((m) => ({ name: m.name })),
    [args.shotPrompt],
  );
  return {
    cast,
    vocalistPosition: positions[0] || undefined,
    extras: cast.members.slice(1).map((m, i) => ({
      name: m.name,
      avatarImage: m.picture ?? "",
      ...(positions[i + 1] ? { position: positions[i + 1] } : {}),
    })),
  };
}

/**
 * The other members' pictures, ready for the plate request
 * (`buildPlateGenerationRequest`'s `extraCast`). A member with no
 * picture refuses the plate before anything is billed.
 */
export async function prepareMusicVideoExtraCast(
  shot: MusicVideoShotCast,
  resolvePicture: (src: string) => Promise<string>,
): Promise<
  | { ok: true; extraCast: Array<{ name: string; avatarImage: string; position?: string }>; vocalistPosition?: string }
  | { ok: false; message: string }
> {
  if (!shot.cast.isMulti) return { ok: true, extraCast: [] };
  if (shot.cast.missingPicture.length > 0) {
    return { ok: false, message: musicVideoMissingPictureMessage(shot.cast.missingPicture) };
  }
  const extraCast: Array<{ name: string; avatarImage: string; position?: string }> = [];
  for (const person of shot.extras) {
    extraCast.push({ ...person, avatarImage: await resolvePicture(person.avatarImage) });
  }
  return { ok: true, extraCast, vocalistPosition: shot.vocalistPosition };
}

export function musicVideoMissingPictureMessage(names: readonly string[]): string {
  const who = names.join(" and ");
  return `${who} ${names.length > 1 ? "have" : "has"} no picture yet. Add one on the band's roster; this plate won't generate until then.`;
}
