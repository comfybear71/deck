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
 * PR description for that caveat.
 *
 * Tuned against Stuart's confirmed ground truth for that track:
 * 0:00–0:31 instrumental, 0:31–0:32 vocal onset, 0:32–1:52 mostly vocal
 * with several 2–3s flute interludes woven in (must NOT flip the whole
 * section to Instrumental), 1:52–2:05 a standalone flute
 * passage/instrumental break, 2:05–3:08 vocals, 3:08–3:51 a mixed break
 * with some vocals, 3:51–4:16 no vocals. Also covers the live run's own
 * reported false-ish ~4s blip at 0:09–0:13.
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

  it("does not carve an Instrumental island out of a brief (up to 3s) dip inside a longer vocal run", () => {
    // Generic mechanism test, plus the direct check for Stuart's
    // confirmed "2-3s flute interludes must not flip 0:32-1:52 to
    // Instrumental" requirement: a short masked dip in the middle of an
    // otherwise-sustained vocal-flagged run should get absorbed instead
    // of splitting the run in two. Uses 3.0s — the upper end of
    // Stuart's "2-3 second" estimate — to check the margin actually
    // holds, not just a comfortably-short dip.
    const before = frames(VOCAL, 10);
    const dip = frames(INSTRUMENTAL, 3.0); // upper end of the confirmed "2-3s" estimate
    const after = frames(VOCAL, 10);

    const features = [...before, ...dip, ...after];
    const total = totalDuration(before, dip, after);
    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    expect(segments).toEqual([{ startSec: 0, endSec: total, vocal: true }]);
  });

  it("suppresses an isolated false-ish vocal blip sitting inside a long instrumental run", () => {
    // Mirrors the live run's own report: a ~4s "vocal" blip at
    // 0:09-0:13 that read as vocal-like per the raw signal, but is too
    // short and isolated to trust as a real section.
    const intro = frames(INSTRUMENTAL, 9);
    const falseBlip = frames(FALSE_BLIP, 4); // 0:09-0:13
    const gap = frames(INSTRUMENTAL, 20); // 0:13-0:33

    const features = [...intro, ...falseBlip, ...gap];
    const total = totalDuration(intro, falseBlip, gap);
    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    expect(segments).toEqual([{ startSec: 0, endSec: total, vocal: false }]);
  });

  it("calls a sustained near-pure tone Instrumental despite sitting in the vocal band", () => {
    // Generic instrument test — a lead flute is the motivating example
    // in the code comments, but this isn't a claim that any specific
    // track actually contains one; `FLUTE` here just labels "a
    // sustained near-pure tone" test fixture.
    const before = frames(VOCAL, 20);
    const flute = frames(FLUTE, 15); // longer than EXIT_VOCAL_HOLD_SEC
    const after = frames(VOCAL, 20);
    const features = [...before, ...flute, ...after];
    const total = totalDuration(before, flute, after);

    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    expect(segmentAt(segments, 10).vocal).toBe(true); // inside `before`
    expect(segmentAt(segments, 27).vocal).toBe(false); // inside `flute`
    expect(segmentAt(segments, 45).vocal).toBe(true); // inside `after`
  });

  it("does not let several 2-3s flute interludes end a sustained vocal section", () => {
    // Directly models Stuart's confirmed "0:32-1:52 mostly vocal, with
    // many little 2-3 second flute interludes woven in" — none of them
    // should end the run, including the ones right at the 3.0s edge of
    // his estimate.
    const before = frames(VOCAL, 10);
    const dip1 = frames(FLUTE, 2.0);
    const mid1 = frames(VOCAL, 8);
    const dip2 = frames(FLUTE, 3.0);
    const mid2 = frames(VOCAL, 8);
    const dip3 = frames(FLUTE, 2.5);
    const after = frames(VOCAL, 10);

    const features = [...before, ...dip1, ...mid1, ...dip2, ...mid2, ...dip3, ...after];
    const total = totalDuration(before, dip1, mid1, dip2, mid2, dip3, after);

    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    // One continuous Vocal run start-to-finish; none of the flute
    // interludes should have carved out their own Instrumental segment.
    expect(segments).toEqual([{ startSec: 0, endSec: total, vocal: true }]);
  });

  it("aligns onset tightly at the confirmed 0:31-0:32 window and keeps everything before it Instrumental", () => {
    // Encodes the start of the confirmed timeline: instrumental through
    // 0:31, the live run's own false-ish blip at 0:09-0:13 (should be
    // suppressed), and a vocal onset specifically at 0:31-0:32. `tail`
    // is just enough continuation for the onset segment to survive the
    // `MIN_SEGMENT_SEC` merge step so its start time is observable (the
    // fuller test below covers what actually happens after 0:32).
    const intro = frames(INSTRUMENTAL, 9);
    const falseBlip = frames(FALSE_BLIP, 4); // 0:09-0:13
    const gap = frames(INSTRUMENTAL, 18); // 0:13-0:31
    const onset = frames(VOCAL, 1); // 0:31-0:32, confirmed
    const tail = frames(VOCAL, 8); // scaffolding only, see comment above

    const features = [...intro, ...falseBlip, ...gap, ...onset, ...tail];
    const total = totalDuration(intro, falseBlip, gap, onset, tail);
    const segments = buildSegmentsFromFeatures(features, FRAME_DURATION_SEC, total);

    // Everything before the onset reads Instrumental, including where
    // the false-ish blip sits — folded away, not its own segment.
    for (const seg of segmentsOverlapping(segments, 0, 31)) {
      expect(seg.vocal).toBe(false);
    }

    // The detected onset should land right at the confirmed 0:31-0:32
    // window, not several seconds late.
    const onsetSegment = segmentAt(segments, 32.5);
    expect(onsetSegment.vocal).toBe(true);
    expect(onsetSegment.startSec).toBeGreaterThanOrEqual(31);
    expect(onsetSegment.startSec).toBeLessThanOrEqual(32);
  });

  it("matches Stuart's confirmed ground-truth map for Jack Ash - Talking To Concrete (~4:16)", () => {
    // 0:00-0:09 instrumental
    const intro = frames(INSTRUMENTAL, 9);
    // 0:09-0:13 the live run's own false-ish vocal blip
    const falseBlip = frames(FALSE_BLIP, 4);
    // 0:13-0:31 instrumental
    const gap = frames(INSTRUMENTAL, 18);
    // 0:31-0:32 vocal onset
    const onset = frames(VOCAL, 1);
    // 0:32-1:52 (80s) mostly vocal, with several 2-3s flute interludes
    // woven in — durations deliberately span the full 2-3s confirmed
    // range, including the 3.0s upper edge.
    const verseA = frames(VOCAL, 13);
    const fluteDip1 = frames(FLUTE, 2.0);
    const verseB = frames(VOCAL, 12);
    const fluteDip2 = frames(FLUTE, 3.0);
    const verseC = frames(VOCAL, 23);
    const fluteDip3 = frames(FLUTE, 2.4);
    const verseD = frames(VOCAL, 12.6);
    const fluteDip4 = frames(FLUTE, 2.0);
    const verseE = frames(VOCAL, 10);
    // 1:52-2:05 (13s) standalone flute passage, no vocal
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
    // blip sits — folded away, not its own Vocal segment.
    for (const seg of segmentsOverlapping(segments, 0, 31)) {
      expect(seg.vocal).toBe(false);
    }

    // 0:32-1:52: one continuous Vocal run bridging every flute
    // interlude — the exact case the live run got wrong (it called
    // 0:32-1:04 Instrumental).
    const mainVerse = segmentsOverlapping(segments, 32, 112);
    expect(mainVerse).toHaveLength(1);
    expect(mainVerse[0].vocal).toBe(true);

    // 1:52-2:05: the standalone flute passage reads as Instrumental.
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
    expect(meanRatio).toBeGreaterThan(0.42);
  });

  it("reads a sub-vocal-band bass tone as low vocal-ratio", async () => {
    const samples = sineWave(120, 2);
    const features = await computeFrameFeatures(samples, SAMPLE_RATE);
    const meanRatio = average(features.map((f) => f.vocalRatio));
    expect(meanRatio).toBeLessThan(0.42);
  });

  it("frame size is a power of two (FFT precondition)", () => {
    expect(Math.log2(FRAME_SIZE) % 1).toBe(0);
  });
});
