/**
 * Sunny Banks live episode + named workspace snapshots.
 *
 * Not a Neon episode/beat table — one JSON blob on the existing
 * Skidmarks session row (`lib/skidmarks.ts`). Scripts, location ids,
 * and finished clip URLs only; never inline image bytes.
 *
 * Save upserts one card per episode name covering **every** act, not
 * one card per Act pill. The live working copy is stored beside the
 * shelf so a refresh (or closing the sheet) does not reseeds EP02 and
 * drop Act III / extra Holds. ✕ drops that named card only.
 *
 * Stable ids (2026-09-30, per-item saving for episodes): a saved card's
 * `id` never changes once minted, and the live copy remembers which card
 * it came from (`episodeId`), so saving after a rename updates that same
 * card instead of minting a second one. Each episode also pins its media
 * folder name (`mediaSlug`, `deck/sunnybank/episodes/<mediaSlug>/`) the
 * first time it needs one, so a rename never moves where new clips go.
 * Neither field is part of the fingerprint, so older cards still read as
 * "saved" exactly as before.
 */
import { isValidDeckLocationKey } from "./deckLocations";
import {
  getSunnyBanksLocation,
  SUNNY_BANKS_DEFAULT_LOCATION_ID,
  type SunnyBanksLocationId,
} from "./sunnyBanks";
import { buildSunnyBanksDropBearsSeed, DROP_BEARS_TITLE } from "./sunnyBanksDropBears";
import { studioGenreProfile, type PlateEngine, type StudioGenre } from "./studioGenre";
import { deckMediaSlug, isSafeDeckMediaSlug, uniqueDeckMediaSlug } from "./deckMediaPaths";
import { parseRowVideoBackend, type RowVideoBackend, type SilentShotBackend } from "./videoBackendRouting";

export const SUNNY_BANKS_INITIAL_ACTS = ["I", "II", "III"] as const;

export type SunnyBanksActId = string;
export type SunnyBanksRowStatus = "idle" | "rendering" | "done" | "failed";

export type SunnyBanksActKeyed<T> = Record<SunnyBanksActId, T>;

export interface SunnyBanksRowRuntime {
  lineKey: string;
  status: SunnyBanksRowStatus;
  videoUrl?: string;
  durationSec?: number;
  error?: string;
  audioMuxed?: boolean;
  characterName?: string;
  line?: string;
  /** The engine that made this clip (2026-09-30). Missing on clips made
   * before then, which were all LTX. */
  videoBackend?: RowVideoBackend;
  /** A multi-cast shot's shared picture (2026-10-03): Deck Blob https
   * only. Kept even when the video failed, so a retry (and the scene's
   * other lines) reuse it instead of paying xAI again. */
  plateUrl?: string;
  /** Who was in that shot ("Stuie", "Bloom"), for the row's chips. A
   * one-person row's own plate (made with "Make plate", 2026-10-04) keeps
   * its one name, so a plate is only reused for the same person. */
  castNames?: string[];
  /** A Siray silent shot still rendering (2026-10-04, Shorts): checked
   * back on instead of submitted (and paid for) again. */
  sirayTaskId?: string;
  /** Closing frame of this clip (Blob URL). Used when Chain last→first
   * is on so the next empty / already-chained start can follow. */
  lastFrameUrl?: string;
  /** How this row's `plateUrl` got there. `chained` may be refreshed by
   * the next last-frame fill; `generated` (Make plate) is locked. */
  plateSource?: "chained" | "generated";
  /**
   * Per-row **Chain from shot N** (PR #258+, replacing the old global
   * bottom toggle — see `lib/chainLastFrame.ts`'s module doc comment).
   * Default off/unset. When true, this row's own `plateUrl`/`plateSource`
   * are left completely untouched in storage — the render path resolves
   * the row's *effective* starting plate at render/preview time via
   * `lib/chainLastFrame.ts`'s `resolveRowStartPlateUrl`, so turning this
   * back off instantly reverts to whatever was already saved here,
   * nothing to restore. Never set on row 0 (no previous shot to chain
   * from). */
  chainFromPrevious?: boolean;
}

export interface SunnyBanksLiveState {
  workspaceTitle: string;
  defaultLocationId: SunnyBanksLocationId;
  actIds: SunnyBanksActId[];
  activeAct: SunnyBanksActId;
  actScripts: SunnyBanksActKeyed<string>;
  characterOverrides: SunnyBanksActKeyed<Record<number, string>>;
  locationOverrides: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>>;
  /** For a row whose script has a `[Location: …]` tag, the tag that was
   * in force when its location dropdown was picked (2026-10-01). The
   * saved pick only counts while the row still has that same tag;
   * missing (every row saved before this) means the tag wins. */
  locationPickTags?: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: SunnyBanksActKeyed<Record<number, SunnyBanksRowRuntime>>;
  /** The saved card this live copy was opened from or last saved as. */
  episodeId?: string;
  /** Pinned media folder name, see `lib/deckMediaPaths.ts`. */
  mediaSlug?: string;
  /** Skidmarks only: the old Cast cards ticked "In this episode" (PR 242,
   * 2026-10-04 morning). The ticks are gone (each Skidmarks episode now has
   * its own Cast, `lib/skidmarksEpisodeCast.ts`); this is kept, never
   * edited, so an episode saved with ticks keeps those old cards. Missing
   * = nobody ticked (every Sunny Banks episode), and then it isn't part
   * of the fingerprint. */
  castIds?: string[];
  /**
   * **Legacy, no longer settable from any UI (PR #258+).** Used to be
   * this panel's own global "Chain last→first" bottom toggle — replaced
   * by a per-row `SunnyBanksRowRuntime.chainFromPrevious`, shown next to
   * that *specific* row's own Render this (Stuart's own complaint about
   * the old global switch: "it will not know what to chain?"). Kept on
   * this type only so an episode saved before this change still
   * normalizes cleanly; nothing reads it for render behavior anymore.
   */
  chainLastFrameToNext?: boolean;
}

export interface SunnyBanksWorkspaceSnapshot {
  id: string;
  savedAt: number;
  fingerprint: string;
  label: string;
  defaultLocationId: SunnyBanksLocationId;
  actIds: SunnyBanksActId[];
  activeAct: SunnyBanksActId;
  actScripts: SunnyBanksActKeyed<string>;
  characterOverrides: SunnyBanksActKeyed<Record<number, string>>;
  locationOverrides: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>>;
  /** See `SunnyBanksLiveState.locationPickTags`. */
  locationPickTags?: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: SunnyBanksActKeyed<Record<number, SunnyBanksRowRuntime>>;
  /** Pinned media folder name (`deck/sunnybank/episodes/<mediaSlug>/`).
   * Set once, never re-derived from the label. Missing on older cards. */
  mediaSlug?: string;
  /** See `SunnyBanksLiveState.castIds`. */
  castIds?: string[];
  /** Legacy — see `SunnyBanksLiveState.chainLastFrameToNext`'s doc comment. */
  chainLastFrameToNext?: boolean;
}

export interface SkidmarksSunnyBanksState {
  live: SunnyBanksLiveState;
  workspaces: SunnyBanksWorkspaceSnapshot[];
  saveSeq: number;
  /** The Grok/H3 switch for silent rows (2026-09-30), saved with the
   * session like Music video's per-clip engine. Missing means Grok. Not
   * part of any episode, so flipping it never re-saves a card. */
  silentShotBackend?: SilentShotBackend;
  /** The plate engine switch (2026-10-04): Shorts offers Siray (its
   * default) or Grok (`studioPlateEngine`). Missing means the show's
   * default. Not part of any episode, like `silentShotBackend`. */
  plateEngine?: PlateEngine;
}

export function cloneActRecord<T>(value: SunnyBanksActKeyed<T>, actIds?: readonly string[]): SunnyBanksActKeyed<T> {
  const keys = actIds ?? Object.keys(value);
  const next: SunnyBanksActKeyed<T> = {};
  for (const act of keys) {
    if (act in value) next[act] = structuredClone(value[act]);
  }
  return next;
}

/**
 * `locationPickTags` with empty acts dropped, or `undefined` when no row
 * has one. Kept off the object entirely when empty so an episode with
 * no such picks fingerprints exactly as it did before the field existed.
 */
export function compactLocationPickTags(
  value: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>> | undefined,
  actIds: readonly string[]
): SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>> | undefined {
  if (!value) return undefined;
  const next: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>> = {};
  for (const act of actIds) {
    const row = value[act];
    if (row && Object.keys(row).length > 0) next[act] = { ...row };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function cloneSunnyBanksLive(live: SunnyBanksLiveState): SunnyBanksLiveState {
  const next: SunnyBanksLiveState = {
    workspaceTitle: live.workspaceTitle,
    defaultLocationId: live.defaultLocationId,
    actIds: [...live.actIds],
    activeAct: live.activeAct,
    actScripts: cloneActRecord(live.actScripts, live.actIds),
    characterOverrides: cloneActRecord(live.characterOverrides, live.actIds),
    locationOverrides: cloneActRecord(live.locationOverrides, live.actIds),
    runtimeMap: cloneActRecord(live.runtimeMap, live.actIds),
  };
  const pickTags = compactLocationPickTags(live.locationPickTags, live.actIds);
  if (pickTags) next.locationPickTags = pickTags;
  if (live.episodeId) next.episodeId = live.episodeId;
  if (live.mediaSlug) next.mediaSlug = live.mediaSlug;
  if (live.castIds && live.castIds.length > 0) next.castIds = [...live.castIds];
  if (live.chainLastFrameToNext === true) next.chainLastFrameToNext = true;
  return next;
}

export function liveFromSunnyBanksWorkspace(workspace: SunnyBanksWorkspaceSnapshot): SunnyBanksLiveState {
  return cloneSunnyBanksLive({
    workspaceTitle: workspace.label,
    defaultLocationId: workspace.defaultLocationId,
    actIds: workspace.actIds,
    activeAct: workspace.activeAct,
    actScripts: workspace.actScripts,
    characterOverrides: workspace.characterOverrides,
    locationOverrides: workspace.locationOverrides,
    locationPickTags: workspace.locationPickTags,
    runtimeMap: workspace.runtimeMap,
    episodeId: workspace.id,
    mediaSlug: workspace.mediaSlug,
    castIds: workspace.castIds,
    ...(workspace.chainLastFrameToNext === true ? { chainLastFrameToNext: true } : {}),
  });
}

export function buildDefaultSunnyBanksLive(): SunnyBanksLiveState {
  const seed = buildSunnyBanksDropBearsSeed();
  const actIds = [...SUNNY_BANKS_INITIAL_ACTS];
  return {
    workspaceTitle: DROP_BEARS_TITLE,
    defaultLocationId: seed.defaultLocationId,
    actIds,
    activeAct: "I",
    actScripts: { ...seed.actScripts },
    characterOverrides: { I: {}, II: {}, III: {} },
    // No saved row locations: the seed's scripts carry `[Location: …]` lines.
    locationOverrides: { I: {}, II: {}, III: {} },
    runtimeMap: cloneActRecord(seed.runtimeMap as SunnyBanksLiveState["runtimeMap"], actIds),
  };
}

/**
 * A genuinely blank episode — what **New Episode** starts from
 * (2026-09-18). Live QA: "how do I create a new episode? I want to
 * create new and then it clears everything, all the old stuff on the
 * workspace should be saved." There was no such control at all; the
 * panel could save, download, open and delete an episode, but never
 * begin one.
 *
 * Deliberately **not** `buildDefaultSunnyBanksLive()` — that is the
 * Crash Lab EP02 demo seed, which is the opposite of blank. Same three
 * starting acts, nothing in them.
 *
 * The empty title is intentional: the card's name falls back to the
 * script's first line (`buildSunnyBanksWorkspaceFromLive`), so a new
 * episode gets a sensible name once it has lines, and a `# EPISODE:`
 * header in the script renames it.
 */
export function buildEmptySunnyBanksLive(genre: StudioGenre = "sunnybank"): SunnyBanksLiveState {
  const actIds = [...SUNNY_BANKS_INITIAL_ACTS];
  const blank = <T,>(value: () => T): SunnyBanksActKeyed<T> =>
    Object.fromEntries(actIds.map((act) => [act, value()])) as SunnyBanksActKeyed<T>;
  return {
    workspaceTitle: "",
    // Skidmarks has no built-in place: its first location comes from the
    // Locations row (or the script's [Location: …]).
    defaultLocationId: genre === "sunnybank" ? SUNNY_BANKS_DEFAULT_LOCATION_ID : "",
    actIds,
    activeAct: actIds[0],
    actScripts: blank(() => ""),
    characterOverrides: blank(() => ({})),
    locationOverrides: blank(() => ({})),
    runtimeMap: blank(() => ({})),
  };
}

/**
 * Is the live working copy already captured by one of the saved cards?
 *
 * Compares against the fingerprint each snapshot stored, which
 * `buildSunnyBanksWorkspaceFromLive` computes over the whole live
 * state — scripts, overrides, clip URLs **and the episode title**. So a
 * rename alone reads as unsaved, which is the honest answer: the saved
 * card really does still carry the old name.
 *
 * Used to warn before **New Episode** throws the live copy away. False
 * means there is work on screen that no saved card holds, and this errs
 * toward saying so — a spurious "not saved yet" costs one extra tap on
 * Save, while a wrong "already saved" costs the work.
 */
export function isSunnyBanksLiveSaved(
  live: SunnyBanksLiveState,
  workspaces: readonly SunnyBanksWorkspaceSnapshot[]
): boolean {
  const liveFingerprint = fingerprintWorkspace(live);
  return workspaces.some((workspace) => workspace.fingerprint === liveFingerprint);
}

/** djb2 of the snapshot payload — same scripts + same clip URLs hash
 * the same. Used as part of the workspace id and to tell seed-equal
 * live apart from real user work. `episodeId` and `mediaSlug` are
 * bookkeeping, not content, and are left out so every fingerprint
 * stored before they existed still matches. */
export function fingerprintWorkspace(snapshot: {
  defaultLocationId: string;
  actIds: readonly string[];
  activeAct: string;
  actScripts: SunnyBanksActKeyed<string>;
  characterOverrides: SunnyBanksActKeyed<Record<number, string>>;
  locationOverrides: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>>;
  locationPickTags?: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: SunnyBanksActKeyed<Record<number, SunnyBanksRowRuntime>>;
  episodeId?: string;
  mediaSlug?: string;
  castIds?: readonly string[];
  chainLastFrameToNext?: boolean;
}): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { episodeId, mediaSlug, locationPickTags, castIds, chainLastFrameToNext, ...content } = snapshot;
  // Empty or missing pick tags hash the same as before the field existed,
  // and always in the same place, however the object was built. Same
  // for the episode's ticked cast (2026-10-04): none ticked = as before.
  const pickTags = compactLocationPickTags(locationPickTags, snapshot.actIds);
  const withPicks = pickTags ? { ...content, locationPickTags: pickTags } : content;
  const payload = JSON.stringify(castIds && castIds.length > 0 ? { ...withPicks, castIds: [...castIds] } : withPicks);
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 33) ^ payload.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function mintWorkspaceId(savedAt: number, seq: number, fingerprint: string): string {
  return `ws-${savedAt}-${seq}-${fingerprint}`;
}

export function countSunnyBanksDoneClips(runtimeMap: SunnyBanksActKeyed<Record<number, SunnyBanksRowRuntime>>, actIds: readonly string[]): number {
  let count = 0;
  for (const act of actIds) {
    for (const row of Object.values(runtimeMap[act] ?? {})) {
      if (row.status === "done" && typeof row.videoUrl === "string" && row.videoUrl.length > 0) {
        count += 1;
      }
    }
  }
  return count;
}

/** Shelf subtitle — whole episode, never "Act II" alone. */
export function describeSunnyBanksWorkspace(workspace: Pick<SunnyBanksWorkspaceSnapshot, "actIds" | "runtimeMap">): string {
  const actCount = workspace.actIds.length;
  const clipCount = countSunnyBanksDoneClips(workspace.runtimeMap, workspace.actIds);
  const acts = actCount === 1 ? "1 act" : `${actCount} acts`;
  const clips = clipCount === 1 ? "1 clip" : `${clipCount} clips`;
  return `${acts} · ${clips}`;
}

/**
 * Saves `snapshot` onto the shelf. The card it replaces is, in order:
 * the one with id `episodeId` (the card the live copy was opened from or
 * last saved as, so a rename updates it), else the one with the same
 * name (the old behaviour), else none (a new card). A replaced card keeps
 * its `id` and its pinned `mediaSlug`, so neither ever changes. A card
 * with no `mediaSlug` yet gets one: `preferredMediaSlug` if given (the
 * live copy may already have filed clips under it), else from the name,
 * never one another card already uses.
 */
export function upsertSunnyBanksWorkspace(
  workspaces: readonly SunnyBanksWorkspaceSnapshot[],
  snapshot: SunnyBanksWorkspaceSnapshot,
  episodeId?: string | null,
  preferredMediaSlug?: string | null
): SunnyBanksWorkspaceSnapshot[] {
  const key = snapshot.label.trim().toLowerCase();
  let index = episodeId ? workspaces.findIndex((workspace) => workspace.id === episodeId) : -1;
  if (index < 0) index = workspaces.findIndex((workspace) => workspace.label.trim().toLowerCase() === key);
  const others = index < 0 ? workspaces : workspaces.filter((_, i) => i !== index);
  const replaced = index < 0 ? null : workspaces[index];
  const mediaSlug =
    replaced?.mediaSlug ||
    pickSunnyBanksEpisodeMediaSlug(
      preferredMediaSlug || snapshot.mediaSlug || snapshot.label,
      others.map((workspace) => workspace.mediaSlug)
    );
  const updated: SunnyBanksWorkspaceSnapshot = { ...snapshot, id: replaced?.id ?? snapshot.id, mediaSlug };
  return [updated, ...others];
}

/**
 * A media folder name for an episode: `text` as a slug (`deckMediaSlug`,
 * so "The Big Wet" → `the-big-wet`), made unique against `taken`
 * (`the-big-wet-2`…). Used once per episode; the result is pinned.
 */
export function pickSunnyBanksEpisodeMediaSlug(text: string, taken: Iterable<string | undefined | null>): string {
  const used: string[] = [];
  for (const slug of taken) if (slug) used.push(slug);
  return uniqueDeckMediaSlug(deckMediaSlug(text, "episode"), used);
}

/**
 * A saved location key as it is (2026-09-30): a built-in, one saved on
 * the Locations row, or one that isn't on the row yet. It used to become
 * the default (the storefront) whenever it wasn't one of the six
 * built-ins, which is how EP01's Park Site 4 rows ended up rendered at
 * the shop. Only a malformed value falls back.
 */
function normalizeLocationId(value: unknown, fallback: SunnyBanksLocationId): SunnyBanksLocationId {
  return safeLocationKey(value) ?? fallback;
}

function safeLocationKey(value: unknown): SunnyBanksLocationId | null {
  if (typeof value !== "string") return null;
  const builtIn = getSunnyBanksLocation(value);
  if (builtIn) return builtIn.id;
  return isValidDeckLocationKey(value) ? value : null;
}

function normalizeRowRuntime(value: unknown): SunnyBanksRowRuntime | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SunnyBanksRowRuntime>;
  if (typeof v.lineKey !== "string") return null;
  const rawStatus = v.status;
  const status: SunnyBanksRowStatus =
    rawStatus === "done" || rawStatus === "failed" || rawStatus === "idle" || rawStatus === "rendering"
      ? rawStatus === "rendering"
        ? "idle"
        : rawStatus
      : "idle";
  const row: SunnyBanksRowRuntime = { lineKey: v.lineKey, status };
  if (typeof v.videoUrl === "string" && v.videoUrl.length > 0) row.videoUrl = v.videoUrl;
  if (typeof v.durationSec === "number") row.durationSec = v.durationSec;
  if (typeof v.error === "string") row.error = v.error;
  if (typeof v.audioMuxed === "boolean") row.audioMuxed = v.audioMuxed;
  if (typeof v.characterName === "string") row.characterName = v.characterName;
  if (typeof v.line === "string") row.line = v.line;
  const videoBackend = parseRowVideoBackend(v.videoBackend);
  if (videoBackend) row.videoBackend = videoBackend;
  if (typeof v.plateUrl === "string" && /^https:\/\/[^\s]+$/i.test(v.plateUrl) && v.plateUrl.length <= 1000) {
    row.plateUrl = v.plateUrl;
  }
  if (Array.isArray(v.castNames)) {
    const names = v.castNames
      .filter((n): n is string => typeof n === "string")
      .map((n) => n.replace(/\s+/g, " ").trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 4);
    if (names.length > 1 || (names.length === 1 && row.plateUrl)) row.castNames = names;
  }
  if (typeof v.sirayTaskId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v.sirayTaskId)) row.sirayTaskId = v.sirayTaskId;
  if (typeof v.lastFrameUrl === "string" && /^https:\/\/[^\s]+$/i.test(v.lastFrameUrl) && v.lastFrameUrl.length <= 1000) {
    row.lastFrameUrl = v.lastFrameUrl;
  }
  if (v.plateSource === "chained" || v.plateSource === "generated") row.plateSource = v.plateSource;
  if (v.chainFromPrevious === true) row.chainFromPrevious = true;
  return row;
}

function normalizeRuntimeMap(value: unknown): Record<number, SunnyBanksRowRuntime> {
  if (!value || typeof value !== "object") return {};
  const next: Record<number, SunnyBanksRowRuntime> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    const row = normalizeRowRuntime(raw);
    if (row) next[index] = row;
  }
  return next;
}

function normalizeStringMap(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object") return {};
  const next: Record<number, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    if (typeof raw === "string" && raw.length > 0) next[index] = raw;
  }
  return next;
}

function normalizeLocationMap(value: unknown, fallback: SunnyBanksLocationId): Record<number, SunnyBanksLocationId> {
  if (!value || typeof value !== "object") return {};
  const next: Record<number, SunnyBanksLocationId> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    const located = safeLocationKey(raw);
    if (located) next[index] = located;
    else if (typeof raw === "string") next[index] = fallback;
  }
  return next;
}

/** A row → location key map, dropping anything malformed (no fallback). */
function normalizeLocationKeyMap(value: unknown): Record<number, SunnyBanksLocationId> {
  if (!value || typeof value !== "object") return {};
  const next: Record<number, SunnyBanksLocationId> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    const located = safeLocationKey(raw);
    if (located) next[index] = located;
  }
  return next;
}

function normalizeActScripts(value: unknown, actIds: readonly string[]): SunnyBanksActKeyed<string> {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const next: SunnyBanksActKeyed<string> = {};
  for (const act of actIds) {
    next[act] = typeof raw[act] === "string" ? raw[act] : "";
  }
  return next;
}

/** Up to 40 distinct non-empty ids, or `undefined` when there are none. */
function normalizeCastIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !id.trim() || id.length > 120 || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= 40) break;
  }
  return ids.length > 0 ? ids : undefined;
}

/**
 * `genre` (2026-10-04) only decides what a missing field falls back to:
 * Sunny Banks' EP02 Drop Bears seed, or a blank Skidmarks page.
 */
export function normalizeSunnyBanksLive(value: unknown, genre: StudioGenre = "sunnybank"): SunnyBanksLiveState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SunnyBanksLiveState>;
  const fallback = genre === "sunnybank" ? buildDefaultSunnyBanksLive() : buildEmptySunnyBanksLive(genre);
  const actIds = Array.isArray(v.actIds)
    ? v.actIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const ids = actIds.length > 0 ? actIds : fallback.actIds;
  const defaultLocationId = normalizeLocationId(v.defaultLocationId, fallback.defaultLocationId);
  const activeAct =
    typeof v.activeAct === "string" && ids.includes(v.activeAct) ? v.activeAct : ids[0] ?? fallback.activeAct;
  const characterRaw = v.characterOverrides && typeof v.characterOverrides === "object" ? v.characterOverrides : {};
  const locationRaw = v.locationOverrides && typeof v.locationOverrides === "object" ? v.locationOverrides : {};
  const runtimeRaw = v.runtimeMap && typeof v.runtimeMap === "object" ? v.runtimeMap : {};
  const pickTagsRaw = v.locationPickTags && typeof v.locationPickTags === "object" ? v.locationPickTags : {};
  const locationPickTags: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>> = {};
  const characterOverrides: SunnyBanksLiveState["characterOverrides"] = {};
  const locationOverrides: SunnyBanksLiveState["locationOverrides"] = {};
  const runtimeMap: SunnyBanksLiveState["runtimeMap"] = {};
  for (const act of ids) {
    characterOverrides[act] = normalizeStringMap((characterRaw as Record<string, unknown>)[act]);
    locationOverrides[act] = normalizeLocationMap((locationRaw as Record<string, unknown>)[act], defaultLocationId);
    runtimeMap[act] = normalizeRuntimeMap((runtimeRaw as Record<string, unknown>)[act]);
    locationPickTags[act] = normalizeLocationKeyMap((pickTagsRaw as Record<string, unknown>)[act]);
  }
  const live: SunnyBanksLiveState = {
    workspaceTitle: typeof v.workspaceTitle === "string" ? v.workspaceTitle : fallback.workspaceTitle,
    defaultLocationId,
    actIds: [...ids],
    activeAct,
    actScripts: normalizeActScripts(v.actScripts, ids),
    characterOverrides,
    locationOverrides,
    runtimeMap,
  };
  const pickTags = compactLocationPickTags(locationPickTags, ids);
  if (pickTags) live.locationPickTags = pickTags;
  if (typeof v.episodeId === "string" && v.episodeId.length > 0) live.episodeId = v.episodeId;
  if (isSafeDeckMediaSlug(v.mediaSlug)) live.mediaSlug = v.mediaSlug;
  const castIds = normalizeCastIds(v.castIds);
  if (castIds) live.castIds = castIds;
  if (v.chainLastFrameToNext === true) live.chainLastFrameToNext = true;
  return live;
}

export function normalizeSunnyBanksWorkspace(
  value: unknown,
  genre: StudioGenre = "sunnybank"
): SunnyBanksWorkspaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SunnyBanksWorkspaceSnapshot>;
  const live = normalizeSunnyBanksLive(v, genre);
  if (!live) return null;
  if (typeof v.id !== "string" || v.id.length === 0) return null;
  if (typeof v.savedAt !== "number") return null;
  const fingerprint = typeof v.fingerprint === "string" && v.fingerprint.length > 0 ? v.fingerprint : fingerprintWorkspace(live);
  const label = typeof v.label === "string" && v.label.trim().length > 0 ? v.label : live.workspaceTitle;
  const workspace: SunnyBanksWorkspaceSnapshot = {
    id: v.id,
    savedAt: v.savedAt,
    fingerprint,
    label,
    defaultLocationId: live.defaultLocationId,
    actIds: live.actIds,
    activeAct: live.activeAct,
    actScripts: live.actScripts,
    characterOverrides: live.characterOverrides,
    locationOverrides: live.locationOverrides,
    runtimeMap: live.runtimeMap,
  };
  if (live.locationPickTags) workspace.locationPickTags = live.locationPickTags;
  if (live.mediaSlug) workspace.mediaSlug = live.mediaSlug;
  if (live.castIds) workspace.castIds = live.castIds;
  return workspace;
}

export function normalizeSunnyBanksStudio(
  value: unknown,
  genre: StudioGenre = "sunnybank"
): SkidmarksSunnyBanksState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SkidmarksSunnyBanksState>;
  const live = normalizeSunnyBanksLive(v.live, genre);
  if (!live) return null;
  const workspaces = Array.isArray(v.workspaces)
    ? v.workspaces
        .map((row) => normalizeSunnyBanksWorkspace(row, genre))
        .filter((row): row is SunnyBanksWorkspaceSnapshot => row !== null)
    : [];
  const saveSeq = typeof v.saveSeq === "number" && v.saveSeq >= 0 ? Math.floor(v.saveSeq) : workspaces.length;
  const studio: SkidmarksSunnyBanksState = { live, workspaces, saveSeq };
  if (v.silentShotBackend === "grok" || v.silentShotBackend === "h3" || v.silentShotBackend === "siray") {
    studio.silentShotBackend = v.silentShotBackend;
  }
  if (v.plateEngine === "grok" || v.plateEngine === "siray") studio.plateEngine = v.plateEngine;
  return studio;
}

export function buildSunnyBanksWorkspaceFromLive(
  live: SunnyBanksLiveState,
  savedAt: number,
  seq: number,
  genre: StudioGenre = "sunnybank"
): SunnyBanksWorkspaceSnapshot {
  const cloned = cloneSunnyBanksLive(live);
  const fingerprint = fingerprintWorkspace(cloned);
  let label = cloned.workspaceTitle.trim();
  if (!label) {
    for (const act of cloned.actIds) {
      const first = (cloned.actScripts[act] ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (first) {
        label = first.length > 36 ? `${first.slice(0, 33)}…` : first;
        break;
      }
    }
  }
  if (!label) label = `${studioGenreProfile(genre).showName} episode`;
  const snapshot: SunnyBanksWorkspaceSnapshot = {
    id: mintWorkspaceId(savedAt, seq, fingerprint),
    savedAt,
    fingerprint,
    label,
    defaultLocationId: cloned.defaultLocationId,
    actIds: cloned.actIds,
    activeAct: cloned.activeAct,
    actScripts: cloned.actScripts,
    characterOverrides: cloned.characterOverrides,
    locationOverrides: cloned.locationOverrides,
    runtimeMap: cloned.runtimeMap,
  };
  if (cloned.locationPickTags) snapshot.locationPickTags = cloned.locationPickTags;
  if (cloned.mediaSlug) snapshot.mediaSlug = cloned.mediaSlug;
  if (cloned.castIds) snapshot.castIds = cloned.castIds;
  if (cloned.chainLastFrameToNext === true) snapshot.chainLastFrameToNext = true;
  return snapshot;
}

let defaultLiveFingerprint: string | null = null;

export function defaultSunnyBanksLiveFingerprint(): string {
  if (!defaultLiveFingerprint) {
    defaultLiveFingerprint = fingerprintWorkspace(buildDefaultSunnyBanksLive());
  }
  return defaultLiveFingerprint;
}

let emptyLiveFingerprint: string | null = null;

/** Fingerprint of the blank page New Episode starts from. */
export function emptySunnyBanksLiveFingerprint(genre: StudioGenre = "sunnybank"): string {
  if (genre !== "sunnybank") return fingerprintWorkspace(buildEmptySunnyBanksLive(genre));
  if (!emptyLiveFingerprint) {
    emptyLiveFingerprint = fingerprintWorkspace(buildEmptySunnyBanksLive());
  }
  return emptyLiveFingerprint;
}

/** True when a named card exists, or the live copy is not the page the
 * show opens on (Sunny Banks: the EP02 seed; Skidmarks: a blank page). */
export function sunnyBanksStudioHasUserContent(
  studio: SkidmarksSunnyBanksState | null | undefined,
  genre: StudioGenre = "sunnybank"
): boolean {
  if (!studio) return false;
  if (studio.workspaces.length > 0) return true;
  const opening = genre === "sunnybank" ? defaultSunnyBanksLiveFingerprint() : emptySunnyBanksLiveFingerprint(genre);
  return fingerprintWorkspace(studio.live) !== opening;
}
