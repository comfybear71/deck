export type Suit = "diamonds" | "spades" | "hearts" | "clubs";

export type Currency = "USD" | "AUD";

export type Cadence = "monthly" | "balance" | "one-time" | "unknown";

export type DialMode = "full" | "slow" | "pause";

export type MeterStatus = "active" | "hot" | "alert" | "pending" | "closed";

export type AlertLevel = "warning" | "critical";

export interface MeterAlert {
  level: AlertLevel;
  message: string;
}

export interface Meter {
  id: string;
  name: string;
  suit: Suit;
  /** null when the amount is not yet known (e.g. a pending plan). */
  amount: number | null;
  currency: Currency;
  cadence: Cadence;
  /** Seed / default dial position. Runtime state lives in localStorage. */
  mode: DialMode;
  status?: MeterStatus;
  notes?: string;
  alert?: MeterAlert;
}

export interface SuitMeta {
  suit: Suit;
  glyph: string;
  label: string;
  color: string;
  glow: string;
}
