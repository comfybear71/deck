"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildClipGenerationRequest,
  estimateClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_CLIP_REFERENCE_IMAGES,
} from "@/lib/clipGeneration";

interface SkidmarksClipRenderProps {
  /** The clip's shared shot-prompt text \u2014 same field
   * `SkidmarksClipStub`'s textarea edits; this control reads it, it
   * doesn't add a second prompt field. */
  shotPrompt: string;
  bandName: string;
  /** This clip's plate stills, in strip order \u2014 already filtered to
   * slots that actually have one (an empty dashed placeholder never
   * counts). Only the first `MAX_CLIP_REFERENCE_IMAGES` are actually
   * sent; see the "using first N plates" note below. */
  plateStillDataUrls: string[];
  /** True when a *different* clip on this timeline is currently
   * rendering \u2014 Stuart's cost lock ("one render at a time or clear
   * confirm"), enforced across the whole clip list by
   * `SkidmarksClipTimeline`, not just within one clip's own panel. */
  locked: boolean;
  onRenderStart: () => void;
  onRenderEnd: () => void;
}

/** How long the inline "Confirm \u2014 real xAI video call, ~$0.4x" step
 * stays up before reverting to the plain button \u2014 long enough to read
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
 * The first real (non-stub) slice of Skidmarks' clip *video* render \u2014
 * see `app/api/skidmarks/generate-clip/route.ts`'s module doc comment
 * for the full server-side contract (xAI's Grok Imagine video API,
 * `XAI_API_KEY`, fixed 5s/480p output, live-verified image-to-video
 * path). Deliberately **not** the "Generate Clips" button
 * (`SkidmarksClipTimeline`) \u2014 that stays the honest whole-song stub;
 * this is a much smaller, one-clip, explicit opt-in control that
 * appears on `SkidmarksClipStub`'s panel once a clip actually has a
 * real plate still to animate.
 *
 * **Renders nothing at all until there's at least one real still** \u2014
 * an empty plate strip has nothing to animate, and per the "keep
 * plating UI tiny, no button farm" lock, showing a disabled Render
 * button before that point would just be clutter. Once a still exists:
 * one plate \u2192 xAI's image-to-video mode (that still locks the first
 * frame, so it stays *that* image being animated); two or three \u2192
 * reference-to-video mode (continuity across the sequence \u2014 Stuart's
 * "continuous zoom across 3 plates" door \u2192 keyhole \u2192 Jack case).
 * More than `MAX_CLIP_REFERENCE_IMAGES` plates still only sends the
 * first `MAX_CLIP_REFERENCE_IMAGES`, same cap
 * `app/api/skidmarks/generate-still/route.ts` uses for reference images
 * \u2014 a small note says so rather than silently dropping the rest.
 *
 * **Cost-aware, explicit two-tap confirm**: the first tap never fires a
 * real request \u2014 it only reveals a "Confirm \u2014 real xAI video call,
 * ~$0.4x" step (a real per-render dollar estimate, from
 * `estimateClipRenderCostUsd`, not a vague "this costs money" line) that
 * has to be tapped again within `CONFIRM_TIMEOUT_MS`, or it reverts.
 * **One render at a time across the whole timeline**: `locked` (threaded
 * down from `SkidmarksClipTimeline`, which tracks which single segment,
 * if any, is currently rendering) disables this control while any other
 * clip's render is in flight \u2014 this is the literal enforcement of
 * Stuart's "one render at a time" cost lock, not just a same-clip
 * re-tap guard.
 *
 * **Result is ephemeral, on purpose** \u2014 a successful render shows a
 * playable `<video>` plus a real download link (xAI's own temporary
 * URL, not re-hosted), but nothing here writes it back into
 * `lib/skidmarks.ts`'s `localStorage`-backed store; see the server
 * route's module doc comment for why (video size vs. that store's small
 * shared quota). A page refresh loses the preview \u2014 the label under
 * the player says so plainly rather than implying it persists.
 */
export function SkidmarksClipRender({
  shotPrompt,
  bandName,
  plateStillDataUrls,
  locked,
  onRenderStart,
  onRenderEnd,
}: SkidmarksClipRenderProps) {
  const [confirming, setConfirming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ videoUrl: string; durationSec: number } | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  if (plateStillDataUrls.length === 0) return null;

  const usedStillCount = Math.min(plateStillDataUrls.length, MAX_CLIP_REFERENCE_IMAGES);
  const droppedCount = plateStillDataUrls.length - usedStillCount;
  const estimatedCost = estimateClipRenderCostUsd(usedStillCount);

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
      setError("Add a shot prompt first \u2014 Render needs something to go on.");
      return;
    }
    setGenerating(true);
    setError(null);
    onRenderStart();
    try {
      const request = buildClipGenerationRequest({
        shotPrompt: trimmedPrompt,
        bandName,
        plateStillDataUrls,
      });
      const outcome = await generateSkidmarksClip(request);
      if (outcome.ok) {
        setResult({ videoUrl: outcome.videoUrl, durationSec: outcome.durationSec });
      } else {
        setError(outcome.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render this clip.");
    } finally {
      setGenerating(false);
      onRenderEnd();
    }
  };

  const actionLabel = usedStillCount > 1 ? "Render plates" : "Animate plate";

  return (
    <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-white/35">
          Render \u2014 real, opt-in
        </span>
        {droppedCount > 0 && (
          <span className="text-[10px] text-white/30">using first {usedStillCount} plates</span>
        )}
      </div>

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
          {actionLabel}
        </button>
      )}

      {!generating && confirming && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded-full bg-rose-400 px-3.5 py-2.5 text-center text-[12px] font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/85"
          >
            {`Confirm \u2014 real xAI video call, ~$${estimatedCost.toFixed(2)}`}
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
          {"Rendering\u2026 this can take a minute or two."}
        </div>
      )}

      {locked && !generating && (
        <p className="text-[10px] leading-snug text-white/35">
          Only one clip renders at a time \u2014 finish the other one first.
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-1.5">
          <video src={result.videoUrl} controls playsInline className="w-full rounded-xl bg-black" />
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/45">
            <a
              href={result.videoUrl}
              download
              target="_blank"
              rel="noreferrer"
              className="font-medium text-rose-300/90 underline-offset-2 hover:underline"
            >
              Download
            </a>
            <span>{result.durationSec}s \u00b7 temporary URL, not saved to this session</span>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[11px] leading-snug text-rose-300/90">
          {error}
        </p>
      )}
    </div>
  );
}
