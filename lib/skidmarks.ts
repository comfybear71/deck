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
  /** A real photo Stuart picked for this member (data URL, resized client-side —
   * see `readImageFileAsDataUrl`). Takes priority over both `emoji` and any
   * generated look in the avatar — it's his actual picture, not a mock. */
  avatarImage?: string;
  looks: SkidmarksLook[];
}

export interface SkidmarksBand {
  id: string;
  name: string;
  tagline: string;
  /** Drives a deterministic album-cover gradient — see `coverGradientClass`.
   * Only used while `coverImage` is unset. */
  coverSeed: number;
  /** A real cover image Stuart picked for this band (data URL, resized
   * client-side — see `readImageFileAsDataUrl`). Takes priority over the
   * mock gradient in the band tile once set. */
  coverImage?: string;
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
  /** Ids of hand-seeded `SEED_BANDS` entries Stuart has deleted — tracked
   * separately from `bands` (which only ever holds *live* bands) so a
   * seed band stays gone after a delete instead of being re-minted from
   * `SEED_BANDS` on the next `normalizeState` pass. */
  removedSeedBandIds: string[];
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
    removedSeedBandIds: [],
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

/** A freshly cast member — no name, role, or emoji until the user fills
 * them in (via the generate popup's name field) or generates a look.
 * "+ Add member" always mints one of these; nothing here invents a
 * persona (name, role, or icon) on the user's behalf. */
export function buildBlankMember(): SkidmarksMember {
  return {
    id: generateId("member"),
    name: "",
    emoji: "",
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
  const removedSeedBandIds = Array.isArray(p.removedSeedBandIds)
    ? p.removedSeedBandIds.filter((id): id is string => typeof id === "string")
    : [];
  const removedSeedSet = new Set(removedSeedBandIds);
  const seedIds = new Set(SEED_BANDS.map((b) => b.id));
  const storedBands = Array.isArray(p.bands) ? (p.bands as SkidmarksBand[]) : [];
  const extraBands = storedBands.filter((b) => b && !seedIds.has(b.id));
  const bands = [
    ...SEED_BANDS.filter((seed) => !removedSeedSet.has(seed.id)).map(
      (seed) => storedBands.find((b) => b?.id === seed.id) ?? seed
    ),
    ...extraBands,
  ];
  const session: Partial<SkidmarksSession> = p.session ?? {};
  const bandId = typeof session.bandId === "string" ? session.bandId : null;
  const stillHasBand = bandId !== null && bands.some((b) => b.id === bandId);
  return {
    bands,
    removedSeedBandIds,
    session: {
      projectKind:
        typeof session.projectKind === "string"
          ? (session.projectKind as SkidmarksProjectKind)
          : null,
      bandId: stillHasBand ? bandId : null,
      mp3: stillHasBand ? (session.mp3 as SkidmarksMp3Attachment | null | undefined) ?? null : null,
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
    ...current,
    bands,
    session: { ...current.session, bandId: band.id, mp3: null },
  });
  return band;
}

/** Removes a band outright — the trash glyph on each existing band tile
 * (never shown on the "New" tile, which doesn't correspond to a band
 * yet). If the deleted band was hand-seeded (`SEED_BANDS`), its id is
 * recorded in `removedSeedBandIds` so `normalizeState` doesn't re-mint
 * it from the hardcoded seed list on the next load — a deleted seed band
 * stays deleted. If the deleted band was the active session band, the
 * session's `bandId`/`mp3` reset to `null` (same "downstream resets"
 * behavior as switching bands via `selectSkidmarksBand`). */
export function removeSkidmarksBand(bandId: string): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.filter((b) => b.id !== bandId);
  const isSeed = SEED_BANDS.some((b) => b.id === bandId);
  const removedSeedBandIds = isSeed
    ? Array.from(new Set([...current.removedSeedBandIds, bandId]))
    : current.removedSeedBandIds;
  const wasActive = current.session.bandId === bandId;
  persist({
    bands,
    removedSeedBandIds,
    session: wasActive
      ? { ...current.session, bandId: null, mp3: null }
      : current.session,
  });
}

/** Appends a blank member to a band (capped at `MAX_MEMBERS_PER_BAND`) — the "+ Add member" pill. */
export function addSkidmarksMember(bandId: string): void {
  const current = getSkidmarksSnapshot();
  const band = current.bands.find((b) => b.id === bandId);
  if (!band || band.members.length >= MAX_MEMBERS_PER_BAND) return;
  const member = buildBlankMember();
  const bands = current.bands.map((b) =>
    b.id === bandId ? { ...b, members: [...b.members, member] } : b
  );
  persist({ ...current, bands });
}

/** Removes a member from a band — the per-row trash/× control. No cap
 * bookkeeping needed here; freeing a slot just lets "+ Add member"
 * reappear once the band drops back under `MAX_MEMBERS_PER_BAND`. */
export function removeSkidmarksMember(bandId: string, memberId: string): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) =>
    b.id === bandId
      ? { ...b, members: b.members.filter((m) => m.id !== memberId) }
      : b
  );
  persist({ ...current, bands });
}

/** Sets a member's display name — how a blank "+ Add member" row gets
 * filled in, via the generate popup's name field. */
export function renameSkidmarksMember(
  bandId: string,
  memberId: string,
  name: string
): void {
  const current = getSkidmarksSnapshot();
  const trimmed = name.trim();
  const bands = current.bands.map((b) => {
    if (b.id !== bandId) return b;
    return {
      ...b,
      members: b.members.map((m) =>
        m.id === memberId ? { ...m, name: trimmed } : m
      ),
    };
  });
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

/** The band tile's pencil/camera "edit cover" glyph — sets a real cover
 * image Stuart picked from his device (already resized to a data URL by
 * `readImageFileAsDataUrl`), replacing the mock gradient on that tile. */
export function setSkidmarksBandCoverImage(bandId: string, dataUrl: string): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) =>
    b.id === bandId ? { ...b, coverImage: dataUrl } : b
  );
  persist({ ...current, bands });
}

/** Sets a member's real avatar photo (already resized to a data URL by
 * `readImageFileAsDataUrl`) — picked directly, not generated. Takes
 * priority over any generated look in `MemberAvatar`. */
export function setSkidmarksMemberAvatarImage(
  bandId: string,
  memberId: string,
  dataUrl: string
): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) => {
    if (b.id !== bandId) return b;
    return {
      ...b,
      members: b.members.map((m) =>
        m.id === memberId ? { ...m, avatarImage: dataUrl } : m
      ),
    };
  });
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

/** Longest edge a picked cover/avatar image gets downscaled to before
 * being stored — real photos straight off a phone can be several MB;
 * this keeps `localStorage` (a few MB quota, shared with everything
 * else this app persists) from filling up after a handful of picks. */
const MAX_PICKED_IMAGE_DIMENSION = 640;
const PICKED_IMAGE_QUALITY = 0.85;

/**
 * Reads a picked image file (jpg/png/webp), downscales it to fit within
 * `MAX_PICKED_IMAGE_DIMENSION` on its longest edge, and re-encodes it as
 * a JPEG data URL — a data URL (unlike a blob URL) round-trips through
 * `localStorage` just fine, so a real picked cover/avatar survives a
 * page reload. Used by both the band cover picker and the member avatar
 * picker. Rejects if the browser can't decode the file (not an image,
 * or a format it doesn't support).
 */
export function readImageFileAsDataUrl(
  file: File,
  maxDimension: number = MAX_PICKED_IMAGE_DIMENSION,
  quality: number = PICKED_IMAGE_QUALITY
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the picked file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the picked image."));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          // No canvas 2D context available — fall back to the untouched
          // original data URL rather than failing the pick outright.
          resolve(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
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
