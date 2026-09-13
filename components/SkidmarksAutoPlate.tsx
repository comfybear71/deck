"use client";

import { useState } from "react";
import {
  MAX_AUTO_PLATE_BRIEF_LENGTH,
  ESTIMATED_STILL_COST_USD,
  planAutoPlateFill,
} from "@/lib/autoPlate";
import {
  buildPlateGenerationRequest,
  generatePlateStill,
  resolvePlateReferenceDataUrl,
  resolveVocalistForPrompt,
} from "@/lib/plateGeneration";
import { SKIDMARKS_SEGMENT_LABEL_META, type SkidmarksBand, type SkidmarksClipSegment, type SkidmarksPlateStill } from "@/lib/skidmarks";

interface SkidmarksAutoPlateProps {
  segments: SkidmarksClipSegment[];
  band: SkidmarksBand;
  /** The attached MP3's own filename — a fallback signal (alongside the
   * brief text) for whether Stuart's scripted concrete-opener idea
   * applies; see `lib/autoPlate.ts`'s `planAutoPlateFill`. */
  songTitleHint?: string;
  onSetClipPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill | null) => void;
}

function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 animate-spin text-white/80">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
      <path d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The slim "short brief + Auto-plate" control — see `lib/autoPlate.ts`'s
 * module doc comment for the full planning contract (pure heuristics,
 * never an LLM call against the brief, the one scripted door → keyhole
 * → Jack exception). This component owns only the *execution* half:
 * running `planAutoPlateFill`'s output through the exact same real
 * still-generation path (`lib/plateGeneration.ts`) a manual "type a shot
 * prompt, tap Generate" pass already uses, one plate at a time, in strip
 * order (so the scripted opener's "continue from the plate before it"
 * targets can reference a still this same run just produced).
 *
 * **Then stops** — no auto video render, ever; each plate this fills is
 * still just a still Stuart can inspect/enlarge/reject/regenerate
 * exactly like a manually generated one. **Cost-aware**: a plain tap
 * only reveals a count + a rough dollar estimate; a second tap actually
 * runs it, with a real "Generating N of M…" progress line while it
 * does, and an honest summary (including any real failures — e.g. no
 * `XAI_API_KEY` configured) once it's done. **Never overwrites a filled
 * plate** — `planAutoPlateFill` only ever plans for slots that are
 * still empty at the moment "Auto-plate" is tapped.
 */
export function SkidmarksAutoPlate({ segments, band, songTitleHint, onSetClipPlateStill }: SkidmarksAutoPlateProps) {
  const [brief, setBrief] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const targets = planAutoPlateFill(segments, brief, band.name, songTitleHint ?? "");
  const estimatedCost = targets.length * ESTIMATED_STILL_COST_USD;

  const handleTap = () => {
    if (running) return;
    setSummary(null);
    if (targets.length === 0) {
      setSummary("Nothing to fill \u2014 every plate already has a still.");
      return;
    }
    setConfirming(true);
  };

  const handleConfirm = async () => {
    setConfirming(false);
    setRunning(true);
    setProgress({ done: 0, total: targets.length });

    const generatedStills = new Map<string, string>();
    let successCount = 0;
    let stoppedEarly: string | null = null;

    for (const target of targets) {
      const segment = segments.find((s) => s.id === target.segmentId);
      const plateIndex = segment?.plates.findIndex((p) => p.id === target.plateId) ?? -1;
      if (!segment || plateIndex < 0) {
        setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        continue;
      }

      const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label]?.vocal ?? false;
      let vocalist = resolveVocalistForPrompt(band.members);
      if (vocalist?.avatarImage) {
        try {
          const identityDataUrl = await resolvePlateReferenceDataUrl(vocalist.avatarImage);
          vocalist = { ...vocalist, avatarImage: identityDataUrl };
        } catch {
          // Best-effort identity reference — a failure here shouldn't
          // block the still generation call itself, just drop the ref.
        }
      }

      const previousPlateId = plateIndex > 0 ? segment.plates[plateIndex - 1].id : undefined;
      const continuityStillDataUrl = target.continueFromPreviousPlate
        ? generatedStills.get(previousPlateId ?? "") ?? (previousPlateId ? segment.plates[plateIndex - 1].still?.dataUrl : undefined)
        : undefined;

      const request = buildPlateGenerationRequest({
        shotPrompt: target.shotPrompt,
        vocal,
        model: segment.model,
        bandName: band.name,
        vocalist,
        continuityStillDataUrl,
      });

      const outcome = await generatePlateStill(request);
      if (outcome.ok) {
        generatedStills.set(target.plateId, outcome.dataUrl);
        onSetClipPlateStill(target.segmentId, target.plateId, {
          dataUrl: outcome.dataUrl,
          source: "generated",
          createdAt: Date.now(),
        });
        successCount += 1;
      } else if (outcome.unconfigured) {
        // Every remaining target would fail the exact same way — stop
        // honestly now instead of looping through the rest for nothing.
        stoppedEarly = outcome.message;
        setProgress((prev) => (prev ? { ...prev, done: prev.total } : prev));
        break;
      }
      // A real (non-unconfigured) failure for one still doesn't stop the
      // rest — a transient/upstream error on one shot shouldn't block
      // every other empty plate from getting filled.

      setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }

    setRunning(false);
    setProgress(null);
    if (stoppedEarly) {
      setSummary(`Stopped \u2014 still generation isn't set up here (${stoppedEarly}).`);
    } else {
      const failCount = targets.length - successCount;
      setSummary(
        failCount > 0
          ? `Filled ${successCount} of ${targets.length} empty plates \u2014 ${failCount} didn't generate; try Generate on those individually.`
          : `Filled ${successCount} empty plate${successCount === 1 ? "" : "s"}.`
      );
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <label htmlFor="auto-plate-brief" className="text-[10px] font-medium uppercase tracking-wide text-white/40">
        Auto-plate from a short brief
      </label>
      <div className="flex items-center gap-2">
        <input
          id="auto-plate-brief"
          type="text"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={MAX_AUTO_PLATE_BRIEF_LENGTH}
          placeholder="e.g. door, keyhole, Jack, neon-blue"
          disabled={running}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[12px] text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none disabled:opacity-50"
        />
        {!confirming && (
          <button
            type="button"
            onClick={handleTap}
            disabled={running}
            className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-2 text-[12px] font-semibold text-white/85 transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "Working\u2026" : "Auto-plate"}
          </button>
        )}
      </div>

      {confirming && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded-full bg-rose-400 px-3.5 py-2 text-center text-[12px] font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/85"
          >
            {`Confirm — generate ${targets.length} still${targets.length === 1 ? "" : "s"}, ~$${estimatedCost.toFixed(2)}`}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {running && progress && (
        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <Spinner />
          {`Generating ${Math.min(progress.done + 1, progress.total)} of ${progress.total}\u2026`}
        </div>
      )}

      {summary && !running && (
        <p role="status" aria-live="polite" className="text-[11px] leading-snug text-white/50">
          {summary}
        </p>
      )}
    </div>
  );
}
