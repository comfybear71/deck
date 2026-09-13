import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClipGenerationRequest,
  computePlateDurationSec,
  estimateClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_CLIP_DURATION_SEC,
  MIN_CLIP_DURATION_SEC,
  MAX_MOTION_PROMPT_LENGTH,
} from "./clipGeneration";

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

describe("buildClipGenerationRequest", () => {
  it("always leads with the clip's own shot prompt, verbatim", () => {
    const { prompt } = buildClipGenerationRequest({
      shotPrompt: "a door creaks open in an empty hallway",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(prompt.startsWith("a door creaks open in an empty hallway")).toBe(true);
  });

  it("returns `shotPrompt` as just the clip's own (trimmed) text, distinct from the longer merged `prompt`", () => {
    const { prompt, shotPrompt } = buildClipGenerationRequest({
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
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(referenceImageDataUrls).toEqual(["data:image/jpeg;base64,door"]);
  });

  it("uses the automatic single-image push-in motion hint when no motionPrompt is given", () => {
    const { prompt } = buildClipGenerationRequest({
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(prompt).toContain("Slow cinematic push-in zoom");
  });

  it("lets an explicit motionPrompt override the automatic motion hint outright, not append alongside it", () => {
    const { prompt } = buildClipGenerationRequest({
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
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: "   ",
    });
    expect(prompt).toContain("Slow cinematic push-in zoom");
  });

  it("caps an overlong motionPrompt at MAX_MOTION_PROMPT_LENGTH rather than sending it verbatim", () => {
    const long = "pan ".repeat(60).trim();
    expect(long.length).toBeGreaterThan(MAX_MOTION_PROMPT_LENGTH);
    const { prompt } = buildClipGenerationRequest({
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
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 1,
      }).durationSec
    ).toBe(MIN_CLIP_DURATION_SEC);
    expect(
      buildClipGenerationRequest({
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 99,
      }).durationSec
    ).toBe(MAX_CLIP_DURATION_SEC);
  });

  it("passes the persistence fields (segmentId/plateId/plateIndex/plateCount/clipIndex/startSec/endSec) straight through when given", () => {
    const request = buildClipGenerationRequest({
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
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(request.segmentId).toBeUndefined();
    expect(request.plateId).toBeUndefined();
    expect(JSON.stringify(request)).not.toContain("segmentId");
  });

  it("always names the band and asks for no on-screen text/watermark", () => {
    const { prompt } = buildClipGenerationRequest({
      shotPrompt: "a keyhole, lit from behind",
      bandName: "Solar Rebel",
      plateStillDataUrl: "data:image/jpeg;base64,keyhole",
      durationSec: 5,
    });
    expect(prompt).toContain("Music video for Solar Rebel.");
    expect(prompt).toContain("no on-screen text, no watermark");
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
