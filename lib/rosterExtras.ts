/**
 * Added characters (2026-09-29, Stuart's ask: "they all should really
 * have same form factor ... a universal system"). The "+ Add a
 * character" box on every project's Characters bar saves here, one
 * list per group, so Music video, Sunnybank and Adult shorts can take
 * new people the same way Skidmarks already does. (Skidmarks keeps
 * using its own cast list, because its episodes read from it.)
 *
 * Bands and the built-in Sunnybank cast are untouched. An added
 * character with the same name as one already in that group isn't a
 * second tile: its pictures are added to the existing character (see
 * `buildCharacterRoster`).
 *
 * Persisted on the same Neon session row (`SkidmarksState.rosterExtras`).
 * Pictures are Blob URLs, never bytes.
 */

import { castKindFrom, castKindPersist, type CastKind } from "./castKind";
import { isSafeDeckMediaSlug } from "./deckMediaPaths";
import { SKIDMARKS_CAST_MAX_PICTURES, cleanPictureUrls, mintSkidmarksId } from "./skidmarksEpisodes";

export type RosterExtraGroup = "music-video" | "sunny-banks" | "adult-shorts";

export const ROSTER_EXTRA_GROUPS: readonly RosterExtraGroup[] = ["music-video", "sunny-banks", "adult-shorts"];

/** Same cap as the Skidmarks cast. */
export const ROSTER_EXTRA_MAX_PICTURES = SKIDMARKS_CAST_MAX_PICTURES;
/** Per group. High enough to be unlimited in practice (2026-09-30: "add
 * unlimited girls" in Shorts); pictures are URLs, so the row stays small. */
export const ROSTER_EXTRA_MAX_PER_GROUP = 500;

export interface RosterExtraCharacter {
  id: string;
  name: string;
  /** Written look; empty when they were added from pictures. */
  look: string;
  /** Blob URLs, first one is the main picture. */
  pictureUrls: string[];
  /** Person / Animal / Object (2026-10-05). See `lib/castKind.ts`. */
  kind?: CastKind;
  /** @deprecated Prefer `kind: "animal"`. */
  isAnimal?: boolean;
  /** Ticked when added: made up, clearly adult (over 25), not a real person. */
  fictionalAdultConfirmed: true;
  createdAt: number;
  /**
   * Shorts only (2026-10-04, each Shorts episode has its own Cast, see
   * `lib/episodeCast.ts`): the episode this character was added to, by
   * its pinned media folder name (`ep03-backpackers`). Characters added
   * before then have none and belong to the older episodes (EP01, EP02).
   */
  episode?: string;
}

export type RosterExtrasState = Record<RosterExtraGroup, RosterExtraCharacter[]>;

const KEY_PREFIX: Record<RosterExtraGroup, string> = {
  "music-video": "mvx",
  "sunny-banks": "sbx",
  "adult-shorts": "asx",
};

/** The roster `sourceKey` of an added character that has its own tile. */
export function rosterExtraSourceKey(group: RosterExtraGroup, id: string): string {
  return `${KEY_PREFIX[group]}:${id}`;
}

export function isRosterExtraGroup(group: string): group is RosterExtraGroup {
  return (ROSTER_EXTRA_GROUPS as readonly string[]).includes(group);
}

export function emptyRosterExtrasState(): RosterExtrasState {
  return { "music-video": [], "sunny-banks": [], "adult-shorts": [] };
}

/** Only called after Stuart ticks made-up adult. */
export function buildRosterExtraCharacter(
  name: string,
  look: string,
  extra: { pictureUrls?: readonly string[]; kind?: CastKind; isAnimal?: boolean; episode?: string | null } = {},
  now: number = Date.now(),
  id = mintSkidmarksId("chr"),
): RosterExtraCharacter {
  const c: RosterExtraCharacter = {
    id,
    name: name.trim(),
    look: look.trim(),
    pictureUrls: cleanPictureUrls(extra.pictureUrls),
    fictionalAdultConfirmed: true,
    createdAt: now,
  };
  Object.assign(c, castKindPersist(castKindFrom({ kind: extra.kind, isAnimal: extra.isAnimal })));
  if (isSafeDeckMediaSlug(extra.episode)) c.episode = extra.episode;
  return c;
}

/** Adds pictures to an existing added character, keeping the cap. */
export function addPicturesToRosterExtra(
  c: RosterExtraCharacter,
  urls: readonly string[],
  kindOrAnimal: CastKind | boolean = false,
): RosterExtraCharacter {
  const kind =
    typeof kindOrAnimal === "boolean"
      ? castKindFrom({ kind: c.kind, isAnimal: kindOrAnimal || c.isAnimal })
      : kindOrAnimal;
  return {
    ...c,
    pictureUrls: cleanPictureUrls([...c.pictureUrls, ...urls]),
    ...castKindPersist(kind),
  };
}

function normalizeExtra(value: unknown): RosterExtraCharacter | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<RosterExtraCharacter>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (typeof v.name !== "string" || !v.name.trim()) return null;
  // Never load a character that wasn't confirmed made-up and adult.
  if (v.fictionalAdultConfirmed !== true) return null;
  return {
    id: v.id,
    name: v.name.trim(),
    look: typeof v.look === "string" ? v.look : "",
    pictureUrls: cleanPictureUrls(v.pictureUrls),
    ...castKindPersist(castKindFrom(v)),
    fictionalAdultConfirmed: true,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
    ...(isSafeDeckMediaSlug(v.episode) ? { episode: v.episode } : {}),
  };
}

export function normalizeRosterExtrasState(value: unknown): RosterExtrasState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Record<RosterExtraGroup, unknown>>;
  const out = emptyRosterExtrasState();
  for (const g of ROSTER_EXTRA_GROUPS) {
    const list = v[g];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    for (const item of list) {
      const c = normalizeExtra(item);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out[g].push(c);
      if (out[g].length >= ROSTER_EXTRA_MAX_PER_GROUP) break;
    }
  }
  return out;
}

export function rosterExtrasHaveUserContent(state: RosterExtrasState | null | undefined): boolean {
  return Boolean(state && ROSTER_EXTRA_GROUPS.some((g) => state[g].length > 0));
}
