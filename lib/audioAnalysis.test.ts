import { describe, expect, it } from "vitest";
import {
  buildSegmentsFromFeatures,
  computeFrameFeatures,
  FRAME_SIZE,
  type FrameFeatures,
  type VocalAnalysisSegment,
} from "./audioAnalysis";

/**
 * These tests exercise `buildSegmentsFromFeatures` (the hysteresis +
 * threshold + merge pipeline) directly against hand-built frame
 * features, and `computeFrameFeatures` (the real FFT feature
 * extraction) against synthetic PCM signals. We don't have Stuart's
 * actual MP3 in this repo, so none of this is a substitute for
 * re-running the real analysis against "Talking To Concrete" — see the
 * PR description for that caveat. What this *does* verify: the
 * hysteresis/threshold logic behaves the way the module doc comments
 * claim, against inputs deliberately shaped like Stuart's reported bug
 * (a live "0:32–1:04 called Instrumental" mislabel) and his fuller
 * ground-truth timeline for the same track.
 */

const FRAME_DURATION_SEC = 0.2; // 5 synthetic "frames" per second — plenty of resolution to exercise second-scale hysteresis without needing real FFT frame counts.

function frames(feature: FrameFeatures, durationSec: number): FrameFeatures[] {
  const count = Math.round(durationSec / FRAME_DURATION_SEC);
  return new Array(count).fill(feature);
}

// Loud + vocal-band-dominant + spread across the band (low peakiness) —
// a real sung phrase.
const VOCAL: FrameFeatures = { rms: 0.2, vocalRatio: 0.55, vocalBandPeakiness: 0.25 };
// Loud but vocal-band is a minority of the energy — a bassline, drums,
// a pad; the pre-existing "instrumental" case.
const INSTRUMENTAL: FrameFeatures = { rms: 0.2, vocalRatio: 0.15, vocalBandPeakiness: 0.3 };
// Loud, vocal-band-dominant, but concentrated in one bin — a sustained
// near-pure tone (flute) sitting in the same band real vocals live in.
const FLUTE: FrameFeatures = { rms: 0.2, vocalRatio: 0.6, vocalBandPeakiness: 0.75 };
// Same profile as VOCAL — used for the isolated "false-ish" blip case,
// since the live bug report's blip really did read as vocal-like per
// the raw per-frame signal; the point being tested is that it's short
// and isolated, not that it was never detected at all.
const FALSE_BLIP = VOCAL;

function totalDuration(...ranges: FrameFeatures[][]): number {
  return ranges.reduce((sum, r) => sum + r.length, 0) * FRAME_DURATION_SEC;
}

/** Segment containing time `t` (or the last segment if `t` lands on the
 * very end of the timeline). */
function segmentAt(segments: VocalAnalysisSegment[], t: number): VocalAnalysisSegment {
  const found = segments.find((s) => t >= s.startSec && t < s.endSec);
  if (found) return found;
  const last = segments[segments.length - 1];
  if (last && t === last.endSec) return last;
  throw new Error(`No segment contains t=${t}`);
}

/** All segments that overlap the open interval (fromSec, toSec). */
function segmentsOverlapping(
  segments: VocalAnalysisSegment[],
  fromSec: number,
  toSec: number
): VocalAnalysisSegment[] {
  return segments.filter((s) => s.startSec < toSec && s.endSec > fromSec);
}

describe("buildSegmentsFromFeatures", () => {
  it("keeps a pure instrumental track entirely Instrumental", () => {
    const features = frames(INSTRUMENTAL, 60);
    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, 60);
    expect(segments).toEqual([{ startSec: 0, endSec: 60, vocal: false }]);
  });

  it("keeps a pure vocal track entirely Vocal", () => {
    const features = frames(VOCAL, 60);
    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, 60);
    expect(segments).toEqual([{ startSec: 0, endSec: 60, vocal: true }]);
  });

  it("does not flip sustained singing to Instrumental after a 1-2s dip (the reported live bug)", () => {
    // Mirrors the live report almost exactly: quiet-ish intro, a short
    // false-ish vocal blip, instrumental, then a long real vocal
    // section with a couple of short masked dips in the middle of it —
    // the dips are what got misread as "0:32-1:04 back to Instrumental"
    // before this fix.
    const intro = frames(INSTRUMENTAL, 9);
    const falseBlip = frames(FALSE_BLIP, 4); // 0:09-0:13
    const gap = frames(INSTRUMENTAL, 17); // 0:13-0:30
    const onset = frames(VOCAL, 2); // 0:30-0:32
    const sustainedA = frames(VOCAL, 8);
    const shortDip = frames(INSTRUMENTAL, 2); // a masked syllable/beat, not a real break
    const sustainedB = frames(VOCAL, 22); // carries the run out to 1:04 and well beyond

    const features = [
      ...intro,
      ...falseBlip,
      ...gap,
      ...onset,
      ...sustainedA,
      ...shortDip,
      ...sustainedB,
    ];
    const total = totalDuration(
      intro,
      falseBlip,
      gap,
      onset,
      sustainedA,
      shortDip,
      sustainedB
    );
    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    // The whole 0:30 -> end run must stay one continuous Vocal segment —
    // the short dip in the middle must not carve out an Instrumental
    // island (that was the actual bug).
    const sustainedRun = segmentsOverlapping(segments, 30, total);
    expect(sustainedRun).toHaveLength(1);
    expect(sustainedRun[0].vocal).toBe(true);
    expect(sustainedRun[0].endSec).toBe(total);

    // And the early isolated false-ish blip should be suppressed
    // (folded into the surrounding instrumental) rather than surviving
    // as its own tiny Vocal segment.
    expect(segmentAt(segments, 11).vocal).toBe(false);
  });

  it("calls a sustained flute passage Instrumental despite sitting in the vocal band", () => {
    const before = frames(VOCAL, 20);
    const flute = frames(FLUTE, 15); // longer than a real instrumental break should be
    const after = frames(VOCAL, 20);
    const features = [...before, ...flute, ...after];
    const total = totalDuration(before, flute, after);

    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    expect(segmentAt(segments, 10).vocal).toBe(true); // inside `before`
    expect(segmentAt(segments, 27).vocal).toBe(false); // inside `flute`
    expect(segmentAt(segments, 45).vocal).toBe(true); // inside `after`
  });

  it("does not let brief 2-3s flute interludes end a sustained vocal section", () => {
    const before = frames(VOCAL, 10);
    const dip1 = frames(FLUTE, 2.4);
    const mid1 = frames(VOCAL, 8);
    const dip2 = frames(FLUTE, 2.8);
    const mid2 = frames(VOCAL, 8);
    const dip3 = frames(FLUTE, 2.2);
    const after = frames(VOCAL, 10);

    const features = [...before, ...dip1, ...mid1, ...dip2, ...mid2, ...dip3, ...after];
    const total = totalDuration(before, dip1, mid1, dip2, mid2, dip3, after);

    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    // One continuous Vocal run start-to-finish; none of the 2-3s flute
    // dips should have carved out their own Instrumental segment.
    expect(segments).toEqual([{ startSec: 0, endSec: total, vocal: true }]);
  });

  it("matches Stuart's full ground-truth shape for Jack Ash - Talking To Concrete (~4:16)", () => {
    // 0:00-0:09 instrumental
    const intro = frames(INSTRUMENTAL, 9);
    // 0:09-0:13 the live run's false-ish vocal blip
    const falseBlip = frames(FALSE_BLIP, 4);
    // 0:13-0:31 instrumental
    const gap = frames(INSTRUMENTAL, 18);
    // 0:31-0:32 vocal onset
    const onset = frames(VOCAL, 1);
    // 0:32-1:52 (80s) mostly vocal, with several 2-3s flute interludes
    // woven in
    const verseA = frames(VOCAL, 13);
    const fluteDip1 = frames(FLUTE, 2.4);
    const verseB = frames(VOCAL, 12.6);
    const fluteDip2 = frames(FLUTE, 2.6);
    const verseC = frames(VOCAL, 22.4);
    const fluteDip3 = frames(FLUTE, 2.2);
    const verseD = frames(VOCAL, 12.8);
    const fluteDip4 = frames(FLUTE, 2.4);
    const verseE = frames(VOCAL, 9.6);
    // 1:52-2:05 (13s) flute break, no vocal
    const fluteBreak = frames(FLUTE, 13);
    // 2:05-3:08 (63s) vocals
    const verseF = frames(VOCAL, 63);
    // 3:08-3:51 (43s) mixed break, some vocal
    const mixedA = frames(VOCAL, 11);
    const mixedB = frames(INSTRUMENTAL, 11);
    const mixedC = frames(VOCAL, 11);
    const mixedD = frames(INSTRUMENTAL, 10);
    // 3:51-4:16 (25s) no vocals
    const outro = frames(INSTRUMENTAL, 25);

    const sections = [
      intro,
      falseBlip,
      gap,
      onset,
      verseA,
      fluteDip1,
      verseB,
      fluteDip2,
      verseC,
      fluteDip3,
      verseD,
      fluteDip4,
      verseE,
      fluteBreak,
      verseF,
      mixedA,
      mixedB,
      mixedC,
      mixedD,
      outro,
    ];
    const features = sections.flat();
    const total = totalDuration(...sections);
    expect(total).toBeCloseTo(256, 5); // 4:16

    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    // Fewer, verse-scale segments — nowhere near the live run's 17.
    expect(segments.length).toBeLessThanOrEqual(10);

    // 0:00-0:31: instrumental throughout, including where the false
    // blip sits — it should have been folded away, not survived as its
    // own Vocal segment.
    for (const seg of segmentsOverlapping(segments, 0, 31)) {
      expect(seg.vocal).toBe(false);
    }

    // 0:32-1:52: one continuous Vocal run bridging every flute dip —
    // this is the exact case the live run got wrong (it called
    // 0:32-1:04 Instrumental).
    const mainVerse = segmentsOverlapping(segments, 32, 112);
    expect(mainVerse).toHaveLength(1);
    expect(mainVerse[0].vocal).toBe(true);

    // 1:52-2:05: the real flute break reads as Instrumental.
    expect(segmentAt(segments, 118).vocal).toBe(false);

    // 2:05-3:08: vocals.
    expect(segmentAt(segments, 150).vocal).toBe(true);

    // 3:51-4:16: no vocals.
    expect(segmentAt(segments, 245).vocal).toBe(false);
  });
});

describe("computeFrameFeatures (real FFT) — flute vs. voice cue", () => {
  const SAMPLE_RATE = 44100;

  function sineWave(freqHz: number, durationSec: number, amplitude = 0.4): Float32Array {
    const n = Math.round(durationSec * SAMPLE_RATE);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE);
    }
    return out;
  }

  /** A handful of formant-like tones spread across the vocal band with
   * a slow syllable-rate amplitude wobble — not a real voice, but
   * deliberately spectrally *broad* the way a sung vowel is, unlike a
   * flute's near-single-frequency tone. */
  function voiceLikeWave(durationSec: number, amplitude = 0.4): Float32Array {
    const n = Math.round(durationSec * SAMPLE_RATE);
    const out = new Float32Array(n);
    const formants = [500, 900, 1500, 2400];
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const syllable = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t);
      let sum = 0;
      for (const f of formants) sum += Math.sin(2 * Math.PI * f * t);
      out[i] = amplitude * syllable * (sum / formants.length);
    }
    return out;
  }

  function average(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  it("reads a sustained pure tone (flute-like) as highly 'peaky' in the vocal band", async () => {
    const samples = sineWave(900, 2);
    const features = await computeFrameFeatures(samples, SAMPLE_RATE);
    expect(features.length).toBeGreaterThan(0);
    const meanPeakiness = average(features.map((f) => f.vocalBandPeakiness));
    // A near-pure tone should concentrate almost all of its vocal-band
    // energy in one bin.
    expect(meanPeakiness).toBeGreaterThan(0.6);
  });

  it("reads a spectrally-broad voice-like signal as much less 'peaky'", async () => {
    const samples = voiceLikeWave(2);
    const features = await computeFrameFeatures(samples, SAMPLE_RATE);
    const meanPeakiness = average(features.map((f) => f.vocalBandPeakiness));
    const meanRatio = average(features.map((f) => f.vocalRatio));
    // Spread across 4 formants, so no single bin should dominate the
    // way it does for the pure tone above.
    expect(meanPeakiness).toBeLessThan(0.5);
    // Still clearly vocal-band-dominant overall.
    expect(meanRatio).toBeGreaterThan(0.36);
  });

  it("reads a sub-vocal-band bass tone as low vocal-ratio", async () => {
    const samples = sineWave(120, 2);
    const features = await computeFrameFeatures(samples, SAMPLE_RATE);
    const meanRatio = average(features.map((f) => f.vocalRatio));
    expect(meanRatio).toBeLessThan(0.36);
  });

  it("frame size is a power of two (FFT precondition)", () => {
    expect(Math.log2(FRAME_SIZE) % 1).toBe(0);
  });
});
