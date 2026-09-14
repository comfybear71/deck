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
  /** Everything after the `[Duration: ...].` bracket, trimmed — the
   * actual shot description, sent verbatim as this clip's `shotPrompt`. */
  prompt: string;
}

function parseTimeToSec(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed.includes(":")) return Math.max(0, Math.round(Number(trimmed) || 0));
  const [minutesStr, secondsStr] = trimmed.split(":");
  const minutes = Number(minutesStr) || 0;
  const seconds = Number(secondsStr) || 0;
  return Math.max(0, Math.round(minutes * 60 + seconds));
}

const PART_HEADER_RE =
  /^Part\s+(\d+)\s*\(\s*([\d:.]+)\s*-\s*([\d:.]+)\s*\)\s*[—-]\s*([^[]*?)\s*\[[^\]]*\]\.\s*([\s\S]*)$/;

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
    .split(/(?=Part\s+\d+\s*\()/g)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const parts: ScriptSequencePart[] = [];
  for (const chunk of chunks) {
    const match = chunk.match(PART_HEADER_RE);
    if (!match) continue;
    const [, indexStr, startStr, endStr, title, prompt] = match;
    const startSec = parseTimeToSec(startStr);
    const endSec = parseTimeToSec(endStr);
    if (endSec <= startSec) continue; // a real, if malformed, header — never build a zero/negative-length clip
    parts.push({
      index: Number(indexStr),
      title: title.trim(),
      startSec,
      endSec,
      prompt: prompt.trim(),
    });
  }
  return parts;
}
