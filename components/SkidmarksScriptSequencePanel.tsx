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
  resolveVocalistForPrompt,
} from "@/lib/plateGeneration";
import { resolveLocationStill } from "@/lib/plateLocation";
import { generateSkidmarksClip } from "@/lib/clipGeneration";
import { uploadSkidmarksPlateStill } from "@/lib/plateStillBlob";
import {
  parseScriptPartKind,
  runIdentitySafeSongRender,
  type IdentitySafeRunDeps,
  type IdentitySafeRunEvent,
  type IdentitySafeRunTarget,
  type IdentitySafeScriptPart,
} from "@/lib/scriptSequenceRunner";
import { persistedRenderKey, type PersistedClipRender } from "@/lib/clipRenders";

interface SkidmarksScriptSequencePanelProps {
  band: SkidmarksBand;
  hasMp3: boolean;
  /** The song's own real segments *before* this run replaces them — kept
   * only to size/order the freshly-minted clip timeline
   * (`buildScriptSequenceSegments` mints one segment per script part,
   * regardless of what it's used for afterward) and to locate an
   * in-progress run's resume point (`incompleteRun` below). The
   * identity-safe runner never reads a segment's `label`/`model` off
   * these — it decides Vocal-vs-Grok/H3 purely from each script part's
   * own title word (`parseScriptPartKind`), not from the song's real
   * measured singing. `[]` for a band with no MP3/no real segments yet. */
  realSegments: SkidmarksClipSegment[];
  /** The song's own durable audio URL — required for any part whose
   * title parses as `"Vocal"` (LTX needs a real slice of it);
   * `undefined` if the attached MP3's audio hasn't finished uploading
   * yet, or if the run has no Vocal parts at all. */
  mp3AudioUrl?: string;
  /** Every persisted render across the whole song, keyed by
   * `persistedRenderKey(segmentId, plateId)` — the same map
   * `SkidmarksClipTimeline` already reads (`useSkidmarksClipRenders`).
   * This is the durable, reload-proof way of finding "where a partial
   * run stopped" (see `incompleteRun` below), rather than relying on
   * this run's own in-memory `result` state, which is gone the moment
   * the page reloads. */
  renders: Map<string, PersistedClipRender>;
  scriptSequenceDraft: SkidmarksScriptSequenceDraft | null;
  onSetScriptSequenceDraft: (draft: SkidmarksScriptSequenceDraft | null) => void;
  onSetScriptSequence: (segments: SkidmarksClipSegment[]) => void;
  onSetClipPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill | null) => void;
  onRecordRender: (render: PersistedClipRender) => void;
}

function identitySafeProgressLabel(event: IdentitySafeRunEvent): string {
  switch (event.type) {
    case "resolving-place":
      return `Building clip ${event.clipIndex + 1} of ${event.clipCount}'s scene…`;
    case "generating-plate":
      return `Placing the artist into clip ${event.clipIndex + 1} of ${event.clipCount}'s scene…`;
    case "rendering":
      return `Rendering clip ${event.clipIndex + 1} of ${event.clipCount}…`;
    case "clip-done":
      return `Clip ${event.clipIndex + 1} of ${event.clipCount} done.`;
  }
}

/**
 * Stuart's "paste a script, get a real clip timeline, then render it all
 * automatically" ask (2026-09-14) — **the one-button identity-safe song
 * render** as of 2026-09-19. Ties `lib/scriptSequence.ts`'s parser,
 * `lib/skidmarks.ts`'s `buildScriptSequenceSegments`/
 * `setSkidmarksScriptSequence`, and `lib/scriptSequenceRunner.ts`'s
 * `runIdentitySafeSongRender` together with this feature's real backends
 * (xAI stills, Comfy Cloud LTX, MiniMax H3/Grok) — no new AI provider.
 *
 * **Why this now calls `runIdentitySafeSongRender`, not
 * `runScriptSequence`**: the real, repeatedly-reported bug this fixes is
 * that runner's own last-frame chaining — a render's closing frame
 * becomes the next clip's starting image, compounding drift render over
 * render, which is exactly how an artist's face stopped being their own
 * partway through a run. `runIdentitySafeSongRender` never chains
 * anything: every clip's plate is built fresh, every time, from that
 * clip's own empty place still plus a real identity photo — see that
 * function's own module doc comment in `lib/scriptSequenceRunner.ts` for
 * the full rationale, including why `runScriptSequence` itself (and its
 * existing Jack-Ash scene-block-chaining test coverage) was left
 * untouched rather than rewritten in place.
 *
 * **Script labels pick the backend per clip, not the song's real
 * audio** — a title of `"Vocal"` is the only kind that ever reaches
 * LTX/Comfy Cloud with the song's real vocal audio; `"Instrumental"`,
 * `"Intro"`, `"Outro"`, `"Bridge"`, `"Lead"`, `"Break"`, and
 * `"Other Singer: <name>"` all render Grok/H3 with no vocal audio at
 * all, even when the identity they hold is the same artist singing on
 * an adjacent clip (`lib/scriptSequenceRunner.ts`'s
 * `parseScriptPartKind`/`scriptPartUsesLtx`). A part naming a different
 * singer holds *that* named band member's own photo — never the current
 * artist's, never a chained frame — and any part whose identity photo is
 * missing fails that one clip outright rather than rendering a
 * text-only, no-identity still.
 *
 * **Fully automatic, by Stuart's own explicit choice** (2026-09-14) — the
 * one safety net kept regardless: the runner stops dead at the first
 * real failure, reporting exactly which clip, rather than continuing to
 * spend on a broken or identity-less chain.
 *
 * **"Build timeline" (2026-09-15)** is unchanged: build the whole
 * timeline and, for a *locked* character only, pre-fill every plate with
 * their reference photo so Stuart can scroll through before spending
 * anything. That pre-fill is a preview, not the final frame — the
 * identity-safe runner always (re)builds every clip's real starting
 * image itself, from a fresh place still + that clip's own resolved
 * identity, the moment Generate actually runs.
 *
 * **Removed in this pass**: the old "upload clip 1's own starting image"
 * control. It let a render start from an arbitrary photo with no place
 * still and no resolved identity behind it — exactly the kind of
 * un-composited start image rule 3's "missing either image → fail" is
 * meant to rule out — so keeping the button while the runner silently
 * overwrote whatever it uploaded would have been misleading rather than
 * useful. Not a feature Stuart asked to lose; a deliberate casualty of
 * making the safety guarantee unconditional rather than best-effort.
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
   * clip first. A plain ref, not state — the runner reads it
   * synchronously via `shouldStop` between clips. Reset at the start of
   * each run. */
  const stopRequestedRef = useRef(false);

  const script = scriptSequenceDraft?.script ?? "";
  const parts = useMemo(() => parseScriptSequence(script), [script]);
  /** One parsed kind per part, positionally aligned with `parts` — see
   * `lib/scriptSequenceRunner.ts`'s `parseScriptPartKind` doc comment
   * for the label words it recognizes. */
  const partKinds = useMemo(() => parts.map((part) => parseScriptPartKind(part.title)), [parts]);

  /**
   * Where an earlier, partial run of *this same stored timeline* stopped
   * — derived straight from durable state (`realSegments` + `renders`,
   * both sourced from the saved session), never from this run's own
   * in-memory `result`, so it survives a page reload. The first segment,
   * in order, with no persisted render yet is exactly the clip to retry.
   * `undefined` when there's nothing to resume.
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

  /** Shared by a fresh run and a resume — same real backends, same
   * progress reporting; only which segments/start index
   * `runIdentitySafeSongRender` itself is called with differs. */
  const buildIdentitySafeDeps = (): IdentitySafeRunDeps => ({
    resolvePlaceStill: async (sceneText, bandName) => {
      const placeOutcome = await resolveLocationStill({ sceneText, bandName });
      return placeOutcome.ok
        ? { ok: true, dataUrl: placeOutcome.dataUrl! }
        : { ok: false, message: placeOutcome.message ?? "Couldn't build this clip's scene." };
    },
    generateIdentityStill: async ({ shotPrompt, bandName, vocal, vocalist, locationStillDataUrl }) => {
      const request = buildPlateGenerationRequest({
        shotPrompt,
        vocal,
        model: vocal ? "ltx-lipsync" : "grok",
        bandName,
        vocalist,
        locationStillDataUrl,
      });
      const stillOutcome = await generatePlateStill(request);
      return stillOutcome.ok ? { ok: true, dataUrl: stillOutcome.dataUrl } : { ok: false, message: stillOutcome.message };
    },
    uploadStill: uploadSkidmarksPlateStill,
    renderClip: async (request) => {
      const clipOutcome = await generateSkidmarksClip(request);
      if (!clipOutcome.ok) return { ok: false, message: clipOutcome.message };
      // Deliberately drops `clipOutcome.lastFrameUrl` — this runner
      // never reads or writes a render's last frame (rule 5: last-frame
      // chaining is banned for identity).
      return { ok: true, videoUrl: clipOutcome.videoUrl, persisted: clipOutcome.persisted, persistError: clipOutcome.persistError };
    },
    recordRender: onRecordRender,
    setPlateStill: onSetClipPlateStill,
    onProgress: (event) => setProgressText(identitySafeProgressLabel(event)),
  });

  const reportRunOutcome = (outcome: Awaited<ReturnType<typeof runIdentitySafeSongRender>>) => {
    setResult(
      outcome.ok
        ? { ok: true, message: `All ${outcome.renderedCount} clips rendered.` }
        : !outcome.ok && outcome.stopped
          ? { ok: true, message: `Stopped — ${outcome.renderedCount} clip${outcome.renderedCount === 1 ? "" : "s"} rendered before you stopped it. Nothing else was spent.` }
          : {
              ok: false,
              message: `Stopped at clip ${outcome.failedAtClipIndex + 1} (${outcome.renderedCount} clip${outcome.renderedCount === 1 ? "" : "s"} rendered so far): ${outcome.message}`,
            }
    );
  };

  /** `segments` is passed explicitly (never re-read off the `realSegments`
   * prop mid-call) because `handleRun` may have *just* committed a brand
   * new timeline via `onSetScriptSequence` — the store update that prop
   * reflects hasn't necessarily re-rendered this component yet by the
   * time the render loop needs real segment/plate ids to write to. */
  const runFrom = async (segments: SkidmarksClipSegment[], startAtClipIndex: number) => {
    stopRequestedRef.current = false;
    setRunning(true);
    setResult(null);
    setProgressText(startAtClipIndex > 0 ? `Resuming at clip ${startAtClipIndex + 1} of ${segments.length}…` : "Starting…");

    const currentMember = resolveVocalistForPrompt(band.members);
    const identityParts: IdentitySafeScriptPart[] = parts.map((part, i) => ({
      shotPrompt: part.prompt,
      startSec: part.startSec,
      endSec: part.endSec,
      kind: partKinds[i].kind,
      otherSingerName: partKinds[i].otherSingerName,
    }));
    const targets: IdentitySafeRunTarget[] = segments.map((segment) => ({
      segmentId: segment.id,
      plateId: segment.plates[0]?.id ?? "",
    }));

    const outcome = await runIdentitySafeSongRender(
      identityParts,
      targets,
      band.name,
      currentMember,
      band.members,
      mp3AudioUrl,
      buildIdentitySafeDeps(),
      startAtClipIndex,
      () => stopRequestedRef.current
    );

    flushSkidmarksSessionNow();
    setRunning(false);
    setProgressText(null);
    reportRunOutcome(outcome);
  };

  const handleResume = async () => {
    if (running || !incompleteRun) return;
    await runFrom(realSegments, incompleteRun.resumeIndex);
  };

  /**
   * Real reported ask (2026-09-15): build the whole clip timeline and,
   * for a *locked* character only, pre-fill every plate with their fixed
   * reference photo — before any rendering or any money is spent — so
   * Stuart can scroll through and see the timeline shape first. Purely a
   * preview: the identity-safe runner always (re)builds every clip's
   * real starting image itself when Generate actually runs, so this
   * pre-fill is never treated as "already done."
   */
  const handleBuildTimeline = () => {
    if (running || parts.length === 0) return;

    const segments = buildScriptSequenceSegments(parts, realSegments);
    onSetScriptSequence(segments);

    const vocalist = resolveVocalistForPrompt(band.members);
    const lock = vocalist ? getSkidmarksCharacterLock(vocalist) : undefined;
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
        ? `Timeline built — all ${segments.length} plates start from the locked reference photo as a preview. Tap Generate when you're happy; each clip still gets its own fresh scene + identity composite at render time.`
        : `Timeline built — ${segments.length} clips ready. Tap Generate to render — every clip builds its own scene + identity composite fresh.`,
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

    // Reuse the timeline "Build timeline" already committed for this
    // exact script, instead of rebuilding from scratch and minting new
    // segment/plate ids for no reason. Matching part counts is an
    // imperfect but low-stakes signal — worst case a changed script with
    // the same number of parts reuses stale segment shells, which is
    // harmless since the identity-safe runner always regenerates every
    // plate's actual still from scratch anyway.
    const alreadyBuilt = realSegments.length === parts.length;
    const segments = alreadyBuilt ? realSegments : buildScriptSequenceSegments(parts, realSegments);

    if (!alreadyBuilt) {
      onSetScriptSequence(segments);
      flushSkidmarksSessionNow();
    }

    await runFrom(segments, 0);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-rose-400/25 bg-rose-400/[0.03] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Script sequence</p>

      {running && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-1.5">
          <span className="text-[11px] leading-relaxed text-rose-100">Rendering…</span>
          <button
            type="button"
            onClick={() => {
              stopRequestedRef.current = true;
            }}
            className="shrink-0 rounded-full bg-rose-400 px-2.5 py-1 text-[11px] font-medium text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80"
          >
            Stop
          </button>
        </div>
      )}

      {incompleteRun && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-3 py-1.5">
          <span className="text-[11px] leading-relaxed text-amber-100">
            Clip {incompleteRun.resumeIndex + 1}/{incompleteRun.total} didn&apos;t finish
          </span>
          <button
            type="button"
            onClick={handleResume}
            disabled={running}
            title="Resumes from where it stopped — starting fresh instead would re-render and re-charge for clips already done."
            className="shrink-0 rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-medium text-zinc-950 transition-colors hover:bg-amber-200 active:bg-amber-300/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Rendering…" : `Resume · ${incompleteRun.total - incompleteRun.resumeIndex} left`}
          </button>
        </div>
      )}

      <textarea
        value={script}
        onChange={(e) => onSetScriptSequenceDraft({ script: e.target.value })}
        disabled={running}
        placeholder={
          'Paste your "Part 1 (0:00 - 0:15) — Vocal[Duration: ...]. ..." script here. ' +
          "Title words: Vocal, Instrumental, Intro, Outro, Bridge, Lead, Break, or \"Other Singer: Name\"."
        }
        rows={4}
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none disabled:opacity-60"
      />

      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[11px] text-white/40"
          title={incompleteRun ? "Use Resume above — starting fresh would re-render and re-charge for clips already done." : undefined}
        >
          {parts.length > 0 ? `${parts.length} part${parts.length === 1 ? "" : "s"}` : "No parts yet"}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleBuildTimeline}
            disabled={running || parts.length === 0 || !!incompleteRun}
            title="Pre-fills every plate with the locked reference photo (if any) — free, no rendering yet, so you can check the timeline shape first."
            className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={running || parts.length === 0 || !!incompleteRun}
            title={parts.length > 0 ? `Renders all ${parts.length} clips` : undefined}
            className="rounded-full bg-rose-400 px-3 py-1.5 text-[12px] font-medium text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Rendering…" : "Generate"}
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
