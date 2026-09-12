/**
 * Skidmarks "vibe director" front end — a stub project/chat model that
 * turns one free-text vibe brief into staged, abstract director copy
 * (Brief locked → Cast suggestions → an empty Plate board → the
 * Cast · Plates · Multi-angle · Voice · Animate · Stitch stage chips).
 *
 * Deliberately NOT wired to any real backend: no Comfy MCP, no
 * Seedance/LTX/ElevenLabs calls, no `skidmarks.aiglitch.app` Crash Lab.
 * Every "reply" here is templated from the brief text alone, entirely
 * client-side, so the chat feels alive without pretending to be an actual
 * render pipeline. See the README's "Skidmarks node" section.
 *
 * Persistence model mirrors `lib/control-plane.ts` / `lib/graphLayout.ts`:
 * an in-memory cache is the synchronous source of truth the UI reads via
 * `useSyncExternalStore` (`hooks/useSkidmarksProjects.ts`), mirrored to
 * `localStorage` (key: `the-tab:skidmarks-projects`) so a project's
 * thread survives a refresh. This is per-browser, invented-on-the-spot
 * content (a Stuart-typed vibe brief), not hand-authored seed data, so
 * `localStorage` fits better here than a `data/*.json` file — there's
 * nothing to seed ahead of time, unlike Budju/Propfolio's glances.
 */

const STORAGE_KEY = "the-tab:skidmarks-projects";
/** Most-recent-first project history cap — this is a v0 stub, not a real archive. */
const PROJECT_HISTORY_LIMIT = 8;

export type SkidmarksStage =
  | "cast"
  | "plates"
  | "multi-angle"
  | "voice"
  | "animate"
  | "stitch";

/** Display order for the stage chip row — matches Stuart's brief exactly. */
export const SKIDMARKS_STAGE_ORDER: SkidmarksStage[] = [
  "cast",
  "plates",
  "multi-angle",
  "voice",
  "animate",
  "stitch",
];

export const SKIDMARKS_STAGE_LABEL: Record<SkidmarksStage, string> = {
  cast: "Cast",
  plates: "Plates",
  "multi-angle": "Multi-angle",
  voice: "Voice",
  animate: "Animate",
  stitch: "Stitch",
};

/** One placeholder cast hold — a role guessed from the brief, not a real casting call. */
export interface SkidmarksCastStub {
  id: string;
  role: string;
  note: string;
}

/** One empty timeline/plate slot — reserved, nothing shot yet. */
export interface SkidmarksPlateSlot {
  id: string;
  label: string;
}

export type SkidmarksMessageKind =
  | "text"
  | "cast-cards"
  | "plate-board"
  | "stage-chips";

/**
 * One entry in a project's director-chat thread. `kind` drives which
 * extra payload (`castCards` / `plateSlots` / `stage`) is attached —
 * `SkidmarksChatThread` (the UI) switches on it to render text bubbles vs.
 * stub cards vs. the stage chip row.
 */
export interface SkidmarksMessage {
  id: string;
  role: "user" | "director";
  kind: SkidmarksMessageKind;
  /** Bubble copy — set for every kind (a short intro line for card/chip kinds too). */
  text?: string;
  at: number;
  castCards?: SkidmarksCastStub[];
  plateSlots?: SkidmarksPlateSlot[];
  /** Current stage as of this message, for `kind: "stage-chips"`. */
  stage?: SkidmarksStage;
}

export interface SkidmarksProject {
  id: string;
  brief: string;
  createdAt: number;
  stage: SkidmarksStage;
  cast: SkidmarksCastStub[];
  plates: SkidmarksPlateSlot[];
  messages: SkidmarksMessage[];
}

export interface SkidmarksState {
  /** Most-recent-first. */
  projects: SkidmarksProject[];
  activeProjectId: string | null;
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

function emptyState(): SkidmarksState {
  return { projects: [], activeProjectId: null };
}

/**
 * Very small keyword → cast-role guesser, just enough to make casting
 * suggestions feel like they read the brief instead of being totally
 * generic. Not real casting, not NLP — a fixed keyword table.
 */
const INSTRUMENT_HINTS: { keyword: string; role: string }[] = [
  { keyword: "sax", role: "Sax lead" },
  { keyword: "guitar", role: "Guitar" },
  { keyword: "drum", role: "Drums" },
  { keyword: "bass", role: "Bass" },
  { keyword: "vocal", role: "Vocals" },
  { keyword: "sing", role: "Vocals" },
  { keyword: "keys", role: "Keys" },
  { keyword: "piano", role: "Keys" },
  { keyword: "violin", role: "Violin" },
  { keyword: "dj", role: "DJ / decks" },
  { keyword: "dance", role: "Dancer" },
];

function castRolesFromBrief(brief: string): string[] {
  const lower = brief.toLowerCase();
  const found = INSTRUMENT_HINTS.filter((hint) => lower.includes(hint.keyword)).map(
    (hint) => hint.role
  );
  const unique = Array.from(new Set(found));
  return unique.length > 0 ? ["Frontperson", ...unique] : ["Frontperson", "Support cast"];
}

function buildCastStubs(brief: string): SkidmarksCastStub[] {
  return castRolesFromBrief(brief)
    .slice(0, 4)
    .map((role, i) => ({
      id: `cast-${i + 1}`,
      role,
      note: "Placeholder hold \u2014 real casting call hasn't gone out yet.",
    }));
}

const PLATE_SLOT_LABELS = [
  "Wide establishing",
  "Performance close-up",
  "Location B-roll",
  "Transition / cutaway",
];

function buildPlateSlots(): SkidmarksPlateSlot[] {
  return PLATE_SLOT_LABELS.map((label, i) => ({ id: `plate-${i + 1}`, label }));
}

function echoBrief(brief: string): string {
  const trimmed = brief.trim().replace(/\s+/g, " ");
  const snippet = trimmed.length > 140 ? `${trimmed.slice(0, 137)}\u2026` : trimmed;
  return `Brief locked \u2014 \u201c${snippet}\u201d. Starting casting.`;
}

/**
 * Pure builder: one vibe brief → a full project, staged messages and all.
 * No randomness, no network — the whole "director replies" script is
 * templated from `brief` alone, so the same brief always produces the
 * same stub project (useful for testing, and honest about there being no
 * real intelligence behind it yet).
 */
export function buildProjectFromBrief(brief: string): SkidmarksProject {
  const trimmedBrief = brief.trim();
  const id = generateId("skidmarks");
  const now = Date.now();
  const cast = buildCastStubs(trimmedBrief);
  const plates = buildPlateSlots();
  const stage: SkidmarksStage = "plates";

  const messages: SkidmarksMessage[] = [
    {
      id: generateId("msg"),
      role: "user",
      kind: "text",
      text: trimmedBrief,
      at: now,
    },
    {
      id: generateId("msg"),
      role: "director",
      kind: "text",
      text: echoBrief(trimmedBrief),
      at: now + 1,
    },
    {
      id: generateId("msg"),
      role: "director",
      kind: "cast-cards",
      text: "Casting call out \u2014 placeholder holds while the real call runs:",
      castCards: cast,
      at: now + 2,
    },
    {
      id: generateId("msg"),
      role: "director",
      kind: "plate-board",
      text: "Opened an empty plate board \u2014 timeline slots reserved, nothing shot yet:",
      plateSlots: plates,
      at: now + 3,
    },
    {
      id: generateId("msg"),
      role: "director",
      kind: "stage-chips",
      text: "Next: filling Plates, then multi-angle coverage, voice, animate, and stitch.",
      stage,
      at: now + 4,
    },
  ];

  return {
    id,
    brief: trimmedBrief,
    createdAt: now,
    stage,
    cast,
    plates,
    messages,
  };
}

function normalizeState(parsed: unknown): SkidmarksState {
  const p = (parsed ?? {}) as Partial<SkidmarksState>;
  const projects = Array.isArray(p.projects) ? (p.projects as SkidmarksProject[]) : [];
  const activeProjectId =
    typeof p.activeProjectId === "string" ? p.activeProjectId : null;
  return { projects, activeProjectId };
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

/**
 * Current projects snapshot, cached by reference so
 * `useSyncExternalStore` doesn't re-render on every read — only when
 * `createSkidmarksProject`/`setActiveSkidmarksProject` actually swap it out.
 */
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

/**
 * Builds a project from `brief`, makes it the active one, and prepends it
 * to the project history (capped at `PROJECT_HISTORY_LIMIT`) — this is
 * the "New project" flow's one entry point.
 */
export function createSkidmarksProject(brief: string): SkidmarksProject {
  const project = buildProjectFromBrief(brief);
  const current = getSkidmarksSnapshot();
  const projects = [project, ...current.projects].slice(0, PROJECT_HISTORY_LIMIT);
  persist({ projects, activeProjectId: project.id });
  return project;
}

/** Reopens a past project (from the history row) without touching its thread. */
export function setActiveSkidmarksProject(id: string): void {
  const current = getSkidmarksSnapshot();
  if (!current.projects.some((p) => p.id === id)) return;
  persist({ ...current, activeProjectId: id });
}

export function getActiveSkidmarksProject(
  state: SkidmarksState
): SkidmarksProject | undefined {
  return state.projects.find((p) => p.id === state.activeProjectId);
}
