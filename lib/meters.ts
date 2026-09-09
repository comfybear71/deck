import type { DialMode, Meter, Suit } from "./types";

/** Meters with a closed / pending status are shown but never counted in totals. */
export function isCountable(meter: Meter): boolean {
  return (
    meter.amount !== null &&
    meter.status !== "closed" &&
    meter.status !== "pending"
  );
}

/** Sum of a lane's USD-denominated, countable meters. AUD is kept separate. */
export function sumLaneUSD(meters: Meter[], suit: Suit): number {
  return meters
    .filter((m) => m.suit === suit && m.currency === "USD" && isCountable(m))
    .reduce((total, m) => total + (m.amount ?? 0), 0);
}

/** Sum of a lane's AUD-denominated, countable meters (kept separate from USD). */
export function sumLaneAUD(meters: Meter[], suit: Suit): number {
  return meters
    .filter((m) => m.suit === suit && m.currency === "AUD" && isCountable(m))
    .reduce((total, m) => total + (m.amount ?? 0), 0);
}

/** Total estimated monthly burn in USD, across every lane. */
export function totalBurnUSD(meters: Meter[]): number {
  return meters
    .filter((m) => m.currency === "USD" && isCountable(m))
    .reduce((total, m) => total + (m.amount ?? 0), 0);
}

/** Total AUD burn kept as a separate subline (never silently converted). */
export function totalBurnAUD(meters: Meter[]): number {
  return meters
    .filter((m) => m.currency === "AUD" && isCountable(m))
    .reduce((total, m) => total + (m.amount ?? 0), 0);
}

export function laneHasHot(meters: Meter[], suit: Suit): boolean {
  return meters.some((m) => m.suit === suit && m.status === "hot");
}

export function laneMeters(meters: Meter[], suit: Suit): Meter[] {
  return meters.filter((m) => m.suit === suit);
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Glow intensity, 0..1, based on current burn vs the soft leash goal.
 * Clamped so the halo never fully disappears or fully maxes out.
 */
export function glowIntensity(burnUSD: number, leashGoalUSD: number): number {
  const ratio = leashGoalUSD > 0 ? burnUSD / leashGoalUSD : 0;
  return Math.min(1, Math.max(0.15, ratio / 2));
}

export function dialAffectsBurn(mode: DialMode): boolean {
  // Stub for v0: dials are UI-only and never mutate spend.
  // Future control-plane hook, e.g.:
  //   await setMode(suit, mode) -> pause/slow a lane's live integrations.
  return mode !== "pause";
}
