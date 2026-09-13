import { describe, expect, it } from "vitest";
import {
  buildClipRenderFilename,
  buildClipRenderPathname,
  CLIP_RENDER_PATH_PREFIX,
  isSafeSegmentId,
  parseClipRenderPathname,
} from "./clipRenderBlob";

describe("isSafeSegmentId", () => {
  it("accepts a real crypto.randomUUID-shaped segment id", () => {
    expect(isSafeSegmentId("segment_3fae1c2b-9a4e-4d7c-8b1a-1234567890ab")).toBe(true);
  });

  it("rejects empty, path-traversal, slash-containing, or overlong ids", () => {
    expect(isSafeSegmentId("")).toBe(false);
    expect(isSafeSegmentId("../../etc/passwd")).toBe(false);
    expect(isSafeSegmentId("segment/with/slash")).toBe(false);
    expect(isSafeSegmentId("a".repeat(201))).toBe(false);
  });

  it("rejects control characters and other unsafe punctuation", () => {
    expect(isSafeSegmentId("segment_ok\nnot-ok")).toBe(false);
    expect(isSafeSegmentId("segment;rm -rf")).toBe(false);
  });
});

describe("buildClipRenderFilename", () => {
  it("matches the task's own numeric-filename example shape (zero-padded index and seconds)", () => {
    expect(buildClipRenderFilename(1, 0, 40)).toBe("01_0000-0040_render.mp4");
  });

  it("zero-pads the clip index to at least 2 digits and seconds to at least 4", () => {
    expect(buildClipRenderFilename(3, 125, 187)).toBe("03_0125-0187_render.mp4");
  });

  it("grows past the minimum width rather than truncating for large values", () => {
    expect(buildClipRenderFilename(12, 10000, 10050)).toBe("12_10000-10050_render.mp4");
    expect(buildClipRenderFilename(103, 0, 5)).toBe("103_0000-0005_render.mp4");
  });

  it("rounds fractional seconds instead of producing a non-integer filename", () => {
    expect(buildClipRenderFilename(1, 0.4, 40.6)).toBe("01_0000-0041_render.mp4");
  });

  it("clamps a negative value to 0 rather than emitting a minus sign into a filename", () => {
    expect(buildClipRenderFilename(1, -1, 40)).toBe("01_0000-0040_render.mp4");
  });
});

describe("buildClipRenderPathname / parseClipRenderPathname", () => {
  it("round-trips every field through build then parse", () => {
    const pathname = buildClipRenderPathname("segment_abc123", 2, 40, 90);
    expect(pathname).toBe(`${CLIP_RENDER_PATH_PREFIX}segment_abc123/02_0040-0090_render.mp4`);

    expect(parseClipRenderPathname(pathname)).toEqual({
      segmentId: "segment_abc123",
      clipIndex: 2,
      startSec: 40,
      endSec: 90,
    });
  });

  it("returns the same pathname for the same clip across repeated calls — this is what lets a re-render overwrite the last one", () => {
    const first = buildClipRenderPathname("segment_abc123", 1, 0, 40);
    const second = buildClipRenderPathname("segment_abc123", 1, 0, 40);
    expect(first).toBe(second);
  });

  it("returns null for a pathname outside this prefix, missing a segment folder, or with a malformed basename", () => {
    expect(parseClipRenderPathname("skidmarks/plate-stills/segment_abc/still.jpg")).toBeNull();
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}not-a-real-render.mp4`)).toBeNull();
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}segment_abc/oops.mp4`)).toBeNull();
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}segment_abc/01_0000-0040_render.mov`)).toBeNull();
  });

  it("returns null when the parsed segment id would itself be unsafe (defensive — build never emits this today)", () => {
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}bad;id/01_0000-0040_render.mp4`)).toBeNull();
  });
});
