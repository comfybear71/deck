"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildClipGenerationRequest,
  estimateClipRenderCostUsd,
  estimateH3ClipRenderCostUsd,
  estimateLtxClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_MOTION_PROMPT_LENGTH,
} from "@/lib/clipGeneration";
import { buildClipRenderFilename } from "@/lib/clipRenderBlob";
import type { PersistedClipRender } from "@/lib/clipRenders";
import { resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import type { SkidmarksInstrumentalVideoModel, SkidmarksMember } from "@/lib/skidmarks";

interface SkidmarksClipRenderProps {
  /** The clip's shared shot-prompt text — same field
   * `SkidmarksClipStub`'s textarea edits; this control reads it, it
   * doesn't add a second prompt field. */
  shotPrompt: string;
  bandName: string;
  /** The *selected* plate's still, and nothing else — `null` when no
   * plate on this clip is filled yet, in which case this component
   * renders nothing at all (see this module's doc comment). */
  plateStillDataUrl: string | null;
  /** This plate's own stored camera-motion text — lifted to the store
   * (`SkidmarksClipSegment.plates[].motionPrompt`) rather than local
   * component state, so switching which plate is selected doesn't lose
   * or mix up each plate's own motion direction. */
  motionPrompt: string;
  onSetMotionPrompt: (value: string) => void;
  /** This plate's real, auto-computed render length — see
   * `lib/clipGeneration.ts`'s `computePlateDurationSec`/
   * `computeLtxPlateDurationSec`. */
  durationSec: number;
  /** `true` routes this render to Comfy Cloud's LTX-2.5 `AudioToVideo`
   * node instead of xAI Grok — the same `vocal` boolean
   * `SkidmarksClipStub` already derives from the clip's own label, not
   * a separate control. Drives the duration range, cost estimate, and
   * whether `mp3AudioUrl` is required before Render can even be
   * confirmed. See `lib/clipGeneration.ts`'s module doc comment. */
  vocal: boolean;
  /** Only meaningful when `vocal` is `false` — this clip's own resolved
   * H3/Grok choice (`lib/skidmarks.ts`'s `resolveInstrumentalVideoModel`,
   * already defaulted to `"h3"` by the caller — this component never
   * re-derives the default itself, it just renders whatever's given
   * and reports a change). Ignored on the Vocal path; that path always
   * means Comfy Cloud LTX, no switch. */
  instrumentalVideoModel: SkidmarksInstrumentalVideoModel;
  /** The H3/Grok switch inside the confirm step below — see this
   * component's doc comment. No-ops visually on the Vocal path (the
   * switch never renders there at all). */
  onSetInstrumentalVideoModel: (model: SkidmarksInstrumentalVideoModel) => void;
  /** The resolved vocalist for this clip's band, if any — forwarded to
   * `buildClipGenerationRequest` on the Vocal path only, so a locked
   * character's (Jack Ash today) hallmarks carry into the video prompt
   * the same way they already do for stills. */
  vocalist?: SkidmarksMember;
  /** The attached song's own durable Blob URL — required on the Vocal
   * path (Comfy Cloud slices a real window of it server-side); Render
   * stays disabled with an honest reason until it's set. Unused on the
   * Instrumental/Grok path. */
  mp3AudioUrl?: string;
  /** True when a *different* plate anywhere on this timeline is
   * currently rendering — Stuart's cost lock ("one render at a time"),
   * enforced across the whole timeline by `SkidmarksClipTimeline`, not
   * just within one clip's own panel. */
  locked: boolean;
  /** Report which plate is starting/finishing a render — lets the
   * timeline lock every *other* plate for "one render at a time"
   * without having to re-derive which plate is currently selected on
   * its own (see `components/SkidmarksClipTimeline.tsx`'s `renderKey`). */
  onRenderStart: (plateId: string) => void;
  onRenderEnd: (plateId: string) => void;
  segmentId: string;
  plateId: string;
  /** This plate's 0-based position within its own clip's strip, and
   * that strip's total slot count — used only to letter the persisted
   * filename once a clip has more than one plate. */
  plateIndex: number;
  plateCount: number;
  clipIndex: number;
  startSec: number;
  endSec: number;
  /** Whether this exact plate already has a saved render, from an
   * earlier session or an earlier tap — drives a tiny inline status
   * line only; the actual player/download now lives in
   * `SkidmarksRenderedClipsShelf`, not here (per the "declutter the
   * pink button" ask). */
  alreadyRendered: boolean;
  onPersisted: (render: PersistedClipRender) => void;
}

/** How long the inline "Confirm — real xAI video call, ~$0.4x" step
 * stays up before reverting to the plain button — long enough to read
 * and tap deliberately, short enough that walking away doesn't leave a
 * stale confirm sitting there. */
const CONFIRM_TIMEOUT_MS = 6000;

function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 animate-spin text-white/80">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
      <path d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The real, opt-in per-plate clip *video* render control — see
 * `app/api/skidmarks/generate-clip/route.ts`'s module doc comment for
 * the full server-side contract of **all three** backends this now
 * calls: Comfy Cloud's LTX-2.5 `AudioToVideo` node
 * (`COMFY_CLOUD_API_KEY`, Vocal clips, unchanged, no switch), MiniMax
 * H3 (`MINIMAX_API_KEY`, Instrumental clips, the new default), or
 * xAI's Grok Imagine video API (`XAI_API_KEY`, Instrumental clips,
 * still fully wired one tap away). Vocal vs. Instrumental is chosen
 * automatically by this component's own `vocal` prop, same as before;
 * **H3 vs. Grok, on an Instrumental clip, is the one real switch this
 * component exposes** — a small two-way toggle rendered permanently
 * *beside* the Render button (never a persistent pill/badge on the
 * plate tile itself, per AGENTS.md's "no model picker" lock).
 * **Relocated 2026-09-14** on Stuart's direct follow-up: it originally
 * lived only inside the two-tap confirm step, which he reported as
 * effectively buried — "not buried only in a hard-to-find confirm...
 * prefer visible beside the button." It's the same field
 * (`SkidmarksClipSegment.instrumentalVideoModel`), just moved so it's
 * visible the moment the clip's expanded, not only after Render's
 * already been tapped once. On a **Vocal** clip the equivalent left-
 * hand control is a plain **LTX** label, not a switch — there's only
 * ever one real Vocal backend (Comfy Cloud's LTX 2.3 IA2V graph), and
 * this app never invents a fake second option just to mirror the
 * Instrumental switch's shape. Deliberately **not** the old whole-song
 * "Generate Clips" button (removed entirely, see
 * `SkidmarksClipTimeline`'s doc comment) — this animates exactly one
 * already-selected plate at a time, explicit two-tap confirm still
 * required for the real spend.
 *
 * **Vocal plates need real audio, not just a text prompt.** When
 * `vocal` is true, Render stays disabled (with an honest inline
 * reason, never a silent no-op) until `mp3AudioUrl` is set — Comfy
 * Cloud's LTX node is driven by a real slice of the attached song's
 * vocal performance, sliced server-side from that durable Blob URL
 * (`lib/mp3Slice.ts`); there's no automatic push-in/zoom fallback the
 * way the Instrumental/Grok path has.
 *
 * **Per-plate select rework**: this used to animate *every* plate on a
 * clip's strip at once (multi-reference continuity in one xAI call).
 * It now always animates just the one **selected** plate
 * (`lib/skidmarks.ts`'s `resolveSelectedPlateId`), using only that
 * plate's own still as the image-to-video source and only that plate's
 * own stored motion text — continuity across a clip's several plates
 * (door → keyhole → Jack) now comes from rendering each separately with
 * its own motion, then editing them together in Resolve. **Renders
 * nothing at all until the selected plate has a real still** — same
 * "no clutter before there's something to animate" rule as before, just
 * scoped to one plate now instead of the whole strip.
 *
 * **Real, auto-computed duration** — `durationSec` (`segmentLengthSec /
 * plateCount`, clamped to Grok's real 5–15s ceiling on an Instrumental
 * clip via `computePlateDurationSec`, or Comfy/LTX's real 5–30s
 * ceiling on a Vocal one via `computeLtxPlateDurationSec` — see
 * `lib/clipGeneration.ts`'s module doc comment's "History of this
 * ceiling" note for why 30s, not the 20s this shipped with originally)
 * is shown,
 * alongside a real per-render dollar estimate for whichever backend
 * this render actually calls, in the confirm step; nothing here lets
 * Stuart type a duration in — it's derived, not a picker, per
 * AGENTS.md's "no duration/resolution knob in the UI" lock.
 *
 * **Cost-aware, explicit two-tap confirm**: the first tap never fires a
 * real request — it only reveals a "Confirm — real xAI video call,
 * Ns, ~$0.4x" step that has to be tapped again within
 * `CONFIRM_TIMEOUT_MS`, or it reverts. **One render at a time across the
 * whole timeline**: `locked` disables this control while any other
 * plate's render is in flight.
 *
 * **The result no longer renders inline here** — a successful render's
 * player/download link now lives in the page-bottom
 * `SkidmarksRenderedClipsShelf` (per the "declutter — move players off
 * the pink button" ask); this panel only shows a small "Rendered ✓"
 * status line, never a `<video>`.
 */
export function SkidmarksClipRender({
  shotPrompt,
  bandName,
  plateStillDataUrl,
  motionPrompt,
  onSetMotionPrompt,
  durationSec,
  vocal,
  instrumentalVideoModel,
  onSetInstrumentalVideoModel,
  vocalist,
  mp3AudioUrl,
  locked,
  onRenderStart,
  onRenderEnd,
  segmentId,
  plateId,
  plateIndex,
  plateCount,
  clipIndex,
  startSec,
  endSec,
  alreadyRendered,
  onPersisted,
}: SkidmarksClipRenderProps) {
  const [confirming, setConfirming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True only for the "xAI succeeded (Stuart was charged) but the save
   * step afterward failed" case — a real live-QA'd risk of a *silent*
   * paid loss if this ever looked like an ordinary dismissible error.
   * Drives a distinctly bordered/backgrounded alert box instead of the
   * plain text line every other error here uses, so a paid-but-unsaved
   * render is impossible to miss or mistake for a free validation
   * error. */
  const [paidButNotSaved, setPaidButNotSaved] = useState(false);
  const [justPersisted, setJustPersisted] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  if (!plateStillDataUrl) return null;

  const estimatedCost = vocal
    ? estimateLtxClipRenderCostUsd(durationSec)
    : instrumentalVideoModel === "h3"
      ? estimateH3ClipRenderCostUsd(durationSec)
      : estimateClipRenderCostUsd(durationSec, 1);
  // Carried-forward directive: never let Render fire (even the
  // confirm step) on a Vocal plate with no real durable audio to
  // slice \u2014 an honest, disabled state instead of a request the
  // server would have to reject anyway.
  const missingAudio = vocal && !mp3AudioUrl;

  const clearConfirmTimer = () => {
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  };

  const startConfirm = () => {
    if (locked || generating || missingAudio) return;
    setError(null);
    setConfirming(true);
    clearConfirmTimer();
    confirmTimer.current = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS);
  };

  const cancelConfirm = () => {
    setConfirming(false);
    clearConfirmTimer();
  };

  const handleConfirm = async () => {
    cancelConfirm();
    const trimmedPrompt = shotPrompt.trim();
    if (!trimmedPrompt) {
      setError("Add a shot prompt first — Render needs something to go on.");
      return;
    }
    setGenerating(true);
    setError(null);
    setPaidButNotSaved(false);
    setJustPersisted(false);
    onRenderStart(plateId);
    try {
      // `plateStillDataUrl` is a real Blob URL as of 2026-09-14 (`lib/
      // plateStillBlob.ts`) rather than a base64 `data:` URL — this
      // route (like xAI's/Siray's) only accepts a real `data:` URL as a
      // reference image, so resolve it first (a fast no-op for a still
      // saved before that change, still a literal `data:` URL).
      const resolvedStillDataUrl = await resolvePlateReferenceDataUrl(plateStillDataUrl);
      const request = buildClipGenerationRequest({
        shotPrompt: trimmedPrompt,
        bandName,
        plateStillDataUrl: resolvedStillDataUrl,
        motionPrompt,
        durationSec,
        vocal,
        instrumentalVideoModel,
        vocalist,
        mp3AudioUrl,
        segmentId,
        plateId,
        plateIndex,
        plateCount,
        clipIndex,
        startSec,
        endSec,
      });
      const outcome = await generateSkidmarksClip(request);
      if (outcome.ok) {
        if (outcome.persisted) {
          const filename = buildClipRenderFilename(
            clipIndex,
            startSec,
            endSec,
            plateCount > 1 ? plateIndex : undefined
          );
          onPersisted({ segmentId, plateId, url: outcome.videoUrl, filename, clipIndex, startSec, endSec });
          setJustPersisted(true);
        } else {
          // Real money was already spent on this render (xAI itself
          // succeeded) — this can never read like an ordinary, free
          // validation error. See `paidButNotSaved`'s doc comment.
          setPaidButNotSaved(true);
          setError(
            outcome.persistError
              ? `The render finished and you were charged (~$${estimatedCost.toFixed(2)}), but saving it failed: ${outcome.persistError} It won't show up in the shelf below or survive a refresh unless you try again.`
              : `The render finished and you were charged (~$${estimatedCost.toFixed(2)}), but it wasn't saved this time. It won't show up in the shelf below or survive a refresh.`
          );
        }
      } else {
        setError(outcome.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render this plate.");
    } finally {
      setGenerating(false);
      onRenderEnd(plateId);
    }
  };

  const showsAsRendered = alreadyRendered || justPersisted;

  return (
    <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-white/35">
          Render — real, opt-in
        </span>
        {showsAsRendered && !generating && (
          <span className="text-[10px] font-medium text-emerald-300/80">
            {"\u2713"} Rendered — see below
          </span>
        )}
      </div>

      {!generating && (
        <textarea
          value={motionPrompt}
          onChange={(e) => onSetMotionPrompt(e.target.value)}
          placeholder="Camera motion for this plate (optional) — e.g. slow zoom into keyhole, mild pulse on door cracks"
          maxLength={MAX_MOTION_PROMPT_LENGTH}
          rows={2}
          aria-label="Camera motion for this plate"
          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
        />
      )}

      {!generating && (
        <div className="flex items-center justify-between gap-2">
          {vocal ? (
            // Vocal only ever has one real backend (Comfy Cloud LTX,
            // lip-sync) — a plain label, never a fake second option
            // just to mirror the Instrumental switch's shape. See this
            // component's doc comment.
            <span
              aria-label="Vocal render backend: LTX lip-sync"
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-center text-[12px] font-semibold text-white/70"
            >
              LTX
            </span>
          ) : (
            // Two real, roomy tap targets (not a slim pill row) — each
            // button's own padding keeps it comfortably past Apple's
            // ~44pt HIG minimum, same "a thumb should never have to aim
            // precisely" lesson this feature's other iOS-Safari-tuned
            // controls already learned the hard way (see
            // `components/SkidmarksClipStub.tsx`'s
            // `SkidmarksPlateSelectControl` doc comment). **Now
            // permanently visible beside the Render button** (moved out
            // of the confirm-only step 2026-09-14, Stuart's explicit
            // ask — "not buried only in a hard-to-find confirm... prefer
            // visible beside the button") rather than only appearing
            // once Render's already been tapped once.
            <div
              role="group"
              aria-label="Instrumental render backend"
              className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.04] p-1 text-[12px] font-medium"
            >
              {(["h3", "grok"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onSetInstrumentalVideoModel(option)}
                  aria-pressed={instrumentalVideoModel === option}
                  className={[
                    "min-h-[36px] rounded-full px-3.5 py-2 transition-colors",
                    instrumentalVideoModel === option
                      ? "bg-rose-400 text-zinc-950"
                      : "text-white/50 hover:text-white/80",
                  ].join(" ")}
                >
                  {option === "h3" ? "H3" : "Grok"}
                </button>
              ))}
            </div>
          )}

          {!confirming ? (
            // "About half width" per Stuart's explicit ask — the switch/
            // pill to its left takes the rest of the row instead of this
            // button spanning edge-to-edge the way it used to.
            <button
              type="button"
              onClick={startConfirm}
              disabled={locked || missingAudio}
              aria-disabled={locked || missingAudio}
              className={[
                "w-1/2 rounded-full px-4 py-2.5 text-center text-[13px] font-semibold transition-colors",
                locked || missingAudio
                  ? "cursor-not-allowed bg-white/[0.04] text-white/30"
                  : "bg-rose-400 text-zinc-950 hover:bg-rose-300 active:bg-rose-400/85",
              ].join(" ")}
            >
              {showsAsRendered ? "Render plate again" : "Render plate"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 rounded-full bg-rose-400 px-3.5 py-2.5 text-center text-[12px] font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/85"
              >
                {vocal
                  ? `Confirm — real Comfy Cloud LTX call, ${durationSec}s, ~$${estimatedCost.toFixed(2)}`
                  : instrumentalVideoModel === "h3"
                    ? `Confirm — real MiniMax H3 call, ${durationSec}s, ~$${estimatedCost.toFixed(2)}`
                    : `Confirm — real xAI Grok video call, ${durationSec}s, ~$${estimatedCost.toFixed(2)}`}
              </button>
              <button
                type="button"
                onClick={cancelConfirm}
                className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {generating && (
        <div className="flex items-center justify-center gap-2 rounded-full bg-white/[0.04] px-4 py-2.5 text-[12px] font-medium text-white/70">
          <Spinner />
          {"Rendering… this can take a minute or two."}
        </div>
      )}

      {locked && !generating && (
        <p className="text-[10px] leading-snug text-white/35">
          Only one plate renders at a time — finish the other one first.
        </p>
      )}

      {missingAudio && !locked && !generating && (
        <p className="text-[10px] leading-snug text-white/35">
          {"Waiting on the attached MP3\u2019s audio to finish uploading \u2014 this Vocal plate\u2019s render needs a real slice of the song, not just a text prompt."}
        </p>
      )}

      {error && paidButNotSaved && (
        <p
          role="alert"
          className="rounded-lg border border-rose-400/40 bg-rose-400/10 p-2 text-[11px] font-medium leading-snug text-rose-200"
        >
          {error}
        </p>
      )}
      {error && !paidButNotSaved && (
        <p role="alert" className="text-[11px] leading-snug text-rose-300/90">
          {error}
        </p>
      )}
    </div>
  );
}
