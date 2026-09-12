/**
 * Client-side "is this bit of the song being sung, or is it an
 * instrumental break" analysis for an attached MP3 — the real(ish)
 * replacement for `buildDemoSegments`' fixed-fraction seed cadence (see
 * `lib/skidmarks.ts`'s module doc comment for the full mock-vs-real
 * breakdown).
 *
 * **What this actually does** (genuinely, not a mock): decodes the
 * attached file's real PCM audio via the browser's `AudioContext`,
 * frames it, and for each frame computes (a) loudness (RMS) and (b) how
 * much of that frame's energy sits in the ~300–3400Hz band where human
 * vocal formants concentrate, via a real FFT run on the actual samples.
 * Frames that are both loud enough and vocal-band-dominant are flagged
 * "vocal"; everything else (silence, a bassline, a sustained pad, a
 * cymbal wash) is "instrumental". A short median-filter smoothing pass
 * turns per-frame flags into a handful of contiguous real-time segments.
 *
 * **What this is not**: it is not speech-to-text, it does not know any
 * words, and it cannot tell verse from bridge from chorus — those are
 * song-structure/lyrical distinctions this signal has no way to see, so
 * `lib/skidmarks.ts` only ever labels its output "Vocal" / "Instrumental"
 * (see `SKIDMARKS_SEGMENT_LABEL_META`), never "verse"/"bridge" (those
 * stay reserved for `buildDemoSegments`' clearly-labeled seed fallback).
 * It's also a heuristic, tuned by ear against a handful of tracks, not a
 * trained/validated model — expect it to get loud instrumental sections
 * or quiet vocals wrong sometimes. That honest ceiling is exactly why
 * `SkidmarksClipTimeline` calls this "real(ish)" rather than "real".
 *
 * No network calls, no API key, nothing to configure — everything here
 * runs in the browser against the file Stuart already picked. (A real
 * transcription pass — e.g. Whisper — would give word-level lyric
 * timing and was considered, but it needs an API key and a server route
 * to send audio to; scaffolding that paid/keyed path wasn't worth it for
 * this PR when this local heuristic already answers the actual product
 * question — "is this bit sung or not" — without Stuart needing to
 * configure anything. If real transcribed lyrics are wanted later, that
 * would be a clearly-separate follow-up, not silently implied by this.)
 */

export interface VocalAnalysisSegment {
  startSec: number;
  endSec: number;
  vocal: boolean;
}

export interface VocalAnalysisResult {
  segments: VocalAnalysisSegment[];
  /** Real duration per the decoded audio buffer — slightly more
   * trustworthy than the `<audio>` element's metadata probe, which some
   * browsers get wrong for VBR-encoded MP3s. */
  durationSec: number;
}

/** FFT frame size — a power of two required by `fftInPlace` below. 2048
 * samples is ~46ms at 44.1kHz: fine time resolution for "is this second
 * sung", plenty of frequency resolution (~21.5Hz/bin) to separate the
 * vocal formant band from bass/treble. */
const FRAME_SIZE = 2048;
/** No overlap between frames — halves the FFT work vs. 50% overlap.
 * Segments are seconds long, so losing a little time precision between
 * frame centers doesn't matter here. */
const HOP_SIZE = FRAME_SIZE;

/** Human vocal formants live roughly here; below is mostly bass/kick/
 * bassline, above is mostly cymbals/hi-hats/sibilance-adjacent noise —
 * a coarse but real 3-band split, not a fake number. */
const VOCAL_BAND_LOW_HZ = 300;
const VOCAL_BAND_HIGH_HZ = 3400;

/** A frame must clear this fraction of the track's peak RMS to even be
 * considered — otherwise near-silence (intros, outros, gaps) would
 * occasionally get misread as "vocal" off pure noise-floor spectral
 * shape. Roughly -24dB below the loudest frame. */
const SILENCE_FLOOR_RATIO = 0.06;

/** How much of a frame's energy has to sit in the vocal band, relative
 * to the rest, before we call it sung rather than instrumental. Tuned
 * by ear, not derived from a dataset — see the module doc comment. */
const VOCAL_RATIO_THRESHOLD = 0.42;

/** Smoothing window for the frame-level vocal/instrumental flag —
 * roughly this many seconds of majority vote, so a single vocal-ish
 * frame in the middle of an instrumental break doesn't create a
 * flickery one-frame segment. */
const SMOOTHING_WINDOW_SEC = 1.0;

/** Segments shorter than this get folded into a neighbor after
 * smoothing — keeps the final list readable (a handful of real
 * sections, not dozens of near-instant flips). */
const MIN_SEGMENT_SEC = 1.5;

/** Hard ceiling on how long analysis is allowed to run before we give up
 * and fall back to the seed timeline — protects against a pathological
 * file (or a very low-power device) hanging the flow indefinitely. */
const ANALYSIS_TIMEOUT_MS = 30_000;

/** How many frames to process before yielding back to the event loop —
 * keeps the tab responsive on longer tracks instead of blocking the
 * main thread in one long synchronous loop. */
const FRAMES_PER_YIELD = 400;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. `re`/`im` must be the
 * same power-of-two length. Standard textbook algorithm (bit-reversal
 * permutation, then log2(n) butterfly stages) — nothing bespoke here.
 */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tRe = re[i];
      re[i] = re[j];
      re[j] = tRe;
      const tIm = im[i];
      im[i] = im[j];
      im[j] = tIm;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

/** Downmix every channel to mono by averaging — vocal presence doesn't
 * need stereo separation, and it halves the work for typical 2-channel
 * MP3s. */
function toMonoSamples(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

interface FrameFeatures {
  rms: number;
  vocalRatio: number;
}

async function computeFrameFeatures(
  samples: Float32Array,
  sampleRate: number
): Promise<FrameFeatures[]> {
  const frameCount = Math.max(1, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
  const features: FrameFeatures[] = [];

  // Hann window — standard, reduces spectral leakage across frame edges.
  const window = new Float64Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
  }

  const binHz = sampleRate / FRAME_SIZE;
  const lowBinEnd = Math.max(1, Math.round(VOCAL_BAND_LOW_HZ / binHz));
  const highBinEnd = Math.min(
    FRAME_SIZE / 2,
    Math.round(VOCAL_BAND_HIGH_HZ / binHz)
  );

  const re = new Float64Array(FRAME_SIZE);
  const im = new Float64Array(FRAME_SIZE);

  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP_SIZE;
    let sumSquares = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const sample = start + i < samples.length ? samples[start + i] : 0;
      sumSquares += sample * sample;
      re[i] = sample * window[i];
      im[i] = 0;
    }
    const rms = Math.sqrt(sumSquares / FRAME_SIZE);

    fftInPlace(re, im);

    let lowPower = 0;
    let midPower = 0;
    let highPower = 0;
    const nyquistBin = FRAME_SIZE / 2;
    for (let bin = 1; bin < nyquistBin; bin++) {
      const power = re[bin] * re[bin] + im[bin] * im[bin];
      if (bin < lowBinEnd) lowPower += power;
      else if (bin < highBinEnd) midPower += power;
      else highPower += power;
    }
    const totalPower = lowPower + midPower + highPower + 1e-9;
    features.push({ rms, vocalRatio: midPower / totalPower });

    if (f % FRAMES_PER_YIELD === FRAMES_PER_YIELD - 1) {
      await yieldToEventLoop();
    }
  }

  return features;
}

function medianSmoothBooleans(flags: boolean[], windowSize: number): boolean[] {
  if (windowSize <= 1) return flags;
  const half = Math.floor(windowSize / 2);
  const smoothed: boolean[] = new Array(flags.length);
  for (let i = 0; i < flags.length; i++) {
    let trueCount = 0;
    let total = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(flags.length - 1, i + half); j++) {
      total++;
      if (flags[j]) trueCount++;
    }
    smoothed[i] = trueCount * 2 > total;
  }
  return smoothed;
}

function runLengthEncode(
  flags: boolean[],
  frameDurationSec: number,
  totalDurationSec: number
): VocalAnalysisSegment[] {
  if (flags.length === 0) {
    return [{ startSec: 0, endSec: totalDurationSec, vocal: false }];
  }
  const segments: VocalAnalysisSegment[] = [];
  let runStart = 0;
  let runVocal = flags[0];
  for (let i = 1; i <= flags.length; i++) {
    const current = i < flags.length ? flags[i] : !runVocal; // force a flush at the end
    if (i === flags.length || current !== runVocal) {
      const startSec = runStart * frameDurationSec;
      const endSec = i === flags.length ? totalDurationSec : i * frameDurationSec;
      segments.push({ startSec, endSec, vocal: runVocal });
      runStart = i;
      runVocal = current;
    }
  }
  return segments;
}

/** Folds any segment shorter than `MIN_SEGMENT_SEC` into whichever
 * neighbor is longer, repeating until stable (or only one segment is
 * left) — keeps the final list a handful of real sections instead of a
 * flicker of near-instant flips. */
function mergeTinySegments(segments: VocalAnalysisSegment[]): VocalAnalysisSegment[] {
  let current = segments;
  let changed = true;
  while (changed && current.length > 1) {
    changed = false;
    const next: VocalAnalysisSegment[] = [];
    for (let i = 0; i < current.length; i++) {
      const seg = current[i];
      const duration = seg.endSec - seg.startSec;
      if (duration >= MIN_SEGMENT_SEC || current.length <= 1) {
        next.push(seg);
        continue;
      }
      const prev = next[next.length - 1];
      const nextSeg = current[i + 1];
      const prevDuration = prev ? prev.endSec - prev.startSec : -1;
      const nextDuration = nextSeg ? nextSeg.endSec - nextSeg.startSec : -1;
      if (prevDuration >= nextDuration && prev) {
        prev.endSec = seg.endSec;
      } else if (nextSeg) {
        nextSeg.startSec = seg.startSec;
      } else if (prev) {
        prev.endSec = seg.endSec;
      } else {
        next.push(seg);
      }
      changed = true;
    }
    current = next;
  }
  // Re-merge any now-adjacent same-vocal runs the fold above can create.
  const merged: VocalAnalysisSegment[] = [];
  for (const seg of current) {
    const last = merged[merged.length - 1];
    if (last && last.vocal === seg.vocal) {
      last.endSec = seg.endSec;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

async function decodeFile(file: File): Promise<AudioBuffer> {
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

async function analyzeVocalActivityInner(file: File): Promise<VocalAnalysisResult> {
  const buffer = await decodeFile(file);
  const samples = toMonoSamples(buffer);
  const totalDurationSec = buffer.duration;

  const features = await computeFrameFeatures(samples, buffer.sampleRate);
  const peakRms = features.reduce((max, f) => Math.max(max, f.rms), 0);
  const silenceFloor = peakRms * SILENCE_FLOOR_RATIO;

  const rawFlags = features.map(
    (f) => f.rms > silenceFloor && f.vocalRatio > VOCAL_RATIO_THRESHOLD
  );

  const frameDurationSec = HOP_SIZE / buffer.sampleRate;
  const smoothingWindowFrames = Math.max(
    1,
    Math.round(SMOOTHING_WINDOW_SEC / frameDurationSec)
  );
  const smoothedFlags = medianSmoothBooleans(rawFlags, smoothingWindowFrames);

  const rawSegments = runLengthEncode(smoothedFlags, frameDurationSec, totalDurationSec);
  const segments = mergeTinySegments(rawSegments);

  return { segments, durationSec: totalDurationSec };
}

/**
 * Analyze an attached MP3 File for vocal-vs-instrumental sections. Runs
 * entirely client-side against the real file — see the module doc
 * comment for exactly what "real(ish)" means here. Rejects (never
 * silently returns a fake result) if the browser can't decode the file
 * or analysis takes too long; callers should fall back to the seed
 * timeline and label that fallback honestly (see
 * `lib/skidmarks.ts`'s `markSkidmarksAnalysisFailed`).
 */
export async function analyzeVocalActivity(file: File): Promise<VocalAnalysisResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error("Analysis took too long and was cancelled.")),
      ANALYSIS_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([analyzeVocalActivityInner(file), timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
