/**
 * Client-side "shrink this MP3 before it leaves the browser" pass — the
 * fix for the real-world bug report: Stuart re-attached a full ~4:16 song
 * ("JACK ASH - TALKING TO CONCRETE.mp3") and `/api/skidmarks/transcribe`
 * (see that route's doc comment) failed with a bare `HTTP 413` before its
 * own code ever ran.
 *
 * **Root cause, confirmed against Vercel's own docs, not guessed**: Vercel
 * Functions enforce a **4.5MB hard cap on the request body**
 * (https://vercel.com/docs/functions/limitations#request-body-size,
 * https://vercel.com/docs/errors/function_payload_too_large) — a
 * platform-level limit, not a Next.js `bodyParser` setting, that rejects
 * an oversized `multipart/form-data` upload with `413
 * FUNCTION_PAYLOAD_TOO_LARGE` **before the route handler's own code runs
 * at all**. That's why `app/api/skidmarks/transcribe/route.ts`'s own
 * `MAX_UPLOAD_BYTES` check (OpenAI's real 25MB cap on that endpoint) never
 * even got a chance to fire, and why the client only ever saw a bare
 * status code with no JSON body to read a real message from (see
 * `lib/transcription.ts`'s non-JSON-response fallback). A ~4:16 song at
 * a typical 128–192kbps MP3 bitrate is itself already ~4–6MB — over the
 * cap before Stuart even attaches anything unusual. This has nothing to
 * do with `OPENAI_API_KEY` (already confirmed wired via the tiny test
 * tone) and nothing to do with OpenAI's own 25MB limit.
 *
 * There is no `next.config`/`vercel.json` setting that raises this —
 * it's enforced ahead of the function, and Vercel's own guidance for
 * exceeding it is either "upload directly to storage instead of through
 * the function" (out of scope here — no Blob store is provisioned for
 * this project, and adding one is new infra, not a fix to this feature)
 * or "reduce the payload before it's sent". This module does the latter:
 * it downmixes to mono, resamples to 16kHz (the rate Whisper itself
 * internally resamples every input to anyway — see OpenAI's own
 * downsampling guidance — so this isn't throwing away resolution Whisper
 * would have used), and re-encodes to a low, duration-adaptive MP3
 * bitrate, entirely in the browser via `@breezystack/lamejs` (a pure-JS,
 * dependency-free LAME encoder — no server-side ffmpeg/binary needed,
 * so this works unmodified on Vercel's serverless Node.js runtime same as
 * anywhere else). `lib/transcription.ts` runs this before every upload
 * that isn't already comfortably small.
 *
 * **Honesty note**: this trades audio fidelity for upload size on large
 * files. Whisper is a speech model trained to be robust to compression
 * and low sample rates for *speech*; a busy multi-instrument mix at a
 * very low bitrate is a harder case than a clean voice memo (see OpenAI's
 * own caveat that heavy downsampling suits speech better than music).
 * That's a real, disclosed trade-off, not a silent one — this is exactly
 * why the bitrate tiers below start as high as the size budget allows
 * and only drop further for longer files, and why `chooseCompressionPlan`
 * is a small, independently testable function rather than a buried
 * magic number.
 */

/** Vercel's own documented hard limit on a Function's request body — see
 * this module's doc comment for the two source docs. Not configurable;
 * exceeding it returns 413 before any of our code runs. */
export const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024; // 4,718,592 bytes

/** Files this small already clear `VERCEL_BODY_LIMIT_BYTES` with real
 * margin (multipart boundary/header overhead is a few hundred bytes, not
 * megabytes) — skip compression entirely rather than degrading audio
 * that didn't need it. This is exactly Stuart's already-working "tiny
 * test tone" case, and it stays untouched. */
export const DIRECT_UPLOAD_SAFE_BYTES = 4 * 1024 * 1024; // 4MiB

/** What we aim compressed (or re-checked real-encoded) output at — under
 * `VERCEL_BODY_LIMIT_BYTES` with ~0.7MB of headroom for multipart
 * overhead and any small CBR frame-padding variance between our estimate
 * and LAME's actual output. */
export const UPLOAD_BUDGET_BYTES = 4 * 1024 * 1024; // 4MiB

/** Whisper resamples every input to 16kHz internally (see OpenAI's own
 * "downsampling to reduce file size" guidance) — sending audio already
 * at that rate isn't a quality compromise Whisper wouldn't have made
 * itself, just skips re-sending resolution it would discard anyway. It's
 * also a valid MPEG-2 Layer III sample rate, so every bitrate tier below
 * encodes cleanly at it. */
export const COMPRESSION_SAMPLE_RATE_HZ = 16000;

/** Mono MP3 bitrates to try, highest quality first, all valid at
 * `COMPRESSION_SAMPLE_RATE_HZ` for MPEG-2 Layer III. Picked, not
 * exhaustive — enough steps to comfortably cover "a few minutes" up to
 * "a very long track" without so many tiers that a borderline file
 * flip-flops between near-identical sizes. */
export const MP3_BITRATE_TIERS_KBPS = [64, 48, 32, 24, 16, 8] as const;

/** Real per-second byte rate at a given CBR bitrate — LAME's constant
 * bitrate framing paces strictly by bitrate, not by input loudness or
 * content, so this is an accurate size predictor (see this module's doc
 * comment), not a rough guess. */
export function estimateMp3Bytes(durationSec: number, bitrateKbps: number): number {
  return Math.ceil(((bitrateKbps * 1000) / 8) * Math.max(0, durationSec));
}

export interface CompressionPlan {
  bitrateKbps: number;
  estimatedBytes: number;
}

/**
 * Picks the highest-quality bitrate tier whose estimated output still
 * fits `targetBytes`, or `null` if even the lowest tier wouldn't (an
 * honest ceiling: a track that long can't be shrunk under the Vercel
 * limit with this approach at all). Pure function — no browser APIs, no
 * network — so it's covered directly in `lib/audioCompression.test.ts`
 * without needing a real `AudioContext`.
 */
export function chooseCompressionPlan(
  durationSec: number,
  targetBytes: number = UPLOAD_BUDGET_BYTES,
  tiersKbps: readonly number[] = MP3_BITRATE_TIERS_KBPS
): CompressionPlan | null {
  for (const bitrateKbps of tiersKbps) {
    const estimatedBytes = estimateMp3Bytes(durationSec, bitrateKbps);
    if (estimatedBytes <= targetBytes) {
      return { bitrateKbps, estimatedBytes };
    }
  }
  return null;
}

/** mm:ss for the honest "too long to shrink" message below. Doesn't
 * bother with hours — a track long enough to need one is already far
 * past any realistic song length. */
export function formatDurationForMessage(durationSec: number): string {
  const totalSeconds = Math.max(0, Math.round(durationSec));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Plain-language message for the (expected to be rare, given the
 * bitrate floor's headroom) case where even the most aggressive tier
 * still wouldn't clear Vercel's request body limit. No raw HTTP status
 * codes — see the top-level task's ask for clear, non-cryptic text. */
export function describeTooLongToCompress(durationSec: number): string {
  const limitMb = (VERCEL_BODY_LIMIT_BYTES / (1024 * 1024)).toFixed(1);
  return (
    `This track is ${formatDurationForMessage(durationSec)} long \u2014 even at the ` +
    `lowest quality this app will send, it would still be too large for the server ` +
    `to accept (the upload limit here is ${limitMb}MB). Try a shorter clip.`
  );
}

export type CompressionOutcome =
  | { kind: "unchanged"; file: File }
  | {
      kind: "compressed";
      file: File;
      originalBytes: number;
      compressedBytes: number;
      bitrateKbps: number;
    }
  | { kind: "too_long"; durationSec: number; message: string }
  | { kind: "failed"; message: string };

function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

async function decodeToAudioBuffer(file: File): Promise<AudioBuffer> {
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error("This browser doesn't support Web Audio decoding.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContextCtor();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close().catch(() => {});
  }
}

/** Downmixes to mono and resamples to `targetSampleRate` in one pass via
 * an `OfflineAudioContext` — connecting a source with more channels than
 * the context's own `numberOfChannels` triggers the Web Audio spec's
 * standard down-mix (a plain average for stereo-to-mono), so this needs
 * no hand-rolled channel-mixing math. */
async function resampleToMonoPcm(
  buffer: AudioBuffer,
  targetSampleRate: number
): Promise<Float32Array> {
  const OfflineCtor =
    (typeof window !== "undefined" ? window.OfflineAudioContext : undefined) ??
    (typeof globalThis !== "undefined"
      ? (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext })
          .OfflineAudioContext
      : undefined);
  if (!OfflineCtor) {
    throw new Error("This browser doesn't support offline audio rendering.");
  }
  const frameCount = Math.max(1, Math.ceil(buffer.duration * targetSampleRate));
  const offlineCtx = new OfflineCtor(1, frameCount, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/** Scales/clamps float PCM (`[-1, 1]`) to the signed 16-bit integer PCM
 * `lamejs`'s encoder expects. */
function floatTo16BitPcm(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

/** `lamejs` recommends feeding its encoder in chunks around this size
 * (an MP3 frame's worth of samples) rather than the whole buffer at
 * once — it still produces one continuous stream via `flush()`. */
const ENCODE_CHUNK_SAMPLES = 1152;

async function encodeMonoMp3(
  pcm: Int16Array,
  sampleRate: number,
  bitrateKbps: number
): Promise<Uint8Array<ArrayBuffer>> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += ENCODE_CHUNK_SAMPLES) {
    const chunk = pcm.subarray(i, i + ENCODE_CHUNK_SAMPLES);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length > 0) chunks.push(encoded);
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(flushed);

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  // Explicit `<ArrayBuffer>` (rather than the default `ArrayBufferLike`)
  // so this is a valid `BlobPart` below without a cast — a `Uint8Array`
  // constructed from a plain length is always concretely ArrayBuffer-
  // backed, never a `SharedArrayBuffer`.
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function deriveCompressedFileName(originalName: string): string {
  const base = originalName.replace(/\.[^./\\]+$/, "") || "audio";
  return `${base}.compressed.mp3`;
}

/**
 * Shrinks `file` for upload if (and only if) it's large enough that it
 * risks Vercel's `VERCEL_BODY_LIMIT_BYTES` request body cap; otherwise
 * returns it untouched. Never throws — every browser-API failure mode
 * (can't decode, can't render, can't encode) comes back as a `"failed"`
 * outcome so `lib/transcription.ts` can fall back to sending the
 * original file (today's behavior) rather than losing the attempt
 * entirely.
 */
export async function compressAudioForTranscription(file: File): Promise<CompressionOutcome> {
  if (file.size <= DIRECT_UPLOAD_SAFE_BYTES) {
    return { kind: "unchanged", file };
  }

  let buffer: AudioBuffer;
  try {
    buffer = await decodeToAudioBuffer(file);
  } catch (err) {
    return {
      kind: "failed",
      message: `Could not decode this audio file in the browser to shrink it for upload (${
        err instanceof Error ? err.message : "unknown error"
      }).`,
    };
  }

  const durationSec = buffer.duration;
  const plan = chooseCompressionPlan(durationSec);
  if (!plan) {
    return { kind: "too_long", durationSec, message: describeTooLongToCompress(durationSec) };
  }

  let pcm: Int16Array;
  try {
    const samples = await resampleToMonoPcm(buffer, COMPRESSION_SAMPLE_RATE_HZ);
    pcm = floatTo16BitPcm(samples);
  } catch (err) {
    return {
      kind: "failed",
      message: `Could not resample this audio file in the browser to shrink it for upload (${
        err instanceof Error ? err.message : "unknown error"
      }).`,
    };
  }

  const startIndex = MP3_BITRATE_TIERS_KBPS.indexOf(
    plan.bitrateKbps as (typeof MP3_BITRATE_TIERS_KBPS)[number]
  );
  const tiersToTry = MP3_BITRATE_TIERS_KBPS.slice(Math.max(0, startIndex));

  for (const bitrateKbps of tiersToTry) {
    let mp3Bytes: Uint8Array<ArrayBuffer>;
    try {
      mp3Bytes = await encodeMonoMp3(pcm, COMPRESSION_SAMPLE_RATE_HZ, bitrateKbps);
    } catch (err) {
      return {
        kind: "failed",
        message: `Could not re-encode this audio file in the browser to shrink it for upload (${
          err instanceof Error ? err.message : "unknown error"
        }).`,
      };
    }
    // Real CBR output tracks the estimate closely, but frame padding can
    // push it slightly over on some inputs — fall through to the next,
    // lower tier rather than upload something that will still 413.
    if (mp3Bytes.byteLength > UPLOAD_BUDGET_BYTES) continue;

    const blob = new Blob([mp3Bytes], { type: "audio/mpeg" });
    const outFile = new File([blob], deriveCompressedFileName(file.name), { type: "audio/mpeg" });
    return {
      kind: "compressed",
      file: outFile,
      originalBytes: file.size,
      compressedBytes: outFile.size,
      bitrateKbps,
    };
  }

  return { kind: "too_long", durationSec, message: describeTooLongToCompress(durationSec) };
}
