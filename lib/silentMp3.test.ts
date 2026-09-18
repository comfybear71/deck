import { describe, expect, it } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";
import { estimateMp3DurationSec } from "./mp3Slice";
import {
  encodeSilentMp3,
  padMp3ToMinimumDurationSec,
  prependSilenceToMp3,
  silentMp3DurationSec,
} from "./silentMp3";

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

/** MPEG frames all start `0xFF 0xEx` — counting them is the same
 * frame-walk `estimateMp3DurationSec` does, and it is how these tests
 * prove the spoken bytes survive a silent lead-in rather than being
 * re-encoded or truncated. */
function countMp3Frames(bytes: Uint8Array): number {
  let frames = 0;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) frames += 1;
  }
  return frames;
}

describe("prependSilenceToMp3", () => {
  it("settle lead-in: a 1.5s silent head makes the file longer and still carries every spoken frame", () => {
    const spoken = encodeTestMp3(3);
    const spokenDurationSec = estimateMp3DurationSec(spoken);
    const led = prependSilenceToMp3(spoken, 1.5);

    expect(led.byteLength).toBeGreaterThan(spoken.byteLength);
    const ledDurationSec = estimateMp3DurationSec(led);
    expect(ledDurationSec).toBeGreaterThan(spokenDurationSec + 1.2);
    expect(ledDurationSec).toBeLessThan(spokenDurationSec + 2);

    // Frame count is silence + the untouched spoken body, and the
    // spoken bytes sit verbatim at the tail (silence leads, never
    // overwrites the line).
    expect(countMp3Frames(led)).toBeGreaterThanOrEqual(countMp3Frames(spoken));
    const tail = led.subarray(led.length - spoken.length);
    expect(Buffer.compare(Buffer.from(tail), Buffer.from(spoken))).toBe(0);
  });

  it("puts the silence at the head, not the tail — the opposite end from padMp3ToMinimumDurationSec", () => {
    const spoken = encodeTestMp3(3);
    const led = prependSilenceToMp3(spoken, 1.5);
    const padded = padMp3ToMinimumDurationSec(encodeTestMp3(0.8), 2);

    expect(Buffer.compare(Buffer.from(led.subarray(0, spoken.length)), Buffer.from(spoken))).not.toBe(0);
    // The padder's own body still leads, confirming the two helpers are
    // mirror images rather than duplicates of each other.
    expect(padded.subarray(0, 4)).toEqual(encodeTestMp3(0.8).subarray(0, 4));
  });

  it("a short line plus the settle lead clears LTX's 2s floor on its own", () => {
    const shortLine = encodeTestMp3(0.8);
    expect(estimateMp3DurationSec(shortLine)).toBeLessThan(2);
    const led = prependSilenceToMp3(shortLine, 1.5);
    expect(estimateMp3DurationSec(led)).toBeGreaterThanOrEqual(2);
    // And the existing floor check is then a no-op rather than a second
    // silent tail on top of the lead.
    expect(padMp3ToMinimumDurationSec(led, 2)).toBe(led);
  });

  it("returns the source untouched for a non-positive lead", () => {
    const spoken = encodeTestMp3(3);
    expect(prependSilenceToMp3(spoken, 0)).toBe(spoken);
    expect(prependSilenceToMp3(spoken, -1)).toBe(spoken);
  });

  it("does not invent audio for an empty/unparseable source — a real TTS failure stays visible", () => {
    const empty = new Uint8Array([0, 1, 2, 3]);
    expect(prependSilenceToMp3(empty, 1.5)).toBe(empty);
  });
});
