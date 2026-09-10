import type { HealthStatus } from "./types";

/**
 * Propfolio (Australian property portfolio tracker) health-status glance —
 * pure helpers over the seed shape in data/propfolio.json (see
 * lib/types.ts's PropfolioData). No network yet: `PropfolioData.lastCheckedAt`
 * is the seam a future health-check probe would fill in without changing
 * anything downstream of these helpers.
 */

interface HealthMeta {
  /** Chip label, e.g. "ERROR". */
  label: string;
  /** Background + text classes for the status chip. */
  chipClass: string;
  /** Solid dot color class. */
  dotClass: string;
  /** Ring/border accent used to make the error state visible on the node face. */
  ringClass: string;
}

export const HEALTH_META: Record<HealthStatus, HealthMeta> = {
  ok: {
    label: "OK",
    chipClass: "bg-emerald-400/15 text-emerald-300",
    dotClass: "bg-emerald-400",
    ringClass: "border-white/10",
  },
  error: {
    label: "ERROR",
    chipClass: "bg-rose-500/20 text-rose-300",
    dotClass: "bg-rose-500",
    ringClass: "border-rose-500/50",
  },
  unknown: {
    label: "UNKNOWN",
    chipClass: "bg-white/10 text-white/50",
    dotClass: "bg-white/30",
    ringClass: "border-white/10",
  },
};

export function formatCheckedAt(iso: string | null): string {
  if (!iso) return "Never checked — seed status only.";
  return `Last checked ${new Date(iso).toLocaleString()}.`;
}

/** `null` renders as an em dash — the TBD placeholder until live data lands. */
export function formatCount(count: number | null): string {
  return count === null ? "\u2014" : String(count);
}
