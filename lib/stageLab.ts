/**
 * Stage lab — director-board data + prompt compile.
 *
 * Own sandbox (`/stage-lab`). Does not write Sunny Banks / Skidmarks /
 * Music video / Shorts, and does not call the studio session writer.
 * Ticks on a card *are* the cast list: names in
 * an action sentence never auto-tick anyone (`resolveShotCast`'s
 * shot-text path is not used here).
 */

import { CAST_KIND_LABEL, subjectWordForCastKind, type CastKind } from "./castKind";
import { ESTIMATED_STILL_COST_USD } from "./autoPlate";
import { MAX_CLIP_DURATION_SEC, MIN_CLIP_DURATION_SEC, estimateRowVideoCostUsd } from "./clipGeneration";
import { MAX_SHOT_CAST } from "./shotCast";
import { SKIDMARKS_LOOK, SHORTS_LOOK, type StudioGenre } from "./studioGenre";
import { SUNNY_BANKS_LOOK, type StudioLook } from "./sunnyBanks";
import { pickRowVideoBackend, type RowVideoBackend } from "./videoBackendRouting";

export type StageStartMode = "plate" | "chain";

export type StageCameraMove = "hold" | "push-in" | "pull-back" | "pan" | "tracking" | "dutch";

export type StageFraming = "cu" | "mcu" | "medium" | "wide" | "ots" | "low" | "high";

export type StagePlateStatus = "empty" | "making" | "ready" | "failed";

export type StageRenderStatus = "idle" | "rendering" | "done" | "failed";

export interface StageCastMember {
  id: string;
  name: string;
  kind: CastKind;
  pictureUrl: string | null;
  voiceId: string | null;
  look: string;
  group: StudioGenre | "music-video";
}

export interface StageLocation {
  id: string;
  key: string;
  name: string;
  pictureUrl: string | null;
  peopleInPicture?: true;
}

export interface StageActorOnShot {
  id: string;
  name: string;
  kind: CastKind;
  pictureUrl: string | null;
  voiceId: string | null;
  look: string;
  present: boolean;
  action: string;
  lookOverride: string;
}

export interface StageScene {
  id: string;
  label: string;
}

export interface StageShot {
  id: string;
  number: number;
  sceneId: string;
  sceneLabel: string;
  locationId: string | null;
  actors: StageActorOnShot[];
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

export const STAGE_LAB_STORAGE_KEY = "the-tab:stage-lab-v1";

export const STAGE_LENGTHS = [5, 8, 10, 12, 15] as const;

export const STAGE_MOVES: { id: StageCameraMove; label: string }[] = [
  { id: "hold", label: "Hold" },
  { id: "push-in", label: "Push-in" },
  { id: "pull-back", label: "Pull-back" },
  { id: "pan", label: "Pan" },
  { id: "tracking", label: "Tracking" },
  { id: "dutch", label: "Dutch" },
];

export const STAGE_FRAMES: { id: StageFraming; label: string }[] = [
  { id: "cu", label: "Close-up" },
  { id: "mcu", label: "MCU" },
  { id: "medium", label: "Medium" },
  { id: "wide", label: "Wide" },
  { id: "ots", label: "OTS" },
  { id: "low", label: "Low" },
  { id: "high", label: "High" },
];

export const STAGE_STILL_COST_USD = ESTIMATED_STILL_COST_USD;

export const STAGE_KIND_LABEL = CAST_KIND_LABEL;

/** Siray pack words, first in the compiled prompt so a close-up does not come out as a full-body wide. */
export function stageFramingLine(framing: StageFraming): string {
  switch (framing) {
    case "cu":
      return "Front CU — face + mouth.";
    case "mcu":
      return "Front MCU — chest-up, mouth readable.";
    case "medium":
      return "Front ¾ — knees-up.";
    case "wide":
      return "Front wide — full body, the whole scene in frame.";
    case "ots":
      return "Over-the-shoulder, looking into the scene.";
    case "low":
      return "Low front — looking up.";
    case "high":
      return "High front.";
  }
}

export function stageMoveLine(move: StageCameraMove): string {
  switch (move) {
    case "hold":
      return "Camera holds — a static, locked-off frame.";
    case "push-in":
      return "Slow push-in zoom.";
    case "pull-back":
      return "Gentle pull-back.";
    case "pan":
      return "Slow pan.";
    case "tracking":
      return "Tracking / follow-behind.";
    case "dutch":
      return "Dutch angle, slight tilt.";
  }
}

export function clampStageDurationSec(value: number): number {
  const n = Number.isFinite(value) ? Math.round(value) : MIN_CLIP_DURATION_SEC;
  return Math.min(MAX_CLIP_DURATION_SEC, Math.max(MIN_CLIP_DURATION_SEC, n));
}

export function presentActors(shot: StageShot): StageActorOnShot[] {
  return shot.actors.filter((a) => a.present).slice(0, MAX_SHOT_CAST);
}

export function speakerOf(shot: StageShot): StageActorOnShot | undefined {
  return shot.actors.find((a) => a.id === shot.speakerId);
}

/** Talking human with a voice: LTX path. Objects/animals never, even with a line. */
export function isTalkingPersonShot(shot: StageShot): boolean {
  const speaker = speakerOf(shot);
  return Boolean(shot.line.trim() && speaker?.present && speaker.kind === "person" && speaker.voiceId);
}

export function lockedCameraFor(shot: StageShot): { cameraMove: StageCameraMove; framing: StageFraming } {
  if (!isTalkingPersonShot(shot)) {
    return { cameraMove: shot.cameraMove, framing: shot.framing };
  }
  const framing: StageFraming = shot.framing === "cu" ? "cu" : "mcu";
  return { cameraMove: "hold", framing };
}

export function stageVideoBackend(shot: StageShot): RowVideoBackend {
  return pickRowVideoBackend({
    kind: isTalkingPersonShot(shot) ? "speak" : "hold",
    silentDefault: "grok",
    silentOffered: ["grok", "h3"],
  }).backend;
}

export function stageVideoCostUsd(shot: StageShot): number {
  return estimateRowVideoCostUsd(stageVideoBackend(shot), clampStageDurationSec(shot.durationSec));
}

export type StageChainStatus =
  | { ok: true; fromNumber: number; previousId: string }
  | { ok: false; reason: string };

/**
 * Chain copies the previous shot's *rendered* last frame only — never
 * Cast ticks. Blocked across a location change so the user gets a fresh plate.
 */
export function resolveStageChain(shots: readonly StageShot[], shot: StageShot): StageChainStatus {
  const fromNumber = shot.chainFromNumber ?? (shot.number > 1 ? shot.number - 1 : null);
  if (shot.startMode !== "chain" || fromNumber == null) {
    return { ok: false, reason: "This shot is on a fresh plate, not a chain." };
  }
  const previous = shots.find((s) => s.number === fromNumber);
  if (!previous) {
    return { ok: false, reason: `No shot #${fromNumber} to chain from.` };
  }
  if (previous.id === shot.id) {
    return { ok: false, reason: "A shot cannot chain from itself." };
  }
  const here = shot.locationId;
  const there = previous.locationId;
  if (!here || !there || here !== there) {
    return {
      ok: false,
      reason: "Chain is blocked across a location change — make a fresh plate on this set.",
    };
  }
  if (previous.renderStatus !== "done" || !previous.renderUrl) {
    return {
      ok: false,
      reason: `Chain needs shot #${fromNumber} rendered first (last frame only — not who is ticked).`,
    };
  }
  return { ok: true, fromNumber, previousId: previous.id };
}

export function missingPlatePictures(shot: StageShot, location: StageLocation | null): string[] {
  const missing: string[] = [];
  if (!location?.pictureUrl) missing.push(location?.name ? `${location.name} has no picture` : "No Location picture");
  if (location?.peopleInPicture) return missing;
  for (const actor of presentActors(shot)) {
    if (!actor.pictureUrl) missing.push(`${actor.name} has no Cast picture`);
  }
  return missing;
}

export interface StageReferenceImage {
  index: number;
  role: "location" | "actor";
  label: string;
  url: string | null;
}

export function stageReferenceImages(
  shot: StageShot,
  location: StageLocation | null,
  chainFrameUrl?: string | null,
): StageReferenceImage[] {
  const startUrl = shot.startMode === "chain" ? chainFrameUrl ?? null : location?.pictureUrl ?? null;
  const startLabel =
    shot.startMode === "chain"
      ? `Chained last frame of shot ${shot.chainFromNumber ?? "?"}`
      : `Location “${location?.name ?? "unset"}”`;
  const images: StageReferenceImage[] = [{ index: 1, role: "location", label: startLabel, url: startUrl }];
  if (location?.peopleInPicture) return images;
  presentActors(shot).forEach((actor, i) => {
    images.push({
      index: i + 2,
      role: "actor",
      label: `${actor.name} Cast card (${STAGE_KIND_LABEL[actor.kind]})`,
      url: actor.pictureUrl,
    });
  });
  return images;
}

function lookForShot(shot: StageShot): StudioLook {
  const groups = presentActors(shot).map((a) => a.id.split(":")[0]);
  if (groups.some((g) => g === "as" || g === "asx")) return SHORTS_LOOK;
  if (groups.some((g) => g === "sb" || g === "sbx")) return SUNNY_BANKS_LOOK;
  return SKIDMARKS_LOOK;
}

function objectLockLine(actor: StageActorOnShot): string {
  const word = subjectWordForCastKind(actor.kind);
  if (actor.kind === "person") return "";
  return `${actor.name} is an ${word}. Never give this ${word} a human face, eyes, mouth, or body. Do not turn ${actor.name} into a person.`;
}

function talkingHumanPlateLock(speaker: StageActorOnShot, framing: StageFraming): string {
  const frame = framing === "cu" ? "close-up" : "MCU";
  return [
    `${speaker.name} is a talking human.`,
    `Camera holds. ${frame}, face toward camera, eyes looking off to the side (not into the lens), mouth visible and not covered.`,
    "Never smile. Never looking down. Never a front-on stare into the lens.",
  ].join(" ");
}

function imageLabelForActor(actor: StageActorOnShot, imageNumber: number): string {
  const tag = `<IMAGE_${imageNumber - 1}>`;
  if (actor.kind === "person") {
    return (
      `Image ${imageNumber} (${tag}) is ${actor.name} — same face identity, hair, age, body and clothes as in image ${imageNumber}. ` +
      `Do not turn ${actor.name} into a different person.`
    );
  }
  const word = subjectWordForCastKind(actor.kind);
  return (
    `Image ${imageNumber} (${tag}) is ${actor.name}, an ${word} — keep that exact ${word} from their picture. ` +
    `Never invent a human face for ${actor.name}.`
  );
}

export interface StageCompiledPrompt {
  platePrompt: string;
  motionPrompt: string;
  shotPrompt: string;
  images: StageReferenceImage[];
  backend: RowVideoBackend;
  durationSec: number;
  costUsd: number;
}

/**
 * The string Make plate / (later) Render would send. Framing first.
 * Only ticked actors' pictures; action-text names are staging words only.
 */
export function compileStagePrompt(
  shot: StageShot,
  location: StageLocation | null,
  chainFrameUrl?: string | null,
): StageCompiledPrompt {
  const { cameraMove, framing } = lockedCameraFor(shot);
  const present = presentActors(shot);
  const speaker = speakerOf(shot);
  const talking = isTalkingPersonShot(shot);
  const look = lookForShot(shot);
  const images = stageReferenceImages(shot, location, chainFrameUrl);
  const placeName = location?.name?.trim() || "the locked set";
  const actions = present
    .filter((a) => a.action.trim())
    .map((a) => `${a.name}: ${a.action.trim()}`)
    .join(" ");
  const looks = present
    .filter((a) => (a.lookOverride || a.look).trim())
    .map((a) => `${a.name} look: ${(a.lookOverride || a.look).trim()}`)
    .join(" ");

  const shotPrompt = [actions, looks, shot.line.trim() ? `${speaker?.name ?? "Speaker"}: ${shot.line.trim()}` : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);

  const onStage =
    present.length === 0
      ? "Empty set — no Cast overlay."
      : `On stage (ticked only — names in action text never add extra bodies): ${present
          .map((a) => `${a.name} (${STAGE_KIND_LABEL[a.kind].toLowerCase()})`)
          .join(", ")}.`;

  const figureLine =
    present.length === 0
      ? "No Cast overlay. Keep the locked place empty of invented people."
      : `Exactly ${present.length} ${present.every((a) => a.kind === "person") ? "people" : "figures"} in frame: ${
          present.length === 1
            ? present[0].name
            : `${present.slice(0, -1).map((a) => a.name).join(", ")} and ${present[present.length - 1].name}`
        }. No one else, no passer-by, no extra body in the distance.`;

  const plateLines = [
    stageFramingLine(framing),
    stageMoveLine(cameraMove),
    look.styleLock,
    `Image 1 (<IMAGE_0>) is the LOCKED background — the ${placeName} picture. Keep that exact place, lighting and materials. Never a white void, never a blank studio, never an empty white backdrop. ${look.keepPlaceLine} ${
      location?.peopleInPicture
        ? "People already in this picture stay; do not overlay Cast pictures."
        : "Remove any extra people or crowds already in image 1 — empty place only, then add only the ticked figures below."
    }`,
    figureLine,
    ...present.map((actor, i) => imageLabelForActor(actor, i + 2)),
    ...present.map(objectLockLine).filter(Boolean),
    talking && speaker ? talkingHumanPlateLock(speaker, framing) : "",
    onStage,
    actions ? `Staging / tweak: ${actions}` : "",
    looks ? looks : "",
    "No captions, no watermarks, no name tags. Keep any signage that is already part of the locked place in image 1.",
  ].filter(Boolean);

  const objectTalk =
    shot.line.trim() && speaker && speaker.kind !== "person"
      ? ` ${speaker.name} (${STAGE_KIND_LABEL[speaker.kind].toLowerCase()}) delivers as director text in picture, not a lip-sync face: "${shot.line.trim()}". Do not turn this ${subjectWordForCastKind(speaker.kind)} into a person.`
      : "";

  const motionHead = talking && speaker
    ? `Use the provided start image as the first frame. ${speaker.name} is prominent, mouth and head move naturally while speaking, subtle gesture. Props and background stay exactly as the start image, nothing new enters frame. ${speaker.name} says: "${shot.line.trim()}". Camera holds. Same person and objects as the start image. Face toward camera, eyes off to the side, mouth visible. Never smile. Never looking down.`
    : `Use the provided start image as the first frame. ${actions || `${speaker?.name ?? "The set"} holds.`} No invented human face. Props and background stay exactly as the start image, nothing new enters frame. No cuts.${objectTalk}`;

  const motionPrompt = [
    stageFramingLine(framing),
    motionHead,
    stageMoveLine(cameraMove),
    look.motionStyleLock ?? look.styleLock,
    onStage,
  ].join(" ");

  const backend = stageVideoBackend(shot);
  const durationSec = clampStageDurationSec(shot.durationSec);
  return {
    platePrompt: plateLines.join("\n\n"),
    motionPrompt,
    shotPrompt,
    images,
    backend,
    durationSec,
    costUsd: estimateRowVideoCostUsd(backend, durationSec),
  };
}

export function compileStageGodScript(shot: StageShot, location: StageLocation | null): string {
  const present = presentActors(shot);
  const speaker = speakerOf(shot);
  const { cameraMove, framing } = lockedCameraFor(shot);
  const looks = present
    .filter((a) => a.lookOverride.trim())
    .map((a) => `[Character ${a.name}: ${a.lookOverride.trim()}]`)
    .join("\n");
  const action = [present.filter((a) => a.action.trim()).map((a) => a.action.trim()).join(" "), stageMoveLine(cameraMove), stageFramingLine(framing)]
    .filter(Boolean)
    .join(" ");
  const line = speaker ? `${speaker.name}:${shot.line.trim() ? ` ${shot.line.trim()}` : ""}` : "Crowd:";
  return [
    `=== ${shot.sceneLabel} ===`,
    `[Location: ${location?.key ?? shot.locationId ?? ""}]`,
    present.length ? `[Cast: ${present.map((a) => a.name).join(", ")}]` : null,
    looks || null,
    `[Action: ${action}]`,
    `[Duration: ${clampStageDurationSec(shot.durationSec)}s]`,
    line,
  ]
    .filter(Boolean)
    .join("\n");
}

export const DELICIAE_SCENE_LABEL = "ACT I — KITCHEN";

/** Intended Deliciae ticks, matched to real Cast by name. Never written into deck_items. */
export const DELICIAE_STARTER_ROLES: {
  nameHints: string[];
  presentOn: number[];
  actionByShot: Record<number, string>;
  look: string;
  speakerOn?: number;
  fallbackKind: CastKind;
}[] = [
  {
    nameHints: ["house"],
    presentOn: [1, 2],
    actionByShot: {
      1: "Wall speaker greets from above the fridge, cyan to violet pulsing ring",
      2: "Listens from the wall, ring idle violet",
    },
    look: "cyan to violet pulsing ring, no face",
    speakerOn: 1,
    fallbackKind: "object",
  },
  {
    nameHints: ["arthur"],
    presentOn: [1, 2, 3, 4],
    actionByShot: {
      1: "Stands in the kitchen doorway, listening",
      2: "At the counter, orders breakfast",
      3: "Claps, rubs hands, walks to the table and sits",
      4: "Sits at the table, waits",
    },
    look: "",
    speakerOn: 2,
    fallbackKind: "person",
  },
  {
    nameHints: ["pip"],
    presentOn: [],
    actionByShot: {},
    look: "palm-sized robot dog",
    fallbackKind: "animal",
  },
  {
    nameHints: ["service droid", "servicedroid", "droid"],
    presentOn: [4],
    actionByShot: {
      4: "Gets eggs on toast and a cappuccino from the PLATTER INC replicator and serves Arthur",
    },
    look: "kitchen service droid",
    fallbackKind: "object",
  },
];

export const DELICIAE_STARTER_SHOTS: {
  number: number;
  line: string;
  speakerHint: string | null;
  cameraMove: StageCameraMove;
  framing: StageFraming;
  durationSec: number;
  startMode: StageStartMode;
  note: string;
}[] = [
  {
    number: 1,
    line: "Good morning, Arthur.",
    speakerHint: "house",
    cameraMove: "hold",
    framing: "medium",
    durationSec: 5,
    startMode: "plate",
    note: "Object speaker — Grok, never LTX face",
  },
  {
    number: 2,
    line: "Eggs on toast and a cappuccino, thanks.",
    speakerHint: "arthur",
    cameraMove: "hold",
    framing: "mcu",
    durationSec: 5,
    startMode: "chain",
    note: "Talking person — LTX, camera Hold + MCU locked",
  },
  {
    number: 3,
    line: "",
    speakerHint: "arthur",
    cameraMove: "tracking",
    framing: "medium",
    durationSec: 10,
    startMode: "chain",
    note: "Silent 10s Grok — length picker, not the 5s default",
  },
  {
    number: 4,
    line: "",
    speakerHint: "droid",
    cameraMove: "pan",
    framing: "wide",
    durationSec: 8,
    startMode: "plate",
    note: "Fresh plate — droid is Object, Arthur stays seated",
  },
];

export function mintStageId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyStageShot(partial: Partial<StageShot> & Pick<StageShot, "id" | "number" | "sceneId" | "sceneLabel" | "actors">): StageShot {
  return {
    locationId: null,
    speakerId: null,
    line: "",
    cameraMove: "hold",
    framing: "medium",
    durationSec: MIN_CLIP_DURATION_SEC,
    startMode: "plate",
    chainFromNumber: null,
    plateUrl: null,
    plateStatus: "empty",
    plateError: null,
    approved: false,
    renderStatus: "idle",
    renderUrl: null,
    ...partial,
  };
}

export function renumberShots(shots: StageShot[]): StageShot[] {
  return shots.map((s, i) => ({
    ...s,
    number: i + 1,
    chainFromNumber: s.startMode === "chain" ? i : s.chainFromNumber,
  }));
}

export function tickActor(shot: StageShot, actorId: string, present: boolean): StageShot {
  const current = presentActors(shot);
  if (present && current.length >= MAX_SHOT_CAST && !shot.actors.find((a) => a.id === actorId)?.present) {
    return shot;
  }
  return {
    ...shot,
    approved: false,
    actors: shot.actors.map((a) => (a.id === actorId ? { ...a, present } : a)),
  };
}

/** Match a real Cast card to a Deliciae name hint. Loose: "Service droid" ≈ "droid". */
export function matchCastByHints(cast: readonly StageCastMember[], hints: readonly string[]): StageCastMember | undefined {
  const keys = hints.map((h) => h.replace(/[^a-z0-9]+/gi, "").toLowerCase());
  return cast.find((c) => {
    const key = c.name.replace(/[^a-z0-9]+/gi, "").toLowerCase();
    return keys.some((h) => key === h || key.includes(h) || h.includes(key));
  });
}

export function findKitchenLocation(locations: readonly StageLocation[]): StageLocation | null {
  const kitchen = locations.find((l) => /kitchen/i.test(l.name) || /kitchen/i.test(l.key));
  if (kitchen) return kitchen;
  return locations.find((l) => l.pictureUrl) ?? locations[0] ?? null;
}

export function actorsOnShotFromCast(
  cast: readonly StageCastMember[],
  presentIds: ReadonlySet<string>,
  actionById: Record<string, string>,
  lookById: Record<string, string>,
): StageActorOnShot[] {
  return cast.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    pictureUrl: c.pictureUrl,
    voiceId: c.voiceId,
    look: c.look,
    present: presentIds.has(c.id),
    action: actionById[c.id] ?? "",
    lookOverride: lookById[c.id] ?? "",
  }));
}

export function buildDeliciaeStarter(
  cast: readonly StageCastMember[],
  locations: readonly StageLocation[],
): { scene: StageScene; shots: StageShot[] } {
  const scene: StageScene = { id: "scene_act1_kitchen", label: DELICIAE_SCENE_LABEL };
  const kitchen = findKitchenLocation(locations);
  const matched = DELICIAE_STARTER_ROLES.map((role) => ({
    role,
    member: matchCastByHints(cast, role.nameHints),
  }));
  const shots = DELICIAE_STARTER_SHOTS.map((spec) => {
    const presentIds = new Set<string>();
    const actionById: Record<string, string> = {};
    const lookById: Record<string, string> = {};
    let speakerId: string | null = null;
    for (const { role, member } of matched) {
      if (!member) continue;
      if (role.look) lookById[member.id] = role.look;
      const action = role.actionByShot[spec.number];
      if (action) actionById[member.id] = action;
      if (role.presentOn.includes(spec.number)) presentIds.add(member.id);
      if (spec.speakerHint && role.nameHints.some((h) => spec.speakerHint && h.includes(spec.speakerHint))) {
        speakerId = member.id;
      }
    }
    const actors = actorsOnShotFromCast(cast, presentIds, actionById, lookById);
    return emptyStageShot({
      id: `shot_deliciae_${spec.number}`,
      number: spec.number,
      sceneId: scene.id,
      sceneLabel: scene.label,
      locationId: kitchen?.id ?? null,
      actors,
      speakerId,
      line: spec.line,
      cameraMove: spec.cameraMove,
      framing: spec.framing,
      durationSec: spec.durationSec,
      startMode: spec.startMode,
      chainFromNumber: spec.startMode === "chain" ? spec.number - 1 : null,
    });
  });
  return { scene, shots };
}

export function makeBlankShot(
  shots: readonly StageShot[],
  scene: StageScene,
  cast: readonly StageCastMember[],
  locationId: string | null,
): StageShot {
  const number = shots.length + 1;
  const prev = shots[shots.length - 1];
  return emptyStageShot({
    id: mintStageId("shot"),
    number,
    sceneId: scene.id,
    sceneLabel: scene.label,
    locationId: locationId ?? prev?.locationId ?? null,
    actors: actorsOnShotFromCast(cast, new Set(), {}, {}),
    startMode: "plate",
  });
}
