"use client";

import { useState } from "react";
import type { DialMode, Meter, Suit } from "@/lib/types";
import type { IngestReceipt } from "@/lib/overrides";
import { SUIT_META, SUIT_ORDER } from "@/lib/constants";
import { formatMoney, laneMeters } from "@/lib/meters";
import {
  isDateInWindow,
  meterCharges,
  meterWindowAmount,
  type WindowBasis,
  type WindowDays,
} from "@/lib/spend-window";
import { DialControl } from "./DialControl";

interface VendorTableProps {
  meters: Meter[];
  receipts: IngestReceipt[];
  windowDays: WindowDays;
  now: Date;
  modes: Record<Suit, DialMode>;
  onModeChange: (suit: Suit, mode: DialMode) => void;
}

const BASIS_LABEL: Record<WindowBasis, string> = {
  actual: "Actual",
  prorated: "Est.",
  none: "\u2014",
};

const BASIS_CLASS: Record<WindowBasis, string> = {
  actual: "bg-emerald-400/15 text-emerald-300",
  prorated: "bg-white/10 text-white/50",
  none: "bg-white/5 text-white/30",
};

function formatChargeDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Compact, per-vendor cost table — one row per meter, grouped by suit lane
 * (same lanes/dials as before), not one row per invoice line. Tap a row to
 * expand it in place and see exactly which real charges (or lack thereof)
 * back its window figure — "invoice reality," not an endless scroll.
 */
export function VendorTable({
  meters,
  receipts,
  windowDays,
  now,
  modes,
  onModeChange,
}: VendorTableProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {SUIT_ORDER.map((suit) => {
        const meta = SUIT_META[suit];
        const laneMetersList = laneMeters(meters, suit);
        if (laneMetersList.length === 0) return null;

        const laneTotal = laneMetersList.reduce(
          (sum, m) => sum + meterWindowAmount(m, receipts, windowDays, now).amountUSD,
          0
        );

        return (
          <div key={suit}>
            <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-white/70">
                <span aria-hidden className={meta.color}>
                  {meta.glyph}
                </span>
                {meta.label}
                <span className="text-white/40 tabular-nums">
                  {formatMoney(laneTotal, "USD")}
                </span>
              </span>
              <DialControl value={modes[suit]} onChange={(mode) => onModeChange(suit, mode)} />
            </div>

            <div className="flex flex-col overflow-hidden rounded-xl border border-white/5">
              {laneMetersList.map((meter) => {
                const win = meterWindowAmount(meter, receipts, windowDays, now);
                const charges = meterCharges(meter, receipts, now);
                const isOpen = openId === meter.id;
                const totalUSD = meter.currency === "USD" ? win.amountUSD : win.amountAUD;

                return (
                  <div key={meter.id} className="border-b border-white/5 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : meter.id)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-2 bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-white/80">
                        {meter.name}
                      </span>
                      <span
                        className={[
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                          BASIS_CLASS[win.basis],
                        ].join(" ")}
                      >
                        {BASIS_LABEL[win.basis]}
                      </span>
                      <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-white">
                        {meter.amount === null ? "\u2014" : formatMoney(totalUSD, meter.currency)}
                      </span>
                      <svg
                        aria-hidden
                        viewBox="0 0 20 20"
                        fill="none"
                        className={`h-3.5 w-3.5 shrink-0 text-white/30 transition-transform ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      >
                        <path
                          d="M5 7.5l5 5 5-5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>

                    {isOpen && (
                      <div className="bg-black/40 px-3 py-2.5 text-xs">
                        <p className="text-white/40">
                          {meter.cadence}
                          {meter.status === "closed" ? " \u00b7 closed" : ""}
                          {meter.status === "pending" ? " \u00b7 tbd" : ""}
                        </p>

                        {meter.notes && (
                          <p className="mt-1.5 leading-relaxed text-white/50">{meter.notes}</p>
                        )}

                        {meter.alert && (
                          <p
                            className={[
                              "mt-1.5 font-medium",
                              meter.alert.level === "critical"
                                ? "text-rose-300"
                                : "text-amber-300",
                            ].join(" ")}
                          >
                            {meter.alert.message}
                          </p>
                        )}

                        <div className="mt-2 flex flex-col gap-1">
                          {win.basis === "prorated" && (
                            <p className="text-white/40">
                              No charge landed in this window \u2014 estimated by
                              prorating {formatMoney(meter.amount ?? 0, meter.currency)}/mo
                              across {windowDays} days.
                            </p>
                          )}
                          {win.basis === "none" && meter.cadence === "balance" && (
                            <p className="text-white/40">
                              Prepaid balance
                              {meter.amount !== null
                                ? ` (${formatMoney(meter.amount, meter.currency)} remaining)`
                                : ""}{" "}
                              \u2014 no draw recorded in this window.
                            </p>
                          )}
                          {win.basis === "none" &&
                            meter.cadence !== "balance" &&
                            meter.amount !== null && (
                              <p className="text-white/40">
                                Not counted in this window ({meter.cadence}).
                              </p>
                            )}

                          {charges.length > 0 && (
                            <div className="mt-1 flex flex-col gap-1">
                              <p className="text-[10px] uppercase tracking-wide text-white/30">
                                Charges on record
                              </p>
                              {charges.map((c, i) => {
                                const inWindow = isDateInWindow(c.date, now, windowDays);
                                return (
                                  <div
                                    key={`${meter.id}-${c.date}-${i}`}
                                    className={`flex items-center justify-between gap-2 tabular-nums ${
                                      inWindow ? "text-white/70" : "text-white/30"
                                    }`}
                                  >
                                    <span>
                                      {formatChargeDate(c.date)}
                                      {c.note ? ` \u00b7 ${c.note}` : ""}
                                      {!inWindow ? " (outside window)" : ""}
                                    </span>
                                    <span>{formatMoney(c.amount, c.currency)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
