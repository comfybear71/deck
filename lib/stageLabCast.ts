/**
 * Read-only Cast + Locations for `/stage-lab`.
 *
 * GET `/api/skidmarks/session` and GET `/api/deck/items` only. Never
 * the studio session writer (that would also subscribe and PUT), never a
 * deck_items write.
 *
 * The lab shows ONE project's Cast and Locations strip — the same cards
 * that project already saved. Deliciae is a Shorts script episode
 * (`shortsStudio`, folder `deliciae`): Arthur, Dennis, Mira, Pip, House
 * and that episode's own places. It does not dump every show, and it
 * never seeds a droid.
 */

import { overlayCharacterItems } from "./characterItems";
import { emptyCharacterLorasState, type CharacterLoraEntry } from "./characterLoras";
import { ADULT_SHORT_ITEMS } from "./adultShortItems";
import { adultShortStarring, normalizeAdultShortsState, type AdultShortsState } from "./adultShorts";
import { castKindFrom } from "./castKind";
import type { DeckItemRecord } from "./deckItems";
import { overlayDeckItems } from "./deckItemSync";
import { LOCATION_ITEMS } from "./locationItems";
import { effectiveDeckLocations, type DeckLocation } from "./deckLocations";
import { episodeOwnLocations, isInEpisode, type EpisodeScope } from "./episodeCast";
import {
  normalizeRosterExtrasState,
  rosterExtraSourceKey,
  type RosterExtraCharacter,
} from "./rosterExtras";
import { SHORTS_EPISODE_ITEMS, SKIDMARKS_EPISODE_ITEMS } from "./skidmarksEpisodeItems";
import { normalizeSkidmarksState, type SkidmarksState } from "./skidmarks";
import { normalizeSkidmarksEpisodesState } from "./skidmarksEpisodes";
import {
  skidmarksEpisodeCast,
  skidmarksEpisodeLocations,
  skidmarksEpisodeScopeOf,
} from "./skidmarksEpisodeCast";
import { shortsStudioEpisodeScopeOf } from "./shortsEpisodeCast";
import { shotCastNameKey } from "./shotCast";
import { SUNNYBANK_EPISODE_ITEMS } from "./sunnybankEpisodeItems";
import { SUNNY_BANKS_CAST } from "./sunnyBanks";
import {
  liveFromSunnyBanksWorkspace,
  type SkidmarksSunnyBanksState,
  type SunnyBanksWorkspaceSnapshot,
} from "./sunnyBanksWorkspace";
import type { StageCastMember, StageLocation } from "./stageLab";
import type { StudioGenre } from "./studioGenre";

export type StageLabProjectGenre = StudioGenre;

export interface StageLabProject {
  id: string;
  label: string;
  genre: StageLabProjectGenre;
  mediaSlug: string | null;
}

export interface StageLabProjectPack {
  actors: StageCastMember[];
  locations: StageLocation[];
}

export interface StageLabCastSnapshot {
  actors: StageCastMember[];
  locations: StageLocation[];
  projects: StageLabProject[];
  defaultProjectId: string | null;
  byProject: Record<string, StageLabProjectPack>;
  source: "saved" | "empty";
  error: string | null;
}

/** Deliciae / the old Human Pet / Good Boy names. Prefer folder `deliciae`. */
export const DELICIAE_PROJECT_MATCH = /deliciae|human\s*pet|good\s*boy/i;

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

function overlayWorkspaces(
  local: SunnyBanksWorkspaceSnapshot[] | undefined,
  items: DeckItemRecord[],
  deleted: string[],
  config: typeof SHORTS_EPISODE_ITEMS,
): SunnyBanksWorkspaceSnapshot[] {
  return overlayDeckItems(config, local ?? [], items, deleted).entries;
}

function overlayStudio(
  local: SkidmarksSunnyBanksState | null | undefined,
  items: DeckItemRecord[],
  deleted: string[],
  config: typeof SHORTS_EPISODE_ITEMS,
): SkidmarksSunnyBanksState | null {
  const workspaces = overlayWorkspaces(local?.workspaces, items, deleted, config);
  if (!local) {
    if (workspaces.length === 0) return null;
    return { live: liveFromSunnyBanksWorkspace(workspaces[0]), workspaces, saveSeq: 0 };
  }
  return { ...local, workspaces };
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

function voiceFor(cards: readonly CharacterLoraEntry[], sourceKey: string, extraId?: string): string | null {
  const hit =
    cards.find((c) => c.sourceKey === sourceKey && c.voiceId) ??
    (extraId ? cards.find((c) => c.id === extraId && c.voiceId) : undefined);
  return hit?.voiceId ?? null;
}

function extraToMember(extra: RosterExtraCharacter, group: StageCastMember["group"], cards: readonly CharacterLoraEntry[]): StageCastMember {
  const sourceKey = rosterExtraSourceKey(group === "shorts" ? "adult-shorts" : group === "sunnybank" ? "sunny-banks" : "music-video", extra.id);
  return {
    id: sourceKey,
    name: extra.name,
    kind: castKindFrom(extra),
    pictureUrl: extra.pictureUrls[0] ?? null,
    voiceId: voiceFor(cards, sourceKey, extra.id),
    look: extra.look,
    group,
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

function shortsScopeFor(project: StageLabProject, state: SkidmarksState): EpisodeScope {
  const studio = state.shortsStudio;
  const card = studio?.workspaces.find((w) => w.id === project.id);
  if (!studio || !card) {
    return { episode: project.mediaSlug, legacy: false, tickedIds: [] };
  }
  return shortsStudioEpisodeScopeOf({ ...studio, live: liveFromSunnyBanksWorkspace(card) }, state.adultShorts);
}

function skidmarksScopeFor(project: StageLabProject, state: SkidmarksState): EpisodeScope {
  const studio = state.skidmarksStudio;
  const card = studio?.workspaces.find((w) => w.id === project.id);
  const live = card ? liveFromSunnyBanksWorkspace(card) : { workspaceTitle: project.label, mediaSlug: project.mediaSlug ?? undefined, episodeId: project.id };
  return skidmarksEpisodeScopeOf(live, studio?.workspaces ?? []);
}

function shortsActors(state: SkidmarksState, scope: EpisodeScope): StageCastMember[] {
  const cards = state.characterLoras?.characters ?? emptyCharacterLorasState().characters;
  const extras = normalizeRosterExtrasState(state.rosterExtras)?.["adult-shorts"] ?? [];
  const out: StageCastMember[] = [];
  for (const extra of extras) {
    if (!isInEpisode(extra, scope)) continue;
    pushUnique(out, extraToMember(extra, "shorts", cards));
  }
  const adult = normalizeAdultShortsState(state.adultShorts);
  if (adult?.ageConfirmed && scope.episode) {
    const folderOf = (id: string, mediaSlug?: string) => mediaSlug ?? (id === adult.currentSavedId ? adult.mediaSlug : undefined);
    for (const saved of adult.saved) {
      if (folderOf(saved.id, saved.mediaSlug) !== scope.episode) continue;
      for (const person of adultShortStarring(saved)) {
        const name = person.name?.trim();
        if (!name) continue;
        pushUnique(out, {
          id: `as:${shotCastNameKey(name)}`,
          name,
          kind: "person",
          pictureUrl: person.referenceUrls?.[0] ?? null,
          voiceId: null,
          look: person.look ?? "",
          group: "shorts",
        });
      }
    }
  }
  return out;
}

function skidmarksActors(state: SkidmarksState, scope: EpisodeScope): StageCastMember[] {
  const cards = state.characterLoras?.characters ?? emptyCharacterLorasState().characters;
  const cast = skidmarksEpisodeCast(normalizeSkidmarksEpisodesState(state.skidmarksEpisodes)?.cast ?? [], scope);
  const out: StageCastMember[] = [];
  for (const c of cast) {
    const sourceKey = `sk:${c.id}`;
    pushUnique(out, {
      id: sourceKey,
      name: c.name,
      kind: castKindFrom(c),
      pictureUrl: c.pictureUrls?.[0] ?? null,
      voiceId: voiceFor(cards, sourceKey, c.id),
      look: c.look,
      group: "skidmarks",
    });
  }
  return out;
}

function sunnybankActors(state: SkidmarksState): StageCastMember[] {
  const cards = state.characterLoras?.characters ?? emptyCharacterLorasState().characters;
  const extras = normalizeRosterExtrasState(state.rosterExtras)?.["sunny-banks"] ?? [];
  const out: StageCastMember[] = [];
  for (const lock of Object.values(SUNNY_BANKS_CAST)) {
    const name = lock.name.trim();
    const card = cards.find((c) => shotCastNameKey(c.name) === shotCastNameKey(name));
    pushUnique(out, {
      id: `sb:${shotCastNameKey(name)}`,
      name,
      kind: "person",
      pictureUrl: card?.referenceUrl ?? card?.trainingImageUrls?.[0] ?? null,
      voiceId: card?.voiceId ?? lock.voiceId ?? null,
      look: lock.look,
      group: "sunnybank",
    });
  }
  for (const extra of extras) {
    pushUnique(out, extraToMember(extra, "sunnybank", cards));
  }
  return out;
}

export function listStageLabProjects(state: SkidmarksState): StageLabProject[] {
  const out: StageLabProject[] = [];
  const seen = new Set<string>();
  const pushStudio = (studio: SkidmarksSunnyBanksState | null | undefined, genre: StageLabProjectGenre) => {
    for (const w of studio?.workspaces ?? []) {
      if (!w?.id || seen.has(w.id)) continue;
      seen.add(w.id);
      out.push({
        id: w.id,
        label: (w.label ?? "").trim() || "Untitled",
        genre,
        mediaSlug: w.mediaSlug ?? null,
      });
    }
  };
  pushStudio(state.shortsStudio, "shorts");
  pushStudio(state.skidmarksStudio, "skidmarks");
  pushStudio(state.sunnyBanks, "sunnybank");
  return out;
}

export function pickDefaultStageLabProject(projects: readonly StageLabProject[]): StageLabProject | null {
  const hits = projects.filter(
    (p) => DELICIAE_PROJECT_MATCH.test(p.label) || DELICIAE_PROJECT_MATCH.test(p.mediaSlug ?? ""),
  );
  const exact = hits.find((p) => (p.mediaSlug ?? "").toLowerCase() === "deliciae");
  if (exact) return exact;
  if (hits[0]) return hits[0];
  return projects[0] ?? null;
}

export function stagePackForProject(state: SkidmarksState, project: StageLabProject): StageLabProjectPack {
  if (project.genre === "shorts") {
    const scope = shortsScopeFor(project, state);
    return {
      actors: shortsActors(state, scope),
      locations: stageLocationsFromList(episodeOwnLocations(state.locations, "adult-shorts", scope)),
    };
  }
  if (project.genre === "skidmarks") {
    const scope = skidmarksScopeFor(project, state);
    return {
      actors: skidmarksActors(state, scope),
      locations: stageLocationsFromList(skidmarksEpisodeLocations(state.locations, scope)),
    };
  }
  return {
    actors: sunnybankActors(state),
    locations: stageLocationsFromList(effectiveDeckLocations(state.locations, "sunnybank")),
  };
}

export function stageLabFromState(state: SkidmarksState): Pick<StageLabCastSnapshot, "projects" | "defaultProjectId" | "byProject"> {
  const projects = listStageLabProjects(state);
  const byProject: Record<string, StageLabProjectPack> = {};
  for (const project of projects) {
    byProject[project.id] = stagePackForProject(state, project);
  }
  return {
    projects,
    defaultProjectId: pickDefaultStageLabProject(projects)?.id ?? null,
    byProject,
  };
}

export function projectChipLabel(project: StageLabProject, projects: readonly StageLabProject[]): string {
  const dup = projects.filter((p) => p.label === project.label).length > 1;
  if (dup && project.mediaSlug) return `${project.label} · ${project.mediaSlug}`;
  return project.label;
}

function overlayAdultShorts(local: AdultShortsState | null, items: DeckItemRecord[], deleted: string[]): AdultShortsState | null {
  if (!local && items.length === 0) return local;
  const saved = overlayDeckItems(ADULT_SHORT_ITEMS, local?.saved ?? [], items, deleted).entries;
  if (!local) return normalizeAdultShortsState({ saved, ageConfirmed: true });
  return { ...local, saved };
}

/**
 * Load Stuart's saved projects, then each project's own Cast and
 * Locations. Read-only: GET only, no session PUT.
 */
export async function loadStageLabCast(): Promise<StageLabCastSnapshot> {
  try {
    const [sessionBody, characterBody, locationBody, shortsEpBody, skidEpBody, sunnyEpBody, adultShortBody] = await Promise.all([
      getJson("/api/skidmarks/session"),
      getJson("/api/deck/items?kind=character").catch(() => null),
      getJson("/api/deck/items?kind=location").catch(() => null),
      getJson("/api/deck/items?kind=shorts-episode").catch(() => null),
      getJson("/api/deck/items?kind=skidmarks-episode").catch(() => null),
      getJson("/api/deck/items?kind=sunnybank-episode").catch(() => null),
      getJson("/api/deck/items?kind=adult-short").catch(() => null),
    ]);
    const session = sessionBody as { configured?: unknown; state?: unknown; error?: unknown };
    const base =
      session?.configured === true && session.state
        ? normalizeSkidmarksState(session.state)
        : normalizeSkidmarksState({});
    const charPack = itemsFromBody(characterBody);
    const locPack = itemsFromBody(locationBody);
    const shortsPack = itemsFromBody(shortsEpBody);
    const skidPack = itemsFromBody(skidEpBody);
    const sunnyPack = itemsFromBody(sunnyEpBody);
    const adultPack = itemsFromBody(adultShortBody);
    const characters = overlayCharacters(base.characterLoras?.characters ?? [], charPack.items, charPack.deleted);
    const locations = overlayLocations(base.locations?.locations ?? [], locPack.items, locPack.deleted);
    const state: SkidmarksState = {
      ...base,
      characterLoras: { characters },
      locations: { locations },
      shortsStudio: overlayStudio(base.shortsStudio, shortsPack.items, shortsPack.deleted, SHORTS_EPISODE_ITEMS),
      skidmarksStudio: overlayStudio(base.skidmarksStudio, skidPack.items, skidPack.deleted, SKIDMARKS_EPISODE_ITEMS),
      sunnyBanks: overlayStudio(base.sunnyBanks, sunnyPack.items, sunnyPack.deleted, SUNNYBANK_EPISODE_ITEMS),
      adultShorts: overlayAdultShorts(base.adultShorts ?? null, adultPack.items, adultPack.deleted),
    };
    const { projects, defaultProjectId, byProject } = stageLabFromState(state);
    const pack = (defaultProjectId && byProject[defaultProjectId]) || { actors: [], locations: [] };
    const hasReal =
      pack.actors.length > 0 ||
      pack.locations.length > 0 ||
      pack.actors.some((a) => a.pictureUrl) ||
      pack.locations.some((l) => l.pictureUrl);
    return {
      actors: pack.actors,
      locations: pack.locations,
      projects,
      defaultProjectId,
      byProject,
      source: hasReal ? "saved" : "empty",
      error: typeof session?.error === "string" && session.configured !== true ? session.error : null,
    };
  } catch (err) {
    return {
      actors: [],
      locations: [],
      projects: [],
      defaultProjectId: null,
      byProject: {},
      source: "empty",
      error: err instanceof Error ? err.message : "Could not load saved Cast.",
    };
  }
}
