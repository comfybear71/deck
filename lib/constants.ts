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

/**
 * Graph node id for the Skidmarks vibe-director front end. GraphView
 * special-cases this id to render SkidmarksNodeCard/SkidmarksDetailSheet
 * instead of the generic GraphNodeCard/GraphNodeSheet.
 */
export const SKIDMARKS_NODE_ID = "skidmarks";

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

/**
 * Budju-style "this node has its own visual identity" treatment for a
 * graph node — distinctive border, background wash, glow, and avatar
 * color instead of the generic project-card look. See `GraphNodeCard` /
 * `GraphNodeSheet`.
 */
export interface GraphNodeAccent {
  ringClass: string;
  bgClass: string;
  glowClass: string;
  avatarBgClass: string;
  /** Subtitle/label accent color — same slot as a suit lane's `color`. */
  textClass: string;
}

/**
 * Per-node accent treatments, keyed by `GraphNode.accentId`
 * (`data/graph.json`). Each color language is deliberately distinct from
 * Budju's violet/sky primary (see `BudjuNodeCard`) and from Propfolio's
 * emerald/teal identity (`lib/propfolio.ts`) so sibling projects stay
 * recognizable at a glance instead of blurring into one generic card.
 *
 * `sgm` — Same Game Multi, an Aussie sports-betting SGM placeholder for
 * Stuart. Amber/gold reads as "betting/sport" and stays clear of both
 * Budju's violet and Propfolio's emerald.
 */
export const GRAPH_NODE_ACCENTS: Record<string, GraphNodeAccent> = {
  sgm: {
    ringClass: "border-amber-400/30",
    bgClass:
      "bg-gradient-to-br from-amber-500/[0.14] via-orange-500/[0.06] to-transparent",
    glowClass: "shadow-[0_0_40px_-14px_rgba(251,191,36,0.5)]",
    avatarBgClass: "bg-amber-400/15 text-amber-300",
    textClass: "text-amber-300",
  },
};

export const DIAL_MODES: DialMode[] = ["full", "slow", "pause"];

export const DIAL_LABEL: Record<DialMode, string> = {
  full: "Full",
  slow: "Slow",
  pause: "Pause",
};
