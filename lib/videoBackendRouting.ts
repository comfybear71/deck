/**
 * Which video engine a row renders on (2026-09-30, Stuart's ask), in
 * every genre:
 *
 * - A talking row (someone speaks, so lips must match the voice) always
 *   renders on LTX (Comfy Cloud LTX 2.3, the only engine here that
 *   lip-syncs to our own audio).
 * - A silent row (a hold with no speech, a Crowd cutaway, a no-people
 *   Action shot) renders on Grok Imagine video 1.5 at 720p by default,
 *   or MiniMax H3 through a small Grok/H3 switch.
 * - Typing `[GROK]`, `[LTX]` or `[H3]` on a line overrides that choice
 *   for the next row. A talking row ignores `[GROK]` / `[H3]` (neither
 *   can lip-sync to the voice track) and says so on the row.
 *
 * Plain functions only: no fetch, no React, no storage. Safe to import
 * from a route and from the browser.
 */

/** An engine a Sunnybank row can render on. */
export type RowVideoBackend = "ltx" | "grok" | "h3";

/** The Grok/H3 switch for silent rows. */
export type SilentShotBackend = "grok" | "h3";

/** Everything a row chip can say, including Siray (Shorts, and Music
 * video Instrumental parts on the Siray engine). */
export type VideoBackendTag = RowVideoBackend | "siray";

/** Silent rows go to Grok unless the switch says H3. */
export const DEFAULT_SILENT_SHOT_BACKEND: SilentShotBackend = "grok";

/** Grok's output size for a silent row: 720p ($0.14/s), not the 1080p
 * ($0.25/s) the Music video Instrumental path uses, so a 5s hold costs
 * about the same as LTX rather than double. */
export const SILENT_SHOT_GROK_RESOLUTION = "720p";

/** `[GROK]` / `[LTX]` / `[H3]`, any case, spaces allowed inside. */
export const VIDEO_BACKEND_OVERRIDE_TAG_SOURCE = String.raw`\[\s*(?:GROK|LTX|H3)\s*\]`;

function overrideTagRe(): RegExp {
  return /\[\s*(GROK|LTX|H3)\s*\]/gi;
}

export function parseRowVideoBackend(value: unknown): RowVideoBackend | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  return v === "ltx" || v === "grok" || v === "h3" ? v : undefined;
}

export function normalizeSilentShotBackend(value: unknown): SilentShotBackend {
  return value === "h3" ? "h3" : DEFAULT_SILENT_SHOT_BACKEND;
}

/**
 * Pulls every `[GROK]` / `[LTX]` / `[H3]` off a line. The last one wins
 * when a line carries more than one. `rest` is the line with them
 * removed (spaces tidied), so the tag never reaches ElevenLabs or a
 * picture prompt.
 */
export function extractVideoBackendOverride(text: string): { rest: string; override?: RowVideoBackend } {
  let override: RowVideoBackend | undefined;
  const rest = text.replace(overrideTagRe(), (_, token: string) => {
    override = parseRowVideoBackend(token) ?? override;
    return " ";
  });
  if (!override) return { rest: text };
  return { rest: rest.replace(/[ \t]+/g, " ").trim(), override };
}

/** The same line with any backend tags removed. */
export function stripVideoBackendTags(text: string): string {
  return extractVideoBackendOverride(text).rest;
}

export interface RowVideoBackendChoice {
  backend: RowVideoBackend;
  /** A `[GROK]` / `[H3]` typed on a talking row, which was ignored. */
  ignoredOverride?: RowVideoBackend;
}

/**
 * The engine for one row. `kind` is `"speak"` for a talking row and
 * `"hold"` for a silent one (holds, Crowd cutaways, Action shots).
 */
export function pickRowVideoBackend(args: {
  kind: "speak" | "hold";
  override?: RowVideoBackend;
  silentDefault?: SilentShotBackend;
}): RowVideoBackendChoice {
  if (args.kind === "speak") {
    if (args.override && args.override !== "ltx") return { backend: "ltx", ignoredOverride: args.override };
    return { backend: "ltx" };
  }
  if (args.override) return { backend: args.override };
  return { backend: normalizeSilentShotBackend(args.silentDefault) };
}

/** `[GROK]`, `[LTX]`, `[H3]`, `[SIRAY]`. */
export function videoBackendTagLabel(backend: VideoBackendTag): string {
  return `[${backend.toUpperCase()}]`;
}

export function videoBackendName(backend: VideoBackendTag): string {
  if (backend === "grok") return "Grok";
  if (backend === "h3") return "H3";
  if (backend === "siray") return "Siray";
  return "LTX";
}

/** The note a talking row shows when a Grok/H3 tag was typed on it. */
export function ignoredVideoBackendWarning(ignored: RowVideoBackend): string {
  return `${videoBackendTagLabel(ignored)} ignored: talking lines stay on LTX so lips match the voice.`;
}

/**
 * What a row's chip shows. A finished row shows the engine it really
 * used (`used`, saved on the row). A row finished before this existed
 * has no saved engine; every Sunnybank clip before then was LTX, so it
 * reads `[LTX]`. Anything else shows what Render would use now.
 */
export function rowVideoBackendChip(args: {
  status: string;
  used?: RowVideoBackend;
  planned: RowVideoBackend;
}): RowVideoBackend {
  if (args.used) return args.used;
  if (args.status === "done") return "ltx";
  return args.planned;
}

/**
 * Music video's chip for one clip: the engine its latest plate render
 * really used (`lastSent.engine`, saved per plate), else what Render
 * would use now (Vocal → LTX, Instrumental → the clip's H3/Grok/Siray
 * switch). Music video already keeps silent (Instrumental) clips off
 * LTX, so this only shows it.
 */
export function musicVideoClipBackend(args: {
  vocal: boolean;
  instrumentalModel: "h3" | "grok" | "siray";
  sent?: ReadonlyArray<{ engine: string; sentAt: number } | undefined>;
}): VideoBackendTag {
  let latest: { engine: string; sentAt: number } | undefined;
  for (const entry of args.sent ?? []) {
    if (entry && (!latest || entry.sentAt > latest.sentAt)) latest = entry;
  }
  const used = latest?.engine.trim().toLowerCase();
  if (used === "ltx" || used === "grok" || used === "h3" || used === "siray") return used;
  return args.vocal ? "ltx" : args.instrumentalModel;
}
