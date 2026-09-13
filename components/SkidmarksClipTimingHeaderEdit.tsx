"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration, parseSkidmarksTimeInput } from "@/lib/skidmarks";

/**
 * Replaces the old big −1s/+1s stepper (`SkidmarksClipTimingNudge`,
 * removed 2026-09-13 on Stuart's explicit "I hate seeing big buttons
 * like this and wasting great real estate" ask) with the same real
 * need in almost no space at all: the clip row's own always-visible
 * "0:00–0:32" header text, double-tapped to edit either number
 * directly, right there in the header — no expanded panel, no button
 * row.
 *
 * **Why double-tap, not a single tap.** The whole clip row this sits
 * inside already treats a single tap as "expand/collapse"
 * (`SkidmarksClipTimeline.tsx`'s `SegmentRow`). A single tap on the
 * time text has to not trigger that, so entering edit mode needs its
 * own, different gesture. Native `dblclick` is exactly the kind of
 * touch-event assumption this codebase has learned not to trust on iOS
 * Safari (see `SkidmarksClipStub.tsx`'s doc comment for the plate
 * select control's own real-touch-target story) — this tracks tap
 * timestamps itself instead (`DOUBLE_TAP_WINDOW_MS`) rather than
 * relying on the browser's own double-tap-to-dblclick mapping.
 *
 * **Same underlying safety net as the old stepper.** Typing a new time
 * and committing just computes a delta (`typed − current`) and fires
 * the exact same `onNudgeStart`/`onNudgeEnd` callbacks the stepper
 * used — `lib/skidmarks.ts`'s `nudgeSkidmarksSegmentStart`/
 * `nudgeSkidmarksSegmentEnd` already clamp *any* delta size against the
 * song's own bounds and the neighboring clip's boundary, so a typo or
 * a wildly out-of-range value can't produce an invalid state; it just
 * clamps to the nearest real bound, same as mashing the old +/− button
 * past its limit used to. An unparseable typed value
 * (`parseSkidmarksTimeInput` returning `null` — empty text, garbage,
 * an invalid `"m:ss"` like `"1:65"`) cancels the edit instead of
 * committing anything.
 */

const DOUBLE_TAP_WINDOW_MS = 350;

interface EditableTimeProps {
  seconds: number;
  onCommitDelta: (deltaSec: number) => void;
  ariaLabel: string;
}

function EditableTime({ seconds, onCommitDelta, ariaLabel }: EditableTimeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const lastTapAtRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const parsed = parseSkidmarksTimeInput(draft);
    if (parsed !== null && parsed !== seconds) {
      onCommitDelta(parsed - seconds);
    }
    setEditing(false);
  };

  const handleTap = (e: React.MouseEvent) => {
    // Always stop here — even a first, "arming" tap must not also
    // bubble up to the row's own onClick and toggle it expanded/
    // collapsed out from under a fast second tap.
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTapAtRef.current < DOUBLE_TAP_WINDOW_MS) {
      lastTapAtRef.current = 0;
      setDraft(formatDuration(seconds));
      setEditing(true);
    } else {
      lastTapAtRef.current = now;
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        aria-label={ariaLabel}
        className="w-11 shrink-0 rounded border border-rose-400/40 bg-white/[0.07] px-0.5 py-0 text-center text-xs font-medium tabular-nums text-white outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label={`${ariaLabel}: ${formatDuration(seconds)}, double-tap to edit`}
      className="shrink-0 rounded px-0.5 tabular-nums text-white/60 transition-colors hover:text-white/85"
    >
      {formatDuration(seconds)}
    </button>
  );
}

export interface SkidmarksClipTimingHeaderEditProps {
  startSec: number;
  endSec: number;
  onNudgeStart: (deltaSec: number) => void;
  onNudgeEnd: (deltaSec: number) => void;
}

export function SkidmarksClipTimingHeaderEdit({
  startSec,
  endSec,
  onNudgeStart,
  onNudgeEnd,
}: SkidmarksClipTimingHeaderEditProps) {
  return (
    <span className="flex shrink-0 items-center text-xs font-medium tabular-nums">
      <EditableTime seconds={startSec} onCommitDelta={onNudgeStart} ariaLabel="Clip start time" />
      <span className="px-px text-white/30">–</span>
      <EditableTime seconds={endSec} onCommitDelta={onNudgeEnd} ariaLabel="Clip end time" />
    </span>
  );
}
