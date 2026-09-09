"use client";

import { useEffect, useMemo, useState } from "react";
import type { Meter, Suit } from "@/lib/types";
import { SUIT_ORDER } from "@/lib/constants";
import {
  laneHasHot,
  laneMeters,
  sumLaneUSD,
  totalBurnAUD,
  totalBurnUSD,
} from "@/lib/meters";
import { useDialModes } from "@/hooks/useDialModes";
import { BigBurn } from "./BigBurn";
import { AlertsStrip } from "./AlertsStrip";
import { SuitLane } from "./SuitLane";
import { BottomSheet } from "./BottomSheet";

interface TabCardProps {
  meters: Meter[];
  onCollapse: () => void;
}

export function TabCard({ meters, onCollapse }: TabCardProps) {
  const [openSuit, setOpenSuit] = useState<Suit | null>(null);
  const { modes, setMode } = useDialModes();

  useEffect(() => {
    if (openSuit) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCollapse();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openSuit, onCollapse]);

  const burnUSD = useMemo(() => totalBurnUSD(meters), [meters]);
  const burnAUD = useMemo(() => totalBurnAUD(meters), [meters]);

  const laneSums = useMemo(() => {
    const sums = new Map<Suit, number>();
    for (const suit of SUIT_ORDER) sums.set(suit, sumLaneUSD(meters, suit));
    return sums;
  }, [meters]);

  const maxLaneSumUSD = useMemo(
    () => Math.max(...Array.from(laneSums.values()), 1),
    [laneSums]
  );

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-black px-0 py-0 sm:px-6 sm:py-10">
      <div className="relative w-full max-w-md rounded-none border-0 bg-zinc-950/80 p-5 sm:rounded-3xl sm:border sm:border-white/10 sm:p-7 sm:shadow-[0_0_60px_-15px_rgba(0,0,0,0.9)]">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse to chip"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/20 transition-colors hover:bg-white/20 hover:text-white sm:right-4 sm:top-4"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path
              d="M5 8l5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <BigBurn burnUSD={burnUSD} burnAUD={burnAUD} />

        <div className="mb-4">
          <AlertsStrip meters={meters} />
        </div>

        <div className="flex flex-col gap-2.5">
          {SUIT_ORDER.map((suit) => (
            <SuitLane
              key={suit}
              suit={suit}
              sumUSD={laneSums.get(suit) ?? 0}
              maxLaneSumUSD={maxLaneSumUSD}
              isHot={laneHasHot(meters, suit)}
              mode={modes[suit]}
              onModeChange={(mode) => setMode(suit, mode)}
              onOpen={() => setOpenSuit(suit)}
            />
          ))}
        </div>

        <p className="mt-5 text-center text-[11px] text-white/30">
          Tap a suit for its meters. Dials are display-only for now.
        </p>
      </div>

      {openSuit && (
        <BottomSheet
          suit={openSuit}
          meters={laneMeters(meters, openSuit)}
          onClose={() => setOpenSuit(null)}
        />
      )}
    </div>
  );
}
