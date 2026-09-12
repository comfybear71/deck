import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyElevenLabsFailure, extractElevenLabsErrorDetail, POST } from "./route";

/**
 * `extractElevenLabsErrorDetail`/`classifyElevenLabsFailure` are this
 * route's own honest-error plumbing (see the route's module doc comment,
 * "Verified against Stuart's Gemini troubleshooting notes", point 4) —
 * pure functions, no `fetch`/`NextResponse`/App Router machinery needed,
 * so they're exercised directly here rather than through a full request.
 *
 * The `missing_permissions`/401 fixture below is not a hypothetical
 * shape — it's the **real** response body this sandbox got back from a
 * live call to `https://api.elevenlabs.io/v1/speech-to-text`, using this
 * route's exact request shape (multipart `file` + `model_id=scribe_v2` +
 * `timestamps_granularity=word` + `tag_audio_events=true`), with a real
 * (though not necessarily Stuart's own) ElevenLabs API key available in
 * this sandbox. See the route's module doc comment for the full
 * investigation this evidenced.
 */

describe("extractElevenLabsErrorDetail", () => {
  it("parses the real 'missing_permissions' 401 body observed against the live API", () => {
    const payload = {
      detail: {
        type: "authentication_error",
        code: "unauthorized",
        message: "The API key you used is missing the permission speech_to_text to execute this operation.",
        status: "missing_permissions",
        request_id: "2608dba9d6f9e4fbd2babc036aefb2a6",
      },
    };

    expect(extractElevenLabsErrorDetail(payload)).toEqual({
      message: "The API key you used is missing the permission speech_to_text to execute this operation.",
      type: "authentication_error",
      code: "unauthorized",
    });
  });

  it("parses the real 'invalid_api_key' 401 body observed for a bad key", () => {
    const payload = {
      detail: {
        type: "authentication_error",
        code: "unauthorized",
        message: "Invalid API key",
        status: "invalid_api_key",
        request_id: "8fcb631f1bb69822e3049cb90925b6ba",
      },
    };

    expect(extractElevenLabsErrorDetail(payload)?.message).toBe("Invalid API key");
  });

  it("falls back to the legacy string `detail` shape", () => {
    expect(extractElevenLabsErrorDetail({ detail: "Something went wrong." })).toEqual({
      message: "Something went wrong.",
    });
  });

  it("reads `code` over `status` when a real error body happens to have both", () => {
    const payload = { detail: { message: "One or more parameters are invalid.", code: "invalid_parameters", status: "invalid_parameters" } };
    expect(extractElevenLabsErrorDetail(payload)?.code).toBe("invalid_parameters");
  });

  it("falls back to the legacy `status` field when `code` is absent (the real missing_permissions shape)", () => {
    const payload = { detail: { message: "...", status: "missing_permissions" } };
    expect(extractElevenLabsErrorDetail(payload)?.code).toBe("missing_permissions");
  });

  it("returns null for an empty or malformed payload rather than throwing", () => {
    expect(extractElevenLabsErrorDetail(null)).toBeNull();
    expect(extractElevenLabsErrorDetail(undefined)).toBeNull();
    expect(extractElevenLabsErrorDetail("just a string")).toBeNull();
    expect(extractElevenLabsErrorDetail({})).toBeNull();
    expect(extractElevenLabsErrorDetail({ detail: {} })).toBeNull();
    expect(extractElevenLabsErrorDetail({ detail: { message: "" } })).toBeNull();
  });
});

describe("classifyElevenLabsFailure", () => {
  it("maps the real live 401 missing_permissions response to auth_error, not a generic upstream_error", () => {
    // This is the exact case this PR's investigation surfaced: a key
    // that authenticates but lacks the speech_to_text permission. Before
    // this fix, this landed as a generic `upstream_error` the old
    // Whisper fallback then silently ran past; now it's specifically
    // `auth_error` so `lib/transcription.ts`/the UI caption can treat it
    // as "check the key", not just "something failed".
    const detail = extractElevenLabsErrorDetail({
      detail: {
        type: "authentication_error",
        code: "unauthorized",
        message: "The API key you used is missing the permission speech_to_text to execute this operation.",
        status: "missing_permissions",
      },
    });
    expect(classifyElevenLabsFailure(401, detail)).toEqual({ httpStatus: 401, code: "auth_error" });
  });

  it("maps a 403 authorization_error to auth_error too", () => {
    expect(classifyElevenLabsFailure(403, { message: "Forbidden.", type: "authorization_error" })).toEqual({
      httpStatus: 403,
      code: "auth_error",
    });
  });

  it("maps a 429 rate_limit_error to rate_limited", () => {
    expect(
      classifyElevenLabsFailure(429, { message: "Too many requests.", type: "rate_limit_error", code: "rate_limit_exceeded" })
    ).toEqual({ httpStatus: 429, code: "rate_limited" });
  });

  it("maps a 402 payment_required to payment_required", () => {
    expect(classifyElevenLabsFailure(402, { message: "Insufficient credits.", type: "payment_required" })).toEqual({
      httpStatus: 402,
      code: "payment_required",
    });
  });

  it("maps a validation_error with an audio-specific code to invalid_audio", () => {
    for (const audioCode of [
      "invalid_audio",
      "invalid_audio_format",
      "invalid_file_type",
      "audio_too_long",
      "audio_too_short",
    ]) {
      expect(
        classifyElevenLabsFailure(422, { message: "bad audio", type: "validation_error", code: audioCode })
      ).toEqual({ httpStatus: 422, code: "invalid_audio" });
    }
  });

  it("maps a validation_error with a non-audio code to invalid_request, not invalid_audio", () => {
    // The real documented example from ElevenLabs' own error docs: an
    // unsupported model_id — a real parameter problem, not a bad file,
    // so this must NOT trigger `lib/transcription.ts`'s re-encode retry.
    expect(
      classifyElevenLabsFailure(400, {
        message: "The 'keyterms' parameter is only supported with the 'scribe_v2' model.",
        type: "validation_error",
        code: "invalid_parameters",
      })
    ).toEqual({ httpStatus: 422, code: "invalid_request" });
  });

  it("falls back to upstream_error for an internal/service error", () => {
    expect(classifyElevenLabsFailure(500, { message: "Unexpected error.", type: "internal_error" })).toEqual({
      httpStatus: 502,
      code: "upstream_error",
    });
    expect(classifyElevenLabsFailure(503, null)).toEqual({ httpStatus: 502, code: "upstream_error" });
  });

  it("still classifies correctly off the raw HTTP status alone when there's no parsed detail", () => {
    expect(classifyElevenLabsFailure(401, null)).toEqual({ httpStatus: 401, code: "auth_error" });
    expect(classifyElevenLabsFailure(429, null)).toEqual({ httpStatus: 429, code: "rate_limited" });
  });
});

/**
 * `POST`'s `missing_api_key` path, exercised directly (no ElevenLabs
 * `fetch` needed — it returns before ever making one). This sandbox's
 * process actually has a real `ELEVENLABS_API_KEY` set (for this
 * session's own investigation, see the route's module doc comment) —
 * `vi.stubEnv` clears both candidate names so this test reflects
 * Stuart's real "neither name is set" case, not this sandbox's own.
 *
 * This is the case the "Needs Attention" / redeploy investigation is
 * about: if a live caption still shows this exact message after Stuart
 * added the key on Vercel, the deployed function genuinely doesn't see
 * it yet (a redeploy issue) — as opposed to a real ElevenLabs error
 * (which would mean the key *is* visible, and the problem is upstream).
 * See the module doc comment's "A key that's set on Vercel doesn't mean
 * this function can see it yet" note.
 */
describe("POST (missing_api_key)", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVEN_LABS_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names both checked env var names and points at redeploying after an env var change", async () => {
    const request = new Request("http://localhost/api/skidmarks/transcribe", { method: "POST" });
    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("ELEVENLABS_API_KEY");
    expect(body.error).toContain("ELEVEN_LABS_API_KEY");
    // The actual point of this test: the message now tells Stuart to
    // redeploy if he just added the var, not just that it's missing.
    expect(body.error.toLowerCase()).toContain("redeploy");
  });
});
