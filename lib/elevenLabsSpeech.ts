/**
 * Server-only thin client for ElevenLabs' text-to-speech endpoint — the
 * real audio source behind a Sunny Banks Speak beat's dialogue line
 * (`app/api/skidmarks/sunnybank/generate-speak-beat/route.ts`). New
 * direction for ElevenLabs in this app: `lib/transcription.ts`/`app/api/
 * skidmarks/transcribe/route.ts` only ever call ElevenLabs Scribe
 * (speech **to** text) for Skidmarks' lyric timing. This is the first
 * caller going the other way — real ElevenLabs voice cloning output,
 * driven by one of Stuart's own locked character voice ids
 * (`lib/sunnyBanks.ts`'s `SUNNY_BANKS_CAST`), not a stock/library voice.
 *
 * Same key, same account, same `xi-api-key` header, same
 * `resolveElevenLabsApiKey` lookup (`lib/elevenLabsKey.ts`, pulled out
 * of the transcribe route specifically so both directions share it) —
 * nothing new to configure beyond what Stuart already set up for
 * transcription.
 *
 * **Endpoint/shape, from ElevenLabs' own published docs
 * (https://elevenlabs.io/docs/api-reference/text-to-speech/convert)**:
 * `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`, JSON
 * body `{ text, model_id }`, response is the raw audio bytes directly
 * (not JSON) — default `audio/mpeg` (mp3), which is exactly the
 * container `uploadComfyCloudInput`/the LTX `LoadAudio` node already
 * expect (same as an attached song's own mp3 audio).
 *
 * **Model: Eleven v3 (`eleven_v3`), with audio tags (2026-09-30).** Up to
 * 2026-09-30 this sent `eleven_multilingual_v2`, which has no idea what
 * `[whispers]` means — a Sunnybank line like "oi, here we go, [pause]
 * [whispers] another bus load of suckers" came back with the character
 * saying the words "pause" and "whispers" out loud. ElevenLabs' audio
 * tags (`[whispers]`, `[laughs]`, `[sighs]`, `[shouts]`, `[short pause]`
 * …) are an Eleven v3 feature: same `POST /v1/text-to-speech/{voice_id}`
 * endpoint, same voice ids, same `{ text, model_id }` body — only the
 * `model_id` changes (https://elevenlabs.io/docs/overview/models,
 * https://help.elevenlabs.io/hc/en-us/articles/35869142561297). Stuart
 * wants tags as a creative tool on any line, so v3 is used for **every**
 * line, tagged or not — one voice model per episode, not a voice that
 * changes character between a tagged and an untagged line. The tags stay
 * in `text` exactly as written; nothing here rewrites them.
 *
 * **Fallback to `eleven_multilingual_v2`.** ElevenLabs' own docs note a
 * Professional Voice Clone is "not fully optimized" for v3, so a voice
 * could refuse or fail on v3. When v3 answers with an HTTP error that a
 * different model could plausibly fix (anything except 401 bad key /
 * quota and 429 rate limit), the same line is retried once on
 * `eleven_multilingual_v2` **with the audio tags stripped out first**
 * (`stripElevenLabsAudioTags`) — v2 would read them aloud, which is the
 * exact bug this switch fixes. The clip still gets made, just without
 * the tag's delivery. `modelId` on a success says which model spoke.
 * A timeout / network error does not fall back (a second model would
 * not help a dead connection, and it would double the wait).
 *
 * v3 is limited to 5,000 characters per request (v2: 10,000) — a
 * sitcom line is nowhere near either. v3 does not support SSML
 * `<break>`; `[pause]`-style tags and "..." are how pauses are written.
 *
 * **Honesty note, same shape as `lib/comfyCloud.ts`**: this is written
 * directly off ElevenLabs' own documented request/response shape, the
 * same way this app's ElevenLabs Scribe call was before its own first
 * live test — it has **not** been exercised against a real
 * `ELEVENLABS_API_KEY` in this sandbox (none is configured here). The
 * request/response shape is correct per ElevenLabs' own docs; only a
 * real call on Stuart's own deploy proves it end to end.
 */

import { resolveElevenLabsApiKey } from "./elevenLabsKey";

const ELEVENLABS_TTS_BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";

/** Eleven v3 — the model that performs inline audio tags (`[whispers]`,
 * `[laughs]`, …) instead of reading them out. Used for every line. */
export const ELEVENLABS_TTS_MODEL_ID = "eleven_v3";

/** The previous default. Only used when v3 refuses a voice/line; the
 * text sent to it has its audio tags stripped (v2 would say them). */
export const ELEVENLABS_TTS_FALLBACK_MODEL_ID = "eleven_multilingual_v2";

/** Upstream statuses a different model cannot fix: a bad key / used-up
 * quota (401) and a rate/concurrency limit (429). Every other HTTP
 * error from v3 gets one retry on the fallback model. */
const NO_FALLBACK_STATUSES = new Set([401, 429]);

/** An inline ElevenLabs audio tag: any `[…]` in a spoken line. The
 * Sunnybank script's own directives (`[Location:]`, `[Action:]`,
 * `[Character …]`) are already taken out by the panel's parser before a
 * line ever reaches this module, so whatever brackets are left are
 * delivery cues meant for the voice. */
const AUDIO_TAG_RE = /\[[^\[\]\n]*\]/g;

/** True when the line carries at least one inline `[tag]`. */
export function hasElevenLabsAudioTags(line: string): boolean {
  return /\[[^\[\]\n]*\]/.test(line);
}

/** The words only: every `[tag]` removed, spacing tidied, and no stray
 * space left before punctuation ("mate [laughs]." → "mate."). Used for
 * the v2 fallback and for the LTX motion prompt's quoted dialogue — the
 * audio already carries the delivery; the picture prompt just needs the
 * words. */
export function stripElevenLabsAudioTags(line: string): string {
  return line
    .replace(AUDIO_TAG_RE, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/^[\s,;:]+/, "")
    .trim();
}

/** Real upstream timeout — a single short line's synthesis is fast
 * (seconds, not the multi-minute budget a full clip render needs), but
 * still bounded rather than left to hang the whole beat request
 * indefinitely on a stalled connection. */
const ELEVENLABS_TTS_TIMEOUT_MS = 30_000;

export type SynthesizeSunnyBanksLineOutcome =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string;
      /** Which ElevenLabs model actually spoke: `eleven_v3` normally,
       * `eleven_multilingual_v2` (tags stripped) when v3 refused. */
      modelId: string;
    }
  | { ok: false; unconfigured: boolean; message: string };

type AttemptOutcome =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; message: string; status?: number };

/**
 * Synthesizes one dialogue line with a locked character's real
 * ElevenLabs voice. Never throws — an unconfigured server key, a bad
 * `voiceId`, or a real upstream failure all come back as an honest
 * `{ ok: false }` (see `SynthesizeSunnyBanksLineOutcome`), same "never a
 * silent/guessed success" rule every other real backend in this app
 * follows. `voiceId` is required and non-optional here on purpose — a
 * caller with no locked voice for a character (Hans today, see
 * `lib/sunnyBanks.ts`'s `SUNNY_BANKS_CAST`) must decide what to do
 * about that itself rather than this function silently picking a
 * stand-in voice.
 */
export async function synthesizeSunnyBanksLine(
  voiceId: string,
  line: string
): Promise<SynthesizeSunnyBanksLineOutcome> {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return { ok: false, unconfigured: false, message: "No line text to synthesize." };
  }
  const elevenLabs = resolveElevenLabsApiKey();
  if (!elevenLabs) {
    return {
      ok: false,
      unconfigured: true,
      message: "Neither ELEVENLABS_API_KEY nor ELEVEN_LABS_API_KEY is set on the server.",
    };
  }

  const primary = await requestSpeech(elevenLabs.key, voiceId, trimmedLine, ELEVENLABS_TTS_MODEL_ID);
  if (primary.ok) return { ...primary, modelId: ELEVENLABS_TTS_MODEL_ID };
  if (primary.status === undefined || NO_FALLBACK_STATUSES.has(primary.status)) {
    return { ok: false, unconfigured: false, message: primary.message };
  }

  // v3 refused this voice/line — say it on v2 instead, words only.
  const wordsOnly = stripElevenLabsAudioTags(trimmedLine);
  if (!wordsOnly) {
    return { ok: false, unconfigured: false, message: primary.message };
  }
  const fallback = await requestSpeech(elevenLabs.key, voiceId, wordsOnly, ELEVENLABS_TTS_FALLBACK_MODEL_ID);
  if (fallback.ok) return { ...fallback, modelId: ELEVENLABS_TTS_FALLBACK_MODEL_ID };
  return {
    ok: false,
    unconfigured: false,
    message: `Eleven v3 failed (${primary.message}); the Multilingual v2 fallback also failed (${fallback.message}).`,
  };
}

/** One text-to-speech request on one model. Never throws. */
async function requestSpeech(
  key: string,
  voiceId: string,
  text: string,
  modelId: string
): Promise<AttemptOutcome> {
  let res: Response;
  try {
    res = await fetch(`${ELEVENLABS_TTS_BASE_URL}/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: modelId }),
      signal: AbortSignal.timeout(ELEVENLABS_TTS_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      message: timedOut
        ? `ElevenLabs did not respond within ${ELEVENLABS_TTS_TIMEOUT_MS / 1000}s.`
        : `Could not reach ElevenLabs: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: { message?: string } | string };
      detail = typeof body.detail === "string" ? body.detail : body.detail?.message || "";
    } catch {
      // Handled by the plain status-code message below either way.
    }
    return {
      ok: false,
      status: res.status,
      message: `ElevenLabs returned ${res.status}${detail ? `: ${detail}` : "."}`,
    };
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await res.arrayBuffer();
  } catch {
    return { ok: false, message: "Could not read ElevenLabs' audio response." };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, message: "ElevenLabs returned an empty audio file." };
  }

  return {
    ok: true,
    bytes: new Uint8Array(bytes),
    contentType: res.headers.get("content-type") || "audio/mpeg",
  };
}
