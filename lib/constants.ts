import type { SuitMeta, Suit, DialMode } from "./types";

/** Soft monthly leash goal, in USD. Ambient glow scales against this. */
export const LEASH_GOAL_USD = 400;

/**
 * Graph node id for the Budju portfolio glance — the primary/featured node.
 * GraphView special-cases this id to render BudjuNodeCard/BudjuDetailSheet
 * instead of the generic GraphNodeCard/GraphNodeSheet.
 */
export const BUDJU_NODE_ID = "budju";

/**
 * Graph node id for the Propfolio health/error status glance. GraphView
 * special-cases this id to render PropfolioNodeCard/PropfolioDetailSheet
 * instead of the generic GraphNodeCard/GraphNodeSheet.
 */
export const PROPFOLIO_NODE_ID = "propfolio";

export const SUIT_META: Record<Suit, SuitMeta> = {
  diamonds: {
    suit: "diamonds",
    glyph: "\u2666",
    label: "Models",
    color: "text-rose-400",
    glow: "shadow-rose-500/30",
    bg: "bg-rose-400",
  },
  spades: {
    suit: "spades",
    glyph: "\u2660",
    label: "Infra",
    color: "text-slate-200",
    glow: "shadow-slate-400/20",
    bg: "bg-slate-200",
  },
  hearts: {
    suit: "hearts",
    glyph: "\u2665",
    label: "Make",
    color: "text-rose-300",
    glow: "shadow-rose-400/20",
    bg: "bg-rose-300",
  },
  clubs: {
    suit: "clubs",
    glyph: "\u2663",
    label: "Life",
    color: "text-emerald-300",
    glow: "shadow-emerald-400/20",
    bg: "bg-emerald-300",
  },
};

export const SUIT_ORDER: Suit[] = ["diamonds", "spades", "hearts", "clubs"];

export const DIAL_MODES: DialMode[] = ["full", "slow", "pause"];

export const DIAL_LABEL: Record<DialMode, string> = {
  full: "Full",
  slow: "Slow",
  pause: "Pause",
};
