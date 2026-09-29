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

export const ADULT_SHORTS_MAX_REFERENCES = 3;
export const ADULT_SHORTS_MAX_SHOTS = 10;
export const ADULT_SHORTS_MIN_SHOT_SEC = 2;
export const ADULT_SHORTS_MAX_SHOT_SEC = 10;
export const ADULT_SHORTS_DEFAULT_SHOT_SEC = 5;
/** Saved shorts kept in the 18+ Library tab (URLs only, so this stays small). */
export const ADULT_SHORTS_MAX_SAVED = 50;

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
    });
  }
  return out;
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
  const entry: AdultShortsSaved = {
    id: existing?.id ?? id,
    title: (title ?? "").trim() || existing?.title || suggestAdultShortTitle(state, now),
    savedAt: now.toISOString(),
    character: cloneCharacter(state.character),
    shots: cloneShots(state.shots).map((s) => ({ ...s, sirayTaskId: null })),
  };
  const rest = state.saved.filter((x) => x.id !== entry.id);
  return { ...state, saved: [entry, ...rest].slice(0, ADULT_SHORTS_MAX_SAVED), currentSavedId: entry.id };
}

/** Clear the editor for a fresh short. The Library is untouched. */
export function startNewAdultShort(state: AdultShortsState, keepCharacter: boolean): AdultShortsState {
  return {
    ...state,
    character: keepCharacter ? cloneCharacter(state.character) : { name: "", look: "", referenceUrls: [] },
    shots: [buildAdultShortsShot(mintAdultShortsId())],
    currentSavedId: null,
  };
}

/** Load a saved short back into the editor. */
export function openSavedAdultShort(state: AdultShortsState, id: string): AdultShortsState {
  const entry = state.saved.find((x) => x.id === id);
  if (!entry) return state;
  return { ...state, character: cloneCharacter(entry.character), shots: cloneShots(entry.shots), currentSavedId: entry.id };
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
