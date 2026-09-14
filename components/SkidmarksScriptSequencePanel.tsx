"use client";

import { useMemo, useState } from "react";
import { parseScriptSequence } from "@/lib/scriptSequence";
import {
  buildScriptSequenceSegments,
  flushSkidmarksSessionNow,
  type SkidmarksBand,
  type SkidmarksClipSegment,
  type SkidmarksPlateStill,
} from "@/lib/skidmarks";
import { buildPlateGenerationRequest, generatePlateStill, resolvePlateReferenceDataUrl, resolveVocalistForPrompt } from "@/lib/plateGeneration";
import { generateSkidmarksClip } from "@/lib/clipGeneration";
import { uploadSkidmarksPlateStill } from "@/lib/plateStillBlob";
import { extractLastVideoFrame } from "@/lib/videoFrame";
import { runScriptSequence, type ScriptSequenceRunEvent } from "@/lib/scriptSequenceRunner";
import type { PersistedClipRender } from "@/lib/clipRenders";

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
  onSetScriptSequence,
  onSetClipPlateStill,
  onRecordRender,
}: SkidmarksScriptSequencePanelProps) {
  const [script, setScript] = useState("");
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const parts = useMemo(() => parseScriptSequence(script), [script]);

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
    onSetScriptSequence(segments);
    flushSkidmarksSessionNow();

    const outcome = await runScriptSequence(
      segments,
      band.name,
      {
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
          return { ok: true, videoUrl: clipOutcome.videoUrl, persisted: clipOutcome.persisted, persistError: clipOutcome.persistError };
        },
        recordRender: onRecordRender,
        extractLastFrame: extractLastVideoFrame,
        setPlateStill: onSetClipPlateStill,
        onProgress: (event) => setProgressText(progressLabel(event)),
      },
      mp3AudioUrl,
      vocalist
    );

    flushSkidmarksSessionNow();
    setRunning(false);
    setProgressText(null);
    setResult(
      outcome.ok
        ? { ok: true, message: `All ${outcome.renderedCount} clips rendered and chained.` }
        : {
            ok: false,
            message: `Stopped at clip ${outcome.failedAtClipIndex + 1} (${outcome.renderedCount} clip${outcome.renderedCount === 1 ? "" : "s"} rendered before this): ${outcome.message}`,
          }
    );
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-rose-400/25 bg-rose-400/[0.03] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Script sequence</p>
      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        disabled={running}
        placeholder={"Paste your “Part 1 (0:00 - 0:15) — Title[Duration: ...]. ...” script here."}
        rows={4}
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/40">
          {parts.length > 0 ? `Found ${parts.length} part${parts.length === 1 ? "" : "s"}.` : "No parts found yet."}
        </span>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || parts.length === 0}
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
