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
 * expect (same as an attached song's own mp3 audio). `eleven_multilingual_v2`
 * is ElevenLabs' current general-purpose model as of this build.
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

/** ElevenLabs' current general-purpose multilingual model — matches the
 * model this app's own Scribe (speech-to-text) call already treats as
 * the state-of-the-art default, same reasoning: broad language/accent
 * coverage without Stuart having to pick a model per character. */
const ELEVENLABS_TTS_MODEL_ID = "eleven_multilingual_v2";

/** Real upstream timeout — a single short line's synthesis is fast
 * (seconds, not the multi-minute budget a full clip render needs), but
 * still bounded rather than left to hang the whole beat request
 * indefinitely on a stalled connection. */
const ELEVENLABS_TTS_TIMEOUT_MS = 30_000;

export type SynthesizeSunnyBanksLineOutcome =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; unconfigured: boolean; message: string };

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

  let res: Response;
  try {
    res = await fetch(`${ELEVENLABS_TTS_BASE_URL}/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabs.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: trimmedLine, model_id: ELEVENLABS_TTS_MODEL_ID }),
      signal: AbortSignal.timeout(ELEVENLABS_TTS_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      unconfigured: false,
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
      unconfigured: false,
      message: `ElevenLabs returned ${res.status}${detail ? `: ${detail}` : "."}`,
    };
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await res.arrayBuffer();
  } catch {
    return { ok: false, unconfigured: false, message: "Could not read ElevenLabs' audio response." };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, unconfigured: false, message: "ElevenLabs returned an empty audio file." };
  }

  return {
    ok: true,
    bytes: new Uint8Array(bytes),
    contentType: res.headers.get("content-type") || "audio/mpeg",
  };
}
