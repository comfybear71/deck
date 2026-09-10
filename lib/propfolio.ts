import type { HealthStatus, PropfolioData } from "./types";

/**
 * Propfolio (Australian property portfolio tracker) health-status glance —
 * pure helpers over the seed shape in data/propfolio.json (see
 * lib/types.ts's PropfolioData). No network yet: `PropfolioData.lastCheckedAt`
 * is the seam a future health-check probe would fill in without changing
 * anything downstream of these helpers.
 */

interface HealthAccent {
  /** Node card border color when this status warrants visual emphasis. */
  ringClass: string;
  /** Node card background tint. */
  bgClass: string;
  /** Node card box-shadow glow; empty string for statuses with no glow. */
  glowClass: string;
  /** Small corner dot marker glow; empty string means no dot marker. */
  dotGlowClass: string;
  /** Detail sheet status-note callout border + background. */
  noteBoxClass: string;
  /** Detail sheet status-note message text color. */
  noteTextClass: string;
  /** Detail sheet status-note secondary/sub-text color. */
  noteSubTextClass: string;
  /** Node face "P" avatar circle background + text color. */
  avatarBgClass: string;
  /** Node face inline status-note text color. */
  inlineTextClass: string;
}

interface HealthMeta {
  /** Chip label, e.g. "ERROR". */
  label: string;
  /** Background + text classes for the status chip. */
  chipClass: string;
  /** Solid dot color class, used inside the status chip. */
  dotClass: string;
  /** True for statuses worth calling out visually (ring/glow/corner dot) on the node face — error and degraded, not ok/unknown. */
  attention: boolean;
  accent: HealthAccent;
}

const neutralAccent: HealthAccent = {
  ringClass: "border-white/10",
  bgClass: "bg-white/[0.04]",
  glowClass: "",
  dotGlowClass: "",
  noteBoxClass: "border-white/5 bg-white/[0.03]",
  noteTextClass: "text-white/70",
  noteSubTextClass: "text-white/40",
  avatarBgClass: "bg-white/10 text-white/60",
  inlineTextClass: "text-white/50",
};

export const HEALTH_META: Record<HealthStatus, HealthMeta> = {
  ok: {
    label: "OK",
    chipClass: "bg-emerald-400/15 text-emerald-300",
    dotClass: "bg-emerald-400",
    attention: false,
    accent: neutralAccent,
  },
  degraded: {
    label: "DEGRADED",
    chipClass: "bg-amber-400/15 text-amber-300",
    dotClass: "bg-amber-400",
    attention: true,
    accent: {
      ringClass: "border-amber-400/40",
      bgClass: "bg-amber-400/[0.06]",
      glowClass: "shadow-[0_0_30px_-10px_rgba(251,191,36,0.45)]",
      dotGlowClass: "shadow-[0_0_8px_2px_rgba(251,191,36,0.6)]",
      noteBoxClass: "border-amber-400/25 bg-amber-400/[0.05]",
      noteTextClass: "text-amber-200",
      noteSubTextClass: "text-amber-200/60",
      avatarBgClass: "bg-amber-400/15 text-amber-300",
      inlineTextClass: "text-amber-300/90",
    },
  },
  error: {
    label: "ERROR",
    chipClass: "bg-rose-500/20 text-rose-300",
    dotClass: "bg-rose-500",
    attention: true,
    accent: {
      ringClass: "border-rose-500/50",
      bgClass: "bg-rose-500/[0.06]",
      glowClass: "shadow-[0_0_30px_-10px_rgba(244,63,94,0.5)]",
      dotGlowClass: "shadow-[0_0_8px_2px_rgba(244,63,94,0.7)]",
      noteBoxClass: "border-rose-500/25 bg-rose-500/[0.05]",
      noteTextClass: "text-rose-200",
      noteSubTextClass: "text-rose-200/60",
      avatarBgClass: "bg-rose-500/15 text-rose-300",
      inlineTextClass: "text-rose-300/90",
    },
  },
  unknown: {
    label: "UNKNOWN",
    chipClass: "bg-white/10 text-white/50",
    dotClass: "bg-white/30",
    attention: false,
    accent: neutralAccent,
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

/**
 * Fallback for `PropfolioData.url` when it's ever the empty-string "not
 * known yet" placeholder — the "Open Propfolio" action chip still needs
 * somewhere to point. `data/propfolio.json` already sets `url` to this
 * same address; this only covers the seam.
 */
export const PROPFOLIO_APP_URL = "https://propfolio.work";

/**
 * One-line status summary for the "Copy status" action chip \u2014 status
 * label, client/property counts, and (if set) the `statusNote`, joined for
 * a quick paste into a message or the Ask Grok box.
 */
export function statusOneLiner(data: PropfolioData): string {
  const meta = HEALTH_META[data.status];
  const headline = [
    `Propfolio: ${meta.label}`,
    `${formatCount(data.clientCount)} clients`,
    `${formatCount(data.propertyCount)} properties`,
  ].join(" \u00b7 ");

  return data.statusNote ? `${headline} \u2014 ${data.statusNote}` : headline;
}
