import type { BudjuSignal, BudjuSignalType } from "./types";

/**
 * Budju (budju.xyz/trade) portfolio glance — pure helpers over the seed
 * shape in data/budju.json (see lib/types.ts's BudjuData). No network, no
 * live refresh yet: `BudjuData.updatedAt` is the seam a future poll would
 * fill in without changing anything downstream of these helpers.
 */

interface SignalMeta {
  /** Short chip label, e.g. "NEAR BUY". */
  label: string;
  /** Background + text classes for the compact face chip. */
  chipClass: string;
  /** Text-only color class, used in the detail sheet header row. */
  textClass: string;
  /** Card border accent in the detail sheet. */
  borderClass: string;
  /** Buy/sell band marker + fill color classes. */
  markerClass: string;
  /** One-line description shown in the detail sheet. */
  description: string;
}

export const SIGNAL_META: Record<BudjuSignalType, SignalMeta> = {
  "near-buy": {
    label: "NEAR BUY",
    chipClass: "bg-emerald-400/15 text-emerald-300",
    textClass: "text-emerald-300",
    borderClass: "border-amber-400/30",
    markerClass: "bg-emerald-400",
    description: "Price is closing in on the buy threshold.",
  },
  "near-sell": {
    label: "NEAR SELL",
    chipClass: "bg-rose-400/15 text-rose-300",
    textClass: "text-rose-300",
    borderClass: "border-rose-400/30",
    markerClass: "bg-rose-400",
    description: "Price is closing in on the sell threshold.",
  },
  cooldown: {
    label: "COOLDOWN",
    chipClass: "bg-amber-400/10 text-amber-300/70",
    textClass: "text-amber-300/70",
    borderClass: "border-dashed border-amber-400/25",
    markerClass: "bg-amber-400/60",
    description: "Recently triggered — quiet until the cooldown clears.",
  },
};

/**
 * Actionable signals (near-buy / near-sell) surface ahead of cooldown-only
 * noise, but cooldowns are still included — Stuart wants them visible as a
 * quiet status, not hidden.
 */
export function sortSignals(signals: BudjuSignal[]): BudjuSignal[] {
  const rank: Record<BudjuSignalType, number> = {
    "near-buy": 0,
    "near-sell": 0,
    cooldown: 1,
  };
  return [...signals].sort((a, b) => rank[a.type] - rank[b.type]);
}

export function formatSignedPct(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

/**
 * 0..1 position of the current price along the [buyBelow, sellAbove] band —
 * 0 sits at the buy threshold, 1 sits at the sell threshold. Used to place
 * the marker on the buy/sell band bar. Clamped so a stale/out-of-range
 * current price never draws off the track.
 */
export function bandPosition(signal: BudjuSignal): number {
  const { buyBelow, sellAbove, current } = signal;
  if (sellAbove <= buyBelow) return 0.5;
  const ratio = (current - buyBelow) / (sellAbove - buyBelow);
  return Math.min(1, Math.max(0, ratio));
}
