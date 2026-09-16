"use client";

import { useMemo, useRef, useState } from "react";
import { parseScriptSequence } from "@/lib/scriptSequence";
import {
  buildScriptSequenceSegments,
  flushSkidmarksSessionNow,
  type SkidmarksBand,
  type SkidmarksClipSegment,
  type SkidmarksPlateStill,
  type SkidmarksScriptSequenceDraft,
} from "@/lib/skidmarks";
import {
  buildPlateGenerationRequest,
  generatePlateStill,
  getSkidmarksCharacterLock,
  resolvePlateReferenceDataUrl,
  resolveVocalistForPrompt,
} from "@/lib/plateGeneration";
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
  /** This panel's own persisted draft — pasted script text + clip 1's
   * already-uploaded starting image URL. Real reported gap (2026-09-14):
   * this used to be plain `useState`, so backgrounding the phone or
   * closing the tab before tapping Generate lost both outright. `null`
   * means nothing drafted yet (or it was cleared after a run started —
   * see `handleRun`). */
  scriptSequenceDraft: SkidmarksScriptSequenceDraft | null;
  onSetScriptSequenceDraft: (draft: SkidmarksScriptSequenceDraft | null) => void;
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
 *
 * **"Build timeline" (2026-09-15)** is the one deliberate pause in that
 * otherwise-automatic flow — real reported ask after a full-script
 * batch render came back with the locked character drifted out of
 * existence by the last few clips: build the whole timeline and
 * pre-fill every plate from the locked character's own reference photo
 * *before* any rendering or any money is spent, so Stuart can actually
 * scroll through and check every starting image first. Free (no AI
 * call, just copying a URL onto every plate) — `handleRun` below then
 * reuses that already-built, already-checked timeline instead of
 * silently rebuilding a fresh one and throwing the review away.
 */
export function SkidmarksScriptSequencePanel({
  band,
  hasMp3,
  realSegments,
  mp3AudioUrl,
  renders,
  scriptSequenceDraft,
  onSetScriptSequenceDraft,
  onSetScriptSequence,
  onSetClipPlateStill,
  onRecordRender,
}: SkidmarksScriptSequencePanelProps) {
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  /** Real ask (2026-09-16): a way to interrupt a long "Generate & render
   * all" batch the moment a render looks wrong, so it stops spending
   * real credits on the rest instead of burning through every remaining
   * clip first. A plain ref, not state — `runScriptSequence` reads it
   * synchronously via `shouldStop` between clips, and a ref (unlike
   * state) is always current inside that closure without needing to be
   * re-created on every render. Reset at the start of each run. */
  const stopRequestedRef = useRef(false);
  /** Whether a starting-image pick is mid-upload right now — purely a
   * local spinner label, never needs to survive a reload the way the
   * uploaded URL itself does (`scriptSequenceDraft.startingImageUrl`),
   * so this stays plain `useState` unlike the draft fields above it. */
  const [startingImagePicking, setStartingImagePicking] = useState(false);
  const [startingImageError, setStartingImageError] = useState<string | null>(null);
  const startingImageInputRef = useRef<HTMLInputElement | null>(null);

  const script = scriptSequenceDraft?.script ?? "";
  const startingImageUrl = scriptSequenceDraft?.startingImageUrl;
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

  /** Uploads to durable Blob storage immediately on pick, not deferred
   * until Generate — the whole point of persisting this draft at all is
   * surviving a backgrounded phone/closed tab, which a `data:` URL only
   * ever sitting in local component state can't do. `onSetScriptSequenceDraft`
   * + `flushSkidmarksSessionNow` land it in Neon right away, same as
   * every other real upload in this feature. */
  const handlePickStartingImage = async (file: File) => {
    setStartingImagePicking(true);
    setStartingImageError(null);
    try {
      const uploadOutcome = await uploadSkidmarksPlateStill(file);
      if (!uploadOutcome.ok) {
        setStartingImageError("Couldn't save that image — try again.");
        return;
      }
      onSetScriptSequenceDraft({ script, startingImageUrl: uploadOutcome.url });
      flushSkidmarksSessionNow();
    } catch {
      setStartingImageError("Couldn't read that image — try a different file.");
    } finally {
      setStartingImagePicking(false);
    }
  };

  const handleRemoveStartingImage = () => {
    onSetScriptSequenceDraft({ script, startingImageUrl: undefined });
    flushSkidmarksSessionNow();
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
        : !outcome.ok && outcome.stopped
          ? { ok: true, message: `Stopped — ${outcome.renderedCount} clip${outcome.renderedCount === 1 ? "" : "s"} rendered before you stopped it. Nothing else was spent.` }
          : {
              ok: false,
              message: `Stopped at clip ${outcome.failedAtClipIndex + 1} (${outcome.renderedCount} clip${outcome.renderedCount === 1 ? "" : "s"} rendered so far): ${outcome.message}`,
          }
    );
  };

  const handleResume = async () => {
    if (running || !incompleteRun) return;
    stopRequestedRef.current = false;
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
      incompleteRun.resumeIndex,
      () => stopRequestedRef.current
    );

    flushSkidmarksSessionNow();
    setRunning(false);
    setProgressText(null);
    reportRunOutcome(outcome);
  };

  /**
   * Real reported ask (2026-09-15, after a full-script batch render came
   * back with the locked character having "drifted out of existence" by
   * the last few clips): build the whole clip timeline and pre-fill
   * *every* plate with the locked character's own fixed reference photo
   * — before any rendering, any AI call, or any money spent — so Stuart
   * can scroll through and actually see every starting image is correct
   * first. Free and instant (no network call, just the same reference
   * URL copied onto every plate), unlike a render. A band with no locked
   * vocalist still gets its timeline built here, just without the
   * pre-fill — there's nothing safe to auto-fill a plate with otherwise.
   */
  const handleBuildTimeline = () => {
    if (running || parts.length === 0) return;

    const segments = buildScriptSequenceSegments(parts, realSegments);
    onSetScriptSequence(segments);

    const vocalist = resolveVocalistForPrompt(band.members);
    const lock = vocalist ? getSkidmarksCharacterLock(vocalist.id) : undefined;
    if (lock && vocalist?.avatarImage) {
      for (const segment of segments) {
        const plate = segment.plates[0];
        if (!plate) continue;
        onSetClipPlateStill(segment.id, plate.id, {
          dataUrl: vocalist.avatarImage,
          source: "generated",
          createdAt: Date.now(),
          featuresLockedCharacter: true,
        });
      }
    }

    flushSkidmarksSessionNow();
    setResult({
      ok: true,
      message: lock
        ? `Timeline built — all ${segments.length} plates start from the locked reference photo. Scroll up to check them, then tap Generate & render all when you're happy.`
        : `Timeline built — ${segments.length} clips ready. No locked character on this band, so plates are still blank until you render or fill them in yourself.`,
    });
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

    stopRequestedRef.current = false;
    setRunning(true);
    setResult(null);
    setProgressText("Building the clip timeline…");

    const vocalist = resolveVocalistForPrompt(band.members);
    // Reuse the timeline "Build timeline" already committed for this
    // exact script, instead of rebuilding from scratch and silently
    // discarding whatever Stuart already reviewed there (a fresh build
    // mints new segment/plate ids with blank plates every time — see
    // `buildScriptSequenceSegments`'s own doc comment). Matching part
    // counts is an imperfect but low-stakes signal: worst case a changed
    // script with the same number of parts reuses stale plates, which
    // Stuart would see immediately in the review step, not something
    // that silently costs money.
    const alreadyBuilt = realSegments.length === parts.length;
    let segments = alreadyBuilt ? realSegments : buildScriptSequenceSegments(parts, realSegments);

    // Set up the new timeline in the store *first* — setting a still on
    // clip 1's plate below only works once that plate actually exists
    // there (`setSkidmarksClipPlateStill` looks it up by id in the
    // current store state, which doesn't have these brand-new segments
    // until this call lands).
    if (!alreadyBuilt) {
      onSetScriptSequence(segments);
      flushSkidmarksSessionNow();
    }

    // Already a durable Blob URL, uploaded the moment it was picked
    // (`handlePickStartingImage`) — nothing left to upload here. An
    // explicit pick here always wins over whatever "Build timeline"
    // pre-filled clip 1 with — Stuart's own deliberate choice beats any
    // automatic default. Rebuilds clip 1's own segment/plate objects
    // rather than mutating them in place — `segments` can alias the
    // `realSegments` prop now (the `alreadyBuilt` reuse above), and
    // props/hook state must never be mutated directly.
    if (startingImageUrl) {
      const startingStill: SkidmarksPlateStill = {
        dataUrl: startingImageUrl,
        source: "upload",
        createdAt: Date.now(),
      };
      segments = segments.map((segment, i) =>
        i === 0 ? { ...segment, plates: [{ ...segment.plates[0], still: startingStill }, ...segment.plates.slice(1)] } : segment
      );
      onSetClipPlateStill(segments[0].id, segments[0].plates[0].id, startingStill);
      flushSkidmarksSessionNow();
    }

    const outcome = await runScriptSequence(segments, band.name, buildRunnerDeps(), mp3AudioUrl, vocalist, 0, () => stopRequestedRef.current);

    // The starting image was a one-time input for *this* run — clear it
    // so it's never silently reused on a later, different script. The
    // script text itself stays (matches the pre-persistence behavior —
    // useful to see/tweak/rerun), just the image.
    onSetScriptSequenceDraft({ script, startingImageUrl: undefined });
    flushSkidmarksSessionNow();
    setRunning(false);
    setProgressText(null);
    reportRunOutcome(outcome);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-rose-400/25 bg-rose-400/[0.03] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Script sequence</p>

      {running && (
        // Real ask (2026-09-16): a way to stop a batch mid-render the
        // moment something looks wrong, so it doesn't keep spending real
        // credits on every clip left. Never interrupts a render already
        // in flight (already paid for either way) — it just stops the
        // *next* one from starting, on the next check between clips
        // (`runScriptSequence`'s `shouldStop`). Sits at the top,
        // unmissable, rather than down by the render button Stuart would
        // have to scroll back to while a batch is running.
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2">
          <span className="text-[12px] leading-relaxed text-rose-100">Rendering — see something wrong?</span>
          <button
            type="button"
            onClick={() => {
              stopRequestedRef.current = true;
            }}
            className="shrink-0 rounded-full bg-rose-400 px-3 py-1.5 text-[13px] font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80"
          >
            Stop
          </button>
        </div>
      )}

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
        onChange={(e) => onSetScriptSequenceDraft({ script: e.target.value, startingImageUrl })}
        disabled={running}
        placeholder={"Paste your “Part 1 (0:00 - 0:15) — Title[Duration: ...]. ...” script here."}
        rows={4}
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none disabled:opacity-60"
      />

      <div className="flex items-center gap-2.5">
        {startingImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- already-uploaded Blob URL, next/image can't optimize a runtime-picked one
          <img
            src={startingImageUrl}
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
            {startingImageUrl
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
              {startingImagePicking ? "Uploading…" : startingImageUrl ? "Change" : "Upload"}
            </button>
            {startingImageUrl && (
              <button
                type="button"
                onClick={handleRemoveStartingImage}
                disabled={running}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            )}
          </div>
          {startingImageError && <span className="text-[11px] text-rose-300/90">{startingImageError}</span>}
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleBuildTimeline}
            disabled={running || parts.length === 0 || !!incompleteRun}
            title="Builds the timeline and pre-fills every plate with the locked reference photo — free, no rendering yet, so you can check every plate first."
            className="rounded-full border border-white/15 bg-white/[0.03] px-3.5 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Build timeline
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={running || parts.length === 0 || !!incompleteRun}
            className="rounded-full bg-rose-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Rendering…" : `Generate & render all${parts.length > 0 ? ` ${parts.length}` : ""}`}
          </button>
        </div>
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
