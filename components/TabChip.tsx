"use client";

import type { Meter } from "@/lib/types";
import { LEASH_GOAL_USD, SUIT_META, SUIT_ORDER } from "@/lib/constants";
import { formatMoney, glowIntensity, laneHasHot, sumLaneUSD, totalBurnUSD } from "@/lib/meters";

interface TabChipProps {
  meters: Meter[];
  onExpand: () => void;
  onOpenGraph: () => void;
}

/**
 * Collapsed, glanceable view of The Tab — a floating pill instead of the
 * full-screen card. Default view on load; tap to expand into TabCard. A
 * small satellite "Deck" button opens the v0 project graph directly,
 * without expanding the card first.
 */
export function TabChip({ meters, onExpand, onOpenGraph }: TabChipProps) {
  const burnUSD = totalBurnUSD(meters);
  const intensity = glowIntensity(burnUSD, LEASH_GOAL_USD);
  const overGoal = burnUSD > LEASH_GOAL_USD;
  const alertCount = meters.filter((m) => m.alert).length;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:justify-end sm:px-0 sm:pb-6">
      <button
        type="button"
        onClick={onOpenGraph}
        aria-label="Open Deck graph"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-950/90 text-white/70 shadow-xl backdrop-blur-md transition-colors active:scale-[0.97] hover:bg-zinc-900 hover:text-white"
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5">
          <circle cx="4.5" cy="5" r="1.8" fill="currentColor" />
          <circle cx="15.5" cy="5" r="1.8" fill="currentColor" />
          <circle cx="10" cy="15" r="1.8" fill="currentColor" />
          <path
            d="M6 5.9L13.6 4.8M6.1 6.4L9 13.3M13.9 6.4L11 13.3"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        type="button"
        onClick={onExpand}
        aria-label={`Open The Tab. Currently ${formatMoney(
          burnUSD,
          "USD"
        )} estimated monthly burn, ${overGoal ? "over" : "under"} goal.`}
        className="group relative flex items-center gap-3 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2.5 shadow-2xl backdrop-blur-md transition-transform active:scale-[0.97] sm:px-5 sm:py-3"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-full blur-xl transition-opacity duration-700"
          style={{
            opacity: intensity,
            background: overGoal
              ? "radial-gradient(circle, rgba(244,63,94,0.55), transparent 70%)"
              : "radial-gradient(circle, rgba(96,165,250,0.45), transparent 70%)",
          }}
        />

        <span className="flex flex-col items-start leading-none">
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">
            The Tab
          </span>
          <span className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {formatMoney(burnUSD, "USD")}
          </span>
        </span>

        <span
          aria-hidden
          className="flex items-center gap-1 border-l border-white/10 pl-3"
        >
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
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-black"
          >
            {alertCount}
          </span>
        )}
      </button>
    </div>
  );
}
