/**
 * Parses Stuart's own hand-written "script" format into structured parts
 * — the input half of the "paste a script, get a real clip timeline"
 * automation. Pure and synchronous, no network/DOM — fully unit-testable
 * independent of the render pipeline that consumes its output
 * (`buildScriptSequenceSegments` in `lib/skidmarks.ts`).
 *
 * **Three real shapes** (all matched; which one Stuart pasted needs no
 * separate flag or mode):
 *
 * 1. **Sunny / Liquid-Horizon single-line** (2026-09-14) — no line breaks
 *    between parts, one continuous blob:
 *      `Part <N> (<start> - <end>) — <Title>[Duration: ...]. <description>`
 *    `<start>`/`<end>` are `m:ss` (or bare seconds). The `[Duration: ...]`
 *    bracket is intentionally discarded, not trusted — see
 *    `ScriptSequencePart.startSec`/`endSec`'s doc comment.
 *
 * 2. **Markdown labelled** (2026-09-16) — `### Part <N> (<start> - <end>)
 *    — <Title> [Duration: ...]` on its own line, then `**Positive
 *    Prompt:**` / optional `**Negative Prompt:**`. Same single-line
 *    header regex (trailing period optional; leading `#`/`##`/`###`
 *    allowed and discarded).
 *
 * 3. **Multiline Part 24** (Stuart iPhone live layout — highlight fixed
 *    in #163, parsing here):
 *      Part <N> (<start> - <end>)
 *      Vocal | Instrumental          # type word = part title (LTX/Grok)
 *      [Duration: Xs]                # optional; discarded
 *      Lyrics:                       # optional; kept in prompt body
 *      ...
 *      Positive Prompt:
 *      ...
 *      Negative Prompt:
 *      ...
 *    Type line also accepts Format aliases (Intro/Outro/Bridge/Lead/
 *    Break → still stored as written; Format maps them later) and
 *    `Other Singer: Name`. Lyrics stay in the shot prompt; Positive /
 *    Negative Prompt labels are stripped into `prompt` /
 *    `negativePrompt` the same way as the labelled shape.
 *
 * A script with no negative prompts (Liquid Horizon, or anything pasted
 * before labelled format) parses exactly as it always has,
 * `negativePrompt` simply absent.
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
 * unchanged from this parser's original, single-block behavior.
 *
 * `Positive Prompt:` is stripped whether it leads the body (labelled
 * markdown / single-line) or sits after an optional `Lyrics:` block
 * (multiline Part 24) — the Lyrics lines themselves stay in `prompt`.
 * Pure. */
function splitPositiveNegative(rawBody: string): { prompt: string; negativePrompt?: string } {
  const body = rawBody.trim();
  const negMatch = body.match(NEGATIVE_LABEL_RE);
  const hasNegIndex = negMatch && typeof negMatch.index === "number";
  const promptSection = hasNegIndex ? body.slice(0, negMatch!.index) : body;
  const negativePrompt = hasNegIndex
    ? body.slice(negMatch!.index! + negMatch![0].length).trim() || undefined
    : undefined;
  // Leading label (original labelled format)…
  let prompt = promptSection.trim().replace(POSITIVE_LABEL_RE, "").trim();
  // …or a mid-body line-start label after Lyrics / blank lines (Part 24).
  prompt = prompt.replace(/(?:^|\n)\s*\*{0,2}\s*Positive\s*Prompt\s*:?\s*\*{0,2}\s*/gi, (m, offset) =>
    offset === 0 ? "" : "\n"
  ).trim();
  return negativePrompt ? { prompt, negativePrompt } : { prompt };
}

const OTHER_SINGER_TITLE_RE = /^other[\s-]?singer\s*[:\-]?\s*\(?\s*([^)]*?)\s*\)?$/i;

/** Alias titles Format folds into Instrumental (case-insensitive). */
const INSTRUMENTAL_ALIASES = new Set([
  "instrumental",
  "intro",
  "outro",
  "bridge",
  "lead",
  "break",
]);

/** `Part N (m:ss - m:ss)` alone on the first line — multiline Part 24. */
const PART_TIMES_ONLY_RE =
  /^#{0,6}\s*Part\s+(\d+)\s*\(\s*([\d:.]+)\s*-\s*([\d:.]+)\s*\)\s*$/;

/** Optional `[Duration: …]` alone on a line (discarded; times come from the header). */
const DURATION_LINE_ONLY_RE = /^\[[^\]]*Duration[^\]]*\]\s*$/i;

/**
 * True when a lone line is a Part 24 type word (Vocal / Instrumental),
 * a Format alias (Intro/Outro/Bridge/Lead/Break), or Other Singer —
 * the same set title-first LTX/Grok routing recognizes via
 * `parseScriptPartKind`. Unrecognized creative titles are *not* type
 * lines (Liquid Horizon stays on the single-line path).
 */
function isMultilineTypeLine(raw: string): boolean {
  const title = raw.trim();
  if (!title) return false;
  if (OTHER_SINGER_TITLE_RE.test(title)) return true;
  const lower = title.toLowerCase();
  if (lower === "vocal") return true;
  if (INSTRUMENTAL_ALIASES.has(lower)) return true;
  return false;
}

/**
 * Parses one chunk in Stuart's multiline Part 24 layout. Returns null
 * when the chunk is not that shape (caller then tries / skips). Pure.
 */
function parseMultilinePartChunk(chunk: string): ScriptSequencePart | null {
  const lines = chunk.split(/\r?\n/);
  if (lines.length < 2) return null;
  const headerMatch = lines[0]!.trim().match(PART_TIMES_ONLY_RE);
  if (!headerMatch) return null;

  let i = 1;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (i >= lines.length) return null;
  const typeLine = lines[i]!.trim();
  if (!isMultilineTypeLine(typeLine)) return null;
  i++;

  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (i < lines.length && DURATION_LINE_ONLY_RE.test(lines[i]!.trim())) {
    i++;
  }

  const body = lines.slice(i).join("\n");
  const startSec = parseTimeToSec(headerMatch[2]!);
  const endSec = parseTimeToSec(headerMatch[3]!);
  if (endSec <= startSec) return null;
  const { prompt, negativePrompt } = splitPositiveNegative(body);
  return {
    index: Number(headerMatch[1]),
    title: typeLine,
    startSec,
    endSec,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
  };
}

/**
 * Splits and parses a pasted script into ordered parts. Never throws —
 * a chunk that doesn't match a known header shape (single-line Sunny /
 * labelled markdown, or multiline Part 24) is silently skipped (not
 * defaulted/guessed), so a caller can compare `parts.length` against
 * however many `Part N` markers it expects and show an honest "only
 * found X of Y" rather than trust a partial parse blindly. Returns `[]`
 * for blank/unparseable input.
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
    if (match) {
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
      continue;
    }
    const multiline = parseMultilinePartChunk(chunk);
    if (multiline) parts.push(multiline);
  }
  return parts;
}

/**
 * Canonical part-header type words for music-video scripts — the same
 * set `parseScriptPartKind` / `lib/scriptSequenceRunner.ts` recognizes.
 * Display casing only; matching is case-insensitive.
 */
/**
 * Types Stuart actually uses for music-video scripts: **Vocal** (singing
 * → LTX) and **Instrumental** (not singing → Grok, mouth closed).
 * Intro / Outro / Bridge / Lead / Break still parse if pasted, but Format
 * maps them to Instrumental and the colour legend does not show them.
 */
export const SCRIPT_SEQUENCE_TYPE_WORDS = ["Vocal", "Instrumental"] as const;

export type ScriptSequenceTypeWord = (typeof SCRIPT_SEQUENCE_TYPE_WORDS)[number];

/**
 * Normalizes a part header's title field to Vocal / Instrumental (or
 * `Other Singer: Name`) when it already names a known kind. Intro /
 * Outro / Bridge / Lead / Break → Instrumental. Unrecognized titles
 * (e.g. "The Liquid Horizon") are returned trimmed but otherwise
 * unchanged — Format never invents a type word and never rewrites shot
 * prose.
 */
export function canonicalizeScriptPartTitle(rawTitle: string): string {
  const title = rawTitle.trim();
  if (!title) return title;
  const other = title.match(OTHER_SINGER_TITLE_RE);
  if (other) {
    const name = other[1]?.trim();
    return name ? `Other Singer: ${name}` : "Other Singer";
  }
  const lower = title.toLowerCase();
  if (lower === "vocal") return "Vocal";
  if (INSTRUMENTAL_ALIASES.has(lower)) return "Instrumental";
  return title;
}

/**
 * One-tap Format for music-video script sequences: rewrites **only**
 * each part header's type-word title to Vocal / Instrumental (mapping
 * Intro/Outro/Bridge/Lead/Break → Instrumental) and canonicalizes
 * `Positive Prompt:` / `Negative Prompt:` labels. Shot prose, times,
 * and part numbers are left alone. Idempotent. Does not rebuild a clip
 * timeline — callers update the draft text only.
 */
export function formatScriptSequencePartTitles(script: string): string {
  // Title sits between the em/en dash and the `[Duration…]` bracket —
  // same span `PART_HEADER_RE` captures. Global, in-place replace so
  // unrecognized titles and all body text stay untouched.
  const titleInHeaderRe =
    /(#{0,6}\s*Part\s+\d+\s*\(\s*[\d:.]+\s*-\s*[\d:.]+\s*\)\s*[—-]\s*)([^[\n]*?)(?=\s*\[[^\]]*\])/gi;
  let next = script.replace(titleInHeaderRe, (_full, prefix: string, title: string) => {
    return `${prefix}${canonicalizeScriptPartTitle(title)}`;
  });
  // Label-only normalize (line-start). Never touches shot prose mid-line.
  next = next.replace(
    /^(\*{0,2}\s*)Positive\s*Prompt(\s*:?\s*\*{0,2})/gim,
    "Positive Prompt:"
  );
  next = next.replace(
    /^(\*{0,2}\s*)Negative\s*Prompt(\s*:?\s*\*{0,2})/gim,
    "Negative Prompt:"
  );
  return next;
}

export type ScriptSequenceHighlightKind =
  | "plain"
  | "part"
  | "vocal"
  | "instrumental"
  | "duration"
  | "positive-prompt"
  | "negative-prompt"
  | "other-singer";

export type ScriptSequenceHighlightSegment =
  | { kind: "plain"; text: string }
  | { kind: Exclude<ScriptSequenceHighlightKind, "plain">; text: string };

function highlightKindForTitle(title: string): Exclude<ScriptSequenceHighlightKind, "plain"> | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (OTHER_SINGER_TITLE_RE.exec(trimmed)) return "other-singer";
  const canonical = canonicalizeScriptPartTitle(trimmed);
  if (canonical === "Vocal") return "vocal";
  if (canonical === "Instrumental") return "instrumental";
  return null;
}

/** `Part N (m:ss - m:ss)` — times only; works on its own line (Stuart multiline) or leading a Sunny-style header. */
const PART_FIELD_RE = /#{0,6}\s*Part\s+\d+\s*\(\s*[\d:.]+\s*-\s*[\d:.]+\s*\)/gi;

/** `[Duration: …]` brackets only — random `[refs]` in prose stay plain. */
const DURATION_FIELD_RE = /\[[^\]]*Duration[^\]]*\]/gi;

/**
 * Positive/Negative Prompt labels at line start. Horizontal whitespace only
 * after the colon so same-line prose stays plain and every later label is
 * still found (a prior `\s*` that ate `\n` used to leave later labels white).
 * Markdown `**` optional either side. Group 1 is leading indent (plain);
 * group 2 is the coloured label; group 3 is Positive vs Negative.
 */
const PROMPT_LABEL_FIELD_RE =
  /^([^\S\n]*)(\*{0,2}[^\S\n]*(Positive|Negative)[^\S\n]*Prompt[^\S\n]*:?[^\S\n]*\*{0,2})/gim;

/**
 * Vocal / Instrumental alone on a line (multiline Part 24). Never matches
 * those words inside shot prose / lyric lines.
 */
const TYPE_LINE_RE = /^([^\S\n]*)(Vocal|Instrumental)([^\S\n]*)$/gim;

/**
 * Single-line header title between em/en dash and `[Duration…]` — the same
 * span Format rewrites. Captures the title only (not the dash / bracket).
 */
const HEADER_TITLE_RE =
  /#{0,6}\s*Part\s+\d+\s*\(\s*[\d:.]+\s*-\s*[\d:.]+\s*\)\s*[—-]\s*([^[\n]*?)(?=\s*\[[^\]]*\])/gi;

type ColourRange = {
  start: number;
  end: number;
  kind: Exclude<ScriptSequenceHighlightKind, "plain">;
};

function pushPlain(segments: ScriptSequenceHighlightSegment[], text: string) {
  if (!text) return;
  segments.push({ kind: "plain", text });
}

function addColourRange(ranges: ColourRange[], start: number, end: number, kind: ColourRange["kind"]) {
  if (end <= start) return;
  if (ranges.some((r) => start < r.end && end > r.start)) return;
  ranges.push({ start, end, kind });
}

function collectScriptSequenceColourRanges(raw: string): ColourRange[] {
  const ranges: ColourRange[] = [];

  const partRe = new RegExp(PART_FIELD_RE.source, PART_FIELD_RE.flags);
  for (const m of raw.matchAll(partRe)) {
    if (typeof m.index !== "number") continue;
    addColourRange(ranges, m.index, m.index + m[0].length, "part");
  }

  const durationRe = new RegExp(DURATION_FIELD_RE.source, DURATION_FIELD_RE.flags);
  for (const m of raw.matchAll(durationRe)) {
    if (typeof m.index !== "number") continue;
    addColourRange(ranges, m.index, m.index + m[0].length, "duration");
  }

  const promptRe = new RegExp(PROMPT_LABEL_FIELD_RE.source, PROMPT_LABEL_FIELD_RE.flags);
  for (const m of raw.matchAll(promptRe)) {
    if (typeof m.index !== "number") continue;
    const indent = m[1] ?? "";
    const label = m[2] ?? "";
    const which = m[3] ?? "";
    const labelStart = m.index + indent.length;
    const kind: ColourRange["kind"] = /^negative$/i.test(which) ? "negative-prompt" : "positive-prompt";
    addColourRange(ranges, labelStart, labelStart + label.length, kind);
  }

  const typeLineRe = new RegExp(TYPE_LINE_RE.source, TYPE_LINE_RE.flags);
  for (const m of raw.matchAll(typeLineRe)) {
    if (typeof m.index !== "number") continue;
    const indent = m[1] ?? "";
    const word = m[2] ?? "";
    const wordStart = m.index + indent.length;
    const kind = highlightKindForTitle(word);
    if (kind) addColourRange(ranges, wordStart, wordStart + word.length, kind);
  }

  const titleRe = new RegExp(HEADER_TITLE_RE.source, HEADER_TITLE_RE.flags);
  for (const m of raw.matchAll(titleRe)) {
    if (typeof m.index !== "number") continue;
    const title = m[1] ?? "";
    // Title starts after the full match prefix (everything before group 1).
    const titleStart = m.index + m[0].length - title.length;
    const kind = highlightKindForTitle(title);
    if (kind) addColourRange(ranges, titleStart, titleStart + title.length, kind);
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  return ranges;
}

/**
 * Splits raw script text into coloured segments for the Script Sequence
 * highlight overlay. Colours the Part 24 structural fields on both the
 * single-line Sunny-style header and Stuart's multiline layout:
 *   Part N (m:ss - m:ss)       → part
 *   Vocal | Instrumental       → vocal / instrumental (own line, or header type word)
 *   [Duration: Xs]             → duration
 *   Positive Prompt:           → positive-prompt (every occurrence; label only)
 *   Negative Prompt:           → negative-prompt (every occurrence; label only)
 * Shot prose / lyric lines stay plain. Concatenating every segment's `text`
 * reconstructs `raw` exactly.
 */
export function buildScriptSequenceHighlightSegments(raw: string): ScriptSequenceHighlightSegment[] {
  if (!raw) return [];
  const ranges = collectScriptSequenceColourRanges(raw);
  const segments: ScriptSequenceHighlightSegment[] = [];
  let last = 0;
  for (const range of ranges) {
    if (range.start < last) continue;
    if (range.start > last) pushPlain(segments, raw.slice(last, range.start));
    segments.push({ kind: range.kind, text: raw.slice(range.start, range.end) });
    last = range.end;
  }
  if (last < raw.length) pushPlain(segments, raw.slice(last));
  if (segments.length === 0 && raw.length > 0) pushPlain(segments, raw);
  return segments;
}

/** Opaque text colours for the overlay + colour-tag legend (script box only). */
export const SCRIPT_SEQUENCE_HIGHLIGHT_CLASSES: Record<ScriptSequenceHighlightKind, string> = {
  plain: "text-white",
  part: "text-sky-300",
  vocal: "text-rose-300",
  instrumental: "text-zinc-300",
  duration: "text-amber-300",
  "positive-prompt": "text-emerald-300",
  "negative-prompt": "text-violet-300",
  "other-singer": "text-fuchsia-300",
};

/**
 * Colour-tag legend chips for real Part 24 script fields only.
 * Intro/Outro/Bridge/Lead/Break/Other Singer are not legend keys
 * (Format maps the section aliases → Instrumental).
 */
export const SCRIPT_SEQUENCE_COLOUR_TAGS: { label: string; kind: ScriptSequenceHighlightKind }[] = [
  { label: "Part", kind: "part" },
  { label: "Vocal", kind: "vocal" },
  { label: "Instrumental", kind: "instrumental" },
  { label: "Duration", kind: "duration" },
  { label: "Positive Prompt", kind: "positive-prompt" },
  { label: "Negative Prompt", kind: "negative-prompt" },
];
