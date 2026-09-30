import { stripElevenLabsAudioTags } from "./elevenLabsSpeech";

/** Same cap as the Shorts routes' prompts. */
const MAX_PROMPT_LENGTH = 2000;

/**
 * A Shorts talking shot's LTX picture prompt (2026-09-30): who says what,
 * then the shot's prompt with its locks (`buildAdultShortsTalkingPrompt`).
 * The words are quoted without their ElevenLabs tags (`[whispers]`): the
 * audio LTX lip-syncs to already performs them, the same as Sunnybank.
 * A tag-only line ("[laughs]") keeps its text so the quote isn't empty.
 * The locks come last and always survive the cap.
 */
export function talkingPromptWithLine(prompt: string, speakerName: string, line: string): string {
  const words = (stripElevenLabsAudioTags(line) || line).replace(/\s+/g, " ").trim().replace(/"/g, "'");
  const head = `${speakerName} says: "${words}"`;
  const room = MAX_PROMPT_LENGTH - prompt.length - 1;
  return room <= 0 ? prompt.slice(0, MAX_PROMPT_LENGTH) : `${head.slice(0, room)} ${prompt}`;
}
