"use client";

import type { BudjuData } from "@/lib/types";
import { SIGNAL_META, formatUSD, sortSignals } from "@/lib/budju";

interface BudjuNodeCardProps {
  data: BudjuData;
  onOpen: () => void;
}

/**
 * Budju's node face — the primary/featured card in the v0 graph (see
 * BUDJU_NODE_ID + lib/graph.ts's orderedNodes). Deliberately bigger and
 * more highlighted than a generic GraphNodeCard, but still just a
 * glanceable summary: pool total, crypto/USDC split, and a couple of
 * signal chips. Tapping opens BudjuDetailSheet for the full three
 * sections — no trade UI lives on the face itself.
 */
export function BudjuNodeCard({ data, onOpen }: BudjuNodeCardProps) {
  const signals = sortSignals(data.signals);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Budju — portfolio glance. Pool total ${formatUSD(
        data.pool.totalUSD
      )}. Open details.`}
      className="group relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl border border-violet-400/25 bg-gradient-to-br from-violet-500/[0.12] via-sky-500/[0.06] to-transparent px-4 py-5 text-left shadow-[0_0_40px_-14px_rgba(167,139,250,0.5)] transition-colors active:scale-[0.99] hover:from-violet-500/[0.16] hover:via-sky-500/[0.09]"
    >
      <span
        aria-hidden
        className="absolute right-3 top-3 rounded-full bg-violet-400/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200"
      >
        Primary
      </span>

      <span className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-violet-200"
          style={{
            background: `conic-gradient(#a78bfa 0% ${data.split.cryptoPct}%, #34d399 ${data.split.cryptoPct}% 100%)`,
          }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-950 text-sm">
            B
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-white">
            Budju
          </span>
          <span className="mt-0.5 block text-[11px] uppercase tracking-wide text-white/40">
            Portfolio glance
          </span>
        </span>
      </span>

      <span className="flex items-end justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-2xl font-bold tabular-nums text-white">
            {formatUSD(data.pool.totalUSD)}
          </span>
          <span className="text-[11px] text-white/40">
            Pool total
            {data.pool.hasCash ? ` · ${data.pool.assetCount} assets + cash` : ""}
          </span>
        </span>

        <span className="flex flex-col items-end gap-1">
          <span className="text-[11px] font-medium text-sky-300">
            {data.split.cryptoPct}% crypto
          </span>
          <span className="text-[11px] font-medium text-emerald-300">
            {data.split.usdcPct}% USDC
          </span>
        </span>
      </span>

      <span
        aria-hidden
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/10"
      >
        <span
          className="h-full bg-gradient-to-r from-sky-400 to-violet-400"
          style={{ width: `${data.split.cryptoPct}%` }}
        />
        <span
          className="h-full bg-emerald-400"
          style={{ width: `${data.split.usdcPct}%` }}
        />
      </span>

      {signals.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          {signals.slice(0, 3).map((signal) => {
            const meta = SIGNAL_META[signal.type];
            return (
              <span
                key={signal.id}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${meta.chipClass}`}
              >
                {signal.asset}
                <span aria-hidden>·</span>
                {meta.label}
              </span>
            );
          })}
        </span>
      )}
    </button>
  );
}
