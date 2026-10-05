import { describe, expect, it } from "vitest";
import { BLANK_IMAGE_ERROR, isBlankImageBytes, MIN_STILL_BYTES } from "./imageBlankCheck";

describe("isBlankImageBytes", () => {
  it("rejects empty and tiny buffers", () => {
    expect(isBlankImageBytes(new Uint8Array(0))).toBe(true);
    expect(isBlankImageBytes(new Uint8Array(MIN_STILL_BYTES - 1))).toBe(true);
  });

  it("rejects a flat buffer (same byte repeated)", () => {
    const flat = new Uint8Array(MIN_STILL_BYTES + 100).fill(128);
    expect(isBlankImageBytes(flat)).toBe(true);
  });

  it("accepts a buffer with varied bytes", () => {
    const varied = new Uint8Array(MIN_STILL_BYTES + 200);
    for (let i = 0; i < varied.length; i++) varied[i] = (i * 37) & 0xff;
    expect(isBlankImageBytes(varied)).toBe(false);
  });

  it("exports a clear Stuart-facing error", () => {
    expect(BLANK_IMAGE_ERROR).toMatch(/blank/i);
    expect(BLANK_IMAGE_ERROR).toMatch(/nothing was saved/i);
  });
});
