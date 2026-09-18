import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
}));

import { estimateMp3DurationSec } from "@/lib/mp3Slice";
import { POST } from "./route";

/** Same real-encoder fixture helper as `lib/mp3Slice.test.ts` and
 * `app/api/skidmarks/generate-clip/route.test.ts` — a real MP3, so
 * `estimateMp3DurationSec` (the actual thing this route's duration
 * logic depends on) is exercised against real encoder output standing
 * in for ElevenLabs' response, not a hand-rolled byte array. */
function encodeTestMp3(durationSec: number, sampleRate: number = 22050, bitrateKbps: number = 64): Uint8Array {
  const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
  const totalSamples = Math.round(durationSec * sampleRate);
  const pcm = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5 * 0x7fff);
  }
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const encoded = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (encoded.length > 0) chunks.push(encoded);
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(flushed);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// A real, tiny, fast-to-decode 1x1 PNG, not just JPEG-header-shaped
// bytes — see `app/api/skidmarks/generate-clip/route.test.ts`'s own
// copy of this comment for why: `letterboxImageForLtxIa2v` runs a real
// `sharp` decode here too, and malformed bytes can make that hang.
const TINY_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/sunnybank/generate-speak-beat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function speakBeatRequest(overrides: Record<string, unknown> = {}): Request {
  return postRequest({
    characterName: "Shazza",
    line: "We haven't got any shade, Dazza.",
    startImageDataUrl: TINY_DATA_URL,
    ...overrides,
  });
}

describe("POST /api/skidmarks/sunnybank/generate-speak-beat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("ELEVEN_LABS_API_KEY", "");
    vi.stubEnv("COMFY_CLOUD_API_KEY", "test-comfy-key");
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    vi.stubEnv("COMFY_URL", "");
    putMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects a request missing any of characterName/line/startImageDataUrl", async () => {
    const res = await POST(speakBeatRequest({ line: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unlocked/unknown character name rather than guessing", async () => {
    const res = await POST(speakBeatRequest({ characterName: "Some Random Guest" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("unknown_character");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing_voice honestly for a locked character with no voice id yet (Hans)", async () => {
    const res = await POST(speakBeatRequest({ characterName: "Hans", line: "Ausgezeichnet!" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("missing_voice");
    expect(body.error).toContain("Hans");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing_api_key for COMFY_CLOUD_API_KEY before ever calling ElevenLabs", async () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    const res = await POST(speakBeatRequest());
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("COMFY_CLOUD_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing_api_key when neither ElevenLabs env var is set", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const res = await POST(speakBeatRequest());
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe("missing_api_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a real ElevenLabs upstream failure honestly", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { message: "Invalid API key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    const res = await POST(speakBeatRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_error");
    expect(body.error).toContain("Invalid API key");
  });

  it("live QA (2026-09-17): pads a 0.8s line with silence instead of 422 Try a longer line", async () => {
    mockElevenLabs(encodeTestMp3(0.8));
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/short-line.mp4" });

    const res = await POST(speakBeatRequest({ line: "You right?" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.durationSec).toBeGreaterThanOrEqual(2);
    expect(body.durationSec).toBeLessThanOrEqual(15);

    const [ttsUrl, ttsInit] = fetchMock.mock.calls[0];
    expect(String(ttsUrl)).toContain("elevenlabs.io");
    expect(JSON.parse(ttsInit.body).text).toBe("You right?");

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    expect(submitCallIndex).toBeGreaterThanOrEqual(0);
    const graph = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body).prompt as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    expect(graph["340:331"]?.inputs?.value).toBeGreaterThanOrEqual(2);
    expect(graph["340:319"]?.inputs?.value).toContain('Shazza says: "You right?".');
  });

  it("reports a genuine unreadable TTS payload as upstream_error, not a pad", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob([new Uint8Array([0, 1, 2, 3])]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      })
    );
    const res = await POST(speakBeatRequest({ line: "You right?" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_error");
    expect(body.error).toContain("unreadable");
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  function mockXaiComposite(dataUrl = TINY_DATA_URL) {
    const b64 = dataUrl.split(",")[1] ?? "";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: b64, mime_type: "image/png" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
  function mockElevenLabs(mp3Bytes: Uint8Array) {
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob([new Uint8Array(mp3Bytes)]), { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    );
  }
  function mockUploads(imageName = "start.png", audioName = "line.mp3") {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: imageName, subfolder: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: audioName, subfolder: "" }), { status: 200 }));
  }
  function mockSubmit(promptId = "job-1") {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: promptId }), { status: 200 }));
  }
  function mockJobPoll() {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          outputs: { "341": { images: [{ filename: "out.mp4", subfolder: "video", type: "output" }] } },
        }),
        { status: 200 }
      )
    );
  }
  function mockDownload(videoBytes: Uint8Array) {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://storage.example.com/signed/clip.mp4" } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(videoBytes), { status: 200 }));
  }

  it("runs the full real pipeline end to end and persists the result to Vercel Blob", async () => {
    const lineAudio = encodeTestMp3(4);
    mockElevenLabs(lineAudio);
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    const videoBytes = new Uint8Array([9, 9, 9, 9]);
    mockDownload(videoBytes);
    putMock.mockResolvedValueOnce({ url: "https://blob.vercel-storage.com/sunnybanks/speak-beats/1-shazza.mp4" });

    const res = await POST(speakBeatRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      videoUrl: "https://blob.vercel-storage.com/sunnybanks/speak-beats/1-shazza.mp4",
      character: "Shazza",
      persisted: true,
    });
    expect(body.durationSec).toBeGreaterThan(3);
    expect(body.durationSec).toBeLessThan(5);

    // The TTS call went to Shazza's real locked voice id.
    const [ttsUrl, ttsInit] = fetchMock.mock.calls[0];
    expect(ttsUrl).toBe("https://api.elevenlabs.io/v1/text-to-speech/Vuun8WKmo2MZSUXgLPGw");
    expect(JSON.parse(ttsInit.body).text).toBe("We haven't got any shade, Dazza.");

    // Garbage fixture bytes are not a real MP4, so mux fails closed
    // and the Blob write is still the paid LTX picture.
    expect(body.audioMuxed).toBe(false);
    expect(body.audioMuxError).toMatch(/ffmpeg/i);
    expect(Buffer.compare(putMock.mock.calls[0][1], Buffer.from(videoBytes))).toBe(0);
  });

  it("real reported gold check: the submitted prompt matches Sunny Banks' own speaking-plate shape, not Skidmarks'", async () => {
    mockElevenLabs(encodeTestMp3(4));
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/x.mp4" });

    await POST(speakBeatRequest());

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    expect(submitCallIndex).toBeGreaterThanOrEqual(0);
    const graph = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body).prompt;
    const promptNode = Object.values(graph as Record<string, { inputs?: Record<string, unknown> }>).find(
      (node) => typeof node.inputs?.value === "string" && (node.inputs.value as string).includes("says:")
    );
    expect(promptNode?.inputs?.value).toContain('Shazza says: "We haven\'t got any shade, Dazza.".');
    expect(promptNode?.inputs?.value).toContain("rubbery adult cartoon");
    expect(promptNode?.inputs?.value).not.toContain("[SPEECH]");
  });

  it("appends [Action:] after gold and still sends only the spoken line to TTS", async () => {
    mockElevenLabs(encodeTestMp3(4));
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/action.mp4" });

    await POST(
      speakBeatRequest({
        line: "Yup yup. Naaah.",
        characterName: "Unit 4S",
        locationId: "caravan_interior",
        action: "leans on the bunk",
      })
    );

    const [ttsUrl, ttsInit] = fetchMock.mock.calls[0];
    expect(String(ttsUrl)).toContain("elevenlabs.io");
    expect(JSON.parse(ttsInit.body as string).text).toBe("Yup yup. Naaah.");
    expect(JSON.parse(ttsInit.body as string).text).not.toContain("leans on the bunk");

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    expect(submitCallIndex).toBeGreaterThanOrEqual(0);
    const graph = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body as string).prompt as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    const prompt = graph["340:319"]?.inputs?.value;
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain('Unit 4S says: "Yup yup. Naaah.".');
    expect(prompt).toContain("bare feet");
    expect(prompt).toContain("leans on the bunk");
    expect(prompt).not.toMatch(/shoe|boot|sneaker/i);
    expect(String(prompt).startsWith("Use the provided start image")).toBe(true);
    expect(prompt).toContain("Unit 4S, short purple alien");
  });

  it("real reported bug fix (2026-09-18): appearanceModifier reaches the xAI compositing prompt, not just the motion prompt", async () => {
    mockElevenLabs(encodeTestMp3(4));
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/dazza-bottles.mp4" });

    await POST(
      speakBeatRequest({
        characterName: "Dazza",
        line: "Righto, two for you and two for me.",
        appearanceModifier: "holding two bottles of amber liquid, one in each hand",
      })
    );

    const xaiCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/images/edits"));
    expect(xaiCall).toBeTruthy();
    const xaiBody = JSON.parse(xaiCall![1].body as string) as { prompt: string };
    expect(xaiBody.prompt).toContain(
      "Shot-specific override for this render only: holding two bottles of amber liquid, one in each hand."
    );

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    const graph = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body as string).prompt as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    expect(graph["340:319"]?.inputs?.value).toContain("holding two bottles of amber liquid");
  });

  it("no settle pause (2026-09-18): an appearance change goes straight to the new action plate and starts talking", async () => {
    const lineAudio = encodeTestMp3(4);
    mockElevenLabs(lineAudio);
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/no-settle.mp4" });

    const res = await POST(
      speakBeatRequest({
        characterName: "Dazza",
        line: "Righto, two for you and two for me.",
        appearanceModifier: "holding two bottles of amber liquid",
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);

    // PR #142 prepended ~1.5s of silence here so the character could
    // "settle" into the restaging before speaking. Stuart dropped it on
    // sight: the composed plate already shows the bottles on frame 0,
    // so there is nothing to settle into. Duration and driving audio
    // are exactly the spoken line.
    expect(body.durationSec).toBeCloseTo(estimateMp3DurationSec(lineAudio), 1);
    const uploadCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/upload/image"));
    expect(uploadCalls).toHaveLength(2);
    expect((uploadCalls[1][1].body as FormData).get("image")).toHaveProperty("size", lineAudio.byteLength);

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    const graph = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body as string).prompt as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    const prompt = String(graph["340:319"]?.inputs?.value);
    expect(prompt).not.toMatch(/holds the newly-staged|without speaking|settle/i);
    expect(graph["340:331"]?.inputs?.value).toBe(body.durationSec);
    // The appearance change is still in the picture and the motion prompt.
    expect(prompt).toContain("holding two bottles of amber liquid");
  });

  it("a plain Speak beat with no appearance change is unchanged — duration is the real line", async () => {
    const lineAudio = encodeTestMp3(4);
    mockElevenLabs(lineAudio);
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/plain.mp4" });

    const res = await POST(speakBeatRequest());
    const body = await res.json();
    expect(body.durationSec).toBeCloseTo(estimateMp3DurationSec(lineAudio), 1);

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    const graph = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body as string).prompt as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    expect(graph["340:319"]?.inputs?.value).not.toContain("holds the newly-staged");
    expect(graph["340:331"]?.inputs?.value).toBeLessThan(4.6);
  });

  it("still returns the render, honestly flagged as unsaved, when the Blob upload fails", async () => {
    mockElevenLabs(encodeTestMp3(4));
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([7, 7]));
    putMock.mockRejectedValueOnce(new Error("Blob store not configured"));

    const res = await POST(speakBeatRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persisted).toBe(false);
    expect(body.audioMuxed).toBe(false);
    expect(body.persistError).toContain("Blob store not configured");
    expect(body.videoUrl).toMatch(/^data:video\/mp4;base64,/);
  });

  function holdBeatRequest(overrides: Record<string, unknown> = {}): Request {
    return postRequest({
      kind: "hold",
      characterName: "Shazza",
      startImageDataUrl: TINY_DATA_URL,
      ...overrides,
    });
  }

  it("hold: skips ElevenLabs, uses the gold hold prompt, and still runs the LTX pipeline", async () => {
    mockXaiComposite();
    mockUploads("start.png", "hold.mp3");
    mockSubmit();
    mockJobPoll();
    const videoBytes = new Uint8Array([3, 3, 3]);
    mockDownload(videoBytes);
    putMock.mockResolvedValueOnce({ url: "https://blob.vercel-storage.com/sunnybanks/hold-beats/1-shazza.mp4" });

    const res = await POST(holdBeatRequest({ line: "" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      videoUrl: "https://blob.vercel-storage.com/sunnybanks/hold-beats/1-shazza.mp4",
      character: "Shazza",
      kind: "hold",
      persisted: true,
    });
    expect(body.durationSec).toBeGreaterThan(4.5);
    expect(body.durationSec).toBeLessThanOrEqual(15);

    const firstUrl = String(fetchMock.mock.calls[0][0]);
    expect(firstUrl).not.toContain("elevenlabs.io");

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    expect(submitCallIndex).toBeGreaterThanOrEqual(0);
    const graph = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body).prompt;
    const promptNode = Object.values(graph as Record<string, { inputs?: Record<string, unknown> }>).find(
      (node) => typeof node.inputs?.value === "string" && (node.inputs.value as string).includes("No dialogue")
    );
    expect(promptNode?.inputs?.value).toContain("No dialogue. Camera holds, no cuts.");
    expect(promptNode?.inputs?.value).toContain("rubbery adult cartoon");
    expect(promptNode?.inputs?.value).not.toContain("says:");
    expect(promptNode?.inputs?.value).not.toContain("face entirely hidden in shadow");

    expect(String(putMock.mock.calls[0][0])).toContain("sunnybanks/hold-beats/");
    expect(body.audioMuxed).toBe(false);
    expect(Buffer.compare(putMock.mock.calls[0][1], Buffer.from(videoBytes))).toBe(0);
  });

  it("hold: does not require a locked voice (Hans has none) and does not require a line", async () => {
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/hans-hold.mp4" });

    const res = await POST(
      holdBeatRequest({
        characterName: "Hans",
        locationId: "office_storefront",
        locationImage: "/skidmarks/sunnybanks/office-storefront.jpg",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("hold");
    expect(body.character).toBe("Hans");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("elevenlabs.io");
  });

  it("hold: still needs COMFY_CLOUD_API_KEY, even with no ElevenLabs key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    const res = await POST(holdBeatRequest());
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("COMFY_CLOUD_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hold: with ElevenLabs unset but Comfy set, never calls ElevenLabs", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/hold.mp4" });

    const res = await POST(holdBeatRequest());
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("elevenlabs.io");
  });

  it("hold: xAI edits map startImageDataUrl to Image 1 (location) and Shazza hero to Image 2, then LTX gets the composed still", async () => {
    mockXaiComposite();
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/plated-hold.mp4" });

    const res = await POST(
      holdBeatRequest({
        locationId: "office_storefront",
        locationImage: "/skidmarks/sunnybanks/office-storefront.jpg",
      })
    );
    expect(res.status).toBe(200);

    const xaiCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/images/edits"));
    expect(xaiCall).toBeTruthy();
    const xaiBody = JSON.parse(xaiCall![1].body as string) as {
      prompt: string;
      images: { url: string; type: string }[];
    };
    expect(xaiBody.images).toHaveLength(2);
    expect(xaiBody.images[0].url).toBe(TINY_DATA_URL);
    expect(xaiBody.images[0].type).toBe("image_url");
    expect(xaiBody.images[1].url).toMatch(/^data:image\/jpeg;base64,/);
    expect(xaiBody.images[1].url).not.toBe(TINY_DATA_URL);
    expect(xaiBody.prompt).toContain("<IMAGE_0> is the LOCKED background");
    expect(xaiBody.prompt).toContain("<IMAGE_1> is the person");
    expect(xaiBody.prompt).toContain("Office Storefront");
    expect(xaiBody.prompt).toContain("Shazza");
    expect(xaiBody.prompt).not.toContain("shazza-reference");
  });

  it("hold: Crowd cutaway skips overlay and gold Hold, uses [Action:] on the location still", async () => {
    mockUploads("start.png", "hold.mp3");
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([4, 4, 4]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/crowd-hold.mp4" });

    const res = await POST(
      holdBeatRequest({
        characterName: "Crowd",
        locationId: "office_storefront",
        action:
          "Fast dynamic drone shot, powering around, sweeping wide angle view seeing the crowd of park residents looking confused",
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.kind).toBe("hold");
    expect(body.character).toBe("Crowd");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("elevenlabs.io");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/images/edits"))).toBe(false);

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    expect(submitCallIndex).toBeGreaterThanOrEqual(0);
    const graph = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body).prompt as Record<
      string,
      { inputs?: Record<string, unknown> }
    >;
    const prompt = graph["340:319"]?.inputs?.value;
    expect(prompt).toContain("Fast dynamic drone shot");
    expect(prompt).toContain("No dialogue.");
    expect(prompt).not.toContain("Shazza,");
    expect(prompt).not.toContain("holds their pose");
    expect(String(putMock.mock.calls[0][0])).toContain("sunnybanks/hold-beats/");
    expect(String(putMock.mock.calls[0][0])).toContain("crowd");
  });

  it("hold: Crowd cutaway does not need XAI_API_KEY because there is no hero overlay", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/crowd-no-xai.mp4" });

    const res = await POST(holdBeatRequest({ characterName: "Crowd", action: "drone shot of the park" }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/images/edits"))).toBe(false);
  });

  it("hold: missing XAI_API_KEY does not fire LTX for a character that needs overlay", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const res = await POST(holdBeatRequest());
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("XAI_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
