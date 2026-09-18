import { Mp3Encoder } from "@breezystack/lamejs";
import { estimateMp3DurationSec } from "./mp3Slice";

/**
 * Encodes a real silent MP3 of roughly `durationSec` seconds — the
 * driving audio a Sunny Banks **Hold** beat feeds Comfy Cloud's LTX
 * 2.3 IA2V graph (`LoadAudio` node `276`) when there is no dialogue
 * and therefore no ElevenLabs TTS call.
 *
 * LTX still requires a real audio file of at least
 * `MIN_LTX_AUDIO_INPUT_SEC` (2s); a Hold cannot simply omit audio.
 * Silence is the honest input for a no-dialogue beat (the gold hold
 * prompt says "No dialogue") rather than synthesizing a dummy spoken
 * line just to satisfy the graph — that would be a silent ElevenLabs
 * bill on every Hold, which is the opposite of this path's job.
 *
 * Same `@breezystack/lamejs` encoder the rest of this app already
 * uses (`lib/audioCompression.ts`, the generate-clip / speak-beat
 * route tests). Not ffmpeg. Not a canned asset on disk (Vercel
 * serverless has no reliable local file to ship).
 */

const SILENT_MP3_SAMPLE_RATE = 22050;
const SILENT_MP3_BITRATE_KBPS = 64;
const ENCODE_CHUNK_SAMPLES = 1152;

/**
 * Append a silent MP3 tail so LTX's LoadAudio node (`276`) sees at
 * least `minDurationSec` of driving audio. Live QA (2026-09-17):
 * Shazza's "You right?" synthesized to 0.8s and the speak-beat route
 * rejected it with "Try a longer line" — a real sitcom line, not a
 * bad request. Padding silence on the tail keeps the spoken bytes
 * intact (no second ElevenLabs bill, no invented pause text) and
 * sends a file that actually meets the 2s floor.
 *
 * Frame-concat, same as `lib/mp3Slice.ts` — each MPEG frame carries
 * its own header, so a 22.05 kHz silent tail can follow a 44.1 kHz
 * ElevenLabs body. Returns `bytes` unchanged when already long enough.
 * Does not invent frames for an empty/unparseable source (duration 0);
 * the caller must treat that as a real TTS failure.
 */
export function padMp3ToMinimumDurationSec(bytes: Uint8Array, minDurationSec: number): Uint8Array {
  const sourceDurationSec = estimateMp3DurationSec(bytes);
  if (sourceDurationSec <= 0 || sourceDurationSec >= minDurationSec) return bytes;

  // Extra slack so lamejs frame rounding cannot land a hair under the
  // floor the way an exact `min - source` request could.
  const PAD_ROUNDING_SLACK_SEC = 0.2;
  let out = bytes;
  let durationSec = sourceDurationSec;
  for (let attempt = 0; attempt < 2 && durationSec < minDurationSec; attempt += 1) {
    const padSec =
      attempt === 0 ? minDurationSec - durationSec + PAD_ROUNDING_SLACK_SEC : 0.5;
    const pad = encodeSilentMp3(padSec);
    const next = new Uint8Array(out.length + pad.length);
    next.set(out, 0);
    next.set(pad, out.length);
    out = next;
    durationSec = estimateMp3DurationSec(out);
  }
  return out;
}

/**
 * Prepend a silent lead-in before real audio — the automatic "settle"
 * beat (Stuart's explicit ask, 2026-09-18: "implied... built in... I
 * don't need to see it"). When a Speak beat carries an
 * `appearanceModifier` (the character is stepping into a prop/look
 * that differs from their locked default), the character needs a
 * visible moment to settle into that state before talking — this
 * folds that moment into the SAME render's own audio/prompt instead of
 * a second, separately-billed silent Hold clip (the only real
 * mechanism for a settle beat before this). Same frame-concat approach
 * as `padMp3ToMinimumDurationSec` (each MPEG frame carries its own
 * header, so a differing sample-rate/bitrate lead can safely precede a
 * real ElevenLabs body) — this one puts the silence first instead of
 * last. Returns `bytes` unchanged for a non-positive `leadSec` or an
 * empty/unparseable source (never invents a lead-in for a genuine TTS
 * failure — same "don't paper over a real failure" rule as
 * `padMp3ToMinimumDurationSec`).
 */
export function prependSilenceToMp3(bytes: Uint8Array, leadSec: number): Uint8Array {
  if (leadSec <= 0) return bytes;
  if (estimateMp3DurationSec(bytes) <= 0) return bytes;
  const lead = encodeSilentMp3(leadSec);
  const out = new Uint8Array(lead.length + bytes.length);
  out.set(lead, 0);
  out.set(bytes, lead.length);
  return out;
}

export function encodeSilentMp3(durationSec: number): Uint8Array {
  const clamped = Math.max(0, durationSec);
  const encoder = new Mp3Encoder(1, SILENT_MP3_SAMPLE_RATE, SILENT_MP3_BITRATE_KBPS);
  const totalSamples = Math.max(1, Math.round(clamped * SILENT_MP3_SAMPLE_RATE));
  const pcm = new Int16Array(totalSamples);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += ENCODE_CHUNK_SAMPLES) {
    const encoded = encoder.encodeBuffer(pcm.subarray(i, i + ENCODE_CHUNK_SAMPLES));
    if (encoded.length > 0) chunks.push(encoded);
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(flushed);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Frame-sum duration of a silent MP3 this helper just encoded —
 * useful so a caller can confirm the file actually covers LTX's
 * audio-input floor rather than trusting the requested seconds. */
export function silentMp3DurationSec(bytes: Uint8Array): number {
  return estimateMp3DurationSec(bytes);
}
