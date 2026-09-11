"use client";

import { useMemo } from "react";
import type { Meter } from "@/lib/types";
import type { IngestReceipt } from "@/lib/overrides";
import { SUIT_META, SUIT_ORDER } from "@/lib/constants";
import { formatMoney, glowIntensity, laneHasHot, sumLaneUSD } from "@/lib/meters";
import {
  type WindowDays,
  windowBurnAUD,
  windowBurnUSD,
  windowLabel,
} from "@/lib/spend-window";
import { LEASH_GOAL_USD } from "@/lib/constants";

interface CostHeaderProps {
  meters: Meter[];
  receipts: IngestReceipt[];
  windowDays: WindowDays;
  now: Date;
  onOpen: () => void;
}

/**
 * The running-cost meter, pinned as a header at the top of the main Deck
 * surface (`GraphView`) — not a floating chip, not a separate page/node.
 * One continuous scroll: this header, then the project nodes below it.
 * Tapping it opens `CostDetailSheet` for the 7d/30d deep dive.
 */
export function CostHeader({ meters, receipts, windowDays, now, onOpen }: CostHeaderProps) {
  const burnUSD = useMemo(
    () => windowBurnUSD(meters, receipts, windowDays, now),
    [meters, receipts, windowDays, now]
  );
  const burnAUD = useMemo(
    () => windowBurnAUD(meters, receipts, windowDays, now),
    [meters, receipts, windowDays, now]
  );
  const goalUSD = (LEASH_GOAL_USD / 30) * windowDays;
  const intensity = glowIntensity(burnUSD, goalUSD);
  const overGoal = burnUSD > goalUSD;
  const alertCount = meters.filter((m) => m.alert).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Running costs, ${windowLabel(windowDays)}: ${formatMoney(
        burnUSD,
        "USD"
      )}, ${overGoal ? "over" : "under"} goal. Open cost deep dive.`}
      className="group relative mb-4 flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-left transition-colors active:scale-[0.99] hover:bg-white/[0.06] sm:px-5"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-90 blur-2xl transition-opacity duration-700"
        style={{
          opacity: intensity * 0.6,
          background: overGoal
            ? "radial-gradient(circle at 15% 50%, rgba(244,63,94,0.35), transparent 70%)"
            : "radial-gradient(circle at 15% 50%, rgba(96,165,250,0.3), transparent 70%)",
        }}
      />

      <span className="flex min-w-0 flex-1 flex-col items-start leading-none">
        <span className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">
          Running costs
          <span aria-hidden>&middot;</span>
          <span className="text-white/50">{windowLabel(windowDays)}</span>
        </span>
        <span className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {formatMoney(burnUSD, "USD")}
        </span>
        {burnAUD > 0 && (
          <span className="mt-0.5 text-[10px] text-white/35">
            + {formatMoney(burnAUD, "AUD")} AUD
          </span>
        )}
      </span>

      <span aria-hidden className="flex shrink-0 items-center gap-1 border-l border-white/10 pl-3">
        {SUIT_ORDER.map((suit) => {
          const meta = SUIT_META[suit];
          const hot = laneHasHot(meters, suit);
          const hasSpend = sumLaneUSD(meters, suit) > 0;
          return (
            <span
              key={suit}
              className={[
                "h-1.5 w-1.5 rounded-full transition-transform",
                hot
                  ? "scale-125 bg-rose-400 shadow-[0_0_6px_2px_rgba(244,63,94,0.6)]"
                  : hasSpend
                    ? meta.bg
                    : "bg-white/15",
              ].join(" ")}
            />
          );
        })}
      </span>

      {alertCount > 0 && (
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white"
        >
          {alertCount}
        </span>
      )}

      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="h-4 w-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5"
      >
        <path
          d="M7.5 4l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
