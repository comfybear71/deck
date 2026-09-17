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
 */
import { getSunnyBanksLocation, type SunnyBanksLocationId } from "./sunnyBanks";
import { buildSunnyBanksDropBearsSeed, DROP_BEARS_TITLE } from "./sunnyBanksDropBears";

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
}

export interface SunnyBanksLiveState {
  workspaceTitle: string;
  defaultLocationId: SunnyBanksLocationId;
  actIds: SunnyBanksActId[];
  activeAct: SunnyBanksActId;
  actScripts: SunnyBanksActKeyed<string>;
  characterOverrides: SunnyBanksActKeyed<Record<number, string>>;
  locationOverrides: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: SunnyBanksActKeyed<Record<number, SunnyBanksRowRuntime>>;
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
  runtimeMap: SunnyBanksActKeyed<Record<number, SunnyBanksRowRuntime>>;
}

export interface SkidmarksSunnyBanksState {
  live: SunnyBanksLiveState;
  workspaces: SunnyBanksWorkspaceSnapshot[];
  saveSeq: number;
}

export function cloneActRecord<T>(value: SunnyBanksActKeyed<T>, actIds?: readonly string[]): SunnyBanksActKeyed<T> {
  const keys = actIds ?? Object.keys(value);
  const next: SunnyBanksActKeyed<T> = {};
  for (const act of keys) {
    if (act in value) next[act] = structuredClone(value[act]);
  }
  return next;
}

export function cloneSunnyBanksLive(live: SunnyBanksLiveState): SunnyBanksLiveState {
  return {
    workspaceTitle: live.workspaceTitle,
    defaultLocationId: live.defaultLocationId,
    actIds: [...live.actIds],
    activeAct: live.activeAct,
    actScripts: cloneActRecord(live.actScripts, live.actIds),
    characterOverrides: cloneActRecord(live.characterOverrides, live.actIds),
    locationOverrides: cloneActRecord(live.locationOverrides, live.actIds),
    runtimeMap: cloneActRecord(live.runtimeMap, live.actIds),
  };
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
    runtimeMap: workspace.runtimeMap,
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
    locationOverrides: cloneActRecord(seed.locationOverrides, actIds),
    runtimeMap: cloneActRecord(seed.runtimeMap as SunnyBanksLiveState["runtimeMap"], actIds),
  };
}

/** djb2 of the snapshot payload — same scripts + same clip URLs hash
 * the same. Used as part of the workspace id and to tell seed-equal
 * live apart from real user work. */
export function fingerprintWorkspace(snapshot: {
  defaultLocationId: string;
  actIds: readonly string[];
  activeAct: string;
  actScripts: SunnyBanksActKeyed<string>;
  characterOverrides: SunnyBanksActKeyed<Record<number, string>>;
  locationOverrides: SunnyBanksActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: SunnyBanksActKeyed<Record<number, SunnyBanksRowRuntime>>;
}): string {
  const payload = JSON.stringify(snapshot);
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

export function upsertSunnyBanksWorkspace(
  workspaces: readonly SunnyBanksWorkspaceSnapshot[],
  snapshot: SunnyBanksWorkspaceSnapshot
): SunnyBanksWorkspaceSnapshot[] {
  const key = snapshot.label.trim().toLowerCase();
  const index = workspaces.findIndex((workspace) => workspace.label.trim().toLowerCase() === key);
  if (index < 0) return [snapshot, ...workspaces];
  const keptId = workspaces[index].id;
  const updated: SunnyBanksWorkspaceSnapshot = { ...snapshot, id: keptId };
  return [updated, ...workspaces.filter((_, i) => i !== index)];
}

function normalizeLocationId(value: unknown, fallback: SunnyBanksLocationId): SunnyBanksLocationId {
  if (typeof value !== "string") return fallback;
  return getSunnyBanksLocation(value)?.id ?? fallback;
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
    const located = typeof raw === "string" ? getSunnyBanksLocation(raw) : undefined;
    if (located) next[index] = located.id;
    else if (typeof raw === "string") next[index] = fallback;
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

export function normalizeSunnyBanksLive(value: unknown): SunnyBanksLiveState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SunnyBanksLiveState>;
  const fallback = buildDefaultSunnyBanksLive();
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
  const characterOverrides: SunnyBanksLiveState["characterOverrides"] = {};
  const locationOverrides: SunnyBanksLiveState["locationOverrides"] = {};
  const runtimeMap: SunnyBanksLiveState["runtimeMap"] = {};
  for (const act of ids) {
    characterOverrides[act] = normalizeStringMap((characterRaw as Record<string, unknown>)[act]);
    locationOverrides[act] = normalizeLocationMap((locationRaw as Record<string, unknown>)[act], defaultLocationId);
    runtimeMap[act] = normalizeRuntimeMap((runtimeRaw as Record<string, unknown>)[act]);
  }
  return {
    workspaceTitle: typeof v.workspaceTitle === "string" ? v.workspaceTitle : fallback.workspaceTitle,
    defaultLocationId,
    actIds: [...ids],
    activeAct,
    actScripts: normalizeActScripts(v.actScripts, ids),
    characterOverrides,
    locationOverrides,
    runtimeMap,
  };
}

export function normalizeSunnyBanksWorkspace(value: unknown): SunnyBanksWorkspaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SunnyBanksWorkspaceSnapshot>;
  const live = normalizeSunnyBanksLive(v);
  if (!live) return null;
  if (typeof v.id !== "string" || v.id.length === 0) return null;
  if (typeof v.savedAt !== "number") return null;
  const fingerprint = typeof v.fingerprint === "string" && v.fingerprint.length > 0 ? v.fingerprint : fingerprintWorkspace(live);
  const label = typeof v.label === "string" && v.label.trim().length > 0 ? v.label : live.workspaceTitle;
  return {
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
}

export function normalizeSunnyBanksStudio(value: unknown): SkidmarksSunnyBanksState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SkidmarksSunnyBanksState>;
  const live = normalizeSunnyBanksLive(v.live);
  if (!live) return null;
  const workspaces = Array.isArray(v.workspaces)
    ? v.workspaces.map(normalizeSunnyBanksWorkspace).filter((row): row is SunnyBanksWorkspaceSnapshot => row !== null)
    : [];
  const saveSeq = typeof v.saveSeq === "number" && v.saveSeq >= 0 ? Math.floor(v.saveSeq) : workspaces.length;
  return { live, workspaces, saveSeq };
}

export function buildSunnyBanksWorkspaceFromLive(
  live: SunnyBanksLiveState,
  savedAt: number,
  seq: number
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
  if (!label) label = "Sunny Banks episode";
  return {
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
}

let defaultLiveFingerprint: string | null = null;

export function defaultSunnyBanksLiveFingerprint(): string {
  if (!defaultLiveFingerprint) {
    defaultLiveFingerprint = fingerprintWorkspace(buildDefaultSunnyBanksLive());
  }
  return defaultLiveFingerprint;
}

/** True when a named card exists, or the live copy is not the EP02 seed. */
export function sunnyBanksStudioHasUserContent(studio: SkidmarksSunnyBanksState | null | undefined): boolean {
  if (!studio) return false;
  if (studio.workspaces.length > 0) return true;
  return fingerprintWorkspace(studio.live) !== defaultSunnyBanksLiveFingerprint();
}
