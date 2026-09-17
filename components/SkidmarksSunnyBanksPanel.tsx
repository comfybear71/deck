"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ESTIMATED_STILL_COST_USD } from "@/lib/autoPlate";
import { estimateLtxClipRenderCostUsd } from "@/lib/clipGeneration";
import { resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import {
  getSunnyBanksCharacterLock,
  getSunnyBanksLocation,
  resolveSunnyBanksStartImage,
  SUNNY_BANKS_CAST,
  SUNNY_BANKS_DEFAULT_LOCATION_ID,
  SUNNY_BANKS_HOLD_DURATION_SEC,
  SUNNY_BANKS_LOCATIONS,
  type SunnyBanksLocationId,
} from "@/lib/sunnyBanks";

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
 * swap three script buffers in this component — not a Neon act table.
 * The bottom shelf snapshots those buffers + location ids + finished
 * clip URLs as a workspace sheet for this open detail-sheet only.
 * No `localStorage`, no new session schema. Sunny Banks has no song
 * MP3; driving audio is TTS at render time, so a workspace stores the
 * finished LTX URL rather than an MP3 path. Finished clips are a 40px
 * thumb; tap opens a body-portaled player (iOS Safari stacking).
 */

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

export const SUNNY_BANKS_ACTS = ["I", "II", "III"] as const;
export type SunnyBanksActId = (typeof SUNNY_BANKS_ACTS)[number];

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
  label: string;
  defaultLocationId: SunnyBanksLocationId;
  activeAct: SunnyBanksActId;
  actScripts: ActKeyed<string>;
  characterOverrides: ActKeyed<Record<number, string>>;
  locationOverrides: ActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: ActKeyed<Record<number, RowRuntime>>;
}

const HOLD_COST_USD = estimateLtxClipRenderCostUsd(SUNNY_BANKS_HOLD_DURATION_SEC);
const LOCATION_LIST = Object.values(SUNNY_BANKS_LOCATIONS);
const PLATE_CAST = CAST_LIST.filter((c) => c.referenceImage);
const FALLBACK_CHARACTER_NAME = PLATE_CAST[0]?.name ?? "";

function emptyActRecord<T>(make: () => T): ActKeyed<T> {
  return { I: make(), II: make(), III: make() };
}

function cloneActRecord<T>(value: ActKeyed<T>): ActKeyed<T> {
  return {
    I: structuredClone(value.I),
    II: structuredClone(value.II),
    III: structuredClone(value.III),
  };
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

function workspaceLabelFromScripts(actScripts: ActKeyed<string>, fallback: string): string {
  for (const act of SUNNY_BANKS_ACTS) {
    const first = actScripts[act]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first) return first.length > 36 ? `${first.slice(0, 33)}…` : first;
  }
  return fallback;
}

function CloseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
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

function SunnyBanksClipLightbox({
  videoUrl,
  label,
  onClose,
}: {
  videoUrl: string;
  label: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative z-10 flex w-full max-w-sm flex-col gap-3 animate-[sheet-in_0.18s_ease-out]"
      >
        <video src={videoUrl} controls autoPlay playsInline className="w-full rounded-2xl" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 text-white/80 ring-1 ring-white/15"
        >
          <CloseIcon />
        </button>
      </div>
    </div>,
    document.body
  );
}

export function SkidmarksSunnyBanksPanel() {
  const [activeAct, setActiveAct] = useState<SunnyBanksActId>("I");
  const [actScripts, setActScripts] = useState<ActKeyed<string>>(() => emptyActRecord(() => ""));
  const [defaultLocationId, setDefaultLocationId] = useState<SunnyBanksLocationId>(
    SUNNY_BANKS_DEFAULT_LOCATION_ID
  );
  const [characterOverridesByAct, setCharacterOverridesByAct] = useState<ActKeyed<Record<number, string>>>(
    () => emptyActRecord(() => ({}))
  );
  const [locationOverridesByAct, setLocationOverridesByAct] = useState<
    ActKeyed<Record<number, SunnyBanksLocationId>>
  >(() => emptyActRecord(() => ({})));
  const [runtimeMapByAct, setRuntimeMapByAct] = useState<ActKeyed<Record<number, RowRuntime>>>(() =>
    emptyActRecord(() => ({}))
  );
  const [runningKind, setRunningKind] = useState<BeatKind | null>(null);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<EpisodeWorkspace[]>([]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [playingClip, setPlayingClip] = useState<{ url: string; label: string } | null>(null);
  const locationDataUrlCacheRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);

  const scriptText = actScripts[activeAct];
  const characterOverrides = characterOverridesByAct[activeAct];
  const locationOverrides = locationOverridesByAct[activeAct];
  const runtimeMap = runtimeMapByAct[activeAct];
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

  const overlayCostUsd = queue.length * ESTIMATED_STILL_COST_USD;
  const holdVideoCostUsd = queue.filter((row) => row.kind === "hold").length * HOLD_COST_USD;
  const speakCount = queue.filter((row) => row.kind === "speak").length;

  const canRenderAll =
    queue.length > 0 &&
    !running &&
    queue.every((row) => {
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
        [act]: { ...prev[act], [index]: next },
      }));
    };
    try {
      for (let i = 0; i < queue.length; i += 1) {
        const row = queue[i];
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

  const handleSaveWorkspace = () => {
    const id = `${Date.now()}`;
    const snapshot: EpisodeWorkspace = {
      id,
      savedAt: Date.now(),
      label: workspaceLabelFromScripts(actScripts, `Episode ${workspaces.length + 1}`),
      defaultLocationId,
      activeAct,
      actScripts: cloneActRecord(actScripts),
      characterOverrides: cloneActRecord(characterOverridesByAct),
      locationOverrides: cloneActRecord(locationOverridesByAct),
      runtimeMap: cloneActRecord(runtimeMapByAct),
    };
    setWorkspaces((prev) => [snapshot, ...prev]);
    setShelfOpen(true);
  };

  const handleOpenWorkspace = (workspace: EpisodeWorkspace) => {
    if (running) return;
    setDefaultLocationId(workspace.defaultLocationId);
    setActiveAct(workspace.activeAct);
    setActScripts(cloneActRecord(workspace.actScripts));
    setCharacterOverridesByAct(cloneActRecord(workspace.characterOverrides));
    setLocationOverridesByAct(cloneActRecord(workspace.locationOverrides));
    setRuntimeMapByAct(cloneActRecord(workspace.runtimeMap));
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

      <div className="flex flex-col gap-2.5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.03] p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Script</p>
        {PLATE_CAST.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-white/40">
            No character has a reference plate yet.
          </p>
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Act"
              className="flex gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x pb-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]"
            >
              {SUNNY_BANKS_ACTS.map((act) => {
                const selected = act === activeAct;
                const lineCount = parseSunnyBanksScriptBlock(actScripts[act]).length;
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
                      <div className="flex min-h-[44px] items-center gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x py-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none]">
                        <span className="w-4 shrink-0 text-center text-[10px] font-medium text-white/40">
                          {row.index + 1}
                        </span>
                        <select
                          value={row.characterName}
                          onChange={(e) =>
                            setCharacterOverridesByAct((prev) => ({
                              ...prev,
                              [activeAct]: { ...prev[activeAct], [row.index]: e.target.value },
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
                                ...prev[activeAct],
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
                        {runtime?.status === "done" && runtime.videoUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPlayingClip({
                                url: runtime.videoUrl as string,
                                label: `Line ${row.index + 1} — ${row.characterName}`,
                              })
                            }
                            aria-label={`Play line ${row.index + 1}`}
                            className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-white/25"
                          >
                            <video
                              src={runtime.videoUrl}
                              muted
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ) : (
                          <span className="h-10 w-10 shrink-0 rounded-md border border-dashed border-white/15" />
                        )}
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

            {queue.length > 0 && !canRenderAll && !running && (
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
                  : `Render ${queue.length} line${queue.length === 1 ? "" : "s"}`}
            </button>
            <p className="text-[10px] leading-snug text-white/40">
              One clip at a time — overlay ~${overlayCostUsd.toFixed(2)}
              {queue.filter((row) => row.kind === "hold").length > 0
                ? `, hold video ~$${holdVideoCostUsd.toFixed(2)}`
                : ""}
              {speakCount > 0 ? `, speak video ~$0.13/s after TTS` : ""}
              . Stops if a line fails so later lines are not billed. Route still loads the
              full character lock by name for the gold prompts.
            </p>
          </>
        )}
        {progressText && (
          <p role="status" className="text-[11px] leading-snug text-amber-200/80">
            {progressText}
          </p>
        )}
      </div>

      <div className="sticky bottom-0 z-20 rounded-xl border border-white/10 bg-zinc-950/95">
        <button
          type="button"
          onClick={() => setShelfOpen((open) => !open)}
          aria-expanded={shelfOpen}
          className="flex min-h-[40px] w-full items-center justify-between gap-2 px-3 text-[12px] font-semibold text-white/80"
        >
          <span>Episode workspace</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/45">
            {workspaces.length === 0 ? "empty" : `${workspaces.length} saved`}
            <ChevronIcon open={shelfOpen} />
          </span>
        </button>
        {shelfOpen && (
          <div className="flex flex-col gap-2 border-t border-white/10 px-3 pb-3 pt-2">
            <button
              type="button"
              onClick={handleSaveWorkspace}
              disabled={running}
              className="min-h-[40px] rounded-full border border-white/15 bg-white/[0.04] px-3 text-[12px] font-semibold text-white/80 disabled:opacity-60"
            >
              Save current acts
            </button>
            {workspaces.length === 0 ? (
              <p className="text-[10px] leading-snug text-white/40">
                Snapshots stay on this open sheet — scripts, locations, and finished
                clip URLs. Not a Neon episode table, not localStorage. No song MP3
                in Sunny Banks; TTS is generated at render time.
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto overscroll-x-contain touch-pan-x pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => handleOpenWorkspace(workspace)}
                    disabled={running}
                    className="flex h-16 min-w-[9.5rem] shrink-0 flex-col justify-center rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-left disabled:opacity-60"
                  >
                    <span className="line-clamp-2 text-[11px] font-semibold text-white/85">
                      {workspace.label}
                    </span>
                    <span className="mt-0.5 text-[10px] text-white/40">
                      Act {workspace.activeAct}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {playingClip && (
        <SunnyBanksClipLightbox
          videoUrl={playingClip.url}
          label={playingClip.label}
          onClose={() => setPlayingClip(null)}
        />
      )}
    </div>
  );
}
