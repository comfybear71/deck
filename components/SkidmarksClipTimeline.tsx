"use client";

import { useState } from "react";
import {
  formatSegmentRange,
  SKIDMARKS_SEGMENT_LABEL_META,
  type SkidmarksAnalysisStatus,
  type SkidmarksBand,
  type SkidmarksClipSegment,
  type SkidmarksClipSentPayload,
  type SkidmarksInstrumentalVideoModel,
  type SkidmarksPlateStill,
  type SkidmarksSegmentsSource,
  type SkidmarksTranscriptionStatus,
} from "@/lib/skidmarks";
import { type SkidmarksTranscriptionProvider } from "@/lib/transcription";
import type { PersistedClipRender } from "@/lib/clipRenders";
import { SkidmarksClipStub } from "./SkidmarksClipStub";
import { SkidmarksClipTimingHeaderEdit } from "./SkidmarksClipTimingHeaderEdit";

interface SkidmarksClipTimelineProps {
  segments: SkidmarksClipSegment[];
  segmentsSource: SkidmarksSegmentsSource;
  analysisStatus: SkidmarksAnalysisStatus;
  analysisError?: string;
  transcriptionStatus: SkidmarksTranscriptionStatus;
  transcriptionError?: string;
  transcriptionProvider?: SkidmarksTranscriptionProvider;
  /** The active band — `SkidmarksClipStub` needs it to resolve which
   * member auto-includes as the vocalist on a Vocal clip
   * (`resolveVocalistForPrompt` in `lib/plateGeneration.ts`) and to name
   * the band in a generated still's prompt. */
  band: SkidmarksBand;
  /** The attached MP3's own filename — retained on the props surface
   * for callers; Auto-plate was removed from this music-video clip list
   * (lib/autoPlate.ts + SkidmarksAutoPlate stay in the repo unused here). */
  mp3FileName?: string;
  /** The attached song's own durable Blob URL
   * (`SkidmarksMp3Attachment.audioUrl`) — threaded straight through to
   * `SkidmarksClipStub`/`SkidmarksClipRender` for the Vocal/Comfy-LTX
   * render path, which needs a real slice of it server-side
   * (`lib/mp3Slice.ts`). `undefined` until that upload finishes (or if
   * it never configures/succeeds) — see `lib/mp3Blob.ts`. */
  mp3AudioUrl?: string;
  /** Every plate across the whole song that already has a saved
   * render, keyed by `persistedRenderKey` — lifted up to
   * `SkidmarksDetailSheet`'s `useSkidmarksClipRenders` so
   * `SkidmarksRenderedClipsShelf` shares this exact state instead of a
   * second independent fetch. */
  renders: Map<string, PersistedClipRender>;
  onPersisted: (render: PersistedClipRender) => void;
  onSetSegmentShotPrompt: (segmentId: string, shotPrompt: string) => void;
  onSetSegmentNegativePrompt: (segmentId: string, negativePrompt: string) => void;
  /** The compact −1s/+1s stepper's own handlers — see
   * `lib/skidmarks.ts`'s `nudgeSkidmarksSegmentStart`/
   * `nudgeSkidmarksSegmentEnd`. Stuart's 2026-09-13 ask: ElevenLabs
   * Scribe timing is "mostly right but sometimes 3-4 seconds off," so
   * he wants to slip a clip's start/end after transcription without
   * re-running Scribe. */
  onNudgeSegmentStart: (segmentId: string, deltaSec: number) => void;
  onNudgeSegmentEnd: (segmentId: string, deltaSec: number) => void;
  onSetClipPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill | null) => void;
  onAddClipPlate: (segmentId: string) => void;
  onRemoveClipPlate: (segmentId: string, plateId: string) => void;
  onSelectClipPlate: (segmentId: string, plateId: string) => void;
  onSetClipPlateMotionPrompt: (segmentId: string, plateId: string, motionPrompt: string) => void;
  /** Records the exact payload a plate's render sent — see
   * `lib/skidmarks.ts`'s `SkidmarksClipSentPayload`. */
  onSetClipPlateLastSent: (segmentId: string, plateId: string, sent: SkidmarksClipSentPayload) => void;
  /** The H3/Grok switch inside `SkidmarksClipRender`'s Render confirm —
   * see `lib/skidmarks.ts`'s `SkidmarksInstrumentalVideoModel`. */
  onSetClipInstrumentalModel: (segmentId: string, model: SkidmarksInstrumentalVideoModel) => void;
  /** Real, visible outcome of the last-frame-chaining attempt
   * (`SkidmarksDetailSheet.tsx`'s `handlePersisted`) after a render
   * persists — 2026-09-14, Stuart's own pushback: the feature used to
   * fail (or succeed) completely silently, "how do I know this is
   * going to work?" `null` before any render this session, or once
   * dismissed. Never claims success/failure for anything else. */
  chainNote?: { ok: boolean; message: string } | null;
  onDismissChainNote?: () => void;
}

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
  band,
  previousStill,
  expanded,
  onToggle,
  onSetShotPrompt,
  onSetNegativePrompt,
  onSetPlateStill,
  onAddPlate,
  onRemovePlate,
  onSelectPlate,
  onSetPlateMotionPrompt,
  onSetPlateLastSent,
  onSetInstrumentalModel,
  onNudgeStart,
  onNudgeEnd,
  renderedPlateIds,
  renderLocked,
  onRenderStart,
  onRenderEnd,
  clipIndex,
  onPersisted,
  mp3AudioUrl,
}: {
  segment: SkidmarksClipSegment;
  band: SkidmarksBand;
  /** The clip immediately before this one's *last* plate's still, if it
   * has one — the "continue from previous clip's plate" continuity
   * reference for this clip's *first* plate slot only
   * (`SkidmarksClipStub` uses the previous slot within its own strip for
   * every later slot instead — see that component's doc comment). Feeds
   * `SkidmarksClipStub`'s "Use last plate" toggle and
   * `lib/plateGeneration.ts`'s `buildPlateGenerationRequest`. `undefined`
   * for the first clip, or whenever the previous clip's last plate has
   * no still yet. */
  previousStill?: SkidmarksPlateStill;
  expanded: boolean;
  onToggle: () => void;
  onSetShotPrompt: (shotPrompt: string) => void;
  onSetNegativePrompt: (negativePrompt: string) => void;
  onSetPlateStill: (plateId: string, still: SkidmarksPlateStill | null) => void;
  onAddPlate: () => void;
  onRemovePlate: (plateId: string) => void;
  onSelectPlate: (plateId: string) => void;
  onSetPlateMotionPrompt: (plateId: string, motionPrompt: string) => void;
  onSetPlateLastSent: (plateId: string, sent: SkidmarksClipSentPayload) => void;
  onSetInstrumentalModel: (model: SkidmarksInstrumentalVideoModel) => void;
  /** The header's double-tap-to-edit time fields
   * (`SkidmarksClipTimingHeaderEdit`, rendered directly below) — see
   * `SkidmarksClipTimeline`'s doc comment. Both setters already clamp
   * any delta against the song's bounds/neighboring clip, so nothing
   * here needs a precomputed disabled-state flag the way the old
   * stepper did. */
  onNudgeStart: (deltaSec: number) => void;
  onNudgeEnd: (deltaSec: number) => void;
  renderedPlateIds: ReadonlySet<string>;
  /** Whether a *different* plate anywhere on this timeline is currently
   * rendering a real video — see `SkidmarksClipTimeline`'s
   * `renderingKey` state and `SkidmarksClipRender`'s doc comment
   * for the "one render at a time" cost lock this enforces. */
  renderLocked: boolean;
  onRenderStart: (plateId: string) => void;
  onRenderEnd: (plateId: string) => void;
  /** This clip's 1-based position in the timeline — see
   * `SkidmarksClipStub`'s doc comment for what it's used for. */
  clipIndex: number;
  onPersisted: (render: PersistedClipRender) => void;
  mp3AudioUrl?: string;
}) {
  const meta = SKIDMARKS_SEGMENT_LABEL_META[segment.label];
  // Real ask (2026-09-16): "I cannot tell which one has been rendered
  // and which is still left" — collapsing every clip hid the one thing
  // Stuart actually needed to scan the whole timeline at a glance,
  // forcing him to open each row (or count) to find out. A clip with no
  // plates at all never reads as "rendered" just because the (empty)
  // every-plate check trivially passes.
  const renderedPlateCount = segment.plates.filter((p) => renderedPlateIds.has(p.id)).length;
  const allPlatesRendered = segment.plates.length > 0 && renderedPlateCount === segment.plates.length;
  const somePlatesRendered = renderedPlateCount > 0 && !allPlatesRendered;

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
        <SkidmarksClipTimingHeaderEdit
          startSec={segment.startSec}
          endSec={segment.endSec}
          onNudgeStart={onNudgeStart}
          onNudgeEnd={onNudgeEnd}
        />
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
        <span className="ml-auto shrink-0" aria-hidden="true">
          {allPlatesRendered ? (
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-emerald-400">
              <circle cx="10" cy="10" r="9" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6 10.2l2.6 2.6L14.2 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : somePlatesRendered ? (
            <span
              className="block h-4 w-4 rounded-full border-[1.3px] border-amber-300/70"
              style={{ background: "conic-gradient(rgb(252 211 77 / 0.5) calc(100% * var(--frac)), transparent 0)", ["--frac" as string]: renderedPlateCount / segment.plates.length }}
            />
          ) : (
            <span className="block h-4 w-4 rounded-full border-[1.3px] border-white/15" />
          )}
        </span>
        <span className="sr-only">
          {allPlatesRendered
            ? "Rendered"
            : somePlatesRendered
              ? `${renderedPlateCount} of ${segment.plates.length} plates rendered`
              : "Not rendered yet"}
        </span>
      </div>

      {expanded && (
        <div className="px-3 pb-3">
          <SkidmarksClipStub
            segment={segment}
            band={band}
            previousStill={previousStill}
            onSetShotPrompt={onSetShotPrompt}
            onSetNegativePrompt={onSetNegativePrompt}
            onSetPlateStill={onSetPlateStill}
            onAddPlate={onAddPlate}
            onRemovePlate={onRemovePlate}
            onSelectPlate={onSelectPlate}
            onSetPlateMotionPrompt={onSetPlateMotionPrompt}
            onSetPlateLastSent={onSetPlateLastSent}
            onSetClipInstrumentalModel={onSetInstrumentalModel}
            renderedPlateIds={renderedPlateIds}
            renderLocked={renderLocked}
            onRenderStart={onRenderStart}
            onRenderEnd={onRenderEnd}
            clipIndex={clipIndex}
            onPersisted={onPersisted}
            mp3AudioUrl={mp3AudioUrl}
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

/** `${segmentId}:${plateId}` — mirrors `lib/clipRenders.ts`'s
 * `persistedRenderKey`, used here for the "one render at a time"
 * cost-lock key instead of just a segment id (two different plates on
 * the *same* clip must still serialize — Render is one control per
 * clip at a time either way, but the lock itself is now correctly
 * scoped to the plate actually rendering). */
function renderKey(segmentId: string, plateId: string): string {
  return `${segmentId}:${plateId}`;
}

/**
 * The clip/segment timeline — appended right under the MP3 checklist
 * once an MP3 exists. `segments` prefers real word-level transcription
 * (`transcribeAudio`/`segmentsFromWords` in `lib/transcription.ts`,
 * `segmentsSource === "transcription"`) whenever it lands; short of
 * that, real output from the energy heuristic
 * (`analyzeVocalActivity`, `segmentsSource === "analysis"`); short of
 * that (still resolving, or both failed/unconfigured), this instead
 * shows `buildDemoSegments`' deterministic seed cadence.
 *
 * Each row is individually collapsible (collapsed = time range + label
 * only, no model glance — per Stuart's live-QA chrome lock there is no
 * model UI anywhere in this build right now, see `SkidmarksClipStub`'s
 * doc comment; expanded = `SkidmarksClipStub`'s horizontal **plate
 * strip** plus one shared shot-prompt field, plus the one selected
 * plate's Render control). This component threads `band`, each clip's
 * `previousStill`, and (new) the whole-song render map down to
 * `SkidmarksClipStub` — but never touches any of them itself.
 *
 * **The whole-song "Generate Clips" stub button is gone** (removed
 * 2026-09-14, Stuart's explicit ask — "It does nothing useful and
 * confuses him"). It never called a real render for the whole song; it
 * only showed a "stub, not wired" message, which was itself the
 * problem — a pink, primary-looking button that did nothing real reads
 * as broken, not as an honest placeholder. **This does not change
 * anything about whole-song auto-render staying explicitly out of
 * scope** — per AGENTS.md's cost lock, that's still not something to
 * build without its own explicit product sign-off; removing the stub
 * button is not the same ask as wiring it up. Each individual plate's
 * own opt-in Render control (`SkidmarksClipStub`/
 * `components/SkidmarksClipRender.tsx`) is unaffected.
 *
 * **The "which plates already have a saved render" lookup, and the
 * rendered-clips player/download surface, both moved out of this
 * component** — see `hooks/useSkidmarksClipRenders.ts` (now owned by
 * `SkidmarksDetailSheet`, shared with `SkidmarksRenderedClipsShelf`)
 * and that shelf component itself. This component only reads the
 * already-fetched `renders` map (via the `renders` prop) to compute
 * each clip's `renderedPlateIds` for its own tick marks and one-
 * render-at-a-time lock — it never fetches or downloads anything on its
 * own anymore.
 *
 * **Auto-plate**: removed from this music-video clip / segment list
 * UI (button + calls). `lib/autoPlate.ts` and `SkidmarksAutoPlate.tsx`
 * stay in the repo for other / future use — do not delete them from here.
 *
 * **Clip start/end edit** (2026-09-13, revised same day): each row's
 * own always-visible header — "0:00–0:32" next to the label pill —
 * *is* the editing surface now, via `SkidmarksClipTimingHeaderEdit`:
 * double-tap either number to edit it in place. This replaced a
 * compact −1s/+1s stepper (`SkidmarksClipTimingNudge`, deleted) that
 * lived inside the expanded body — Stuart's direct follow-up ask,
 * "I hate seeing big buttons like this and wasting great real estate,"
 * on the very same feature the stepper shipped for (ElevenLabs Scribe
 * timing lands close but "sometimes 3-4 seconds off"). The underlying
 * store setters (`nudgeSkidmarksSegmentStart`/`nudgeSkidmarksSegmentEnd`,
 * `lib/skidmarks.ts`) are unchanged and already clamp *any* delta
 * against the song's bounds and the neighboring clip's boundary — so,
 * unlike the old stepper, this component doesn't need to precompute a
 * `canNudge*` flag per direction at all; typing an out-of-range value
 * just clamps to the nearest real bound the same way the old buttons
 * did at their own limits. A nudge still only ever edits local
 * `startSec`/`endSec` values already on `segments`; it never re-calls
 * ElevenLabs or the energy heuristic, and never touches
 * `segmentsSource`.
 */
export function SkidmarksClipTimeline({
  segments,
  segmentsSource,
  analysisStatus,
  transcriptionStatus,
  band,
  mp3AudioUrl,
  renders,
  onPersisted,
  onSetSegmentShotPrompt,
  onSetSegmentNegativePrompt,
  onSetClipPlateStill,
  onAddClipPlate,
  onRemoveClipPlate,
  onSelectClipPlate,
  onSetClipPlateMotionPrompt,
  onSetClipPlateLastSent,
  onSetClipInstrumentalModel,
  onNudgeSegmentStart,
  onNudgeSegmentEnd,
  chainNote,
  onDismissChainNote,
}: SkidmarksClipTimelineProps) {
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Which single (segmentId, plateId) pair, if any, is currently
  // mid-render — the literal enforcement of Stuart's "one render at a
  // time" cost lock across the *whole* timeline. See
  // `SkidmarksClipRender`'s doc comment.
  const [renderingKey, setRenderingKey] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          {note && (
            <p className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-100">
              {note}
            </p>
          )}

          {chainNote && (
            <div
              role={chainNote.ok ? "status" : "alert"}
              className={[
                "flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed",
                chainNote.ok
                  ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-200/85"
                  : "border-rose-400/25 bg-rose-400/[0.06] text-rose-200/85",
              ].join(" ")}
            >
              <span>{chainNote.message}</span>
              {onDismissChainNote && (
                <button
                  type="button"
                  onClick={onDismissChainNote}
                  aria-label="Dismiss"
                  className="shrink-0 opacity-70 hover:opacity-100"
                >
                  ×
                </button>
              )}
            </div>
          )}


          <div className="flex flex-col gap-2">
            {segments.map((segment, i) => {
              const previousPlates = i > 0 ? segments[i - 1].plates : undefined;
              const previousStill = previousPlates?.[previousPlates.length - 1]?.still;
              const renderedPlateIds = new Set(
                segment.plates.filter((p) => renders.has(renderKey(segment.id, p.id))).map((p) => p.id)
              );
              return (
                <SegmentRow
                  key={segment.id}
                  segment={segment}
                  band={band}
                  previousStill={previousStill}
                  expanded={expandedIds.has(segment.id)}
                  onToggle={() => toggleExpanded(segment.id)}
                  onSetShotPrompt={(shotPrompt) => onSetSegmentShotPrompt(segment.id, shotPrompt)}
                  onSetNegativePrompt={(negativePrompt) => onSetSegmentNegativePrompt(segment.id, negativePrompt)}
                  onSetPlateStill={(plateId, still) => onSetClipPlateStill(segment.id, plateId, still)}
                  onAddPlate={() => onAddClipPlate(segment.id)}
                  onRemovePlate={(plateId) => onRemoveClipPlate(segment.id, plateId)}
                  onSelectPlate={(plateId) => onSelectClipPlate(segment.id, plateId)}
                  onSetPlateMotionPrompt={(plateId, motionPrompt) =>
                    onSetClipPlateMotionPrompt(segment.id, plateId, motionPrompt)
                  }
                  onSetPlateLastSent={(plateId, sent) => onSetClipPlateLastSent(segment.id, plateId, sent)}
                  onSetInstrumentalModel={(model) => onSetClipInstrumentalModel(segment.id, model)}
                  onNudgeStart={(deltaSec) => onNudgeSegmentStart(segment.id, deltaSec)}
                  onNudgeEnd={(deltaSec) => onNudgeSegmentEnd(segment.id, deltaSec)}
                  renderedPlateIds={renderedPlateIds}
                  renderLocked={
                    renderingKey !== null &&
                    !segment.plates.some((p) => renderKey(segment.id, p.id) === renderingKey)
                  }
                  onRenderStart={(plateId) => setRenderingKey(renderKey(segment.id, plateId))}
                  onRenderEnd={(plateId) => {
                    setRenderingKey((current) => (current === renderKey(segment.id, plateId) ? null : current));
                  }}
                  clipIndex={i + 1}
                  onPersisted={onPersisted}
                  mp3AudioUrl={mp3AudioUrl}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
