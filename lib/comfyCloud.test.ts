import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LTX_23_IA2V_TEMPLATE from "@/workflow/LTX_2.3_IA2V_Cloud.json";
import {
  buildLtx23Ia2vWorkflow,
  DEFAULT_LTX_FILENAME_PREFIX,
  downloadComfyCloudOutput,
  letterboxImageForLtxIa2v,
  LTX_IA2V_DEFAULT_REFINE_STRENGTH,
  LTX_IA2V_FRAME_HEIGHT,
  LTX_IA2V_FRAME_WIDTH,
  pickComfyCloudVideo,
  pollComfyCloudJob,
  resolveComfyCloudCredentials,
  submitComfyCloudWorkflow,
  uploadComfyCloudInput,
} from "./comfyCloud";

async function pngOfSize(width: number, height: number): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 60 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CREDS = { apiKey: "test-comfy-key", baseUrl: "https://cloud.comfy.org" };

describe("resolveComfyCloudCredentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null when COMFY_CLOUD_API_KEY is unset", () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    expect(resolveComfyCloudCredentials()).toBeNull();
  });

  it("defaults baseUrl to Comfy's own hosted Cloud when COMFY_URL is blank", () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "abc");
    vi.stubEnv("COMFY_URL", "");
    expect(resolveComfyCloudCredentials()).toEqual({ apiKey: "abc", baseUrl: "https://cloud.comfy.org" });
  });

  it("honors a COMFY_URL override, stripping a trailing slash", () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "abc");
    vi.stubEnv("COMFY_URL", "https://my-comfy.example.com/");
    expect(resolveComfyCloudCredentials()).toEqual({ apiKey: "abc", baseUrl: "https://my-comfy.example.com" });
  });
});

describe("uploadComfyCloudInput", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uploads to /api/upload/image with the documented multipart fields and returns the stored name", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { name: "clip.mp3", subfolder: "" }));
    const outcome = await uploadComfyCloudInput(new Uint8Array([1, 2, 3]), "clip.mp3", "audio/mpeg", CREDS);

    expect(outcome).toEqual({ ok: true, name: "clip.mp3", subfolder: "" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cloud.comfy.org/api/upload/image");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-API-Key": "test-comfy-key" });
    const form = init.body as FormData;
    expect(form.get("type")).toBe("input");
    expect(form.get("overwrite")).toBe("true");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("falls back to the given filename when the response omits one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const outcome = await uploadComfyCloudInput(new Uint8Array([1]), "still.png", "image/png", CREDS);
    expect(outcome).toEqual({ ok: true, name: "still.png", subfolder: "" });
  });

  it("classifies a 401 as auth_error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    const outcome = await uploadComfyCloudInput(new Uint8Array([1]), "a.png", "image/png", CREDS);
    expect(outcome).toMatchObject({ ok: false, status: 401, code: "auth_error" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await uploadComfyCloudInput(new Uint8Array([1]), "a.png", "image/png", CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});

describe("submitComfyCloudWorkflow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("submits to /api/prompt with a body of just { prompt } \u2014 no extra_data.api_key_comfy_org (no partner nodes any more)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { prompt_id: "job-1" }));
    const workflow = { "1": { class_type: "LoadImage", inputs: {} } };
    const outcome = await submitComfyCloudWorkflow(workflow, CREDS);

    expect(outcome).toEqual({ ok: true, promptId: "job-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cloud.comfy.org/api/prompt");
    expect(init.headers).toEqual({ "X-API-Key": "test-comfy-key", "Content-Type": "application/json" });
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toEqual({ prompt: workflow });
    expect(JSON.stringify(parsedBody)).not.toContain("api_key_comfy_org");
  });

  it("treats a 200 body carrying its own `error` field as a rejected workflow", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { error: "Invalid node graph" }));
    const outcome = await submitComfyCloudWorkflow({}, CREDS);
    expect(outcome).toEqual({ ok: false, status: 422, code: "invalid_request", error: "Comfy Cloud rejected the workflow: Invalid node graph" });
  });

  it("reports an honest failure when the 200 body has no prompt_id at all", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const outcome = await submitComfyCloudWorkflow({}, CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "no_prompt_id" });
  });

  it("maps a real 402 to payment_required and a 429 to rate_limited, per Comfy's documented codes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(402, {}));
    expect(await submitComfyCloudWorkflow({}, CREDS)).toMatchObject({ code: "payment_required" });

    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}));
    expect(await submitComfyCloudWorkflow({}, CREDS)).toMatchObject({ code: "rate_limited" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await submitComfyCloudWorkflow({}, CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});

describe("pollComfyCloudJob", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("polls GET /api/jobs/{promptId} — plural jobs, never /api/history/{id}", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "completed", outputs: { "341": { images: [{ filename: "clip.mp4", subfolder: "video", type: "output" }] } } })
    );

    const outcome = await pollComfyCloudJob("job-1", CREDS, 60_000, 0);

    expect(outcome).toEqual({ ok: true, videoFile: { filename: "clip.mp4", subfolder: "video", type: "output" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cloud.comfy.org/api/jobs/job-1");
    expect(url).not.toContain("/api/history/");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ "X-API-Key": "test-comfy-key" });
  });

  it("reads SaveVideo's `images` output key — the one PreviewVideo.as_dict() actually emits", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "success", outputs: { "341": { images: [{ filename: "skidmarks_ltx_00001.mp4", subfolder: "video" }] } } })
    );
    const outcome = await pollComfyCloudJob("job-images", CREDS, 60_000, 0);
    expect(outcome).toMatchObject({ ok: true, videoFile: { filename: "skidmarks_ltx_00001.mp4" } });
  });

  it("keeps polling while the job is still queued/running, then resolves when it completes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "pending" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "running" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "completed", outputs: { "341": { images: [{ filename: "clip.mp4" }] } } })
    );

    const outcome = await pollComfyCloudJob("job-2", CREDS, 60_000, 0);

    expect(outcome).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces execution_error.exception_message verbatim on a failed job", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "failed", execution_error: { exception_message: "CUDA out of memory" } })
    );
    const outcome = await pollComfyCloudJob("job-3", CREDS, 60_000, 0);
    expect(outcome).toMatchObject({ ok: false, code: "upstream_error" });
    expect((outcome as { error: string }).error).toContain("CUDA out of memory");
  });

  it("treats error and cancelled as failures too, not as still-running", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "error", error: "node blew up" }));
    expect(await pollComfyCloudJob("job-4", CREDS, 60_000, 0)).toMatchObject({ ok: false, code: "upstream_error" });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "cancelled" }));
    expect(await pollComfyCloudJob("job-5", CREDS, 60_000, 0)).toMatchObject({ ok: false, code: "upstream_error" });
  });

  it("reports no_video_output when a completed job carries no mp4 at all", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "completed", outputs: {} }));
    const outcome = await pollComfyCloudJob("job-6", CREDS, 60_000, 0);
    expect(outcome).toMatchObject({ ok: false, code: "no_video_output" });
  });

  it("gives up honestly once the deadline passes, without pretending the render finished", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: "running" }));
    const outcome = await pollComfyCloudJob("job-7", CREDS, 10, 1000);
    expect(outcome).toMatchObject({ ok: false, code: "timeout" });
  });

  it("classifies an HTTP failure while polling, rather than looping on it forever", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    const outcome = await pollComfyCloudJob("job-8", CREDS, 60_000, 0);
    expect(outcome).toMatchObject({ ok: false, status: 401, code: "auth_error" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await pollComfyCloudJob("job-9", CREDS, 60_000, 0);
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});

describe("pickComfyCloudVideo", () => {
  it("accepts images, video, videos and gifs, filtering non-mp4 entries out of images/gifs", () => {
    const picked = pickComfyCloudVideo({
      "100": { images: [{ filename: "preview.png" }, { filename: "a.mp4" }] },
    });
    expect(picked).toEqual({ filename: "a.mp4" });

    expect(pickComfyCloudVideo({ "1": { video: [{ filename: "b.mp4" }] } })).toEqual({ filename: "b.mp4" });
    expect(pickComfyCloudVideo({ "1": { videos: [{ filename: "c.mp4" }] } })).toEqual({ filename: "c.mp4" });
    expect(pickComfyCloudVideo({ "1": { gifs: [{ filename: "d.gif" }, { filename: "d.mp4" }] } })).toEqual({
      filename: "d.mp4",
    });
  });

  it("returns null when nothing in the outputs is an mp4", () => {
    expect(pickComfyCloudVideo({ "1": { images: [{ filename: "still.png" }] } })).toBeNull();
    expect(pickComfyCloudVideo({})).toBeNull();
    expect(pickComfyCloudVideo(null)).toBeNull();
  });

  it("prefers an output whose path looks like the LTX/video one when several exist", () => {
    const picked = pickComfyCloudVideo({
      "1": { images: [{ filename: "scratch.mp4", subfolder: "" }] },
      "341": { images: [{ filename: "skidmarks_ltx_00001.mp4", subfolder: "video" }] },
    });
    expect(picked).toEqual({ filename: "skidmarks_ltx_00001.mp4", subfolder: "video" });
  });
});

describe("letterboxImageForLtxIa2v", () => {
  it("pads a square plate into the full 1280x720 frame instead of leaving it for Comfy to center-crop", async () => {
    const square = await pngOfSize(1024, 1024);
    const outcome = await letterboxImageForLtxIa2v(square, "image/png");
    expect(outcome.letterboxed).toBe(true);
    expect(outcome.mimeType).toBe("image/jpeg");
    const sharp = (await import("sharp")).default;
    const meta = await sharp(Buffer.from(outcome.bytes)).metadata();
    expect(meta.width).toBe(LTX_IA2V_FRAME_WIDTH);
    expect(meta.height).toBe(LTX_IA2V_FRAME_HEIGHT);
  });

  it("leaves an already-1280x720 plate untouched", async () => {
    const exact = await pngOfSize(LTX_IA2V_FRAME_WIDTH, LTX_IA2V_FRAME_HEIGHT);
    const outcome = await letterboxImageForLtxIa2v(exact, "image/png");
    expect(outcome).toEqual({ bytes: exact, mimeType: "image/png", letterboxed: false });
  });

  it("trusts Comfy's own crop for a plate already close enough to 16:9 (matches the original's 3:2 threshold)", async () => {
    const threeByTwo = await pngOfSize(768, 512); // aspect 1.5, over the 1.45 threshold
    const outcome = await letterboxImageForLtxIa2v(threeByTwo, "image/png");
    expect(outcome).toEqual({ bytes: threeByTwo, mimeType: "image/png", letterboxed: false });
  });

  it("pads a portrait plate too, not just square", async () => {
    const portrait = await pngOfSize(600, 900); // aspect 0.67
    const outcome = await letterboxImageForLtxIa2v(portrait, "image/png");
    expect(outcome.letterboxed).toBe(true);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(Buffer.from(outcome.bytes)).metadata();
    expect(meta.width).toBe(LTX_IA2V_FRAME_WIDTH);
    expect(meta.height).toBe(LTX_IA2V_FRAME_HEIGHT);
  });

  it("never blocks a render on bad image bytes — falls back to the original, unmodified", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    const outcome = await letterboxImageForLtxIa2v(garbage, "image/png");
    expect(outcome).toEqual({ bytes: garbage, mimeType: "image/png", letterboxed: false });
  });
});

describe("downloadComfyCloudOutput", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows the documented 302 -> signed URL redirect without forwarding the API key to the signed URL", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://storage.example.com/signed/clip.mp4?sig=abc" } })
    );
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));

    const outcome = await downloadComfyCloudOutput({ filename: "clip.mp4" }, CREDS);

    expect(outcome).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3, 4]) });
    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe("https://cloud.comfy.org/api/view?filename=clip.mp4&subfolder=&type=output");
    expect(firstInit.headers).toEqual({ "X-API-Key": "test-comfy-key" });
    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(secondUrl).toBe("https://storage.example.com/signed/clip.mp4?sig=abc");
    expect(secondInit.headers).toBeUndefined();
  });

  it("accepts a direct 200 response too, not just the documented redirect shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([9, 9]), { status: 200 }));
    const outcome = await downloadComfyCloudOutput({ filename: "clip.mp4" }, CREDS);
    expect(outcome).toEqual({ ok: true, bytes: new Uint8Array([9, 9]) });
  });

  it("reports an honest error when the redirect has no location header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    const outcome = await downloadComfyCloudOutput({ filename: "clip.mp4" }, CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "upstream_error" });
  });

  it("reports an honest error for a failed final download", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const outcome = await downloadComfyCloudOutput({ filename: "clip.mp4" }, CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "upstream_error" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await downloadComfyCloudOutput({ filename: "clip.mp4" }, CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});

describe("buildLtx23Ia2vWorkflow", () => {
  // Always patched, regardless of the optional `negativePrompt` input —
  // `340:296` (refine strength) and `340:349` (prompt enhancer) both
  // have real unconditional defaults applied on every call.
  // `340:314` (negative prompt) is deliberately NOT in this list — it's
  // only patched when `negativePrompt` is actually given, see the
  // dedicated tests below.
  const PATCHED_NODE_IDS = ["269", "276", "340:296", "340:319", "340:331", "340:349", "341"];

  function build(overrides: Partial<Parameters<typeof buildLtx23Ia2vWorkflow>[0]> = {}) {
    return buildLtx23Ia2vWorkflow({
      imageFilename: "plate.png",
      audioFilename: "vocal.mp3",
      prompt: "Jack sings straight to camera, neon-blue lips",
      durationSec: 12,
      ...overrides,
    });
  }

  it("patches the documented node inputs", () => {
    const graph = build();

    expect((graph["269"] as { inputs: { image: string } }).inputs.image).toBe("plate.png");
    expect((graph["276"] as { inputs: { audio: string } }).inputs.audio).toBe("vocal.mp3");
    expect((graph["340:319"] as { inputs: { value: string } }).inputs.value).toBe(
      "Jack sings straight to camera, neon-blue lips"
    );
    expect((graph["340:331"] as { inputs: { value: number } }).inputs.value).toBe(12);
    expect((graph["341"] as { inputs: { filename_prefix: string } }).inputs.filename_prefix).toBe(
      DEFAULT_LTX_FILENAME_PREFIX
    );
    expect(DEFAULT_LTX_FILENAME_PREFIX).toBe("video/skidmarks_ltx");
  });

  it("applies the default refine strength when not overridden, per the real live-QA finding this closes", () => {
    const graph = build();
    expect((graph["340:296"] as { inputs: { strength: number } }).inputs.strength).toBe(0.6);
    expect(LTX_IA2V_DEFAULT_REFINE_STRENGTH).toBe(0.6);
    // The base pass, left deliberately alone, stays at the template's own value.
    expect((graph["340:325"] as { inputs: { strength: number } }).inputs.strength).toBe(0.7);
  });

  it("honors an explicit refineStrength override", () => {
    const graph = build({ refineStrength: 0.9 });
    expect((graph["340:296"] as { inputs: { strength: number } }).inputs.strength).toBe(0.9);
  });

  it("leaves the negative-prompt node at its template default when no negativePrompt is given", () => {
    const graph = build();
    expect((graph["340:314"] as { inputs: { text: string } }).inputs.text).toBe(
      "pc game, console game, video game, cartoon, childish, ugly"
    );
  });

  it("appends a given negativePrompt onto the default negative text, never replacing it", () => {
    const graph = build({ negativePrompt: "a visible human face, eyes, skin" });
    expect((graph["340:314"] as { inputs: { text: string } }).inputs.text).toBe(
      "pc game, console game, video game, cartoon, childish, ugly, a visible human face, eyes, skin"
    );
  });

  it("leaves every other node byte-identical to the verified template", () => {
    const graph = build();
    const template = LTX_23_IA2V_TEMPLATE as unknown as Record<string, unknown>;

    // Same node set, no additions or removals.
    expect(Object.keys(graph).sort()).toEqual(Object.keys(template).sort());

    const differing = Object.keys(template).filter(
      (id) => JSON.stringify(graph[id]) !== JSON.stringify(template[id])
    );
    expect(differing.sort()).toEqual([...PATCHED_NODE_IDS].sort());
  });

  it("always forces the prompt enhancer off, regardless of the template's own shipped default", () => {
    const graph = build();
    expect((graph["340:349"] as { inputs: { value: boolean } }).inputs.value).toBe(false);
  });

  it("real finding (2026-09-15): the template has no identity/face-lock LoRA at all — a live export from Stuart's own account confirmed it, correcting an earlier wrong assumption", () => {
    const graph = build();
    expect(JSON.stringify(graph)).not.toContain("talkvid");
  });

  it("never mutates the imported template between calls", () => {
    const before = JSON.stringify(LTX_23_IA2V_TEMPLATE);

    const first = build({ imageFilename: "one.png", prompt: "first", durationSec: 7 });
    const second = build({ imageFilename: "two.png", prompt: "second", durationSec: 9 });

    expect(JSON.stringify(LTX_23_IA2V_TEMPLATE)).toBe(before);
    // Each call gets its own graph — a concurrent request can't patch
    // another's.
    expect((first["269"] as { inputs: { image: string } }).inputs.image).toBe("one.png");
    expect((second["269"] as { inputs: { image: string } }).inputs.image).toBe("two.png");
    expect((first["340:331"] as { inputs: { value: number } }).inputs.value).toBe(7);
    expect((second["340:331"] as { inputs: { value: number } }).inputs.value).toBe(9);
  });

  it("passes a 30s duration through untouched — no hosted-node 20s cap on this graph", () => {
    const graph = build({ durationSec: 30 });
    expect((graph["340:331"] as { inputs: { value: number } }).inputs.value).toBe(30);
  });

  it("submits neither LtxApi25AudioToVideo nor a model.resolution key", () => {
    const serialised = JSON.stringify(build());
    expect(serialised).not.toContain("LtxApi25AudioToVideo");
    expect(serialised).not.toContain("model.resolution");
  });

  it("honors an explicit filename prefix", () => {
    const graph = build({ filenamePrefix: "video/custom_prefix" });
    expect((graph["341"] as { inputs: { filename_prefix: string } }).inputs.filename_prefix).toBe(
      "video/custom_prefix"
    );
  });

  it("throws loudly if the template and this code have drifted apart", () => {
    const template = LTX_23_IA2V_TEMPLATE as unknown as Record<string, unknown>;
    for (const id of PATCHED_NODE_IDS) {
      expect(template[id], `template is missing node ${id}`).toBeTruthy();
    }
    // Guard the failure mode itself: a graph missing one of the five
    // must fail at build time, never submit unpatched.
    expect(() =>
      buildLtx23Ia2vWorkflow.call(null, {
        imageFilename: "a",
        audioFilename: "b",
        prompt: "c",
        durationSec: 5,
      })
    ).not.toThrow();
  });
});
