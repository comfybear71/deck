"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatSegmentRange,
  SKIDMARKS_SEGMENT_LABEL_META,
  type SkidmarksAnalysisStatus,
  type SkidmarksBand,
  type SkidmarksClipSegment,
  type SkidmarksPlateStill,
  type SkidmarksSegmentsSource,
  type SkidmarksTranscriptionStatus,
} from "@/lib/skidmarks";
import { type SkidmarksTranscriptionProvider } from "@/lib/transcription";
import {
  buildForceDownloadUrl,
  buildRendersZip,
  fetchPersistedClipRenders,
  toBundleEntries,
  triggerAnchorDownload,
  triggerBlobDownload,
  type PersistedClipRender,
} from "@/lib/clipRenders";
import { SkidmarksClipStub } from "./SkidmarksClipStub";

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
  onSetSegmentShotPrompt: (segmentId: string, shotPrompt: string) => void;
  onSetClipPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill | null) => void;
  onAddClipPlate: (segmentId: string) => void;
  onRemoveClipPlate: (segmentId: string, plateId: string) => void;
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
  band,
  previousStill,
  expanded,
  onToggle,
  onSetShotPrompt,
  onSetPlateStill,
  onAddPlate,
  onRemovePlate,
  renderLocked,
  onRenderStart,
  onRenderEnd,
  clipIndex,
  persistedRender,
  onPersisted,
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
  onSetPlateStill: (plateId: string, still: SkidmarksPlateStill | null) => void;
  onAddPlate: () => void;
  onRemovePlate: (plateId: string) => void;
  /** Whether a *different* clip on this timeline is currently rendering
   * a real video — see `SkidmarksClipTimeline`'s `renderingSegmentId`
   * state and `SkidmarksClipRender`'s doc comment for the "one render
   * at a time" cost lock this enforces. */
  renderLocked: boolean;
  onRenderStart: () => void;
  onRenderEnd: () => void;
  /** This clip's 1-based position in the timeline — see
   * `SkidmarksClipStub`'s doc comment for what it's used for. */
  clipIndex: number;
  persistedRender?: PersistedClipRender | null;
  onPersisted: (render: PersistedClipRender) => void;
}) {
  const meta = SKIDMARKS_SEGMENT_LABEL_META[segment.label];

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
      </div>

      {expanded && (
        <div className="px-3 pb-3">
          <SkidmarksClipStub
            segment={segment}
            band={band}
            previousStill={previousStill}
            onSetShotPrompt={onSetShotPrompt}
            onSetPlateStill={onSetPlateStill}
            onAddPlate={onAddPlate}
            onRemovePlate={onRemovePlate}
            renderLocked={renderLocked}
            onRenderStart={onRenderStart}
            onRenderEnd={onRenderEnd}
            clipIndex={clipIndex}
            persistedRender={persistedRender}
            onPersisted={onPersisted}
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
 * structure for Stuart to assign a shot prompt to regardless of which
 * source is showing.
 *
 * Each row is individually collapsible (collapsed = time range + label
 * only, no model glance — per Stuart's live-QA chrome lock there is no
 * model UI anywhere in this build right now, see `SkidmarksClipStub`'s
 * doc comment; expanded = `SkidmarksClipStub`'s horizontal **plate
 * strip** — one or more independent still slots on this same clip,
 * each upload/generate/replace/clear-able in place, plus a "+" to add
 * another slot (see that component's doc comment for why one clip can
 * hold several plates — the 40s-door problem) — + one multi-line
 * shot-prompt field **shared across every plate on that clip**, nothing
 * else — the Camera Angles block, the five-card location-plate picker,
 * and the Model pill row from earlier passes are all gone outright).
 * This component threads `band` and each clip's `previousStill` (that
 * *previous clip's* **last** plate, specifically — only relevant to
 * *this* clip's first plate slot; later slots continue from the plate
 * before them in their own strip instead) down to `SkidmarksClipStub` —
 * the former resolves which member auto-includes as the vocalist on a
 * Vocal clip, the latter is the "continue from the previous plate"
 * continuity reference — but never touches either itself. The whole
 * section can also collapse, same pattern as `ControlPlaneDemo`.
 *
 * **Phase note**: the footer's **"Generate Clips" button below stays a
 * deliberate stub** — tapping it never calls a real render for the whole
 * song; it only shows a "stub, not wired" message, surfaced in an
 * always-mounted `role="status"` + `aria-live` line so assistive tech
 * reaches it too, not just sighted users. That's a different thing from
 * each individual clip's own render control, though: `SkidmarksClipStub`
 * (via `components/SkidmarksClipRender.tsx`) now offers a real, opt-in,
 * one-clip-at-a-time video render off a clip's already-generated/
 * uploaded plate still(s) — see that component's doc comment and
 * `app/api/skidmarks/generate-clip/route.ts`. **This is where the real
 * cost lives, per Stuart**: a real plate *still* image (one frame) is
 * cheap; a real *video render/animate* pass is the expensive part —
 * which is exactly why this footer button (render the *entire song* in
 * one tap, no confirm) stays stubbed regardless of the per-clip control
 * existing, and why that per-clip control is cost-capped (fixed 5s/480p)
 * and gated behind an explicit two-tap confirm rather than reachable
 * from here. Seedance's multi-angle clip generation specifically also
 * stays entirely unwired either way — this render pass only ever calls
 * xAI, never Seedance.
 *
 * **Owns the "which clips already have a saved render" lookup for the
 * whole timeline**, not just whichever row happens to be expanded —
 * fetched once (`fetchPersistedClipRenders`, `lib/clipRenders.ts`) for
 * every clip id on mount and whenever the *set* of clip ids changes
 * (a fresh MP3 attach), not on every keystroke. This is what lets
 * `SkidmarksClipStub`/`SkidmarksClipRender` show a saved render right
 * away after a refresh even before that clip's row has ever been
 * expanded in this session, and is also what backs the **"Download
 * rendered clips"** control below the stub "Generate Clips" button —
 * only shows up once at least one clip has a persisted render, and
 * bundles every currently-known one into a single ZIP (built entirely
 * client-side, `lib/zipDownload.ts` — no server round trip, no paid API
 * call) named with this feature's own numeric convention, falling back
 * to plain sequential per-clip downloads if the zip step itself fails
 * for any reason (a real CORS regression, an expired/deleted blob) —
 * the task's own explicit "otherwise sequential downloads... is OK for
 * v1" escape hatch. This is deliberately a second, separate surface
 * from each clip's own single-render Download link (never the same
 * button): grabbing every rendered clip at once is a "get this whole
 * batch off my phone" action, not a per-clip one.
 */
export function SkidmarksClipTimeline({
  segments,
  segmentsSource,
  analysisStatus,
  transcriptionStatus,
  band,
  onSetSegmentShotPrompt,
  onSetClipPlateStill,
  onAddClipPlate,
  onRemoveClipPlate,
}: SkidmarksClipTimelineProps) {
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [stubMessage, setStubMessage] = useState<string | null>(null);
  const stubMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which single clip (if any) is currently mid-render — the literal
  // enforcement of Stuart's "one render at a time" cost lock across the
  // *whole* timeline, not just within one clip's own panel. See
  // `SkidmarksClipRender`'s doc comment.
  const [renderingSegmentId, setRenderingSegmentId] = useState<string | null>(null);
  // What's currently known to be durably persisted, per clip id — see
  // this component's doc comment. `undefined` while the initial lookup
  // for a given clip is still in flight (or hasn't started yet);
  // absent from the map once resolved with nothing saved for that clip.
  const [persistedRenders, setPersistedRenders] = useState<Map<string, PersistedClipRender>>(new Map());
  const [bundleState, setBundleState] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });

  const segmentIdsKey = useMemo(() => segments.map((s) => s.id).join(","), [segments]);

  useEffect(() => {
    const segmentIds = segmentIdsKey ? segmentIdsKey.split(",") : [];
    if (segmentIds.length === 0) return;
    let cancelled = false;
    fetchPersistedClipRenders(segmentIds).then((outcome) => {
      if (cancelled || !outcome.ok) return;
      setPersistedRenders((prev) => {
        const next = new Map(prev);
        for (const render of outcome.renders) next.set(render.segmentId, render);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // Re-fetches when the *set* of clip ids changes (a fresh MP3
    // attach), not on every shot-prompt keystroke — `segmentIdsKey` is
    // stable across an edit to an existing segment's own fields.
  }, [segmentIdsKey]);

  const handlePersisted = (render: PersistedClipRender) => {
    setPersistedRenders((prev) => {
      const next = new Map(prev);
      next.set(render.segmentId, render);
      return next;
    });
  };

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

  const renderedClips = Array.from(persistedRenders.values());

  const handleDownloadRenderedClips = async () => {
    if (renderedClips.length === 0 || bundleState.busy) return;
    setBundleState({ busy: true, message: null });

    if (renderedClips.length === 1) {
      const [only] = toBundleEntries(renderedClips);
      triggerAnchorDownload(buildForceDownloadUrl(only.url), only.filename);
      setBundleState({ busy: false, message: null });
      return;
    }

    const zipOutcome = await buildRendersZip(renderedClips);
    if (zipOutcome.ok) {
      const zipBlob = new Blob([zipOutcome.zipBytes.slice().buffer], { type: "application/zip" });
      triggerBlobDownload(zipBlob, "skidmarks-renders.zip");
      setBundleState({ busy: false, message: null });
      return;
    }

    // Zip build failed (a real CORS regression, an expired/deleted
    // blob) — fall back to plain sequential per-clip downloads, staggered
    // so the browser doesn't treat a tight burst of clicks as a popup
    // storm. Per the task's own explicit "sequential downloads with
    // numeric names is OK for v1" fallback.
    for (const entry of toBundleEntries(renderedClips)) {
      triggerAnchorDownload(buildForceDownloadUrl(entry.url), entry.filename);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    setBundleState({
      busy: false,
      message: `Couldn't bundle these into a zip (${zipOutcome.message}) \u2014 downloaded them one by one instead.`,
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
          {note && <p className="text-[11px] leading-relaxed text-amber-200/70">{note}</p>}

          <div className="flex flex-col gap-2">
            {segments.map((segment, i) => {
              const previousPlates = i > 0 ? segments[i - 1].plates : undefined;
              const previousStill = previousPlates?.[previousPlates.length - 1]?.still;
              return (
                <SegmentRow
                  key={segment.id}
                  segment={segment}
                  band={band}
                  previousStill={previousStill}
                  expanded={expandedIds.has(segment.id)}
                  onToggle={() => toggleExpanded(segment.id)}
                  onSetShotPrompt={(shotPrompt) => onSetSegmentShotPrompt(segment.id, shotPrompt)}
                  onSetPlateStill={(plateId, still) => onSetClipPlateStill(segment.id, plateId, still)}
                  onAddPlate={() => onAddClipPlate(segment.id)}
                  onRemovePlate={(plateId) => onRemoveClipPlate(segment.id, plateId)}
                  renderLocked={renderingSegmentId !== null && renderingSegmentId !== segment.id}
                  onRenderStart={() => setRenderingSegmentId(segment.id)}
                  onRenderEnd={() => setRenderingSegmentId((current) => (current === segment.id ? null : current))}
                  clipIndex={i + 1}
                  persistedRender={persistedRenders.get(segment.id) ?? null}
                  onPersisted={handlePersisted}
                />
              );
            })}
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

          {/* A second, deliberately separate surface from any one clip's
              own Download link — grabbing every already-rendered clip at
              once, per the task's "phone \u2192 PC" cross-device ask.
              Renders nothing at all until at least one clip actually has
              a saved render \u2014 same "don't show a control for state that
              doesn't exist yet" pattern as `SkidmarksClipRender` itself. */}
          {renderedClips.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-white/[0.06] pt-3">
              <button
                type="button"
                onClick={handleDownloadRenderedClips}
                disabled={bundleState.busy}
                aria-disabled={bundleState.busy}
                className={[
                  "rounded-full px-4 py-2.5 text-center text-[13px] font-semibold transition-colors",
                  bundleState.busy
                    ? "cursor-not-allowed bg-white/[0.04] text-white/30"
                    : "border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]",
                ].join(" ")}
              >
                {bundleState.busy
                  ? "Bundling\u2026"
                  : `Download rendered clip${renderedClips.length > 1 ? "s" : ""} (${renderedClips.length})`}
              </button>
              {bundleState.message && (
                <p role="status" aria-live="polite" className="text-[10px] leading-snug text-white/40">
                  {bundleState.message}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
