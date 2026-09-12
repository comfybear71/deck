"use client";

import { useRef, useState } from "react";
import {
  formatSegmentRange,
  isLipSyncModel,
  SKIDMARKS_MODELS,
  SKIDMARKS_SEGMENT_LABEL_META,
  skidmarksModelBadge,
  skidmarksModelLabel,
  type SkidmarksCameraAngleId,
  type SkidmarksClipSegment,
  type SkidmarksModelId,
  type SkidmarksPlateId,
} from "@/lib/skidmarks";
import { SkidmarksPlatesAndCamera } from "./SkidmarksPlatesAndCamera";

interface SkidmarksClipTimelineProps {
  segments: SkidmarksClipSegment[];
  onSetSegmentModel: (segmentId: string, model: SkidmarksModelId) => void;
  onSetSegmentPlate: (segmentId: string, plateId: SkidmarksPlateId) => void;
  onSetSegmentCameraAngle: (segmentId: string, cameraAngle: SkidmarksCameraAngleId) => void;
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
  onSetModel,
  onSetPlate,
  onSetCameraAngle,
}: {
  segment: SkidmarksClipSegment;
  expanded: boolean;
  onToggle: () => void;
  onSetModel: (model: SkidmarksModelId) => void;
  onSetPlate: (plateId: SkidmarksPlateId) => void;
  onSetCameraAngle: (cameraAngle: SkidmarksCameraAngleId) => void;
}) {
  const meta = SKIDMARKS_SEGMENT_LABEL_META[segment.label];
  const lipSync = isLipSyncModel(segment.model);

  const cycleModel = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = SKIDMARKS_MODELS.findIndex((m) => m.id === segment.model);
    const next = SKIDMARKS_MODELS[(idx + 1) % SKIDMARKS_MODELS.length];
    onSetModel(next.id);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      {/* A `div` (not `button`) so the model pill's own real `<button>` can
          nest inside it validly — see `SkidmarksMembersModule`'s `MemberRow`
          for the same pattern. */}
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
        <button
          type="button"
          onClick={cycleModel}
          title="Tap to switch model"
          aria-label={`Model: ${skidmarksModelLabel(segment.model)}${lipSync ? " (lip-sync)" : ""}. Tap to switch.`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/70 transition-colors hover:border-rose-400/40 hover:text-rose-200"
        >
          {lipSync && (
            <span aria-hidden className="text-[9px] leading-none">
              {"\u{1F3A4}"}
            </span>
          )}
          {skidmarksModelBadge(segment.model)}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3">
          <SkidmarksPlatesAndCamera
            segment={segment}
            onSetPlate={onSetPlate}
            onSetCameraAngle={onSetCameraAngle}
            onSetModel={onSetModel}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The clip/segment timeline — appended right under the MP3 checklist
 * once an MP3 exists. **Important honesty note**: `segments` is a
 * deterministic seed cadence (`buildDemoSegments` in `lib/skidmarks.ts`),
 * not real lyrics timing or singing detection — the checklist's Lyrics/
 * Timing/Ready chips above are still staged mock timers too. This is
 * editable structure for Stuart to assign plates/camera/model to today,
 * in the shape a future real STT + singing-detect pass can populate.
 *
 * Each row is individually collapsible (collapsed = time range + label +
 * a compact model badge pill — a 🎤 glyph joins it when the current
 * model is LTX Lip-sync — that cycles to the next model on tap; expanded
 * = the full `SkidmarksPlatesAndCamera` panel for that clip, whose plate
 * cards repeat the same time/duration/model/lip-sync tags so they stay
 * self-describing while scrolled). The whole section can also collapse,
 * same pattern as `ControlPlaneDemo`.
 *
 * **Phase note**: this is the plates/clip UI only. The footer's
 * "Generate Clips" button is a **stub** — tapping it only shows a "stub,
 * not wired" message; no Comfy MCP / LTX / Seedance render call happens
 * anywhere in this file or `SkidmarksPlatesAndCamera`.
 */
export function SkidmarksClipTimeline({
  segments,
  onSetSegmentModel,
  onSetSegmentPlate,
  onSetSegmentCameraAngle,
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
          <p className="text-[11px] leading-relaxed text-white/35">
            Seed timeline {"\u2014"} a demo verse/bridge/lead/instrumental
            cadence, not real lyrics timing or singing detection. Editable
            structure for now; refined once real analysis lands.
          </p>

          <div className="flex flex-col gap-2">
            {segments.map((segment) => (
              <SegmentRow
                key={segment.id}
                segment={segment}
                expanded={expandedIds.has(segment.id)}
                onToggle={() => toggleExpanded(segment.id)}
                onSetModel={(model) => onSetSegmentModel(segment.id, model)}
                onSetPlate={(plateId) => onSetSegmentPlate(segment.id, plateId)}
                onSetCameraAngle={(cameraAngle) =>
                  onSetSegmentCameraAngle(segment.id, cameraAngle)
                }
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
          {stubMessage && (
            <p className="text-center text-[11px] leading-relaxed text-white/45">{stubMessage}</p>
          )}
        </>
      )}
    </div>
  );
}
