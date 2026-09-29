/**
 * What a script box's Format button shows (2026-09-30). Live QA on an
 * iPhone: on a script that was already in shape Format changed nothing
 * and said nothing, so the tap looked broken. For a moment after each
 * tap the button now says what it did, then goes back to its name.
 * Shared by every script box with a Format button, so they all answer
 * the same way.
 */
export type ScriptFormatResult = "formatted" | "tidy" | null;

export const SCRIPT_FORMAT_FEEDBACK_MS = 1800;

export function scriptFormatButtonLabel(result: ScriptFormatResult): string {
  if (result === "formatted") return "\u2713 Formatted";
  if (result === "tidy") return "Already tidy";
  return "\u21e5 Format";
}
