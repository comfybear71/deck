"use client";

import {
  SKIDMARKS_STAGE_LABEL,
  SKIDMARKS_STAGE_ORDER,
  type SkidmarksStage,
} from "@/lib/skidmarks";

interface SkidmarksStageChipsProps {
  current: SkidmarksStage;
}

/**
 * Cast · Plates · Multi-angle · Voice · Animate · Stitch — the one piece
 * of abstract "where are we in the shoot" copy Stuart asked for. Purely
 * a UI highlight of `current`; no chip is individually tappable in this
 * build (see the README's "Skidmarks node" section for what's explicitly
 * stubbed vs. wired).
 */
export function SkidmarksStageChips({ current }: SkidmarksStageChipsProps) {
  return (
    <div
      role="list"
      aria-label="Directing stages"
      className="flex flex-wrap items-center gap-1.5"
    >
      {SKIDMARKS_STAGE_ORDER.map((stage) => {
        const isCurrent = stage === current;
        return (
          <span
            key={stage}
            role="listitem"
            aria-current={isCurrent ? "step" : undefined}
            className={[
              "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide transition-colors",
              isCurrent
                ? "border-rose-400/40 bg-rose-400/15 text-rose-200 shadow-[0_0_16px_-4px_rgba(251,113,133,0.6)]"
                : "border-white/10 bg-white/[0.03] text-white/40",
            ].join(" ")}
          >
            {SKIDMARKS_STAGE_LABEL[stage]}
          </span>
        );
      })}
    </div>
  );
}
