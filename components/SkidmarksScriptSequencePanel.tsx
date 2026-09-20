"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import {
  buildScriptSequenceHighlightSegments,
  formatScriptSequencePartTitles,
  parseScriptSequence,
  SCRIPT_SEQUENCE_COLOUR_TAGS,
  SCRIPT_SEQUENCE_HIGHLIGHT_CLASSES,
} from "@/lib/scriptSequence";
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
  isGeneratePlatesButtonDisabled,
  parseScriptPartKind,
  plateStillCountsAsReady,
  runAnimateExistingPlates,
  runGeneratePlates,
  type AnimateExistingPlatesDeps,
  type AnimateExistingPlatesEvent,
  type AnimateExistingPlatesTarget,
  type GeneratePlatesDeps,
  type GeneratePlatesEvent,
  type GeneratePlatesTarget,
  type IdentitySafeScriptPart,
} from "@/lib/scriptSequenceRunner";
import { findPersistedRenderForClip, type PersistedClipRender } from "@/lib/clipRenders";

/** Native file picker's accept list — jpg/png/webp only, matches every
 * other photo picker in this feature. */
const STARTING_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

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
   * `(segmentId, plateId)` (and time-range fallback) — the same map
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

function platesProgressLabel(event: GeneratePlatesEvent): string {
  switch (event.type) {
    case "resolving-place":
      return `Building clip ${event.clipIndex + 1} of ${event.clipCount}'s scene…`;
    case "generating-plate":
      return `Placing the artist into clip ${event.clipIndex + 1} of ${event.clipCount}'s scene…`;
    case "plate-done":
      return `Plate ${event.clipIndex + 1} of ${event.clipCount} ready.`;
    case "plate-skipped":
      return event.reason === "video"
        ? `Clip ${event.clipIndex + 1} of ${event.clipCount} already has a finished video — left alone.`
        : `Clip ${event.clipIndex + 1} of ${event.clipCount} already has a plate — left alone.`;
  }
}

function animateProgressLabel(event: AnimateExistingPlatesEvent): string {
  switch (event.type) {
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
 * `runGeneratePlates` / `runAnimateExistingPlates` together with this feature's real backends
 * (xAI stills, Comfy Cloud LTX, MiniMax H3/Grok) — no new AI provider.
 *
 * **Plate-first workflow (2026-09-19):** "Generate plates" builds every
 * *missing* clip's still only (`runGeneratePlates` — place + identity, no
 * video). Skips clips that already have a good still or a finished video
 * — never rebuilds/overwrites them. Stays enabled even when Resume shows
 * for an incomplete animate run. "Generate" / Resume then animates plates
 * that already exist (`runAnimateExistingPlates`) — refuses a clip with
 * no plate still. Neither path chains last frames (identity-safe).
 * `runScriptSequence` and its Jack-Ash scene-block-chaining coverage stay
 * untouched.
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
 * anything. That pre-fill is a locked-character avatar preview only —
 * `plateStillCountsAsReady` does not treat it as a finished plate, so
 * Generate plates still builds a real place + identity composite for
 * those slots. Real stills and finished videos are left alone.
 *
 * **Clip 1 starting-image upload (restored)**: optional. When set, the
 * identity-safe runner uses that durable Blob URL as clip 1's image 1
 * and does **not** overwrite it with a place+identity composite. Clips
 * 2+ stay identity-safe (fresh composite every time; no last-frame
 * chaining). Persisted on `scriptSequenceDraft.startingImageUrl`.
 */
/** Highlight overlay behind the (transparent) script textarea — same
 * chrome pattern as Sunny Banks' God Script box, but colours MV part
 * Part / type / Duration / Prompt-label fields. Display-only; never changes parsing. */
function ScriptSequenceHighlightOverlay({
  text,
  overlayRef,
}: {
  text: string;
  overlayRef: RefObject<HTMLDivElement | null>;
}) {
  const segments = buildScriptSequenceHighlightSegments(text);
  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-relaxed"
    >
      {segments.map((segment, index) => (
        <span key={index} className={SCRIPT_SEQUENCE_HIGHLIGHT_CLASSES[segment.kind]}>
          {segment.text}
        </span>
      ))}
      {text.endsWith("\n") ? <span>{"\u200b"}</span> : null}
    </div>
  );
}

/**
 * Full-screen script editor — draft buffer, then Apply. Mirrors Sunny
 * Banks' full-screen God Script flow: nothing touches the live draft
 * until Apply, so mid-edit keystrokes don't remint the clip timeline.
 * Format here only rewrites header type words on the local draft.
 */
function ScriptSequenceFullScreenEditor({
  initialText,
  onApply,
  onClose,
}: {
  initialText: string;
  onApply: (next: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dirty = draft !== initialText;

  const handleCancel = () => {
    if (dirty && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={handleCancel}
          className="min-h-[44px] shrink-0 px-1 text-[13px] font-medium text-white/60"
        >
          {confirmingDiscard ? "Discard?" : "Cancel"}
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-[12px] font-semibold text-white/80">
          {dirty ? "Editing — not saved yet" : "Script sequence"}
        </span>
        <button
          type="button"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
          className="min-h-[44px] shrink-0 rounded-md bg-rose-400 px-4 text-[13px] font-semibold text-zinc-950"
        >
          Apply
        </button>
      </div>

      {confirmingDiscard && (
        <p role="alert" className="border-b border-white/10 px-3 py-2 text-[11px] leading-snug text-rose-300/90">
          Tap Discard again to throw these edits away, or Apply to keep them.
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        <ScriptSequenceHighlightOverlay text={draft} overlayRef={overlayRef} />
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setConfirmingDiscard(false);
          }}
          onScroll={(e) => {
            if (overlayRef.current) {
              overlayRef.current.scrollTop = e.currentTarget.scrollTop;
              overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          autoFocus
          spellCheck={false}
          aria-label="Script sequence full screen editor"
          className="relative z-10 h-full w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-transparent caret-rose-300 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={() => setDraft((prev) => formatScriptSequencePartTitles(prev))}
          disabled={!draft.trim()}
          className="min-h-[40px] shrink-0 rounded-md bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
        >
          {"\u21e5"} Format
        </button>
        <p className="min-w-0 flex-1 text-[10px] leading-snug text-white/40">
          Nothing remints until you tap Apply. Format only fixes Vocal/Instrumental headers and Prompt labels —
          shot prose stays as written.
        </p>
      </div>
    </div>
  );
}

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
  const [running, setRunning] = useState<"plates" | "render" | false>(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  /** Real ask (2026-09-16): a way to interrupt a long "Generate & render
   * all" batch the moment a render looks wrong, so it stops spending
   * real credits on the rest instead of burning through every remaining
   * clip first. A plain ref, not state — the runner reads it
   * synchronously via `shouldStop` between clips. Reset at the start of
   * each run. */
  const stopRequestedRef = useRef(false);
  /** Whether a starting-image pick is mid-upload right now — purely a
   * local spinner label, never needs to survive a reload the way the
   * uploaded URL itself does (`scriptSequenceDraft.startingImageUrl`),
   * so this stays plain `useState` unlike the draft fields above it. */
  const [startingImagePicking, setStartingImagePicking] = useState(false);
  const [startingImageError, setStartingImageError] = useState<string | null>(null);
  const startingImageInputRef = useRef<HTMLInputElement | null>(null);
  /** One-level undo for the script box (Format / Full-screen Apply). */
  const [scriptUndo, setScriptUndo] = useState<string | null>(null);
  const [fullScreenScriptOpen, setFullScreenScriptOpen] = useState(false);
  const scriptHighlightRef = useRef<HTMLDivElement | null>(null);

  const script = scriptSequenceDraft?.script ?? "";
  const startingImageUrl = scriptSequenceDraft?.startingImageUrl;
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
      if (!plate) return true;
      return !findPersistedRenderForClip(
        renders,
        segment.id,
        plate.id,
        segment.startSec,
        segment.endSec
      );
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

  /** Script-text only — never calls ensureTimeline / onSetScriptSequence,
   * so Format / Full-screen Apply cannot remint clips or wipe plates.
   * Timeline rebuild stays on Timeline / Generate plates / Generate, which
   * already use remint-safe `buildScriptSequenceSegments`. */
  const applyScriptText = (next: string, captureUndo: boolean) => {
    if (next === script) return;
    if (captureUndo) setScriptUndo(script);
    onSetScriptSequenceDraft({ script: next, startingImageUrl });
  };

  const handleFormatScript = () => {
    if (running) return;
    const formatted = formatScriptSequencePartTitles(script);
    applyScriptText(formatted, true);
  };

  const handleUndoScript = () => {
    if (scriptUndo === null || running) return;
    onSetScriptSequenceDraft({ script: scriptUndo, startingImageUrl });
    setScriptUndo(null);
  };

  const handleFullScreenApply = (next: string) => {
    applyScriptText(next, true);
  };

  const buildPlatesDeps = (): GeneratePlatesDeps => ({
    resolvePlaceStill: async (sceneText, bandName) => {
      const placeOutcome = await resolveLocationStill({ sceneText, bandName });
      return placeOutcome.ok
        ? { ok: true, dataUrl: placeOutcome.dataUrl! }
        : { ok: false, message: placeOutcome.message ?? "Couldn't build this clip's scene." };
    },
    generateIdentityStill: async ({ shotPrompt, bandName, vocal, vocalist, locationStillDataUrl }) => {
      const photo = vocalist.avatarImage?.trim();
      if (!photo) {
        return {
          ok: false,
          message: `${vocalist.name || "The artist"}'s photo is missing — refusing to invent a face.`,
        };
      }
      const request = buildPlateGenerationRequest({
        shotPrompt,
        vocal,
        model: vocal ? "ltx-lipsync" : "grok",
        bandName,
        vocalist,
        locationStillDataUrl,
      });
      // Fail closed: Intro/Instrumental used to drop the identity ref inside
      // resolvePlateIdentity; never send a costume-only invent-a-face request.
      if (!request.referenceImageDataUrls.includes(photo)) {
        return {
          ok: false,
          message: `${vocalist.name || "The artist"}'s photo was not attached as the identity reference — refusing to invent a face.`,
        };
      }
      const stillOutcome = await generatePlateStill(request);
      return stillOutcome.ok ? { ok: true, dataUrl: stillOutcome.dataUrl } : { ok: false, message: stillOutcome.message };
    },
    uploadStill: uploadSkidmarksPlateStill,
    setPlateStill: onSetClipPlateStill,
    onProgress: (event) => setProgressText(platesProgressLabel(event)),
  });

  const buildAnimateDeps = (): AnimateExistingPlatesDeps => ({
    renderClip: async (request) => {
      const clipOutcome = await generateSkidmarksClip(request);
      if (!clipOutcome.ok) return { ok: false, message: clipOutcome.message };
      // Deliberately drops `clipOutcome.lastFrameUrl` — animate path
      // never chains a render's last frame into the next plate.
      return { ok: true, videoUrl: clipOutcome.videoUrl, persisted: clipOutcome.persisted, persistError: clipOutcome.persistError };
    },
    recordRender: onRecordRender,
    onProgress: (event) => setProgressText(animateProgressLabel(event)),
  });

  const reportPlatesOutcome = (outcome: Awaited<ReturnType<typeof runGeneratePlates>>) => {
    setResult(
      outcome.ok
        ? {
            ok: true,
            message:
              outcome.platedCount === 0 && outcome.skippedCount > 0
                ? `All ${outcome.skippedCount} plates already ready — nothing new to build. Tap Generate to animate.`
                : outcome.skippedCount > 0
                  ? `Built ${outcome.platedCount} missing plate${outcome.platedCount === 1 ? "" : "s"} (${outcome.skippedCount} already had a still or video) — review the thumbnails, then tap Generate to animate.`
                  : `All ${outcome.platedCount} plates ready — review the thumbnails, then tap Generate to animate.`,
          }
        : !outcome.ok && outcome.stopped
          ? { ok: true, message: `Stopped — ${outcome.platedCount} plate${outcome.platedCount === 1 ? "" : "s"} built before you stopped it. Nothing else was spent.` }
          : {
              ok: false,
              message: `Stopped at clip ${outcome.failedAtClipIndex + 1} (${outcome.platedCount} plate${outcome.platedCount === 1 ? "" : "s"} so far): ${outcome.message}`,
            }
    );
  };

  const reportRenderOutcome = (outcome: Awaited<ReturnType<typeof runAnimateExistingPlates>>) => {
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

  const buildIdentityParts = (): IdentitySafeScriptPart[] =>
    parts.map((part, i) => ({
      shotPrompt: part.prompt,
      startSec: part.startSec,
      endSec: part.endSec,
      kind: partKinds[i].kind,
      otherSingerName: partKinds[i].otherSingerName,
    }));

  const ensureTimeline = (): SkidmarksClipSegment[] => {
    const alreadyBuilt = realSegments.length === parts.length;
    const segments = alreadyBuilt ? realSegments : buildScriptSequenceSegments(parts, realSegments);
    if (!alreadyBuilt) {
      onSetScriptSequence(segments);
      flushSkidmarksSessionNow();
    }
    return segments;
  };

  /** Plates-only pass — stills for every clip, no video. */
  const handleGeneratePlates = async () => {
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
    setRunning("plates");
    setResult(null);
    setProgressText("Starting plates…");

    let segments = ensureTimeline();

    const memberAvatarUrls = band.members
      .map((m) => m.avatarImage)
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0);

    const clip0Plate = segments[0]?.plates[0];
    const clip0Ready =
      !!clip0Plate &&
      (!!findPersistedRenderForClip(
        renders,
        segments[0].id,
        clip0Plate.id,
        segments[0].startSec,
        segments[0].endSec
      ) ||
        plateStillCountsAsReady(clip0Plate.still, memberAvatarUrls));

    // Mirror clip-1 upload onto the plate only when clip 1 still needs a
    // plate — never overwrite a good still or a finished video.
    if (startingImageUrl && !clip0Ready && segments[0]?.plates[0]) {
      const startingStill: SkidmarksPlateStill = {
        dataUrl: startingImageUrl,
        source: "upload",
        createdAt: Date.now(),
      };
      segments = segments.map((segment, i) =>
        i === 0
          ? { ...segment, plates: [{ ...segment.plates[0], still: startingStill }, ...segment.plates.slice(1)] }
          : segment
      );
      onSetClipPlateStill(segments[0].id, segments[0].plates[0].id, startingStill);
      flushSkidmarksSessionNow();
    }

    // Skip detection must not rely on reminted segment ids alone — match
    // finished videos by startSec/endSec too (see findPersistedRenderForClip).
    // Stills ride on the segment after buildScriptSequenceSegments re-attach.
    const targets: GeneratePlatesTarget[] = segments.map((segment) => {
      const plate = segment.plates[0];
      const plateId = plate?.id ?? "";
      const hasFinishedVideo = !!(
        plate &&
        findPersistedRenderForClip(renders, segment.id, plateId, segment.startSec, segment.endSec)
      );
      const existingPlateStillUrl =
        !hasFinishedVideo && plateStillCountsAsReady(plate?.still, memberAvatarUrls)
          ? plate?.still?.dataUrl
          : undefined;
      return { segmentId: segment.id, plateId, existingPlateStillUrl, hasFinishedVideo };
    });

    const outcome = await runGeneratePlates(
      buildIdentityParts(),
      targets,
      band.name,
      resolveVocalistForPrompt(band.members),
      band.members,
      buildPlatesDeps(),
      0,
      () => stopRequestedRef.current,
      // Only pass clip-1 upload when clip 1 still needs a plate.
      clip0Ready ? undefined : startingImageUrl
    );

    flushSkidmarksSessionNow();
    setRunning(false);
    setProgressText(null);
    reportPlatesOutcome(outcome);
  };

  /** Animate existing plates only — refuses a clip with no plate still. */
  const runAnimateFrom = async (segments: SkidmarksClipSegment[], startAtClipIndex: number) => {
    stopRequestedRef.current = false;
    setRunning("render");
    setResult(null);
    setProgressText(startAtClipIndex > 0 ? `Resuming at clip ${startAtClipIndex + 1} of ${segments.length}…` : "Starting…");

    const targets: AnimateExistingPlatesTarget[] = segments.map((segment) => ({
      segmentId: segment.id,
      plateId: segment.plates[0]?.id ?? "",
      plateStillUrl: segment.plates[0]?.still?.dataUrl,
    }));

    const outcome = await runAnimateExistingPlates(
      buildIdentityParts(),
      targets,
      band.name,
      resolveVocalistForPrompt(band.members),
      band.members,
      mp3AudioUrl,
      buildAnimateDeps(),
      startAtClipIndex,
      () => stopRequestedRef.current
    );

    flushSkidmarksSessionNow();
    setRunning(false);
    setProgressText(null);
    reportRenderOutcome(outcome);
  };

  const handleResume = async () => {
    if (running || !incompleteRun) return;
    await runAnimateFrom(realSegments, incompleteRun.resumeIndex);
  };

  /**
   * Real reported ask (2026-09-15): build the whole clip timeline and,
   * for a *locked* character only, pre-fill every plate with their fixed
   * reference photo — before any rendering or any money is spent — so
   * Stuart can scroll through and see the timeline shape first. Purely a
   * preview (avatar URL + featuresLockedCharacter) — Generate plates does
   * not treat those as finished plates and still builds real place +
   * identity composites for empty / preview slots.
   */
  const handleBuildTimeline = () => {
    if (running || parts.length === 0) return;

    // Re-attach existing stills/videos by time via buildScriptSequenceSegments —
    // never wipe plated ranges when the script grows or Build timeline re-runs.
    const segments = buildScriptSequenceSegments(parts, realSegments);
    onSetScriptSequence(segments);

    const memberAvatarUrls = band.members
      .map((m) => m.avatarImage)
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0);

    const vocalist = resolveVocalistForPrompt(band.members);
    const lock = vocalist ? getSkidmarksCharacterLock(vocalist) : undefined;
    if (lock && vocalist?.avatarImage) {
      for (const segment of segments) {
        const plate = segment.plates[0];
        if (!plate) continue;
        // Leave real stills and finished videos alone — preview is only for empty slots.
        if (plateStillCountsAsReady(plate.still, memberAvatarUrls)) continue;
        if (findPersistedRenderForClip(renders, segment.id, plate.id, segment.startSec, segment.endSec)) {
          continue;
        }
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
        ? `Timeline built — all ${segments.length} plates start from the locked reference photo as a preview. Tap Generate plates when you're happy; each clip still gets its own fresh scene + identity composite.`
        : `Timeline built — ${segments.length} clips ready. Tap Generate plates for stills, then Generate to animate.`,
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

    const segments = ensureTimeline();
    await runAnimateFrom(segments, 0);
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-rose-400/25 bg-rose-400/[0.03] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Script sequence</p>

      {running && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-1.5">
          <span className="text-[11px] leading-relaxed text-rose-100">{running === "plates" ? "Plating…" : "Rendering…"}</span>
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
            disabled={!!running}
            title="Resumes from where it stopped — starting fresh instead would re-render and re-charge for clips already done."
            className="shrink-0 rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-medium text-zinc-950 transition-colors hover:bg-amber-200 active:bg-amber-300/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? (running === "plates" ? "Plating…" : "Rendering…") : `Resume · ${incompleteRun.total - incompleteRun.resumeIndex} left`}
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleFormatScript}
          disabled={!!running || !script.trim()}
          aria-label="Format part header type words"
          className="min-h-[40px] shrink-0 rounded-md bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
        >
          {"\u21e5"} Format
        </button>
        <button
          type="button"
          onClick={() => setFullScreenScriptOpen(true)}
          disabled={!!running}
          aria-label="Edit script full screen"
          className="min-h-[40px] shrink-0 rounded-md bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
        >
          {"\u2922"} Full screen
        </button>
        <button
          type="button"
          onClick={handleUndoScript}
          disabled={scriptUndo === null || !!running}
          aria-label="Undo script"
          className="min-h-[40px] shrink-0 rounded-md bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
        >
          {"\u21a9"} Undo
        </button>
      </div>

      <div className="relative rounded-xl border border-white/10 bg-white/[0.03] focus-within:border-rose-400/40">
        <ScriptSequenceHighlightOverlay text={script} overlayRef={scriptHighlightRef} />
        <textarea
          value={script}
          onChange={(e) => onSetScriptSequenceDraft({ script: e.target.value, startingImageUrl })}
          onScroll={(e) => {
            if (scriptHighlightRef.current) {
              scriptHighlightRef.current.scrollTop = e.currentTarget.scrollTop;
              scriptHighlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          disabled={!!running}
          placeholder={
            'Paste your "Part 1 (0:00 - 0:15) — Vocal[Duration: ...]. ..." script here. ' +
            "Types: Vocal (singing / LTX) or Instrumental (not singing / Grok). Format maps Intro/Outro/Bridge/Lead/Break → Instrumental."
          }
          rows={4}
          spellCheck={false}
          className="relative z-10 min-h-[7.5rem] w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed text-transparent caret-white placeholder:text-white/30 focus:outline-none disabled:opacity-60"
        />
      </div>

      <p className="text-[10px] leading-snug text-white/40">
        <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {SCRIPT_SEQUENCE_COLOUR_TAGS.map((tag) => (
            <span key={tag.label} className="inline-flex items-center gap-1">
              <span className={["h-1.5 w-1.5 rounded-full", SCRIPT_SEQUENCE_HIGHLIGHT_CLASSES[tag.kind].replace("text-", "bg-")].join(" ")} />
              <span className={SCRIPT_SEQUENCE_HIGHLIGHT_CLASSES[tag.kind]}>{tag.label}</span>
            </span>
          ))}
        </span>
      </p>

      {fullScreenScriptOpen && (
        <ScriptSequenceFullScreenEditor
          initialText={script}
          onApply={handleFullScreenApply}
          onClose={() => setFullScreenScriptOpen(false)}
        />
      )}

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
        <div className="flex flex-1 items-center gap-2">
          <span className="text-[11px] text-white/40" title="Optional — sets clip 1's starting image (image 1). Clips 2+ still build fresh place+identity plates.">
            {startingImageUrl ? "Clip 1 starts from your picture." : "Clip 1 image"}
          </span>
          <button
            type="button"
            onClick={() => startingImageInputRef.current?.click()}
            disabled={!!running || startingImagePicking}
            className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {startingImagePicking ? "Uploading…" : startingImageUrl ? "Change" : "Upload"}
          </button>
          {startingImageUrl && (
            <button
              type="button"
              onClick={handleRemoveStartingImage}
              disabled={!!running}
              className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove
            </button>
          )}
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

      {/* Action chrome: Clip 1 upload is its own row above; status + actions
          stack cleanly so iPhone doesn't stagger "No parts yet" beside wrapping
          buttons. Behavior unchanged — Timeline / plates / Generate handlers. */}
      <div className="flex flex-col gap-2">
        <span
          className="text-[11px] text-white/40"
          title={
            incompleteRun
              ? "Resume above continues animating remaining clips. Generate plates stays available to fill any missing stills without re-touching finished videos."
              : undefined
          }
        >
          {parts.length > 0 ? `${parts.length} part${parts.length === 1 ? "" : "s"}` : "No parts yet"}
        </span>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleBuildTimeline}
            disabled={!!running || parts.length === 0 || !!incompleteRun}
            title="Pre-fills every plate with the locked reference photo (if any) — free, no rendering yet, so you can check the timeline shape first."
            className="min-w-0 rounded-full border border-white/15 bg-white/[0.03] px-2 py-1.5 text-center text-[11px] font-medium leading-tight text-white/80 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:text-[12px]"
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={handleGeneratePlates}
            disabled={isGeneratePlatesButtonDisabled(running, parts.length)}
            title={
              parts.length > 0
                ? `Builds missing stills for up to ${parts.length} clips — skips good stills and finished videos; no video yet`
                : undefined
            }
            className="min-w-0 rounded-full border border-rose-400/40 bg-rose-400/15 px-2 py-1.5 text-center text-[11px] font-medium leading-tight text-rose-100 transition-colors hover:bg-rose-400/25 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:text-[12px]"
          >
            {running === "plates" ? "Plating…" : "Generate plates"}
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={!!running || parts.length === 0 || !!incompleteRun}
            title={
              incompleteRun
                ? "Use Resume above — starting fresh would re-render and re-charge for clips already done."
                : parts.length > 0
                  ? `Animates existing plates for all ${parts.length} clips — skips none that are missing a still`
                  : undefined
            }
            className="min-w-0 rounded-full bg-rose-400 px-2 py-1.5 text-center text-[11px] font-medium leading-tight text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:text-[12px]"
          >
            {running === "render" ? "Rendering…" : "Generate"}
          </button>
        </div>
        <p className="text-[10px] leading-snug text-white/30">Timeline builds clip rows from script · free preview</p>
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
