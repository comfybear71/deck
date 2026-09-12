/**
 * Skidmarks "vibe director" — Music-video flow, locked through the MP3
 * step (see the README's "Skidmarks node (vibe director)" section).
 *
 * This is a deliberate rewrite of the earlier free-text "type a vibe
 * brief, get a scripted director-chat thread" build (PR #17/#18): the
 * locked mockups replace that with a concrete, appended-step wizard —
 * pick a project type, choose a band, cast its members, attach an MP3 —
 * all on **one continuous scroll**, not a chat thread and not separate
 * screens. Nothing here calls a real backend: no Comfy MCP, no
 * Seedance/LTX/ElevenLabs, no `skidmarks.aiglitch.app` Crash Lab, no
 * actual AI image generation for "looks". Every band, member, generated
 * look, and checklist tick is either hand-seeded or built by a pure,
 * deterministic mock helper below — good enough to demo the flow, honest
 * about not being real.
 *
 * Persistence mirrors `lib/control-plane.ts` / `lib/graphLayout.ts`: an
 * in-memory cache is the synchronous source of truth the UI reads via
 * `useSyncExternalStore` (`hooks/useSkidmarksStudio.ts`), mirrored to
 * `localStorage` (key: `the-tab:skidmarks-studio`) so progress through
 * the wizard survives a refresh. Explicitly out of scope for this build:
 * plates, multi-angle coverage, voice, animate, stitch — the flow stops
 * dead after the MP3 checklist.
 */

const STORAGE_KEY = "the-tab:skidmarks-studio";

/** Cap on how many bands "New" can pile up before we start dropping the
 * oldest — this is a v0 stub roster, not a real catalog. */
const BAND_HISTORY_LIMIT = 12;

/** Up to 3 members per band per the locked mock — matches the mockups
 * exactly (Rock Grok + Stew Balls + one open slot). */
export const MAX_MEMBERS_PER_BAND = 3;

/**
 * The landing's one horizontal row of three project-type tiles. Only
 * `music-video` is wired up in this build — `skidmarks` and `sunnybank`
 * render (per the locked mockup) but are inert, so the row reads
 * correctly without pretending those flows exist yet.
 */
export type SkidmarksProjectKind = "music-video" | "skidmarks" | "sunnybank";

export interface SkidmarksProjectKindMeta {
  kind: SkidmarksProjectKind;
  label: string;
  icon: "note" | "tire" | "sun";
  enabled: boolean;
}

export const SKIDMARKS_PROJECT_KINDS: SkidmarksProjectKindMeta[] = [
  { kind: "music-video", label: "Music video", icon: "note", enabled: true },
  { kind: "skidmarks", label: "Skidmarks", icon: "tire", enabled: false },
  { kind: "sunnybank", label: "Sunnybank", icon: "sun", enabled: false },
];

/** One generated "look" for a member — a stand-in for a real render.
 * `seed` just drives a deterministic gradient swatch in the UI; nothing
 * here is an actual image. */
export interface SkidmarksLook {
  id: string;
  seed: number;
  prompt: string;
  photoreal: number;
  createdAt: number;
}

export interface SkidmarksMember {
  id: string;
  name: string;
  /** Short role/note under the name, e.g. "Solo" — optional, matches the mockup. */
  role?: string;
  /** Placeholder avatar glyph until a look is generated. */
  emoji: string;
  looks: SkidmarksLook[];
}

export interface SkidmarksBand {
  id: string;
  name: string;
  tagline: string;
  /** Drives a deterministic album-cover gradient — see `coverGradientClass`. */
  coverSeed: number;
  /** Which little "edit cover" glyph this band's tile shows — cosmetic variety, matches the mockup. */
  editIcon: "pencil" | "camera";
  members: SkidmarksMember[];
}

export type SkidmarksChecklistKey = "lyrics" | "timing" | "ready";

export const SKIDMARKS_CHECKLIST_ORDER: SkidmarksChecklistKey[] = [
  "lyrics",
  "timing",
  "ready",
];

export const SKIDMARKS_CHECKLIST_LABEL: Record<SkidmarksChecklistKey, string> = {
  lyrics: "Lyrics",
  timing: "Timing",
  ready: "Ready",
};

/**
 * Staged "background sniff" delays (ms after attach) for each checklist
 * item — long enough to read as real analysis, short enough not to make
 * Stuart wait around. Lyrics reads as a speech-to-text-style pass (slower
 * than timing, which is just the file's own length), and Ready only ticks
 * once both are in. The actual `setTimeout` staging lives in
 * `hooks/useSkidmarksStudio.ts`, mirroring the reveal-timer pattern the
 * old chat build used.
 */
export const SKIDMARKS_CHECKLIST_DELAY_MS: Record<SkidmarksChecklistKey, number> = {
  timing: 900,
  lyrics: 2200,
  ready: 3000,
};

/** All-false checklist — shown under the MP3 card before anything's
 * attached yet, so the three chips are always present (just pending)
 * instead of popping into existence only once a file lands. */
export const EMPTY_SKIDMARKS_CHECKLIST: Record<SkidmarksChecklistKey, boolean> = {
  lyrics: false,
  timing: false,
  ready: false,
};

export interface SkidmarksMp3Attachment {
  fileName: string;
  /** Real duration (seconds) once probed from the picked file; null while probing or if probing failed. */
  durationSec: number | null;
  attachedAt: number;
  checklist: Record<SkidmarksChecklistKey, boolean>;
}

/** The Music-video wizard's progress — which project type, which band,
 * and (once chosen) the attached MP3. `null` fields mean "not reached
 * that step yet", so the UI knows exactly how much to append. */
export interface SkidmarksSession {
  projectKind: SkidmarksProjectKind | null;
  bandId: string | null;
  mp3: SkidmarksMp3Attachment | null;
}

export interface SkidmarksState {
  /** Seed bands + any "New" bands created this session, most-recent-first among the "New" ones. */
  bands: SkidmarksBand[];
  session: SkidmarksSession;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Hand-seeded album-cover bands for the "Choose a band" row — matches
 * the locked mockup's Jack Ash / Solar Rebel tiles exactly. */
const SEED_BANDS: SkidmarksBand[] = [
  {
    id: "jack-ash",
    name: "Jack Ash",
    tagline: "Dirt roads & bad decisions",
    coverSeed: 1,
    editIcon: "pencil",
    members: [
      { id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman", emoji: "\u{1F3B8}", looks: [] },
    ],
  },
  {
    id: "solar-rebel",
    name: "Solar Rebel",
    tagline: "Ignite the static",
    coverSeed: 2,
    editIcon: "camera",
    members: [
      { id: "solar-rebel-vocals", name: "Nova", role: "Vocals", emoji: "\u{1F31F}", looks: [] },
    ],
  },
];

function emptyState(): SkidmarksState {
  return {
    bands: SEED_BANDS,
    session: { projectKind: null, bandId: null, mp3: null },
  };
}

/**
 * Deterministic "New" band mock — matches the locked mockup's example
 * exactly (Grok Bot & the destroyers, Rock Grok already looked, Stew
 * Balls waiting on a first generate). Tapping "New" more than once in a
 * session just re-mints another copy of this same roster with a fresh
 * id, same spirit as `buildProjectFromBrief` always producing the same
 * stub output for the same input.
 */
export function buildNewMockBand(): SkidmarksBand {
  const bandId = generateId("band");
  return {
    id: bandId,
    name: "Grok Bot & the destroyers",
    tagline: "New band",
    coverSeed: Date.now(),
    editIcon: "pencil",
    members: [
      {
        id: generateId("member"),
        name: "Rock Grok",
        role: "Solo",
        emoji: "\u{1F916}",
        looks: [
          {
            id: generateId("look"),
            seed: 7,
            prompt: "chrome headphones, stage lights, leather jacket",
            photoreal: 80,
            createdAt: Date.now(),
          },
        ],
      },
      {
        id: generateId("member"),
        name: "Stew Balls",
        emoji: "\u{1F3B3}",
        looks: [],
      },
    ],
  };
}

/** Small pool of silly rockstar-ish add-on members — cycled through as
 * Stuart taps "+ Add member", capped at `MAX_MEMBERS_PER_BAND`. */
const ADD_MEMBER_POOL: { name: string; role?: string; emoji: string }[] = [
  { name: "Digi Fret", role: "Guitar", emoji: "\u{1F3B8}" },
  { name: "Ampy Sue", role: "Bass", emoji: "\u{1F3B5}" },
  { name: "Clatter Jax", role: "Drums", emoji: "\u{1F941}" },
  { name: "Vox Nova", role: "Vocals", emoji: "\u{1F3A4}" },
];

export function buildMockMember(existingCount: number): SkidmarksMember {
  const pick = ADD_MEMBER_POOL[existingCount % ADD_MEMBER_POOL.length];
  return {
    id: generateId("member"),
    name: pick.name,
    role: pick.role,
    emoji: pick.emoji,
    looks: [],
  };
}

/** Pure builder: a prompt + photoreal % → a new mock "look". No image
 * generation happens here — see the module doc comment. */
export function buildMockLook(prompt: string, photoreal: number): SkidmarksLook {
  return {
    id: generateId("look"),
    seed: Math.floor(Math.random() * 1_000_000),
    prompt: prompt.trim(),
    photoreal,
    createdAt: Date.now(),
  };
}

export function createMp3Attachment(
  fileName: string,
  durationSec: number | null
): SkidmarksMp3Attachment {
  return {
    fileName,
    durationSec,
    attachedAt: Date.now(),
    checklist: { lyrics: false, timing: false, ready: false },
  };
}

function normalizeState(parsed: unknown): SkidmarksState {
  const p = (parsed ?? {}) as Partial<SkidmarksState>;
  const seedIds = new Set(SEED_BANDS.map((b) => b.id));
  const storedBands = Array.isArray(p.bands) ? (p.bands as SkidmarksBand[]) : [];
  const extraBands = storedBands.filter((b) => b && !seedIds.has(b.id));
  const bands = [...SEED_BANDS.map((seed) => storedBands.find((b) => b?.id === seed.id) ?? seed), ...extraBands];
  const session: Partial<SkidmarksSession> = p.session ?? {};
  return {
    bands,
    session: {
      projectKind:
        typeof session.projectKind === "string"
          ? (session.projectKind as SkidmarksProjectKind)
          : null,
      bandId: typeof session.bandId === "string" ? session.bandId : null,
      mp3: (session.mp3 as SkidmarksMp3Attachment | null | undefined) ?? null,
    },
  };
}

function loadFromStorage(): SkidmarksState {
  if (!isBrowser()) return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

let cachedState: SkidmarksState | null = null;

export function getSkidmarksSnapshot(): SkidmarksState {
  if (!cachedState) cachedState = loadFromStorage();
  return cachedState;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function onStorageEvent(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return;
  cachedState = null;
  notify();
}

export function subscribeSkidmarks(listener: () => void): () => void {
  listeners.add(listener);
  if (isBrowser() && listeners.size === 1) {
    window.addEventListener("storage", onStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (isBrowser() && listeners.size === 0) {
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}

function persist(next: SkidmarksState) {
  cachedState = next;
  if (isBrowser()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (e.g. private mode) — in-memory only for this session.
    }
  }
  notify();
}

/** Landing tile tap — only `music-video` actually opens anything further;
 * the other two kinds are inert (see `SKIDMARKS_PROJECT_KINDS`), but we
 * still record the tap so a disabled tile can't silently no-op forever. */
export function selectSkidmarksProjectKind(kind: SkidmarksProjectKind): void {
  const current = getSkidmarksSnapshot();
  persist({ ...current, session: { ...current.session, projectKind: kind } });
}

/** Selects an already-known band (from the picker row) as the active one
 * for this session, resetting anything downstream (MP3) that belonged to
 * a previous band. */
export function selectSkidmarksBand(bandId: string): void {
  const current = getSkidmarksSnapshot();
  if (!current.bands.some((b) => b.id === bandId)) return;
  persist({
    ...current,
    session: { ...current.session, bandId, mp3: null },
  });
}

/** "New" tile tap — mints a fresh mock band, adds it to the roster, and
 * selects it. Capped at `BAND_HISTORY_LIMIT` (oldest non-seed band drops
 * first) so tapping "New" repeatedly doesn't grow the picker forever. */
export function createSkidmarksBand(): SkidmarksBand {
  const band = buildNewMockBand();
  const current = getSkidmarksSnapshot();
  const seedIds = new Set(SEED_BANDS.map((b) => b.id));
  const nonSeed = current.bands.filter((b) => !seedIds.has(b.id));
  const seed = current.bands.filter((b) => seedIds.has(b.id));
  const bands = [...seed, band, ...nonSeed].slice(
    0,
    seed.length + BAND_HISTORY_LIMIT
  );
  persist({
    bands,
    session: { ...current.session, bandId: band.id, mp3: null },
  });
  return band;
}

/** Appends a mock member to a band (capped at `MAX_MEMBERS_PER_BAND`) — the "+ Add member" pill. */
export function addSkidmarksMember(bandId: string): void {
  const current = getSkidmarksSnapshot();
  const band = current.bands.find((b) => b.id === bandId);
  if (!band || band.members.length >= MAX_MEMBERS_PER_BAND) return;
  const member = buildMockMember(band.members.length);
  const bands = current.bands.map((b) =>
    b.id === bandId ? { ...b, members: [...b.members, member] } : b
  );
  persist({ ...current, bands });
}

/** Prepends a freshly generated look onto a member — newest look reads
 * first in the horizontal scroll, same "most recent first" spirit as the
 * band/project history elsewhere in this file. */
export function addSkidmarksLook(
  bandId: string,
  memberId: string,
  look: SkidmarksLook
): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) => {
    if (b.id !== bandId) return b;
    return {
      ...b,
      members: b.members.map((m) =>
        m.id === memberId ? { ...m, looks: [look, ...m.looks] } : m
      ),
    };
  });
  persist({ ...current, bands });
}

/** The band tile's little pencil/camera "edit cover" glyph — this build
 * has no real image upload, so it just mints a new deterministic cover
 * gradient (see `coverGradientClass`) as a stand-in for "changed the art". */
export function cycleSkidmarksBandCover(bandId: string): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) =>
    b.id === bandId ? { ...b, coverSeed: b.coverSeed + 1 } : b
  );
  persist({ ...current, bands });
}

export function attachSkidmarksMp3(mp3: SkidmarksMp3Attachment): void {
  const current = getSkidmarksSnapshot();
  persist({ ...current, session: { ...current.session, mp3 } });
}

/** Fills in the real duration once the browser's `<audio>` metadata probe
 * resolves — attach happens immediately with `durationSec: null` so the
 * card can render right away instead of waiting on the probe. */
export function setSkidmarksMp3Duration(durationSec: number): void {
  const current = getSkidmarksSnapshot();
  if (!current.session.mp3) return;
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: { ...current.session.mp3, durationSec },
    },
  });
}

export function clearSkidmarksMp3(): void {
  const current = getSkidmarksSnapshot();
  if (!current.session.mp3) return;
  persist({ ...current, session: { ...current.session, mp3: null } });
}

/** Flips one checklist key to done — called by the staged "background
 * sniff" timers in `hooks/useSkidmarksStudio.ts`, never straight from user input. */
export function markSkidmarksChecklistDone(key: SkidmarksChecklistKey): void {
  const current = getSkidmarksSnapshot();
  if (!current.session.mp3 || current.session.mp3.checklist[key]) return;
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: {
        ...current.session.mp3,
        checklist: { ...current.session.mp3.checklist, [key]: true },
      },
    },
  });
}

export function getActiveSkidmarksBand(
  state: SkidmarksState
): SkidmarksBand | undefined {
  return state.bands.find((b) => b.id === state.session.bandId);
}

/** Deterministic album-cover gradient class for a band tile, keyed off
 * `coverSeed` — a small fixed palette so covers stay visually distinct
 * without needing real artwork. */
const COVER_GRADIENTS = [
  "from-rose-600/70 via-red-900/70 to-black",
  "from-indigo-600/70 via-purple-900/70 to-black",
  "from-fuchsia-600/70 via-pink-900/70 to-black",
  "from-amber-600/70 via-orange-900/70 to-black",
  "from-emerald-600/70 via-teal-900/70 to-black",
  "from-sky-600/70 via-blue-900/70 to-black",
];

export function coverGradientClass(coverSeed: number): string {
  const idx = Math.abs(Math.floor(coverSeed)) % COVER_GRADIENTS.length;
  return COVER_GRADIENTS[idx];
}

/** Deterministic look-swatch gradient, keyed off a look's `seed` — same
 * "no real art, just a distinct color" trick as `coverGradientClass`. */
const LOOK_GRADIENTS = [
  "from-rose-400/80 to-purple-700/80",
  "from-amber-400/80 to-rose-700/80",
  "from-sky-400/80 to-indigo-700/80",
  "from-emerald-400/80 to-teal-700/80",
  "from-pink-400/80 to-fuchsia-700/80",
];

export function lookGradientClass(seed: number): string {
  const idx = Math.abs(Math.floor(seed)) % LOOK_GRADIENTS.length;
  return LOOK_GRADIENTS[idx];
}

/**
 * Deterministic decorative waveform bar heights (0..1), seeded off the
 * file name so the same MP3 always draws the same shape — there's no
 * real audio analysis behind this, just a stand-in for "compact
 * waveform" per the locked mockup.
 */
export function waveformBars(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = (h % 1000) / 1000;
    // Bias toward the middle of the range so the row doesn't look like
    // pure noise — a little low/high variety, not a flat line either.
    bars.push(0.25 + base * 0.7);
  }
  return bars;
}

/** mm:ss, floors to whole seconds — used for the MP3 card's duration and
 * (once wired) playhead. */
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) return "--:--";
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * One-line glance for `SkidmarksNodeCard` — deliberately terse. "idle"
 * when nothing's picked yet, "in-progress" once a band or MP3 exists,
 * "ready" once every checklist item ticks.
 */
export function skidmarksGlance(state: SkidmarksState): {
  status: "idle" | "in-progress" | "ready";
  label: string;
} {
  const band = getActiveSkidmarksBand(state);
  const mp3 = state.session.mp3;
  if (mp3 && SKIDMARKS_CHECKLIST_ORDER.every((k) => mp3.checklist[k])) {
    return { status: "ready", label: `${band?.name ?? "Music video"} \u00b7 ready` };
  }
  if (band) {
    return { status: "in-progress", label: `Directing \u00b7 ${band.name}` };
  }
  if (state.session.projectKind) {
    return { status: "in-progress", label: "Choosing a band\u2026" };
  }
  return { status: "idle", label: "No project yet" };
}
