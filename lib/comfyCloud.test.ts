import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLtxAudioToVideoWorkflow,
  DEFAULT_LTX_MODEL,
  downloadComfyCloudOutput,
  resolveComfyCloudCredentials,
  submitComfyCloudWorkflow,
  uploadComfyCloudInput,
  waitForComfyCloudCompletion,
  type MinimalWebSocket,
} from "./comfyCloud";

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

describe("DEFAULT_LTX_MODEL", () => {
  it("is the cheaper LTX-2.5 (Fast) tier, hardcoded (no env override \u2014 not a confirmed Comfy key name)", () => {
    expect(DEFAULT_LTX_MODEL).toBe("LTX-2.5 (Fast)");
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

  it("submits to /api/prompt with the workflow and the partner-node api key in extra_data", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { prompt_id: "job-1" }));
    const workflow = { "1": { class_type: "LoadImage", inputs: {} } };
    const outcome = await submitComfyCloudWorkflow(workflow, CREDS);

    expect(outcome).toEqual({ ok: true, promptId: "job-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cloud.comfy.org/api/prompt");
    expect(init.headers).toEqual({ "X-API-Key": "test-comfy-key", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: workflow,
      extra_data: { api_key_comfy_org: "test-comfy-key" },
    });
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

/** A fake `MinimalWebSocket` the test drives directly — records what
 * `waitForComfyCloudCompletion` assigned to each handler and exposes a
 * way to fire them from the test body, so this suite never needs a
 * real socket/network. */
class FakeWebSocket implements MinimalWebSocket {
  static instances: FakeWebSocket[] = [];
  static shouldThrow = false;
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    if (FakeWebSocket.shouldThrow) throw new Error("boom");
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(msgType: string, data: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ type: msgType, data }) });
  }
}

describe("waitForComfyCloudCompletion", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.shouldThrow = false;
  });
  afterEach(() => vi.useRealTimers());

  it("resolves with the video output once execution_success lands for this exact prompt_id", async () => {
    const promise = waitForComfyCloudCompletion("job-1", CREDS, 5000, FakeWebSocket);
    const ws = FakeWebSocket.instances[0];
    // A message for a *different* job first — must be ignored.
    ws.emit("executed", { prompt_id: "job-other", node: "4", output: { video: [{ filename: "other.mp4" }] } });
    ws.emit("executed", { prompt_id: "job-1", node: "4", output: { video: [{ filename: "clip.mp4", type: "output" }] } });
    ws.emit("execution_success", { prompt_id: "job-1" });

    const outcome = await promise;
    expect(outcome).toEqual({ ok: true, videoFile: { filename: "clip.mp4", type: "output" } });
    expect(ws.closed).toBe(true);
  });

  it("reports an honest upstream_error on execution_error", async () => {
    const promise = waitForComfyCloudCompletion("job-2", CREDS, 5000, FakeWebSocket);
    const ws = FakeWebSocket.instances[0];
    ws.emit("execution_error", { prompt_id: "job-2", exception_message: "OOMError" });

    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false, code: "upstream_error" });
    expect((outcome as { error: string }).error).toContain("OOMError");
  });

  it("reports no_video_output if execution_success lands without ever seeing a video output", async () => {
    const promise = waitForComfyCloudCompletion("job-3", CREDS, 5000, FakeWebSocket);
    const ws = FakeWebSocket.instances[0];
    ws.emit("execution_success", { prompt_id: "job-3" });

    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false, code: "no_video_output" });
  });

  it("gives up honestly once the deadline passes, without pretending the render finished", async () => {
    vi.useFakeTimers();
    const promise = waitForComfyCloudCompletion("job-4", CREDS, 5000, FakeWebSocket);
    await vi.advanceTimersByTimeAsync(5001);

    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false, code: "timeout" });
    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("reports network_error when the socket itself errors", async () => {
    const promise = waitForComfyCloudCompletion("job-5", CREDS, 5000, FakeWebSocket);
    const ws = FakeWebSocket.instances[0];
    ws.onerror?.(new Error("connection reset"));

    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });

  it("reports network_error when the WebSocket constructor itself throws", async () => {
    FakeWebSocket.shouldThrow = true;
    const outcome = await waitForComfyCloudCompletion("job-6", CREDS, 5000, FakeWebSocket);
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });

  it("reports no_websocket when no WebSocket implementation is available at all", async () => {
    const outcome = await waitForComfyCloudCompletion("job-7", CREDS, 5000, null);
    expect(outcome).toMatchObject({ ok: false, code: "no_websocket" });
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

describe("buildLtxAudioToVideoWorkflow", () => {
  it("wires LoadImage/LoadAudio into LtxApi25AudioToVideo into SaveVideo, matching each node's documented input names", () => {
    const workflow = buildLtxAudioToVideoWorkflow({
      imageFilename: "still.png",
      audioFilename: "clip.mp3",
      prompt: "slow push in, singing directly to camera",
      model: "LTX-2.5 (Fast)",
    });

    expect(workflow["1"]).toEqual({ class_type: "LoadImage", inputs: { image: "still.png" } });
    expect(workflow["2"]).toEqual({ class_type: "LoadAudio", inputs: { audio: "clip.mp3" } });
    expect(workflow["3"]).toEqual({
      class_type: "LtxApi25AudioToVideo",
      inputs: {
        audio: ["2", 0],
        image: ["1", 0],
        model: "LTX-2.5 (Fast)",
        prompt: "slow push in, singing directly to camera",
        seed: 42,
      },
    });
    expect(workflow["4"]).toEqual({
      class_type: "SaveVideo",
      inputs: { video: ["3", 0], filename_prefix: "skidmarks_ltx" },
    });
  });

  it("honors an explicit seed instead of always defaulting to 42", () => {
    const workflow = buildLtxAudioToVideoWorkflow({
      imageFilename: "a.png",
      audioFilename: "a.mp3",
      prompt: "x",
      model: "LTX-2.5 (Pro)",
      seed: 7,
    });
    expect((workflow["3"] as { inputs: { seed: number } }).inputs.seed).toBe(7);
  });
});
