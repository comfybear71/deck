/**
 * Shared **chain last→first** rules for every genre that renders a
 * script sequence (Music video Script Sequence, Sunny Banks / Skidmarks /
 * Shorts God Script). PR #168 shipped the Music-video toggle; this file
 * is the one helper so the other shows do not grow a second copy of the
 * fill rules.
 *
 * Default OFF everywhere. When ON, a finished clip's server last frame
 * may become the **next** clip's starting plate (`source: "chained"`)
 * only when that next start is empty or already chain-sourced.
 *
 * Never clobbers:
 * - Clip 1 upload (`upload`)
 * - Generate plates / Make plate (`generated`)
 * - sleeve Keep / From sleeve (`library`)
 *
 * A still with a URL and no `source` is treated as generated (already
 * filled) — same as `runAnimateExistingPlates` before this helper existed.
 */

export type ChainStillSource = "chained" | "generated" | "upload" | "library";

export type ChainStill = {
  source?: string;
  /** Present when this start already has bytes / a Blob URL. */
  url?: string;
} | null | undefined;

/**
 * Source-only rule. Empty / missing source → allow. `chained` → allow
 * (refresh the chain). `upload` / `generated` / `library` → never.
 */
export function plateStillAllowsChainFill(still: { source?: string } | null | undefined): boolean {
  if (!still?.source) return true;
  return still.source === "chained";
}

/**
 * Whether chain mode may write a last-frame still onto this next start.
 * Empty (no url, no source) → yes. Already `source: "chained"` → yes.
 * A URL with no source → no (treat as generated / already filled).
 */
export function nextStartAllowsChainFill(still: ChainStill): boolean {
  if (!still?.url && !still?.source) return true;
  if (still.url && !still.source) return false;
  return plateStillAllowsChainFill(still);
}

export type ChainFillPlan =
  | { action: "skip" }
  | { action: "fill"; url: string }
  | { action: "fail"; message: string };

/**
 * After clip `fromIndex` finishes, should we write `lastFrameUrl` onto
 * the next start? Pure — no I/O. `fromIndex` is 0-based.
 */
export function planChainLastFrameFill(args: {
  chainOn: boolean;
  fromIndex: number;
  nextIndexExists: boolean;
  lastFrameUrl?: string;
  nextStill: ChainStill;
}): ChainFillPlan {
  if (!args.chainOn || !args.nextIndexExists) return { action: "skip" };
  if (!nextStartAllowsChainFill(args.nextStill)) return { action: "skip" };
  if (!args.lastFrameUrl) {
    return {
      action: "fail",
      message: `Couldn't carry clip ${args.fromIndex + 1}'s last frame into clip ${args.fromIndex + 2}: the server couldn't capture this render's last frame.`,
    };
  }
  return { action: "fill", url: args.lastFrameUrl };
}

/**
 * Loop bounds for a full sequence run vs one selected clip.
 * `onlyClipIndex` (when set) wins over `startAtClipIndex` and runs
 * exactly that one clip, then stops — chain fill onto the *next* start
 * is still allowed by the caller after that clip; this helper only
 * bounds the render/plate loop itself.
 */
export function clipLoopBounds(args: {
  length: number;
  startAtClipIndex?: number;
  onlyClipIndex?: number;
}): { ok: true; start: number; endExclusive: number } | { ok: false; message: string } {
  const length = args.length;
  if (length <= 0) return { ok: false, message: "No clips to render." };
  if (args.onlyClipIndex !== undefined) {
    const i = args.onlyClipIndex;
    if (!Number.isInteger(i) || i < 0 || i >= length) {
      return { ok: false, message: `Clip ${i + 1} is not in this sequence.` };
    }
    return { ok: true, start: i, endExclusive: i + 1 };
  }
  const start = Math.max(0, Math.min(args.startAtClipIndex ?? 0, length));
  return { ok: true, start, endExclusive: length };
}

export function chainLastFrameToggleLabel(on: boolean): string {
  return on ? "Chain last→first · ON" : "Chain last→first";
}

export function chainLastFrameToggleTitle(on: boolean): string {
  return on
    ? "ON: after each clip renders, capture its last frame and set it as the next clip's starting image when that start is empty or was itself auto-chained. Never overwrites Generate plates, Clip 1 upload, or sleeve Keep."
    : "OFF (default): each clip keeps its own Generate plates / Make plate / upload / sleeve still. Tap to enable Chain last→first continuity.";
}
