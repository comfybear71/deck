import { stripElevenLabsAudioTags } from "./elevenLabsSpeech";

/** Same cap as the Shorts routes' prompts. */
const MAX_PROMPT_LENGTH = 2000;

/**
 * A Shorts talking shot's LTX picture prompt (2026-09-30). Since
 * 2026-10-04 `buildAdultShortsTalkingPrompt` already quotes the words in
 * the Sunny Banks speaking text, so its prompt goes through unchanged.
 * An older page's prompt gets who says what put in front.
 * The words are quoted without their ElevenLabs tags (`[whispers]`): the
 * audio LTX lip-syncs to already performs them, the same as Sunnybank.
 * A tag-only line ("[laughs]") keeps its text so the quote isn't empty.
 * The locks come last and always survive the cap.
 */
export function talkingPromptWithLine(prompt: string, speakerName: string, line: string): string {
  // A prompt that already says who says what (every talking shot since
  // 2026-10-04, `buildAdultShortsTalkingPrompt`) goes as it is.
  if (prompt.includes(`${speakerName} says: "`)) return prompt.slice(0, MAX_PROMPT_LENGTH);
  const words = shortsSpokenWords(line);
  const head = `${speakerName} says: "${words}"`;
  const room = MAX_PROMPT_LENGTH - prompt.length - 1;
  return room <= 0 ? prompt.slice(0, MAX_PROMPT_LENGTH) : `${head.slice(0, room)} ${prompt}`;
}

/** The Line as the picture prompt quotes it: no ElevenLabs tags, one line, no double quotes. */
export function shortsSpokenWords(line: string): string {
  return (stripElevenLabsAudioTags(line) || line).replace(/\s+/g, " ").trim().replace(/"/g, "'");
}
