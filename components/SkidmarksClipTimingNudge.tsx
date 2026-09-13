"use client";

import { formatDuration, SEGMENT_NUDGE_STEP_SEC } from "@/lib/skidmarks";

/**
 * Stuart's 2026-09-13 hard ask: ElevenLabs Scribe timing lands "mostly
 * right but sometimes 3-4 seconds off," so he wants to slip a clip's
 * start/end after transcription without a heavy NLE and without
 * re-running Scribe. This is the compact −1s/+1s stepper for that —
 * two small groups (Start, End), each a "−" button, the current time
 * read-only in between, and a "+" button. **Not** editable text
 * fields — per AGENTS.md's "smallest possible surface, no button farm"
 * chrome lock, a tap-stepper needs no keyboard, no parsing/validation
 * of typed `mm:ss` text, and no risk of an invalid value; a handful of
 * taps corrects a typical 3-4s miss just as fast as typing would.
 *
 * Deliberately dumb — every actual bound/clamp decision (neighbor
 * boundary, song start/end, minimum clip length) lives in
 * `lib/skidmarks.ts`'s `nudgeSkidmarksSegmentBoundary`; this component
 * only renders whatever `canNudge*` booleans its caller
 * (`SkidmarksClipTimeline`) already computed off that same function,
 * and fires `onNudgeStart`/`onNudgeEnd` with a signed
 * `SEGMENT_NUDGE_STEP_SEC` delta on tap. Never calls a real API — a
 * nudge only ever edits local segment times already sitting in the
 * store.
 */
interface SkidmarksClipTimingNudgeProps {
  startSec: number;
  endSec: number;
  canNudgeStartEarlier: boolean;
  canNudgeStartLater: boolean;
  canNudgeEndEarlier: boolean;
  canNudgeEndLater: boolean;
  onNudgeStart: (deltaSec: number) => void;
  onNudgeEnd: (deltaSec: number) => void;
}

function MinusIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-2.5 w-2.5">
      <path d="M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-2.5 w-2.5">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function NudgeButton({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: "earlier" | "later";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // `h-7 w-7` (28px) visible, but `p-1` of transparent padding
      // widens the real tap target a bit past that without growing the
      // control's own footprint in the row — these sit in a plain flex
      // row with real gaps on every side, not stacked flush against
      // another tappable surface, so this doesn't need the corner
      // select control's full ~44pt fix (see `SkidmarksClipStub.tsx`'s
      // doc comment for why *that* one specifically needed it).
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
    >
      {direction === "earlier" ? <MinusIcon /> : <PlusIcon />}
    </button>
  );
}

function NudgeGroup({
  label,
  timeLabel,
  canEarlier,
  canLater,
  onNudge,
}: {
  label: string;
  timeLabel: string;
  canEarlier: boolean;
  canLater: boolean;
  onNudge: (deltaSec: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10px] font-medium uppercase tracking-wide text-white/35">
        {label}
      </span>
      <NudgeButton
        direction="earlier"
        label={`${label} ${SEGMENT_NUDGE_STEP_SEC}s earlier`}
        disabled={!canEarlier}
        onClick={() => onNudge(-SEGMENT_NUDGE_STEP_SEC)}
      />
      <span className="w-9 shrink-0 text-center text-[11px] font-medium tabular-nums text-white/75">
        {timeLabel}
      </span>
      <NudgeButton
        direction="later"
        label={`${label} ${SEGMENT_NUDGE_STEP_SEC}s later`}
        disabled={!canLater}
        onClick={() => onNudge(SEGMENT_NUDGE_STEP_SEC)}
      />
    </div>
  );
}

export function SkidmarksClipTimingNudge({
  startSec,
  endSec,
  canNudgeStartEarlier,
  canNudgeStartLater,
  canNudgeEndEarlier,
  canNudgeEndLater,
  onNudgeStart,
  onNudgeEnd,
}: SkidmarksClipTimingNudgeProps) {
  return (
    <div
      role="group"
      aria-label="Adjust clip start and end times"
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-2"
    >
      <NudgeGroup
        label="Start"
        timeLabel={formatDuration(startSec)}
        canEarlier={canNudgeStartEarlier}
        canLater={canNudgeStartLater}
        onNudge={onNudgeStart}
      />
      <NudgeGroup
        label="End"
        timeLabel={formatDuration(endSec)}
        canEarlier={canNudgeEndEarlier}
        canLater={canNudgeEndLater}
        onNudge={onNudgeEnd}
      />
    </div>
  );
}
