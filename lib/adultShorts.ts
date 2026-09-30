/**
 * Adult shorts (2026-09-28, Stuart's ask) — a fourth project tile for
 * short 18+ photorealistic clips that aren't a song, a Skidmarks episode
 * or Sunny Banks. One locked character (up to three reference images),
 * a short shot list, Siray Seedream spicy stills for plates, then Siray
 * Wan 3.0 spicy image-to-video for each clip.
 *
 * **Content rule, baked into every prompt:** the character is an adult,
 * fictional, AI-created woman (clearly over 25), and no sex acts are
 * shown. `ADULT_SHORTS_ADULT_LOCK` and `ADULT_SHORTS_CONTENT_LOCK` are
 * appended to every still and motion prompt so a shot prompt can't
 * drop them.
 *
 * Persisted on the same Neon session row as everything else
 * (`SkidmarksState.adultShorts`) — never `localStorage`. Reference
 * images are uploaded to Blob first, so the row only ever holds URLs.
 */

import { isSafeDeckMediaSlug } from "./deckMediaPaths";

export const ADULT_SHORTS_MAX_REFERENCES = 3;
export const ADULT_SHORTS_MAX_SHOTS = 10;
export const ADULT_SHORTS_MIN_SHOT_SEC = 2;
export const ADULT_SHORTS_MAX_SHOT_SEC = 10;
export const ADULT_SHORTS_DEFAULT_SHOT_SEC = 5;
/** Saved shorts (Shorts episodes, 2026-09-30) kept in the session and the
 * 18+ Library tab. URLs only, so this stays small; high enough to be
 * unlimited in practice. Every one is also its own `deck_items` row. */
export const ADULT_SHORTS_MAX_SAVED = 999;
/** Highest episode number (`EP999`). */
export const ADULT_SHORTS_MAX_EPISODE_NUMBER = 999;

/** Siray Seedream 4.5 spicy still, per image (matches `lib/sirayClient.ts`). */
export const ADULT_SHORTS_STILL_COST_USD = 0.04;
/** Siray Wan 3.0 i2v spicy at 1080p, per second — the billed rate (matches `lib/sirayClient.ts`). */
export const ADULT_SHORTS_VIDEO_COST_USD_PER_SEC = 0.18;

export const ADULT_SHORTS_ADULT_LOCK =
  "Adult woman, clearly over 25, fictional AI-created character, photorealistic, same face, hair and body as the reference.";
export const ADULT_SHORTS_CONTENT_LOCK = "No sexual acts shown.";
/** An episode with its 18+ switch off (2026-09-30): nothing spicy at all. */
export const ADULT_SHORTS_GENERAL_CONTENT_LOCK = "Everyone fully clothed. No nudity and nothing sexual.";
/** Two or more people in one shot: every one of them is a made-up adult. */
export const ADULT_SHORTS_GROUP_ADULT_LOCK =
  "Everyone shown is an adult, clearly over 25, a fictional AI-created character, photorealistic, each with the same face, hair and body as their reference.";
/** How many people can star in one episode. */
export const ADULT_SHORTS_MAX_STARRING = 6;
/** How many people's pictures one plate can be made from (Siray still route cap). */
export const ADULT_SHORTS_MAX_PEOPLE_PER_SHOT = 4;
/** Longest episode name typed on "+ New". */
export const ADULT_SHORTS_TITLE_MAX = 80;
/** Longest spoken Line on a talking shot (2026-09-30). One or two sentences. */
export const ADULT_SHORTS_LINE_MAX = 500;
/**
 * A talking shot (a shot with a Line, 2026-09-30) renders on Comfy Cloud
 * LTX, the same lip-sync pipeline as Sunnybank's talking lines, at Deck's
 * same stand-in rate (`estimateLtxClipRenderCostUsd`, `lib/clipGeneration.ts`).
 * It's as long as the spoken line, so it's quoted per second, like Sunnybank.
 */
export const ADULT_SHORTS_TALKING_COST_USD_PER_SEC = 0.13;

/** Siray still route caps prompts at 2000 chars. */
const MAX_PROMPT_CHARS = 1900;

export interface AdultShortsCharacter {
  name: string;
  /** Short written look, e.g. "long auburn hair, green eyes, freckles". */
  look: string;
  /** Blob URLs, max `ADULT_SHORTS_MAX_REFERENCES` (a downscaled `data:`
   * JPEG only when no Blob store is connected, e.g. local dev). */
  referenceUrls: string[];
}

export interface AdultShortsShot {
  id: string;
  prompt: string;
  durationSec: number;
  /** Which reference image the plate is made from (0-based). */
  referenceIndex: number;
  plateUrl: string | null;
  clipUrl: string | null;
  lastFrameUrl: string | null;
  /** Siray task still rendering — resume polling instead of paying again. */
  sirayTaskId: string | null;
  /** Start this clip from the previous clip's last frame instead of its own plate. */
  chainFromPrevious: boolean;
  /**
   * Who's in this shot, by name (2026-09-30, more than one person can
   * star). Absent = everyone starring in the episode, so older shots and
   * one-person episodes need nothing.
   */
  castNames?: string[];
  /**
   * What's said in this shot (2026-09-30), ElevenLabs tags like
   * `[whispers]` kept. Present and not blank = a talking shot: voiced
   * with the speaker's Cast card voice and rendered on LTX. Absent or
   * blank = the silent Siray clip, exactly as before.
   */
  line?: string;
  /** Who says the Line when more than one person is in the shot. Absent = the first of them. */
  speakerName?: string;
}

/**
 * A short saved to the Library (2026-09-29, Stuart's ask: "save this to
 * the library and also create a new one"). A frozen copy of the editor's
 * character + shots; clips are the same Blob URLs, nothing is re-uploaded.
 */
export interface AdultShortsSaved {
  id: string;
  title: string;
  /** ISO timestamp of the latest save. */
  savedAt: string;
  character: AdultShortsCharacter;
  shots: AdultShortsShot[];
  /** This short's folder name in the readable Blob tree
   * (`deck/shorts/episodes/ep01-blonde-girl-1/` since 2026-09-30; older
   * shorts `deck/shorts/shorts/blonde-girl-1/`, `lib/deckMediaPaths.ts`).
   * Pinned from its name the first time it makes a file, so a rename
   * never moves it. Absent on shorts from before. */
  mediaSlug?: string;
  /**
   * Its episode number on the Shorts EPISODES row (2026-09-30): `1` is
   * EP01. Pinned the first time the card is saved after this change;
   * shorts from before have none and are numbered by `savedAt`, oldest
   * first (`adultShortEpisodeNumbers`), so nothing needs rewriting.
   */
  episodeNumber?: number;
  /** Everyone starring, in order (2026-09-30). Absent on older shorts:
   * `character` is then the one person starring (`adultShortStarring`). */
  starring?: AdultShortsCharacter[];
  /** This episode's own 18+ switch (2026-09-30). Absent on older shorts,
   * which were all 18+ (Skylar's EP01), so absent reads as on. */
  adult?: boolean;
}

export interface AdultShortsState {
  /** One-time "I'm 18+ and this character is an adult" confirm per session row. */
  ageConfirmed: boolean;
  character: AdultShortsCharacter;
  shots: AdultShortsShot[];
  /** Newest first. */
  saved: AdultShortsSaved[];
  /** The saved short the editor was opened from / last saved as. Saving
   * again updates that entry instead of adding a duplicate. */
  currentSavedId: string | null;
  /** The open short's Blob folder name (see `AdultShortsSaved.mediaSlug`).
   * Set the first time it makes a file; carried into its Library copy. */
  mediaSlug?: string;
  /** The open episode's cast (see `AdultShortsSaved.starring`). `character` is always the first of them. */
  starring?: AdultShortsCharacter[];
  /** The open episode's 18+ switch (see `AdultShortsSaved.adult`). */
  adult?: boolean;
  /** The name typed on "+ New" for an episode that has no card yet; its card takes it. */
  title?: string;
}

const EMPTY_CHARACTER: AdultShortsCharacter = { name: "", look: "", referenceUrls: [] };

/**
 * Everyone starring in an episode (or the open editor), in order. Older
 * shorts only have `character`, the one person starring (none when it has
 * no name). Always a fresh copy.
 */
export function adultShortStarring(x: { character: AdultShortsCharacter; starring?: AdultShortsCharacter[] }): AdultShortsCharacter[] {
  if (Array.isArray(x.starring)) return x.starring.map(cloneCharacter);
  return x.character.name.trim() ? [cloneCharacter(x.character)] : [];
}

/** Is this episode 18+? Older shorts (no switch saved) were all 18+. */
export function adultShortIsAdult(x: { adult?: boolean }): boolean {
  return x.adult !== false;
}

/**
 * Set who's starring in the open episode. `character` follows the first
 * of them, so everything that reads one person (the Library, the Cast
 * row, zip names) keeps working.
 */
export function setAdultShortStarring(state: AdultShortsState, starring: readonly AdultShortsCharacter[]): AdultShortsState {
  const list = dedupeStarring(starring).slice(0, ADULT_SHORTS_MAX_STARRING);
  return { ...state, starring: list, character: list[0] ? cloneCharacter(list[0]) : { ...EMPTY_CHARACTER, referenceUrls: [] } };
}

function nameKey(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Same person, the way the Cast row matches names ("Skylar" = "SKYLAR"). */
export function sameAdultShortPerson(a: string, b: string): boolean {
  const ka = nameKey(a);
  return ka.length > 0 && ka === nameKey(b);
}

function dedupeStarring(list: readonly AdultShortsCharacter[]): AdultShortsCharacter[] {
  const out: AdultShortsCharacter[] = [];
  for (const c of list) {
    if (!c?.name?.trim() || out.some((x) => sameAdultShortPerson(x.name, c.name))) continue;
    out.push(cloneCharacter(c));
  }
  return out;
}

/** The people in one shot: its own picks, or everyone starring when it has none (or none of them still star). */
export function adultShortShotPeople<T extends { name: string }>(starring: readonly T[], shot: Pick<AdultShortsShot, "castNames">): T[] {
  if (!shot.castNames) return starring.slice();
  const picked = starring.filter((p) => shot.castNames!.some((n) => sameAdultShortPerson(n, p.name)));
  return picked.length ? picked : starring.slice();
}

export function mintAdultShortsId(prefix = "shot"): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function buildAdultShortsShot(id: string = mintAdultShortsId()): AdultShortsShot {
  return {
    id,
    prompt: "",
    durationSec: ADULT_SHORTS_DEFAULT_SHOT_SEC,
    referenceIndex: 0,
    plateUrl: null,
    clipUrl: null,
    lastFrameUrl: null,
    sirayTaskId: null,
    chainFromPrevious: false,
  };
}

export function emptyAdultShortsState(): AdultShortsState {
  return {
    ageConfirmed: false,
    character: { name: "", look: "", referenceUrls: [] },
    shots: [buildAdultShortsShot("shot_1")],
    saved: [],
    currentSavedId: null,
  };
}

export function clampAdultShortsDuration(sec: number): number {
  if (!Number.isFinite(sec)) return ADULT_SHORTS_DEFAULT_SHOT_SEC;
  return Math.max(ADULT_SHORTS_MIN_SHOT_SEC, Math.min(ADULT_SHORTS_MAX_SHOT_SEC, Math.round(sec)));
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function urlOrNull(v: unknown): string | null {
  return typeof v === "string" && /^(https:|data:image\/|data:video\/)/.test(v) ? v : null;
}

function normalizeCharacter(value: unknown): AdultShortsCharacter {
  const c = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const refs = Array.isArray(c.referenceUrls)
    ? c.referenceUrls.filter((u): u is string => typeof u === "string" && /^(https:|data:image\/)/.test(u)).slice(0, ADULT_SHORTS_MAX_REFERENCES)
    : [];
  return { name: str(c.name), look: str(c.look), referenceUrls: refs };
}

function normalizeStarring(value: unknown): { starring?: AdultShortsCharacter[] } {
  if (!Array.isArray(value)) return {};
  return { starring: dedupeStarring(value.map(normalizeCharacter)).slice(0, ADULT_SHORTS_MAX_STARRING) };
}

function normalizeAdultFlag(value: unknown): { adult?: boolean } {
  return typeof value === "boolean" ? { adult: value } : {};
}

function normalizeShots(value: unknown): AdultShortsShot[] {
  const shotsRaw = Array.isArray(value) ? value : [];
  const shots: AdultShortsShot[] = [];
  const seen = new Set<string>();
  for (const raw of shotsRaw.slice(0, ADULT_SHORTS_MAX_SHOTS)) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const id = str(s.id) || mintAdultShortsId();
    if (seen.has(id)) continue;
    seen.add(id);
    const refIdx = typeof s.referenceIndex === "number" && Number.isInteger(s.referenceIndex) ? s.referenceIndex : 0;
    shots.push({
      id,
      prompt: str(s.prompt),
      durationSec: clampAdultShortsDuration(typeof s.durationSec === "number" ? s.durationSec : NaN),
      referenceIndex: Math.max(0, Math.min(ADULT_SHORTS_MAX_REFERENCES - 1, refIdx)),
      plateUrl: urlOrNull(s.plateUrl),
      clipUrl: urlOrNull(s.clipUrl),
      lastFrameUrl: urlOrNull(s.lastFrameUrl),
      sirayTaskId: str(s.sirayTaskId) || null,
      chainFromPrevious: s.chainFromPrevious === true,
      ...(Array.isArray(s.castNames)
        ? { castNames: s.castNames.filter((n): n is string => typeof n === "string" && n.trim().length > 0).map((n) => n.trim()).slice(0, ADULT_SHORTS_MAX_STARRING) }
        : {}),
      ...(typeof s.line === "string" && s.line.trim() ? { line: s.line.slice(0, ADULT_SHORTS_LINE_MAX) } : {}),
      ...(typeof s.speakerName === "string" && s.speakerName.trim() ? { speakerName: s.speakerName.trim() } : {}),
    });
  }
  return shots;
}

function normalizeSaved(value: unknown): AdultShortsSaved[] {
  if (!Array.isArray(value)) return [];
  const out: AdultShortsSaved[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (out.length >= ADULT_SHORTS_MAX_SAVED) break;
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    if (!id || seen.has(id)) continue;
    const shots = normalizeShots(r.shots).map((s) => ({ ...s, sirayTaskId: null }));
    if (!shots.length) continue;
    seen.add(id);
    out.push({
      id,
      title: str(r.title).trim() || "Untitled short",
      savedAt: str(r.savedAt) || new Date(0).toISOString(),
      character: normalizeCharacter(r.character),
      shots,
      ...(isSafeDeckMediaSlug(r.mediaSlug) ? { mediaSlug: r.mediaSlug } : {}),
      ...(isEpisodeNumber(r.episodeNumber) ? { episodeNumber: r.episodeNumber } : {}),
      ...normalizeStarring(r.starring),
      ...normalizeAdultFlag(r.adult),
    });
  }
  return out;
}

function isEpisodeNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= ADULT_SHORTS_MAX_EPISODE_NUMBER;
}

export function normalizeAdultShortsState(value: unknown): AdultShortsState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const shots = normalizeShots(v.shots);
  const saved = normalizeSaved(v.saved);
  const currentSavedId = str(v.currentSavedId);
  return {
    ageConfirmed: v.ageConfirmed === true,
    character: normalizeCharacter(v.character),
    shots: shots.length ? shots : [buildAdultShortsShot("shot_1")],
    saved,
    currentSavedId: saved.some((x) => x.id === currentSavedId) ? currentSavedId : null,
    ...(isSafeDeckMediaSlug(v.mediaSlug) ? { mediaSlug: v.mediaSlug } : {}),
    ...normalizeStarring(v.starring),
    ...normalizeAdultFlag(v.adult),
    ...(str(v.title).trim() ? { title: str(v.title).trim().slice(0, ADULT_SHORTS_TITLE_MAX) } : {}),
  };
}

export function adultShortsHaveUserContent(state: AdultShortsState | null | undefined): boolean {
  if (!state) return false;
  if (state.character.name.trim() || state.character.look.trim() || state.character.referenceUrls.length) return true;
  if (state.saved?.length) return true;
  return editorHasContent(state);
}

/** Anything worth saving in the editor right now (ignores the Library). */
export function editorHasContent(state: Pick<AdultShortsState, "character" | "shots" | "starring">): boolean {
  if (state.character.name.trim() || state.character.look.trim() || state.character.referenceUrls.length) return true;
  if (state.starring?.length) return true;
  return state.shots.some((s) => s.prompt.trim() || s.line?.trim() || s.plateUrl || s.clipUrl);
}

/** Default Library title: "<name> · <first shot words>", or the date. */
export function suggestAdultShortTitle(state: Pick<AdultShortsState, "character" | "shots">, now: Date): string {
  const name = state.character.name.trim();
  const firstPrompt = state.shots.find((s) => s.prompt.trim())?.prompt.trim() ?? "";
  const words = firstPrompt.split(/\s+/).slice(0, 5).join(" ").replace(/[.,;:!]+$/, "");
  const bits = [name, words].filter(Boolean);
  if (bits.length) return bits.join(" · ").slice(0, 80);
  return `Short ${now.toISOString().slice(0, 10)}`;
}

const cloneShots = (shots: readonly AdultShortsShot[]) => shots.map((s) => ({ ...s, ...(s.castNames ? { castNames: s.castNames.slice() } : {}) }));
function cloneCharacter(c: AdultShortsCharacter): AdultShortsCharacter {
  return { ...c, referenceUrls: c.referenceUrls.slice() };
}

/** The episode fields that ride along with the shots (only the ones set, so older cards stay byte-for-byte the same). */
function episodeExtras(state: AdultShortsState): Pick<AdultShortsSaved, "starring" | "adult"> {
  return {
    ...(Array.isArray(state.starring) ? { starring: state.starring.map(cloneCharacter) } : {}),
    ...(typeof state.adult === "boolean" ? { adult: state.adult } : {}),
  };
}

/**
 * Save the editor to the Library. Updates the entry the editor came from
 * (`currentSavedId`) or adds a new one at the top. Shots still waiting on
 * Siray keep their task id in the editor but not in the saved copy.
 */
export function saveAdultShortToLibrary(state: AdultShortsState, now: Date, title?: string, id: string = mintAdultShortsId("short")): AdultShortsState {
  const existing = state.currentSavedId ? state.saved.find((x) => x.id === state.currentSavedId) : undefined;
  const episodeNumber = existing
    ? (adultShortEpisodeNumbers(state.saved).get(existing.id) ?? nextAdultShortEpisodeNumber(state.saved))
    : nextAdultShortEpisodeNumber(state.saved);
  const entry: AdultShortsSaved = {
    id: existing?.id ?? id,
    title: (title ?? "").trim() || existing?.title || state.title || suggestAdultShortTitle(state, now),
    savedAt: now.toISOString(),
    character: cloneCharacter(state.character),
    shots: cloneShots(state.shots).map((s) => ({ ...s, sirayTaskId: null })),
    ...((state.mediaSlug ?? existing?.mediaSlug) ? { mediaSlug: state.mediaSlug ?? existing?.mediaSlug } : {}),
    episodeNumber,
    ...episodeExtras(state),
  };
  const rest = state.saved.filter((x) => x.id !== entry.id);
  const next: AdultShortsState = { ...state, saved: [entry, ...rest].slice(0, ADULT_SHORTS_MAX_SAVED), currentSavedId: entry.id };
  delete next.title;
  return next;
}

// ---- Episodes (2026-09-30) ------------------------------------------------
//
// Shorts now works like Sunnybank: a sideways EPISODES row of cards with
// "+ New", and every change is saved onto the open card as it happens.
// A card is a saved short (the Library entry, its own `deck_items` row,
// kind `adult-short`), so no new kind, table or seed is needed: the short
// Stuart already has is EP01, and the editor's shots are saved onto it by
// the next edit. Nothing is written on load.

/**
 * Every saved short's episode number. A pinned `episodeNumber` is kept;
 * any card without one gets the next free number in `savedAt` order,
 * oldest first (ties by id), so the numbers never change between loads.
 */
export function adultShortEpisodeNumbers(saved: readonly AdultShortsSaved[]): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const entry of saved) {
    if (isEpisodeNumber(entry.episodeNumber) && !taken.has(entry.episodeNumber)) {
      out.set(entry.id, entry.episodeNumber);
      taken.add(entry.episodeNumber);
    }
  }
  const rest = saved
    .filter((entry) => !out.has(entry.id))
    .slice()
    .sort((a, b) => (a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let n = 1;
  for (const entry of rest) {
    while (taken.has(n)) n += 1;
    out.set(entry.id, n);
    taken.add(n);
  }
  return out;
}

/** The number a brand-new episode gets: one more than the highest so far. */
export function nextAdultShortEpisodeNumber(saved: readonly AdultShortsSaved[]): number {
  let max = 0;
  for (const n of adultShortEpisodeNumbers(saved).values()) max = Math.max(max, n);
  return Math.min(ADULT_SHORTS_MAX_EPISODE_NUMBER, max + 1);
}

/** `1` → `EP01`, `12` → `EP12`, `105` → `EP105`. */
export function adultShortEpisodeCode(n: number): string {
  return `EP${String(Math.max(1, Math.floor(n))).padStart(2, "0")}`;
}

/** The small line under a card's title: "5 shots · 4 clips". */
export function describeAdultShortEpisode(shots: readonly Pick<AdultShortsShot, "clipUrl">[]): string {
  const clips = shots.filter((s) => s.clipUrl).length;
  return `${shots.length} shot${shots.length === 1 ? "" : "s"} · ${clips} clip${clips === 1 ? "" : "s"}`;
}

/** The first finished clip, used as the card's thumbnail. */
export function firstAdultShortClipUrl(shots: readonly Pick<AdultShortsShot, "clipUrl">[]): string | null {
  return shots.find((s) => typeof s.clipUrl === "string" && s.clipUrl.startsWith("https:"))?.clipUrl ?? null;
}

function sameEditorAsCard(state: AdultShortsState, card: AdultShortsSaved): boolean {
  const strip = (shots: readonly AdultShortsShot[]) => shots.map((s) => ({ ...s, sirayTaskId: null }));
  return (
    JSON.stringify(card.character) === JSON.stringify(state.character) &&
    JSON.stringify(strip(card.shots)) === JSON.stringify(strip(state.shots)) &&
    (state.mediaSlug ?? card.mediaSlug) === card.mediaSlug &&
    JSON.stringify(adultShortStarring(card)) === JSON.stringify(adultShortStarring(state)) &&
    adultShortIsAdult(card) === adultShortIsAdult(state)
  );
}

/**
 * Auto-save (like Sunnybank's episode cards): the open editor is written
 * onto its card whenever it changes. The card is the one it was opened
 * from or last saved as (`currentSavedId`), updated in place so the row
 * doesn't reshuffle; an editor with real work and no card gets a new
 * card, first in the row, with the next episode number, once a shot has
 * something in it. Returns `state` itself when nothing needs saving
 * (before the 18+ confirm, a blank editor, or no change), so loading and
 * no-op patches never write.
 */
export function autoSaveAdultShortEditor(state: AdultShortsState, now: Date, id: string = mintAdultShortsId("short")): AdultShortsState {
  if (!state.ageConfirmed || !editorHasContent(state)) return state;
  const card = state.currentSavedId ? state.saved.find((x) => x.id === state.currentSavedId) : undefined;
  if (card && sameEditorAsCard(state, card)) return state;
  // A new card only once a shot has something in it, so "+ New" (which
  // keeps the character) doesn't make an empty episode.
  if (!card && !state.shots.some((s) => s.prompt.trim() || s.plateUrl || s.clipUrl)) return state;
  if (!card && state.saved.length >= ADULT_SHORTS_MAX_SAVED) return state;
  const mediaSlug = state.mediaSlug ?? card?.mediaSlug;
  const entry: AdultShortsSaved = {
    id: card?.id ?? id,
    title: card?.title || state.title || suggestAdultShortTitle(state, now),
    savedAt: now.toISOString(),
    character: cloneCharacter(state.character),
    shots: cloneShots(state.shots).map((s) => ({ ...s, sirayTaskId: null })),
    ...(mediaSlug ? { mediaSlug } : {}),
    episodeNumber: card
      ? (adultShortEpisodeNumbers(state.saved).get(card.id) ?? nextAdultShortEpisodeNumber(state.saved))
      : nextAdultShortEpisodeNumber(state.saved),
    ...episodeExtras(state),
  };
  const saved = card ? state.saved.map((x) => (x.id === card.id ? entry : x)) : [entry, ...state.saved];
  const next: AdultShortsState = { ...state, saved, currentSavedId: entry.id };
  // The typed name now lives on the card.
  delete next.title;
  return next;
}

/**
 * What a card shows: the live editor when it's the open card (so the
 * row shows the editor's shots the moment the page loads, before
 * anything is saved onto the card), else the card's own saved copy.
 */
export function adultShortEpisodeView(
  state: AdultShortsState,
  entry: AdultShortsSaved,
): { shots: AdultShortsShot[]; character: AdultShortsCharacter; starring: AdultShortsCharacter[]; adult: boolean } {
  const src = state.currentSavedId === entry.id ? state : entry;
  return { shots: src.shots, character: src.character, starring: adultShortStarring(src), adult: adultShortIsAdult(src) };
}


/** Clear the editor for a fresh short. The Library is untouched. A new
 * short gets its own Blob folder name when it makes its first file. */
export function startNewAdultShort(state: AdultShortsState, keepCharacter: boolean): AdultShortsState {
  const rest: AdultShortsState = { ...state };
  delete rest.mediaSlug;
  delete rest.title;
  const base: AdultShortsState = {
    ...rest,
    shots: [buildAdultShortsShot(mintAdultShortsId())],
    currentSavedId: null,
    // Every new short starts with its 18+ switch off (2026-09-30).
    adult: false,
  };
  return setAdultShortStarring(base, keepCharacter ? adultShortStarring(state) : []);
}

/**
 * "+ New" on the Shorts EPISODES row (2026-09-30): a blank workspace with
 * only the name typed for it. No one starring, one empty shot, 18+ off.
 * Like every new episode it only gets its card (and its row) once a shot
 * has something in it; its folder is then `ep02-<name>`.
 */
export function startBlankAdultShort(state: AdultShortsState, title: string): AdultShortsState {
  const next = startNewAdultShort(state, false);
  const name = title.replace(/\s+/g, " ").trim().slice(0, ADULT_SHORTS_TITLE_MAX);
  return name ? { ...next, title: name } : next;
}

/** Load a saved short back into the editor. */
export function openSavedAdultShort(state: AdultShortsState, id: string): AdultShortsState {
  const entry = state.saved.find((x) => x.id === id);
  if (!entry) return state;
  const rest: AdultShortsState = { ...state };
  delete rest.mediaSlug;
  delete rest.starring;
  delete rest.adult;
  delete rest.title;
  return {
    ...rest,
    character: cloneCharacter(entry.character),
    shots: cloneShots(entry.shots),
    currentSavedId: entry.id,
    ...(entry.mediaSlug ? { mediaSlug: entry.mediaSlug } : {}),
    ...(entry.starring ? { starring: entry.starring.map(cloneCharacter) } : {}),
    ...(typeof entry.adult === "boolean" ? { adult: entry.adult } : {}),
  };
}

export function deleteSavedAdultShort(state: AdultShortsState, id: string): AdultShortsState {
  return {
    ...state,
    saved: state.saved.filter((x) => x.id !== id),
    currentSavedId: state.currentSavedId === id ? null : state.currentSavedId,
  };
}

/**
 * True when the editor holds work the Library doesn't have yet: never
 * saved, or changed since the last save. Used to warn before "New short"
 * or "Open" would replace it.
 */
export function editorHasUnsavedChanges(state: AdultShortsState): boolean {
  if (!editorHasContent(state)) return false;
  const entry = state.currentSavedId ? state.saved.find((x) => x.id === state.currentSavedId) : undefined;
  if (!entry) return true;
  const strip = (shots: readonly AdultShortsShot[]) => shots.map((s) => ({ ...s, sirayTaskId: null }));
  return (
    JSON.stringify(entry.character) !== JSON.stringify(state.character) ||
    JSON.stringify(strip(entry.shots)) !== JSON.stringify(strip(state.shots)) ||
    JSON.stringify(adultShortStarring(entry)) !== JSON.stringify(adultShortStarring(state)) ||
    adultShortIsAdult(entry) !== adultShortIsAdult(state)
  );
}

/** One person in a shot, as the prompts see them. `subjectWord` is their Cast card's (woman, man, person…). */
export interface AdultShortsPerson extends AdultShortsCharacter {
  subjectWord?: string;
  /** Their Cast card's ElevenLabs voice id (2026-09-30), for a talking shot. Read from the card, never saved on the episode. */
  voiceId?: string;
}

export interface AdultShortsPromptOptions {
  /** The episode's 18+ switch. Default on (older shorts were all 18+). */
  adult?: boolean;
}

function peopleOf(who: AdultShortsCharacter | readonly AdultShortsPerson[]): AdultShortsPerson[] {
  const list = Array.isArray(who) ? (who as readonly AdultShortsPerson[]).slice() : [who as AdultShortsPerson];
  return list.filter((p) => p.name.trim() || p.look.trim());
}

function personBits(p: AdultShortsPerson): string {
  return [p.name.trim(), p.look.trim()].filter(Boolean).join(", ");
}

/** "Character: SKYLAR." for one person (unchanged); "Characters: A; B, look." for more. */
function characterLine(people: readonly AdultShortsPerson[]): string {
  if (people.length === 0) return "";
  if (people.length === 1) return `Character: ${personBits(people[0])}.`;
  return `Characters: ${people.map(personBits).join("; ")}.`;
}

/** Which reference picture is who, when a plate is made from more than one person's pictures. */
function referenceLine(people: readonly AdultShortsPerson[]): string {
  if (people.length < 2) return "";
  return `${people.map((p, i) => `Reference ${i + 1} is ${p.name.trim() || `person ${i + 1}`}`).join(", ")}.`;
}

const SUBJECT_WORDS = new Set(["woman", "man", "person"]);

/** The adult lock: word for word as before for a woman; the same sentence for a man or anyone else; one line for a group. */
export function adultShortsAdultLock(people: readonly Pick<AdultShortsPerson, "subjectWord">[]): string {
  if (people.length > 1) return ADULT_SHORTS_GROUP_ADULT_LOCK;
  const raw = (people[0]?.subjectWord ?? "").trim().toLowerCase();
  const word = SUBJECT_WORDS.has(raw) ? raw : "person";
  return word === "woman" ? ADULT_SHORTS_ADULT_LOCK : ADULT_SHORTS_ADULT_LOCK.replace(/^Adult woman,/, `Adult ${word},`);
}

function identityLine(people: readonly Pick<AdultShortsPerson, "subjectWord">[]): string {
  if (people.length > 1) return "Keep everyone's identity consistent with the start frame.";
  const word = (people[0]?.subjectWord ?? "").trim().toLowerCase();
  const pronoun = word === "woman" ? "her" : word === "man" ? "his" : "their";
  return `Keep ${pronoun} identity consistent with the start frame.`;
}

function contentLock(opts: AdultShortsPromptOptions | undefined): string {
  return opts?.adult === false ? ADULT_SHORTS_GENERAL_CONTENT_LOCK : ADULT_SHORTS_CONTENT_LOCK;
}

function capPrompt(text: string): string {
  return text.length > MAX_PROMPT_CHARS ? text.slice(0, MAX_PROMPT_CHARS) : text;
}

function withLocks(shot: Pick<AdultShortsShot, "prompt">, locks: string): string {
  const room = MAX_PROMPT_CHARS - locks.length - 1;
  const shotText = shot.prompt.trim().slice(0, Math.max(0, room));
  return capPrompt([shotText, locks].filter(Boolean).join(" "));
}

/**
 * Plate still prompt — shot first, then the locks (locks always survive
 * the cap). `who` is the one person (older callers) or everyone in the
 * shot, in the same order as the reference pictures.
 */
export function buildAdultShortsStillPrompt(
  who: AdultShortsCharacter | readonly AdultShortsPerson[],
  shot: Pick<AdultShortsShot, "prompt">,
  opts?: AdultShortsPromptOptions,
): string {
  const people = peopleOf(who);
  const locks = [characterLine(people), referenceLine(people), adultShortsAdultLock(people), contentLock(opts)].filter(Boolean).join(" ");
  return withLocks(shot, locks);
}

/** Motion prompt for Wan i2v — same locks, plus "keep the same person". */
export function buildAdultShortsMotionPrompt(
  who: AdultShortsCharacter | readonly AdultShortsPerson[],
  shot: Pick<AdultShortsShot, "prompt">,
  opts?: AdultShortsPromptOptions,
): string {
  const people = peopleOf(who);
  const locks = [characterLine(people), adultShortsAdultLock(people), identityLine(people), contentLock(opts)].filter(Boolean).join(" ");
  return withLocks(shot, locks);
}

/** A talking shot: it has a Line (2026-09-30). Renders on LTX; anything else stays on Siray. */
export function isAdultShortTalkingShot(shot: Pick<AdultShortsShot, "line">): boolean {
  return Boolean(shot.line?.trim());
}

/** Who says a shot's Line: its picked speaker if they're in the shot, else the first person in it. */
export function adultShortSpeaker<T extends { name: string }>(people: readonly T[], shot: Pick<AdultShortsShot, "speakerName">): T | null {
  const picked = shot.speakerName?.trim();
  return (picked ? people.find((p) => sameAdultShortPerson(p.name, picked)) : undefined) ?? people[0] ?? null;
}

/**
 * Talking-shot motion prompt for LTX (2026-09-30): the same locks as the
 * Siray motion prompt (the adult line, "keep the same person" and the
 * episode's content rule), plus who's speaking. The route adds the
 * spoken words themselves, without the ElevenLabs tags.
 */
export function buildAdultShortsTalkingPrompt(
  who: readonly AdultShortsPerson[],
  shot: Pick<AdultShortsShot, "prompt">,
  speakerName: string,
  opts?: AdultShortsPromptOptions,
): string {
  const people = peopleOf(who);
  const speaking = speakerName.trim()
    ? `${speakerName.trim()} speaks to camera, lips in sync with the audio.${people.length > 1 ? " Everyone else listens." : ""}`
    : "";
  const locks = [characterLine(people), speaking, adultShortsAdultLock(people), identityLine(people), contentLock(opts)]
    .filter(Boolean)
    .join(" ");
  return withLocks(shot, locks);
}

/** "~$0.13/s", the talking-shot price as Sunnybank shows it (as long as the line). */
export function formatAdultShortsTalkingCost(): string {
  return `~$${ADULT_SHORTS_TALKING_COST_USD_PER_SEC.toFixed(2)}/s`;
}

/**
 * The image a shot's clip starts from: the previous clip's last frame
 * when chained (and that frame exists), otherwise this shot's own plate.
 */
export function resolveAdultShortsStartImage(shots: readonly AdultShortsShot[], index: number): string | null {
  const shot = shots[index];
  if (!shot) return null;
  if (shot.chainFromPrevious && index > 0) {
    const prev = shots[index - 1];
    if (prev?.lastFrameUrl) return prev.lastFrameUrl;
  }
  return shot.plateUrl;
}

export function estimateAdultShortsClipCostUsd(durationSec: number): number {
  // Round up to the cent so the button never under-quotes.
  return Math.ceil(clampAdultShortsDuration(durationSec) * ADULT_SHORTS_VIDEO_COST_USD_PER_SEC * 100 - 1e-9) / 100;
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * One saved short cleaned the same way the session loader cleans the
 * Library, or `null` if it isn't one. Used by per-item saving
 * (`deck_items`, kind `adult-short`) so a short's row and the session
 * copy always compare field for field.
 */
export function normalizeAdultShortsSavedEntry(value: unknown): AdultShortsSaved | null {
  return normalizeSaved([value])[0] ?? null;
}
