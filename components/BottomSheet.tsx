"use client";

import { useEffect } from "react";
import type { Meter, Suit } from "@/lib/types";
import { SUIT_META } from "@/lib/constants";
import { formatMoney } from "@/lib/meters";

interface BottomSheetProps {
  suit: Suit;
  meters: Meter[];
  onClose: () => void;
}

export function BottomSheet({ suit, meters, onClose }: BottomSheetProps) {
  const meta = SUIT_META[suit];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
          "relative z-10 max-h-[80vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl",
          "sm:max-w-md sm:rounded-3xl sm:p-6",
          "animate-[sheet-in_0.22s_ease-out]",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={`${meta.label} meters`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span aria-hidden className={`text-xl ${meta.color}`}>
              {meta.glyph}
            </span>
            <h2 className="text-base font-semibold text-white">{meta.label}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
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

        <div className="flex flex-col gap-2.5">
          {meters.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-white/5 bg-white/[0.03] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {m.name}
                  </p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-wide text-white/40">
                    {m.cadence}
                    {m.status === "closed" ? " \u00b7 closed" : ""}
                    {m.status === "pending" ? " \u00b7 tbd" : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-white">
                  {m.amount === null ? "\u2014" : formatMoney(m.amount, m.currency)}
                </p>
              </div>

              {m.notes && (
                <p className="mt-1.5 text-xs leading-relaxed text-white/50">
                  {m.notes}
                </p>
              )}

              {m.alert && (
                <p
                  className={[
                    "mt-1.5 text-xs font-medium",
                    m.alert.level === "critical" ? "text-rose-300" : "text-amber-300",
                  ].join(" ")}
                >
                  {m.alert.message}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
