import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { synthesizeSunnyBanksLine } from "./elevenLabsSpeech";

function audioResponse(bytes: Uint8Array, contentType = "audio/mpeg"): Response {
  return new Response(new Blob([new Uint8Array(bytes)]), { status: 200, headers: { "Content-Type": contentType } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("synthesizeSunnyBanksLine", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-elevenlabs-key");
    vi.stubEnv("ELEVEN_LABS_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("real reported gap (2026-09-15): reports unconfigured honestly, same as the transcription path, rather than guessing at a key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const outcome = await synthesizeSunnyBanksLine("voice-1", "G'day");
    expect(outcome).toEqual({
      ok: false,
      unconfigured: true,
      message: "Neither ELEVENLABS_API_KEY nor ELEVEN_LABS_API_KEY is set on the server.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the real voice id in the URL, the line as text, with the xi-api-key header", async () => {
    fetchMock.mockResolvedValueOnce(audioResponse(new Uint8Array([1, 2, 3])));

    await synthesizeSunnyBanksLine("Vuun8WKmo2MZSUXgLPGw", "Stop complaining and finish your breakfast");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/Vuun8WKmo2MZSUXgLPGw");
    expect(init.headers["xi-api-key"]).toBe("test-elevenlabs-key");
    const body = JSON.parse(init.body);
    expect(body.text).toBe("Stop complaining and finish your breakfast");
  });

  it("returns the real audio bytes and content type on success", async () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    fetchMock.mockResolvedValueOnce(audioResponse(bytes, "audio/mpeg"));

    const outcome = await synthesizeSunnyBanksLine("voice-1", "G'day mate");

    expect(outcome).toEqual({ ok: true, bytes, contentType: "audio/mpeg" });
  });

  it("reports a real upstream failure with ElevenLabs' own detail message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: { message: "Invalid API key" } }));

    const outcome = await synthesizeSunnyBanksLine("voice-1", "G'day");

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "ElevenLabs returned 401: Invalid API key",
    });
  });

  it("reports a network error honestly rather than throwing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const outcome = await synthesizeSunnyBanksLine("voice-1", "G'day");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.unconfigured).toBe(false);
      expect(outcome.message).toContain("Could not reach ElevenLabs");
    }
  });

  it("refuses to call out for blank/whitespace-only line text", async () => {
    const outcome = await synthesizeSunnyBanksLine("voice-1", "   ");
    expect(outcome).toEqual({ ok: false, unconfigured: false, message: "No line text to synthesize." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
