import { describe, expect, it } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";
import { parseMp3Frames, skipLeadingId3v2Tag, sliceMp3ToTimeRange } from "./mp3Slice";

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
});
