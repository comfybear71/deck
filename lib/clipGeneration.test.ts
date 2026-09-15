import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClipGenerationRequest,
  computeLtxPlateDurationSec,
  computePlateDurationSec,
  computePlateTimeRange,
  estimateClipRenderCostUsd,
  estimateH3ClipRenderCostUsd,
  estimateLtxClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_CLIP_DURATION_SEC,
  MAX_LTX_CLIP_DURATION_SEC,
  MIN_CLIP_DURATION_SEC,
  MIN_LTX_CLIP_DURATION_SEC,
  MAX_MOTION_PROMPT_LENGTH,
} from "./clipGeneration";
import type { SkidmarksMember } from "./skidmarks";

function member(overrides: Partial<SkidmarksMember>): SkidmarksMember {
  return { id: "member-id", name: "", emoji: "", looks: [], ...overrides };
}

describe("computePlateDurationSec", () => {
  it("matches the task's own 40s / 3 plates \u2248 13 + 13 + 14 example exactly", () => {
    expect(computePlateDurationSec(40, 3, 0)).toBe(13);
    expect(computePlateDurationSec(40, 3, 1)).toBe(13);
    expect(computePlateDurationSec(40, 3, 2)).toBe(14);
  });

  it("gives the whole clip's length to a single plate, clamped into range", () => {
    expect(computePlateDurationSec(10, 1, 0)).toBe(10);
  });

  it("clamps a too-short per-plate share up to MIN_CLIP_DURATION_SEC", () => {
    expect(computePlateDurationSec(6, 3, 0)).toBe(MIN_CLIP_DURATION_SEC);
  });

  it("clamps a too-long per-plate share down to MAX_CLIP_DURATION_SEC", () => {
    expect(computePlateDurationSec(60, 1, 0)).toBe(MAX_CLIP_DURATION_SEC);
  });

  it("falls back to MIN_CLIP_DURATION_SEC for a zero/invalid plate count rather than dividing by zero", () => {
    expect(computePlateDurationSec(40, 0, 0)).toBe(MIN_CLIP_DURATION_SEC);
  });
});

describe("computeLtxPlateDurationSec", () => {
  it("clamps into LTX's real [5, 30] range \u2014 not Grok's [5, 15]", () => {
    expect(computeLtxPlateDurationSec(60, 1, 0)).toBe(MAX_LTX_CLIP_DURATION_SEC);
    expect(computeLtxPlateDurationSec(2, 1, 0)).toBe(MIN_LTX_CLIP_DURATION_SEC);
  });

  it("gives an 18s share a real, unclamped pass-through (would have been clamped under Grok's 15s ceiling)", () => {
    expect(computeLtxPlateDurationSec(18, 1, 0)).toBe(18);
  });

  it("clamps a raw segment/plateCount well past the ceiling (Stuart's real 163s / 5 plates live-QA case) down to MAX_LTX_CLIP_DURATION_SEC, never throwing", () => {
    // 163s / 5 plates \u2248 32-33s/plate raw \u2014 must clamp to 30, not error.
    for (let plateIndex = 0; plateIndex < 5; plateIndex++) {
      expect(computeLtxPlateDurationSec(163, 5, plateIndex)).toBe(MAX_LTX_CLIP_DURATION_SEC);
    }
  });

  it("still splits evenly across multiple plates the same way as the Grok range", () => {
    expect(computeLtxPlateDurationSec(40, 3, 0)).toBe(13);
    expect(computeLtxPlateDurationSec(40, 3, 2)).toBe(14);
  });
});

describe("computePlateTimeRange", () => {
  it("gives a single plate the whole clip's own time range, when it already fits the bounds", () => {
    expect(computePlateTimeRange(100, 110, 1, 0)).toEqual({ startSec: 100, endSec: 110 });
  });

  it("walks each earlier plate's own computed duration to find this plate's absolute start", () => {
    // 40s clip, 3 plates -> 13 + 13 + 14 (matches computePlateDurationSec's own example).
    expect(computePlateTimeRange(0, 40, 3, 0)).toEqual({ startSec: 0, endSec: 13 });
    expect(computePlateTimeRange(0, 40, 3, 1)).toEqual({ startSec: 13, endSec: 26 });
    expect(computePlateTimeRange(0, 40, 3, 2)).toEqual({ startSec: 26, endSec: 40 });
  });

  it("offsets correctly when the clip itself doesn't start at 0", () => {
    expect(computePlateTimeRange(100, 140, 2, 0)).toEqual({ startSec: 100, endSec: 115 });
    expect(computePlateTimeRange(100, 140, 2, 1)).toEqual({ startSec: 115, endSec: 130 });
  });

  it("respects the LTX bounds when explicitly given, instead of clamping down to Grok's tighter ceiling", () => {
    const ltxBounds = { min: MIN_LTX_CLIP_DURATION_SEC, max: MAX_LTX_CLIP_DURATION_SEC };
    expect(computePlateTimeRange(100, 140, 2, 0, ltxBounds)).toEqual({ startSec: 100, endSec: 120 });
    expect(computePlateTimeRange(100, 140, 2, 1, ltxBounds)).toEqual({ startSec: 120, endSec: 140 });
  });

  it("every plate's own endSec - startSec matches computePlateDurationSec for the same inputs, under either bounds", () => {
    for (const bounds of [undefined, { min: MIN_LTX_CLIP_DURATION_SEC, max: MAX_LTX_CLIP_DURATION_SEC }] as const) {
      const range = computePlateTimeRange(0, 40, 3, 1, bounds);
      const expectedDuration = bounds
        ? computeLtxPlateDurationSec(40, 3, 1)
        : computePlateDurationSec(40, 3, 1);
      expect(range.endSec - range.startSec).toBe(expectedDuration);
    }
  });
});

describe("estimateLtxClipRenderCostUsd", () => {
  it("scales with real duration at LTX-2.5 (Fast)'s published $0.13/s 1080p rate, no per-image surcharge", () => {
    expect(estimateLtxClipRenderCostUsd(5)).toBeCloseTo(0.65, 5);
    expect(estimateLtxClipRenderCostUsd(20)).toBeCloseTo(2.6, 5);
  });
});

describe("buildClipGenerationRequest", () => {
  it("always leads with the clip's own shot prompt, verbatim", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open in an empty hallway",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(prompt.startsWith("a door creaks open in an empty hallway")).toBe(true);
  });

  it("returns `shotPrompt` as just the clip's own (trimmed) text, distinct from the longer merged `prompt`", () => {
    const { prompt, shotPrompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "  door, then keyhole, then Jack seated  ",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(shotPrompt).toBe("door, then keyhole, then Jack seated");
    expect(prompt.length).toBeGreaterThan(shotPrompt.length);
    expect(prompt).not.toBe(shotPrompt);
  });

  it("always sends exactly the one selected plate's still as the reference image", () => {
    const { referenceImageDataUrls } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(referenceImageDataUrls).toEqual(["data:image/jpeg;base64,door"]);
  });

  it("uses the automatic single-image push-in motion hint when no motionPrompt is given", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(prompt).toContain("Slow cinematic push-in zoom");
  });

  it("lets an explicit motionPrompt override the automatic motion hint outright, not append alongside it", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: "slow pan left, then hold on the door",
    });
    expect(prompt).toContain("slow pan left, then hold on the door");
    expect(prompt).not.toContain("Slow cinematic push-in zoom");
  });

  it("preserves a multi-line motionPrompt verbatim (aside from trimming) — this is a multi-line field, not single-line", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: "slow zoom into keyhole,\nmild pulse on door cracks",
    });
    expect(prompt).toContain("slow zoom into keyhole,\nmild pulse on door cracks");
  });

  it("trims a motionPrompt and falls back to the automatic hint when it's blank/whitespace-only", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: "   ",
    });
    expect(prompt).toContain("Slow cinematic push-in zoom");
  });

  it("caps an overlong motionPrompt at MAX_MOTION_PROMPT_LENGTH rather than sending it verbatim", () => {
    const long = "pan ".repeat(160).trim();
    expect(long.length).toBeGreaterThan(MAX_MOTION_PROMPT_LENGTH);
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: long,
    });
    expect(prompt).toContain(long.slice(0, MAX_MOTION_PROMPT_LENGTH));
    expect(prompt).not.toContain(long);
  });

  it("clamps durationSec into [MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC]", () => {
    expect(
      buildClipGenerationRequest({
      vocal: false,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 1,
      }).durationSec
    ).toBe(MIN_CLIP_DURATION_SEC);
    expect(
      buildClipGenerationRequest({
      vocal: false,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 99,
      }).durationSec
    ).toBe(MAX_CLIP_DURATION_SEC);
  });

  it("passes the persistence fields (segmentId/plateId/plateIndex/plateCount/clipIndex/startSec/endSec) straight through when given", () => {
    const request = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 13,
      segmentId: "seg-1",
      plateId: "plate-1",
      plateIndex: 0,
      plateCount: 3,
      clipIndex: 1,
      startSec: 0,
      endSec: 40,
    });
    expect(request.segmentId).toBe("seg-1");
    expect(request.plateId).toBe("plate-1");
    expect(request.plateIndex).toBe(0);
    expect(request.plateCount).toBe(3);
    expect(request.clipIndex).toBe(1);
    expect(request.startSec).toBe(0);
    expect(request.endSec).toBe(40);
  });

  it("leaves the persistence fields unset (not e.g. an explicit null) when the caller doesn't provide them", () => {
    const request = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(request.segmentId).toBeUndefined();
    expect(request.plateId).toBeUndefined();
    expect(JSON.stringify(request)).not.toContain("segmentId");
  });

  describe("Instrumental videoBackend (H3/Grok switch)", () => {
    it("defaults to h3 when instrumentalVideoModel is omitted \u2014 Stuart's 2026-09-13 default", () => {
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "a door creaks open",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,door",
        durationSec: 5,
      });
      expect(request.videoBackend).toBe("h3");
    });

    it("honors an explicit grok pick", () => {
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "a door creaks open",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,door",
        durationSec: 5,
        instrumentalVideoModel: "grok",
      });
      expect(request.videoBackend).toBe("grok");
    });

    it("falls back to h3 for any stored value other than the literal grok", () => {
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 5,
        instrumentalVideoModel: "h3",
      });
      expect(request.videoBackend).toBe("h3");
    });

    it("never sets videoBackend on a Vocal (Comfy LTX) request", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,jack",
        durationSec: 10,
      });
      expect(request.videoBackend).toBeUndefined();
    });
  });

  it("always names the band and asks for no on-screen text/watermark", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a keyhole, lit from behind",
      bandName: "Solar Rebel",
      plateStillDataUrl: "data:image/jpeg;base64,keyhole",
      durationSec: 5,
    });
    expect(prompt).toContain("Music video for Solar Rebel.");
    expect(prompt).toContain("no on-screen text, no watermark");
  });

  describe("vocal (Comfy Cloud LTX) requests", () => {
    it("sets vocal:true on the built request", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,jack",
        durationSec: 10,
      });
      expect(request.vocal).toBe(true);
    });

    it("clamps durationSec into LTX's [5, 30] range, not Grok's [5, 15]", () => {
      expect(
        buildClipGenerationRequest({
          vocal: true,
          shotPrompt: "x",
          bandName: "Jack Ash",
          plateStillDataUrl: "data:image/jpeg;base64,x",
          durationSec: 18,
        }).durationSec
      ).toBe(18);
      expect(
        buildClipGenerationRequest({
          vocal: true,
          shotPrompt: "x",
          bandName: "Jack Ash",
          plateStillDataUrl: "data:image/jpeg;base64,x",
          durationSec: 99,
        }).durationSec
      ).toBe(MAX_LTX_CLIP_DURATION_SEC);
    });

    it("passes mp3AudioUrl straight through", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 10,
        mp3AudioUrl: "https://blob.vercel-storage.com/skidmarks/mp3-audio/abc.mp3",
      });
      expect(request.mp3AudioUrl).toBe("https://blob.vercel-storage.com/skidmarks/mp3-audio/abc.mp3");
    });

    it("computes this plate's own audioStartSec/audioEndSec from the clip's time range and plate geometry", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 13,
        plateIndex: 1,
        plateCount: 3,
        startSec: 0,
        endSec: 40,
      });
      expect(request.audioStartSec).toBe(13);
      expect(request.audioEndSec).toBe(26);
    });

    it("leaves audioStartSec/audioEndSec unset when the plate geometry isn't fully given", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 10,
      });
      expect(request.audioStartSec).toBeUndefined();
      expect(request.audioEndSec).toBeUndefined();
    });

    it("never sets mp3AudioUrl/audioStartSec/audioEndSec on a non-vocal (Grok) request", () => {
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 10,
        mp3AudioUrl: "https://blob.vercel-storage.com/should-be-ignored.mp3",
        plateIndex: 0,
        plateCount: 1,
        startSec: 0,
        endSec: 10,
      });
      expect(request.mp3AudioUrl).toBeUndefined();
      expect(request.audioStartSec).toBeUndefined();
      expect(request.audioEndSec).toBeUndefined();
    });

    it("injects Jack Ash's video-specific hallmarks plus the 'mouth in frame' note when he's the vocalist, and sends his negative cues on a real, separate channel instead of inline", () => {
      const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,jack",
        durationSec: 10,
        vocalist: jackAsh,
      });
      expect(request.prompt.toLowerCase()).toContain("neon blue");
      expect(request.prompt.toLowerCase()).toContain("shadow");
      expect(request.prompt.toLowerCase()).toContain("watchable stare");
      expect(request.prompt.toLowerCase()).toContain("mouth is actually");
      // Real reported failure (2026-09-15): naming a concept even to
      // negate it, inside the same positive-conditioning text, doesn't
      // suppress it as reliably as true negative conditioning — the
      // negative cues no longer ride along in `prompt` as a "Do not
      // show: X" sentence at all.
      expect(request.prompt).not.toContain("Do not show:");
      expect(request.negativePrompt?.toLowerCase()).toContain("face lit or visible");
      expect(request.negativePrompt?.toLowerCase()).toContain("normal skin tone");
    });

    it("never injects a character lock for a vocalist with no registered lock", () => {
      const nova = member({ id: "solar-rebel-vocals", name: "Nova", role: "Vocals" });
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Solar Rebel",
        plateStillDataUrl: "data:image/jpeg;base64,nova",
        durationSec: 10,
        vocalist: nova,
      });
      expect(request.prompt.toLowerCase()).not.toContain("neon blue");
      expect(request.prompt).not.toContain("Do not show:");
      expect(request.negativePrompt).toBeUndefined();
    });

    it("never injects the locked-character note on a Grok/Instrumental request even for a locked vocalist", () => {
      const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
      const { prompt } = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "a door creaks open",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,door",
        durationSec: 5,
        vocalist: jackAsh,
      });
      expect(prompt.toLowerCase()).not.toContain("neon blue");
    });
  });
});

describe("estimateClipRenderCostUsd", () => {
  it("scales with real duration at 480p's $0.08/s rate, plus $0.01 per reference image", () => {
    expect(estimateClipRenderCostUsd(5, 1)).toBeCloseTo(0.41, 5);
    expect(estimateClipRenderCostUsd(13, 1)).toBeCloseTo(1.05, 5);
    expect(estimateClipRenderCostUsd(15, 1)).toBeCloseTo(1.21, 5);
  });

  it("defaults referenceImageCount to 1 \u2014 a render is always exactly one plate's still now", () => {
    expect(estimateClipRenderCostUsd(5)).toBeCloseTo(estimateClipRenderCostUsd(5, 1), 5);
  });
});

describe("estimateH3ClipRenderCostUsd", () => {
  it("scales with real duration at MiniMax H3's published 768P $0.08/s rate, no per-image surcharge", () => {
    expect(estimateH3ClipRenderCostUsd(5)).toBeCloseTo(0.4, 5);
    expect(estimateH3ClipRenderCostUsd(15)).toBeCloseTo(1.2, 5);
  });

  it("is slightly cheaper than the Grok estimate at the same duration \u2014 no $0.01 reference-image charge", () => {
    expect(estimateH3ClipRenderCostUsd(10)).toBeLessThan(estimateClipRenderCostUsd(10, 1));
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("generateSkidmarksClip", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a real success with the videoUrl/durationSec the route reported", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 13 })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
      durationSec: 13,
    });

    expect(outcome).toEqual({ ok: true, videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 13, persisted: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/generate-clip");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
      durationSec: 13,
    });
  });

  it("reports the honest 'unconfigured' outcome for a missing_api_key response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(501, { error: "XAI_API_KEY is not set on the server.", code: "missing_api_key" })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
    });

    expect(outcome).toEqual({ ok: false, unconfigured: true, message: "XAI_API_KEY is not set on the server." });
  });

  it("reports a real failure honestly, distinct from 'unconfigured'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(504, { error: "xAI's video render was still processing after 240s.", code: "timeout" })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
    });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "xAI's video render was still processing after 240s.",
    });
  });

  it("reports a real network error honestly (no fetch success to parse)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
    });

    expect(outcome).toEqual({ ok: false, unconfigured: false, message: "Failed to fetch" });
  });

  it("reports persisted:true and the durable Blob URL when the route says the render was saved", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
        durationSec: 13,
        persisted: true,
      })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
      durationSec: 13,
      segmentId: "seg-1",
      plateId: "plate-1",
      clipIndex: 1,
      startSec: 0,
      endSec: 40,
    });

    expect(outcome).toEqual({
      ok: true,
      videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
      durationSec: 13,
      persisted: true,
    });
  });

  it("reports persisted:false plus a plain-language persistError when the route couldn't save the render", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        videoUrl: "https://vidgen.x.ai/clip.mp4",
        durationSec: 5,
        persisted: false,
        persistError: "Vercel Blob: No token found.",
      })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
      segmentId: "seg-1",
      plateId: "plate-1",
      clipIndex: 1,
      startSec: 0,
      endSec: 40,
    });

    expect(outcome).toEqual({
      ok: true,
      videoUrl: "https://vidgen.x.ai/clip.mp4",
      durationSec: 5,
      persisted: false,
      persistError: "Vercel Blob: No token found.",
    });
  });

  it("reports a real failure if a 200 response is somehow missing videoUrl", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
    });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "Clip render succeeded but returned no video.",
    });
  });
});
