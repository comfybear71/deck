import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
}));

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

  it("rejects a line that synthesizes too short for LTX's own audio-input floor", async () => {
    // A fraction-of-a-second "clip" — well under the 2s floor.
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob([new Uint8Array(encodeTestMp3(0.3))]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      })
    );
    const res = await POST(speakBeatRequest());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(body.error).toContain("Shazza");
  });

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

    // The Blob write used the real downloaded video bytes.
    expect(Buffer.compare(putMock.mock.calls[0][1], Buffer.from(videoBytes))).toBe(0);
  });

  it("real reported gold check: the submitted prompt matches Sunny Banks' own speaking-plate shape, not Skidmarks'", async () => {
    mockElevenLabs(encodeTestMp3(4));
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

  it("still returns the render, honestly flagged as unsaved, when the Blob upload fails", async () => {
    mockElevenLabs(encodeTestMp3(4));
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([7, 7]));
    putMock.mockRejectedValueOnce(new Error("Blob store not configured"));

    const res = await POST(speakBeatRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persisted).toBe(false);
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
    expect(Buffer.compare(putMock.mock.calls[0][1], Buffer.from(videoBytes))).toBe(0);
  });

  it("hold: does not require a locked voice (Hans has none) and does not require a line", async () => {
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/hans-hold.mp4" });

    const res = await POST(holdBeatRequest({ characterName: "Hans" }));
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
    mockUploads();
    mockSubmit();
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    putMock.mockResolvedValueOnce({ url: "https://blob.example/hold.mp4" });

    const res = await POST(holdBeatRequest());
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("elevenlabs.io");
  });
});
