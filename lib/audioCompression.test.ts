import { describe, expect, it } from "vitest";
import {
  chooseCompressionPlan,
  compressAudioForTranscription,
  describeTooLongToCompress,
  estimateMp3Bytes,
  formatDurationForMessage,
  MP3_BITRATE_TIERS_KBPS,
  UPLOAD_BUDGET_BYTES,
  VERCEL_BODY_LIMIT_BYTES,
  DIRECT_UPLOAD_SAFE_BYTES,
} from "./audioCompression";

/**
 * Only the pure, network- and browser-API-free half of
 * `lib/audioCompression.ts` is exercised here — everything from
 * `AudioContext` decode through `lamejs` encoding needs a real browser
 * (or a much heavier jsdom + Web Audio + WASM test harness than this
 * repo's `vitest.config.ts` `environment: "node"` provides). The
 * "already small enough, skip compression" branch of
 * `compressAudioForTranscription` itself *is* covered directly below,
 * since it returns before touching any browser API — the same split
 * `lib/audioAnalysis.test.ts` uses for `buildSegmentsFromFeatures` vs.
 * the full `analyzeVocalActivity`.
 */

describe("estimateMp3Bytes", () => {
  it("computes CBR byte size from bitrate and duration", () => {
    // 32kbps = 4000 bytes/sec; 256s (Jack Ash's ~4:16 runtime) -> ~1.024MB
    expect(estimateMp3Bytes(256, 32)).toBe(4000 * 256);
  });

  it("never returns a negative estimate for a bogus negative duration", () => {
    expect(estimateMp3Bytes(-5, 32)).toBe(0);
  });
});

describe("chooseCompressionPlan", () => {
  it("picks the highest-quality tier that fits a real ~4:16 song under the upload budget", () => {
    const plan = chooseCompressionPlan(256);
    expect(plan).not.toBeNull();
    expect(plan!.bitrateKbps).toBe(64);
    expect(plan!.estimatedBytes).toBeLessThanOrEqual(UPLOAD_BUDGET_BYTES);
  });

  it("drops to a lower bitrate for a longer track that the top tier wouldn't fit", () => {
    // 64kbps * 1000s = 8,000,000 bytes -- over a 4MiB budget, must fall through.
    const plan = chooseCompressionPlan(1000);
    expect(plan).not.toBeNull();
    expect(plan!.bitrateKbps).toBeLessThan(64);
    expect(plan!.estimatedBytes).toBeLessThanOrEqual(UPLOAD_BUDGET_BYTES);
  });

  it("returns null when even the lowest tier can't fit an extremely long track", () => {
    // At the lowest (8kbps) tier, budget/1000 bytes-per-sec caps duration.
    const maxSecondsAtFloor = UPLOAD_BUDGET_BYTES / (MP3_BITRATE_TIERS_KBPS.at(-1)! * 1000 / 8);
    expect(chooseCompressionPlan(maxSecondsAtFloor + 60)).toBeNull();
  });

  it("respects a custom target budget", () => {
    const generous = chooseCompressionPlan(256, 100 * 1024 * 1024);
    expect(generous!.bitrateKbps).toBe(MP3_BITRATE_TIERS_KBPS[0]);

    const stingy = chooseCompressionPlan(256, 1);
    expect(stingy).toBeNull();
  });
});

describe("formatDurationForMessage", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatDurationForMessage(256)).toBe("4:16");
    expect(formatDurationForMessage(5)).toBe("0:05");
    expect(formatDurationForMessage(0)).toBe("0:00");
  });
});

describe("describeTooLongToCompress", () => {
  it("names a real duration and the actual byte limit, not a raw HTTP code", () => {
    const message = describeTooLongToCompress(4000);
    expect(message).toContain("66:40");
    expect(message).toContain("4.5MB");
    expect(message).not.toMatch(/\b413\b/);
  });
});

describe("compressAudioForTranscription", () => {
  it("passes through a file already at/under the direct-upload-safe size untouched", async () => {
    const smallFile = new File([new Uint8Array(DIRECT_UPLOAD_SAFE_BYTES)], "tone.mp3", {
      type: "audio/mpeg",
    });
    const outcome = await compressAudioForTranscription(smallFile);
    expect(outcome).toEqual({ kind: "unchanged", file: smallFile });
  });

  it("reports a decode failure honestly instead of throwing, for a file over the safe size", async () => {
    // No AudioContext exists in this (Node) test environment, so a
    // too-big-to-skip file exercises the decode-failure path -- this is
    // exactly the "unsupported browser" case `lib/transcription.ts`
    // falls back on by uploading the original file.
    const bigFile = new File([new Uint8Array(DIRECT_UPLOAD_SAFE_BYTES + 1)], "song.mp3", {
      type: "audio/mpeg",
    });
    const outcome = await compressAudioForTranscription(bigFile);
    expect(outcome.kind).toBe("failed");
  });
});

describe("sanity: the numbers this module's messaging relies on", () => {
  it("keeps the upload budget comfortably under Vercel's real hard limit", () => {
    expect(UPLOAD_BUDGET_BYTES).toBeLessThan(VERCEL_BODY_LIMIT_BYTES);
  });

  it("can fit a real ~6 minute song at the top bitrate tier", () => {
    const sixMinutes = 6 * 60;
    const plan = chooseCompressionPlan(sixMinutes);
    expect(plan).not.toBeNull();
    expect(plan!.estimatedBytes).toBeLessThan(VERCEL_BODY_LIMIT_BYTES);
  });
});
