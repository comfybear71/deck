"use client";

import { useRef, useState } from "react";
import {
  formatSegmentRange,
  isLipSyncModel,
  SKIDMARKS_SEGMENT_LABEL_META,
  skidmarksModelBadge,
  type SkidmarksAnalysisStatus,
  type SkidmarksClipSegment,
  type SkidmarksModelId,
  type SkidmarksPlateId,
  type SkidmarksSegmentsSource,
  type SkidmarksTranscriptionStatus,
} from "@/lib/skidmarks";
import { type SkidmarksTranscriptionProvider } from "@/lib/transcription";
import { SkidmarksPlatesAndCamera } from "./SkidmarksPlatesAndCamera";

interface SkidmarksClipTimelineProps {
  segments: SkidmarksClipSegment[];
  segmentsSource: SkidmarksSegmentsSource;
  analysisStatus: SkidmarksAnalysisStatus;
  analysisError?: string;
  transcriptionStatus: SkidmarksTranscriptionStatus;
  transcriptionError?: string;
  transcriptionProvider?: SkidmarksTranscriptionProvider;
  onSetSegmentPlate: (segmentId: string, plateId: SkidmarksPlateId) => void;
  onSetSegmentModel: (segmentId: string, model: SkidmarksModelId) => void;
  onSetSegmentShotPrompt: (segmentId: string, shotPrompt: string) => void;
}

const STUB_FEEDBACK_TIMEOUT_MS = 3200;

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M5 7.5l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SegmentRow({
  segment,
  expanded,
  onToggle,
  onSetPlate,
  onSetModel,
  onSetShotPrompt,
}: {
  segment: SkidmarksClipSegment;
  expanded: boolean;
  onToggle: () => void;
  onSetPlate: (plateId: SkidmarksPlateId) => void;
  onSetModel: (model: SkidmarksModelId) => void;
  onSetShotPrompt: (shotPrompt: string) => void;
}) {
  const meta = SKIDMARKS_SEGMENT_LABEL_META[segment.label];
  const lipSync = isLipSyncModel(segment.model);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
        aria-label={`${meta.label} clip, ${formatSegmentRange(segment.startSec, segment.endSec)}. Tap to ${expanded ? "collapse" : "expand"}.`}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronIcon open={expanded} />
        <span className="shrink-0 text-xs font-medium tabular-nums text-white/60">
          {formatSegmentRange(segment.startSec, segment.endSec)}
        </span>
        <span
          className={[
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            meta.vocal
              ? "border-rose-400/35 bg-rose-400/10 text-rose-200"
              : "border-amber-300/30 bg-amber-300/[0.08] text-amber-200/90",
          ].join(" ")}
        >
          {meta.label}
        </span>
        <span className="flex-1" />
        {/* Read-only glance at the current pick, not a tap target — the
            real one-tap Model row lives in the expanded panel
            (`SkidmarksPlatesAndCamera`) now, so this collapsed badge
            doesn't duplicate that control. */}
        <span
          aria-label={`Model: ${skidmarksModelBadge(segment.model)}${lipSync ? " (lip-sync)" : ""}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-white/60"
        >
          {lipSync && (
            <span aria-hidden className="text-[9px] leading-none">
              {"\u{1F3A4}"}
            </span>
          )}
          {skidmarksModelBadge(segment.model)}
        </span>
      </div>

      {expanded && (
        <div className="px-3 pb-3">
          <SkidmarksPlatesAndCamera
            segment={segment}
            onSetPlate={onSetPlate}
            onSetModel={onSetModel}
            onSetShotPrompt={onSetShotPrompt}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A short, plain-language note shown above the rows — but only when
 * there's something worth flagging (transcription never configured,
 * came back too sparse to trust, or failed outright). Once real,
 * useful transcription lands (`segmentsSource === "transcription"`,
 * the green-Lyrics case), or while everything's still resolving, this
 * returns `null` and no line renders at all — the Lyrics/Timing/Ready
 * chips already carry that signal, so the timeline doesn't repeat it
 * as a paragraph. No file paths, no explanation of how the fallback
 * works — just which timing is showing.
 */
function timelineNote(
  segmentsSource: SkidmarksSegmentsSource,
  analysisStatus: SkidmarksAnalysisStatus,
  transcriptionStatus: SkidmarksTranscriptionStatus
): string | null {
  if (segmentsSource === "transcription") return null;
  if (transcriptionStatus === "checking" || analysisStatus === "analyzing") return null;

  const reason =
    transcriptionStatus === "unconfigured"
      ? "Lyrics timing isn't set up"
      : transcriptionStatus === "sparse"
        ? "Lyrics timing was too thin to trust"
        : "Lyrics timing failed";

  return segmentsSource === "analysis"
    ? `${reason} \u2014 showing estimated timing below.`
    : `${reason} \u2014 showing placeholder timing below.`;
}

/**
 * The clip/segment timeline — appended right under the MP3 checklist
 * once an MP3 exists. `segments` prefers real word-level transcription
 * (`transcribeAudio`/`segmentsFromWords` in `lib/transcription.ts`,
 * `segmentsSource === "transcription"`) whenever it lands; short of
 * that, real output from the energy heuristic
 * (`analyzeVocalActivity`, `segmentsSource === "analysis"`); short of
 * that (still resolving, or both failed/unconfigured), this instead
 * shows `buildDemoSegments`' deterministic seed cadence. Once real,
 * useful transcription lands (green Lyrics chip), no caption or note
 * shows at all — Stuart asked for the long "honesty caption" essay
 * gone from the main UI now that ElevenLabs Scribe works; the
 * Lyrics/Timing/Ready chips carry that signal instead. A short
 * one-line note (see `timelineNote` above, no file paths) still shows
 * when transcription is unconfigured, sparse, or failed, so a
 * fallback timing isn't presented as if it were real. This is editable
 * structure for Stuart to assign a location plate / shot prompt to
 * regardless of which source is showing.
 *
 * Each row is individually collapsible (collapsed = time range + label +
 * a read-only model badge — a 🎤 glyph joins it when the current model
 * is LTX Lip-sync; expanded = `SkidmarksPlatesAndCamera`'s big plate-card
 * row + shot-prompt box + a compact Model pill row for that clip — the
 * Camera Angles block from an earlier pass is gone outright, and per
 * Stuart's cost lock the Model row is a plain one-tap pick that's never
 * auto-assigned to H3/Seedance). The whole section can also collapse,
 * same pattern as `ControlPlaneDemo`.
 *
 * **Phase note**: this is the plates/clip UI only. The footer's
 * "Generate Clips" button is a **stub** — tapping it never calls a real
 * Comfy MCP / LTX render anywhere in this file or
 * `SkidmarksPlatesAndCamera`; it only shows a "stub, not wired" message,
 * surfaced in an always-mounted `role="status"` + `aria-live` line so
 * assistive tech reaches it too, not just sighted users. **This is
 * where the real cost lives, per Stuart**: a real plate *still* image
 * (one frame) is cheap; a real *video render/animate* pass (this
 * button, or Seedance's multi-angle clip generation) is the expensive
 * part, so this button — and any Seedance call — stays stubbed in this
 * PR regardless of whether plate stills themselves ever become real.
 */
export function SkidmarksClipTimeline({
  segments,
  segmentsSource,
  analysisStatus,
  transcriptionStatus,
  onSetSegmentPlate,
  onSetSegmentModel,
  onSetSegmentShotPrompt,
}: SkidmarksClipTimelineProps) {
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [stubMessage, setStubMessage] = useState<string | null>(null);
  const stubMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerateClips = () => {
    if (stubMessageTimer.current) clearTimeout(stubMessageTimer.current);
    setStubMessage(
      "Stub only \u2014 no Comfy MCP / LTX render kicked off. Wire-up comes once that pipeline lands."
    );
    stubMessageTimer.current = setTimeout(() => setStubMessage(null), STUB_FEEDBACK_TIMEOUT_MS);
  };

  if (segments.length === 0) return null;

  const note = timelineNote(segmentsSource, analysisStatus, transcriptionStatus);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setSectionOpen((v) => !v)}
        aria-expanded={sectionOpen}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
          Clip / segment list
          <span aria-hidden className="ml-1.5 text-white/25">
            {"\u00b7"} {segments.length}
          </span>
        </span>
        <ChevronIcon open={sectionOpen} />
      </button>

      {sectionOpen && (
        <>
          {note && <p className="text-[11px] leading-relaxed text-amber-200/70">{note}</p>}

          <div className="flex flex-col gap-2">
            {segments.map((segment) => (
              <SegmentRow
                key={segment.id}
                segment={segment}
                expanded={expandedIds.has(segment.id)}
                onToggle={() => toggleExpanded(segment.id)}
                onSetPlate={(plateId) => onSetSegmentPlate(segment.id, plateId)}
                onSetModel={(model) => onSetSegmentModel(segment.id, model)}
                onSetShotPrompt={(shotPrompt) => onSetSegmentShotPrompt(segment.id, shotPrompt)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleGenerateClips}
            className="mt-1 rounded-full bg-rose-400 px-4 py-3 text-center text-sm font-semibold text-zinc-950 shadow-[0_0_28px_-6px_rgba(251,113,133,0.85)] transition-colors hover:bg-rose-300 active:bg-rose-400/85"
          >
            Generate Clips
          </button>
          {/* Always mounted (not conditionally rendered) with role="status" +
              aria-live so assistive tech reliably announces the stub
              message on tap — some browsers/screen readers miss the first
              update on a live region that only enters the DOM after the
              click that changes it. Empty and visually collapsed
              (h-0/opacity-0) until there's something to say. */}
          <p
            role="status"
            aria-live="polite"
            className={[
              "text-center text-[11px] leading-relaxed text-white/45 transition-opacity",
              stubMessage ? "opacity-100" : "h-0 overflow-hidden opacity-0",
            ].join(" ")}
          >
            {stubMessage}
          </p>
        </>
      )}
    </div>
  );
}
