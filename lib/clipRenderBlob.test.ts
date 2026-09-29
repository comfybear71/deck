import { describe, expect, it } from "vitest";
import {
  buildDeckClipRenderLastFramePathname,
  buildDeckClipRenderPathname,
  buildDeckClipRenderPlatePrefix,
  isClipRenderFileForPlate,
  buildClipRenderFilename,
  buildClipRenderLastFrameFilename,
  buildClipRenderLastFramePathname,
  buildClipRenderPathname,
  buildClipRenderPlatePrefix,
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

  it("letters the filename with a plate's 0-based index when given, for a clip with more than one plate", () => {
    expect(buildClipRenderFilename(1, 0, 40, 0)).toBe("01a_0000-0040_render.mp4");
    expect(buildClipRenderFilename(1, 0, 40, 1)).toBe("01b_0000-0040_render.mp4");
    expect(buildClipRenderFilename(1, 0, 40, 2)).toBe("01c_0000-0040_render.mp4");
  });

  it("omits the letter suffix when plateLetterIndex is undefined — unchanged single-plate shape", () => {
    expect(buildClipRenderFilename(1, 0, 40, undefined)).toBe("01_0000-0040_render.mp4");
  });
});

describe("buildClipRenderLastFrameFilename", () => {
  it("mirrors buildClipRenderFilename's numbering, with a _lastframe.jpg extension instead of _render.mp4", () => {
    expect(buildClipRenderLastFrameFilename(1, 0, 40)).toBe("01_0000-0040_lastframe.jpg");
  });

  it("letters the filename the same way as buildClipRenderFilename for a multi-plate clip", () => {
    expect(buildClipRenderLastFrameFilename(1, 0, 40, 1)).toBe("01b_0000-0040_lastframe.jpg");
  });
});

describe("buildClipRenderLastFramePathname", () => {
  it("sits under the exact same plate prefix as the render's own pathname", () => {
    const videoPathname = buildClipRenderPathname("segment_abc123", "plate_xyz", 2, 40, 90);
    const framePathname = buildClipRenderLastFramePathname("segment_abc123", "plate_xyz", 2, 40, 90);
    expect(framePathname).toBe(`${CLIP_RENDER_PATH_PREFIX}segment_abc123/plate_xyz/02_0040-0090_lastframe.jpg`);
    expect(framePathname.startsWith(buildClipRenderPlatePrefix("segment_abc123", "plate_xyz"))).toBe(true);
    expect(framePathname).not.toBe(videoPathname);
  });
});

describe("buildClipRenderPathname / parseClipRenderPathname", () => {
  it("round-trips every field through build then parse, nested by plateId", () => {
    const pathname = buildClipRenderPathname("segment_abc123", "plate_xyz", 2, 40, 90);
    expect(pathname).toBe(`${CLIP_RENDER_PATH_PREFIX}segment_abc123/plate_xyz/02_0040-0090_render.mp4`);

    expect(parseClipRenderPathname(pathname)).toEqual({
      segmentId: "segment_abc123",
      plateId: "plate_xyz",
      clipIndex: 2,
      startSec: 40,
      endSec: 90,
      filename: "02_0040-0090_render.mp4",
    });
  });

  it("round-trips a lettered (multi-plate) filename too", () => {
    const pathname = buildClipRenderPathname("segment_abc123", "plate_xyz", 1, 0, 40, 1);
    expect(pathname).toBe(`${CLIP_RENDER_PATH_PREFIX}segment_abc123/plate_xyz/01b_0000-0040_render.mp4`);
    expect(parseClipRenderPathname(pathname)?.filename).toBe("01b_0000-0040_render.mp4");
  });

  it("returns the same pathname for the same plate across repeated calls — this is what lets a re-render overwrite the last one", () => {
    const first = buildClipRenderPathname("segment_abc123", "plate_xyz", 1, 0, 40);
    const second = buildClipRenderPathname("segment_abc123", "plate_xyz", 1, 0, 40);
    expect(first).toBe(second);
  });

  it("returns null for a pathname outside this prefix, missing a segment/plate folder, or with a malformed basename", () => {
    expect(parseClipRenderPathname("skidmarks/plate-stills/segment_abc/still.jpg")).toBeNull();
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}not-a-real-render.mp4`)).toBeNull();
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}segment_abc/plate_xyz/oops.mp4`)).toBeNull();
    expect(
      parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}segment_abc/plate_xyz/01_0000-0040_render.mov`)
    ).toBeNull();
    // The pre-per-plate pathname scheme (no plate folder at all) no
    // longer matches — see this module's doc comment's migration note.
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}segment_abc/01_0000-0040_render.mp4`)).toBeNull();
  });

  it("never mistakes a sibling last-frame image for a video render", () => {
    const framePathname = buildClipRenderLastFramePathname("segment_abc123", "plate_xyz", 1, 0, 40);
    expect(parseClipRenderPathname(framePathname)).toBeNull();
  });

  it("returns null when the parsed segment or plate id would itself be unsafe (defensive — build never emits this today)", () => {
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}bad;id/plate_xyz/01_0000-0040_render.mp4`)).toBeNull();
    expect(parseClipRenderPathname(`${CLIP_RENDER_PATH_PREFIX}segment_abc/bad;id/01_0000-0040_render.mp4`)).toBeNull();
  });
});

describe("buildClipRenderPlatePrefix", () => {
  it("returns this plate's own directory prefix, independent of clipIndex/startSec/endSec/plateLetterIndex", () => {
    expect(buildClipRenderPlatePrefix("segment_abc123", "plate_xyz")).toBe(
      `${CLIP_RENDER_PATH_PREFIX}segment_abc123/plate_xyz/`
    );
  });

  it("is a real prefix of every pathname built for the same plate, however the filename varies", () => {
    const prefix = buildClipRenderPlatePrefix("segment_abc123", "plate_xyz");
    // Same plate, but the filename drifted (a reordered timeline
    // changed clipIndex, a plate count change added a letter suffix) —
    // this is exactly the case `pruneStaleRendersForPlate`
    // (`app/api/skidmarks/generate-clip/route.ts`) has to catch both of.
    const before = buildClipRenderPathname("segment_abc123", "plate_xyz", 1, 0, 40);
    const after = buildClipRenderPathname("segment_abc123", "plate_xyz", 2, 40, 90, 1);
    expect(before.startsWith(prefix)).toBe(true);
    expect(after.startsWith(prefix)).toBe(true);
    expect(before).not.toBe(after);
  });

  it("never matches a different plate's or segment's prefix", () => {
    const prefix = buildClipRenderPlatePrefix("segment_abc123", "plate_xyz");
    const otherPlate = buildClipRenderPathname("segment_abc123", "plate_other", 1, 0, 40);
    const otherSegment = buildClipRenderPathname("segment_other", "plate_xyz", 1, 0, 40);
    expect(otherPlate.startsWith(prefix)).toBe(false);
    expect(otherSegment.startsWith(prefix)).toBe(false);
  });
});

describe("renders in the readable deck/ tree (2026-09-30)", () => {
  const song = { genre: "music-video" as const, slug: "crack-haul" };

  it("saves into the song's renders folder, one folder per plate, with a readable file name", () => {
    expect(buildDeckClipRenderPathname(song, "segment_1", "plate_2", 3, 40, 90, 0)).toBe(
      "deck/music-video/songs/crack-haul/renders/segment_1/plate_2/crack-haul-clip-03a-0040-0090.mp4",
    );
    expect(buildDeckClipRenderLastFramePathname(song, "segment_1", "plate_2", 3, 40, 90, 0)).toBe(
      "deck/music-video/songs/crack-haul/renders/segment_1/plate_2/crack-haul-clip-03a-0040-0090-last-frame.jpg",
    );
    expect(buildDeckClipRenderPlatePrefix(song, "segment_1", "plate_2")).toBe(
      "deck/music-video/songs/crack-haul/renders/segment_1/plate_2/",
    );
  });

  it("reads a tree render back like an old one, and ignores its last frame", () => {
    expect(parseClipRenderPathname("deck/music-video/songs/crack-haul/renders/segment_1/plate_2/crack-haul-clip-03a-0040-0090.mp4")).toEqual({
      segmentId: "segment_1",
      plateId: "plate_2",
      clipIndex: 3,
      startSec: 40,
      endSec: 90,
      filename: "crack-haul-clip-03a-0040-0090.mp4",
    });
    // A song whose own name contains "clip" still parses.
    expect(parseClipRenderPathname("deck/music-video/songs/clip-2-clip/renders/s/p/clip-2-clip-clip-01-0000-0010.mp4")?.clipIndex).toBe(1);
    expect(parseClipRenderPathname("deck/music-video/songs/crack-haul/renders/segment_1/plate_2/crack-haul-clip-03a-0040-0090-last-frame.jpg")).toBeNull();
    expect(parseClipRenderPathname("deck/music-video/songs/crack-haul/plates/crack-haul-clip-03a.jpg")).toBeNull();
  });

  it("knows which files belong to one plate, in either place", () => {
    expect(isClipRenderFileForPlate("skidmarks/clip-renders/segment_1/plate_2/03a_0040-0090_render.mp4", "segment_1", "plate_2")).toBe(true);
    expect(isClipRenderFileForPlate("deck/music-video/songs/x/renders/segment_1/plate_2/x-clip-03a-0040-0090.mp4", "segment_1", "plate_2")).toBe(true);
    expect(isClipRenderFileForPlate("deck/music-video/songs/x/renders/segment_1/plate_22/x-clip-03a-0040-0090.mp4", "segment_1", "plate_2")).toBe(false);
    expect(isClipRenderFileForPlate("deck/music-video/songs/x/renders/segment_1/plate_2/sub/x.mp4", "segment_1", "plate_2")).toBe(false);
  });
});
