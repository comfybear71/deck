"use client";

import { useMemo, useRef, useState } from "react";
import { parseScriptSequence } from "@/lib/scriptSequence";
import {
  buildScriptSequenceSegments,
  flushSkidmarksSessionNow,
  readImageFileAsDataUrl,
  type SkidmarksBand,
  type SkidmarksClipSegment,
  type SkidmarksPlateStill,
} from "@/lib/skidmarks";
import { buildPlateGenerationRequest, generatePlateStill, resolvePlateReferenceDataUrl, resolveVocalistForPrompt } from "@/lib/plateGeneration";
import { generateSkidmarksClip } from "@/lib/clipGeneration";
import { uploadSkidmarksPlateStill } from "@/lib/plateStillBlob";
import { runScriptSequence, type ScriptSequenceRunEvent, type ScriptSequenceRunnerDeps } from "@/lib/scriptSequenceRunner";
import { persistedRenderKey, type PersistedClipRender } from "@/lib/clipRenders";

/** Native file picker's accept list — jpg/png/webp only, matches every
 * other photo picker in this feature. */
const STARTING_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface SkidmarksScriptSequencePanelProps {
  band: SkidmarksBand;
  hasMp3: boolean;
  /** The song's own real segments *before* this run replaces them —
   * `buildScriptSequenceSegments` reads these to route each script part
   * Vocal/LTX when it lands on real singing, Instrumental/Grok
   * otherwise (Stuart's own correction, 2026-09-14: "vocals always go
   * to LTX... instrumentals... go to Grok"). `[]` for a band with no
   * MP3/no real segments yet — every part then defaults Instrumental. */
  realSegments: SkidmarksClipSegment[];
  /** The song's own durable audio URL — required for any part that
   * routes Vocal (LTX needs a real slice of it); `undefined` if the
   * attached MP3's audio hasn't finished uploading yet. */
  mp3AudioUrl?: string;
  /** Every persisted render across the whole song, keyed by
   * `persistedRenderKey(segmentId, plateId)` — the same map
   * `SkidmarksClipTimeline` already reads (`useSkidmarksClipRenders`).
   * This is the durable, reload-proof way of finding "where a partial
   * script-sequence run stopped" (see `incompleteRun` below), rather
   * than relying on this run's own in-memory `result` state, which is
   * gone the moment the page reloads. */
  renders: Map<string, PersistedClipRender>;
  onSetScriptSequence: (segments: SkidmarksClipSegment[]) => void;
  onSetClipPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill | null) => void;
  onRecordRender: (render: PersistedClipRender) => void;
}

function progressLabel(event: ScriptSequenceRunEvent): string {
  switch (event.type) {
    case "generating-first-still":
      return "Generating the starting image for clip 1…";
    case "rendering":
      return `Rendering clip ${event.clipIndex + 1} of ${event.clipCount}…`;
    case "chaining":
      return `Carrying clip ${event.clipIndex + 1}'s last frame into clip ${event.clipIndex + 2}…`;
    case "clip-done":
      return `Clip ${event.clipIndex + 1} of ${event.clipCount} done.`;
  }
}

/**
 * Stuart's "paste a script, get a real clip timeline, then render it
 * all automatically" ask (2026-09-14, the "Liquid Horizon" 16-part
 * black-and-white sequence). Ties together the pure pieces
 * (`lib/scriptSequence.ts`'s parser, `lib/skidmarks.ts`'s
 * `buildScriptSequenceSegments`/`setSkidmarksScriptSequence`,
 * `lib/scriptSequenceRunner.ts`'s orchestrator) with the real backends
 * this feature already uses everywhere else — no new AI provider, no
 * new persistence mechanism, just the same still/clip generation and
 * Blob storage every other Render button in this app calls.
 *
 * **Fully automatic, by Stuart's own explicit choice** (he was told the
 * risk — a mid-run failure can't be caught before the next clip starts
 * — and chose this over a "fill in prompts, tap Render yourself per
 * clip" alternative). The one safety net kept regardless: the runner
 * stops dead at the first real failure rather than continuing to spend
 * on a broken chain — see `runScriptSequenceRunner.ts`'s doc comment.
 */
export function SkidmarksScriptSequencePanel({
  band,
  hasMp3,
  realSegments,
  mp3AudioUrl,
  renders,
  onSetScriptSequence,
  onSetClipPlateStill,
  onRecordRender,
}: SkidmarksScriptSequencePanelProps) {
  const [script, setScript] = useState("");
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  /** Real reported gap (2026-09-14): this automation always built brand-
   * new blank clips, so there was no way to hand it a real starting
   * image for clip 1 — it would just auto-generate one every time,
   * silently ignoring anything Stuart already had ready. Picked here,
   * uploaded and set onto clip 1's plate in `handleRun` before the
   * runner ever looks at it — `runScriptSequence` already skips
   * generating a first still whenever one is already there (same path
   * a manual clip that's already got a still uses), so this needs no
   * runner change at all, just handing it a real still up front. */
  const [startingImageDataUrl, setStartingImageDataUrl] = useState<string | null>(null);
  const [startingImagePicking, setStartingImagePicking] = useState(false);
  const startingImageInputRef = useRef<HTMLInputElement | null>(null);

  const parts = useMemo(() => parseScriptSequence(script), [script]);

  /**
   * Where an earlier, partial run of *this same stored timeline* stopped
   * — derived straight from durable state (`realSegments` +
   * `renders`, both sourced from the saved session), never from this
   * run's own in-memory `result`, so it survives a page reload the way
   * a real fix-and-refresh cycle actually needs to (a real live
   * example, 2026-09-14: xAI content moderation rejected clip 13 of 16;
   * fixing that meant a code change and a refresh, which would have
   * thrown away any in-memory-only "resume point"). The first segment,
   * in order, with no persisted render yet is exactly the clip to
   * retry — whether it never got its starting still, has one but never
   * rendered, or rendered but failed to persist, `runScriptSequence`'s
   * own per-clip checks report the real reason honestly either way.
   * `undefined` when there's nothing to resume: no script-sequence
   * timeline yet, clip 1 itself was never rendered (this isn't really
   * "partial," it just hasn't started), or every clip already has a
   * render (fully done).
   */
  const incompleteRun = useMemo(() => {
    if (realSegments.length === 0) return undefined;
    const resumeIndex = realSegments.findIndex((segment) => {
      const plate = segment.plates[0];
      return !plate || !renders.has(persistedRenderKey(segment.id, plate.id));
    });
    if (resumeIndex <= 0) return undefined;
    return { resumeIndex, total: realSegments.length };
  }, [realSegments, renders]);

  const handlePickStartingImage = async (file: File) => {
    setStartingImagePicking(true);
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setStartingImageDataUrl(dataUrl);
    } catch {
      setResult({ ok: false, message: "Couldn't read that image — try a different file." });
    } finally {
      setStartingImagePicking(false);
    }
  };

  /** Shared by a fresh run and a resume — same real backends, same
   * progress reporting, the only difference is which segments/start
   * index `runScriptSequence` itself is called with. */
  const buildRunnerDeps = (): ScriptSequenceRunnerDeps => ({
    resolveIdentityDataUrl: resolvePlateReferenceDataUrl,
    generateFirstStill: async (shotPrompt, bandName, vocal, firstClipVocalist) => {
      const request = buildPlateGenerationRequest({
        shotPrompt,
        vocal,
        model: vocal ? "ltx-lipsync" : "grok",
        bandName,
        vocalist: firstClipVocalist,
      });
      const stillOutcome = await generatePlateStill(request);
      return stillOutcome.ok ? { ok: true, dataUrl: stillOutcome.dataUrl } : { ok: false, message: stillOutcome.message };
    },
    uploadStill: uploadSkidmarksPlateStill,
    renderClip: async (request) => {
      const clipOutcome = await generateSkidmarksClip(request);
      if (!clipOutcome.ok) return { ok: false, message: clipOutcome.message };
      return {
        ok: true,
        videoUrl: clipOutcome.videoUrl,
        persisted: clipOutcome.persisted,
        persistError: clipOutcome.persistError,
        lastFrameUrl: clipOutcome.lastFrameUrl,
      };
    },
    recordRender: onRecordRender,
    setPlateStill: onSetClipPlateStill,
    onProgress: (event) => setProgressText(progressLabel(event)),
  });

  const reportRunOutcome = (outcome: Awaited<ReturnType<typeof runScriptSequence>>) => {
    setResult(
      outcome.ok
        ? { ok: true, message: `All ${outcome.renderedCount} clips rendered and chained.` }
        : {
            ok: false,
            message: `Stopped at clip ${outcome.failedAtClipIndex + 1} (${outcome.renderedCount} clip${outcome.renderedCount === 1 ? "" : "s"} rendered so far): ${outcome.message}`,
          }
    );
  };

  const handleResume = async () => {
    if (running || !incompleteRun) return;
    setRunning(true);
    setResult(null);
    setProgressText(`Resuming at clip ${incompleteRun.resumeIndex + 1} of ${incompleteRun.total}…`);

    const vocalist = resolveVocalistForPrompt(band.members);
    const outcome = await runScriptSequence(
      realSegments,
      band.name,
      buildRunnerDeps(),
      mp3AudioUrl,
      vocalist,
      incompleteRun.resumeIndex
    );

    flushSkidmarksSessionNow();
    setRunning(false);
    setProgressText(null);
    reportRunOutcome(outcome);
  };

  const handleRun = async () => {
    if (running) return;
    if (parts.length === 0) {
      setResult({ ok: false, message: "Couldn't find any “Part N (start - end) — Title[Duration: ...].” entries in that text." });
      return;
    }
    if (!hasMp3) {
      setResult({ ok: false, message: "Attach an MP3 to this band first — the clip timeline needs one to hold clips, even a placeholder track." });
      return;
    }

    setRunning(true);
    setResult(null);
    setProgressText("Building the clip timeline…");

    const vocalist = resolveVocalistForPrompt(band.members);
    const segments = buildScriptSequenceSegments(parts, realSegments);

    // Set up the new timeline in the store *first* — setting a still on
    // clip 1's plate below only works once that plate actually exists
    // there (`setSkidmarksClipPlateStill` looks it up by id in the
    // current store state, which doesn't have these brand-new segments
    // until this call lands).
    onSetScriptSequence(segments);
    flushSkidmarksSessionNow();

    if (startingImageDataUrl) {
      setProgressText("Saving your starting image for clip 1…");
      const uploadOutcome = await uploadSkidmarksPlateStill(startingImageDataUrl);
      const startingStill: SkidmarksPlateStill = {
        dataUrl: uploadOutcome.ok ? uploadOutcome.url : startingImageDataUrl,
        source: "upload",
        createdAt: Date.now(),
      };
      segments[0].plates[0].still = startingStill; // so the runner below sees it immediately
      onSetClipPlateStill(segments[0].id, segments[0].plates[0].id, startingStill);
      flushSkidmarksSessionNow();
    }

    const outcome = await runScriptSequence(segments, band.name, buildRunnerDeps(), mp3AudioUrl, vocalist);

    flushSkidmarksSessionNow();
    setRunning(false);
    setProgressText(null);
    setStartingImageDataUrl(null); // one-time input for this run — never silently reused on a later, different script
    reportRunOutcome(outcome);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-rose-400/25 bg-rose-400/[0.03] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Script sequence</p>

      {incompleteRun && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-3 py-2">
          <span className="text-[12px] leading-relaxed text-amber-100">
            Clip {incompleteRun.resumeIndex + 1} of {incompleteRun.total} didn&apos;t finish — {incompleteRun.resumeIndex} rendered so far.
          </span>
          <button
            type="button"
            onClick={handleResume}
            disabled={running}
            className="shrink-0 rounded-full bg-amber-300 px-3 py-1.5 text-[13px] font-semibold text-zinc-950 transition-colors hover:bg-amber-200 active:bg-amber-300/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Rendering…" : `Resume — ${incompleteRun.total - incompleteRun.resumeIndex} left`}
          </button>
        </div>
      )}

      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        disabled={running}
        placeholder={"Paste your “Part 1 (0:00 - 0:15) — Title[Duration: ...]. ...” script here."}
        rows={4}
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none disabled:opacity-60"
      />

      <div className="flex items-center gap-2.5">
        {startingImageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data-URL preview, next/image can't optimize it
          <img
            src={startingImageDataUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-white/15"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/15 text-[9px] text-white/25">
            None
          </span>
        )}
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-[11px] text-white/40">
            {startingImageDataUrl
              ? "Clip 1 will start from your picture, not a fresh generated one."
              : "Optional: clip 1's starting image — skips generating one."}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => startingImageInputRef.current?.click()}
              disabled={running || startingImagePicking}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {startingImagePicking ? "Reading…" : startingImageDataUrl ? "Change" : "Upload"}
            </button>
            {startingImageDataUrl && (
              <button
                type="button"
                onClick={() => setStartingImageDataUrl(null)}
                disabled={running}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <input
          ref={startingImageInputRef}
          type="file"
          accept={STARTING_IMAGE_ACCEPT}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handlePickStartingImage(file);
          }}
          className="hidden"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/40">
          {incompleteRun
            ? "Use Resume above — starting fresh here would re-render (and re-charge for) the clips already done."
            : parts.length > 0
              ? `Found ${parts.length} part${parts.length === 1 ? "" : "s"}.`
              : "No parts found yet."}
        </span>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || parts.length === 0 || !!incompleteRun}
          className="rounded-full bg-rose-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? "Rendering…" : `Generate & render all${parts.length > 0 ? ` ${parts.length}` : ""}`}
        </button>
      </div>

      {progressText && (
        <p role="status" className="text-[11px] leading-snug text-rose-200/80">
          {progressText}
        </p>
      )}
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "text-[11px] leading-snug text-emerald-300/85" : "text-[11px] leading-snug text-rose-300/90"}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
