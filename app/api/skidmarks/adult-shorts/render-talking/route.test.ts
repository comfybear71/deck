import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";

const synthMock = vi.fn();
vi.mock("@/lib/elevenLabsSpeech", async (orig) => ({
  ...(await orig<typeof import("@/lib/elevenLabsSpeech")>()),
  synthesizeSunnyBanksLine: (...a: unknown[]) => synthMock(...a),
}));
const workflowMock = vi.fn((inputs: Record<string, unknown>) => ({ inputs }));
vi.mock("@/lib/comfyCloud", () => ({
  resolveComfyCloudCredentials: () => (process.env.COMFY_CLOUD_API_KEY ? { apiKey: "k", baseUrl: "https://comfy.test" } : null),
  letterboxImageForLtxIa2v: async (bytes: Uint8Array, mimeType: string) => ({ bytes, mimeType, letterboxed: false }),
  uploadComfyCloudInput: async (_b: Uint8Array, name: string) => ({ ok: true, name }),
  buildLtx23Ia2vWorkflow: (inputs: Record<string, unknown>) => workflowMock(inputs),
  submitComfyCloudWorkflow: async () => ({ ok: true, promptId: "p1" }),
  pollComfyCloudJob: async () => ({ ok: true, videoFile: { filename: "out.mp4" } }),
  downloadComfyCloudOutput: async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]) }),
}));
vi.mock("@/lib/muxClipAudio", () => ({ muxClipAudio: async () => ({ ok: true, bytes: new Uint8Array([4, 5, 6]) }) }));
vi.mock("@/lib/serverVideoFrame", () => ({ extractLastVideoFrameServer: async () => ({ ok: true, bytes: new Uint8Array([7]) }) }));
const putMock = vi.fn();
vi.mock("@/lib/deckMediaPut", () => ({
  putDeckMediaOrLegacy: (...a: unknown[]) => putMock(...a),
}));

import { ADULT_SHORTS_GENERAL_CONTENT_LOCK, buildAdultShortsTalkingPrompt } from "@/lib/adultShorts";
import { POST } from "./route";

function encodeTestMp3(durationSec: number): Uint8Array {
  const rate = 22050;
  const encoder = new Mp3Encoder(1, rate, 64);
  const pcm = new Int16Array(Math.round(durationSec * rate));
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const e = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (e.length) chunks.push(e);
  }
  const f = encoder.flush();
  if (f.length) chunks.push(f);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const TINY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const BROTHER = { name: "Brother", look: "short dark hair", referenceUrls: [], subjectWord: "man" };
const PROMPT = buildAdultShortsTalkingPrompt(
  [BROTHER],
  { prompt: "Leaning on the caravan", line: "[whispers] Nobody move." },
  "Brother",
  { adult: false },
);

function req(over: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/skidmarks/adult-shorts/render-talking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: PROMPT,
      line: "[whispers] Nobody move.",
      speakerName: "Brother",
      voiceId: "AbCdEfGh12345678IjKl",
      startImageUrl: TINY,
      mediaTarget: { folder: "deck/shorts/episodes/ep02-brother-vs-rambo", name: "ep02-brother-vs-rambo-clip-01" },
      voiceTarget: { folder: "deck/shorts/episodes/ep02-brother-vs-rambo", name: "ep02-brother-vs-rambo-voice-01" },
      ...over,
    }),
  });
}

describe("POST /api/skidmarks/adult-shorts/render-talking", () => {
  beforeEach(() => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "test");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    synthMock.mockReset();
    workflowMock.mockClear();
    putMock.mockReset();
    synthMock.mockResolvedValue({ ok: true, bytes: encodeTestMp3(3), contentType: "audio/mpeg", modelId: "eleven_v3" });
    putMock.mockImplementation(async (_b: unknown, o: { target: { folder: string; name: string }; ext: string }) => ({
      url: `https://x.public.blob.vercel-storage.com/${o.target.folder}/${o.target.name}.${o.ext}`,
      pathname: `${o.target.folder}/${o.target.name}.${o.ext}`,
    }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("voices the Line with its tags, lip-syncs on LTX with just the words, and saves clip, last frame and voice in the episode folder", async () => {
    const res = await POST(req());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(synthMock).toHaveBeenCalledWith("AbCdEfGh12345678IjKl", "[whispers] Nobody move.");
    const prompt = workflowMock.mock.calls[0][0].prompt as string;
    // The page's prompt goes as it is (2026-10-04): the Sunny Banks speaking text first.
    expect(prompt).toBe(PROMPT);
    expect(prompt.startsWith("Use the provided start image as the first frame. Brother, short dark hair is prominent, mouth and head move naturally while speaking")).toBe(true);
    expect(prompt).toContain('Brother says: "Nobody move.". Camera holds.');
    expect(prompt).not.toContain("[whispers]");
    expect(prompt).toContain("Adult man, clearly over 25");
    expect(prompt).toContain(ADULT_SHORTS_GENERAL_CONTENT_LOCK);
    expect(json.videoBackend).toBe("ltx");
    expect(json.videoUrl).toContain("deck/shorts/episodes/ep02-brother-vs-rambo/ep02-brother-vs-rambo-clip-01.mp4");
    expect(json.lastFrameUrl).toContain("ep02-brother-vs-rambo-clip-01-last-frame.jpg");
    expect(json.voiceUrl).toContain("deck/shorts/episodes/ep02-brother-vs-rambo/ep02-brother-vs-rambo-voice-01.mp3");
    expect(json.durationSec).toBeGreaterThanOrEqual(2);
  });

  it("an older page's prompt without the words still gets who says what in front", async () => {
    const older = "Leaning on the caravan Adult man, clearly over 25, fictional AI-created character, photorealistic.";
    const res = await POST(req({ prompt: older }));
    expect(res.status).toBe(200);
    expect(workflowMock.mock.calls[0][0].prompt).toBe(`Brother says: "Nobody move." ${older}`);
  });

  it("refuses without a voice ID and never calls ElevenLabs", async () => {
    const res = await POST(req({ voiceId: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_voice");
    expect(synthMock).not.toHaveBeenCalled();
  });

  it("refuses a prompt without the adult lock", async () => {
    const res = await POST(req({ prompt: "Leaning on the caravan" }));
    expect(res.status).toBe(400);
    expect(synthMock).not.toHaveBeenCalled();
  });

  it("only fetches start images from Deck's own Blob store", async () => {
    const res = await POST(req({ startImageUrl: "https://example.com/plate.jpg" }));
    expect(res.status).toBe(400);
    expect(synthMock).not.toHaveBeenCalled();
  });

  it("needs a Line", async () => {
    const res = await POST(req({ line: "  " }));
    expect(res.status).toBe(400);
  });
});
