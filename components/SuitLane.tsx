"use client";

import type { DialMode, Suit } from "@/lib/types";
import { SUIT_META } from "@/lib/constants";
import { formatMoney } from "@/lib/meters";
import { DialControl } from "./DialControl";

interface SuitLaneProps {
  suit: Suit;
  sumUSD: number;
  maxLaneSumUSD: number;
  isHot: boolean;
  mode: DialMode;
  onModeChange: (mode: DialMode) => void;
  onOpen: () => void;
}

export function SuitLane({
  suit,
  sumUSD,
  maxLaneSumUSD,
  isHot,
  mode,
  onModeChange,
  onOpen,
}: SuitLaneProps) {
  const meta = SUIT_META[suit];
  const barWidth = maxLaneSumUSD > 0 ? Math.max(4, (sumUSD / maxLaneSumUSD) * 100) : 4;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={[
        "group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-left transition-colors",
        "hover:bg-white/[0.06] active:bg-white/[0.08]",
        isHot ? "animate-[suit-pulse_2.4s_ease-in-out_infinite]" : "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={`w-6 shrink-0 text-center text-xl leading-none ${meta.color}`}
      >
        {meta.glyph}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-white/80">{meta.label}</span>
          <span className="text-sm font-semibold text-white tabular-nums">
            {formatMoney(sumUSD, "USD")}
          </span>
        </span>
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-white/10">
          <span
            className={`block h-full rounded-full bg-gradient-to-r ${
              isHot ? "from-rose-500 to-orange-400" : "from-white/60 to-white/30"
            }`}
            style={{ width: `${barWidth}%` }}
          />
        </span>
      </span>

      <DialControl value={mode} onChange={onModeChange} />
    </div>
  );
}
