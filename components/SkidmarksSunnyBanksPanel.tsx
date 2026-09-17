"use client";

import { useState } from "react";
import { resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import { SUNNY_BANKS_CAST } from "@/lib/sunnyBanks";

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
 * **A character only shows as selectable once it has both a real voice
 * id and a real reference plate** — Hans (no voice yet) and any future
 * guest without a plate show in the cast strip so Stuart can see who's
 * missing what, but never as something this screen would try to render
 * with a stand-in.
 */

const CAST_LIST = Object.values(SUNNY_BANKS_CAST);
/** The always-on cast strip only ever shows the locked series regulars
 * — a one-episode guest (Hans today) has no business sitting in a
 * permanent "the cast" row with no episode to scope him to (Stuart's
 * own correction, 2026-09-15). Still selectable in the line-test form
 * below once he has a voice + plate — this only hides the strip. */
const SERIES_REGULARS = CAST_LIST.filter((c) => !c.guest);

type GenerateSpeakBeatResult =
  | { ok: true; videoUrl: string; durationSec: number }
  | { ok: false; message: string };

interface GenerateSpeakBeatResponseBody {
  videoUrl?: unknown;
  durationSec?: unknown;
  error?: unknown;
}

export function SkidmarksSunnyBanksPanel() {
  const readyCast = CAST_LIST.filter((c) => c.voiceId && c.referenceImage);
  const [selectedName, setSelectedName] = useState<string>(readyCast[0]?.name ?? "");
  const [line, setLine] = useState("");
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateSpeakBeatResult | null>(null);

  const selected = readyCast.find((c) => c.name === selectedName);

  const handleGenerate = async () => {
    if (!selected?.voiceId || !selected.referenceImage || !line.trim() || running) return;
    setRunning(true);
    setResult(null);
    setProgressText(`Getting ${selected.name}'s reference plate ready…`);
    try {
      const startImageDataUrl = await resolvePlateReferenceDataUrl(selected.referenceImage);
      setProgressText(`Rendering ${selected.name}'s line — this can take a minute or two…`);
      const res = await fetch("/api/skidmarks/sunnybank/generate-speak-beat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterName: selected.name, line, startImageDataUrl }),
      });
      const body = (await res.json()) as GenerateSpeakBeatResponseBody;
      const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";
      if (!res.ok || !videoUrl) {
        setResult({
          ok: false,
          message: typeof body.error === "string" ? body.error : `Render failed (HTTP ${res.status}).`,
        });
        return;
      }
      setResult({ ok: true, videoUrl, durationSec: typeof body.durationSec === "number" ? body.durationSec : 0 });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Could not render this line." });
    } finally {
      setRunning(false);
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
            const ready = !!(c.voiceId && c.referenceImage);
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
                {c.referenceImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a fixed small static asset, not worth next/image here
                  <img src={c.referenceImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
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
        {readyCast.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-white/40">
            No character has both a locked voice and a reference plate yet.
          </p>
        ) : (
          <>
            <select
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              disabled={running}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white disabled:opacity-60"
            >
              {readyCast.map((c) => (
                <option key={c.name} value={c.name} className="bg-zinc-900">
                  {c.name}
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
            <button
              type="button"
              onClick={handleGenerate}
              disabled={running || !selected || !line.trim()}
              className="rounded-full bg-amber-300 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-200 active:bg-amber-300/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? "Rendering…" : "Generate speak beat"}
            </button>
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
              Done — {result.durationSec.toFixed(1)}s.
            </p>
            <video src={result.videoUrl} controls playsInline className="w-full rounded-xl" />
          </div>
        )}
      </div>
    </div>
  );
}
