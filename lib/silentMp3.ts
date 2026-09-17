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
