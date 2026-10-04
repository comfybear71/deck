/**
 * Skidmarks episodes (stage 1, 2026-09-27) — the data model behind the
 * Skidmarks landing tile. Every episode follows the same nine-beat spine
 * as the old Crash Lab (`skidmarks` repo `src/lib/storySpine.ts`), with an
 * intro (theme sting + title) and outro (credits + sting out) either side.
 *
 * Stored on the existing Neon session row (`SkidmarksState.skidmarksEpisodes`),
 * same as Sunny Banks — no new table, no `localStorage`. Scripts and cast
 * names only; nothing here spends money. Faces/voices (stage 2) and plates
 * (stage 3) hang off the ids defined here later.
 *
 * Cast rule: every character must be made up and clearly adult — no real
 * person's likeness or name. Adding a character requires ticking that.
 */
import { effectiveDeckLocations, type DeckLocationsState } from "./deckLocations";
import { isSafeDeckMediaSlug } from "./deckMediaPaths";

export type SkidmarksBeatId =
  | "intro"
  | "b1"
  | "b2"
  | "b3"
  | "b4"
  | "b5"
  | "b6"
  | "b7"
  | "b8"
  | "b9"
  | "outro";

export interface SkidmarksBeatMeta {
  id: SkidmarksBeatId;
  /** Number shown on the card ("1".."9"), or null for intro/outro. */
  number: number | null;
  label: string;
  hint: string;
  defaultDurationSec: number;
  /** Beat 8 — the antihero's death. */
  isDeath?: boolean;
  isBookend?: boolean;
}

export const SKIDMARKS_BEATS: readonly SkidmarksBeatMeta[] = [
  { id: "intro", number: null, label: "Intro", hint: "Theme sting, title whoosh", defaultDurationSec: 15, isBookend: true },
  { id: "b1", number: 1, label: "He shows up", hint: "Introduce the antihero in his natural habitat", defaultDurationSec: 50 },
  { id: "b2", number: 2, label: "Gets worse", hint: "Establish him as a proper arsehole", defaultDurationSec: 60 },
  { id: "b3", number: 3, label: "Keeps proving it", hint: "A run of small cruelties", defaultDurationSec: 80 },
  { id: "b4", number: 4, label: "Gets a beat down", hint: "Only about three quarters of the way", defaultDurationSec: 50 },
  { id: "b5", number: 5, label: "Fake win", hint: "An unearned golden gift", defaultDurationSec: 50 },
  { id: "b6", number: 6, label: "Believes it", hint: "He thinks he deserves it", defaultDurationSec: 50 },
  { id: "b7", number: 7, label: "Loses it", hint: "It's ripped away", defaultDurationSec: 60 },
  { id: "b8", number: 8, label: "Gets smashed", hint: "The real ending: the antihero dies (cartoon death)", defaultDurationSec: 60, isDeath: true },
  { id: "b9", number: 9, label: "End state", hint: "Gone, or frozen on that frame", defaultDurationSec: 30 },
  { id: "outro", number: null, label: "Outro", hint: "Credits, sting out", defaultDurationSec: 20, isBookend: true },
] as const;

export const SKIDMARKS_BEAT_IDS: readonly SkidmarksBeatId[] = SKIDMARKS_BEATS.map((b) => b.id);

export type SkidmarksCastRole = "antihero" | "supporting";

export interface SkidmarksCastMember {
  id: string;
  name: string;
  role: SkidmarksCastRole;
  /** Short default look, used by the `[Name: look]` tag. */
  look: string;
  /** Ticked when added: made up, clearly adult, not a real person. */
  fictionalAdultConfirmed: true;
  createdAt: number;
  /** Uploaded pictures of them (Blob https URLs), first one is the main picture. */
  pictureUrls?: string[];
  /** An animal character (owl, pig cop, street cat): prompts say "animal", not "person". */
  isAnimal?: boolean;
  /**
   * The episode this Cast card belongs to (2026-10-04, Stuart: each
   * Skidmarks episode has its own Cast): that episode's pinned media
   * folder name (`ep01-the-big-wet`). Cards made before then have none
   * and belong to the pilot (`lib/skidmarksEpisodeCast.ts`).
   */
  episode?: string;
}

export interface SkidmarksEpisodeBeat {
  script: string;
  durationSec: number;
}

export interface SkidmarksEpisode {
  id: string;
  title: string;
  antiheroId: string | null;
  castIds: string[];
  beats: Record<SkidmarksBeatId, SkidmarksEpisodeBeat>;
  createdAt: number;
  updatedAt: number;
}

export interface SkidmarksEpisodesState {
  episodes: SkidmarksEpisode[];
  cast: SkidmarksCastMember[];
}

export const SKIDMARKS_EPISODE_TARGET_MIN_SEC = 8 * 60;
export const SKIDMARKS_EPISODE_TARGET_MAX_SEC = 10 * 60;

/** Starter text per beat — the "template". Beat 1 carries the opening plate. */
export const SKIDMARKS_STARTER_SCRIPTS: Record<SkidmarksBeatId, string> = {
  intro: "[Shot: title card]\n[SFX: theme sting, title whoosh]",
  b1: "[Location: ]\n[Shot: wide establishing]\n",
  b2: "",
  b3: "",
  b4: "",
  b5: "",
  b6: "",
  b7: "",
  b8: "",
  b9: "",
  outro: "[Shot: credits roll]\n[SFX: sting out]",
};

export function mintSkidmarksId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildStarterBeats(): Record<SkidmarksBeatId, SkidmarksEpisodeBeat> {
  const beats = {} as Record<SkidmarksBeatId, SkidmarksEpisodeBeat>;
  for (const meta of SKIDMARKS_BEATS) {
    beats[meta.id] = { script: SKIDMARKS_STARTER_SCRIPTS[meta.id], durationSec: meta.defaultDurationSec };
  }
  return beats;
}

export function buildStarterEpisode(title: string, now: number = Date.now(), id = mintSkidmarksId("ep")): SkidmarksEpisode {
  return {
    id,
    title: title.trim() || "Untitled episode",
    antiheroId: null,
    castIds: [],
    beats: buildStarterBeats(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A new cast member from the Characters screen's "Add a Skidmarks
 * character" box. Only called after Stuart ticks made-up adult.
 */
export function buildSkidmarksCastMember(
  name: string,
  look: string,
  role: SkidmarksCastRole = "supporting",
  now: number = Date.now(),
  id = mintSkidmarksId("cast"),
  extra: { pictureUrls?: readonly string[]; isAnimal?: boolean; episode?: string | null } = {},
): SkidmarksCastMember {
  const member: SkidmarksCastMember = { id, name: name.trim(), role, look: look.trim(), fictionalAdultConfirmed: true, createdAt: now };
  const pictures = cleanPictureUrls(extra.pictureUrls);
  if (pictures.length) member.pictureUrls = pictures;
  if (extra.isAnimal) member.isAnimal = true;
  if (isSafeDeckMediaSlug(extra.episode)) member.episode = extra.episode;
  return member;
}

/** At most this many uploaded pictures are kept per cast member. */
export const SKIDMARKS_CAST_MAX_PICTURES = 12;

export function cleanPictureUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const u of value) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    if (!/^(https:\/\/|data:image\/)/i.test(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= SKIDMARKS_CAST_MAX_PICTURES) break;
  }
  return out;
}

/**
 * A character name from an uploaded file name: "Clive 3.jpg" and
 * "clive_3.jpeg" both become "Clive", so numbered pictures of the same
 * person group together.
 */
export function castNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ");
  const noNumber = base.replace(/[\s\-(]*\d+\)?\s*$/, "").trim();
  const name = (noNumber || base).replace(/\s+/g, " ").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

export function emptySkidmarksEpisodesState(): SkidmarksEpisodesState {
  return { episodes: [], cast: [] };
}

export function nextEpisodeTitle(episodes: readonly SkidmarksEpisode[]): string {
  let max = 0;
  for (const ep of episodes) {
    const m = /^EP(\d+)/i.exec(ep.title.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `EP${String(max + 1).padStart(2, "0")} · New episode`;
}

export function episodeTotalSec(ep: SkidmarksEpisode): number {
  return SKIDMARKS_BEAT_IDS.reduce((sum, id) => sum + (ep.beats[id]?.durationSec ?? 0), 0);
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Beats with something written beyond the starter template. */
export function filledBeatCount(ep: SkidmarksEpisode): number {
  return SKIDMARKS_BEATS.filter((m) => m.number !== null).filter((m) => {
    const script = (ep.beats[m.id]?.script ?? "").trim();
    return script.length > 0 && script !== SKIDMARKS_STARTER_SCRIPTS[m.id].trim();
  }).length;
}

/** An antihero dies in the episode that uses them — so one episode each. */
export function episodeWhereAntiheroDies(
  castId: string,
  episodes: readonly SkidmarksEpisode[]
): SkidmarksEpisode | null {
  return episodes.find((ep) => ep.antiheroId === castId) ?? null;
}

/** Antiheroes free to headline `forEpisodeId` (not already used elsewhere). */
export function availableAntiheroes(
  state: SkidmarksEpisodesState,
  forEpisodeId: string
): SkidmarksCastMember[] {
  return state.cast.filter((c) => {
    if (c.role !== "antihero") return false;
    const used = episodeWhereAntiheroDies(c.id, state.episodes);
    return !used || used.id === forEpisodeId;
  });
}

/** Tag-bar entries: the generic tags, then one per cast member in the episode. */
export function tagBarEntries(
  ep: SkidmarksEpisode,
  cast: readonly SkidmarksCastMember[],
  /** The session's locations (2026-09-30): each Skidmarks one on the
   * Locations row gets its own ready-made `[Location: Name]` tag. */
  locations?: DeckLocationsState | null,
): { label: string; insert: string }[] {
  const base = [
    { label: "[Character: look]", insert: "[Character: look] " },
    { label: "[Location:]", insert: "[Location: ]" },
    { label: "[Shot:]", insert: "[Shot: ]" },
    { label: "[SFX:]", insert: "[SFX: ]" },
    { label: "[Action:]", insert: "[Action: ]" },
  ];
  const ids = [ep.antiheroId, ...ep.castIds].filter((id): id is string => Boolean(id));
  const seen = new Set<string>();
  const people: { label: string; insert: string }[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const member = cast.find((c) => c.id === id);
    if (!member) continue;
    const look = member.look.trim();
    people.push({ label: `[${member.name}]`, insert: `[${member.name}: ${look || "look"}] ` });
  }
  const places = effectiveDeckLocations(locations, "skidmarks").map((l) => ({
    label: `[${l.name}]`,
    insert: `[Location: ${l.name}] `,
  }));
  return [...people, ...places, ...base];
}

/** Inserts `text` into `value` at the selection, returning the new value and caret. */
export function insertAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  text: string
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  // A tag that starts a new idea goes on its own line when inserted mid-line after text.
  const before = value.slice(0, start);
  const needsNewline = before.length > 0 && !before.endsWith("\n") && !before.endsWith(" ") && text.startsWith("[");
  const insert = needsNewline ? `\n${text}` : text;
  const next = before + insert + value.slice(end);
  // Caret lands inside an empty "[X: ]" so you can type the value straight away.
  const emptyTag = /: \]$/.test(insert);
  const caret = before.length + insert.length - (emptyTag ? 1 : 0);
  return { value: next, caret };
}

function normalizeBeat(value: unknown, id: SkidmarksBeatId): SkidmarksEpisodeBeat {
  const meta = SKIDMARKS_BEATS.find((b) => b.id === id)!;
  const v = (value && typeof value === "object" ? value : {}) as Partial<SkidmarksEpisodeBeat>;
  const script = typeof v.script === "string" ? v.script : SKIDMARKS_STARTER_SCRIPTS[id];
  const durationSec =
    typeof v.durationSec === "number" && Number.isFinite(v.durationSec) && v.durationSec >= 0
      ? Math.min(Math.round(v.durationSec), 30 * 60)
      : meta.defaultDurationSec;
  return { script, durationSec };
}

function normalizeEpisode(value: unknown): SkidmarksEpisode | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SkidmarksEpisode>;
  if (typeof v.id !== "string" || !v.id) return null;
  const rawBeats = (v.beats && typeof v.beats === "object" ? v.beats : {}) as Record<string, unknown>;
  const beats = {} as Record<SkidmarksBeatId, SkidmarksEpisodeBeat>;
  for (const id of SKIDMARKS_BEAT_IDS) beats[id] = normalizeBeat(rawBeats[id], id);
  const now = Date.now();
  return {
    id: v.id,
    title: typeof v.title === "string" && v.title.trim() ? v.title : "Untitled episode",
    antiheroId: typeof v.antiheroId === "string" && v.antiheroId ? v.antiheroId : null,
    castIds: Array.isArray(v.castIds) ? v.castIds.filter((x): x is string => typeof x === "string" && x.length > 0) : [],
    beats,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : now,
    updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : now,
  };
}

function normalizeCast(value: unknown): SkidmarksCastMember | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SkidmarksCastMember>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (typeof v.name !== "string" || !v.name.trim()) return null;
  // Never load a character that wasn't confirmed made-up and adult.
  if (v.fictionalAdultConfirmed !== true) return null;
  return {
    id: v.id,
    name: v.name.trim(),
    role: v.role === "antihero" ? "antihero" : "supporting",
    look: typeof v.look === "string" ? v.look : "",
    fictionalAdultConfirmed: true,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
    ...(cleanPictureUrls(v.pictureUrls).length ? { pictureUrls: cleanPictureUrls(v.pictureUrls) } : {}),
    ...(v.isAnimal === true ? { isAnimal: true } : {}),
    ...(isSafeDeckMediaSlug(v.episode) ? { episode: v.episode } : {}),
  };
}

export function normalizeSkidmarksEpisodesState(value: unknown): SkidmarksEpisodesState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SkidmarksEpisodesState>;
  const cast = Array.isArray(v.cast)
    ? v.cast.map(normalizeCast).filter((c): c is SkidmarksCastMember => c !== null)
    : [];
  const castIds = new Set(cast.map((c) => c.id));
  const episodes = Array.isArray(v.episodes)
    ? v.episodes
        .map(normalizeEpisode)
        .filter((e): e is SkidmarksEpisode => e !== null)
        .map((e) => ({
          ...e,
          antiheroId: e.antiheroId && castIds.has(e.antiheroId) ? e.antiheroId : null,
          castIds: e.castIds.filter((id) => castIds.has(id) && id !== e.antiheroId),
        }))
    : [];
  return { episodes, cast };
}

export function skidmarksEpisodesHaveUserContent(state: SkidmarksEpisodesState | null | undefined): boolean {
  return Boolean(state && (state.episodes.length > 0 || state.cast.length > 0));
}

/**
 * One episode cleaned the same way the session loader cleans it, or
 * `null` if it isn't one. Used by per-item saving (`deck_items`, kind
 * `skidmarks-episode`) so an episode row and the session copy always
 * compare field for field. Cast ids are kept as they are here; the
 * session loader drops ones whose cast member is gone.
 */
export function normalizeSkidmarksEpisode(value: unknown): SkidmarksEpisode | null {
  return normalizeEpisode(value);
}
