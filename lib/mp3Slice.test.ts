import { describe, expect, it } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";
import { estimateMp3DurationSec, parseMp3Frames, skipLeadingId3v2Tag, sliceMp3ToTimeRange } from "./mp3Slice";

/**
 * Encodes a real MP3 via the same `@breezystack/lamejs` encoder
 * `lib/audioCompression.ts` already uses (pure JS, works unmodified in
 * Node — no `AudioContext`/browser needed for the *encode* half, unlike
 * that module's own decode half) — a genuine, real-encoder-produced
 * fixture, not a hand-rolled fake frame header, so these tests exercise
 * `lib/mp3Slice.ts` against bytes an actual MP3 encoder actually wrote.
 */
function encodeTestMp3(durationSec: number, sampleRate: number = 22050, bitrateKbps: number = 64): Uint8Array {
  const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
  const totalSamples = Math.round(durationSec * sampleRate);
  const pcm = new Int16Array(totalSamples);
  // A simple 440Hz tone — the actual waveform doesn't matter to a
  // frame-boundary parser, just needs to be real encoded audio.
  for (let i = 0; i < totalSamples; i++) {
    pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5 * 0x7fff);
  }
  const chunks: Uint8Array[] = [];
  const chunkSize = 1152;
  for (let i = 0; i < pcm.length; i += chunkSize) {
    const encoded = encoder.encodeBuffer(pcm.subarray(i, i + chunkSize));
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

describe("skipLeadingId3v2Tag", () => {
  it("returns 0 for a buffer with no ID3v2 tag", () => {
    const mp3 = encodeTestMp3(1);
    expect(skipLeadingId3v2Tag(mp3)).toBe(0);
  });

  it("skips a real ID3v2 header's synchsafe size", () => {
    const tag = new Uint8Array(10);
    tag.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00]); // "ID3", size = 0x80 = 128
    expect(skipLeadingId3v2Tag(tag)).toBe(10 + 128);
  });

  it("returns 0 for a buffer too short to hold a header", () => {
    expect(skipLeadingId3v2Tag(new Uint8Array(4))).toBe(0);
  });
});

describe("parseMp3Frames", () => {
  it("parses a real lamejs-encoded MP3 into a non-empty, ordered frame list", () => {
    const mp3 = encodeTestMp3(2);
    const frames = parseMp3Frames(mp3);
    expect(frames.length).toBeGreaterThan(10);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].offset).toBeGreaterThanOrEqual(frames[i - 1].offset + frames[i - 1].length);
      expect(frames[i].startSec).toBeCloseTo(frames[i - 1].startSec + frames[i - 1].durationSec, 5);
    }
  });

  it("accumulates a total duration close to the real encoded length", () => {
    const mp3 = encodeTestMp3(3, 22050, 64);
    const frames = parseMp3Frames(mp3);
    const last = frames[frames.length - 1];
    const totalSec = last.startSec + last.durationSec;
    expect(totalSec).toBeGreaterThan(2.9);
    expect(totalSec).toBeLessThan(3.2);
  });

  it("returns an empty list for bytes that aren't a real MP3", () => {
    expect(parseMp3Frames(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([]);
  });

  it("recognizes frames at a different real sample rate/bitrate pairing (MPEG-1 territory)", () => {
    const mp3 = encodeTestMp3(1.5, 44100, 128);
    const frames = parseMp3Frames(mp3);
    expect(frames.length).toBeGreaterThan(10);
    // MPEG-1 Layer III frames carry 1152 samples/frame -> 1152/44100s each.
    expect(frames[0].durationSec).toBeCloseTo(1152 / 44100, 6);
  });
});

describe("sliceMp3ToTimeRange", () => {
  it("slices a real, non-empty, strictly smaller byte range out of the middle of the file", () => {
    const mp3 = encodeTestMp3(5, 22050, 64);
    const outcome = sliceMp3ToTimeRange(mp3, 1, 2);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.bytes.length).toBeGreaterThan(0);
    expect(outcome.bytes.length).toBeLessThan(mp3.length);
    // The frame-aligned actual range always covers the request fully.
    expect(outcome.actualStartSec).toBeLessThanOrEqual(1);
    expect(outcome.actualEndSec).toBeGreaterThanOrEqual(2);
  });

  it("produces a slice whose own re-parsed frames land in the requested window", () => {
    const mp3 = encodeTestMp3(6, 22050, 64);
    const outcome = sliceMp3ToTimeRange(mp3, 2, 4);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const reparsed = parseMp3Frames(outcome.bytes);
    expect(reparsed.length).toBeGreaterThan(0);
    const sliceDurationSec = outcome.actualEndSec - outcome.actualStartSec;
    expect(sliceDurationSec).toBeGreaterThanOrEqual(2);
    expect(sliceDurationSec).toBeLessThan(2.5);
  });

  it("handles a slice starting at 0 through the whole file", () => {
    const mp3 = encodeTestMp3(1, 22050, 64);
    const outcome = sliceMp3ToTimeRange(mp3, 0, 999);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.actualStartSec).toBe(0);
  });

  it("reports an honest error for bytes that aren't a real MP3, never a fake/empty success", () => {
    const outcome = sliceMp3ToTimeRange(new Uint8Array([9, 9, 9, 9]), 0, 5);
    expect(outcome).toEqual({
      ok: false,
      error: "Could not find any valid MP3 audio frames in this file \u2014 it may be corrupt or not really an MP3.",
    });
  });

  it("reports an honest error when the requested range is past the end of a real, short file", () => {
    const mp3 = encodeTestMp3(1, 22050, 64);
    const outcome = sliceMp3ToTimeRange(mp3, 10, 15);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("No audio frames fall inside");
  });

  describe("maxDurationSec \u2014 trims an over-long slice instead of erroring", () => {
    it("trims a slice back to at most maxDurationSec when outward rounding would otherwise exceed it", () => {
      const mp3 = encodeTestMp3(40, 22050, 64);
      // Request a window whose outward-rounded natural length would sit
      // right at (or a hair past) the ceiling \u2014 the real live-QA'd
      // "audio slice is 20.0s" shape, generalized to any ceiling.
      const withoutCap = sliceMp3ToTimeRange(mp3, 0, 30);
      expect(withoutCap.ok).toBe(true);
      if (!withoutCap.ok) return;

      const withCap = sliceMp3ToTimeRange(mp3, 0, 30, 30);
      expect(withCap.ok).toBe(true);
      if (!withCap.ok) return;
      const actualDurationSec = withCap.actualEndSec - withCap.actualStartSec;
      expect(actualDurationSec).toBeLessThanOrEqual(30);
      // Trimming only ever drops bytes from the end \u2014 the requested
      // window's own start point is untouched.
      expect(withCap.actualStartSec).toBe(withoutCap.actualStartSec);
    });

    it("never throws and never returns an empty slice, even when maxDurationSec is tiny", () => {
      const mp3 = encodeTestMp3(5, 22050, 64);
      const outcome = sliceMp3ToTimeRange(mp3, 0, 5, 0.001);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.bytes.length).toBeGreaterThan(0);
      // Can't trim below one real frame \u2014 that frame's own duration
      // may still exceed the (pathologically tiny) cap; this is the
      // documented "never produce an empty slice" floor, not a promise
      // to satisfy an unreasonably small maxDurationSec exactly.
      expect(outcome.actualEndSec).toBeGreaterThan(outcome.actualStartSec);
    });

    it("leaves a slice that's already within maxDurationSec untouched", () => {
      const mp3 = encodeTestMp3(10, 22050, 64);
      const withoutCap = sliceMp3ToTimeRange(mp3, 1, 3);
      const withCap = sliceMp3ToTimeRange(mp3, 1, 3, 30);
      expect(withCap).toEqual(withoutCap);
    });

    it("real-world regression: a plate clamped to exactly the LTX ceiling never fails after trimming", () => {
      // Stuart's live-QA repro shape: a plate's requested window sits
      // right at the product ceiling (previously 20s, now 30s) \u2014
      // frame-aligned outward rounding must never push the *actual*
      // slice back over that same ceiling once maxDurationSec is given.
      const mp3 = encodeTestMp3(45, 44100, 128);
      const outcome = sliceMp3ToTimeRange(mp3, 5, 35, 30);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.actualEndSec - outcome.actualStartSec).toBeLessThanOrEqual(30);
    });
  });
});

describe("estimateMp3DurationSec", () => {
  it("real reported need (2026-09-15): reports a real encoder's actual duration, closely, not just the requested one", () => {
    const mp3 = encodeTestMp3(4, 22050, 64);
    const duration = estimateMp3DurationSec(mp3);
    // Real encoders don't land on the exact requested length (frame
    // quantization, encoder flush padding) — close, not exact, is the
    // honest bar here, same tolerance the rest of this file's real-MP3
    // fixtures already work within.
    expect(duration).toBeGreaterThan(3.5);
    expect(duration).toBeLessThan(4.5);
  });

  it("scales with real content — a longer file reports a longer duration", () => {
    const short = estimateMp3DurationSec(encodeTestMp3(2, 22050, 64));
    const long = estimateMp3DurationSec(encodeTestMp3(8, 22050, 64));
    expect(long).toBeGreaterThan(short);
  });

  it("returns 0 for bytes with no valid MP3 frames, rather than throwing", () => {
    expect(estimateMp3DurationSec(new TextEncoder().encode("not an mp3"))).toBe(0);
    expect(estimateMp3DurationSec(new Uint8Array(0))).toBe(0);
  });
});
