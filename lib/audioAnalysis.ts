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
 * Frames that are loud enough, vocal-band-dominant, *and* not a
 * sustained near-pure tone (see `FLUTE_PEAKINESS_THRESHOLD` — Stuart
 * confirmed "Talking To Concrete" has flute interludes woven into its
 * main vocal section, and flute lives in the same 300–3400Hz band as
 * sung formants, so ratio alone can't tell them apart) are flagged
 * "vocal"; everything else (silence, a bassline, a sustained pad, a
 * cymbal wash, a flute passage) is "instrumental". An attack/release
 * **hysteresis** pass (see `applyHysteresis` below — fast to call a
 * frame "vocal", slower to call it back "instrumental") turns per-frame
 * flags into a handful of contiguous real-time segments without
 * flickering back to "instrumental" every time a syllable, a beat, or
 * a brief flute interlude dips below the vocal-band threshold.
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
 * runs in the browser against the file Stuart already picked. This is
 * now the **fallback** path, not the only one: `lib/transcription.ts` +
 * `app/api/skidmarks/transcribe/route.ts` add a real word-level
 * speech-to-text pass (ElevenLabs Scribe, keyed via
 * `ELEVENLABS_API_KEY`, with OpenAI Whisper as an optional fallback via
 * `OPENAI_API_KEY`) that `useSkidmarksStudio` prefers whenever it
 * succeeds *and* the result actually covers enough real singing to
 * trust (`hasUsefulVocalCoverage` in `lib/transcription.ts`) — see that
 * module's doc comment for the honest "useful transcription > this
 * heuristic > seed cadence" priority order. This heuristic still runs
 * unconditionally (in parallel, no key needed) so there's always a
 * real-ish signal when transcription is unavailable (no key
 * configured), fails, or lands too sparse to trust for a given track.
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
export const FRAME_SIZE = 2048;
/** No overlap between frames — halves the FFT work vs. 50% overlap.
 * Segments are seconds long, so losing a little time precision between
 * frame centers doesn't matter here. */
export const HOP_SIZE = FRAME_SIZE;

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
 * by ear, not derived from a dataset — see the module doc comment.
 *
 * Left at its original 0.42 for now. The main fix for
 * "0:32–1:52 mostly-vocal getting under-called" is the hysteresis hold
 * below (bridging brief flute dips) plus the peakiness cue (rejecting
 * the flute itself), not this number — lowering it too is a real lever
 * still on the table if Stuart reports genuine vocal frames (not flute)
 * still getting missed in that region, but that needs an actual report
 * against this build to justify, not another guess stacked on top. */
const VOCAL_RATIO_THRESHOLD = 0.42;

/** Above this, a frame's vocal-band energy is concentrated enough in a
 * single FFT bin that we treat it as a sustained near-pure tone — a
 * lead flute is the confirmed motivating case here: Stuart confirmed
 * "Talking To Concrete" has flute interludes in its 0:32–1:52 vocal
 * section and a standalone flute passage at 1:52–2:05, and flute sits
 * in the same 300–3400Hz band as sung vocal formants, so
 * `VOCAL_RATIO_THRESHOLD` alone can't tell them apart. This is what
 * lets a real flute dip actually flip to "Instrumental" (the 13-second
 * 1:52–2:05 passage) while a brief 2–3s flute interlude inside a verse
 * doesn't (see `EXIT_VOCAL_HOLD_SEC` — that's the hysteresis side of
 * the same fix; this is the per-frame classification side).
 *
 * **Honesty caveat, not a solved problem**: this is a real,
 * physically-motivated signal (voiced formants spread energy across
 * several resonance peaks at once; a flute's is dominated by its
 * fundamental — verified against synthetic pure-tone-vs-multi-formant
 * signals in `lib/audioAnalysis.test.ts`), but it's still a heuristic
 * tuned by ear with no ground-truth flute recording to check it
 * against. A fast, breathy, or heavily-vibrato'd flute line could
 * still read as "vocal" here (lower peakiness than a clean sustained
 * tone); a clean, steady, low-vibrato sung note could in principle
 * read as "instrumental" (higher peakiness than a typical
 * formant-rich vowel). If Stuart's real track still mislabels flute
 * after this change, that's the number to revisit first, alongside
 * actually listening through the false calls it makes. */
const FLUTE_PEAKINESS_THRESHOLD = 0.5;

/** Hysteresis hold times for `applyHysteresis` — modeled on an audio
 * envelope follower's attack/release, tuned against Stuart's confirmed
 * ground truth for "Talking To Concrete":
 * - 0:31–0:32 vocal onset.
 * - 0:32–1:52 mostly vocal, with several 2–3 *second* flute interludes
 *   woven in that must NOT flip the section to Instrumental.
 * - 1:52–2:05 (13 seconds) is an actual standalone flute
 *   passage/instrumental break that SHOULD flip to Instrumental.
 *
 * - Switching *into* "vocal" only needs this many seconds of clearly
 *   vocal-flagged frames — short on purpose, so the detected onset
 *   lands tightly inside the confirmed 0:31–0:32 window instead of
 *   drifting noticeably late.
 * - Switching *out of* "vocal" back to "instrumental" needs this many
 *   *consecutive* seconds of clearly non-vocal frames — comfortably
 *   longer than a 2–3s flute interlude (with real margin, since
 *   "2–3 seconds" is Stuart's estimate, not a frame-accurate
 *   measurement) but far shorter than the confirmed 13-second flute
 *   break, so that one still ends the vocal segment promptly. Verified
 *   against synthetic 2–3s opposite-label dips inside a longer vocal
 *   run in `lib/audioAnalysis.test.ts`. */
const ENTER_VOCAL_HOLD_SEC = 0.3;
const EXIT_VOCAL_HOLD_SEC = 4.5;

/** Segments shorter than this get folded into a neighbor after
 * hysteresis — keeps the final list readable (a handful of verse-scale
 * sections, not dozens of near-instant flips) and is also the backstop
 * that suppresses isolated false micro-vocals, like the live run's
 * ~4s "vocal" blip at 0:09–0:13 on "Talking To Concrete" sitting inside
 * a long real instrumental intro: too short to trust as its own
 * section, so it gets folded into whichever neighboring run is longer.
 * Raised from an earlier 1.5s (then 3.0s) — 17 segments for one
 * 4-minute track was too choppy to be a useful "where do I cut this"
 * reference, and short isolated blips are usually either noise or
 * smaller than anyone would actually clip to. Exported so
 * `lib/transcription.ts`'s word-timestamp-derived segments fold to the
 * same granularity instead of reinventing this number. */
export const MIN_SEGMENT_SEC = 5.0;

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

export interface FrameFeatures {
  rms: number;
  vocalRatio: number;
  /** How concentrated the vocal-band energy is in a single FFT bin
   * (that bin's power over the whole vocal band's power). A sustained,
   * near-pure single-note tone — a flute is the textbook case, and it
   * lives in the same 300–3400Hz band as sung vocal formants — puts
   * almost all of its vocal-band energy in one bin (plus a couple of
   * weak harmonics), so this comes out high. A sung vowel's formant
   * structure spreads energy across several resonance peaks at once, so
   * this comes out lower even when the note itself is steady. See
   * `FLUTE_PEAKINESS_THRESHOLD`'s doc comment for how this is used, and
   * its honesty caveat for where this cue can still be fooled. */
  vocalBandPeakiness: number;
}

export async function computeFrameFeatures(
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
    let midPeakPower = 0;
    const nyquistBin = FRAME_SIZE / 2;
    for (let bin = 1; bin < nyquistBin; bin++) {
      const power = re[bin] * re[bin] + im[bin] * im[bin];
      if (bin < lowBinEnd) {
        lowPower += power;
      } else if (bin < highBinEnd) {
        midPower += power;
        if (power > midPeakPower) midPeakPower = power;
      } else {
        highPower += power;
      }
    }
    const totalPower = lowPower + midPower + highPower + 1e-9;
    features.push({
      rms,
      vocalRatio: midPower / totalPower,
      vocalBandPeakiness: midPeakPower / (midPower + 1e-9),
    });

    if (f % FRAMES_PER_YIELD === FRAMES_PER_YIELD - 1) {
      await yieldToEventLoop();
    }
  }

  return features;
}

/**
 * Debounces the frame-level vocal/instrumental flags with **asymmetric**
 * hysteresis, like an audio envelope follower's attack/release: quick to
 * raise ("vocal"), slow to fall ("instrumental").
 *
 * Walks the flags as a sequence of same-value runs. A run only flips the
 * running state if it's long enough to clear the hold time *for the
 * direction it's flipping in* (`enterVocalHoldSec` to turn "vocal" on,
 * `exitVocalHoldSec` to turn it back off); short runs are swallowed and
 * just keep whatever the current state already is. Because
 * `exitVocalHoldSec` is set much longer than `enterVocalHoldSec` (see
 * the constants above), this is exactly the fix for the reported bug:
 * a genuine vocal entrance is still caught quickly, but a short dip
 * back below the vocal-band threshold in the middle of sustained
 * singing (a masked syllable, a beat where the mix buries the vocal) no
 * longer flips the whole phrase to "instrumental" — only a dip that
 * lasts as long as a real instrumental break does.
 */
function applyHysteresis(
  flags: boolean[],
  frameDurationSec: number,
  enterVocalHoldSec: number,
  exitVocalHoldSec: number
): boolean[] {
  if (flags.length === 0) return flags;
  const out: boolean[] = new Array(flags.length);
  let state = flags[0];
  let i = 0;
  while (i < flags.length) {
    const runValue = flags[i];
    let runEnd = i + 1;
    while (runEnd < flags.length && flags[runEnd] === runValue) runEnd++;
    if (runValue !== state) {
      const runLenSec = (runEnd - i) * frameDurationSec;
      const requiredSec = runValue ? enterVocalHoldSec : exitVocalHoldSec;
      if (runLenSec >= requiredSec) {
        state = runValue;
      }
    }
    for (let k = i; k < runEnd; k++) out[k] = state;
    i = runEnd;
  }
  return out;
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
 * flicker of near-instant flips. Exported for `lib/transcription.ts` to
 * reuse on word-timestamp-derived runs — same "handful of sections, not
 * one row per line" fold, same rule either way. */
export function mergeTinySegments(segments: VocalAnalysisSegment[]): VocalAnalysisSegment[] {
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

/**
 * Turns per-frame loudness/vocal-band features into the final segment
 * list: silence-floor + ratio threshold to raw per-frame flags, then
 * attack/release hysteresis (`applyHysteresis`) to hold "vocal" through
 * brief dips, then run-length encoding, then folding away anything
 * still shorter than `MIN_SEGMENT_SEC`. Split out from
 * `analyzeVocalActivityInner` so tests can exercise the actual tuning
 * logic against synthetic frame features without needing a real MP3 or
 * a browser `AudioContext` — see `lib/audioAnalysis.test.ts`.
 */
export function buildSegmentsFromFeatures(
  features: FrameFeatures[],
  frameDurationSec: number,
  totalDurationSec: number
): VocalAnalysisSegment[] {
  const peakRms = features.reduce((max, f) => Math.max(max, f.rms), 0);
  const silenceFloor = peakRms * SILENCE_FLOOR_RATIO;

  const rawFlags = features.map(
    (f) =>
      f.rms > silenceFloor &&
      f.vocalRatio > VOCAL_RATIO_THRESHOLD &&
      f.vocalBandPeakiness < FLUTE_PEAKINESS_THRESHOLD
  );

  const hysteresisFlags = applyHysteresis(
    rawFlags,
    frameDurationSec,
    ENTER_VOCAL_HOLD_SEC,
    EXIT_VOCAL_HOLD_SEC
  );

  const rawSegments = runLengthEncode(hysteresisFlags, frameDurationSec, totalDurationSec);
  return mergeTinySegments(rawSegments);
}

async function analyzeVocalActivityInner(file: File): Promise<VocalAnalysisResult> {
  const buffer = await decodeFile(file);
  const samples = toMonoSamples(buffer);
  const totalDurationSec = buffer.duration;

  const features = await computeFrameFeatures(samples, buffer.sampleRate);
  const frameDurationSec = HOP_SIZE / buffer.sampleRate;
  const segments = buildSegmentsFromFeatures(features, frameDurationSec, totalDurationSec);

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
