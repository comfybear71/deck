"use client";

import { useMemo, useState } from "react";
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
}

export function TabCard({ meters }: TabCardProps) {
  const [openSuit, setOpenSuit] = useState<Suit | null>(null);
  const { modes, setMode } = useDialModes();

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
      <div className="w-full max-w-md rounded-none border-0 bg-zinc-950/80 p-5 sm:rounded-3xl sm:border sm:border-white/10 sm:p-7 sm:shadow-[0_0_60px_-15px_rgba(0,0,0,0.9)]">
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
