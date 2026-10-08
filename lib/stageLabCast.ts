/**
 * Read-only Deliciae Cast + Locations for `/stage-lab`.
 *
 * GET `/api/skidmarks/session` and GET `/api/deck/items?kind=character|location`
 * only. Never the studio session writer, never a deck_items write, never
 * another genre's episode list.
 *
 * Hard-locked to the Shorts script episode whose folder is `deliciae`.
 * Other shorts / Skidmarks / Sunnybank cards are not enumerated, fetched,
 * or shown. Missing that folder → "Deliciae not found", no fallback.
 *
 * Cast main picture = the same one the Shorts Cast strip shows: LoRA
 * `referenceUrl`, else the extra's `pictureUrls[0]`, else first training
 * picture. Kind (Person / Animal / Object) does not skip the lookup.
 */

import { overlayCharacterItems } from "./characterItems";
import { emptyCharacterLorasState, type CharacterLoraEntry } from "./characterLoras";
import { castKindFrom } from "./castKind";
import type { DeckItemRecord } from "./deckItems";
import { overlayDeckItems } from "./deckItemSync";
import { LOCATION_ITEMS } from "./locationItems";
import type { DeckLocation } from "./deckLocations";
import { episodeOwnLocations, isInEpisode, type EpisodeScope } from "./episodeCast";
import {
  normalizeRosterExtrasState,
  rosterExtraSourceKey,
  type RosterExtraCharacter,
} from "./rosterExtras";
import { normalizeSkidmarksState, type SkidmarksState } from "./skidmarks";
import { shotCastNameKey } from "./shotCast";
import { buildSunnyBanksWorkspaceFromLive, type SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";
import type { StageCastMember, StageLocation } from "./stageLab";

/** Shorts media folder the lab is locked to. Not Good Boy, not a label match. */
export const DELICIAE_SHORTS_FOLDER = "deliciae";

export const DELICIAE_NOT_FOUND = "Deliciae not found";

export interface StageLabCastSnapshot {
  found: boolean;
  actors: StageCastMember[];
  locations: StageLocation[];
  source: "saved" | "empty" | "missing";
  error: string | null;
}

function itemsFromBody(body: unknown): { items: DeckItemRecord[]; deleted: string[] } {
  if (!body || typeof body !== "object") return { items: [], deleted: [] };
  const b = body as { items?: unknown; deleted?: unknown };
  const items = Array.isArray(b.items) ? (b.items as DeckItemRecord[]) : [];
  const deleted = Array.isArray(b.deleted)
    ? b.deleted
        .map((d) => (d && typeof d === "object" && typeof (d as { itemId?: unknown }).itemId === "string" ? (d as { itemId: string }).itemId : null))
        .filter((x): x is string => Boolean(x))
    : [];
  return { items, deleted };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  return res.json();
}

function overlayLocations(local: DeckLocation[], items: DeckItemRecord[], deleted: string[]): DeckLocation[] {
  return overlayDeckItems(LOCATION_ITEMS, local, items, deleted).entries;
}

function overlayCharacters(local: CharacterLoraEntry[], items: DeckItemRecord[], deleted: string[]): CharacterLoraEntry[] {
  return overlayCharacterItems(local, items, deleted).characters;
}

function toStageLocation(loc: DeckLocation): StageLocation {
  return {
    id: loc.id,
    key: loc.key,
    name: loc.name,
    pictureUrl: loc.pictureUrl,
    ...(loc.peopleInPicture ? { peopleInPicture: true as const } : {}),
  };
}

function stageLocationsFromList(list: readonly DeckLocation[]): StageLocation[] {
  const out: StageLocation[] = [];
  const seen = new Set<string>();
  for (const loc of list) {
    const key = loc.key || shotCastNameKey(loc.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toStageLocation(loc));
  }
  return out;
}

function isDeliciaeFolder(slug: string | null | undefined): boolean {
  return (slug ?? "").trim().toLowerCase() === DELICIAE_SHORTS_FOLDER;
}

export const DELICIAE_EPISODE_SCOPE: EpisodeScope = {
  episode: DELICIAE_SHORTS_FOLDER,
  legacy: false,
  tickedIds: [],
};

/** The Deliciae Shorts workspace card, or null. Never falls back to Good Boy or another show. */
export function findDeliciaeShortsWorkspace(state: SkidmarksState): SunnyBanksWorkspaceSnapshot | null {
  const studio = state.shortsStudio;
  if (!studio) return null;
  const card = (studio.workspaces ?? []).find((w) => isDeliciaeFolder(w.mediaSlug));
  if (card) return card;
  if (isDeliciaeFolder(studio.live?.mediaSlug)) {
    return { ...buildSunnyBanksWorkspaceFromLive(studio.live, 0, 0, "shorts"), mediaSlug: DELICIAE_SHORTS_FOLDER };
  }
  return null;
}

function shortsSourceKey(extraId: string): string {
  return rosterExtraSourceKey("adult-shorts", extraId);
}

function loraForExtra(cards: readonly CharacterLoraEntry[], extra: RosterExtraCharacter): CharacterLoraEntry | undefined {
  const sourceKey = shortsSourceKey(extra.id);
  return cards.find((c) => c.sourceKey === sourceKey) ?? cards.find((c) => c.id === extra.id);
}

function firstHttp(url: string | null | undefined): string | null {
  const u = typeof url === "string" ? url.trim() : "";
  return u && /^(https:|data:image\/|\/)/.test(u) ? u : null;
}

/**
 * Same main picture the Shorts Cast strip shows (`referenceUrl` on the
 * LoRA card, else the extra's first picture, else first training still).
 * Object / Animal / Person all use this path.
 */
export function stageCastMainPicture(
  extra: Pick<RosterExtraCharacter, "id" | "pictureUrls">,
  cards: readonly CharacterLoraEntry[],
): string | null {
  const card = loraForExtra(cards, extra as RosterExtraCharacter);
  return firstHttp(card?.referenceUrl) ?? firstHttp(extra.pictureUrls?.[0]) ?? firstHttp(card?.trainingImageUrls?.[0]) ?? null;
}

function voiceFor(cards: readonly CharacterLoraEntry[], extra: RosterExtraCharacter): string | null {
  const card = loraForExtra(cards, extra);
  return card?.voiceId ?? null;
}

export function extraToStageMember(extra: RosterExtraCharacter, cards: readonly CharacterLoraEntry[]): StageCastMember {
  return {
    id: shortsSourceKey(extra.id),
    name: extra.name,
    kind: castKindFrom(extra),
    pictureUrl: stageCastMainPicture(extra, cards),
    voiceId: voiceFor(cards, extra),
    look: extra.look,
    group: "shorts",
  };
}

function pushUnique(out: StageCastMember[], member: StageCastMember): void {
  const key = shotCastNameKey(member.name);
  if (!key) return;
  const existing = out.find((a) => shotCastNameKey(a.name) === key);
  if (existing) {
    if (!existing.pictureUrl && member.pictureUrl) existing.pictureUrl = member.pictureUrl;
    if (!existing.voiceId && member.voiceId) existing.voiceId = member.voiceId;
    if (!existing.look.trim() && member.look.trim()) existing.look = member.look;
    return;
  }
  out.push(member);
}

function deliciaeActors(state: SkidmarksState): StageCastMember[] {
  const cards = state.characterLoras?.characters ?? emptyCharacterLorasState().characters;
  const extras = normalizeRosterExtrasState(state.rosterExtras)?.["adult-shorts"] ?? [];
  const out: StageCastMember[] = [];
  for (const extra of extras) {
    if (!isInEpisode(extra, DELICIAE_EPISODE_SCOPE)) continue;
    pushUnique(out, extraToStageMember(extra, cards));
  }
  return out;
}

function deliciaeLocations(state: SkidmarksState): StageLocation[] {
  return stageLocationsFromList(episodeOwnLocations(state.locations, "adult-shorts", DELICIAE_EPISODE_SCOPE));
}

export function deliciaeStagePack(state: SkidmarksState): StageLabCastSnapshot {
  if (!findDeliciaeShortsWorkspace(state)) {
    return {
      found: false,
      actors: [],
      locations: [],
      source: "missing",
      error: DELICIAE_NOT_FOUND,
    };
  }
  const actors = deliciaeActors(state);
  const locations = deliciaeLocations(state);
  const hasReal =
    actors.length > 0 ||
    locations.length > 0 ||
    actors.some((a) => a.pictureUrl) ||
    locations.some((l) => l.pictureUrl);
  return {
    found: true,
    actors,
    locations,
    source: hasReal ? "saved" : "empty",
    error: null,
  };
}

/**
 * Load only Deliciae's Cast and Locations. Read-only: GET only, no session PUT.
 * Does not fetch shorts-episode / skidmarks-episode / sunnybank-episode /
 * adult-short item lists (those would enumerate other shows).
 */
export async function loadStageLabCast(): Promise<StageLabCastSnapshot> {
  try {
    const [sessionBody, characterBody, locationBody] = await Promise.all([
      getJson("/api/skidmarks/session"),
      getJson("/api/deck/items?kind=character").catch(() => null),
      getJson("/api/deck/items?kind=location").catch(() => null),
    ]);
    const session = sessionBody as { configured?: unknown; state?: unknown; error?: unknown };
    const base =
      session?.configured === true && session.state
        ? normalizeSkidmarksState(session.state)
        : normalizeSkidmarksState({});
    const charPack = itemsFromBody(characterBody);
    const locPack = itemsFromBody(locationBody);
    const characters = overlayCharacters(base.characterLoras?.characters ?? [], charPack.items, charPack.deleted);
    const locations = overlayLocations(base.locations?.locations ?? [], locPack.items, locPack.deleted);
    const state: SkidmarksState = {
      ...base,
      characterLoras: { characters },
      locations: { locations },
    };
    const pack = deliciaeStagePack(state);
    if (!pack.found) {
      return {
        ...pack,
        error:
          pack.error ??
          (typeof session?.error === "string" && session.configured !== true ? session.error : DELICIAE_NOT_FOUND),
      };
    }
    return pack;
  } catch (err) {
    return {
      found: false,
      actors: [],
      locations: [],
      source: "missing",
      error: err instanceof Error ? err.message : DELICIAE_NOT_FOUND,
    };
  }
}
