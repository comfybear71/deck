import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ELEVENLABS_TTS_FALLBACK_MODEL_ID,
  ELEVENLABS_TTS_MODEL_ID,
  hasElevenLabsAudioTags,
  stripElevenLabsAudioTags,
  synthesizeSunnyBanksLine,
} from "./elevenLabsSpeech";

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

    expect(outcome).toEqual({ ok: true, bytes, contentType: "audio/mpeg", modelId: "eleven_v3" });
  });

  it("uses Eleven v3 for every line, tagged or not (tags only perform on v3)", async () => {
    expect(ELEVENLABS_TTS_MODEL_ID).toBe("eleven_v3");
    expect(ELEVENLABS_TTS_FALLBACK_MODEL_ID).toBe("eleven_multilingual_v2");
    fetchMock.mockResolvedValue(audioResponse(new Uint8Array([1])));

    await synthesizeSunnyBanksLine("voice-1", "Plain line, no tags.");
    await synthesizeSunnyBanksLine("voice-1", "[laughs] Tagged line.");

    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init.body).model_id).toBe("eleven_v3");
    }
  });

  it("sends inline audio tags to v3 exactly as written — never stripped, never rewritten", async () => {
    fetchMock.mockResolvedValueOnce(audioResponse(new Uint8Array([1])));
    const line = "oi, here we go, [pause] [whispers] another bus load of suckers...";

    await synthesizeSunnyBanksLine("voice-1", `  ${line}  `);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: line, model_id: "eleven_v3" });
  });

  it("falls back once to Multilingual v2 — with the tags stripped — when v3 refuses a voice", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { detail: { message: "Voice not supported on eleven_v3" } }))
      .mockResolvedValueOnce(audioResponse(new Uint8Array([7, 7])));

    const outcome = await synthesizeSunnyBanksLine("voice-1", "[whispers] another bus load of suckers [laughs].");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model_id).toBe("eleven_v3");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      text: "another bus load of suckers.",
      model_id: "eleven_multilingual_v2",
    });
    expect(outcome).toEqual({
      ok: true,
      bytes: new Uint8Array([7, 7]),
      contentType: "audio/mpeg",
      modelId: "eleven_multilingual_v2",
    });
  });

  it("reports both errors when v3 and the v2 fallback both fail", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { detail: { message: "Voice not found" } }))
      .mockResolvedValueOnce(jsonResponse(404, { detail: { message: "Voice not found" } }));

    const outcome = await synthesizeSunnyBanksLine("voice-1", "G'day");

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message:
        "Eleven v3 failed (ElevenLabs returned 404: Voice not found); the Multilingual v2 fallback also failed (ElevenLabs returned 404: Voice not found).",
    });
  });

  it("does not fall back on a bad key / quota (401) or a rate limit (429) — another model can't fix those", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { detail: { message: "Too many concurrent requests" } }));
    const limited = await synthesizeSunnyBanksLine("voice-1", "G'day");
    expect(limited.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to v2 for a tag-only line (v2 would have nothing to say)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { detail: { message: "nope" } }));
    const outcome = await synthesizeSunnyBanksLine("voice-1", "[laughs]");
    expect(outcome).toEqual({ ok: false, unconfigured: false, message: "ElevenLabs returned 400: nope" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe("audio tag helpers", () => {
  it("spots an inline [tag]", () => {
    expect(hasElevenLabsAudioTags("oi, [whispers] suckers")).toBe(true);
    expect(hasElevenLabsAudioTags("no tags here")).toBe(false);
  });

  it("strips tags down to the words, tidying spacing and punctuation", () => {
    expect(stripElevenLabsAudioTags("oi, here we go, [pause] [whispers] another bus load of suckers...")).toBe(
      "oi, here we go, another bus load of suckers..."
    );
    expect(stripElevenLabsAudioTags("[sighs] Yeah nah [laughs].")).toBe("Yeah nah.");
    expect(stripElevenLabsAudioTags("[short pause], mate")).toBe("mate");
    expect(stripElevenLabsAudioTags("[laughs]")).toBe("");
    expect(stripElevenLabsAudioTags("No tags, unchanged.")).toBe("No tags, unchanged.");
  });
});
