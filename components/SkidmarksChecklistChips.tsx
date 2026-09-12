"use client";

import {
  SKIDMARKS_CHECKLIST_LABEL,
  SKIDMARKS_CHECKLIST_ORDER,
  type SkidmarksChecklistKey,
} from "@/lib/skidmarks";

interface SkidmarksChecklistChipsProps {
  checklist: Record<SkidmarksChecklistKey, boolean>;
}

function ChipIcon({ done }: { done: boolean }) {
  if (done) {
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
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 text-rose-400/70">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * Three equal-width chips spanning the MP3 card's width — Lyrics / Timing
 * / Ready — each flips to a green check as the staged "background sniff"
 * timers in `hooks/useSkidmarksStudio.ts` mark it done. No lyrics panel,
 * no manual pin of vocal starts: this is the whole surface for that.
 */
export function SkidmarksChecklistChips({ checklist }: SkidmarksChecklistChipsProps) {
  return (
    <div role="list" aria-label="MP3 checklist" className="grid grid-cols-3 gap-2">
      {SKIDMARKS_CHECKLIST_ORDER.map((key) => {
        const done = checklist[key];
        return (
          <div
            key={key}
            role="listitem"
            className={[
              "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition-colors",
              done
                ? "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-200"
                : "border-white/10 bg-white/[0.03] text-white/40",
            ].join(" ")}
          >
            <ChipIcon done={done} />
            {SKIDMARKS_CHECKLIST_LABEL[key]}
          </div>
        );
      })}
    </div>
  );
}
