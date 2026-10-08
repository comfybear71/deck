/**
 * Read-only Cast + Locations for `/stage-lab`.
 *
 * GET `/api/skidmarks/session` and GET `/api/deck/items` only. Never
 * the studio session writer (that would also subscribe and PUT), never a
 * deck_items write. Pictures, names, looks, kinds, voice ids.
 */

import { overlayCharacterItems } from "./characterItems";
import { emptyCharacterLorasState, type CharacterLoraEntry } from "./characterLoras";
import { buildCharacterRoster, type RosterCharacter } from "./characterRoster";
import { castKindFrom, type CastKind } from "./castKind";
import type { DeckItemRecord } from "./deckItems";
import { overlayDeckItems } from "./deckItemSync";
import { LOCATION_ITEMS } from "./locationItems";
import { normalizeDeckLocationsState, type DeckLocation } from "./deckLocations";
import { normalizeRosterExtrasState, rosterExtraSourceKey, ROSTER_EXTRA_GROUPS } from "./rosterExtras";
import { normalizeSkidmarksState, type SkidmarksState } from "./skidmarks";
import { normalizeSkidmarksEpisodesState } from "./skidmarksEpisodes";
import { shotCastNameKey } from "./shotCast";
import type { StageCastMember, StageLocation } from "./stageLab";

export interface StageLabCastSnapshot {
  actors: StageCastMember[];
  locations: StageLocation[];
  source: "saved" | "empty";
  error: string | null;
}

function groupFromSourceKey(sourceKey: string): StageCastMember["group"] {
  const prefix = sourceKey.split(":")[0];
  if (prefix === "sb" || prefix === "sbx") return "sunnybank";
  if (prefix === "sk") return "skidmarks";
  if (prefix === "as" || prefix === "asx") return "shorts";
  return "music-video";
}

function kindFromRoster(char: RosterCharacter, state: SkidmarksState): CastKind {
  const sk = normalizeSkidmarksEpisodesState(state.skidmarksEpisodes);
  if (char.sourceKey.startsWith("sk:")) {
    const id = char.sourceKey.slice(3);
    const card = sk?.cast.find((c) => c.id === id);
    if (card) return castKindFrom(card);
  }
  const extras = normalizeRosterExtrasState(state.rosterExtras);
  for (const group of ROSTER_EXTRA_GROUPS) {
    for (const extra of extras?.[group] ?? []) {
      if (char.sourceKey === rosterExtraSourceKey(group, extra.id)) return castKindFrom(extra);
    }
  }
  if (char.subjectWord === "animal") return "animal";
  if (char.subjectWord === "object") return "object";
  return "person";
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  return res.json();
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

export function stageMembersFromState(state: SkidmarksState): StageCastMember[] {
  const roster = buildCharacterRoster(state, { everyEpisode: true });
  const cards = state.characterLoras?.characters ?? emptyCharacterLorasState().characters;
  const voiceByKey = new Map<string, string>();
  for (const card of cards) {
    if (card.sourceKey && card.voiceId) voiceByKey.set(card.sourceKey, card.voiceId);
    if (card.voiceId) voiceByKey.set(`id:${card.id}`, card.voiceId);
  }
  const sk = normalizeSkidmarksEpisodesState(state.skidmarksEpisodes);
  const pictureBySkId = new Map((sk?.cast ?? []).map((c) => [c.id, c.pictureUrls?.[0] ?? null]));

  const flat: RosterCharacter[] = [
    ...roster["music-video"],
    ...roster["sunny-banks"],
    ...roster.skidmarks,
    ...roster["adult-shorts"],
  ];
  const out: StageCastMember[] = [];
  const seen = new Set<string>();
  for (const char of flat) {
    const key = shotCastNameKey(char.name);
    if (!key || seen.has(key)) {
      if (key) {
        const existing = out.find((a) => shotCastNameKey(a.name) === key);
        if (existing && !existing.pictureUrl && char.thumbUrl) existing.pictureUrl = char.thumbUrl;
      }
      continue;
    }
    seen.add(key);
    const skId = char.sourceKey.startsWith("sk:") ? char.sourceKey.slice(3) : "";
    const picture = char.thumbUrl ?? (skId ? pictureBySkId.get(skId) ?? null : null);
    out.push({
      id: char.sourceKey,
      name: char.name,
      kind: kindFromRoster(char, state),
      pictureUrl: picture,
      voiceId: voiceByKey.get(char.sourceKey) ?? null,
      look: char.look,
      group: groupFromSourceKey(char.sourceKey),
    });
  }
  return out;
}

export function stageLocationsFromState(state: SkidmarksState): StageLocation[] {
  const list = normalizeDeckLocationsState(state.locations)?.locations ?? [];
  const out: StageLocation[] = [];
  const seen = new Set<string>();
  for (const loc of list) {
    const key = shotCastNameKey(loc.name) || loc.key;
    if (seen.has(key)) {
      const existing = out.find((l) => (shotCastNameKey(l.name) || l.key) === key);
      if (existing && !existing.pictureUrl && loc.pictureUrl) {
        existing.pictureUrl = loc.pictureUrl;
        if (loc.peopleInPicture) existing.peopleInPicture = true;
      }
      continue;
    }
    seen.add(key);
    out.push({
      id: loc.id,
      key: loc.key,
      name: loc.name,
      pictureUrl: loc.pictureUrl,
      ...(loc.peopleInPicture ? { peopleInPicture: true as const } : {}),
    });
  }
  return out;
}

function overlayLocations(local: DeckLocation[], items: DeckItemRecord[], deleted: string[]): DeckLocation[] {
  return overlayDeckItems(LOCATION_ITEMS, local, items, deleted).entries;
}

function overlayCharacters(local: CharacterLoraEntry[], items: DeckItemRecord[], deleted: string[]): CharacterLoraEntry[] {
  return overlayCharacterItems(local, items, deleted).characters;
}

/**
 * Load Stuart's saved Cast and Locations. Read-only: GET only, no session PUT.
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
    const actors = stageMembersFromState(state);
    const places = stageLocationsFromState(state);
    const hasReal = actors.some((a) => a.pictureUrl) || places.some((l) => l.pictureUrl) || actors.length > 0;
    return {
      actors,
      locations: places,
      source: hasReal ? "saved" : "empty",
      error: typeof session?.error === "string" && session.configured !== true ? session.error : null,
    };
  } catch (err) {
    return {
      actors: [],
      locations: [],
      source: "empty",
      error: err instanceof Error ? err.message : "Could not load saved Cast.",
    };
  }
}
