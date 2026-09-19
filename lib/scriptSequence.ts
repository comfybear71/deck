/**
 * Parses Stuart's own hand-written "script" format (2026-09-14, the
 * 16-part "Liquid Horizon" black-and-white trippy sequence) into
 * structured parts — the input half of the "paste a script, get a real
 * clip timeline" automation he asked for. Pure and synchronous, no
 * network/DOM — fully unit-testable independent of the render pipeline
 * that actually consumes its output (`buildScriptSequenceSegments` in
 * `lib/skidmarks.ts`).
 *
 * **Format matched, exactly as Stuart pasted it** (no line breaks
 * between parts — one continuous blob):
 *   `Part <N> (<start> - <end>) — <Title>[Duration: ...]. <description>`
 * repeated, each new `Part <N> (` immediately following the previous
 * part's description with no separator. `<start>`/`<end>` are `m:ss`
 * (or bare seconds). The `[Duration: ...]` bracket is intentionally
 * discarded, not trusted — see `ScriptSequencePart.startSec`/`endSec`'s
 * doc comment for why the *header's* own start/end times are the real
 * source of truth instead, per Stuart's explicit "don't trust the 15
 * seconds in the prompt" ask.
 *
 * **Also accepts a second real shape** (2026-09-16, a script pasted from
 * a different AI, one Stuart asked to be able to just paste straight
 * in): a markdown `###` heading per part instead of a trailing period —
 * `### Part <N> (<start> - <end>) — <Title> [Duration: ...]` on its own
 * line — followed by a `**Positive Prompt:**` line and an optional
 * `**Negative Prompt:**` line. Both header shapes are matched by the
 * same relaxed header regex below (the trailing period after the
 * bracket is now optional, and a leading `#`/`##`/`###` is allowed and
 * discarded); which one Stuart pasted needs no separate flag or mode.
 * The `**Negative Prompt:**` split only ever fires when that literal
 * label is actually present in the text — a script with no negative
 * prompts (Liquid Horizon, or anything pasted before this) parses
 * exactly as it always has, `negativePrompt` simply absent.
 */

export interface ScriptSequencePart {
  /** 1-based, as written in the script (`Part 1`, `Part 2`, ...) — not
   * re-derived from array position, so a caller can tell if the script
   * skipped or duplicated a number. */
  index: number;
  title: string;
  /** From the part's own `(start - end)` header, in whole seconds —
   * this, not the `[Duration: ...]` bracket inside the prompt text, is
   * what `buildScriptSequenceSegments` uses to size each clip. A
   * duration only ever *described* in prose to a video model is a
   * request, not a guarantee; the header's own numbers become each
   * built segment's real `startSec`/`endSec`, which
   * `lib/clipGeneration.ts`'s `computePlateDurationSec` clamps into an
   * actual `durationSec` sent to the render backend. */
  startSec: number;
  endSec: number;
  /** Everything after the `[Duration: ...]` bracket, trimmed, with a
   * leading `**Positive Prompt:**` label (if present) stripped and a
   * trailing `**Negative Prompt:**` section (if present) split off into
   * `negativePrompt` instead — the actual shot description, sent
   * verbatim as this clip's `shotPrompt`. */
  prompt: string;
  /** The part's own `**Negative Prompt:**` text, when the script
   * actually included one — trimmed, label stripped. `undefined` when
   * the script never wrote a negative prompt for this part (the
   * original format, or a labelled-format part that just left it out),
   * never defaulted to `""` so a caller can tell "none written" apart
   * from "written blank". See `lib/clipGeneration.ts`'s
   * `BuildClipGenerationRequestParams.userNegativePrompt` doc comment
   * for where this actually reaches a real model (Vocal/LTX only —
   * Instrumental's Grok/H3 backends have no negative-prompt channel in
   * this app at all, so a part that resolves Instrumental still stores
   * this but nothing sends it anywhere). */
  negativePrompt?: string;
}

function parseTimeToSec(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed.includes(":")) return Math.max(0, Math.round(Number(trimmed) || 0));
  const [minutesStr, secondsStr] = trimmed.split(":");
  const minutes = Number(minutesStr) || 0;
  const seconds = Number(secondsStr) || 0;
  return Math.max(0, Math.round(minutes * 60 + seconds));
}

// Leading `#`/`##`/`###` (a markdown heading, 2026-09-16 format) is
// allowed and discarded; the bracket itself is still required (a script
// with no `[...]` at all isn't one of the two real shapes this parses),
// but the trailing period after it is now optional — the original
// format always has one ("...]. High-contrast..."), the markdown one
// never does (the heading just ends after the bracket, description
// starts on the next line). Title excludes newlines so a markdown
// heading's own line boundary can't leak into it.
const PART_HEADER_RE =
  /^#{0,6}\s*Part\s+(\d+)\s*\(\s*([\d:.]+)\s*-\s*([\d:.]+)\s*\)\s*[—-]\s*([^[\n]*?)\s*\[[^\]]*\]\.?\s*([\s\S]*)$/;

// Matches a `**Positive Prompt:**`/`**Negative Prompt:**` label —
// markdown `**` emphasis optional either side, colon optional, case
// insensitive, so "Positive Prompt:", "**Positive Prompt**", and
// "positive prompt" all match the same way. `POSITIVE_LABEL_RE` is
// anchored to the very start of the (already-trimmed) body text — it
// only ever strips a label that's actually leading it, never one that
// happens to appear later as prose.
const POSITIVE_LABEL_RE = /^\*{0,2}\s*Positive\s*Prompt\s*:?\s*\*{0,2}\s*/i;
// Anchored to the start of a line (start-of-string or right after a
// `\n`), not searched anywhere in the text — a real shot description
// can plausibly use the words "negative" and "prompt" in ordinary prose
// (this file's own doc comments do); only a line that *starts* with the
// label is the actual marker, same as how Stuart's source always writes
// it on its own line.
const NEGATIVE_LABEL_RE = /(?:^|\n)\s*\*{0,2}\s*Negative\s*Prompt\s*:?\s*\*{0,2}\s*/i;

/** Splits a header's trailing body text into its shot prompt and,
 * when the script actually labelled one, its negative prompt — see
 * `ScriptSequencePart.negativePrompt`'s doc comment. A body with no
 * `Negative Prompt:` label anywhere just becomes the whole prompt,
 * unchanged from this parser's original, single-block behavior. Pure. */
function splitPositiveNegative(rawBody: string): { prompt: string; negativePrompt?: string } {
  const body = rawBody.trim();
  const negMatch = body.match(NEGATIVE_LABEL_RE);
  const hasNegIndex = negMatch && typeof negMatch.index === "number";
  const promptSection = hasNegIndex ? body.slice(0, negMatch!.index) : body;
  const negativePrompt = hasNegIndex ? body.slice(negMatch!.index! + negMatch![0].length).trim() || undefined : undefined;
  const prompt = promptSection.trim().replace(POSITIVE_LABEL_RE, "").trim();
  return negativePrompt ? { prompt, negativePrompt } : { prompt };
}

/**
 * Splits and parses a pasted script into ordered parts. Never throws —
 * a chunk that doesn't match the expected header shape is silently
 * skipped (not defaulted/guessed), so a caller can compare
 * `parts.length` against however many `Part N` markers it expects and
 * show an honest "only found X of Y" rather than trust a partial parse
 * blindly. Returns `[]` for blank/unparseable input.
 */
export function parseScriptSequence(script: string): ScriptSequencePart[] {
  const trimmed = script.trim();
  if (!trimmed) return [];

  const chunks = trimmed
    .split(/(?=#{0,6}\s*Part\s+\d+\s*\()/g)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const parts: ScriptSequencePart[] = [];
  for (const chunk of chunks) {
    const match = chunk.match(PART_HEADER_RE);
    if (!match) continue;
    const [, indexStr, startStr, endStr, title, body] = match;
    const startSec = parseTimeToSec(startStr);
    const endSec = parseTimeToSec(endStr);
    if (endSec <= startSec) continue; // a real, if malformed, header — never build a zero/negative-length clip
    const { prompt, negativePrompt } = splitPositiveNegative(body);
    parts.push({
      index: Number(indexStr),
      title: title.trim(),
      startSec,
      endSec,
      prompt,
      ...(negativePrompt ? { negativePrompt } : {}),
    });
  }
  return parts;
}

/**
 * Canonical part-header type words for music-video scripts — the same
 * set `parseScriptPartKind` / `lib/scriptSequenceRunner.ts` recognizes.
 * Display casing only; matching is case-insensitive.
 */
export const SCRIPT_SEQUENCE_TYPE_WORDS = [
  "Vocal",
  "Intro",
  "Outro",
  "Bridge",
  "Lead",
  "Break",
  "Instrumental",
] as const;

export type ScriptSequenceTypeWord = (typeof SCRIPT_SEQUENCE_TYPE_WORDS)[number];

const OTHER_SINGER_TITLE_RE = /^other[\s-]?singer\s*[:\-]?\s*\(?\s*([^)]*?)\s*\)?$/i;

const CANONICAL_TYPE_BY_LOWER: Record<string, ScriptSequenceTypeWord> = {
  vocal: "Vocal",
  intro: "Intro",
  outro: "Outro",
  bridge: "Bridge",
  lead: "Lead",
  "break": "Break",
  instrumental: "Instrumental",
};

/**
 * Normalizes a part header's title field to the canonical type word
 * (or `Other Singer: Name`) when it already names a known kind.
 * Unrecognized titles (e.g. "The Liquid Horizon") are returned trimmed
 * but otherwise unchanged — Format never invents a type word and never
 * rewrites shot prose.
 */
export function canonicalizeScriptPartTitle(rawTitle: string): string {
  const title = rawTitle.trim();
  if (!title) return title;
  const other = title.match(OTHER_SINGER_TITLE_RE);
  if (other) {
    const name = other[1]?.trim();
    return name ? `Other Singer: ${name}` : "Other Singer";
  }
  return CANONICAL_TYPE_BY_LOWER[title.toLowerCase()] ?? title;
}

/**
 * One-tap Format for music-video script sequences: rewrites **only**
 * each part header's type-word title to canonical casing / `Other
 * Singer: Name` shape. Shot prose, duration brackets, times, and part
 * numbers are left byte-for-byte alone. Idempotent. Does not rebuild a
 * clip timeline — callers update the draft text only; remint-safe
 * rebuild happens later via `buildScriptSequenceSegments` when Timeline
 * / Generate is tapped.
 */
export function formatScriptSequencePartTitles(script: string): string {
  // Title sits between the em/en dash and the `[Duration…]` bracket —
  // same span `PART_HEADER_RE` captures. Global, in-place replace so
  // unrecognized titles and all body text stay untouched.
  // No leading-newline requirement: real pastes often run parts
  // back-to-back with no separator (Liquid Horizon).
  const titleInHeaderRe =
    /(#{0,6}\s*Part\s+\d+\s*\(\s*[\d:.]+\s*-\s*[\d:.]+\s*\)\s*[—-]\s*)([^[\n]*?)(?=\s*\[[^\]]*\])/gi;
  return script.replace(titleInHeaderRe, (_full, prefix: string, title: string) => {
    return `${prefix}${canonicalizeScriptPartTitle(title)}`;
  });
}

export type ScriptSequenceHighlightKind =
  | "plain"
  | "vocal"
  | "intro"
  | "outro"
  | "bridge"
  | "lead"
  | "break"
  | "instrumental"
  | "other-singer";

export type ScriptSequenceHighlightSegment =
  | { kind: "plain"; text: string }
  | { kind: Exclude<ScriptSequenceHighlightKind, "plain">; text: string };

function highlightKindForTitle(title: string): Exclude<ScriptSequenceHighlightKind, "plain"> | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (OTHER_SINGER_TITLE_RE.exec(trimmed)) return "other-singer";
  switch (CANONICAL_TYPE_BY_LOWER[trimmed.toLowerCase()]) {
    case "Vocal":
      return "vocal";
    case "Intro":
      return "intro";
    case "Outro":
      return "outro";
    case "Bridge":
      return "bridge";
    case "Lead":
      return "lead";
    case "Break":
      return "break";
    case "Instrumental":
      return "instrumental";
    default:
      return null;
  }
}

/**
 * Splits raw script text into plain / type-word segments for the
 * Script Sequence highlight overlay. Concatenating every segment's
 * `text` reconstructs `raw` exactly. Only the part-header title span
 * (between — and `[Duration…]`) is ever tagged; shot prose stays plain.
 */
export function buildScriptSequenceHighlightSegments(raw: string): ScriptSequenceHighlightSegment[] {
  const segments: ScriptSequenceHighlightSegment[] = [];
  const headerTitleRe =
    /(#{0,6}\s*Part\s+\d+\s*\(\s*[\d:.]+\s*-\s*[\d:.]+\s*\)\s*[—-]\s*)([^[\n]*?)(?=\s*\[[^\]]*\])/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = headerTitleRe.exec(raw)) !== null) {
    const prefix = match[1] ?? "";
    const title = match[2] ?? "";
    const titleStart = match.index + prefix.length;
    const titleEnd = titleStart + title.length;
    if (titleStart > lastIndex) {
      segments.push({ kind: "plain", text: raw.slice(lastIndex, titleStart) });
    }
    const kind = highlightKindForTitle(title);
    segments.push(kind ? { kind, text: title } : { kind: "plain", text: title });
    lastIndex = titleEnd;
  }
  if (lastIndex < raw.length) {
    segments.push({ kind: "plain", text: raw.slice(lastIndex) });
  }
  return segments;
}

/** Opaque text colours for the overlay + colour-tag legend (script box only). */
export const SCRIPT_SEQUENCE_HIGHLIGHT_CLASSES: Record<ScriptSequenceHighlightKind, string> = {
  plain: "text-white",
  vocal: "text-rose-300",
  intro: "text-sky-300",
  outro: "text-violet-300",
  bridge: "text-amber-300",
  lead: "text-emerald-300",
  "break": "text-orange-300",
  instrumental: "text-zinc-300",
  "other-singer": "text-fuchsia-300",
};

/** Colour-tag legend chips shown under the script box (display only). */
export const SCRIPT_SEQUENCE_COLOUR_TAGS: { label: string; kind: ScriptSequenceHighlightKind }[] = [
  { label: "[Vocal]", kind: "vocal" },
  { label: "[Intro]", kind: "intro" },
  { label: "[Outro]", kind: "outro" },
  { label: "[Bridge]", kind: "bridge" },
  { label: "[Lead]", kind: "lead" },
  { label: "[Break]", kind: "break" },
  { label: "[Instrumental]", kind: "instrumental" },
  { label: "[Other Singer: Name]", kind: "other-singer" },
];
