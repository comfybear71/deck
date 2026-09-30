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
  };
}

export function adultShortsHaveUserContent(state: AdultShortsState | null | undefined): boolean {
  if (!state) return false;
  if (state.character.name.trim() || state.character.look.trim() || state.character.referenceUrls.length) return true;
  if (state.saved?.length) return true;
  return editorHasContent(state);
}

/** Anything worth saving in the editor right now (ignores the Library). */
export function editorHasContent(state: Pick<AdultShortsState, "character" | "shots">): boolean {
  if (state.character.name.trim() || state.character.look.trim() || state.character.referenceUrls.length) return true;
  return state.shots.some((s) => s.prompt.trim() || s.plateUrl || s.clipUrl);
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

const cloneShots = (shots: readonly AdultShortsShot[]) => shots.map((s) => ({ ...s }));
const cloneCharacter = (c: AdultShortsCharacter): AdultShortsCharacter => ({ ...c, referenceUrls: c.referenceUrls.slice() });

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
    title: (title ?? "").trim() || existing?.title || suggestAdultShortTitle(state, now),
    savedAt: now.toISOString(),
    character: cloneCharacter(state.character),
    shots: cloneShots(state.shots).map((s) => ({ ...s, sirayTaskId: null })),
    ...((state.mediaSlug ?? existing?.mediaSlug) ? { mediaSlug: state.mediaSlug ?? existing?.mediaSlug } : {}),
    episodeNumber,
  };
  const rest = state.saved.filter((x) => x.id !== entry.id);
  return { ...state, saved: [entry, ...rest].slice(0, ADULT_SHORTS_MAX_SAVED), currentSavedId: entry.id };
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
    (state.mediaSlug ?? card.mediaSlug) === card.mediaSlug
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
    title: card?.title || suggestAdultShortTitle(state, now),
    savedAt: now.toISOString(),
    character: cloneCharacter(state.character),
    shots: cloneShots(state.shots).map((s) => ({ ...s, sirayTaskId: null })),
    ...(mediaSlug ? { mediaSlug } : {}),
    episodeNumber: card
      ? (adultShortEpisodeNumbers(state.saved).get(card.id) ?? nextAdultShortEpisodeNumber(state.saved))
      : nextAdultShortEpisodeNumber(state.saved),
  };
  const saved = card ? state.saved.map((x) => (x.id === card.id ? entry : x)) : [entry, ...state.saved];
  return { ...state, saved, currentSavedId: entry.id };
}

/**
 * What a card shows: the live editor when it's the open card (so the
 * row shows the editor's shots the moment the page loads, before
 * anything is saved onto the card), else the card's own saved copy.
 */
export function adultShortEpisodeView(
  state: AdultShortsState,
  entry: AdultShortsSaved,
): { shots: AdultShortsShot[]; character: AdultShortsCharacter } {
  return state.currentSavedId === entry.id
    ? { shots: state.shots, character: state.character }
    : { shots: entry.shots, character: entry.character };
}


/** Clear the editor for a fresh short. The Library is untouched. A new
 * short gets its own Blob folder name when it makes its first file. */
export function startNewAdultShort(state: AdultShortsState, keepCharacter: boolean): AdultShortsState {
  const rest: AdultShortsState = { ...state };
  delete rest.mediaSlug;
  return {
    ...rest,
    character: keepCharacter ? cloneCharacter(state.character) : { name: "", look: "", referenceUrls: [] },
    shots: [buildAdultShortsShot(mintAdultShortsId())],
    currentSavedId: null,
  };
}

/** Load a saved short back into the editor. */
export function openSavedAdultShort(state: AdultShortsState, id: string): AdultShortsState {
  const entry = state.saved.find((x) => x.id === id);
  if (!entry) return state;
  const rest: AdultShortsState = { ...state };
  delete rest.mediaSlug;
  return {
    ...rest,
    character: cloneCharacter(entry.character),
    shots: cloneShots(entry.shots),
    currentSavedId: entry.id,
    ...(entry.mediaSlug ? { mediaSlug: entry.mediaSlug } : {}),
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
    JSON.stringify(strip(entry.shots)) !== JSON.stringify(strip(state.shots))
  );
}

function characterLine(character: AdultShortsCharacter): string {
  const bits = [character.name.trim(), character.look.trim()].filter(Boolean);
  return bits.length ? `Character: ${bits.join(", ")}.` : "";
}

function capPrompt(text: string): string {
  return text.length > MAX_PROMPT_CHARS ? text.slice(0, MAX_PROMPT_CHARS) : text;
}

/** Plate still prompt — shot first, then the locks (locks always survive the cap). */
export function buildAdultShortsStillPrompt(character: AdultShortsCharacter, shot: Pick<AdultShortsShot, "prompt">): string {
  const locks = [characterLine(character), ADULT_SHORTS_ADULT_LOCK, ADULT_SHORTS_CONTENT_LOCK].filter(Boolean).join(" ");
  const room = MAX_PROMPT_CHARS - locks.length - 1;
  const shotText = shot.prompt.trim().slice(0, Math.max(0, room));
  return capPrompt([shotText, locks].filter(Boolean).join(" "));
}

/** Motion prompt for Wan i2v — same locks, plus "keep the same person". */
export function buildAdultShortsMotionPrompt(character: AdultShortsCharacter, shot: Pick<AdultShortsShot, "prompt">): string {
  const locks = [
    characterLine(character),
    ADULT_SHORTS_ADULT_LOCK,
    "Keep her identity consistent with the start frame.",
    ADULT_SHORTS_CONTENT_LOCK,
  ]
    .filter(Boolean)
    .join(" ");
  const room = MAX_PROMPT_CHARS - locks.length - 1;
  const shotText = shot.prompt.trim().slice(0, Math.max(0, room));
  return capPrompt([shotText, locks].filter(Boolean).join(" "));
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
