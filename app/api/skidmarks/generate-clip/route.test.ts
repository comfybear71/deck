import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";

const putMock = vi.fn();
const listMock = vi.fn();
const delMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  list: (...args: unknown[]) => listMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}));

import {
  classifyXaiVideoHttpFailure,
  classifyXaiVideoJobError,
  extractXaiErrorMessage,
  POLL_INTERVAL_MS,
  POST,
  resolvePersistenceTarget,
} from "./route";

/** Same real-encoder fixture helper as `lib/mp3Slice.test.ts` \u2014
 * duplicated rather than imported across test files (this repo's test
 * files don't share helpers today), so the Vocal/Comfy-LTX route tests
 * below exercise a real MP3 the same way `sliceMp3ToTimeRange` itself
 * is tested. */
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
    listMock.mockReset();
    delMock.mockReset();
    // Default: nothing else already sitting under this plate's prefix —
    // most tests don't care about the prune step at all.
    listMock.mockResolvedValue({ blobs: [] });
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

    it("re-downloads the finished render and uploads it to Blob under this plate's stable pathname, returning the durable URL", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
      });

      const res = await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          plateId: "plate-1",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
        durationSec: 5,
        persisted: true,
      });

      expect(putMock).toHaveBeenCalledTimes(1);
      const [pathname, , options] = putMock.mock.calls[0];
      expect(pathname).toBe("skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4");
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

    it("letters the pathname's basename when the client reports more than one plate on this clip", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-2/01b_0000-0040_render.mp4",
      });

      await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          plateId: "plate-2",
          plateIndex: 1,
          plateCount: 3,
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );

      const [pathname] = putMock.mock.calls[0];
      expect(pathname).toBe("skidmarks/clip-renders/seg-1/plate-2/01b_0000-0040_render.mp4");
    });

    it("forwards a real, clamped durationSec to xAI's own `duration` parameter", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");

      await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          durationSec: 13,
        })
      );

      const [, startInit] = fetchMock.mock.calls[0];
      expect(JSON.parse(startInit.body as string).duration).toBe(13);
    });

    it("clamps an out-of-range durationSec into [MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC]", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");

      await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          durationSec: 999,
        })
      );

      const [, startInit] = fetchMock.mock.calls[0];
      expect(JSON.parse(startInit.body as string).duration).toBe(15);
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
          plateId: "plate-1",
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
          plateId: "plate-1",
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
          plateId: "plate-1",
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

    it("prunes every other blob already sitting under this plate's own prefix after a successful save, keeping only the one just written", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/02_0040-0080_render.mp4",
      });
      // A stale take left under a *different* filename \u2014 the live-QA'd
      // gap: the timeline reordered between two renders of "the same"
      // plate, so `clipIndex` (and therefore the pathname) drifted.
      listMock.mockResolvedValueOnce({
        blobs: [
          { pathname: "skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4", url: "https://x/stale.mp4" },
          { pathname: "skidmarks/clip-renders/seg-1/plate-1/02_0040-0080_render.mp4", url: "https://x/fresh.mp4" },
        ],
      });

      await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          plateId: "plate-1",
          clipIndex: 2,
          startSec: 40,
          endSec: 80,
        })
      );

      expect(listMock).toHaveBeenCalledWith({ prefix: "skidmarks/clip-renders/seg-1/plate-1/" });
      expect(delMock).toHaveBeenCalledTimes(1);
      expect(delMock).toHaveBeenCalledWith(["skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4"]);
    });

    it("never deletes the blob it just wrote, and skips del() entirely when nothing else is stale", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
      });
      listMock.mockResolvedValueOnce({
        blobs: [
          { pathname: "skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4", url: "https://x/fresh.mp4" },
        ],
      });

      await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          plateId: "plate-1",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );

      expect(delMock).not.toHaveBeenCalled();
    });

    it("still returns the successfully persisted render even when the prune step itself fails", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
      });
      listMock.mockRejectedValueOnce(new Error("Vercel Blob: list() failed."));

      const res = await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          plateId: "plate-1",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.persisted).toBe(true);
      expect(body.videoUrl).toBe(
        "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4"
      );
    });

    it("reports an honest persistError \u2014 never a silently-broken URL \u2014 when the just-written Blob URL fails its post-put HEAD verify", async () => {
      // The live-QA'd bug: `put()` resolved, but the returned URL wasn't
      // actually reachable (a stale 404, a since-pruned path) \u2014 this
      // must never come back as `persisted: true` with a dead URL wired
      // into the shelf.
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 })); // HEAD verify fails
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-2/01b_0000-0040_render.mp4",
      });

      const res = await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          plateId: "plate-2",
          plateIndex: 1,
          plateCount: 3,
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      // Still the render Stuart already paid for (xAI's own temporary
      // URL) \u2014 never discarded over a save-verification problem.
      expect(body.videoUrl).toBe("https://vidgen.x.ai/clip.mp4");
      expect(body.persisted).toBe(false);
      expect(body.persistError).toContain("404");
      // Never prunes/deletes anything on a failed verify \u2014 the write
      // itself already happened; only the "was it a success" call is
      // what failed.
      expect(listMock).not.toHaveBeenCalled();
      expect(delMock).not.toHaveBeenCalled();
    });

    it("reports an honest persistError when the post-put HEAD verify itself errors (network failure)", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")); // HEAD verify network error
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
      });

      const res = await POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          plateId: "plate-1",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.persisted).toBe(false);
      expect(body.persistError).toContain("Failed to fetch");
    });

    it("skips persistence when plateId is missing, even if segmentId/clipIndex/startSec/endSec are all valid", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");

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
      expect(body).toEqual({ videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 5 });
      expect(putMock).not.toHaveBeenCalled();
    });
  });
});

describe("resolvePersistenceTarget", () => {
  it("returns a normalized target when segmentId/plateId/clipIndex/startSec/endSec are all valid", () => {
    expect(
      resolvePersistenceTarget({
        segmentId: "seg-1",
        plateId: "plate-1",
        clipIndex: 1.6,
        startSec: 0.4,
        endSec: 39.6,
      })
    ).toEqual({
      segmentId: "seg-1",
      plateId: "plate-1",
      clipIndex: 2,
      startSec: 0,
      endSec: 40,
      plateLetterIndex: undefined,
    });
  });

  it("sets plateLetterIndex only when plateIndex/plateCount are both given and plateCount > 1", () => {
    expect(
      resolvePersistenceTarget({
        segmentId: "seg-1",
        plateId: "plate-2",
        clipIndex: 1,
        startSec: 0,
        endSec: 40,
        plateIndex: 1,
        plateCount: 3,
      })
    ).toMatchObject({ plateLetterIndex: 1 });

    expect(
      resolvePersistenceTarget({
        segmentId: "seg-1",
        plateId: "plate-1",
        clipIndex: 1,
        startSec: 0,
        endSec: 40,
        plateIndex: 0,
        plateCount: 1,
      })
    ).toMatchObject({ plateLetterIndex: undefined });
  });

  it("returns null when segmentId is missing, empty, or unsafe", () => {
    expect(resolvePersistenceTarget({ plateId: "plate-1", clipIndex: 1, startSec: 0, endSec: 40 })).toBeNull();
    expect(
      resolvePersistenceTarget({ segmentId: "", plateId: "plate-1", clipIndex: 1, startSec: 0, endSec: 40 })
    ).toBeNull();
    expect(
      resolvePersistenceTarget({ segmentId: "../etc", plateId: "plate-1", clipIndex: 1, startSec: 0, endSec: 40 })
    ).toBeNull();
  });

  it("returns null when plateId is missing, empty, or unsafe", () => {
    expect(resolvePersistenceTarget({ segmentId: "seg-1", clipIndex: 1, startSec: 0, endSec: 40 })).toBeNull();
    expect(
      resolvePersistenceTarget({ segmentId: "seg-1", plateId: "", clipIndex: 1, startSec: 0, endSec: 40 })
    ).toBeNull();
    expect(
      resolvePersistenceTarget({ segmentId: "seg-1", plateId: "../etc", clipIndex: 1, startSec: 0, endSec: 40 })
    ).toBeNull();
  });

  it("returns null when clipIndex/startSec/endSec are missing, non-numeric, or negative", () => {
    expect(resolvePersistenceTarget({ segmentId: "seg-1", plateId: "plate-1", startSec: 0, endSec: 40 })).toBeNull();
    expect(
      resolvePersistenceTarget({ segmentId: "seg-1", plateId: "plate-1", clipIndex: "1", startSec: 0, endSec: 40 })
    ).toBeNull();
    expect(
      resolvePersistenceTarget({ segmentId: "seg-1", plateId: "plate-1", clipIndex: -1, startSec: 0, endSec: 40 })
    ).toBeNull();
    expect(
      resolvePersistenceTarget({ segmentId: "seg-1", plateId: "plate-1", clipIndex: 1, startSec: -5, endSec: 40 })
    ).toBeNull();
  });
});

/** A fake `MinimalWebSocket` (`lib/comfyCloud.ts`) driven directly by
 * these tests \u2014 same shape/spirit as `lib/comfyCloud.test.ts`'s own
 * `FakeWebSocket`, duplicated here since the route calls
 * `waitForComfyCloudCompletion` with its default (global `WebSocket`)
 * constructor, which these tests stub globally rather than injecting a
 * test double through the route's own (non-existent) extra parameter. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
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

describe("POST /api/skidmarks/generate-clip \u2014 Vocal (Comfy Cloud LTX) render path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    vi.stubEnv("COMFY_CLOUD_API_KEY", "test-comfy-key");
    vi.stubEnv("COMFY_URL", "");
    FakeWebSocket.instances = [];
    putMock.mockReset();
    listMock.mockReset();
    delMock.mockReset();
    listMock.mockResolvedValue({ blobs: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function vocalRequest(overrides: Record<string, unknown> = {}): Request {
    return postRequest({
      vocal: true,
      prompt: "singing directly to camera, slow push in",
      shotPrompt: "singing directly to camera, slow push in",
      referenceImageDataUrls: [TINY_DATA_URL],
      durationSec: 10,
      mp3AudioUrl: "https://blob.vercel-storage.com/skidmarks/mp3-audio/song.mp3",
      audioStartSec: 0,
      audioEndSec: 5,
      segmentId: "seg-1",
      plateId: "plate-1",
      clipIndex: 1,
      startSec: 0,
      endSec: 5,
      ...overrides,
    });
  }

  it("reports the honest missing_api_key outcome and never calls fetch when COMFY_CLOUD_API_KEY is unset", async () => {
    vi.stubEnv("COMFY_CLOUD_API_KEY", "");
    const res = await POST(vocalRequest());
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("COMFY_CLOUD_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a Vocal request that doesn't send exactly one reference image", async () => {
    const res = await POST(
      vocalRequest({ referenceImageDataUrls: [TINY_DATA_URL, SECOND_DATA_URL] })
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.toLowerCase()).toContain("exactly one plate still");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing_audio_url honestly when mp3AudioUrl is blank \u2014 never a fake success", async () => {
    const res = await POST(vocalRequest({ mp3AudioUrl: "" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("missing_audio_url");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing/invalid audioStartSec/audioEndSec", async () => {
    const res = await POST(vocalRequest({ audioStartSec: 5, audioEndSec: 5 }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.toLowerCase()).toContain("audiostartsec/audioendsec");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a real fetch failure honestly when the attached song's audio can't be downloaded", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await POST(vocalRequest());
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toContain("404");
  });

  it("reports an honest slice failure for audio bytes that aren't a real MP3, never a fake success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
    const res = await POST(vocalRequest());
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.code).toBe("invalid_audio");
    expect(body.error).toContain("Could not find any valid MP3");
  });

  function mockAudioFetch(mp3Bytes: Uint8Array) {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(mp3Bytes), { status: 200 }));
  }
  function mockUploads(imageName = "plate.png", audioName = "clip.mp3") {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: imageName, subfolder: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: audioName, subfolder: "" }), { status: 200 }));
  }
  function mockSubmit(promptId = "job-1") {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: promptId }), { status: 200 }));
  }
  function mockDownload(videoBytes: Uint8Array) {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://storage.example.com/signed/clip.mp4" } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(videoBytes), { status: 200 }));
  }

  it("runs the full real pipeline end to end and persists the result to Vercel Blob", async () => {
    const mp3Bytes = encodeTestMp3(6);
    const videoBytes = new Uint8Array([1, 2, 3, 4, 5]);

    mockAudioFetch(mp3Bytes);
    mockUploads();
    mockSubmit("job-1");
    mockDownload(videoBytes);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({
      url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0005_render.mp4",
    });

    const resultPromise = POST(vocalRequest());
    // Let the fetch-driven steps (audio fetch, both uploads, submit) run
    // before the WebSocket exists to drive to completion.
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toContain("wss://cloud.comfy.org/ws");
    expect(ws.url).toContain("token=test-comfy-key");
    ws.emit("executed", { prompt_id: "job-1", node: "4", output: { video: [{ filename: "out.mp4" }] } });
    ws.emit("execution_success", { prompt_id: "job-1" });

    const res = await resultPromise;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.videoUrl).toBe(
      "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0005_render.mp4"
    );
    // Frame-aligned actual duration (see `lib/mp3Slice.ts`) rounds
    // outward to the nearest real MP3 frame boundary \u2014 never exactly
    // the requested 5s, but always close to it.
    expect(body.durationSec).toBeGreaterThanOrEqual(5);
    expect(body.durationSec).toBeLessThan(5.1);
    expect(body.persisted).toBe(true);

    // The workflow submitted to Comfy Cloud names both uploaded files
    // and forwards the partner-node api key.
    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    const submittedBody = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body as string);
    expect(submittedBody.prompt["1"].inputs.image).toBe("plate.png");
    expect(submittedBody.prompt["2"].inputs.audio).toBe("clip.mp3");
    expect(submittedBody.prompt["3"].inputs.model).toBe("LTX-2.5 (Fast)");
    expect(submittedBody.extra_data.api_key_comfy_org).toBe("test-comfy-key");
  });

  it("falls back to a data: URL (never silently drops a paid render) when no persistence target is given", async () => {
    const mp3Bytes = encodeTestMp3(6);
    const videoBytes = new Uint8Array([9, 9, 9]);

    mockAudioFetch(mp3Bytes);
    mockUploads();
    mockSubmit("job-2");
    mockDownload(videoBytes);

    const resultPromise = POST(
      postRequest({
        vocal: true,
        prompt: "x",
        referenceImageDataUrls: [TINY_DATA_URL],
        durationSec: 5,
        mp3AudioUrl: "https://blob.vercel-storage.com/song.mp3",
        audioStartSec: 0,
        audioEndSec: 5,
      })
    );
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    const ws = FakeWebSocket.instances[0];
    ws.emit("executed", { prompt_id: "job-2", node: "4", output: { video: [{ filename: "out.mp4" }] } });
    ws.emit("execution_success", { prompt_id: "job-2" });

    const res = await resultPromise;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.videoUrl.startsWith("data:video/mp4;base64,")).toBe(true);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("still returns the render (as a data: URL), honestly flagged unsaved, when Blob persistence fails", async () => {
    const mp3Bytes = encodeTestMp3(6);
    const videoBytes = new Uint8Array([7, 7, 7]);

    mockAudioFetch(mp3Bytes);
    mockUploads();
    mockSubmit("job-3");
    mockDownload(videoBytes);
    putMock.mockRejectedValueOnce(new Error("Vercel Blob: No token found."));

    const resultPromise = POST(vocalRequest());
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    const ws = FakeWebSocket.instances[0];
    ws.emit("executed", { prompt_id: "job-3", node: "4", output: { video: [{ filename: "out.mp4" }] } });
    ws.emit("execution_success", { prompt_id: "job-3" });

    const res = await resultPromise;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persisted).toBe(false);
    expect(body.persistError).toContain("Vercel Blob: No token found.");
    expect(body.videoUrl.startsWith("data:video/mp4;base64,")).toBe(true);
  });

  it("surfaces a real Comfy Cloud submit failure verbatim", async () => {
    const mp3Bytes = encodeTestMp3(6);
    mockAudioFetch(mp3Bytes);
    mockUploads();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Invalid node graph" }), { status: 200 }));

    const res = await POST(vocalRequest());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("invalid_request");
    expect(body.error).toContain("Invalid node graph");
  });

  it("surfaces a real Comfy Cloud execution_error verbatim", async () => {
    const mp3Bytes = encodeTestMp3(6);
    mockAudioFetch(mp3Bytes);
    mockUploads();
    mockSubmit("job-4");

    const resultPromise = POST(vocalRequest());
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    const ws = FakeWebSocket.instances[0];
    ws.emit("execution_error", { prompt_id: "job-4", exception_message: "OOMError" });

    const res = await resultPromise;
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain("OOMError");
  });

  it("always submits the hardcoded default LTX model \u2014 no env override (not a confirmed Comfy key name)", async () => {
    const mp3Bytes = encodeTestMp3(6);
    mockAudioFetch(mp3Bytes);
    mockUploads();
    mockSubmit("job-5");
    mockDownload(new Uint8Array([1]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({ url: "https://abc.public.blob.vercel-storage.com/x.mp4" });

    const resultPromise = POST(vocalRequest());
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    const ws = FakeWebSocket.instances[0];
    ws.emit("executed", { prompt_id: "job-5", node: "4", output: { video: [{ filename: "out.mp4" }] } });
    ws.emit("execution_success", { prompt_id: "job-5" });
    await resultPromise;

    const submitCallIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    const submittedBody = JSON.parse(fetchMock.mock.calls[submitCallIndex][1].body as string);
    expect(submittedBody.prompt["3"].inputs.model).toBe("LTX-2.5 (Fast)");
  });
});
