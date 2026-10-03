/**
 * Locations (2026-09-30, Stuart's ask): every genre gets a LOCATIONS row
 * that scrolls sideways directly above its Characters row, and works the
 * same way (tap to open, "+" to add a name and picture, rename, replace
 * the picture, delete with two taps). One list, one shape and one set of
 * rules for Sunnybank, Music video, Skidmarks and Shorts.
 *
 * Saving: each location is its own `deck_items` row (kind `location`,
 * folder = its genre), through the same per-item engine as characters
 * and episodes (`lib/locationItems.ts`, `lib/deckItemSync.ts`). Until the
 * one-time seed (`scripts/seed-deck-items-locations.ts`) has run, it rides
 * on the whole-session save like everything else did before.
 *
 * Pictures: Deck Blob, `deck/<genre>/locations/<location>.jpg` (readable
 * names, no random ids; a replaced picture is `-v2`, never an overwrite),
 * or a repo file for the Sunnybank built-ins (`/skidmarks/sunnybanks/...`).
 *
 * Sunnybank's built-ins (`SUNNY_BANKS_LOCATIONS` in `lib/sunnyBanks.ts`)
 * are what the row and the renderer show until Sunnybank has saved
 * locations. The first edit on the row copies them into the saved list
 * first, so nothing on screen jumps and nothing is lost.
 *
 * Pure: no store, no network.
 */
import { DECK_MEDIA_ROOT, deckMediaSlug, type DeckGenre, type DeckMediaTarget } from "./deckMediaPaths";
import { SUNNY_BANKS_LOCATIONS } from "./sunnyBanks";

/** Same four genres and names as the project tiles (`SkidmarksProjectKind`). */
export type DeckLocationGenre = "sunnybank" | "music-video" | "skidmarks" | "adult-shorts";

export const DECK_LOCATION_GENRES: readonly DeckLocationGenre[] = ["sunnybank", "music-video", "skidmarks", "adult-shorts"];

export function isDeckLocationGenre(value: unknown): value is DeckLocationGenre {
  return typeof value === "string" && (DECK_LOCATION_GENRES as readonly string[]).includes(value);
}

export interface DeckLocation {
  /** `loc_<genre>_<key>`: readable, fixed when first saved. */
  id: string;
  genre: DeckLocationGenre;
  /** What a script's `[Location: …]` and saved rows point at (`park_site_4`).
   * Fixed when first saved, so a rename never breaks a script. */
  key: string;
  /** What Stuart sees ("Park Site 4"). */
  name: string;
  /** Deck Blob URL, or a repo file path (`/skidmarks/...`). `null` = no picture yet. */
  pictureUrl: string | null;
  createdAt: number;
  /** Ticked on the Locations row (2026-10-03): "People already in this
   * picture — don't add Cast". A pre-made plate is used as the shot's
   * start picture as it is: no Cast picture is laid onto it, one person
   * or several, silent or talking. Only ever `true`; unticked = absent. */
  peopleInPicture?: true;
}

export interface DeckLocationsState {
  locations: DeckLocation[];
}

export const DECK_LOCATION_NAME_MAX = 60;
/** Per genre, so the session row stays small. */
export const DECK_LOCATIONS_MAX_PER_GENRE = 80;
const KEY_MAX = 48;

export function emptyDeckLocationsState(): DeckLocationsState {
  return { locations: [] };
}

/** "Park Site 4" → `park_site_4`. The same shape as the built-in keys. */
export function deckLocationKeyFromName(name: string): string {
  return deckMediaSlug(name, "location").replace(/-/g, "_").slice(0, KEY_MAX).replace(/_+$/g, "") || "location";
}

export function isValidDeckLocationKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= KEY_MAX && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value);
}

export function deckLocationItemId(genre: DeckLocationGenre, key: string): string {
  return `loc_${genre.replace(/-/g, "_")}_${key}`;
}

/** The Blob genre folder (`adult-shorts` files live under `deck/shorts/`, like its characters). */
export function deckLocationMediaGenre(genre: DeckLocationGenre): DeckGenre {
  return genre === "adult-shorts" ? "shorts" : genre;
}

/** `deck/<genre>/locations/<location>` — the same for every genre. */
export function deckLocationPictureTarget(genre: DeckLocationGenre, key: string): DeckMediaTarget {
  return {
    folder: `${DECK_MEDIA_ROOT}/${deckLocationMediaGenre(genre)}/locations`,
    name: key.replace(/_/g, "-"),
  };
}

function cleanPictureUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (/^https:\/\//i.test(t)) return t;
  // Repo files only (the Sunnybank built-ins): a plain path, no `..`.
  if (/^\/skidmarks\/[a-z0-9/_-]+\.(jpg|jpeg|png|webp)$/i.test(t) && !t.includes("..")) return t;
  return null;
}

export function cleanDeckLocationName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, DECK_LOCATION_NAME_MAX) : "";
}

export function normalizeDeckLocation(value: unknown): DeckLocation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<DeckLocation>;
  if (!isDeckLocationGenre(v.genre) || !isValidDeckLocationKey(v.key)) return null;
  const name = cleanDeckLocationName(v.name);
  if (!name) return null;
  const id = deckLocationItemId(v.genre, v.key);
  if (typeof v.id === "string" && v.id !== id) return null;
  return {
    id,
    genre: v.genre,
    key: v.key,
    name,
    pictureUrl: cleanPictureUrl(v.pictureUrl),
    createdAt: typeof v.createdAt === "number" && Number.isFinite(v.createdAt) ? v.createdAt : 0,
    ...(v.peopleInPicture === true ? { peopleInPicture: true as const } : {}),
  };
}

export function normalizeDeckLocationsState(value: unknown): DeckLocationsState | null {
  if (!value || typeof value !== "object") return null;
  const list = (value as { locations?: unknown }).locations;
  if (!Array.isArray(list)) return emptyDeckLocationsState();
  const out: DeckLocation[] = [];
  const seen = new Set<string>();
  const perGenre = new Map<DeckLocationGenre, number>();
  for (const item of list) {
    const loc = normalizeDeckLocation(item);
    if (!loc || seen.has(loc.id)) continue;
    const n = perGenre.get(loc.genre) ?? 0;
    if (n >= DECK_LOCATIONS_MAX_PER_GENRE) continue;
    seen.add(loc.id);
    perGenre.set(loc.genre, n + 1);
    out.push(loc);
  }
  return { locations: out };
}

export function deckLocationsHaveUserContent(state: DeckLocationsState | null | undefined): boolean {
  return Boolean(state && state.locations.length > 0);
}

/** A genre's own built-ins. Only Sunnybank has any. */
export function builtInDeckLocations(genre: DeckLocationGenre): DeckLocation[] {
  if (genre !== "sunnybank") return [];
  return Object.values(SUNNY_BANKS_LOCATIONS).map((l, i) => ({
    id: deckLocationItemId("sunnybank", l.id),
    genre: "sunnybank" as const,
    key: l.id,
    name: l.label,
    pictureUrl: l.image,
    // Keeps the built-in order when the list is sorted by createdAt.
    createdAt: i + 1,
  }));
}

/** The genre's saved locations, in saved order. */
export function savedDeckLocations(state: DeckLocationsState | null | undefined, genre: DeckLocationGenre): DeckLocation[] {
  return (state?.locations ?? []).filter((l) => l.genre === genre);
}

/**
 * What the row and the renderer use: the saved list once the genre has
 * one, otherwise its built-ins (Sunnybank's nine; nothing elsewhere).
 */
export function effectiveDeckLocations(state: DeckLocationsState | null | undefined, genre: DeckLocationGenre): DeckLocation[] {
  const saved = savedDeckLocations(state, genre);
  return saved.length > 0 ? saved : builtInDeckLocations(genre);
}

/**
 * The saved list with this genre's built-ins copied in first, when it has
 * none saved yet — what the first edit on the row works on.
 */
export function withBuiltInsSaved(state: DeckLocationsState | null | undefined, genre: DeckLocationGenre): DeckLocationsState {
  const list = (state?.locations ?? []).slice();
  if (savedDeckLocations(state, genre).length === 0) list.push(...builtInDeckLocations(genre));
  return { locations: list };
}

/** A location by what a script or a saved row says: its key, its key
 * spelled loosely (`Park Site 4`, `park-site-4`), or its name. */
export function findDeckLocation(list: readonly DeckLocation[], token: string): DeckLocation | undefined {
  const t = token.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  const byKey = list.find((l) => l.key === t);
  if (byKey) return byKey;
  const asKey = deckLocationKeyFromName(t);
  const loose = list.find((l) => l.key === asKey);
  if (loose) return loose;
  const lower = t.toLowerCase();
  return list.find((l) => l.name.toLowerCase() === lower || deckLocationKeyFromName(l.name) === asKey);
}

export type DeckLocationEdit<T> = { ok: true; value: T } | { ok: false; error: string };

/** Checks a name for a new or renamed location in one genre. */
export function deckLocationNameProblem(
  list: readonly DeckLocation[],
  name: string,
  exceptId: string | null = null,
): string | null {
  const clean = cleanDeckLocationName(name);
  if (!clean) return "A location needs a name.";
  const key = deckLocationKeyFromName(clean);
  const clash = list.find(
    (l) => l.id !== exceptId && (l.name.toLowerCase() === clean.toLowerCase() || deckLocationKeyFromName(l.name) === key),
  );
  return clash ? `There's already a location called ${clash.name}.` : null;
}

/** A new location for `genre`, with a key nobody in the genre has yet. */
export function buildDeckLocation(
  genre: DeckLocationGenre,
  list: readonly DeckLocation[],
  name: string,
  pictureUrl: string | null,
  now: number = Date.now(),
): DeckLocationEdit<DeckLocation> {
  const problem = deckLocationNameProblem(list, name);
  if (problem) return { ok: false, error: problem };
  if (list.length >= DECK_LOCATIONS_MAX_PER_GENRE) return { ok: false, error: `Keep it to ${DECK_LOCATIONS_MAX_PER_GENRE} locations.` };
  const clean = cleanDeckLocationName(name);
  const base = deckLocationKeyFromName(clean);
  const taken = new Set(list.map((l) => l.key));
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return {
    ok: true,
    value: { id: deckLocationItemId(genre, key), genre, key, name: clean, pictureUrl: cleanPictureUrl(pictureUrl), createdAt: now },
  };
}

/** Two locations are the same thing for sorting a list. */
export function compareDeckLocations(a: DeckLocation, b: DeckLocation): number {
  return a.createdAt - b.createdAt || a.key.localeCompare(b.key);
}
