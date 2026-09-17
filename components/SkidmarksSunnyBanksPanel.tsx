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
 * strip. The bottom shelf snapshots those buffers + location ids +
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
 * scroller. Queue rows still allow horizontal pan for the selects
 * (`touch-action: pan-x pan-y`) — `touch-pan-x` alone is what locked
 * vertical momentum on those rows.
 *
 * **Clips live in one Act-grouped strip (2026-09-17, live QA)** —
 * 40px thumbs in each dialogue row cluttered the queue. Rows are
 * text-only now. Finished MP4s sit in one `overflow-x-auto` row at
 * the base of the working panel (after the script, before the
 * Episode workspace, same reading order as music-video rendered
 * clips then archive), same card size and `touch-pan-x` as
 * `SkidmarksRenderedClipsShelf` (`w-44` / `h-28`, inline controls),
 * sectioned Act I / II / III. Workspace save always mints a new card
 * (`mintWorkspaceId` = timestamp + seq + content fingerprint) instead
 * of reusing `Date.now()` as a key that could collide on a double-tap.
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
  kind: BeatKind;
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
};

type ActKeyed<T> = Record<SunnyBanksActId, T>;

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

/**
 * Split a pasted script on newlines into Speak/Hold chunks.
 * Looks up speakers against `SUNNY_BANKS_CAST` keys (name-keyed
 * records, never a guessed id). Empty dialogue after a speaker prefix
 * is a Hold. A line with no prefix continues the previous speaker.
 * Blank lines are skipped. Does not touch gold prompt strings.
 */
export function parseSunnyBanksScriptBlock(text: string): SunnyBanksScriptChunk[] {
  const chunks: SunnyBanksScriptChunk[] = [];
  let previousName = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw) continue;
    const matched = matchSpeakerPrefix(raw);
    let characterName: string;
    let line: string;
    if (matched) {
      characterName = matched.name;
      line = matched.rest;
      previousName = matched.name;
    } else {
      characterName = previousName || FALLBACK_CHARACTER_NAME;
      line = raw;
      if (characterName) previousName = characterName;
    }
    chunks.push({
      raw,
      characterName,
      line,
      kind: line.length > 0 ? "speak" : "hold",
    });
  }
  return chunks;
}

function statusPillLabel(status: RowStatus): string {
  if (status === "rendering") return "Rendering...";
  if (status === "done") return "Done";
  if (status === "failed") return "Failed";
  return "Idle";
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
    const chunks = parseSunnyBanksScriptBlock(args.actScripts[act] ?? "");
    const runtimes = args.runtimeMap[act] ?? {};
    const overrides = args.characterOverrides[act] ?? {};
    chunks.forEach((chunk, index) => {
      const stored = runtimes[index];
      if (!stored || stored.lineKey !== chunk.raw || stored.status !== "done" || !stored.videoUrl) {
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
  const [bundleError, setBundleError] = useState<string | null>(null);
  const actStripRef = useRef<HTMLDivElement>(null);
  const locationDataUrlCacheRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);
  const workspaceSaveSeqRef = useRef(0);

  const scriptText = actScripts[activeAct] ?? "";
  const characterOverrides = characterOverridesByAct[activeAct] ?? {};
  const locationOverrides = locationOverridesByAct[activeAct] ?? {};
  const runtimeMap = runtimeMapByAct[activeAct] ?? {};
  const parsed = useMemo(() => parseSunnyBanksScriptBlock(scriptText), [scriptText]);
  const running = runningKind !== null;

  const runtimeFor = (index: number, raw: string): RowRuntime => {
    const stored = runtimeMap[index];
    if (stored && stored.lineKey === raw) return stored;
    return { lineKey: raw, status: "idle" };
  };

  const queue = parsed.map((chunk, index) => {
    const characterName = characterOverrides[index] ?? chunk.characterName;
    const locationId = locationOverrides[index] ?? defaultLocationId;
    const character = getSunnyBanksCharacterLock(characterName);
    const location = getSunnyBanksLocation(locationId) ?? SUNNY_BANKS_LOCATIONS[SUNNY_BANKS_DEFAULT_LOCATION_ID];
    const line = chunk.line;
    const kind: BeatKind = line.length > 0 ? "speak" : "hold";
    return { chunk, index, characterName, character, location, line, kind };
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
  }): Promise<
    | { ok: true; videoUrl: string; durationSec: number; audioMuxed?: boolean }
    | { ok: false; message: string }
  > => {
    const res = await fetch("/api/skidmarks/sunnybank/generate-speak-beat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        args.kind === "hold"
          ? {
              kind: "hold",
              characterName: args.characterName,
              locationId: args.locationId,
              locationImage: args.locationImage,
              startImageDataUrl: args.startImageDataUrl,
            }
          : {
              characterName: args.characterName,
              line: args.line,
              locationId: args.locationId,
              locationImage: args.locationImage,
              startImageDataUrl: args.startImageDataUrl,
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
      setRuntimeMapByAct((prev) => ({
        ...prev,
        [act]: { ...(prev[act] ?? {}), [index]: next },
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
      const chunks = parseSunnyBanksScriptBlock(actScripts[act] ?? "");
      const overrides = characterOverridesByAct[act] ?? {};
      const locations = locationOverridesByAct[act] ?? {};
      chunks.forEach((chunk, index) => {
        const characterName = overrides[index] ?? chunk.characterName;
        const lock = getSunnyBanksCharacterLock(characterName);
        const locationId = locations[index] ?? defaultLocationId;
        const kind: BeatKind = chunk.line.length > 0 ? "speak" : "hold";
        const prompt = lock
          ? kind === "hold"
            ? buildSunnyBanksHoldPrompt(lock)
            : buildSunnyBanksSpeakingPrompt(lock, chunk.line)
          : "";
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
            <div
              ref={actStripRef}
              role="tablist"
              aria-label="Act"
              className="flex flex-row flex-nowrap gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap touch-pan-x pb-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none]"
            >
              {actIds.map((act) => {
                const selected = act === activeAct;
                const lineCount = parseSunnyBanksScriptBlock(actScripts[act] ?? "").length;
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
            <select
              value={defaultLocationId}
              onChange={(e) => setDefaultLocationId(e.target.value as SunnyBanksLocationId)}
              disabled={running}
              aria-label="Default location"
              className="min-h-[40px] w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-white disabled:opacity-60"
            >
              {LOCATION_LIST.map((location) => (
                <option key={location.id} value={location.id} className="bg-zinc-900">
                  {location.label}
                </option>
              ))}
            </select>
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
                  onChange={(e) =>
                    setActScripts((prev) => ({
                      ...prev,
                      [activeAct]: e.target.value,
                    }))
                  }
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
                  <ol className="flex flex-col border-y border-white/10">
                    {queue.map((row) => {
                      const runtime = runtimeFor(row.index, row.chunk.raw);
                      const status = row.index === runningIndex ? "rendering" : runtime?.status ?? "idle";
                      const lineLabel =
                        row.kind === "hold" ? "Silent hold" : row.line;
                      return (
                        <li key={`${activeAct}:${row.index}:${row.chunk.raw}`}>
                          <div className="flex min-h-[44px] items-center gap-1.5 overflow-x-auto overscroll-x-contain py-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [touch-action:pan-x_pan-y]">
                            <span className="w-4 shrink-0 text-center text-[10px] font-medium text-white/40">
                              {row.index + 1}
                            </span>
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
                              className="min-h-[40px] min-w-[6.5rem] shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-1.5 text-[12px] text-white disabled:opacity-60"
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
                            <p className="min-w-[7rem] flex-1 truncate text-[12px] leading-snug text-white/90">
                              {lineLabel}
                            </p>
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
                              aria-label={`Location for line ${row.index + 1}`}
                              className="min-h-[40px] min-w-[7rem] shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-1.5 text-[12px] text-white disabled:opacity-60"
                            >
                              {LOCATION_LIST.map((location) => (
                                <option key={location.id} value={location.id} className="bg-zinc-900">
                                  {location.label}
                                </option>
                              ))}
                            </select>
                            <span
                              className={[
                                "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold",
                                statusPillClass(status),
                              ].join(" ")}
                            >
                              {statusPillLabel(status)}
                            </span>
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
