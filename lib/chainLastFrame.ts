/**
 * Shared **chain last→first** rules for every genre that renders a
 * script sequence (Music video Script Sequence, Sunny Banks / Skidmarks /
 * Shorts God Script). PR #168 shipped the Music-video toggle; this file
 * is the one helper so the other shows do not grow a second copy of the
 * fill rules.
 *
 * **Per-row control, not a global toggle (PR #258+)** — a real reported
 * confusion, Stuart's own words: "it will not know what to chain?" A
 * single switch down at the bottom of a whole script, once PR #257
 * shipped it, gave no way to say *which* row should start from *which*
 * other row's last frame. `resolveChainFromPreviousStatus` /
 * `resolveRowStartPlateUrl` below are the new mechanism: every row past
 * the first gets its own **Chain from shot N** toggle (N = the row right
 * above it), off by default, shown right next to that row's own
 * Make plate / Render this. The caller (one per genre) is the only
 * thing that differs — it resolves "is shot N actually done, and what's
 * its last frame" from whatever that genre's own runtime model looks
 * like, then hands this file's pure functions a plain
 * `{ previousDone, previousLastFrameUrl, previousVideoUrl }` shape.
 *
 * **The global toggle + its own forward-auto-chain are gone from the UI**
 * in both `SkidmarksSunnyBanksPanel` and `SkidmarksScriptSequencePanel`
 * — a render no longer silently decides on its own which *other* clip
 * it's about to feed into. `planChainLastFrameFill` below (the old
 * "after this clip renders, auto-fill the next empty start" rule) stays
 * exported and still backs `lib/scriptSequenceRunner.ts`'s
 * `runAnimateExistingPlates`/`runScriptSequence` internals, which are
 * untested-by-removal on purpose (their own test suites pin real,
 * wanted behavior) — but neither panel's UI ever turns that path on
 * anymore, so in practice it's inert history, not a second live chain
 * mechanism fighting the new one.
 *
 * Default OFF everywhere. Never clobbers a plate Stuart uploaded or
 * made with Make plate / Generate plates *unless* he deliberately turns
 * that row's own Chain toggle on — turning it on is the explicit action
 * that's allowed to override what that row would otherwise start from;
 * turning it back off reverts instantly, because the row's own stored
 * plate/still was never touched in the first place (see
 * `resolveRowStartPlateUrl`'s doc comment).
 *
 * Never clobbers (the old forward-fill path only):
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

// ---------------------------------------------------------------------
// Per-row "Chain from shot N" (PR #258+) — see this module's doc
// comment for why this replaced the old global bottom toggle.
// ---------------------------------------------------------------------

/**
 * What one row's "Chain from shot N" control should show right now.
 * Pure — the caller resolves `previousDone`/`previousLastFrameUrl`/
 * `previousVideoUrl` from whatever that genre's own runtime model looks
 * like (a Sunny Banks row runtime, a Music video persisted render) and
 * `extracting`/`extractionError` from its own local "is a free last-
 * frame extraction in flight for shot N right now" state.
 */
export type ChainFromPreviousStatus =
  | { kind: "off" }
  | { kind: "waiting"; fromRowNumber: number }
  | { kind: "ready"; fromRowNumber: number; url: string }
  | { kind: "need-extract"; fromRowNumber: number; videoUrl: string }
  | { kind: "extracting"; fromRowNumber: number }
  | { kind: "unavailable"; fromRowNumber: number; message: string };

/**
 * Resolves a row's chain status from the toggle plus whatever is known
 * about the previous row (shot `fromRowNumber`, 1-based — the previous
 * row's own position). No I/O: a `"need-extract"` result means the
 * caller should kick off the free server-side last-frame extraction
 * (`lib/extractLastFrame.ts`) and come back with `extracting: true`
 * while it's in flight, then either `previousLastFrameUrl` (success) or
 * `extractionError` (honest failure) once it resolves.
 */
export function resolveChainFromPreviousStatus(args: {
  chainOn: boolean;
  fromRowNumber: number;
  previousDone: boolean;
  previousLastFrameUrl?: string;
  previousVideoUrl?: string;
  extracting?: boolean;
  extractionError?: string;
}): ChainFromPreviousStatus {
  if (!args.chainOn) return { kind: "off" };
  if (!args.previousDone) return { kind: "waiting", fromRowNumber: args.fromRowNumber };
  if (args.previousLastFrameUrl) {
    return { kind: "ready", fromRowNumber: args.fromRowNumber, url: args.previousLastFrameUrl };
  }
  if (args.extracting) return { kind: "extracting", fromRowNumber: args.fromRowNumber };
  if (args.extractionError) {
    return { kind: "unavailable", fromRowNumber: args.fromRowNumber, message: args.extractionError };
  }
  if (args.previousVideoUrl) {
    return { kind: "need-extract", fromRowNumber: args.fromRowNumber, videoUrl: args.previousVideoUrl };
  }
  return {
    kind: "unavailable",
    fromRowNumber: args.fromRowNumber,
    message: `Shot ${args.fromRowNumber} has no saved clip yet to pull a last frame from.`,
  };
}

/**
 * The actual plate/still URL a render (or the row's own preview
 * thumbnail) should use, given this row's chain status. `"ready"`
 * always wins over the row's own manual/generated plate — flipping
 * that row's own Chain toggle on *is* the deliberate action that's
 * allowed to override it (see this module's doc comment). Every other
 * status falls straight back to `ownPlateUrl`, untouched — this
 * function never mutates anything, so turning Chain back off reverts
 * instantly: the row's own stored plate was never overwritten, only
 * shadowed while Chain was on and ready.
 */
export function resolveRowStartPlateUrl(args: { chainStatus: ChainFromPreviousStatus; ownPlateUrl?: string }): string | undefined {
  return args.chainStatus.kind === "ready" ? args.chainStatus.url : args.ownPlateUrl;
}

/** Whether a row with this chain status is safe to actually render —
 * blocks on everything except `"off"` (chain not in use) and
 * `"ready"` (chain resolved to a real frame). */
export function chainFromPreviousBlocksRender(status: ChainFromPreviousStatus): boolean {
  return status.kind !== "off" && status.kind !== "ready";
}

export function chainFromPreviousLabel(fromRowNumber: number): string {
  return `Chain from shot ${fromRowNumber}`;
}

export function chainFromPreviousButtonTitle(on: boolean, fromRowNumber: number): string {
  return on
    ? `ON: this shot starts from shot ${fromRowNumber}'s last frame instead of its own plate. Tap to turn off — nothing you uploaded or made with Make plate is touched.`
    : `Starts this shot from shot ${fromRowNumber}'s last frame instead of its own plate/still. Off by default; never touches an existing plate unless you turn this on.`;
}

/** One line of status text under the toggle, or `undefined` when there's
 * nothing extra to say (`"off"`/`"ready"` — a `"ready"` row shows its
 * own thumbnail instead, see each panel's own row chrome). */
export function chainFromPreviousStatusText(status: ChainFromPreviousStatus): string | undefined {
  switch (status.kind) {
    case "off":
    case "ready":
      return undefined;
    case "waiting":
      return `Waiting on shot ${status.fromRowNumber} to finish…`;
    case "need-extract":
    case "extracting":
      return `Finding shot ${status.fromRowNumber}'s last frame (free, no render)…`;
    case "unavailable":
      return status.message;
  }
}
