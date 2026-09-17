"use client";

import { useMemo, useRef, useState } from "react";
import { ESTIMATED_STILL_COST_USD } from "@/lib/autoPlate";
import { triggerBlobDownload } from "@/lib/clipRenders";
import { estimateLtxClipRenderCostUsd } from "@/lib/clipGeneration";
import { resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import {
  buildSunnyBanksHoldPrompt,
  buildSunnyBanksSpeakingPrompt,
  getSunnyBanksCharacterLock,
  getSunnyBanksLocation,
  resolveSunnyBanksStartImage,
  SUNNY_BANKS_CAST,
  SUNNY_BANKS_DEFAULT_LOCATION_ID,
  SUNNY_BANKS_HOLD_DURATION_SEC,
  SUNNY_BANKS_LOCATIONS,
  type SunnyBanksLocationId,
} from "@/lib/sunnyBanks";
import { buildSunnyBanksDropBearsSeed, DROP_BEARS_TITLE } from "@/lib/sunnyBanksDropBears";
import { buildSunnyBanksEpisodeBundle } from "@/lib/sunnyBanksEpisodeBundle";

/**
 * Sunny Banks' own first real screen (2026-09-15) — the thing that
 * actually sits behind the landing tile once it's enabled. Deliberately
 * not the full episode wizard (no Neon episode/beat rows, no last-frame
 * chaining, no `lib/scriptSequenceRunner`). Cast strip + a Script card
 * that stays local React state.
 *
 * **A character only shows as Speak-selectable once it has both a real
 * voice id and a real reference plate** — Hans (no voice yet, no plate)
 * and any future guest without a plate show in the cast strip so Stuart
 * can see who's missing what, but never as something this screen would
 * try to render with a stand-in. A Hold only needs the plate (no TTS).
 *
 * **Start still is the hero cell, not the turnaround sheet
 * (2026-09-17)** — live QA: Silent Hold on Shazza animated every pose
 * on `shazza-reference.jpg`. Cast thumbnails still resolve
 * `resolveSunnyBanksStartImage`. No pose picker, no in-memory canvas
 * cropper.
 *
 * **Location canvas as compositor Image 1 (2026-09-17)** — Speak/Hold
 * POST that still as `startImageDataUrl` (empty location, Image 1)
 * plus `locationId` / `locationImage` alongside `characterName`. The
 * speak-beat **route** overlays the hero as Image 2, then LTX sees
 * only the composed still. This panel does **not** call generate-still
 * itself. Gold Hold/Speak prompt strings are never built here — the
 * route loads the full `SUNNY_BANKS_CAST` record by name and passes
 * that object into `buildSunnyBanksSpeakingPrompt` /
 * `buildSunnyBanksHoldPrompt`.
 *
 * **Script block → sequential queue (2026-09-17)** — the old single
 * "Try one line" textarea is a spacious script block. Newlines become
 * queue rows (parser lives in this file, not a persisted schema).
 * One primary Render control walks the queue with the existing
 * `runningKind` lock: one POST at a time, stop on first failure.
 * Explicit product ask for this panel; not music-video whole-song
 * auto-render, not parallel fan-out.
 *
 * **Dense queue + Act pills + in-memory workspace shelf (2026-09-17)** —
 * queue rows are one spreadsheet-style line (not stacked cards) so a
 * phone isn't a tall scroll of identical containers. Act I/II/III
 * pills sit at the top of the Script card in one horizontal
 * `touch-pan-x` strip. The strip opens on Act I/II/III (EP02 seed)
 * and **+ Add Act** appends the next roman bucket (IV, V, …) with an
 * empty script buffer — still this component's in-memory maps, not a
 * Neon act table. Save and the episode zip walk `actIds` in order so
 * a typed Act IV is not dropped. The textarea and
 * queued rows collapse behind "Show Script Text & Queued Lines"
 * (default closed) so a 46-line EP02 paste doesn't bury the Clips
 * strip. `# EPISODE:`, `=== ACT`, `[Location: id]`, `[Action: text]`,
 * and `[Character Name: look]` in a pasted God Script update the
 * episode name, act buffers, park plate (`startImageDataUrl` at
 * render), prompt suffix, and per-row `appearanceModifier` in memory —
 * not a Neon schema, not a layout change. The bottom shelf snapshots those buffers + location ids +
 * finished clip URLs as a named workspace card for this open
 * detail-sheet only (`mintWorkspaceId` = timestamp + seq + content
 * fingerprint — never clobbers an earlier card). A red ✕ drops that
 * snapshot. **Download Episode Bundle** zips `data/script.txt`, the gold
 * Speak/Hold prompt array, clip URL records, and best-effort MP4/MP3
 * bytes under `video/` and `audio/` (`lib/sunnyBanksEpisodeBundle.ts`).
 * No `localStorage`, no new session schema. Sunny Banks has no
 * song MP3; driving audio is TTS at render time.
 *
 * **iPhone Safari vertical scroll (2026-09-17)** — the script wrapper
 * uses `touch-pan-y overscroll-y-contain` so a thumb on the textarea
 * or a queue row pans the page instead of freezing inside a nested
 * scroller. Queue rows do **not** scroll horizontally. `touch-action:
 * pan-y` so a thumb still pages the sheet.
 *
 * **Done rows are static (2026-09-17, live QA)** — once a line is
 * `status === "done"`, character and location `<select>`s go away
 * (the clip is already billed; swapping Shazza or the park plate
 * would lie). Spoken text sits under the name in a native
 * `<details>` disclosure. The empty 40px black preview cube is gone
 * — finished MP4s live in the Clips shelf, not in the spreadsheet.
 * Idle/failed rows still have the character + location picks.
 *
 * **Done clips survive a re-parse (2026-09-17, live QA)** —
 * `preserveRenderedRuntimes` rebinds an in-memory `status === "done"`
 * row onto the freshly parsed queue when speaker + dialogue still
 * match, instead of idling it because the index or `lineKey` moved
 * (a `[Location:]` prepend, a pasted God Script). **↩ Undo** beside
 * the Act pills restores the previous script buffers so the queue
 * recompiles to the last clean arrangement. Tag-only
 * `[Character Name: override]` / `[Location:]` / `[Action:]` lines
 * never mint their own Idle rows — they only stamp the next speaker.
 *
 * **Clips live in one Act-grouped strip (2026-09-17, live QA)** —
 * finished MP4s sit in one `overflow-x-auto` row at the base of the
 * working panel (after the script, before the Episode workspace,
 * same reading order as music-video rendered clips then archive),
 * same card size and `touch-pan-x` as `SkidmarksRenderedClipsShelf`
 * (`w-44` / `h-28`, inline controls), sectioned Act I / II / III.
 * Workspace save always mints a new card (`mintWorkspaceId` =
 * timestamp + seq + content fingerprint) instead of reusing
 * `Date.now()` as a key that could collide on a double-tap.
 * Each saved card has a red ✕ that drops that snapshot only.
 *
 * **EP02 Drop Bears seed (2026-09-17)** — the panel opens on Crash Lab
 * job `mgen_20260827092841004_ea9` (46 already-rendered Speak clips)
 * so the Clips strip can be judged with real MP4s. Still in-memory, still
 * this component. No re-render, no Crash Lab chrome, no new Neon table.
 * Playback hits skidmarks.aiglitch.app while that host stays ungated.
 */

const DROP_BEARS_SEED = buildSunnyBanksDropBearsSeed();

const CAST_LIST = Object.values(SUNNY_BANKS_CAST);
/** The always-on cast strip only ever shows the locked series regulars
 * — a one-episode guest (Hans today) has no business sitting in a
 * permanent "the cast" row with no episode to scope him to (Stuart's
 * own correction, 2026-09-15). Still selectable in the line-test form
 * below once he has a voice + plate — this only hides the strip. */
const SERIES_REGULARS = CAST_LIST.filter((c) => !c.guest);

/** Longest name first so "Ranger Bazza" / "Unit 4S" win over a
 * shorter prefix. Keys of `SUNNY_BANKS_CAST`, not a parallel array. */
const SPEAKER_NAMES = Object.keys(SUNNY_BANKS_CAST).sort((a, b) => b.length - a.length);

type BeatKind = "speak" | "hold";
export type SunnyBanksChunkKind = BeatKind | "scene";

type RowStatus = "idle" | "rendering" | "done" | "failed";

export const SUNNY_BANKS_INITIAL_ACTS = ["I", "II", "III"] as const;
/** Seed default — EP02 opens on these three. Extra acts are roman
 * IDs appended in memory (`nextSunnyBanksActId`), not a schema. */
export const SUNNY_BANKS_ACTS = SUNNY_BANKS_INITIAL_ACTS;
export type SunnyBanksActId = string;

/** Phone-row ceiling so a mashed + cannot spawn an unbounded pill
 * strip. 20 is XX; past that the button disables. */
export const MAX_SUNNY_BANKS_ACTS = 20;

const ROMAN_VALUES: ReadonlyArray<readonly [number, string]> = [
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function toSunnyBanksActId(indexFromOne: number): SunnyBanksActId {
  if (indexFromOne <= 0) return String(indexFromOne);
  let remaining = indexFromOne;
  let out = "";
  for (const [value, numeral] of ROMAN_VALUES) {
    while (remaining >= value) {
      out += numeral;
      remaining -= value;
    }
  }
  return out;
}

/** Next roman after the current ordered list (I, II, III → IV). */
export function nextSunnyBanksActId(existing: readonly string[]): SunnyBanksActId {
  return toSunnyBanksActId(existing.length + 1);
}

export interface SunnyBanksScriptChunk {
  raw: string;
  characterName: string;
  line: string;
  kind: SunnyBanksChunkKind;
  /** Locked park plate for this row and later rows, from `[Location: id]`. */
  locationId?: SunnyBanksLocationId;
  /** Extra LTX prompt context from `[Action: text]` — not spoken TTS. */
  action?: string;
  /** Extra look text from `[Character Name: description]` — not gold. */
  appearanceModifier?: string;
}

/** Speak/Hold rows only — scene headers stay in the parse array but
 * never become spreadsheet queue rows. */
export function isSunnyBanksQueueChunk(
  chunk: SunnyBanksScriptChunk
): chunk is SunnyBanksScriptChunk & { kind: BeatKind } {
  return chunk.kind === "speak" || chunk.kind === "hold";
}

export function sunnyBanksQueueChunks(chunks: readonly SunnyBanksScriptChunk[]): Array<
  SunnyBanksScriptChunk & { kind: BeatKind }
> {
  return chunks.filter(isSunnyBanksQueueChunk);
}

export interface SunnyBanksGodDocument {
  episodeTitle: string | null;
  hasActHeaders: boolean;
  actIds: SunnyBanksActId[];
  actScripts: Record<string, string>;
}

interface GenerateBeatResponseBody {
  videoUrl?: unknown;
  durationSec?: unknown;
  error?: unknown;
  kind?: unknown;
  audioMuxed?: unknown;
  audioMuxError?: unknown;
}

type RowRuntime = {
  lineKey: string;
  status: RowStatus;
  videoUrl?: string;
  durationSec?: number;
  error?: string;
  audioMuxed?: boolean;
  /** Speaker + dialogue at render time — used to keep a Done clip when
   * the script is re-parsed (tags added, paste, undo) without a matching
   * index/lineKey. */
  characterName?: string;
  line?: string;
};

type ActKeyed<T> = Record<SunnyBanksActId, T>;

/** One-level undo of the Script card — previous textarea / act
 * buffers + the runtime map they were compiled against. In-memory
 * only; never `localStorage`. */
interface ScriptUndoSnapshot {
  actIds: SunnyBanksActId[];
  activeAct: SunnyBanksActId;
  actScripts: ActKeyed<string>;
  characterOverrides: ActKeyed<Record<number, string>>;
  locationOverrides: ActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: ActKeyed<Record<number, RowRuntime>>;
  workspaceTitle: string;
}

interface EpisodeWorkspace {
  id: string;
  savedAt: number;
  fingerprint: string;
  label: string;
  defaultLocationId: SunnyBanksLocationId;
  actIds: SunnyBanksActId[];
  activeAct: SunnyBanksActId;
  actScripts: ActKeyed<string>;
  characterOverrides: ActKeyed<Record<number, string>>;
  locationOverrides: ActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: ActKeyed<Record<number, RowRuntime>>;
}

export interface SunnyBanksRenderedClip {
  act: SunnyBanksActId;
  index: number;
  characterName: string;
  lineLabel: string;
  videoUrl: string;
  durationSec?: number;
}

const HOLD_COST_USD = estimateLtxClipRenderCostUsd(SUNNY_BANKS_HOLD_DURATION_SEC);
const LOCATION_LIST = Object.values(SUNNY_BANKS_LOCATIONS);
const PLATE_CAST = CAST_LIST.filter((c) => c.referenceImage);
const FALLBACK_CHARACTER_NAME = PLATE_CAST[0]?.name ?? "";

function emptyActRecord<T>(make: () => T, actIds: readonly string[] = SUNNY_BANKS_INITIAL_ACTS): ActKeyed<T> {
  const next: ActKeyed<T> = {};
  for (const act of actIds) {
    next[act] = make();
  }
  return next;
}

function cloneActRecord<T>(value: ActKeyed<T>, actIds?: readonly string[]): ActKeyed<T> {
  const keys = actIds ?? Object.keys(value);
  const next: ActKeyed<T> = {};
  for (const act of keys) {
    if (act in value) next[act] = structuredClone(value[act]);
  }
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchSpeakerPrefix(raw: string): { name: string; rest: string } | null {
  for (const name of SPEAKER_NAMES) {
    const re = new RegExp(`^${escapeRegExp(name)}\\s*(?:says\\s*)?:\\s*(.*)$`, "i");
    const match = raw.match(re);
    if (match) {
      return { name, rest: (match[1] ?? "").trim() };
    }
  }
  return null;
}

/** `# EPISODE: title` — trailing text is the workspace name. */
export function parseSunnyBanksEpisodeHeader(raw: string): { title: string } | null {
  const match = raw.match(/^#\s*EPISODE:\s*(.*)$/i);
  if (!match) return null;
  return { title: (match[1] ?? "").trim() };
}

/** A bare `=== ACT I ===` / `=== ACT 2` names that act buffer.
 *  A titled beat (`=== ACT III — CROWD CUTAWAY ===`) is a scene, not
 *  a new act — see `parseSunnyBanksTitledActHeader`. */
export function parseSunnyBanksActHeader(raw: string): SunnyBanksActId | null {
  const match = raw.trim().match(/^===\s*ACT\s+([IVXLCDM]+|\d+)\s*(?:===)?\s*$/i);
  if (!match) return null;
  return actTokenToId(match[1]);
}

function actTokenToId(token: string): SunnyBanksActId | null {
  if (/^\d+$/.test(token)) {
    const indexFromOne = Number(token);
    if (indexFromOne < 1 || indexFromOne > MAX_SUNNY_BANKS_ACTS) return null;
    return toSunnyBanksActId(indexFromOne);
  }
  return token.toUpperCase();
}

/** `=== ACT III — CROWD CUTAWAY ===` / `=== ACT III — THE CON ===`.
 *  Switches the God-document buffer to that act and stays a scene
 *  chunk — not a queue row, not a second Act III pill. */
export function parseSunnyBanksTitledActHeader(
  raw: string
): { actId: SunnyBanksActId; label: string } | null {
  if (parseSunnyBanksActHeader(raw)) return null;
  const scene = parseSunnyBanksSceneHeader(raw);
  if (!scene) return null;
  const match = scene.match(/^ACT\s+([IVXLCDM]+|\d+)\b/i);
  if (!match) return null;
  const actId = actTokenToId(match[1]);
  if (!actId) return null;
  return { actId, label: scene };
}

/** `=== THE EPISODE TAG ===` (or any `=== LABEL ===` that is not an
 * Act header). Stored as a sequence chunk; not a queue row. */
export function parseSunnyBanksSceneHeader(raw: string): string | null {
  if (parseSunnyBanksActHeader(raw)) return null;
  const match = raw.match(/^===\s*(.+?)\s*===\s*$/);
  if (!match) return null;
  const label = match[1].replace(/\s+/g, " ").trim();
  return label.length > 0 ? label : null;
}

/** Map `[Location: id]` onto one of the six locked park plates. */
export function resolveSunnyBanksScriptLocationId(token: string): SunnyBanksLocationId | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  const direct = getSunnyBanksLocation(trimmed);
  if (direct) return direct.id;
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const slugged = getSunnyBanksLocation(slug);
  if (slugged) return slugged.id;
  const lower = trimmed.toLowerCase();
  for (const location of LOCATION_LIST) {
    if (location.label.toLowerCase() === lower) return location.id;
  }
  return undefined;
}

function parseCharacterLookTag(inner: string): string {
  const trimmed = inner.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const colon = trimmed.match(/^([^:]+):\s*(.*)$/);
  if (colon) return (colon[2] ?? "").replace(/\s+/g, " ").trim();
  for (const name of SPEAKER_NAMES) {
    const re = new RegExp(`^${escapeRegExp(name)}\\s+(.*)$`, "i");
    const match = trimmed.match(re);
    if (match) return (match[1] ?? "").replace(/\s+/g, " ").trim();
  }
  return trimmed;
}

/** `Crowd:` (or any `Name:` that is not a CAST key) is a cutaway
 *  marker, not a Hold and not a continuation line. */
export function isSunnyBanksGhostTargetLine(rest: string): boolean {
  const match = rest.trim().match(/^(.+?)\s*:\s*$/);
  if (!match) return false;
  const name = match[1].replace(/\s+/g, " ").trim();
  if (!name) return true;
  return !SPEAKER_NAMES.some((speaker) => speaker.toLowerCase() === name.toLowerCase());
}

function extractGodScriptTags(raw: string): {
  rest: string;
  locationId?: SunnyBanksLocationId;
  actions: string[];
  appearanceModifiers: string[];
} {
  let locationId: SunnyBanksLocationId | undefined;
  const actions: string[] = [];
  const appearanceModifiers: string[] = [];
  const rest = raw
    .replace(/\[Location:\s*([^\]]*)\]/gi, (_, token: string) => {
      const resolved = resolveSunnyBanksScriptLocationId(token);
      if (resolved) locationId = resolved;
      return " ";
    })
    .replace(/\[Action:\s*([^\]]*)\]/gi, (_, token: string) => {
      const action = token.replace(/\s+/g, " ").trim();
      if (action) actions.push(action);
      return " ";
    })
    .replace(/\[Character\s+([^\]]*)\]/gi, (_, inner: string) => {
      const appearance = parseCharacterLookTag(inner);
      if (appearance) appearanceModifiers.push(appearance);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { rest, locationId, actions, appearanceModifiers };
}

/** iPhone paste of a URL-encoded script lands as literal `%20` / `%0A`
 * (Stuart live QA: the textarea filled with percent signs instead of
 * spaces and line breaks). Decode that blob before the parser runs.
 * Leaves a normal typed script alone — including a lone `%` in dialogue. */
export function decodeSunnyBanksPastedScript(text: string): string {
  if (!/%(?:20|0[AaDd])/i.test(text)) return text;
  const encodedNewlines = (text.match(/%0[AaDd]/gi) ?? []).length;
  const realNewlines = (text.match(/\r|\n/g) ?? []).length;
  const encodedSpaces = (text.match(/%20/g) ?? []).length;
  const looksEncoded =
    (encodedNewlines > 0 && encodedNewlines >= realNewlines) || encodedSpaces >= 3;
  if (!looksEncoded) return text;
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text
      .replace(/%0D%0A/gi, "\n")
      .replace(/%0A/gi, "\n")
      .replace(/%0D/gi, "\n")
      .replace(/%20/g, " ");
  }
}

/** Append `[Action:]` text after a gold prompt. Does not rewrite gold. */
export function appendSunnyBanksActionToPrompt(prompt: string, action: string | undefined): string {
  const extra = action?.trim() ?? "";
  if (!extra) return prompt;
  return `${prompt} ${extra}`;
}

export function mergeSunnyBanksActIds(
  existing: readonly string[],
  incoming: readonly string[]
): SunnyBanksActId[] {
  const next: SunnyBanksActId[] = [...existing];
  for (const id of incoming) {
    if (!next.includes(id) && next.length < MAX_SUNNY_BANKS_ACTS) next.push(id);
  }
  return next;
}

/**
 * Split a God Script document into per-act buffers. `# EPISODE:` and
 * `=== ACT` lines are not stored in those buffers. In-memory only.
 */
export function parseSunnyBanksGodDocument(text: string, fallbackActId: string = "I"): SunnyBanksGodDocument {
  let episodeTitle: string | null = null;
  let hasActHeaders = false;
  let currentAct: SunnyBanksActId = fallbackActId;
  const order: SunnyBanksActId[] = [];
  const linesByAct: Record<string, string[]> = {};

  const touch = (act: SunnyBanksActId) => {
    if (!linesByAct[act]) {
      linesByAct[act] = [];
      order.push(act);
    }
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    const episode = parseSunnyBanksEpisodeHeader(raw);
    if (episode) {
      if (episode.title) episodeTitle = episode.title;
      continue;
    }
    const act = parseSunnyBanksActHeader(raw);
    if (act) {
      hasActHeaders = true;
      currentAct = act;
      touch(currentAct);
      continue;
    }
    const titled = parseSunnyBanksTitledActHeader(raw);
    if (titled) {
      hasActHeaders = true;
      currentAct = titled.actId;
      touch(currentAct);
      linesByAct[currentAct].push(rawLine.replace(/[ \t]+$/g, ""));
      continue;
    }
    touch(currentAct);
    linesByAct[currentAct].push(rawLine.replace(/[ \t]+$/g, ""));
  }

  if (order.length === 0) touch(fallbackActId);

  let inheritedLocation: SunnyBanksLocationId | undefined;
  for (const act of order) {
    const body = linesByAct[act] ?? [];
    const hasOwnLocation = body.some((line) => Boolean(extractGodScriptTags(line.trim()).locationId));
    if (!hasOwnLocation && inheritedLocation) {
      body.unshift(`[Location: ${inheritedLocation}]`);
    }
    for (const line of body) {
      const loc = extractGodScriptTags(line.trim()).locationId;
      if (loc) inheritedLocation = loc;
    }
    linesByAct[act] = body;
  }

  const actScripts: Record<string, string> = {};
  for (const act of order) {
    actScripts[act] = (linesByAct[act] ?? []).join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  }
  return { episodeTitle, hasActHeaders, actIds: order, actScripts };
}

/**
 * Split a pasted script on newlines into Speak/Hold chunks.
 * Looks up speakers against `SUNNY_BANKS_CAST` keys (name-keyed
 * records, never a guessed id). Empty dialogue after a speaker prefix
 * is a Hold. A line with no prefix continues the previous speaker.
 * Blank lines are skipped. God Script headers (`# EPISODE:`, `=== ACT`,
 * `[Location: id]`, `[Action: text]`, `[Character Name: look]`) are not
 * queue rows. `=== LABEL ===` scene headers (e.g. `=== THE EPISODE TAG
 * ===`, `=== ACT III — CROWD CUTAWAY ===`) stay in the parse array as
 * `kind: "scene"` sequence chunks and are not spreadsheet rows.
 * `[Character Dazza wrapped in bandages]` (no colon) and
 * `[Character Name: description]` both strip into `appearanceModifier`
 * on the next Speak/Hold row — gold look strings in `lib/sunnyBanks.ts`
 * stay verbatim. Empty `Crowd:` (any non-CAST `Name:`) is skipped so
 * it never mints an Idle ghost row.
 */
export function parseSunnyBanksScriptBlock(text: string): SunnyBanksScriptChunk[] {
  const chunks: SunnyBanksScriptChunk[] = [];
  let previousName = "";
  let currentLocation: SunnyBanksLocationId = SUNNY_BANKS_DEFAULT_LOCATION_ID;
  let pendingActions: string[] = [];
  let pendingAppearance: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw) continue;
    if (parseSunnyBanksEpisodeHeader(raw) || parseSunnyBanksActHeader(raw)) continue;
    const sceneLabel = parseSunnyBanksSceneHeader(raw);
    if (sceneLabel) {
      chunks.push({
        raw,
        characterName: "",
        line: sceneLabel,
        kind: "scene",
        locationId: currentLocation,
      });
      continue;
    }
    const tagged = extractGodScriptTags(raw);
    if (tagged.locationId) currentLocation = tagged.locationId;
    if (tagged.actions.length > 0) pendingActions = [...pendingActions, ...tagged.actions];
    if (tagged.appearanceModifiers.length > 0) {
      pendingAppearance = [...pendingAppearance, ...tagged.appearanceModifiers];
    }
    if (!tagged.rest) continue;
    if (isSunnyBanksGhostTargetLine(tagged.rest)) continue;
    const matched = matchSpeakerPrefix(tagged.rest);
    let characterName: string;
    let line: string;
    if (matched) {
      characterName = matched.name;
      line = matched.rest;
      previousName = matched.name;
    } else {
      characterName = previousName || FALLBACK_CHARACTER_NAME;
      line = tagged.rest;
      if (characterName) previousName = characterName;
    }
    const action = pendingActions.join(" ").trim();
    pendingActions = [];
    const appearanceModifier = pendingAppearance.join(" ").trim();
    pendingAppearance = [];
    const chunk: SunnyBanksScriptChunk = {
      raw: tagged.rest,
      characterName,
      line,
      kind: line.length > 0 ? "speak" : "hold",
      locationId: currentLocation,
    };
    if (action) chunk.action = action;
    if (appearanceModifier) chunk.appearanceModifier = appearanceModifier;
    chunks.push(chunk);
  }
  return chunks;
}

/** Speaker + spoken/hold text — stable across tag-only lines and a
 * re-parse that would otherwise mint a new `raw` / index. */
export function sunnyBanksDialogueKey(characterName: string, line: string): string {
  return `${characterName}\n${line}`;
}

export function sunnyBanksRuntimeMatchesChunk(
  stored: Pick<RowRuntime, "lineKey" | "characterName" | "line">,
  chunk: Pick<SunnyBanksScriptChunk, "raw" | "characterName" | "line">
): boolean {
  if (stored.lineKey === chunk.raw) return true;
  if (
    typeof stored.characterName === "string" &&
    typeof stored.line === "string" &&
    sunnyBanksDialogueKey(stored.characterName, stored.line) ===
      sunnyBanksDialogueKey(chunk.characterName, chunk.line)
  ) {
    return true;
  }
  const fromKey = matchSpeakerPrefix(stored.lineKey);
  if (fromKey) {
    return (
      sunnyBanksDialogueKey(fromKey.name, fromKey.rest) ===
      sunnyBanksDialogueKey(chunk.characterName, chunk.line)
    );
  }
  return false;
}

/**
 * Re-bind in-memory Done clips onto a freshly parsed queue. A tag-only
 * `[Location:]` / `[Character:]` / `[Action:]` line must not idle a
 * row whose speaker + dialogue still match a clip from this tab.
 * Unmatched previous entries are not deleted — Undo can restore the
 * script and they reattach.
 */
export function preserveRenderedRuntimes(
  chunks: readonly SunnyBanksScriptChunk[],
  previous: Record<number, RowRuntime>
): Record<number, RowRuntime> {
  const queue = sunnyBanksQueueChunks(chunks);
  const claimed = new Set<number>();
  const next: Record<number, RowRuntime> = {};
  const attach = (oldIndex: number, chunk: SunnyBanksScriptChunk, newIndex: number) => {
    claimed.add(oldIndex);
    const stored = previous[oldIndex];
    next[newIndex] = {
      ...stored,
      lineKey: chunk.raw,
      characterName: chunk.characterName,
      line: chunk.line,
    };
  };
  queue.forEach((chunk, index) => {
    if (previous[index] && !claimed.has(index) && sunnyBanksRuntimeMatchesChunk(previous[index], chunk)) {
      attach(index, chunk, index);
      return;
    }
    const oldIndex = Object.keys(previous)
      .map((key) => Number(key))
      .find(
        (i) =>
          !claimed.has(i) &&
          previous[i]?.status === "done" &&
          previous[i]?.videoUrl &&
          sunnyBanksRuntimeMatchesChunk(previous[i], chunk)
      );
    if (oldIndex !== undefined) attach(oldIndex, chunk, index);
  });
  return next;
}

function statusPillLabel(status: RowStatus): string {
  if (status === "rendering") return "Rendering...";
  if (status === "done") return "Done";
  if (status === "failed") return "Failed";
  return "Idle";
}

/** Closed-control fit at 390px — "Main Entrance Sign" → "Main Entrance".
 * Full label stays on `title` / aria. Not a parser, not gold. */
function compactQueueLocationLabel(label: string): string {
  const words = label.trim().split(/\s+/);
  return words.length <= 2 ? label : `${words[0]} ${words[1]}`;
}

function statusPillClass(status: RowStatus): string {
  if (status === "rendering") return "bg-amber-300/15 text-amber-100";
  if (status === "done") return "bg-emerald-400/15 text-emerald-200";
  if (status === "failed") return "bg-rose-400/15 text-rose-200";
  return "bg-white/10 text-white/55";
}

function workspaceLabelFromScripts(
  actScripts: ActKeyed<string>,
  fallback: string,
  actIds: readonly string[]
): string {
  for (const act of actIds) {
    const first = (actScripts[act] ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first) return first.length > 36 ? `${first.slice(0, 33)}…` : first;
  }
  return fallback;
}

/** djb2 of the snapshot payload — same scripts + same clip URLs hash
 * the same; a new render URL or a typed edit does not. Used as part of
 * the workspace id, never as a uniqueness gate that would skip a save. */
export function fingerprintWorkspace(snapshot: {
  defaultLocationId: string;
  actIds: readonly string[];
  activeAct: string;
  actScripts: ActKeyed<string>;
  characterOverrides: ActKeyed<Record<number, string>>;
  locationOverrides: ActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: ActKeyed<Record<number, RowRuntime>>;
}): string {
  const payload = JSON.stringify(snapshot);
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 33) ^ payload.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Always a new card. Timestamp + monotonic seq so two saves in the
 * same millisecond cannot share a React key; fingerprint records what
 * was saved without replacing an earlier card. */
export function mintWorkspaceId(savedAt: number, seq: number, fingerprint: string): string {
  return `ws-${savedAt}-${seq}-${fingerprint}`;
}

export function collectRenderedClips(args: {
  actIds: readonly string[];
  actScripts: ActKeyed<string>;
  runtimeMap: ActKeyed<Record<number, RowRuntime>>;
  characterOverrides: ActKeyed<Record<number, string>>;
}): SunnyBanksRenderedClip[] {
  const clips: SunnyBanksRenderedClip[] = [];
  for (const act of args.actIds) {
    const parsed = parseSunnyBanksScriptBlock(args.actScripts[act] ?? "");
    const chunks = sunnyBanksQueueChunks(parsed);
    const runtimes = args.runtimeMap[act] ?? {};
    const remapped = preserveRenderedRuntimes(parsed, runtimes);
    const overrides = args.characterOverrides[act] ?? {};
    chunks.forEach((chunk, index) => {
      const stored = remapped[index];
      if (!stored || stored.status !== "done" || !stored.videoUrl) {
        return;
      }
      clips.push({
        act,
        index,
        characterName: overrides[index] ?? chunk.characterName,
        lineLabel: chunk.line.length > 0 ? chunk.line : "Silent hold",
        videoUrl: stored.videoUrl,
        durationSec: stored.durationSec,
      });
    });
  }
  return clips;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SkidmarksSunnyBanksPanel() {
  const [actIds, setActIds] = useState<SunnyBanksActId[]>(() => [...SUNNY_BANKS_INITIAL_ACTS]);
  const [activeAct, setActiveAct] = useState<SunnyBanksActId>("I");
  const [actScripts, setActScripts] = useState<ActKeyed<string>>(() => DROP_BEARS_SEED.actScripts);
  const [defaultLocationId, setDefaultLocationId] = useState<SunnyBanksLocationId>(
    DROP_BEARS_SEED.defaultLocationId
  );
  const [characterOverridesByAct, setCharacterOverridesByAct] = useState<ActKeyed<Record<number, string>>>(
    () => emptyActRecord(() => ({}))
  );
  const [locationOverridesByAct, setLocationOverridesByAct] = useState<
    ActKeyed<Record<number, SunnyBanksLocationId>>
  >(() => DROP_BEARS_SEED.locationOverrides);
  const [runtimeMapByAct, setRuntimeMapByAct] = useState<ActKeyed<Record<number, RowRuntime>>>(
    () => DROP_BEARS_SEED.runtimeMap
  );
  const [runningKind, setRunningKind] = useState<BeatKind | null>(null);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<EpisodeWorkspace[]>([]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [clipsOpen, setClipsOpen] = useState(true);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [workspaceTitle, setWorkspaceTitle] = useState(DROP_BEARS_TITLE);
  const [scriptUndo, setScriptUndo] = useState<ScriptUndoSnapshot | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const actStripRef = useRef<HTMLDivElement>(null);
  const locationDataUrlCacheRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);
  const workspaceSaveSeqRef = useRef(0);

  const scriptText = actScripts[activeAct] ?? "";
  const characterOverrides = characterOverridesByAct[activeAct] ?? {};
  const locationOverrides = locationOverridesByAct[activeAct] ?? {};
  const parsed = useMemo(() => parseSunnyBanksScriptBlock(scriptText), [scriptText]);
  const remappedRuntime = useMemo(
    () => preserveRenderedRuntimes(parsed, runtimeMapByAct[activeAct] ?? {}),
    [parsed, runtimeMapByAct, activeAct]
  );
  const running = runningKind !== null;

  const runtimeFor = (index: number, raw: string): RowRuntime => {
    return remappedRuntime[index] ?? { lineKey: raw, status: "idle" };
  };

  const queue = sunnyBanksQueueChunks(parsed).map((chunk, index) => {
    const characterName = characterOverrides[index] ?? chunk.characterName;
    const locationId = locationOverrides[index] ?? chunk.locationId ?? defaultLocationId;
    const character = getSunnyBanksCharacterLock(characterName);
    const location = getSunnyBanksLocation(locationId) ?? SUNNY_BANKS_LOCATIONS[SUNNY_BANKS_DEFAULT_LOCATION_ID];
    const line = chunk.line;
    return { chunk, index, characterName, character, location, line, kind: chunk.kind };
  });

  const renderedClips = collectRenderedClips({
    actIds,
    actScripts,
    runtimeMap: runtimeMapByAct,
    characterOverrides: characterOverridesByAct,
  });
  const clipsByAct = actIds
    .map((act) => ({
      act,
      clips: renderedClips.filter((clip) => clip.act === act),
    }))
    .filter((group) => group.clips.length > 0);

  const pendingRows = queue.filter((row) => runtimeFor(row.index, row.chunk.raw).status !== "done");

  const overlayCostUsd = pendingRows.length * ESTIMATED_STILL_COST_USD;
  const holdVideoCostUsd = pendingRows.filter((row) => row.kind === "hold").length * HOLD_COST_USD;
  const speakCount = pendingRows.filter((row) => row.kind === "speak").length;

  const canRenderAll =
    pendingRows.length > 0 &&
    !running &&
    pendingRows.every((row) => {
      if (!row.character || !row.location.image) return false;
      if (row.kind === "speak") return !!row.character.voiceId && row.line.length > 0;
      return !!resolveSunnyBanksStartImage(row.character);
    });

  const resolveLocationDataUrl = async (image: string): Promise<string> => {
    const cached = locationDataUrlCacheRef.current[image];
    if (cached) return cached;
    const dataUrl = await resolvePlateReferenceDataUrl(image);
    locationDataUrlCacheRef.current[image] = dataUrl;
    return dataUrl;
  };

  const postBeat = async (args: {
    kind: BeatKind;
    characterName: string;
    line: string;
    locationId: string;
    locationImage: string;
    startImageDataUrl: string;
    action?: string;
    appearanceModifier?: string;
  }): Promise<
    | { ok: true; videoUrl: string; durationSec: number; audioMuxed?: boolean }
    | { ok: false; message: string }
  > => {
    const action = args.action?.trim() ?? "";
    const appearanceModifier = args.appearanceModifier?.trim() ?? "";
    // Route already appends `action` after gold — do not rewrite it.
    // Fold appearance into that same suffix so LTX sees the look note
    // without editing gold in lib/sunnyBanks.ts, and still send
    // `appearanceModifier` next to `characterName` as its own field.
    const actionPayload = [action, appearanceModifier].filter(Boolean).join(" ");
    const res = await fetch("/api/skidmarks/sunnybank/generate-speak-beat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        args.kind === "hold"
          ? {
              kind: "hold",
              characterName: args.characterName,
              ...(appearanceModifier ? { appearanceModifier } : {}),
              locationId: args.locationId,
              locationImage: args.locationImage,
              startImageDataUrl: args.startImageDataUrl,
              ...(actionPayload ? { action: actionPayload } : {}),
            }
          : {
              characterName: args.characterName,
              ...(appearanceModifier ? { appearanceModifier } : {}),
              line: args.line,
              locationId: args.locationId,
              locationImage: args.locationImage,
              startImageDataUrl: args.startImageDataUrl,
              ...(actionPayload ? { action: actionPayload } : {}),
            }
      ),
    });
    const body = (await res.json()) as GenerateBeatResponseBody;
    const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";
    if (!res.ok || !videoUrl) {
      return {
        ok: false,
        message: typeof body.error === "string" ? body.error : `Render failed (HTTP ${res.status}).`,
      };
    }
    return {
      ok: true,
      videoUrl,
      durationSec: typeof body.durationSec === "number" ? body.durationSec : 0,
      audioMuxed: typeof body.audioMuxed === "boolean" ? body.audioMuxed : undefined,
    };
  };

  const handleRenderAll = async () => {
    if (!canRenderAll || runningRef.current) return;
    const act = activeAct;
    runningRef.current = true;
    const writeRuntime = (index: number, next: RowRuntime) => {
      const row = queue[index];
      const stamped: RowRuntime = {
        ...next,
        characterName: next.characterName ?? row?.characterName,
        line: next.line ?? row?.line ?? "",
      };
      setRuntimeMapByAct((prev) => ({
        ...prev,
        [act]: { ...(prev[act] ?? {}), [index]: stamped },
      }));
    };
    try {
      for (let i = 0; i < queue.length; i += 1) {
        const row = queue[i];
        if (runtimeFor(row.index, row.chunk.raw).status === "done") continue;
        const lock = getSunnyBanksCharacterLock(row.characterName);
        if (!lock || !row.location.image) {
          writeRuntime(i, {
            lineKey: row.chunk.raw,
            status: "failed",
            error: "Character or location is missing.",
          });
          break;
        }
        setRunningKind(row.kind);
        setRunningIndex(i);
        writeRuntime(i, { lineKey: row.chunk.raw, status: "rendering" });
        setProgressText(
          row.kind === "hold"
            ? `Line ${i + 1} of ${queue.length} — holding ${lock.name} at ${row.location.label} (~${SUNNY_BANKS_HOLD_DURATION_SEC}s)…`
            : `Line ${i + 1} of ${queue.length} — rendering ${lock.name}'s line…`
        );
        try {
          const startImageDataUrl = await resolveLocationDataUrl(row.location.image);
          const result = await postBeat({
            kind: row.kind,
            characterName: lock.name,
            line: row.line,
            locationId: row.location.id,
            locationImage: row.location.image,
            startImageDataUrl,
            action: row.chunk.action,
            appearanceModifier: row.chunk.appearanceModifier,
          });
          if (!result.ok) {
            writeRuntime(i, { lineKey: row.chunk.raw, status: "failed", error: result.message });
            setProgressText(`Stopped at line ${i + 1} — later lines were not billed.`);
            break;
          }
          writeRuntime(i, {
            lineKey: row.chunk.raw,
            status: "done",
            videoUrl: result.videoUrl,
            durationSec: result.durationSec,
            audioMuxed: result.audioMuxed,
            error:
              result.audioMuxed === false
                ? "Clip finished, but the driving audio did not land in the file. Lips may move with no sound."
                : undefined,
          });
        } catch (err) {
          writeRuntime(i, {
            lineKey: row.chunk.raw,
            status: "failed",
            error: err instanceof Error ? err.message : "Could not render this line.",
          });
          setProgressText(`Stopped at line ${i + 1} — later lines were not billed.`);
          break;
        }
      }
    } finally {
      runningRef.current = false;
      setRunningKind(null);
      setRunningIndex(null);
      setProgressText((current) => (current?.startsWith("Stopped") ? current : null));
    }
  };

  const collectEpisodePrompts = () => {
    const prompts: Array<{
      act: SunnyBanksActId;
      index: number;
      characterName: string;
      kind: BeatKind;
      line: string;
      locationId: string;
      prompt: string;
    }> = [];
    for (const act of actIds) {
      const chunks = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(actScripts[act] ?? ""));
      const overrides = characterOverridesByAct[act] ?? {};
      const locations = locationOverridesByAct[act] ?? {};
      chunks.forEach((chunk, index) => {
        const characterName = overrides[index] ?? chunk.characterName;
        const lock = getSunnyBanksCharacterLock(characterName);
        const locationId = locations[index] ?? chunk.locationId ?? defaultLocationId;
        const kind = chunk.kind;
        const gold = lock
          ? kind === "hold"
            ? buildSunnyBanksHoldPrompt(lock)
            : buildSunnyBanksSpeakingPrompt(lock, chunk.line)
          : "";
        const prompt = appendSunnyBanksActionToPrompt(
          gold,
          [chunk.action, chunk.appearanceModifier].filter(Boolean).join(" ")
        );
        prompts.push({
          act,
          index,
          characterName,
          kind,
          line: chunk.line,
          locationId,
          prompt,
        });
      });
    }
    return prompts;
  };

  const resolvedWorkspaceTitle = () =>
    workspaceTitle.trim() || workspaceLabelFromScripts(actScripts, "Sunny Banks episode", actIds);

  const captureScriptUndo = () => {
    setScriptUndo({
      actIds: [...actIds],
      activeAct,
      actScripts: cloneActRecord(actScripts, actIds),
      characterOverrides: cloneActRecord(characterOverridesByAct, actIds),
      locationOverrides: cloneActRecord(locationOverridesByAct, actIds),
      runtimeMap: cloneActRecord(runtimeMapByAct, actIds),
      workspaceTitle,
    });
  };

  const handleUndoScript = () => {
    if (!scriptUndo || running) return;
    setActIds([...scriptUndo.actIds]);
    setActiveAct(scriptUndo.activeAct);
    setActScripts(cloneActRecord(scriptUndo.actScripts, scriptUndo.actIds));
    setCharacterOverridesByAct(cloneActRecord(scriptUndo.characterOverrides, scriptUndo.actIds));
    setLocationOverridesByAct(cloneActRecord(scriptUndo.locationOverrides, scriptUndo.actIds));
    setRuntimeMapByAct(cloneActRecord(scriptUndo.runtimeMap, scriptUndo.actIds));
    setWorkspaceTitle(scriptUndo.workspaceTitle);
    setScriptUndo(null);
  };

  const handleScriptChange = (value: string) => {
    const decoded = decodeSunnyBanksPastedScript(value);
    const doc = parseSunnyBanksGodDocument(decoded, activeAct);
    if (doc.hasActHeaders || decoded !== scriptText) {
      captureScriptUndo();
    }
    if (doc.episodeTitle) setWorkspaceTitle(doc.episodeTitle);
    if (!doc.hasActHeaders) {
      setActScripts((prev) => ({ ...prev, [activeAct]: decoded }));
      return;
    }
    const nextIds = mergeSunnyBanksActIds(actIds, doc.actIds);
    setActIds(nextIds);
    setActScripts((prev) => {
      const next = { ...prev };
      for (const id of nextIds) {
        if (!(id in next)) next[id] = "";
      }
      for (const id of doc.actIds) {
        next[id] = doc.actScripts[id] ?? "";
      }
      if (!doc.actIds.includes(activeAct)) next[activeAct] = "";
      return next;
    });
    setCharacterOverridesByAct((prev) => {
      const next = { ...prev };
      for (const id of nextIds) {
        if (!(id in next)) next[id] = {};
      }
      for (const id of doc.actIds) next[id] = {};
      return next;
    });
    setLocationOverridesByAct((prev) => {
      const next = { ...prev };
      for (const id of nextIds) {
        if (!(id in next)) next[id] = {};
      }
      for (const id of doc.actIds) next[id] = {};
      return next;
    });
    setRuntimeMapByAct((prev) => {
      const next = { ...prev };
      for (const id of nextIds) {
        if (!(id in next)) next[id] = {};
      }
      return next;
    });
    if (!doc.actIds.includes(activeAct) && doc.actIds[0]) {
      setActiveAct(doc.actIds[0]);
    }
  };

  const handleAddAct = () => {
    if (running || actIds.length >= MAX_SUNNY_BANKS_ACTS) return;
    const id = nextSunnyBanksActId(actIds);
    setActIds((prev) => [...prev, id]);
    setActScripts((prev) => ({ ...prev, [id]: "" }));
    setCharacterOverridesByAct((prev) => ({ ...prev, [id]: {} }));
    setLocationOverridesByAct((prev) => ({ ...prev, [id]: {} }));
    setRuntimeMapByAct((prev) => ({ ...prev, [id]: {} }));
    setActiveAct(id);
    window.setTimeout(() => {
      actStripRef.current?.scrollTo({ left: actStripRef.current.scrollWidth, behavior: "smooth" });
    }, 0);
  };

  const handleSaveWorkspace = () => {
    workspaceSaveSeqRef.current += 1;
    const savedAt = Date.now();
    const actIdsSnapshot = [...actIds];
    const actScriptsSnapshot = cloneActRecord(actScripts, actIdsSnapshot);
    const characterOverridesSnapshot = cloneActRecord(characterOverridesByAct, actIdsSnapshot);
    const locationOverridesSnapshot = cloneActRecord(locationOverridesByAct, actIdsSnapshot);
    const runtimeMapSnapshot = cloneActRecord(runtimeMapByAct, actIdsSnapshot);
    const fingerprint = fingerprintWorkspace({
      defaultLocationId,
      actIds: actIdsSnapshot,
      activeAct,
      actScripts: actScriptsSnapshot,
      characterOverrides: characterOverridesSnapshot,
      locationOverrides: locationOverridesSnapshot,
      runtimeMap: runtimeMapSnapshot,
    });
    const snapshot: EpisodeWorkspace = {
      id: mintWorkspaceId(savedAt, workspaceSaveSeqRef.current, fingerprint),
      savedAt,
      fingerprint,
      label: resolvedWorkspaceTitle(),
      defaultLocationId,
      actIds: actIdsSnapshot,
      activeAct,
      actScripts: actScriptsSnapshot,
      characterOverrides: characterOverridesSnapshot,
      locationOverrides: locationOverridesSnapshot,
      runtimeMap: runtimeMapSnapshot,
    };
    setWorkspaces((prev) => [snapshot, ...prev]);
    setShelfOpen(true);
  };

  const handleDownloadEpisodeBundle = async () => {
    setBundleError(null);
    try {
      const { zipBytes, filename } = await buildSunnyBanksEpisodeBundle({
        title: resolvedWorkspaceTitle(),
        defaultLocationId,
        actIds,
        actScripts,
        prompts: collectEpisodePrompts(),
        clips: renderedClips,
      });
      const zipBlob = new Blob([zipBytes.slice().buffer], { type: "application/zip" });
      triggerBlobDownload(zipBlob, filename);
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : "Could not build the episode zip.");
    }
  };

  const handleDeleteWorkspace = (id: string) => {
    setWorkspaces((prev) => prev.filter((workspace) => workspace.id !== id));
  };

  const handleOpenWorkspace = (workspace: EpisodeWorkspace) => {
    if (running) return;
    setWorkspaceTitle(workspace.label);
    setDefaultLocationId(workspace.defaultLocationId);
    setActIds(workspace.actIds.length > 0 ? [...workspace.actIds] : [...SUNNY_BANKS_INITIAL_ACTS]);
    setActiveAct(workspace.activeAct);
    setActScripts(cloneActRecord(workspace.actScripts, workspace.actIds));
    setCharacterOverridesByAct(cloneActRecord(workspace.characterOverrides, workspace.actIds));
    setLocationOverridesByAct(cloneActRecord(workspace.locationOverrides, workspace.actIds));
    setRuntimeMapByAct(cloneActRecord(workspace.runtimeMap, workspace.actIds));
    setProgressText(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">Cast</p>
        {/* Square thumbnails, horizontal scroll — same shape as the
            "Choose a band" cover strip (`SkidmarksBandPicker`).
            `overscroll-x-contain` + `-webkit-overflow-scrolling:touch`
            match the plate strip's iOS Safari momentum-scroll fix. */}
        <div className="flex gap-2.5 overflow-x-auto overscroll-x-contain pb-1 pl-0.5 pr-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
          {SERIES_REGULARS.map((c) => {
            const startImage = resolveSunnyBanksStartImage(c);
            const ready = !!(c.voiceId && startImage);
            return (
              <div
                key={c.name}
                className={[
                  "relative flex h-20 w-20 shrink-0 overflow-hidden rounded-xl",
                  ready
                    ? "bg-amber-300/[0.04] ring-1 ring-inset ring-amber-300/30"
                    : "bg-white/[0.02] ring-1 ring-inset ring-white/10",
                ].join(" ")}
              >
                {startImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a fixed small static asset, not worth next/image here
                  <img src={startImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center border border-dashed border-white/15 text-[10px] text-white/25">
                    ?
                  </span>
                )}
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 px-1.5 py-1 text-center">
                  <span className={["line-clamp-1 text-[10px] font-semibold", ready ? "text-amber-100" : "text-white/60"].join(" ")}>
                    {c.name}
                  </span>
                  {!ready && <span className="text-[8px] leading-tight text-white/40">not ready</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex touch-pan-y flex-col gap-2.5 overscroll-y-contain rounded-2xl border border-amber-300/25 bg-amber-300/[0.03] p-3">
        {PLATE_CAST.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-white/40">
            No character has a reference plate yet.
          </p>
        ) : (
          <>
            <div className="flex min-w-0 items-start gap-2">
              <div
                ref={actStripRef}
                role="tablist"
                aria-label="Act"
                className="flex min-w-0 flex-1 flex-row flex-nowrap gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap touch-pan-x pb-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none]"
              >
                {actIds.map((act) => {
                  const selected = act === activeAct;
                  const lineCount = sunnyBanksQueueChunks(
                    parseSunnyBanksScriptBlock(actScripts[act] ?? "")
                  ).length;
                  return (
                    <button
                      key={act}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveAct(act)}
                      disabled={running}
                      className={[
                        "min-h-[40px] shrink-0 rounded-full px-3.5 text-[12px] font-semibold transition-colors disabled:opacity-60",
                        selected
                          ? "bg-amber-300 text-zinc-950"
                          : "bg-white/[0.04] text-white/70 ring-1 ring-inset ring-white/10",
                      ].join(" ")}
                    >
                      Act {act}
                      {lineCount > 0 ? ` · ${lineCount}` : ""}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={handleAddAct}
                  disabled={running || actIds.length >= MAX_SUNNY_BANKS_ACTS}
                  className="min-h-[40px] shrink-0 rounded-full bg-white/[0.04] px-3.5 text-[12px] font-semibold text-white/80 ring-1 ring-inset ring-white/10 disabled:opacity-60"
                >
                  + Add Act
                </button>
              </div>
              <button
                type="button"
                onClick={handleUndoScript}
                disabled={!scriptUndo || running}
                aria-label="Undo script"
                className="min-h-[40px] shrink-0 rounded-full bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
              >
                ↩ Undo
              </button>
            </div>
            <button
              type="button"
              onClick={() => setScriptOpen((open) => !open)}
              aria-expanded={scriptOpen}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-left"
            >
              <span className="text-[12px] font-semibold text-white/80">
                Show Script Text & Queued Lines
                <span aria-hidden className="ml-1.5 font-medium text-white/40">
                  {"\u00b7"} {queue.length}
                </span>
              </span>
              <ChevronIcon open={scriptOpen} />
            </button>
            {scriptOpen && (
              <div className="flex touch-pan-y flex-col gap-2.5 overscroll-y-contain">
                <textarea
                  value={scriptText}
                  onChange={(e) => handleScriptChange(e.target.value)}
                  onPaste={(e) => {
                    const raw =
                      e.clipboardData.getData("text/plain") || e.clipboardData.getData("text");
                    const decoded = decodeSunnyBanksPastedScript(raw);
                    if (decoded === raw) return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const start = el.selectionStart ?? el.value.length;
                    const end = el.selectionEnd ?? el.value.length;
                    handleScriptChange(`${el.value.slice(0, start)}${decoded}${el.value.slice(end)}`);
                  }}
                  disabled={running}
                  placeholder={"Shazza: You right?\nDazza: Yeah nah, she'll be right.\nRanger Bazza:"}
                  rows={5}
                  className="min-h-[7.5rem] w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm leading-relaxed text-white placeholder:text-white/30 focus:border-amber-300/40 focus:outline-none disabled:opacity-60"
                />
                <p className="text-[10px] leading-snug text-white/40">
                  One speaker per line — `Name:` or `Name says:`. Empty after the name is a
                  silent hold. Continuation lines keep the last speaker. Unit 4S stays barefoot;
                  gold look/voice strings are not edited here.
                </p>

                {queue.length > 0 && (
                  <ol className="flex min-w-0 flex-col border-y border-white/10">
                    {queue.map((row) => {
                      const runtime = runtimeFor(row.index, row.chunk.raw);
                      const status = row.index === runningIndex ? "rendering" : runtime?.status ?? "idle";
                      const isStatic = status === "done";
                      const lineLabel =
                        row.kind === "hold" ? "Silent hold" : row.line;
                      return (
                        <li key={`${activeAct}:${row.index}:${row.chunk.raw}`} className="min-w-0">
                          <div className="flex min-w-0 w-full items-start gap-1 overflow-x-hidden py-1.5 [touch-action:pan-y]">
                            <span className="w-4 shrink-0 pt-1 text-center text-[10px] font-medium text-white/40">
                              {row.index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-h-[32px] min-w-0 items-center gap-1">
                                {isStatic ? (
                                  <span className="min-w-0 truncate text-[12px] font-semibold text-white/90">
                                    {row.characterName}
                                  </span>
                                ) : (
                                  <select
                                    value={row.characterName}
                                    onChange={(e) =>
                                      setCharacterOverridesByAct((prev) => ({
                                        ...prev,
                                        [activeAct]: { ...(prev[activeAct] ?? {}), [row.index]: e.target.value },
                                      }))
                                    }
                                    disabled={running}
                                    aria-label={`Character for line ${row.index + 1}`}
                                    className="h-10 min-h-[40px] w-[4.75rem] max-w-[4.75rem] shrink-0 truncate rounded-lg border border-white/10 bg-white/[0.03] px-1 text-[12px] text-white disabled:opacity-60"
                                  >
                                    {CAST_LIST.map((c) => (
                                      <option key={c.name} value={c.name} className="bg-zinc-900">
                                        {c.name}
                                        {!c.referenceImage
                                          ? " (no plate)"
                                          : !c.voiceId
                                            ? " (no voice — hold only)"
                                            : ""}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {!isStatic && (
                                  <select
                                    value={row.location.id}
                                    onChange={(e) =>
                                      setLocationOverridesByAct((prev) => ({
                                        ...prev,
                                        [activeAct]: {
                                          ...(prev[activeAct] ?? {}),
                                          [row.index]: e.target.value as SunnyBanksLocationId,
                                        },
                                      }))
                                    }
                                    disabled={running}
                                    title={row.location.label}
                                    aria-label={`Location for line ${row.index + 1}`}
                                    className="h-10 min-h-[40px] min-w-0 max-w-[120px] shrink truncate rounded-lg border border-white/10 bg-white/[0.03] px-1 text-[12px] text-white disabled:opacity-60"
                                  >
                                    {LOCATION_LIST.map((location) => (
                                      <option key={location.id} value={location.id} className="bg-zinc-900">
                                        {compactQueueLocationLabel(location.label)}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                <span
                                  className={[
                                    "ml-auto flex-shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold",
                                    statusPillClass(status),
                                  ].join(" ")}
                                >
                                  {statusPillLabel(status)}
                                </span>
                              </div>
                              <details className="group min-w-0 pt-0.5">
                                <summary
                                  title={lineLabel}
                                  aria-label={`Spoken line ${row.index + 1}`}
                                  className="cursor-pointer list-none truncate text-[12px] leading-snug text-white/75 [-webkit-tap-highlight-color:transparent] group-open:whitespace-normal group-open:overflow-visible [&::-webkit-details-marker]:hidden"
                                >
                                  {lineLabel}
                                </summary>
                              </details>
                            </div>
                          </div>
                          {runtime?.status === "failed" && runtime.error && (
                            <p role="alert" className="pb-1.5 pl-5 text-[11px] leading-snug text-rose-300/90">
                              {runtime.error}
                            </p>
                          )}
                          {runtime?.status === "done" && runtime.error && (
                            <p role="status" className="pb-1.5 pl-5 text-[11px] leading-snug text-amber-200/80">
                              {runtime.error}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}

            {pendingRows.length > 0 && !canRenderAll && !running && (
              <p className="text-[10px] leading-snug text-white/40">
                Every line needs a plated character. Speak needs a locked voice. Change the
                dropdown or the script — Hans has no plate yet.
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleRenderAll()}
              disabled={!canRenderAll}
              className="min-h-[44px] w-full rounded-full bg-amber-300 px-3.5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-200 active:bg-amber-300/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running
                ? `Rendering line ${(runningIndex ?? 0) + 1} of ${queue.length}…`
                : queue.length === 0
                  ? "Render lines"
                  : pendingRows.length === 0
                    ? "Clips already loaded"
                    : `Render ${pendingRows.length} line${pendingRows.length === 1 ? "" : "s"}`}
            </button>
            <p className="text-[10px] leading-snug text-white/40">
              {pendingRows.length === 0
                ? "Existing Crash Lab clips are already in the strip below. Edit a line to render a new one — one clip at a time, never a batch of these 46."
                : `One clip at a time — overlay ~$${overlayCostUsd.toFixed(2)}${
                    pendingRows.filter((row) => row.kind === "hold").length > 0
                      ? `, hold video ~$${holdVideoCostUsd.toFixed(2)}`
                      : ""
                  }${speakCount > 0 ? `, speak video ~$0.13/s after TTS` : ""}. Stops if a line fails so later lines are not billed. Route still loads the full character lock by name for the gold prompts.`}
            </p>
          </>
        )}
        {progressText && (
          <p role="status" className="text-[11px] leading-snug text-amber-200/80">
            {progressText}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={() => setClipsOpen((open) => !open)}
          aria-expanded={clipsOpen}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
            Clips
            <span aria-hidden className="ml-1.5 text-white/25">
              {"\u00b7"} {renderedClips.length}
            </span>
          </span>
          <ChevronIcon open={clipsOpen} />
        </button>
        {clipsOpen &&
          (renderedClips.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-white/35">Nothing rendered yet.</p>
          ) : (
            <div className="flex gap-2.5 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
              {clipsByAct.map((group, groupIndex) => (
                <div key={group.act} className="flex shrink-0 items-stretch gap-2.5">
                  {groupIndex > 0 ? (
                    <div aria-hidden className="w-px shrink-0 self-stretch bg-white/10" />
                  ) : null}
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                      Act {group.act}
                    </span>
                    <div className="flex gap-2.5">
                      {group.clips.map((clip) => (
                        <div
                          key={`${clip.act}:${clip.index}:${clip.videoUrl}`}
                          className="flex w-44 shrink-0 touch-pan-x flex-col gap-1.5"
                        >
                          <video
                            src={clip.videoUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="h-28 w-44 rounded-xl bg-black object-cover"
                          />
                          <p className="truncate text-[11px] font-medium leading-tight text-white/70">
                            {clip.characterName}
                            {typeof clip.durationSec === "number"
                              ? ` \u00b7 ${clip.durationSec.toFixed(1)}s`
                              : ""}
                          </p>
                          <p className="truncate text-[10px] leading-tight text-white/40">
                            Line {clip.index + 1} · {clip.lineLabel}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-zinc-950/95">
        <div className="flex flex-col gap-2 px-3 pb-3 pt-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
              Episode name
            </span>
            <input
              type="text"
              value={workspaceTitle}
              onChange={(e) => setWorkspaceTitle(e.target.value)}
              disabled={running}
              placeholder="EP02 — Drop Bears Dilemma"
              className="min-h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-white placeholder:text-white/30 focus:border-amber-300/40 focus:outline-none disabled:opacity-60"
            />
          </label>
          <button
            type="button"
            onClick={handleSaveWorkspace}
            disabled={running}
            className="min-h-[44px] rounded-full bg-white px-3 text-[13px] font-semibold text-zinc-950 disabled:opacity-60"
          >
            Save Project Workspace
          </button>
          <button
            type="button"
            onClick={handleDownloadEpisodeBundle}
            disabled={running}
            className="min-h-[40px] rounded-full border border-white/15 bg-white/[0.04] px-3 text-[12px] font-semibold text-white/80 disabled:opacity-60"
          >
            Download Episode Bundle (.zip)
          </button>
          {bundleError && (
            <p role="alert" className="text-[11px] leading-snug text-rose-300/90">
              {bundleError}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShelfOpen((open) => !open)}
          aria-expanded={shelfOpen}
          className="flex min-h-[40px] w-full items-center justify-between gap-2 border-t border-white/10 px-3 text-[12px] font-semibold text-white/80"
        >
          <span>Episode workspace</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/45">
            {workspaces.length === 0 ? "empty" : `${workspaces.length} saved`}
            <ChevronIcon open={shelfOpen} />
          </span>
        </button>
        {shelfOpen && (
          <div className="flex flex-col gap-2 border-t border-white/10 px-3 pb-3 pt-2">
            {workspaces.length === 0 ? (
              <p className="text-[10px] leading-snug text-white/40">
                Each save mints a new card (timestamp + fingerprint). Snapshots stay on
                this open sheet — scripts, locations, and finished clip URLs. Not a Neon
                episode table, not localStorage. Zip is script + gold prompts + clip URL
                paths, not a re-render.
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto overscroll-x-contain touch-pan-x pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
                {workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="relative h-16 min-w-[9.5rem] shrink-0 rounded-xl border border-white/10 bg-white/[0.04]"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenWorkspace(workspace)}
                      disabled={running}
                      className="flex h-full w-full flex-col justify-center py-1.5 pl-2.5 pr-10 text-left disabled:opacity-60"
                    >
                      <span className="line-clamp-2 text-[11px] font-semibold text-white/85">
                        {workspace.label}
                      </span>
                      <span className="mt-0.5 text-[10px] text-white/40">
                        Act {workspace.activeAct}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteWorkspace(workspace.id)}
                      aria-label={`Delete ${workspace.label}`}
                      className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-rose-400"
                    >
                      <span aria-hidden className="text-[16px] font-semibold leading-none">
                        ✕
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
