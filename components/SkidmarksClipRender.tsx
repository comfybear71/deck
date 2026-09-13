"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildClipGenerationRequest,
  estimateClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_MOTION_PROMPT_LENGTH,
} from "@/lib/clipGeneration";
import { buildClipRenderFilename } from "@/lib/clipRenderBlob";
import type { PersistedClipRender } from "@/lib/clipRenders";

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
   * `lib/clipGeneration.ts`'s `computePlateDurationSec`. */
  durationSec: number;
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
 * the full server-side contract (xAI's Grok Imagine video API,
 * `XAI_API_KEY`, cost-capped 480p, live-verified image-to-video path,
 * durable Vercel Blob persistence). Deliberately **not** the "Generate
 * Clips" button (`SkidmarksClipTimeline`) — that stays the honest
 * whole-song stub; this animates exactly one already-selected plate at
 * a time.
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
 * **Real, auto-computed duration** — `durationSec` (from
 * `lib/clipGeneration.ts`'s `computePlateDurationSec`, `segmentLengthSec
 * / plateCount` clamped to 5–15s) is shown, alongside a real per-render
 * dollar estimate, in the confirm step; nothing here lets Stuart type a
 * duration in — it's derived, not a picker, per AGENTS.md's "no
 * duration/resolution knob in the UI" lock.
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

  const estimatedCost = estimateClipRenderCostUsd(durationSec, 1);

  const clearConfirmTimer = () => {
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  };

  const startConfirm = () => {
    if (locked || generating) return;
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
      const request = buildClipGenerationRequest({
        shotPrompt: trimmedPrompt,
        bandName,
        plateStillDataUrl,
        motionPrompt,
        durationSec,
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

      {!generating && !confirming && (
        <button
          type="button"
          onClick={startConfirm}
          disabled={locked}
          aria-disabled={locked}
          className={[
            "rounded-full px-4 py-2.5 text-center text-[13px] font-semibold transition-colors",
            locked
              ? "cursor-not-allowed bg-white/[0.04] text-white/30"
              : "bg-rose-400 text-zinc-950 hover:bg-rose-300 active:bg-rose-400/85",
          ].join(" ")}
        >
          {showsAsRendered ? "Render plate again" : "Render plate"}
        </button>
      )}

      {!generating && confirming && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded-full bg-rose-400 px-3.5 py-2.5 text-center text-[12px] font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/85"
          >
            {`Confirm — real xAI video call, ${durationSec}s, ~$${estimatedCost.toFixed(2)}`}
          </button>
          <button
            type="button"
            onClick={cancelConfirm}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            Cancel
          </button>
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
