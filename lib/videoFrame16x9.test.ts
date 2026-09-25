import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FORCED_VIDEO_ASPECT_RATIO, isSixteenByNine, padFrameTo16x9 } from "./videoFrame16x9";

async function solid(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe("videoFrame16x9", () => {
  it("locks the aspect ratio string to 16:9", () => {
    expect(FORCED_VIDEO_ASPECT_RATIO).toBe("16:9");
  });

  it("treats 16:9 sizes as widescreen and square/portrait as not", () => {
    expect(isSixteenByNine(1920, 1080)).toBe(true);
    expect(isSixteenByNine(2560, 1440)).toBe(true);
    expect(isSixteenByNine(1280, 720)).toBe(true);
    expect(isSixteenByNine(2048, 2048)).toBe(false);
    expect(isSixteenByNine(1080, 1920)).toBe(false);
    expect(isSixteenByNine(0, 0)).toBe(false);
  });

  it("pads a square plate to 1920x1080 without cropping", async () => {
    const out = await padFrameTo16x9(await solid(1024, 1024), "image/png");
    expect(out.padded).toBe(true);
    expect(out.mimeType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
  });

  it("pads a portrait plate to 1920x1080", async () => {
    const out = await padFrameTo16x9(await solid(768, 1024), "image/png");
    expect(out.padded).toBe(true);
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect([meta.width, meta.height]).toEqual([1920, 1080]);
  });

  it("leaves an already-16:9 plate untouched", async () => {
    const input = await solid(1280, 720);
    const out = await padFrameTo16x9(input, "image/png");
    expect(out.padded).toBe(false);
    expect(out.bytes).toBe(input);
  });

  it("returns the original bytes on garbage input instead of throwing", async () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    const out = await padFrameTo16x9(junk, "image/png");
    expect(out.padded).toBe(false);
    expect(out.bytes).toBe(junk);
  });
});
