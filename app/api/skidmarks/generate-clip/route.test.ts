import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
}));

import {
  classifyXaiVideoHttpFailure,
  classifyXaiVideoJobError,
  extractXaiErrorMessage,
  POLL_INTERVAL_MS,
  POST,
  resolvePersistenceTarget,
} from "./route";

describe("extractXaiErrorMessage", () => {
  it("parses the OpenAI-compatible { error: { message } } shape", () => {
    expect(extractXaiErrorMessage({ error: { message: "Invalid API key provided." } })).toBe(
      "Invalid API key provided."
    );
  });

  it("falls back to a bare string `error`", () => {
    expect(extractXaiErrorMessage({ error: "Something went wrong." })).toBe("Something went wrong.");
  });

  it("returns null for an empty or malformed payload rather than throwing", () => {
    expect(extractXaiErrorMessage(null)).toBeNull();
    expect(extractXaiErrorMessage({})).toBeNull();
    expect(extractXaiErrorMessage({ error: {} })).toBeNull();
  });
});

describe("classifyXaiVideoHttpFailure", () => {
  it("maps 401/403 to auth_error", () => {
    expect(classifyXaiVideoHttpFailure(401)).toEqual({ httpStatus: 401, code: "auth_error" });
    expect(classifyXaiVideoHttpFailure(403)).toEqual({ httpStatus: 403, code: "auth_error" });
  });

  it("maps 429 to rate_limited and 402 to payment_required", () => {
    expect(classifyXaiVideoHttpFailure(429)).toEqual({ httpStatus: 429, code: "rate_limited" });
    expect(classifyXaiVideoHttpFailure(402)).toEqual({ httpStatus: 402, code: "payment_required" });
  });

  it("maps 400/422 to invalid_request and falls back to upstream_error otherwise", () => {
    expect(classifyXaiVideoHttpFailure(400)).toEqual({ httpStatus: 422, code: "invalid_request" });
    expect(classifyXaiVideoHttpFailure(422)).toEqual({ httpStatus: 422, code: "invalid_request" });
    expect(classifyXaiVideoHttpFailure(500)).toEqual({ httpStatus: 502, code: "upstream_error" });
  });
});

describe("classifyXaiVideoJobError", () => {
  it("maps each documented xAI video error.code to a distinct outcome", () => {
    expect(classifyXaiVideoJobError("invalid_argument")).toEqual({ httpStatus: 422, code: "invalid_request" });
    expect(classifyXaiVideoJobError("permission_denied")).toEqual({ httpStatus: 403, code: "permission_denied" });
    expect(classifyXaiVideoJobError("failed_precondition")).toEqual({
      httpStatus: 422,
      code: "unsupported_request",
    });
    expect(classifyXaiVideoJobError("service_unavailable")).toEqual({
      httpStatus: 503,
      code: "upstream_unavailable",
    });
  });

  it("falls back to upstream_error for an unrecognized or missing code", () => {
    expect(classifyXaiVideoJobError("internal_error")).toEqual({ httpStatus: 502, code: "upstream_error" });
    expect(classifyXaiVideoJobError(undefined)).toEqual({ httpStatus: 502, code: "upstream_error" });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/generate-clip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const TINY_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const SECOND_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const THIRD_DATA_URL = "data:image/jpeg;base64,thirdplatebytes";

/** Drives the fake-timer clock forward one poll interval and lets any
 * pending microtasks (the mocked `fetch`'s resolved promise, the loop's
 * own `await`s) flush before returning \u2014 needed because
 * `vi.advanceTimersByTimeAsync` alone doesn't always flush a `fetch`
 * mock's real Promise microtask queue between iterations. */
async function advanceOnePoll() {
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
}

describe("POST /api/skidmarks/generate-clip", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("XAI_API_KEY", "test-key");
    vi.stubEnv("XAI_VIDEO_MODEL", "");
    putMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("reports the honest missing_api_key outcome and never calls fetch when XAI_API_KEY is unset", async () => {
    vi.stubEnv("XAI_API_KEY", "");

    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("XAI_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing prompt without calling fetch", async () => {
    const res = await POST(postRequest({ referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates `shotPrompt`'s length, not the full merged `prompt` \u2014 a short shot prompt plus a long auto-injected motion/footer text is not rejected", async () => {
    const shortShotPrompt = "Door, then keyhole, then Jack seated \u2014 continuous push-in.";
    const longMergedPrompt = shortShotPrompt + " " + "x".repeat(2500);
    expect(longMergedPrompt.length).toBeGreaterThan(2000);
    expect(shortShotPrompt.length).toBeLessThan(2000);

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-lock" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "done",
          video: { url: "https://vidgen.x.ai/lock.mp4", duration: 5, respect_moderation: true },
        })
      );

    const res = await POST(
      postRequest({
        prompt: longMergedPrompt,
        shotPrompt: shortShotPrompt,
        referenceImageDataUrls: [TINY_DATA_URL, SECOND_DATA_URL, THIRD_DATA_URL],
      })
    );

    expect(res.status).toBe(200);
    const [, startInit] = fetchMock.mock.calls[0];
    // The full merged prompt is still what's actually sent to xAI \u2014
    // only the *validation* is scoped to `shotPrompt`.
    expect(JSON.parse(startInit.body as string).prompt).toBe(longMergedPrompt);
  });

  it("still rejects a genuinely too-long shotPrompt", async () => {
    const tooLong = "x".repeat(2001);
    const res = await POST(postRequest({ prompt: tooLong, shotPrompt: tooLong, referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(body.error.toLowerCase()).toContain("shot prompt is too long");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to validating `prompt` itself when a caller omits `shotPrompt`", async () => {
    const tooLong = "x".repeat(2001);
    const res = await POST(postRequest({ prompt: tooLong, referenceImageDataUrls: [TINY_DATA_URL] }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects zero reference images \u2014 this route never does plain text-to-video", async () => {
    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [] }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(body.error.toLowerCase()).toContain("at least one plate still");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects more than 3 reference images", async () => {
    const res = await POST(
      postRequest({
        prompt: "slow zoom",
        referenceImageDataUrls: [TINY_DATA_URL, SECOND_DATA_URL, THIRD_DATA_URL, TINY_DATA_URL],
      })
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a reference image that isn't a data: URL", async () => {
    const res = await POST(
      postRequest({ prompt: "slow zoom", referenceImageDataUrls: ["https://example.com/a.jpg"] })
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts with an `image` object (image-to-video) for exactly one reference, and returns the video on the first poll", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-1" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "done",
          video: { url: "https://vidgen.x.ai/clip.mp4", duration: 5, respect_moderation: true },
        })
      );

    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 5 });

    const [startUrl, startInit] = fetchMock.mock.calls[0];
    expect(startUrl).toBe("https://api.x.ai/v1/videos/generations");
    const sentBody = JSON.parse(startInit.body as string);
    expect(sentBody.model).toBe("grok-imagine-video-1.5");
    expect(sentBody.duration).toBe(5);
    expect(sentBody.resolution).toBe("480p");
    expect(sentBody.image).toEqual({ url: TINY_DATA_URL });
    expect(sentBody.reference_images).toBeUndefined();

    const [pollUrl] = fetchMock.mock.calls[1];
    expect(pollUrl).toBe("https://api.x.ai/v1/videos/req-1");
  });

  it("starts with a `reference_images` array, in strip order, for two or more references", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-2" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "done",
          video: { url: "https://vidgen.x.ai/clip2.mp4", duration: 5, respect_moderation: true },
        })
      );

    await POST(
      postRequest({
        prompt: "continuous push-in zoom",
        referenceImageDataUrls: [TINY_DATA_URL, SECOND_DATA_URL, THIRD_DATA_URL],
      })
    );

    const [, startInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(startInit.body as string);
    expect(sentBody.image).toBeUndefined();
    expect(sentBody.reference_images).toEqual([
      { url: TINY_DATA_URL },
      { url: SECOND_DATA_URL },
      { url: THIRD_DATA_URL },
    ]);
  });

  it("honors an XAI_VIDEO_MODEL override without a code change", async () => {
    vi.stubEnv("XAI_VIDEO_MODEL", "grok-imagine-video");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-3" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { status: "done", video: { url: "https://vidgen.x.ai/c.mp4", duration: 5 } })
      );

    await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));

    const [, startInit] = fetchMock.mock.calls[0];
    expect(JSON.parse(startInit.body as string).model).toBe("grok-imagine-video");
  });

  it("surfaces a real xAI start-call failure's message and classified code verbatim", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: "Incorrect API key provided." } })
    );

    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe("auth_error");
    expect(body.error).toContain("Incorrect API key provided.");
  });

  it("reports a real network error from the start call honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("network_error");
    expect(body.error).toContain("Failed to fetch");
  });

  it("keeps polling across multiple pending responses before returning the finished video", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-4" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "pending" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "pending" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "done",
          video: { url: "https://vidgen.x.ai/final.mp4", duration: 5, respect_moderation: true },
        })
      );

    const resultPromise = POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));

    // Start call + first poll happen on microtask ticks with no real
    // delay; advancing time lets the loop's two `sleep(POLL_INTERVAL_MS)`
    // calls between the pending polls resolve.
    await advanceOnePoll();
    await advanceOnePoll();
    await advanceOnePoll();

    const res = await resultPromise;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ videoUrl: "https://vidgen.x.ai/final.mp4", durationSec: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reports a real job failure with its documented error.code mapped honestly", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-5" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "failed",
          error: { code: "invalid_argument", message: "Prompt cannot be empty." },
        })
      );

    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("invalid_request");
    expect(body.error).toContain("Prompt cannot be empty.");
  });

  it("reports an expired job honestly", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-6" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "expired" }));

    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(504);
    expect(body.code).toBe("expired");
  });

  it("reports a moderated (blocked) result honestly rather than a fake success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-7" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { status: "done", video: { url: "", respect_moderation: false } })
      );

    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("moderated");
  });

  it("gives up honestly once the poll deadline passes, without pretending the render finished", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { request_id: "req-8" }));
    // Every poll after the start call reports "pending" forever.
    fetchMock.mockResolvedValue(jsonResponse(200, { status: "pending" }));

    const resultPromise = POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));

    // POLL_DEADLINE_MS / POLL_INTERVAL_MS = 240000 / 4000 = 60 polls.
    // Advance well past that so the loop's own deadline check fires.
    for (let i = 0; i < 62; i++) {
      await advanceOnePoll();
    }

    const res = await resultPromise;
    const body = await res.json();

    expect(res.status).toBe(504);
    expect(body.code).toBe("timeout");
    expect(body.error.toLowerCase()).toContain("still processing");
  });

  describe("persisting a successful render to Vercel Blob", () => {
    function mockSuccessfulRender(videoUrl: string) {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-persist" }))
        .mockResolvedValueOnce(
          jsonResponse(200, { status: "done", video: { url: videoUrl, duration: 5, respect_moderation: true } })
        );
    }

    it("skips persistence entirely (same response shape as before this feature existed) when no segmentId is sent", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");

      const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
      const body = await res.json();

      expect(body).toEqual({ videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 5 });
      expect(putMock).not.toHaveBeenCalled();
      // Only the start + one poll call \u2014 no third fetch to re-download for persistence.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("re-downloads the finished render and uploads it to Blob under this clip's stable pathname, returning the durable URL", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      putMock.mockResolvedValueOnce({ url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/01_0000-0040_render.mp4" });

      const res = await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/01_0000-0040_render.mp4",
        durationSec: 5,
        persisted: true,
      });

      expect(putMock).toHaveBeenCalledTimes(1);
      const [pathname, , options] = putMock.mock.calls[0];
      expect(pathname).toBe("skidmarks/clip-renders/seg-1/01_0000-0040_render.mp4");
      expect(options).toMatchObject({
        access: "public",
        contentType: "video/mp4",
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      // The re-download hit xAI's own temporary URL, not the Blob one.
      const [redownloadUrl] = fetchMock.mock.calls[2];
      expect(redownloadUrl).toBe("https://vidgen.x.ai/clip.mp4");
    });

    it("still returns the render (xAI's temporary URL), honestly flagged as unsaved, when Blob upload itself fails", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      putMock.mockRejectedValueOnce(new Error("Vercel Blob: No token found."));

      const res = await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.videoUrl).toBe("https://vidgen.x.ai/clip.mp4");
      expect(body.durationSec).toBe(5);
      expect(body.persisted).toBe(false);
      expect(body.persistError).toContain("Vercel Blob: No token found.");
    });

    it("still returns the render, honestly flagged as unsaved, when re-downloading the finished video itself fails", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }));

      const res = await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.videoUrl).toBe("https://vidgen.x.ai/clip.mp4");
      expect(body.persisted).toBe(false);
      expect(body.persistError.toLowerCase()).toContain("502");
      expect(putMock).not.toHaveBeenCalled();
    });

    it("skips persistence when the given persistence fields are malformed, without failing the whole request", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");

      const res = await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "../not/safe",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 5 });
      expect(putMock).not.toHaveBeenCalled();
    });
  });
});

describe("resolvePersistenceTarget", () => {
  it("returns a normalized target when all four fields are valid", () => {
    expect(resolvePersistenceTarget({ segmentId: "seg-1", clipIndex: 1.6, startSec: 0.4, endSec: 39.6 })).toEqual({
      segmentId: "seg-1",
      clipIndex: 2,
      startSec: 0,
      endSec: 40,
    });
  });

  it("returns null when segmentId is missing, empty, or unsafe", () => {
    expect(resolvePersistenceTarget({ clipIndex: 1, startSec: 0, endSec: 40 })).toBeNull();
    expect(resolvePersistenceTarget({ segmentId: "", clipIndex: 1, startSec: 0, endSec: 40 })).toBeNull();
    expect(resolvePersistenceTarget({ segmentId: "../etc", clipIndex: 1, startSec: 0, endSec: 40 })).toBeNull();
  });

  it("returns null when clipIndex/startSec/endSec are missing, non-numeric, or negative", () => {
    expect(resolvePersistenceTarget({ segmentId: "seg-1", startSec: 0, endSec: 40 })).toBeNull();
    expect(resolvePersistenceTarget({ segmentId: "seg-1", clipIndex: "1", startSec: 0, endSec: 40 })).toBeNull();
    expect(resolvePersistenceTarget({ segmentId: "seg-1", clipIndex: -1, startSec: 0, endSec: 40 })).toBeNull();
    expect(resolvePersistenceTarget({ segmentId: "seg-1", clipIndex: 1, startSec: -5, endSec: 40 })).toBeNull();
  });
});
