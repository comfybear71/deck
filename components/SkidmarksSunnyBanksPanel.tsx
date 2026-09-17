"use client";

import { useMemo, useRef, useState } from "react";
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
}

type RowRuntime = {
  lineKey: string;
  status: RowStatus;
  videoUrl?: string;
  durationSec?: number;
  error?: string;
};

const HOLD_COST_USD = estimateLtxClipRenderCostUsd(SUNNY_BANKS_HOLD_DURATION_SEC);
const LOCATION_LIST = Object.values(SUNNY_BANKS_LOCATIONS);
const PLATE_CAST = CAST_LIST.filter((c) => c.referenceImage);
const FALLBACK_CHARACTER_NAME = PLATE_CAST[0]?.name ?? "";

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

export function SkidmarksSunnyBanksPanel() {
  const [defaultLocationId, setDefaultLocationId] = useState<SunnyBanksLocationId>(
    SUNNY_BANKS_DEFAULT_LOCATION_ID
  );
  const [scriptText, setScriptText] = useState("");
  const [characterOverrides, setCharacterOverrides] = useState<Record<number, string>>({});
  const [locationOverrides, setLocationOverrides] = useState<Record<number, SunnyBanksLocationId>>(
    {}
  );
  const [runtimeMap, setRuntimeMap] = useState<Record<number, RowRuntime>>({});
  const [runningKind, setRunningKind] = useState<BeatKind | null>(null);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const locationDataUrlCacheRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);

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
  const holdVideoCostUsd =
    queue.filter((row) => row.kind === "hold").length * HOLD_COST_USD;
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
  }): Promise<{ ok: true; videoUrl: string; durationSec: number } | { ok: false; message: string }> => {
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
    };
  };

  const handleRenderAll = async () => {
    if (!canRenderAll || runningRef.current) return;
    runningRef.current = true;
    try {
      for (let i = 0; i < queue.length; i += 1) {
        const row = queue[i];
        const lock = getSunnyBanksCharacterLock(row.characterName);
        if (!lock || !row.location.image) {
          setRuntimeMap((prev) => ({
            ...prev,
            [i]: {
              lineKey: row.chunk.raw,
              status: "failed",
              error: "Character or location is missing.",
            },
          }));
          break;
        }
        setRunningKind(row.kind);
        setRunningIndex(i);
        setRuntimeMap((prev) => ({
          ...prev,
          [i]: { lineKey: row.chunk.raw, status: "rendering" },
        }));
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
            setRuntimeMap((prev) => ({
              ...prev,
              [i]: { lineKey: row.chunk.raw, status: "failed", error: result.message },
            }));
            setProgressText(`Stopped at line ${i + 1} — later lines were not billed.`);
            break;
          }
          setRuntimeMap((prev) => ({
            ...prev,
            [i]: {
              lineKey: row.chunk.raw,
              status: "done",
              videoUrl: result.videoUrl,
              durationSec: result.durationSec,
            },
          }));
        } catch (err) {
          setRuntimeMap((prev) => ({
            ...prev,
            [i]: {
              lineKey: row.chunk.raw,
              status: "failed",
              error: err instanceof Error ? err.message : "Could not render this line.",
            },
          }));
          setProgressText(`Stopped at line ${i + 1} — later lines were not billed.`);
          break;
        }
      }
    } finally {
      runningRef.current = false;
      setRunningKind(null);
      setRunningIndex(null);
      setProgressText((current) =>
        current?.startsWith("Stopped") ? current : null
      );
    }
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

      <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.03] p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Script</p>
        {PLATE_CAST.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-white/40">
            No character has a reference plate yet.
          </p>
        ) : (
          <>
            <select
              value={defaultLocationId}
              onChange={(e) => setDefaultLocationId(e.target.value as SunnyBanksLocationId)}
              disabled={running}
              aria-label="Default location"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white disabled:opacity-60"
            >
              {LOCATION_LIST.map((location) => (
                <option key={location.id} value={location.id} className="bg-zinc-900">
                  {location.label}
                </option>
              ))}
            </select>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              disabled={running}
              placeholder={"Shazza: You right?\nDazza: Yeah nah, she'll be right.\nRanger Bazza:"}
              rows={8}
              className="min-h-[11rem] w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-white/30 focus:border-amber-300/40 focus:outline-none disabled:opacity-60"
            />
            <p className="text-[10px] leading-snug text-white/40">
              One speaker per line — `Name:` or `Name says:`. Empty after the name is a
              silent hold. Continuation lines keep the last speaker. Unit 4S stays barefoot;
              gold look/voice strings are not edited here.
            </p>

            {queue.length > 0 && (
              <ol className="flex flex-col gap-2.5">
                {queue.map((row) => {
                  const runtime = runtimeFor(row.index, row.chunk.raw);
                  const status = row.index === runningIndex ? "rendering" : runtime?.status ?? "idle";
                  return (
                    <li
                      key={`${row.index}:${row.chunk.raw}`}
                      className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">
                          Line {row.index + 1}
                          {row.kind === "hold" ? " · hold" : ""}
                        </span>
                        <span
                          className={["rounded-full px-2 py-0.5 text-[10px] font-semibold", statusPillClass(status)].join(
                            " "
                          )}
                        >
                          {statusPillLabel(status)}
                        </span>
                      </div>
                      <select
                        value={row.characterName}
                        onChange={(e) =>
                          setCharacterOverrides((prev) => ({ ...prev, [row.index]: e.target.value }))
                        }
                        disabled={running}
                        aria-label={`Character for line ${row.index + 1}`}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white disabled:opacity-60"
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
                      <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm leading-relaxed text-white/90">
                        {row.kind === "hold" ? "Silent hold — no dialogue." : row.line}
                      </p>
                      <select
                        value={row.location.id}
                        onChange={(e) =>
                          setLocationOverrides((prev) => ({
                            ...prev,
                            [row.index]: e.target.value as SunnyBanksLocationId,
                          }))
                        }
                        disabled={running}
                        aria-label={`Location for line ${row.index + 1}`}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white disabled:opacity-60"
                      >
                        {LOCATION_LIST.map((location) => (
                          <option key={location.id} value={location.id} className="bg-zinc-900">
                            {location.label}
                          </option>
                        ))}
                      </select>
                      {runtime?.status === "failed" && runtime.error && (
                        <p role="alert" className="text-[11px] leading-snug text-rose-300/90">
                          {runtime.error}
                        </p>
                      )}
                      {runtime?.status === "done" && runtime.videoUrl && (
                        <div className="flex flex-col gap-1.5">
                          <p role="status" className="text-[11px] leading-snug text-emerald-300/85">
                            Done — {row.kind === "hold" ? "silent hold" : "speak"}
                            {typeof runtime.durationSec === "number" ? ` · ${runtime.durationSec.toFixed(1)}s` : ""}.
                          </p>
                          <video src={runtime.videoUrl} controls playsInline className="w-full rounded-xl" />
                        </div>
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
    </div>
  );
}
