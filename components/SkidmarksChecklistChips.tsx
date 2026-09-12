"use client";

import {
  SKIDMARKS_CHECKLIST_LABEL,
  SKIDMARKS_CHECKLIST_ORDER,
  type SkidmarksChecklistKey,
  type SkidmarksChipState,
} from "@/lib/skidmarks";

interface SkidmarksChecklistChipsProps {
  checklist: Record<SkidmarksChecklistKey, SkidmarksChipState>;
}

/** Per-state icon + a short, honest description used for both the
 * visible dot/glyph and the chip's `aria-label` — screen readers get the
 * same "analyzing"/"stub" distinction sighted users see, not just
 * "done"/"not done". */
function ChipIcon({ state }: { state: SkidmarksChipState }) {
  if (state === "done") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 text-emerald-400">
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M6.5 10.2l2.3 2.3L13.5 7.6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === "analyzing") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="h-3.5 w-3.5 animate-spin text-sky-300"
      >
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
        <path d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === "stub") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 text-amber-300">
        <path
          d="M10 2.5 18 16H2L10 2.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M10 8.2v3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 text-rose-400/70">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

const STATE_CLASSNAME: Record<SkidmarksChipState, string> = {
  pending: "border-white/10 bg-white/[0.03] text-white/40",
  analyzing: "border-sky-300/30 bg-sky-300/[0.06] text-sky-200",
  done: "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-200",
  stub: "border-amber-300/30 bg-amber-300/[0.06] text-amber-200",
};

const STATE_DESCRIPTION: Record<SkidmarksChipState, string> = {
  pending: "not started",
  analyzing: "analyzing",
  done: "done",
  stub: "stub \u2014 analysis failed, showing fallback",
};

/**
 * Three equal-width chips spanning the MP3 card's width — Lyrics / Timing
 * / Ready. Unlike the old build, these states are **derived from real
 * signals** (`skidmarksChecklistState` in `lib/skidmarks.ts`), not staged
 * timers: `analyzing` while the real work (duration probe / vocal
 * analysis) is in flight, `done` once it genuinely resolves, and — this
 * is the important one — `stub` (amber, never green) if analysis failed
 * and a chip is only "ready" via the honestly-labeled seed fallback. No
 * chip here is ever silently rendered green for something that's still
 * mock.
 */
export function SkidmarksChecklistChips({ checklist }: SkidmarksChecklistChipsProps) {
  return (
    <div role="list" aria-label="MP3 analysis checklist" className="grid grid-cols-3 gap-2">
      {SKIDMARKS_CHECKLIST_ORDER.map((key) => {
        const state = checklist[key];
        return (
          <div
            key={key}
            role="listitem"
            aria-label={`${SKIDMARKS_CHECKLIST_LABEL[key]}: ${STATE_DESCRIPTION[state]}`}
            title={STATE_DESCRIPTION[state]}
            className={[
              "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition-colors",
              STATE_CLASSNAME[state],
            ].join(" ")}
          >
            <ChipIcon state={state} />
            {SKIDMARKS_CHECKLIST_LABEL[key]}
          </div>
        );
      })}
    </div>
  );
}
