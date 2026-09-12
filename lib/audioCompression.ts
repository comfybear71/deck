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
 * it downmixes to mono, resamples down, and re-encodes to a
 * duration-adaptive MP3 bitrate, entirely in the browser via
 * `@breezystack/lamejs` (a pure-JS, dependency-free LAME encoder — no
 * server-side ffmpeg/binary needed, so this works unmodified on Vercel's
 * serverless Node.js runtime same as anywhere else). `lib/transcription.ts`
 * runs this before every upload that isn't already comfortably small.
 *
 * **Third live bug report, directly implicating this module**: after the
 * 413 fix above shipped and ElevenLabs Scribe (song-lyrics-oriented)
 * replaced Whisper as the primary transcription provider,
 * `applySkidmarksTranscriptionResult`'s `hasUsefulVocalCoverage` check
 * still rejected "Talking To Concrete" (~4:16 = 257s, real singing from
 * ~0:32 through most of the track) — real singing that Stuart's own test
 * against ElevenLabs' *hosted* transcription tool (fed the **original,
 * uncompressed** file) came back as dense sung lyrics with `[singing]`
 * tags for. Through Deck's own upload path, ElevenLabs Scribe returned
 * only **28 words scattered across the whole 257s track** (up from 20
 * words on the pre-pivot Whisper attempt against the *same* compressed
 * upload) — roughly one recognized word every ~9 seconds, nowhere near
 * a real sung lyric's word rate (a `words.length` this low for ~210s of
 * confirmed singing means the STT model itself failed to recognize the
 * overwhelming majority of the sung audio, not that a downstream merge
 * step discarded good timing — `lib/transcription.test.ts`'s
 * `hasUsefulVocalCoverage` suite confirms 28 words spread that thin
 * *correctly* collapses to ~0s of vocal coverage no matter how the merge
 * policy is tuned, since real word islands that sparse are each shorter
 * than `MIN_SEGMENT_SEC` on their own).
 *
 * The one uncontrolled variable between Stuart's two tests (dense
 * `[singing]`-tagged results on ElevenLabs' own hosted tool vs. 28
 * scattered words through this app) is exactly what this module does to
 * the audio before either STT provider ever sees it. **This is the
 * strongest evidenced explanation for the sparse-word symptom, verified
 * against the real `@breezystack/lamejs` encoder (not just asserted) —
 * but not proven against the real ElevenLabs API**, since this repo/
 * environment has no live `ELEVENLABS_API_KEY` to re-run the failing
 * request against: before this fix, a real ~4:16/257s song was *always*
 * downmixed to mono, resampled to a fixed 16kHz (an 8kHz frequency
 * ceiling — everything above that, including a meaningful slice of sung
 * vocal/flute harmonic content, was discarded), and capped at a **flat
 * 64kbps ceiling regardless of how much of the 4MiB upload budget was
 * actually free** — for this exact track's length, 64kbps used only
 * ~2MB of the ~4MiB budget (see `lib/audioCompression.test.ts`), leaving
 * roughly half the available payload size on the table unused while
 * still handing both STT providers a heavily downsampled, low-bitrate
 * mono signal to pick sung lyrics out of a full-band mix (drums, bass,
 * flute) with. That 16kHz/64kbps pairing was inherited from *Whisper's*
 * own "resamples to 16kHz internally anyway" guidance (see OpenAI's
 * downsampling docs) — a speech-only rationale that was never
 * re-examined when ElevenLabs Scribe (marketed specifically for singing,
 * not just speech) became the primary provider in the same PR that
 * introduced the coverage check that caught this. **The fix**: use the
 * upload-budget headroom that was already going unused — raise the
 * bitrate ceiling (`MP3_BITRATE_TIERS_KBPS`, now up to 128kbps — this
 * exact track now lands at the new top tier, verified via the real
 * encoder in `lib/audioCompression.test.ts`) and the sample rate
 * (`COMPRESSION_SAMPLE_RATE_HZ`, now 22.05kHz — an ~11kHz frequency
 * ceiling instead of 8kHz) up to whatever the same 4.5MB Vercel cap
 * still comfortably allows for a given track length, rather than a fixed
 * pair of numbers sized for Whisper's speech-only assumptions. This
 * roughly doubles both dimensions of fidelity for a typical song-length
 * upload at zero cost to the 413 fix's actual guarantee (still
 * comfortably under Vercel's cap either way).
 *
 * **Honesty note, still true after this fix**: this still trades some
 * audio fidelity for upload size on large files — a busy multi-instrument
 * mix is a harder STT target than a clean voice memo at any bitrate, and
 * the byte budget still forces real compromises on long tracks. That's a
 * real, disclosed trade-off, not a silent one — this is exactly why the
 * bitrate tiers below start as high as the size budget allows and only
 * drop further for longer files, and why `chooseCompressionPlan` is a
 * small, independently testable function rather than a buried magic
 * number. This module's fix addresses the strongest evidenced cause of
 * the sparse-transcript symptom; it is **not verified to fully resolve
 * it** against the real ElevenLabs API on the real track, since no key
 * is available in this environment to confirm that end to end — see this
 * PR's description for exactly what is and isn't verified.
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

/** Sample rate every compressed upload is resampled to. **Not** Whisper's
 * internal 16kHz anymore (see this module's doc comment for why that
 * number was the wrong one to inherit once ElevenLabs Scribe — a
 * provider marketed for *singing*, not just speech — became the primary
 * transcription path): 22.05kHz roughly doubles the frequency ceiling
 * (~11kHz vs. 8kHz Nyquist) a heavily-compressed song gets to keep,
 * while still being a valid MPEG-2 Layer III sample rate paired with
 * every bitrate tier below (verified against the real `lamejs` encoder,
 * not just assumed — see `lib/audioCompression.test.ts` and this
 * module's own manual verification script). */
export const COMPRESSION_SAMPLE_RATE_HZ = 22050;

/** Mono MP3 bitrates to try, highest quality first, all valid at
 * `COMPRESSION_SAMPLE_RATE_HZ` for MPEG-2 Layer III (MPEG-2's LSF table
 * supports CBR up to 160kbps at 22.05kHz/16kHz — nothing here is bumping
 * against a real encoder ceiling, see this module's doc comment).
 * Extended from a flat 64kbps ceiling to 128kbps at the top: for a real
 * ~4:16/257s song (this fix's motivating track), the old 64kbps ceiling
 * used only about half the ~4MiB upload budget
 * (`estimateMp3Bytes(257, 64)` ≈ 2.06MB) — real headroom that was going
 * unused while still handing the STT provider a fairly aggressively
 * compressed signal. 128kbps roughly doubles that track's encoded
 * fidelity for about the same real 4MiB-ish output size. Picked, not
 * exhaustive — enough steps to comfortably cover "a few minutes" up to
 * "a very long track" without so many tiers that a borderline file
 * flip-flops between near-identical sizes. */
export const MP3_BITRATE_TIERS_KBPS = [128, 96, 64, 48, 32, 24, 16, 8] as const;

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

export interface CompressionOptions {
  /** Skip the "already small enough, upload untouched" shortcut and run
   * the full decode → resample → re-encode pass regardless of size.
   * Added for `lib/transcription.ts`'s one-shot retry when ElevenLabs
   * Scribe rejects an *unmodified* original file as `invalid_audio` —
   * see that module's `transcribeAudio` doc comment for why a freshly
   * `lamejs`-encoded file is a plausible, minimal fix for that specific
   * failure (a clean, real-encoder-produced CBR MP3 doesn't carry
   * whatever container/header quirk the original file had), without
   * standing up a second output format. Defaults to `false` so every
   * existing call site (skip compression when the file's already
   * small) is unaffected. */
  force?: boolean;
}

/**
 * Shrinks `file` for upload if (and only if) it's large enough that it
 * risks Vercel's `VERCEL_BODY_LIMIT_BYTES` request body cap, or
 * `options.force` is set; otherwise returns it untouched. Never throws —
 * every browser-API failure mode (can't decode, can't render, can't
 * encode) comes back as a `"failed"` outcome so `lib/transcription.ts`
 * can fall back to sending the original file (today's behavior) rather
 * than losing the attempt entirely.
 */
export async function compressAudioForTranscription(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionOutcome> {
  if (!options.force && file.size <= DIRECT_UPLOAD_SAFE_BYTES) {
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
