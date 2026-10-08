/**
 * Stage lab's own durable copy. localStorage key `the-tab:stage-lab-v1`.
 * Never the Neon session row, never `deck_items`, never the studio session writer.
 */

import {
  STAGE_LAB_STORAGE_KEY,
  actorsOnShotFromCast,
  clampStageDurationSec,
  emptyStageShot,
  mintStageId,
  type StageCastMember,
  type StageScene,
  type StageShot,
  type StageStartMode,
  type StageCameraMove,
  type StageFraming,
  type StagePlateStatus,
  type StageRenderStatus,
} from "./stageLab";

export interface StageLabPersistedShot {
  id: string;
  number: number;
  sceneId: string;
  sceneLabel: string;
  locationId: string | null;
  presentIds: string[];
  actionById: Record<string, string>;
  lookById: Record<string, string>;
  speakerId: string | null;
  line: string;
  cameraMove: StageCameraMove;
  framing: StageFraming;
  durationSec: number;
  startMode: StageStartMode;
  chainFromNumber: number | null;
  plateUrl: string | null;
  plateStatus: StagePlateStatus;
  plateError: string | null;
  approved: boolean;
  renderStatus: StageRenderStatus;
  renderUrl: string | null;
}

export interface StageLabPersisted {
  version: 1;
  scenes: StageScene[];
  shots: StageLabPersistedShot[];
  openShotId: string | null;
}

const MOVES: readonly StageCameraMove[] = ["hold", "push-in", "pull-back", "pan", "tracking", "dutch"];
const FRAMES: readonly StageFraming[] = ["cu", "mcu", "medium", "wide", "ots", "low", "high"];
const PLATE: readonly StagePlateStatus[] = ["empty", "making", "ready", "failed"];
const RENDER: readonly StageRenderStatus[] = ["idle", "rendering", "done", "failed"];

function isMove(v: unknown): v is StageCameraMove {
  return typeof v === "string" && (MOVES as readonly string[]).includes(v);
}
function isFrame(v: unknown): v is StageFraming {
  return typeof v === "string" && (FRAMES as readonly string[]).includes(v);
}

function strMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function serializeStageShot(shot: StageShot): StageLabPersistedShot {
  return {
    id: shot.id,
    number: shot.number,
    sceneId: shot.sceneId,
    sceneLabel: shot.sceneLabel,
    locationId: shot.locationId,
    presentIds: shot.actors.filter((a) => a.present).map((a) => a.id),
    actionById: Object.fromEntries(shot.actors.filter((a) => a.action.trim()).map((a) => [a.id, a.action])),
    lookById: Object.fromEntries(shot.actors.filter((a) => a.lookOverride.trim()).map((a) => [a.id, a.lookOverride])),
    speakerId: shot.speakerId,
    line: shot.line,
    cameraMove: shot.cameraMove,
    framing: shot.framing,
    durationSec: clampStageDurationSec(shot.durationSec),
    startMode: shot.startMode === "chain" ? "chain" : "plate",
    chainFromNumber: shot.chainFromNumber,
    plateUrl: shot.plateUrl,
    plateStatus: shot.plateStatus,
    plateError: shot.plateError,
    approved: shot.approved,
    renderStatus: shot.renderStatus,
    renderUrl: shot.renderUrl,
  };
}

export function hydrateStageShot(raw: StageLabPersistedShot, cast: readonly StageCastMember[]): StageShot {
  const present = new Set(raw.presentIds);
  return emptyStageShot({
    id: raw.id || mintStageId("shot"),
    number: raw.number,
    sceneId: raw.sceneId,
    sceneLabel: raw.sceneLabel,
    locationId: raw.locationId,
    actors: actorsOnShotFromCast(cast, present, raw.actionById, raw.lookById),
    speakerId: raw.speakerId,
    line: raw.line,
    cameraMove: isMove(raw.cameraMove) ? raw.cameraMove : "hold",
    framing: isFrame(raw.framing) ? raw.framing : "medium",
    durationSec: clampStageDurationSec(raw.durationSec),
    startMode: raw.startMode === "chain" ? "chain" : "plate",
    chainFromNumber: typeof raw.chainFromNumber === "number" ? raw.chainFromNumber : null,
    plateUrl: raw.plateUrl,
    plateStatus: (PLATE as readonly string[]).includes(raw.plateStatus) ? raw.plateStatus : "empty",
    plateError: raw.plateError,
    approved: raw.approved === true,
    renderStatus: (RENDER as readonly string[]).includes(raw.renderStatus) ? raw.renderStatus : "idle",
    renderUrl: raw.renderUrl,
  });
}

export function parseStageLabPersisted(value: unknown): StageLabPersisted | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return null;
  const scenes = Array.isArray(v.scenes)
    ? v.scenes
        .filter((s): s is StageScene => !!s && typeof s === "object" && typeof (s as StageScene).id === "string" && typeof (s as StageScene).label === "string")
        .map((s) => ({ id: s.id, label: s.label }))
    : [];
  const shots: StageLabPersistedShot[] = [];
  if (Array.isArray(v.shots)) {
    for (const raw of v.shots) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      if (typeof s.id !== "string" || typeof s.number !== "number") continue;
      shots.push({
        id: s.id,
        number: s.number,
        sceneId: typeof s.sceneId === "string" ? s.sceneId : "scene",
        sceneLabel: typeof s.sceneLabel === "string" ? s.sceneLabel : "Scene",
        locationId: typeof s.locationId === "string" ? s.locationId : null,
        presentIds: Array.isArray(s.presentIds) ? s.presentIds.filter((x): x is string => typeof x === "string") : [],
        actionById: strMap(s.actionById),
        lookById: strMap(s.lookById),
        speakerId: typeof s.speakerId === "string" ? s.speakerId : null,
        line: typeof s.line === "string" ? s.line : "",
        cameraMove: isMove(s.cameraMove) ? s.cameraMove : "hold",
        framing: isFrame(s.framing) ? s.framing : "medium",
        durationSec: clampStageDurationSec(typeof s.durationSec === "number" ? s.durationSec : 5),
        startMode: s.startMode === "chain" ? "chain" : "plate",
        chainFromNumber: typeof s.chainFromNumber === "number" ? s.chainFromNumber : null,
        plateUrl: typeof s.plateUrl === "string" ? s.plateUrl : null,
        plateStatus: (PLATE as readonly string[]).includes(String(s.plateStatus)) ? (s.plateStatus as StagePlateStatus) : "empty",
        plateError: typeof s.plateError === "string" ? s.plateError : null,
        approved: s.approved === true,
        renderStatus: (RENDER as readonly string[]).includes(String(s.renderStatus)) ? (s.renderStatus as StageRenderStatus) : "idle",
        renderUrl: typeof s.renderUrl === "string" ? s.renderUrl : null,
      });
    }
  }
  if (scenes.length === 0 && shots.length === 0) return null;
  return {
    version: 1,
    scenes: scenes.length ? scenes : [{ id: "scene", label: "Scene" }],
    shots,
    openShotId: typeof v.openShotId === "string" ? v.openShotId : shots[0]?.id ?? null,
  };
}

export function readStageLabStore(): StageLabPersisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STAGE_LAB_STORAGE_KEY);
    if (!raw) return null;
    return parseStageLabPersisted(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStageLabStore(state: { scenes: StageScene[]; shots: StageShot[]; openShotId: string | null }): void {
  if (typeof window === "undefined") return;
  const body: StageLabPersisted = {
    version: 1,
    scenes: state.scenes,
    shots: state.shots.map(serializeStageShot),
    openShotId: state.openShotId,
  };
  window.localStorage.setItem(STAGE_LAB_STORAGE_KEY, JSON.stringify(body));
}

export function clearStageLabStore(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STAGE_LAB_STORAGE_KEY);
}
