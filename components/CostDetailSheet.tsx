"use client";

import { useEffect, useMemo } from "react";
import type { DialMode, Meter, Suit } from "@/lib/types";
import type { LastSync, IngestReceipt } from "@/lib/overrides";
import { LEASH_GOAL_USD } from "@/lib/constants";
import {
  WINDOW_OPTIONS,
  buildBurnSeries,
  windowBurnAUD,
  windowBurnUSD,
  windowLabel,
  type WindowDays,
} from "@/lib/spend-window";
import { AlertsStrip } from "./AlertsStrip";
import { BigBurn } from "./BigBurn";
import { BurnGraph } from "./BurnGraph";
import { VendorTable } from "./VendorTable";
import { MailSyncLine } from "./MailSyncLine";
import { ControlPlaneDemo } from "./ControlPlaneDemo";

interface CostDetailSheetProps {
  meters: Meter[];
  receipts: IngestReceipt[];
  lastMailSync: LastSync;
  now: Date;
  windowDays: WindowDays;
  onWindowChange: (days: WindowDays) => void;
  modes: Record<Suit, DialMode>;
  onModeChange: (suit: Suit, mode: DialMode) => void;
  onClose: () => void;
}

/**
 * The cost deep dive — opened by tapping `CostHeader`. Everything that
 * used to live in the standalone `TabCard` screen lives here now, plus the
 * 7d/30d window toggle, the burn graph, and the vendor table. This is a
 * sheet layered on top of the one continuous Deck surface, not a separate
 * page you navigate to.
 */
export function CostDetailSheet({
  meters,
  receipts,
  lastMailSync,
  now,
  windowDays,
  onWindowChange,
  modes,
  onModeChange,
  onClose,
}: CostDetailSheetProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const burnUSD = useMemo(
    () => windowBurnUSD(meters, receipts, windowDays, now),
    [meters, receipts, windowDays, now]
  );
  const burnAUD = useMemo(
    () => windowBurnAUD(meters, receipts, windowDays, now),
    [meters, receipts, windowDays, now]
  );
  const goalUSD = (LEASH_GOAL_USD / 30) * windowDays;
  const buckets = useMemo(
    () => buildBurnSeries(meters, receipts, windowDays, now),
    [meters, receipts, windowDays, now]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div
        className={[
          "relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl",
          "sm:max-w-lg sm:rounded-3xl sm:p-6",
          "animate-[sheet-in_0.22s_ease-out]",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Running costs, deep dive"
      >
        <div className="mb-1 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Running costs</h2>
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              Deep dive
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div
          className="mt-3 inline-flex items-center gap-0.5 rounded-full bg-white/5 p-0.5 ring-1 ring-white/10"
          role="group"
          aria-label="Window"
        >
          {WINDOW_OPTIONS.map((days) => {
            const active = days === windowDays;
            return (
              <button
                key={days}
                type="button"
                onClick={() => onWindowChange(days)}
                aria-pressed={active}
                className={[
                  "rounded-full px-3 py-1 text-xs font-medium tracking-wide transition-colors",
                  active
                    ? "bg-white text-black shadow-sm"
                    : "text-white/50 hover:text-white/80",
                ].join(" ")}
              >
                {windowLabel(days)}
              </button>
            );
          })}
        </div>

        <BigBurn
          burnUSD={burnUSD}
          burnAUD={burnAUD}
          windowLabel={windowLabel(windowDays)}
          goalUSD={goalUSD}
        />

        <div className="mb-4">
          <AlertsStrip meters={meters} />
        </div>

        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">
          Burn over {windowLabel(windowDays).toLowerCase()}
        </p>
        <BurnGraph buckets={buckets} />

        <p className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-wide text-white/40">
          By vendor
        </p>
        <VendorTable
          meters={meters}
          receipts={receipts}
          windowDays={windowDays}
          now={now}
          modes={modes}
          onModeChange={onModeChange}
        />

        <p className="mt-5 text-center text-[11px] leading-relaxed text-white/30">
          &ldquo;Actual&rdquo; rows use a real charge date in this window.
          &ldquo;Est.&rdquo; rows have no charge in this window, so their
          monthly amount is prorated across {windowDays} days. Balances and
          one-time charges are never prorated.
        </p>

        <MailSyncLine lastMailSync={lastMailSync} />

        <ControlPlaneDemo />
      </div>
    </div>
  );
}
