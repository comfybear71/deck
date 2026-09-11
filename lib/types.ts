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

/**
 * One real, dated charge for a meter — seed "invoice reality" data, not a
 * live feed. `daysAgo` (not an absolute date) is intentional: seed data
 * would otherwise age out of every window a week after it's written.
 * Storing an offset from "now" instead means a seeded charge always lands
 * where it was authored to (e.g. "Vercel's overage charge, 9 days back"),
 * no matter when Stuart actually opens the deep dive. See
 * `lib/spend-window.ts`'s "documented windowing rule" for how this and
 * ingested mail receipts (which DO carry absolute dates) combine into one
 * per-meter charge history.
 */
export interface ChargeRecord {
  /** Whole days before "now" this charge landed. 0 = today. */
  daysAgo: number;
  amount: number;
  currency: Currency;
  /** Short label for the deep dive's per-vendor charge list, e.g. "Overage". */
  note?: string;
}

export interface Meter {
  id: string;
  name: string;
  suit: Suit;
  /** null when the amount is not yet known (e.g. a pending plan). Doubles
   * as the fallback monthly run-rate used to prorate a window when no
   * `history` charge falls inside it — see `lib/spend-window.ts`. */
  amount: number | null;
  currency: Currency;
  cadence: Cadence;
  /** Seed / default dial position. Runtime state lives in localStorage. */
  mode: DialMode;
  status?: MeterStatus;
  notes?: string;
  alert?: MeterAlert;
  /**
   * Real, dated seed charges for this meter (most-recent-first isn't
   * required — callers sort). When at least one falls inside the selected
   * window, it wins over the prorated `amount` estimate entirely — see the
   * documented rule in `lib/spend-window.ts`.
   */
  history?: ChargeRecord[];
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
  /**
   * Optional short badge line shown on the node card and in the detail
   * sheet's header, e.g. "Project \u00b7 Betting" — overrides the generic
   * `KIND_LABEL` (+ suit lane) line when set. See `GraphNodeCard` /
   * `GraphNodeSheet`.
   */
  subtitle?: string;
  /**
   * Optional real, live outbound URL — only ever rendered as an "Open"
   * link in the detail sheet when actually set. Never fabricate one for a
   * node that doesn't have a real app/site yet.
   */
  url?: string;
  /**
   * Opt-in generic "Ask Grok" composer (`components/AskGrokPanel.tsx`) in
   * this node's detail sheet — the same shared, project-agnostic panel
   * Propfolio's sheet uses.
   */
  askGrok?: boolean;
  /**
   * Optional key into `GRAPH_NODE_ACCENTS` (lib/constants.ts) — gives a
   * node its own Budju-style distinctive border/glow/avatar treatment
   * instead of the generic card look, for a sibling project that deserves
   * its own visual identity.
   */
  accentId?: string;
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

/**
 * Propfolio health status node — seed data shaped so a later health-check
 * / ingest (e.g. a real probe behind `/api/health/propfolio`) can flip
 * `status` + `statusNote`, and a later live sync of Propfolio's own data
 * can fill in `clientCount`, `propertyCount`, `summary`, and `properties`,
 * all without any UI redesign. See data/propfolio.json + the README's
 * "Propfolio node" section. Deliberately NOT the full app: this is a
 * status glance, not a portfolio dashboard.
 *
 * `degraded` sits between `ok` and `error` — reachable and functioning in
 * some way (e.g. auth succeeds) but with an open question worth flagging
 * (e.g. unconfirmed onboarding/data state), not a full outage or hard
 * failure.
 */
export type HealthStatus = "ok" | "degraded" | "error" | "unknown";

/**
 * One property stub row for the detail sheet's "Properties" list.
 * Deliberately all-optional besides `id` — an empty array is a valid v0
 * state (nothing synced yet), and a future live sync only needs to fill
 * in whichever fields it actually has.
 */
export interface PropfolioProperty {
  id: string;
  address?: string;
  status?: string;
  clientName?: string;
}

export interface PropfolioData {
  /** Repo link — always known. */
  repoUrl: string;
  /** Live app URL; empty string is the "not known yet" placeholder. */
  url: string;
  status: HealthStatus;
  /** Short one-liner about the current status, for any status — null when there's nothing to say. */
  statusNote: string | null;
  /** ISO timestamp of the last health check, or null for seed/static data. */
  lastCheckedAt: string | null;
  /** Number of clients; null is the TBD placeholder until live data lands. */
  clientCount: number | null;
  /** Total properties tracked; null is the TBD placeholder until live data lands. */
  propertyCount: number | null;
  /** Short rollup one-liner, e.g. "12 properties across 4 clients". Empty string when there's nothing to summarize yet. */
  summary: string;
  /** Per-property stub rows — an empty array is a valid v0 state, not an error. */
  properties: PropfolioProperty[];
}
