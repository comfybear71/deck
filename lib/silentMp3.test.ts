import { describe, expect, it } from "vitest";
import { encodeSilentMp3, silentMp3DurationSec } from "./silentMp3";

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
