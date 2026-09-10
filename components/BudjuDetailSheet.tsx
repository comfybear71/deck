"use client";

import { useEffect, useRef, useState } from "react";
import type { BudjuData, BudjuSignal } from "@/lib/types";
import {
  SIGNAL_META,
  bandPosition,
  formatPrice,
  formatSignedPct,
  formatUSD,
  sortSignals,
} from "@/lib/budju";
import { ActionChips } from "./ActionChips";

interface BudjuDetailSheetProps {
  data: BudjuData;
  onClose: () => void;
  /** Triggers a fresh pull from `/api/budju/live` (see `GraphView`).
   * Returns whether it succeeded so the sheet can show feedback either
   * way — optional so this component still works standalone. */
  onRefresh?: () => Promise<boolean>;
  /** True while `GraphView`'s own mount-time refresh (or a prior manual
   * one) is in flight — disables the chip so taps don't stack requests. */
  refreshing?: boolean;
}

const CHIP_FEEDBACK_TIMEOUT_MS = 3000;

/**
 * Budju's detail sheet — opened by tapping the primary node in the v0
 * graph (see BudjuNodeCard). Three sections only, matching the node face:
 * pool total, crypto/USDC split, and buy/sell/cooldown signals, plus a
 * link out to the real app. No wallet connect, no trades, no full asset
 * list, no live websocket — this is a glance, not the trade UI.
 */
export function BudjuDetailSheet({
  data,
  onClose,
  onRefresh,
  refreshing = false,
}: BudjuDetailSheetProps) {
  const [chipMessage, setChipMessage] = useState<string | null>(null);
  const chipMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (chipMessageTimer.current) clearTimeout(chipMessageTimer.current);
    };
  }, []);

  const showChipMessage = (message: string) => {
    if (chipMessageTimer.current) clearTimeout(chipMessageTimer.current);
    setChipMessage(message);
    chipMessageTimer.current = setTimeout(
      () => setChipMessage(null),
      CHIP_FEEDBACK_TIMEOUT_MS
    );
  };

  const handleRefresh = async () => {
    if (!onRefresh) return;
    const ok = await onRefresh();
    showChipMessage(ok ? "Refreshed from budju.xyz." : "Refresh failed — showing last known data.");
  };

  const signals = sortSignals(data.signals);

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
          "relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl",
          "sm:max-w-md sm:rounded-3xl sm:p-6",
          "animate-[sheet-in_0.22s_ease-out]",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Budju details"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Budju</h2>
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              Portfolio glance
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

        {/* Pool total — doughnut center */}
        <div className="flex flex-col items-center rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-5">
          <div className="relative h-28 w-28">
            <div
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(#a78bfa 0% ${data.split.cryptoPct}%, #34d399 ${data.split.cryptoPct}% 100%)`,
              }}
            />
            <div className="absolute inset-[9px] flex flex-col items-center justify-center rounded-full bg-zinc-950 text-center">
              <span className="text-xl font-bold tabular-nums text-white">
                {formatUSD(data.pool.totalUSD)}
              </span>
              <span className="text-[10px] text-white/40">Pool total</span>
            </div>
          </div>
          {data.pool.hasCash && (
            <p className="mt-3 text-xs text-white/50">
              {data.pool.assetCount} assets + cash
            </p>
          )}
        </div>

        {/* Crypto vs USDC split */}
        <div className="mt-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-sky-300">
              {data.split.cryptoPct}% Crypto · {formatUSD(data.split.cryptoUSD)}
            </span>
            <span className="text-emerald-300">
              {data.split.usdcPct}% USDC · {formatUSD(data.split.usdcUSD)}
            </span>
          </div>
          <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-sky-400 to-violet-400"
              style={{ width: `${data.split.cryptoPct}%` }}
            />
            <div
              className="h-full bg-emerald-400"
              style={{ width: `${data.split.usdcPct}%` }}
            />
          </div>
        </div>

        {/* Signals — near-buy / near-sell / cooldown */}
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">
            Signals
          </p>
          {signals.length === 0 ? (
            <p className="text-xs text-white/40">
              Nothing near a threshold right now.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {signals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </div>

        {onRefresh && (
          <div className="mt-4">
            <ActionChips
              items={[
                {
                  id: "refresh",
                  label: "Refresh",
                  pendingLabel: "Refreshing\u2026",
                  pending: refreshing,
                  onSelect: handleRefresh,
                },
              ]}
            />
            {chipMessage && (
              <p className="mt-2 text-[11px] leading-relaxed text-white/50">
                {chipMessage}
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-[11px] text-white/30">
          {data.updatedAt
            ? `Last refreshed ${new Date(data.updatedAt).toLocaleString()}.`
            : "Seed data — live refresh from Budju isn't wired up yet."}
        </p>

        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/20 active:bg-white/25"
        >
          Open budju.xyz/trade
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
            <path
              d="M7.5 4h8.5v8.5M16 4L4 16"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: BudjuSignal }) {
  const meta = SIGNAL_META[signal.type];
  const isCooldown = signal.type === "cooldown";
  const position = bandPosition(signal);

  return (
    <div
      className={`rounded-xl border bg-white/[0.03] p-3 ${meta.borderClass} ${
        isCooldown ? "opacity-80" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-sm font-bold ${isCooldown ? "text-white/70" : "text-white"}`}>
          {signal.asset}
        </span>
        {isCooldown ? (
          <span className={`text-xs font-medium ${meta.textClass}`}>
            (cooldown)
          </span>
        ) : (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chipClass}`}
          >
            {meta.label}
          </span>
        )}
        {signal.tier && (
          <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
            {signal.tier}
          </span>
        )}
        {typeof signal.qty === "number" && (
          <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-semibold text-sky-200 tabular-nums">
            {signal.qty}
          </span>
        )}
        <span className="rounded-full bg-violet-400/10 px-2 py-0.5 text-[10px] font-semibold text-violet-200 tabular-nums">
          {formatPrice(signal.price)}
        </span>
        <span
          className={`ml-auto text-[11px] font-medium tabular-nums ${
            signal.changePct >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {formatSignedPct(signal.changePct)}
        </span>
      </div>

      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="relative h-full w-full">
          <div
            className={`absolute top-0 h-full w-2.5 -translate-x-1/2 rounded-full ${meta.markerClass}`}
            style={{ left: `${position * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums">
        <span className="text-emerald-400">Buy &lt; {formatPrice(signal.buyBelow)}</span>
        <span className="text-white/70">{formatPrice(signal.current)}</span>
        <span className="text-rose-400">Sell &gt; {formatPrice(signal.sellAbove)}</span>
      </div>

      {isCooldown ? (
        <p className="mt-1.5 text-[11px] text-white/40">{meta.description}</p>
      ) : (
        typeof signal.toBuyPct === "number" && (
          <p className="mt-1.5 text-[11px] font-medium text-amber-300">
            {signal.toBuyPct}% to buy
          </p>
        )
      )}
    </div>
  );
}
