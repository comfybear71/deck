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
  /** Solid background color class, used for compact chip/dot indicators. */
  bg: string;
}

/**
 * v0 project graph — see lib/graph.ts. `hub` is Deck/The Tab itself,
 * `project` is a real sibling project, `placeholder` is the "+ project"
 * stand-in for whatever comes next.
 */
export type GraphNodeKind = "project" | "hub" | "placeholder";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  role: string;
  /** Optional link into a control-plane lane — null when not (yet) mapped. */
  suit: Suit | null;
  /**
   * Marks this node as the visually primary one within its `kind` — sorts
   * first and renders larger/highlighted. See `orderedNodes` in lib/graph.ts.
   * Optional; only one node should set this at a time in v0.
   */
  featured?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Budju (budju.xyz/trade) portfolio glance — seed data shaped so a later
 * live refresh (polling budju's API) can slot in without changing the
 * shape consumers read. See data/budju.json + the README's "Budju node"
 * section. Deliberately NOT the full trade UI: no wallet state, no full
 * asset list, no order/trade actions.
 */
export type BudjuSignalType = "near-buy" | "near-sell" | "cooldown";

export interface BudjuSignal {
  id: string;
  /** Ticker, e.g. "UNI". */
  asset: string;
  type: BudjuSignalType;
  /** Budju's tier label, e.g. "T1" / "T2" — shown as-is, not interpreted. */
  tier?: string;
  /** Units held, if known. */
  qty?: number;
  /** Last known price. */
  price: number;
  /** 24h-style change, signed percentage points (e.g. -4.5, 7.9). */
  changePct: number;
  buyBelow: number;
  sellAbove: number;
  /** Current price used to position the buy/sell band marker. */
  current: number;
  /** Optional "X% to buy" callout for near-buy signals. */
  toBuyPct?: number;
}

export interface BudjuSplit {
  cryptoPct: number;
  cryptoUSD: number;
  usdcPct: number;
  usdcUSD: number;
}

export interface BudjuPool {
  totalUSD: number;
  assetCount: number;
  hasCash: boolean;
}

export interface BudjuData {
  url: string;
  /** ISO timestamp of the last live refresh, or null for seed/static data. */
  updatedAt: string | null;
  pool: BudjuPool;
  split: BudjuSplit;
  signals: BudjuSignal[];
}
