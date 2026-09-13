import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClipGenerationRequest,
  estimateClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_CLIP_REFERENCE_IMAGES,
  MAX_MOTION_PROMPT_LENGTH,
} from "./clipGeneration";

describe("buildClipGenerationRequest", () => {
  it("always leads with the clip's own shot prompt, verbatim", () => {
    const { prompt } = buildClipGenerationRequest({
      shotPrompt: "a door creaks open in an empty hallway",
      bandName: "Jack Ash",
      plateStillDataUrls: ["data:image/jpeg;base64,door"],
    });
    expect(prompt.startsWith("a door creaks open in an empty hallway")).toBe(true);
  });

  it("returns `shotPrompt` as just the clip's own (trimmed) text, distinct from the longer merged `prompt`", () => {
    const { prompt, shotPrompt } = buildClipGenerationRequest({
      shotPrompt: "  door, then keyhole, then Jack seated  ",
      bandName: "Jack Ash",
      plateStillDataUrls: [
        "data:image/jpeg;base64,door",
        "data:image/jpeg;base64,keyhole",
        "data:image/jpeg;base64,jack",
      ],
    });
    expect(shotPrompt).toBe("door, then keyhole, then Jack seated");
    expect(prompt.length).toBeGreaterThan(shotPrompt.length);
    expect(prompt).not.toBe(shotPrompt);
  });

  it("uses the single-image push-in motion hint for exactly one plate still", () => {
    const { prompt, referenceImageDataUrls } = buildClipGenerationRequest({
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrls: ["data:image/jpeg;base64,door"],
    });
    expect(referenceImageDataUrls).toEqual(["data:image/jpeg;base64,door"]);
    expect(prompt).toContain("Slow cinematic push-in zoom");
    expect(prompt).not.toContain("Continuous, unbroken");
  });

  it("uses the multi-plate continuity motion hint for two or more plate stills, in strip order", () => {
    const { prompt, referenceImageDataUrls } = buildClipGenerationRequest({
      shotPrompt: "door, then keyhole, then Jack seated",
      bandName: "Jack Ash",
      plateStillDataUrls: [
        "data:image/jpeg;base64,door",
        "data:image/jpeg;base64,keyhole",
        "data:image/jpeg;base64,jack",
      ],
    });
    expect(referenceImageDataUrls).toEqual([
      "data:image/jpeg;base64,door",
      "data:image/jpeg;base64,keyhole",
      "data:image/jpeg;base64,jack",
    ]);
    expect(prompt).toContain("Continuous, unbroken slow cinematic push-in zoom");
    expect(prompt).toContain("from the first reference image to the last, in order");
  });

  it("caps reference images at MAX_CLIP_REFERENCE_IMAGES, keeping the first ones in order", () => {
    const { referenceImageDataUrls } = buildClipGenerationRequest({
      shotPrompt: "a long sequence",
      bandName: "Jack Ash",
      plateStillDataUrls: [
        "data:image/jpeg;base64,1",
        "data:image/jpeg;base64,2",
        "data:image/jpeg;base64,3",
        "data:image/jpeg;base64,4",
        "data:image/jpeg;base64,5",
      ],
    });
    expect(referenceImageDataUrls).toHaveLength(MAX_CLIP_REFERENCE_IMAGES);
    expect(referenceImageDataUrls).toEqual([
      "data:image/jpeg;base64,1",
      "data:image/jpeg;base64,2",
      "data:image/jpeg;base64,3",
    ]);
  });

  it("uses the automatic push-in/zoom motion hint when no motionPrompt is given (unchanged default behavior)", () => {
    const { prompt } = buildClipGenerationRequest({
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrls: ["data:image/jpeg;base64,door"],
    });
    expect(prompt).toContain("Slow cinematic push-in zoom");
  });

  it("lets an explicit motionPrompt override the automatic motion hint outright, not append alongside it", () => {
    const { prompt } = buildClipGenerationRequest({
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrls: ["data:image/jpeg;base64,door"],
      motionPrompt: "slow pan left, then hold on the door",
    });
    expect(prompt).toContain("slow pan left, then hold on the door");
    expect(prompt).not.toContain("Slow cinematic push-in zoom");
  });

  it("trims a motionPrompt and falls back to the automatic hint when it's blank/whitespace-only", () => {
    const { prompt } = buildClipGenerationRequest({
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrls: ["data:image/jpeg;base64,door"],
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
      plateStillDataUrls: ["data:image/jpeg;base64,door"],
      motionPrompt: long,
    });
    expect(prompt).toContain(long.slice(0, MAX_MOTION_PROMPT_LENGTH));
    expect(prompt).not.toContain(long);
  });

  it("passes the persistence fields (segmentId/clipIndex/startSec/endSec) straight through when given", () => {
    const request = buildClipGenerationRequest({
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrls: ["data:image/jpeg;base64,door"],
      segmentId: "seg-1",
      clipIndex: 1,
      startSec: 0,
      endSec: 40,
    });
    expect(request.segmentId).toBe("seg-1");
    expect(request.clipIndex).toBe(1);
    expect(request.startSec).toBe(0);
    expect(request.endSec).toBe(40);
  });

  it("leaves the persistence fields unset (not e.g. an explicit null) when the caller doesn't provide them", () => {
    const request = buildClipGenerationRequest({
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrls: ["data:image/jpeg;base64,door"],
    });
    expect(request.segmentId).toBeUndefined();
    expect(request.clipIndex).toBeUndefined();
    expect(JSON.stringify(request)).not.toContain("segmentId");
  });

  it("always names the band and asks for no on-screen text/watermark", () => {
    const { prompt } = buildClipGenerationRequest({
      shotPrompt: "a keyhole, lit from behind",
      bandName: "Solar Rebel",
      plateStillDataUrls: ["data:image/jpeg;base64,keyhole"],
    });
    expect(prompt).toContain("Music video for Solar Rebel.");
    expect(prompt).toContain("no on-screen text, no watermark");
  });
});

describe("estimateClipRenderCostUsd", () => {
  it("matches the fixed 5s/480p ($0.08/s) rate plus $0.01 per reference image", () => {
    expect(estimateClipRenderCostUsd(1)).toBeCloseTo(0.41, 5);
    expect(estimateClipRenderCostUsd(3)).toBeCloseTo(0.43, 5);
    expect(estimateClipRenderCostUsd(0)).toBeCloseTo(0.4, 5);
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
      jsonResponse(200, { videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 5 })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
    });

    expect(outcome).toEqual({ ok: true, videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 5, persisted: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/generate-clip");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
    });
  });

  it("reports the honest 'unconfigured' outcome for a missing_api_key response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(501, { error: "XAI_API_KEY is not set on the server.", code: "missing_api_key" })
    );

    const outcome = await generateSkidmarksClip({ prompt: "x", shotPrompt: "x", referenceImageDataUrls: ["data:image/jpeg;base64,a"] });

    expect(outcome).toEqual({ ok: false, unconfigured: true, message: "XAI_API_KEY is not set on the server." });
  });

  it("reports a real failure honestly, distinct from 'unconfigured'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(504, { error: "xAI's video render was still processing after 240s.", code: "timeout" })
    );

    const outcome = await generateSkidmarksClip({ prompt: "x", shotPrompt: "x", referenceImageDataUrls: ["data:image/jpeg;base64,a"] });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "xAI's video render was still processing after 240s.",
    });
  });

  it("reports a real network error honestly (no fetch success to parse)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const outcome = await generateSkidmarksClip({ prompt: "x", shotPrompt: "x", referenceImageDataUrls: ["data:image/jpeg;base64,a"] });

    expect(outcome).toEqual({ ok: false, unconfigured: false, message: "Failed to fetch" });
  });

  it("reports persisted:true and the durable Blob URL when the route says the render was saved", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/01_0000-0040_render.mp4",
        durationSec: 5,
        persisted: true,
      })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
      segmentId: "seg-1",
      clipIndex: 1,
      startSec: 0,
      endSec: 40,
    });

    expect(outcome).toEqual({
      ok: true,
      videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/01_0000-0040_render.mp4",
      durationSec: 5,
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
      segmentId: "seg-1",
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

    const outcome = await generateSkidmarksClip({ prompt: "x", shotPrompt: "x", referenceImageDataUrls: ["data:image/jpeg;base64,a"] });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "Clip render succeeded but returned no video.",
    });
  });
});
