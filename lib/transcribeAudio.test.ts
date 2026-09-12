import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompressionOutcome } from "./audioCompression";

/**
 * `transcribeAudio` (`lib/transcription.ts`) is the one function in that
 * module that needs a mocked network + a mocked
 * `compressAudioForTranscription` to exercise meaningfully — everything
 * else in `lib/transcription.test.ts` is pure and browser-API-free, same
 * split `lib/audioCompression.test.ts`'s own doc comment describes for
 * that module. Kept in its own file so this mocking doesn't leak into
 * (or get accidentally relied on by) the pure-function suite.
 *
 * Covers the ElevenLabs-only contract (`missing_api_key` →
 * `unconfigured`, a real success, a real non-retryable failure) and —
 * the specific behavior this file exists to pin down — the one-shot
 * re-encode retry `transcribeAudio` runs when the server reports
 * `code: "invalid_audio"` (per Stuart's Gemini troubleshooting notes'
 * encoding-risk point): retry only when the first attempt sent the
 * *unmodified* original file, and never retry twice.
 */

const compressAudioForTranscriptionMock = vi.fn<
  (file: File, options?: { force?: boolean }) => Promise<CompressionOutcome>
>();

vi.mock("./audioCompression", () => ({
  VERCEL_BODY_LIMIT_BYTES: 4.5 * 1024 * 1024,
  compressAudioForTranscription: (file: File, options?: { force?: boolean }) =>
    compressAudioForTranscriptionMock(file, options),
}));

// Imported after the mock so `transcribeAudio` picks up the mocked
// `compressAudioForTranscription` — vitest hoists `vi.mock` above
// imports regardless of source order, but writing it this way keeps the
// dependency obvious to a reader.
const { transcribeAudio } = await import("./transcription");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFile(name: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type: "audio/mpeg" });
}

describe("transcribeAudio", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    compressAudioForTranscriptionMock.mockReset();
    // Default: file is already small enough, uploaded unmodified —
    // matches most tests' setup unless overridden.
    compressAudioForTranscriptionMock.mockImplementation(async (file) => ({
      kind: "unchanged",
      file,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the server's honest 'unconfigured' outcome without retrying", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(501, {
        error: "Neither ELEVENLABS_API_KEY nor ELEVEN_LABS_API_KEY is set on the server.",
        code: "missing_api_key",
      })
    );

    const outcome = await transcribeAudio(makeFile("song.mp3"));

    expect(outcome).toEqual({
      ok: false,
      unconfigured: true,
      message: "Neither ELEVENLABS_API_KEY nor ELEVEN_LABS_API_KEY is set on the server.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a real success with the words/duration/provider the route reported", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        words: [{ word: "hello", startSec: 1, endSec: 1.4 }],
        durationSec: 42,
        provider: "elevenlabs",
      })
    );

    const outcome = await transcribeAudio(makeFile("song.mp3"));

    expect(outcome).toEqual({
      ok: true,
      result: {
        words: [{ word: "hello", startSec: 1, endSec: 1.4 }],
        durationSec: 42,
        provider: "elevenlabs",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("filters out implausible words but keeps a real success (defensive parsing, not a throw)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        words: [
          { word: "real", startSec: 1, endSec: 1.4 },
          { word: "bad", startSec: "oops", endSec: 1.4 },
          { notAWord: true },
        ],
        durationSec: 42,
        provider: "elevenlabs",
      })
    );

    const outcome = await transcribeAudio(makeFile("song.mp3"));

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.words).toEqual([{ word: "real", startSec: 1, endSec: 1.4 }]);
    }
  });

  it("does not retry a real (non-invalid_audio) failure, e.g. an ElevenLabs auth error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error:
          "ElevenLabs Scribe returned 401: The API key you used is missing the permission speech_to_text to execute this operation. (missing_permissions)",
        code: "auth_error",
      })
    );

    const outcome = await transcribeAudio(makeFile("song.mp3"));

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message:
        "ElevenLabs Scribe returned 401: The API key you used is missing the permission speech_to_text to execute this operation. (missing_permissions)",
    });
    // The real bug this whole PR is about: a real ElevenLabs failure
    // must surface verbatim, never trigger a silent second attempt
    // (there's no other provider to fall through to, and this specific
    // failure isn't the "maybe a re-encode fixes it" kind either).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(compressAudioForTranscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("retries once with a forced re-encode when the server reports invalid_audio against an unmodified original", async () => {
    const original = makeFile("weird-headers.mp3");
    const reencodedFile = makeFile("weird-headers.compressed.mp3");

    compressAudioForTranscriptionMock.mockImplementation(async (file, options) => {
      if (options?.force) {
        return { kind: "compressed", file: reencodedFile, originalBytes: file.size, compressedBytes: reencodedFile.size, bitrateKbps: 128 };
      }
      return { kind: "unchanged", file };
    });

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(422, {
          error: "ElevenLabs Scribe returned 422: The provided audio is invalid or corrupted.",
          code: "invalid_audio",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          words: [{ word: "verse", startSec: 32, endSec: 40 }],
          durationSec: 256,
          provider: "elevenlabs",
        })
      );

    const outcome = await transcribeAudio(original);

    expect(outcome).toEqual({
      ok: true,
      result: {
        words: [{ word: "verse", startSec: 32, endSec: 40 }],
        durationSec: 256,
        provider: "elevenlabs",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First attempt uploaded the original file untouched; the retry
    // uploaded the freshly re-encoded one — confirmed via each request's
    // actual multipart body, not just the call count.
    const firstBody = fetchMock.mock.calls[0][1].body as FormData;
    const secondBody = fetchMock.mock.calls[1][1].body as FormData;
    expect((firstBody.get("audio") as File).name).toBe("weird-headers.mp3");
    expect((secondBody.get("audio") as File).name).toBe("weird-headers.compressed.mp3");
    // The forced re-encode call is distinguishable from the first,
    // normal compression check.
    expect(compressAudioForTranscriptionMock).toHaveBeenCalledTimes(2);
    expect(compressAudioForTranscriptionMock.mock.calls[1][1]).toEqual({ force: true });
  });

  it("reports the original invalid_audio failure if the forced re-encode itself can't run (e.g. unsupported browser)", async () => {
    compressAudioForTranscriptionMock.mockImplementation(async (file, options) => {
      if (options?.force) {
        return { kind: "failed", message: "This browser doesn't support Web Audio decoding." };
      }
      return { kind: "unchanged", file };
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        error: "ElevenLabs Scribe returned 422: The provided audio is invalid or corrupted.",
        code: "invalid_audio",
      })
    );

    const outcome = await transcribeAudio(makeFile("weird-headers.mp3"));

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "ElevenLabs Scribe returned 422: The provided audio is invalid or corrupted.",
    });
    // Only one real upload attempt happened — the forced re-encode
    // never produced a file to retry with.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries when the first attempt already uploaded a freshly re-encoded (large) file", async () => {
    const compressedFile = makeFile("song.compressed.mp3");
    compressAudioForTranscriptionMock.mockImplementation(async (file, options) => {
      if (options?.force) {
        throw new Error("Should not be called \u2014 the first attempt already re-encoded.");
      }
      return {
        kind: "compressed",
        file: compressedFile,
        originalBytes: file.size,
        compressedBytes: compressedFile.size,
        bitrateKbps: 128,
      };
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        error: "ElevenLabs Scribe returned 422: The provided audio is invalid or corrupted.",
        code: "invalid_audio",
      })
    );

    const bigFile = makeFile("song.mp3", 5 * 1024 * 1024);
    const outcome = await transcribeAudio(bigFile);

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "ElevenLabs Scribe returned 422: The provided audio is invalid or corrupted.",
    });
    // A second re-encode of the exact same source would produce
    // byte-identical output — retrying would just repeat the same
    // failing request, so this correctly never even tries.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(compressAudioForTranscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("reports a real network error honestly (no fetch success to parse)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const outcome = await transcribeAudio(makeFile("song.mp3"));

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "Failed to fetch",
    });
  });

  it("describes a bare platform 413 (no JSON body) in plain language, not a raw status code", async () => {
    const bigFile = makeFile("song.mp3", 5 * 1024 * 1024);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 413 }));

    const outcome = await transcribeAudio(bigFile);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain("MB");
      expect(outcome.message).not.toMatch(/\b413\b/);
    }
  });

  it("reports the 'too_long' compression outcome directly without ever hitting the network", async () => {
    compressAudioForTranscriptionMock.mockResolvedValueOnce({
      kind: "too_long",
      durationSec: 4000,
      message: "This track is 66:40 long \u2014 too large to shrink under the upload limit.",
    });

    const outcome = await transcribeAudio(makeFile("epic.mp3"));

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "This track is 66:40 long \u2014 too large to shrink under the upload limit.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
