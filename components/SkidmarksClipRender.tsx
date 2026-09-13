"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildClipGenerationRequest,
  CLIP_DURATION_SEC,
  estimateClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_CLIP_REFERENCE_IMAGES,
  MAX_MOTION_PROMPT_LENGTH,
} from "@/lib/clipGeneration";
import { buildClipRenderFilename, buildForceDownloadUrl, type PersistedClipRender } from "@/lib/clipRenders";

interface SkidmarksClipRenderProps {
  /** The clip's shared shot-prompt text — same field
   * `SkidmarksClipStub`'s textarea edits; this control reads it, it
   * doesn't add a second prompt field. */
  shotPrompt: string;
  bandName: string;
  /** This clip's plate stills, in strip order — already filtered to
   * slots that actually have one (an empty dashed placeholder never
   * counts). Only the first `MAX_CLIP_REFERENCE_IMAGES` are actually
   * sent; see the "using first N plates" note below. */
  plateStillDataUrls: string[];
  /** True when a *different* clip on this timeline is currently
   * rendering — Stuart's cost lock ("one render at a time or clear
   * confirm"), enforced across the whole clip list by
   * `SkidmarksClipTimeline`, not just within one clip's own panel. */
  locked: boolean;
  onRenderStart: () => void;
  onRenderEnd: () => void;
  /** This clip's own id plus its 1-based position/time range on the
   * timeline — the four fields needed to persist a render to Vercel
   * Blob under a stable, download-friendly pathname
   * (`lib/clipRenderBlob.ts`) and to build the exact filename Resolve
   * wants (`buildClipRenderFilename`). */
  segmentId: string;
  clipIndex: number;
  startSec: number;
  endSec: number;
  /** Whatever `SkidmarksClipTimeline` already knows is persisted for
   * *this* clip — fetched once for every clip on the timeline (whether
   * expanded or not), so "show it after refresh" works even before
   * this panel has ever been opened in this session. `undefined` while
   * that lookup is still in flight; `null` once it's resolved and
   * confirmed nothing's saved for this clip yet. */
  persistedRender?: PersistedClipRender | null;
  /** Reports a freshly-persisted render back up to
   * `SkidmarksClipTimeline` so its own aggregate list — and "Download
   * all rendered clips" bundle — stays in sync immediately, without a
   * second round trip to `/api/skidmarks/clip-renders`. */
  onPersisted?: (render: PersistedClipRender) => void;
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

interface RenderResult {
  videoUrl: string;
  durationSec: number;
  /** Whether `videoUrl` is a durable Vercel Blob URL that survives a
   * refresh, vs. xAI's own temporary URL (persistence was never asked
   * for, wasn't configured, or failed — see `persistError`). */
  persisted: boolean;
  persistError?: string;
}

/**
 * The first real (non-stub) slice of Skidmarks' clip *video* render —
 * see `app/api/skidmarks/generate-clip/route.ts`'s module doc comment
 * for the full server-side contract (xAI's Grok Imagine video API,
 * `XAI_API_KEY`, fixed 5s/480p output, live-verified image-to-video
 * path, and — new since #42 — persisting a successful render to
 * durable Vercel Blob storage). Deliberately **not** the "Generate
 * Clips" button (`SkidmarksClipTimeline`) — that stays the honest
 * whole-song stub; this is a much smaller, one-clip, explicit opt-in
 * control that appears on `SkidmarksClipStub`'s panel once a clip
 * actually has a real plate still to animate.
 *
 * **Renders nothing at all until there's at least one real still** —
 * an empty plate strip has nothing to animate, and per the "keep
 * plating UI tiny, no button farm" lock, showing a disabled Render
 * button before that point would just be clutter. Once a still exists:
 * one plate → xAI's image-to-video mode (that still locks the first
 * frame, so it stays *that* image being animated); two or three →
 * reference-to-video mode (continuity across the sequence — Stuart's
 * "continuous zoom across 3 plates" door → keyhole → Jack case). More
 * than `MAX_CLIP_REFERENCE_IMAGES` plates still only sends the first
 * `MAX_CLIP_REFERENCE_IMAGES`, same cap `app/api/skidmarks/generate-
 * still/route.ts` uses for reference images — a small note says so
 * rather than silently dropping the rest.
 *
 * **Optional camera-motion field** — a small multi-line (2-row) text
 * area, capped at `MAX_MOTION_PROMPT_LENGTH`, that becomes the
 * *primary* motion instruction sent to xAI's video call when filled in
 * (e.g. "slow zoom into keyhole, mild pulse on door cracks"),
 * overriding `lib/clipGeneration.ts`'s automatic push-in/zoom phrasing
 * outright rather than being appended alongside it. `shotPrompt` and
 * the plate stills stay exactly what they already were — the visual
 * description and reference images — this field is the one thing #42
 * shipped without: any way to actually direct the *camera*. Left
 * blank, the exact same automatic motion hint this shipped with in #42
 * still applies, so nothing changes for a clip that doesn't use it.
 * Stuart's own explicit ask, after finding "no motion instruction at
 * all" irrational enough to not press Render — still the smallest
 * control this could be (one optional field, not a motion-style
 * picker/menu), consistent with the "keep plating UI tiny" lock.
 *
 * **Cost-aware, explicit two-tap confirm**: the first tap never fires a
 * real request — it only reveals a "Confirm — real xAI video call,
 * ~$0.4x" step (a real per-render dollar estimate, from
 * `estimateClipRenderCostUsd`, not a vague "this costs money" line) that
 * has to be tapped again within `CONFIRM_TIMEOUT_MS`, or it reverts.
 * **One render at a time across the whole timeline**: `locked` (threaded
 * down from `SkidmarksClipTimeline`, which tracks which single segment,
 * if any, is currently rendering) disables this control while any other
 * clip's render is in flight — this is the literal enforcement of
 * Stuart's "one render at a time" cost lock, not just a same-clip
 * re-tap guard.
 *
 * **Persisted to durable Vercel Blob storage, not ephemeral React
 * state.** This is the fix for the exact thing Stuart rejected right
 * after #42 shipped: a render that only lived in this component's own
 * state disappeared on refresh. `generateSkidmarksClip` now returns
 * `persisted: true` plus a durable Blob URL once the server-side save
 * succeeds (see `app/api/skidmarks/generate-clip/route.ts`); this
 * panel also falls back to the `persistedRender` prop
 * (`SkidmarksClipTimeline` fetches what's already saved for every clip,
 * whether expanded or not) whenever this session hasn't rendered
 * anything of its own yet, so a real render still shows up after a
 * reload without needing to be re-triggered. If Vercel Blob genuinely
 * isn't configured, or the save step itself fails, the render Stuart
 * already paid for is still shown and downloadable — just honestly
 * flagged as **not** saved (see the caption below `<video>`), never
 * silently implying durability that didn't happen.
 *
 * **Download uses this feature's own numeric filename convention**
 * (`buildClipRenderFilename` — e.g. `01_0000-0040_render.mp4`) so a
 * clip downloaded to a phone and moved to a PC sorts and matches its
 * timeline position for a DaVinci Resolve import, per the task's own
 * "download-friendly numeric filenames for Resolve" ask. For a
 * persisted render, `?download=1` (Vercel Blob's own documented
 * force-download query param) guarantees the browser actually uses
 * that exact filename via `Content-Disposition`, rather than relying
 * on an HTML anchor's `download` attribute against a cross-origin URL.
 */
export function SkidmarksClipRender({
  shotPrompt,
  bandName,
  plateStillDataUrls,
  locked,
  onRenderStart,
  onRenderEnd,
  segmentId,
  clipIndex,
  startSec,
  endSec,
  persistedRender,
  onPersisted,
}: SkidmarksClipRenderProps) {
  const [confirming, setConfirming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  // Optional, short camera-motion direction — leaves
  // `lib/clipGeneration.ts`'s automatic push-in/zoom default in place
  // when blank (this shipped in #42 with no way to ask for anything
  // else — a pan, a held static shot — see that module's doc comment).
  const [motionPrompt, setMotionPrompt] = useState("");
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  // Falls back to whatever's already durably saved for this exact clip
  // — the "show it after refresh" requirement, satisfied even before
  // Stuart has re-opened this panel in this session — until a fresh
  // render in *this* session (`result`) exists to take priority.
  // Derived at render time rather than synced into state via an effect:
  // there's nothing to subscribe to beyond the prop React already
  // re-renders this component for.
  const displayResult: RenderResult | null =
    result ?? (persistedRender ? { videoUrl: persistedRender.url, durationSec: CLIP_DURATION_SEC, persisted: true } : null);

  if (plateStillDataUrls.length === 0) return null;

  const usedStillCount = Math.min(plateStillDataUrls.length, MAX_CLIP_REFERENCE_IMAGES);
  const droppedCount = plateStillDataUrls.length - usedStillCount;
  const estimatedCost = estimateClipRenderCostUsd(usedStillCount);
  const downloadFilename = buildClipRenderFilename(clipIndex, startSec, endSec);

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
    onRenderStart();
    try {
      const request = buildClipGenerationRequest({
        shotPrompt: trimmedPrompt,
        bandName,
        plateStillDataUrls,
        motionPrompt,
        segmentId,
        clipIndex,
        startSec,
        endSec,
      });
      const outcome = await generateSkidmarksClip(request);
      if (outcome.ok) {
        setResult({
          videoUrl: outcome.videoUrl,
          durationSec: outcome.durationSec,
          persisted: outcome.persisted,
          persistError: outcome.persistError,
        });
        if (outcome.persisted) {
          onPersisted?.({ segmentId, url: outcome.videoUrl, clipIndex, startSec, endSec });
        }
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
          Render — real, opt-in
        </span>
        {droppedCount > 0 && (
          <span className="text-[10px] text-white/30">using first {usedStillCount} plates</span>
        )}
      </div>

      {!generating && (
        <textarea
          value={motionPrompt}
          onChange={(e) => setMotionPrompt(e.target.value)}
          placeholder="Camera motion for this render (optional) — e.g. slow zoom into keyhole, mild pulse on door cracks"
          maxLength={MAX_MOTION_PROMPT_LENGTH}
          rows={2}
          aria-label="Camera motion for this render"
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
          {displayResult ? `${actionLabel} again` : actionLabel}
        </button>
      )}

      {!generating && confirming && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded-full bg-rose-400 px-3.5 py-2.5 text-center text-[12px] font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/85"
          >
            {`Confirm — real xAI video call, ~$${estimatedCost.toFixed(2)}`}
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
          Only one clip renders at a time — finish the other one first.
        </p>
      )}

      {displayResult && (
        <div className="flex flex-col gap-1.5">
          <video src={displayResult.videoUrl} controls playsInline className="w-full rounded-xl bg-black" />
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/45">
            <a
              href={displayResult.persisted ? buildForceDownloadUrl(displayResult.videoUrl) : displayResult.videoUrl}
              download={downloadFilename}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-rose-300/90 underline-offset-2 hover:underline"
            >
              Download {downloadFilename}
            </a>
            <span>
              {displayResult.durationSec}s ·{" "}
              {displayResult.persisted ? "saved — survives a refresh" : "not saved this time"}
            </span>
          </div>
          {!displayResult.persisted && (
            <p className="text-[10px] leading-snug text-amber-200/70">
              {displayResult.persistError
                ? `Not saved — ${displayResult.persistError}`
                : "Not saved — this render is only in this tab and won't survive a refresh."}
            </p>
          )}
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
