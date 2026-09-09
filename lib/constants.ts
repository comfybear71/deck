import type { SuitMeta, Suit, DialMode } from "./types";

/** Soft monthly leash goal, in USD. Ambient glow scales against this. */
export const LEASH_GOAL_USD = 400;

export const SUIT_META: Record<Suit, SuitMeta> = {
  diamonds: {
    suit: "diamonds",
    glyph: "\u2666",
    label: "Models",
    color: "text-rose-400",
    glow: "shadow-rose-500/30",
  },
  spades: {
    suit: "spades",
    glyph: "\u2660",
    label: "Infra",
    color: "text-slate-200",
    glow: "shadow-slate-400/20",
  },
  hearts: {
    suit: "hearts",
    glyph: "\u2665",
    label: "Make",
    color: "text-rose-300",
    glow: "shadow-rose-400/20",
  },
  clubs: {
    suit: "clubs",
    glyph: "\u2663",
    label: "Life",
    color: "text-emerald-300",
    glow: "shadow-emerald-400/20",
  },
};

export const SUIT_ORDER: Suit[] = ["diamonds", "spades", "hearts", "clubs"];

export const DIAL_MODES: DialMode[] = ["full", "slow", "pause"];

export const DIAL_LABEL: Record<DialMode, string> = {
  full: "Full",
  slow: "Slow",
  pause: "Pause",
};
