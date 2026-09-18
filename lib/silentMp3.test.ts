import { describe, expect, it } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";
import { estimateMp3DurationSec } from "./mp3Slice";
import { encodeSilentMp3, padMp3ToMinimumDurationSec, prependSilenceToMp3, silentMp3DurationSec } from "./silentMp3";

function encodeTestMp3(durationSec: number, sampleRate: number = 22050): Uint8Array {
  const encoder = new Mp3Encoder(1, sampleRate, 64);
  const totalSamples = Math.max(1, Math.round(durationSec * sampleRate));
  const pcm = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5 * 0x7fff);
  }
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const encoded = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
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

describe("encodeSilentMp3", () => {
  it("produces a real MP3 whose parsed duration is at least the requested length (LTX needs ≥2s)", () => {
    const bytes = encodeSilentMp3(5);
    expect(bytes.byteLength).toBeGreaterThan(0);
    const durationSec = silentMp3DurationSec(bytes);
    // Frame rounding can sit a hair under the request; it must still
    // clear LTX's 2s audio-input floor with room to spare.
    expect(durationSec).toBeGreaterThan(4.5);
    expect(durationSec).toBeLessThan(6);
  });

  it("a 2s request still lands at or above LTX's audio-input floor", () => {
    const durationSec = silentMp3DurationSec(encodeSilentMp3(2));
    expect(durationSec).toBeGreaterThanOrEqual(2);
  });
});

describe("padMp3ToMinimumDurationSec", () => {
  it("live QA (2026-09-17): a 0.8s spoken line is padded to at least LTX's 2s floor", () => {
    const spoken = encodeTestMp3(0.8);
    expect(estimateMp3DurationSec(spoken)).toBeLessThan(2);
    const padded = padMp3ToMinimumDurationSec(spoken, 2);
    expect(estimateMp3DurationSec(padded)).toBeGreaterThanOrEqual(2);
    expect(padded.byteLength).toBeGreaterThan(spoken.byteLength);
  });

  it("leaves an already-long enough clip unchanged", () => {
    const spoken = encodeTestMp3(4);
    const padded = padMp3ToMinimumDurationSec(spoken, 2);
    expect(padded).toBe(spoken);
  });

  it("does not invent audio for an empty/unparseable source", () => {
    const empty = new Uint8Array([0, 1, 2, 3]);
    expect(estimateMp3DurationSec(empty)).toBe(0);
    const padded = padMp3ToMinimumDurationSec(empty, 2);
    expect(padded).toBe(empty);
  });
});

describe("prependSilenceToMp3", () => {
  it("adds a silent lead-in before the real audio (settle beat, 2026-09-18)", () => {
    const spoken = encodeTestMp3(3);
    const spokenDurationSec = estimateMp3DurationSec(spoken);
    const withLead = prependSilenceToMp3(spoken, 1.5);
    expect(withLead.byteLength).toBeGreaterThan(spoken.byteLength);
    const totalDurationSec = estimateMp3DurationSec(withLead);
    // Lead + body, with the same frame-rounding slack every other test
    // here already tolerates.
    expect(totalDurationSec).toBeGreaterThan(spokenDurationSec + 1);
    expect(totalDurationSec).toBeLessThan(spokenDurationSec + 2.5);
  });

  it("leaves the real audio bytes fully intact after the lead-in", () => {
    const spoken = encodeTestMp3(2);
    const withLead = prependSilenceToMp3(spoken, 1);
    const tail = withLead.subarray(withLead.byteLength - spoken.byteLength);
    expect(Buffer.compare(Buffer.from(tail), Buffer.from(spoken))).toBe(0);
  });

  it("is a no-op for a non-positive lead time", () => {
    const spoken = encodeTestMp3(2);
    expect(prependSilenceToMp3(spoken, 0)).toBe(spoken);
    expect(prependSilenceToMp3(spoken, -1)).toBe(spoken);
  });

  it("does not invent a lead-in for an empty/unparseable source", () => {
    const empty = new Uint8Array([0, 1, 2, 3]);
    expect(prependSilenceToMp3(empty, 1.5)).toBe(empty);
  });
});
