"use client";

import { useState } from "react";
import { estimateLtxClipRenderCostUsd } from "@/lib/clipGeneration";
import { resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import {
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
 * not the full episode wizard Grok's spec describes (episode list,
 * script paste, beat list, progress + clip shelf, download zip) — this
 * is the same "prove the riskiest new piece in isolation before
 * building the wizard around it" order the backend route itself
 * followed: a direct, honest way to test one character's locked voice
 * + look actually rendering a real line, using the exact same
 * `/api/skidmarks/sunnybank/generate-speak-beat` route already proven
 * in PR #95. The script/episode automation is the next real slice, once
 * this confirms the render itself looks and sounds right on a real
 * device.
 *
 * **A character only shows as Speak-selectable once it has both a real
 * voice id and a real reference plate** — Hans (no voice yet, no plate)
 * and any future guest without a plate show in the cast strip so Stuart
 * can see who's missing what, but never as something this screen would
 * try to render with a stand-in. A Hold only needs the plate (no TTS),
 * so a plate-without-voice character could still Hold; today none of
 * the six regulars are in that state.
 *
 * **Silent Hold (2026-09-17)** — a second one-clip tap next to Speak.
 * Bypasses ElevenLabs. Still a real paid Comfy Cloud LTX render of a
 * fixed 5s pause (`SUNNY_BANKS_HOLD_DURATION_SEC`) using
 * `buildSunnyBanksHoldPrompt`. Same route, `kind: "hold"`. Not a
 * timeline, not a batch, not a new schema.
 *
 * **Start still is the hero cell, not the turnaround sheet
 * (2026-09-17)** — live QA: Silent Hold on Shazza animated every pose
 * on `shazza-reference.jpg` because that file is a character plate
 * (4 bodies + 4 heads) and the gold Hold prompt tells LTX to keep the
 * start image's people/objects. Cast thumbnails still resolve
 * `resolveSunnyBanksStartImage` (the cropped `*-hero.jpg` when one
 * exists). No pose picker, no in-memory canvas cropper.
 *
 * **Location plate as LTX first frame (2026-09-17)** — six locked park
 * stills (`SUNNY_BANKS_LOCATIONS`). A native `<select>` under the
 * character row (same iPhone-Safari control as the character picker)
 * picks one; Speak and Hold POST that still as `startImageDataUrl`,
 * plus `locationId` / `locationImage` alongside `characterName`. Not a
 * sequencer. Gold Hold/Speak prompt strings unchanged.
 */

const CAST_LIST = Object.values(SUNNY_BANKS_CAST);
/** The always-on cast strip only ever shows the locked series regulars
 * — a one-episode guest (Hans today) has no business sitting in a
 * permanent "the cast" row with no episode to scope him to (Stuart's
 * own correction, 2026-09-15). Still selectable in the line-test form
 * below once he has a voice + plate — this only hides the strip. */
const SERIES_REGULARS = CAST_LIST.filter((c) => !c.guest);

type BeatKind = "speak" | "hold";

type GenerateBeatResult =
  | { ok: true; videoUrl: string; durationSec: number; kind: BeatKind }
  | { ok: false; message: string };

interface GenerateBeatResponseBody {
  videoUrl?: unknown;
  durationSec?: unknown;
  error?: unknown;
  kind?: unknown;
}

const HOLD_COST_USD = estimateLtxClipRenderCostUsd(SUNNY_BANKS_HOLD_DURATION_SEC);
const LOCATION_LIST = Object.values(SUNNY_BANKS_LOCATIONS);

export function SkidmarksSunnyBanksPanel() {
  const plateCast = CAST_LIST.filter((c) => c.referenceImage);
  const [selectedName, setSelectedName] = useState<string>(plateCast[0]?.name ?? "");
  const [selectedLocationId, setSelectedLocationId] = useState<SunnyBanksLocationId>(
    SUNNY_BANKS_DEFAULT_LOCATION_ID
  );
  const [line, setLine] = useState("");
  const [runningKind, setRunningKind] = useState<BeatKind | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateBeatResult | null>(null);

  const selected = plateCast.find((c) => c.name === selectedName);
  const selectedLocation =
    getSunnyBanksLocation(selectedLocationId) ?? SUNNY_BANKS_LOCATIONS[SUNNY_BANKS_DEFAULT_LOCATION_ID];
  const running = runningKind !== null;
  const canSpeak = !!(selected?.voiceId && selectedLocation.image && line.trim());
  const canHold = !!(selected && selectedLocation.image);

  const handleGenerate = async (kind: BeatKind) => {
    if (!selected || !selectedLocation.image || running) return;
    if (kind === "speak" && (!selected.voiceId || !line.trim())) return;
    setRunningKind(kind);
    setResult(null);
    setProgressText(`Getting ${selectedLocation.label} ready…`);
    try {
      const startImageDataUrl = await resolvePlateReferenceDataUrl(selectedLocation.image);
      setProgressText(
        kind === "hold"
          ? `Rendering ${selected.name} at ${selectedLocation.label} (~${SUNNY_BANKS_HOLD_DURATION_SEC}s) — this can take a minute or two…`
          : `Rendering ${selected.name}'s line — this can take a minute or two…`
      );
      const res = await fetch("/api/skidmarks/sunnybank/generate-speak-beat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "hold"
            ? {
                kind: "hold",
                characterName: selected.name,
                locationId: selectedLocation.id,
                locationImage: selectedLocation.image,
                startImageDataUrl,
              }
            : {
                characterName: selected.name,
                line,
                locationId: selectedLocation.id,
                locationImage: selectedLocation.image,
                startImageDataUrl,
              }
        ),
      });
      const body = (await res.json()) as GenerateBeatResponseBody;
      const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";
      if (!res.ok || !videoUrl) {
        setResult({
          ok: false,
          message: typeof body.error === "string" ? body.error : `Render failed (HTTP ${res.status}).`,
        });
        return;
      }
      setResult({
        ok: true,
        videoUrl,
        durationSec: typeof body.durationSec === "number" ? body.durationSec : 0,
        kind: body.kind === "hold" ? "hold" : "speak",
      });
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : kind === "hold" ? "Could not render this hold." : "Could not render this line.",
      });
    } finally {
      setRunningKind(null);
      setProgressText(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">Cast</p>
        {/* Square thumbnails, horizontal scroll — same shape as the
            "Choose a band" cover strip (`SkidmarksBandPicker`), swapped
            in 2026-09-17 for the old wrapping row of round chips
            (Stuart's own ask, a cast that outgrows one row shouldn't
            wrap to a second). `overscroll-x-contain` +
            `-webkit-overflow-scrolling:touch` match the plate strip's
            own iOS Safari momentum-scroll fix
            (`SkidmarksClipStub.tsx`) since this strip sits inside the
            same vertically-scrolling sheet; no `touch-pan-x` needed on
            the tiles themselves since they carry no press-and-hold/drag
            gesture of their own, just a static portrait + name. */}
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

      <div className="flex flex-col gap-2.5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.03] p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Try one line</p>
        {plateCast.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-white/40">
            No character has a reference plate yet.
          </p>
        ) : (
          <>
            <select
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              disabled={running}
              aria-label="Character"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white disabled:opacity-60"
            >
              {plateCast.map((c) => (
                <option key={c.name} value={c.name} className="bg-zinc-900">
                  {c.name}
                  {!c.voiceId ? " (no voice — hold only)" : ""}
                </option>
              ))}
            </select>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value as SunnyBanksLocationId)}
              disabled={running}
              aria-label="Location"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white disabled:opacity-60"
            >
              {LOCATION_LIST.map((location) => (
                <option key={location.id} value={location.id} className="bg-zinc-900">
                  {location.label}
                </option>
              ))}
            </select>
            <textarea
              value={line}
              onChange={(e) => setLine(e.target.value)}
              disabled={running}
              placeholder="What does this character say?"
              rows={3}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-amber-300/40 focus:outline-none disabled:opacity-60"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleGenerate("speak")}
                disabled={running || !canSpeak}
                className="rounded-full bg-amber-300 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-200 active:bg-amber-300/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runningKind === "speak" ? "Rendering…" : "Generate speak beat"}
              </button>
              <button
                type="button"
                onClick={() => void handleGenerate("hold")}
                disabled={running || !canHold}
                className="rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-2 text-sm font-semibold text-white/85 transition-colors hover:bg-white/[0.08] active:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runningKind === "hold" ? "Rendering…" : "Generate silent hold"}
              </button>
            </div>
            <p className="text-[10px] leading-snug text-white/40">
              Speak is voice + LTX. Hold skips ElevenLabs — still a real Comfy Cloud LTX
              render, {SUNNY_BANKS_HOLD_DURATION_SEC}s, ~${HOLD_COST_USD.toFixed(2)} (stand-in
              rate). One clip at a time.
            </p>
          </>
        )}
        {progressText && (
          <p role="status" className="text-[11px] leading-snug text-amber-200/80">
            {progressText}
          </p>
        )}
        {result && !result.ok && (
          <p role="alert" className="text-[11px] leading-snug text-rose-300/90">
            {result.message}
          </p>
        )}
        {result?.ok && (
          <div className="flex flex-col gap-1.5">
            <p role="status" className="text-[11px] leading-snug text-emerald-300/85">
              Done — {result.kind === "hold" ? "silent hold" : "speak"} · {result.durationSec.toFixed(1)}s.
            </p>
            <video src={result.videoUrl} controls playsInline className="w-full rounded-xl" />
          </div>
        )}
      </div>
    </div>
  );
}
