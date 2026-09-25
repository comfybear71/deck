import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";
import LTX_23_IA2V_TEMPLATE from "@/workflow/LTX_2.3_IA2V_Cloud.json";
import { COMFY_CLOUD_POLL_INTERVAL_MS } from "@/lib/comfyCloud";

const putMock = vi.fn();
const listMock = vi.fn();
const delMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  list: (...args: unknown[]) => listMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}));

// `letterboxImageForLtxIa2v` (`lib/comfyCloud.ts`) calls real `sharp` on
// the Vocal path. Real finding, not just a test nicety: `sharp`'s
// native async completion never fires under `vi.useFakeTimers()` (this
// file uses it heavily to skip real poll-interval waits) — it hangs
// indefinitely, and even `letterboxImageForLtxIa2v`'s own timeout can't
// rescue it, since that timeout is *also* a `setTimeout` frozen by the
// same fake clock. `lib/comfyCloud.test.ts` already covers
// `letterboxImageForLtxIa2v` itself against real `sharp`, with no fake
// timers involved — this file only cares about the route's own
// behavior (polling, uploads, persistence), so a fast fake stands in
// here instead. Reports the frame already at the target size, so every
// existing test's plate takes the early-return "no change needed" path
// with no resize.
vi.mock("sharp", () => ({
  default: () => ({
    metadata: () => Promise.resolve({ width: 1280, height: 720 }),
    rotate: function (this: unknown) {
      return this;
    },
    resize: function (this: unknown) {
      return this;
    },
    jpeg: function (this: unknown) {
      return this;
    },
    toBuffer: () => Promise.resolve(Buffer.from([1, 2, 3])),
  }),
}));

vi.mock("@/lib/videoFrame16x9", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/videoFrame16x9")>();
  return { ...actual, padFrameTo16x9: vi.fn(actual.padFrameTo16x9) };
});

import { padFrameTo16x9 } from "@/lib/videoFrame16x9";
import {
  classifyXaiVideoHttpFailure,
  classifyXaiVideoJobError,
  extractXaiErrorMessage,
  MAX_LTX_CLIP_DURATION_SEC,
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

// A real, tiny, fast-to-decode 1x1 PNG — not just JPEG-header-shaped
// bytes. `letterboxImageForLtxIa2v` (`lib/comfyCloud.ts`) now runs a
// real `sharp` decode on the Vocal path's reference image, and a
// genuinely malformed/truncated image can make that decode hang rather
// than reject quickly (a real finding, not just a test nicety — see
// that function's own timeout). Real, valid bytes keep every test in
// this file fast and deterministic regardless.
const TINY_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
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

/** The post-put Blob verify HEAD's own retry delays (route.ts's
 * `VERIFY_RETRY_DELAYS_MS`, not exported \u2014 kept in sync by hand here,
 * same "restate the constant" convention this suite already uses for
 * `POLL_INTERVAL_MS`-adjacent values). 8 attempts total, ~35s of real
 * delay between them if every one fails \u2014 drives fake timers through
 * every gap so a test exercising a persistent verify failure/success
 * doesn't actually wait that out. */
const VERIFY_RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 8000, 8000, 8000];

async function advanceAllVerifyRetries() {
  for (const delay of VERIFY_RETRY_DELAYS_MS) {
    await vi.advanceTimersByTimeAsync(delay);
  }
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

  it("rejects a reference image that isn't a data: or http(s) URL", async () => {
    const res = await POST(
      postRequest({ prompt: "slow zoom", referenceImageDataUrls: ["blob:https://example.com/a"] })
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an https Blob photo URL as a reference image (clip-1 upload path)", async () => {
    // https refs are downloaded and inlined as data: before xAI sees them
    // (Chain last→first / Blob stills — avoid image_fetch_http_error 404).
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    fetchMock
      .mockResolvedValueOnce(
        new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg" } })
      )
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-https-ref" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "done",
          video: { url: "https://vidgen.x.ai/clip-https.mp4", duration: 5, respect_moderation: true },
        })
      );

    const httpsStill = "https://blob.example/skidmarks/clip1-start.jpg";
    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [httpsStill] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.videoUrl).toBe("https://vidgen.x.ai/clip-https.mp4");

    expect(String(fetchMock.mock.calls[0][0])).toBe(httpsStill);
    const [, startInit] = fetchMock.mock.calls[1];
    const sentBody = JSON.parse(startInit.body as string);
    expect(sentBody.image.url).toMatch(/^data:image\/jpeg;base64,/);
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
    expect(sentBody.aspect_ratio).toBe("16:9");
    expect(sentBody.image).toEqual({ url: TINY_DATA_URL });
    expect(sentBody.reference_images).toBeUndefined();

    const [pollUrl] = fetchMock.mock.calls[1];
    expect(pollUrl).toBe("https://api.x.ai/v1/videos/req-1");
  });

  it("FORCED 16:9: sends the padded 16:9 frame (not the square original) plus aspect_ratio 16:9", async () => {
    // Real padding is covered in lib/videoFrame16x9.test.ts (sharp is faked here).
    vi.mocked(padFrameTo16x9).mockResolvedValueOnce({
      bytes: new Uint8Array([7, 7, 7]),
      mimeType: "image/jpeg",
      padded: true,
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-sq" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { status: "done", video: { url: "https://vidgen.x.ai/sq.mp4", duration: 5, respect_moderation: true } })
      );

    const res = await POST(postRequest({ prompt: "slow zoom", referenceImageDataUrls: [TINY_DATA_URL] }));
    expect(res.status).toBe(200);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.aspect_ratio).toBe("16:9");
    expect(sentBody.image).toEqual({ url: `data:image/jpeg;base64,${Buffer.from([7, 7, 7]).toString("base64")}` });
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

    it("reports an honest persistError \u2014 never a silently-broken URL \u2014 when every post-put HEAD verify attempt is a real failure (not propagation lag)", async () => {
      // The live-QA'd bug: `put()` resolved, but the returned URL wasn't
      // actually reachable \u2014 this must never come back as
      // `persisted: true` with a dead URL wired into the shelf. A real
      // failure (a non-404 status) on every attempt is the case that
      // must still report persistError \u2014 see the sibling "clean 404"
      // test below for the one now-trusted case this is *not*.
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockResolvedValue(new Response(null, { status: 500 })); // every HEAD verify attempt fails, and not with a 404
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-2/01b_0000-0040_render.mp4",
      });

      vi.useFakeTimers();
      const resultPromise = POST(
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
      await advanceAllVerifyRetries();
      const res = await resultPromise;
      vi.useRealTimers();
      const body = await res.json();

      expect(res.status).toBe(200);
      // Still the render Stuart already paid for (xAI's own temporary
      // URL) \u2014 never discarded over a save-verification problem.
      expect(body.videoUrl).toBe("https://vidgen.x.ai/clip.mp4");
      expect(body.persisted).toBe(false);
      expect(body.persistError).toContain("500");
      // Never prunes/deletes anything on a failed verify \u2014 the write
      // itself already happened; only the "was it a success" call is
      // what failed.
      expect(listMock).not.toHaveBeenCalled();
      expect(delMock).not.toHaveBeenCalled();
    });

    it("trusts a successful put() and reports persisted: true when every HEAD verify attempt is a clean 404 (propagation lag, not a missing file)", async () => {
      // 2026-09-14 live bug, second pass: Stuart paid for a real render
      // twice that this route then discarded, because Vercel Blob's own
      // propagation window sometimes outlasts even a long retry
      // schedule. put() succeeding is trusted as the real signal once
      // every failed verify attempt is specifically a 404 \u2014 never on a
      // different status or a thrown error (see the sibling "real
      // failure" test above).
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockResolvedValue(new Response(null, { status: 404 })); // every HEAD verify attempt \u2014 clean propagation-lag 404s only
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-3/01c_0000-0040_render.mp4",
      });

      vi.useFakeTimers();
      const resultPromise = POST(
        postRequest({
          prompt: "slow zoom",
          referenceImageDataUrls: [TINY_DATA_URL],
          segmentId: "seg-1",
          plateId: "plate-3",
          plateIndex: 2,
          plateCount: 3,
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        })
      );
      await advanceAllVerifyRetries();
      const res = await resultPromise;
      vi.useRealTimers();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.persisted).toBe(true);
      expect(body.videoUrl).toBe(
        "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-3/01c_0000-0040_render.mp4"
      );
    });

    it("reports an honest persistError when the post-put HEAD verify itself errors on every attempt (network failure)", async () => {
      mockSuccessfulRender("https://vidgen.x.ai/clip.mp4");
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch")); // every HEAD verify attempt \u2014 a real network error
      putMock.mockResolvedValueOnce({
        url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
      });

      vi.useFakeTimers();
      const resultPromise = POST(
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
      await advanceAllVerifyRetries();
      const res = await resultPromise;
      vi.useRealTimers();
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
describe("POST /api/skidmarks/generate-clip — Vocal (Comfy Cloud LTX 2.3) render path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("COMFY_CLOUD_API_KEY", "test-comfy-key");
    vi.stubEnv("COMFY_URL", "");
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

  it("reports missing_audio_url honestly when mp3AudioUrl is blank — never a fake success", async () => {
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
  /** Mocks `GET /api/jobs/{promptId}` (plural). `SaveVideo` serialises
   * through `PreviewVideo.as_dict()`, which emits its files under
   * **`images`**, not `video` — so that's the shape mocked here. */
  function mockJobPoll(body: Record<string, unknown> = {
    status: "completed",
    outputs: { "341": { images: [{ filename: "out.mp4", subfolder: "video", type: "output" }] } },
  }) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  }
  function mockDownload(videoBytes: Uint8Array) {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://storage.example.com/signed/clip.mp4" } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(videoBytes), { status: 200 }));
  }

  /** The one submitted graph, parsed back off the `POST /api/prompt`
   * call this test made. */
  function submittedGraph(): Record<string, { inputs: Record<string, unknown> }> {
    const i = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    expect(i).toBeGreaterThanOrEqual(0);
    return JSON.parse(fetchMock.mock.calls[i][1].body as string).prompt;
  }

  it("accepts an https Blob plate still on the Vocal/LTX path (not only data:)", async () => {
    const mp3Bytes = encodeTestMp3(6);
    const videoBytes = new Uint8Array([9, 8, 7]);
    const httpsStill = "https://blob.example/skidmarks/vocal-plate.jpg";
    // Tiny valid-looking JPEG header bytes so letterbox/sharp has something to chew.
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    mockAudioFetch(mp3Bytes);
    fetchMock.mockResolvedValueOnce(
      new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg" } })
    );
    mockUploads("https-plate.jpg", "clip.mp3");
    mockSubmit("job-https-plate");
    mockJobPoll();
    mockDownload(videoBytes);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({
      url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0005_render.mp4",
    });

    const res = await POST(vocalRequest({ referenceImageDataUrls: [httpsStill] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persisted).toBe(true);
    // The https still was fetched (not rejected as "must be a data:image URL").
    const fetchedStill = fetchMock.mock.calls.some(([url]) => String(url) === httpsStill);
    expect(fetchedStill).toBe(true);
    const graph = submittedGraph();
    expect(graph["269"].inputs.image).toBe("https-plate.jpg");
  });

  it("runs the full real pipeline end to end and persists the result to Vercel Blob", async () => {
    const mp3Bytes = encodeTestMp3(6);
    const videoBytes = new Uint8Array([1, 2, 3, 4, 5]);

    mockAudioFetch(mp3Bytes);
    mockUploads();
    mockSubmit("job-1");
    mockJobPoll();
    mockDownload(videoBytes);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({
      url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0005_render.mp4",
    });

    const res = await POST(vocalRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.videoUrl).toBe(
      "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0005_render.mp4"
    );
    // Frame-aligned actual duration (see `lib/mp3Slice.ts`) rounds
    // outward to the nearest real MP3 frame boundary — never exactly
    // the requested 5s, but always close to it.
    expect(body.durationSec).toBeGreaterThanOrEqual(5);
    expect(body.durationSec).toBeLessThan(5.1);
    expect(body.persisted).toBe(true);

    // The submitted graph is the LTX 2.3 template with this render's
    // own five patched inputs — both uploaded filenames, the prompt,
    // the real sliced duration, and the save prefix.
    const graph = submittedGraph();
    expect(graph["269"].inputs.image).toBe("plate.png");
    expect(graph["276"].inputs.audio).toBe("clip.mp3");
    expect(graph["340:319"].inputs.value).toBe("singing directly to camera, slow push in");
    expect(graph["340:331"].inputs.value).toBe(body.durationSec);
    expect(graph["341"].inputs.filename_prefix).toBe("video/skidmarks_ltx");
  });

  it("polls GET /api/jobs/{promptId} — plural, never /api/history/{id} — and opens no WebSocket", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads();
    mockSubmit("job-poll");
    mockJobPoll({ status: "pending" });
    mockJobPoll({ status: "running" });
    mockJobPoll();
    mockDownload(new Uint8Array([1]));

    // Fake timers so the two real 2.5s gaps between polls don't make
    // this test wait them out for real.
    vi.useFakeTimers();
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
    await vi.advanceTimersByTimeAsync(COMFY_CLOUD_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(COMFY_CLOUD_POLL_INTERVAL_MS);
    const res = await resultPromise;
    vi.useRealTimers();
    expect(res.status).toBe(200);

    const polls = fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/api/jobs/"));
    expect(polls.length).toBe(3);
    expect(polls[0]).toBe("https://cloud.comfy.org/api/jobs/job-poll");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/history/"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("ws"))).toBe(false);
  });

  it("submits a body of just { prompt } — no extra_data.api_key_comfy_org, and no partner node in the graph", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads();
    mockSubmit("job-shape");
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({ url: "https://abc.public.blob.vercel-storage.com/x.mp4" });

    await POST(vocalRequest());

    const i = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/api/prompt"));
    const rawBody = fetchMock.mock.calls[i][1].body as string;
    expect(Object.keys(JSON.parse(rawBody))).toEqual(["prompt"]);
    expect(rawBody).not.toContain("api_key_comfy_org");
    expect(rawBody).not.toContain("LtxApi25AudioToVideo");
    expect(rawBody).not.toContain("model.resolution");
  });

  it("submits the verified template unchanged apart from the patched nodes", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads("only-plate.png", "only-clip.mp3");
    mockSubmit("job-template");
    mockJobPoll();
    mockDownload(new Uint8Array([1]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({ url: "https://abc.public.blob.vercel-storage.com/x.mp4" });

    await POST(vocalRequest());

    const graph = submittedGraph();
    const template = LTX_23_IA2V_TEMPLATE as unknown as Record<string, unknown>;
    expect(Object.keys(graph).sort()).toEqual(Object.keys(template).sort());
    const differing = Object.keys(template).filter(
      (id) => JSON.stringify(graph[id]) !== JSON.stringify(template[id])
    );
    expect(differing.sort()).toEqual([
      "269",
      "276",
      "340:285",
      "340:286",
      "340:296",
      "340:319",
      "340:331",
      "340:349",
      "341",
    ]);
    // Prompt enhancer forced off, every render.
    expect((graph["340:349"] as { inputs: { value: boolean } }).inputs.value).toBe(false);
  });

  it("real-world regression: a plate requested at exactly MAX_LTX_CLIP_DURATION_SEC never fails with an \"audio slice is Ns\" error", async () => {
    // Stuart's exact live-QA repro shape: a plate's audio window is
    // clamped by the caller to exactly the product ceiling (previously
    // 20s — the bug — now MAX_LTX_CLIP_DURATION_SEC, 15s). Frame-aligned
    // outward rounding (`lib/mp3Slice.ts`) must never push the *actual*
    // slice back over that same ceiling and trip a spurious rejection.
    const mp3Bytes = encodeTestMp3(45, 44100, 128);

    mockAudioFetch(mp3Bytes);
    mockUploads("plate.png", "clip-boundary.mp3");
    mockSubmit("job-boundary");
    mockJobPoll();
    mockDownload(new Uint8Array([1, 2, 3]));
    // This test is about duration clamping, not persistence — a real
    // HEAD-verify success on the first attempt keeps it from tripping
    // the (unrelated) verify-retry path, which an unconfigured putMock
    // would otherwise send into its full ~35s retry schedule.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({ url: "https://abc.public.blob.vercel-storage.com/boundary.mp4" });

    const res = await POST(
      vocalRequest({
        durationSec: MAX_LTX_CLIP_DURATION_SEC,
        audioStartSec: 5,
        audioEndSec: 5 + MAX_LTX_CLIP_DURATION_SEC,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).toBeUndefined();
    expect(body.durationSec).toBeLessThanOrEqual(MAX_LTX_CLIP_DURATION_SEC);
    // Duration is an ordinary graph input on LTX 2.3 — it reaches the
    // graph untouched, with no hosted-node 20s cap in the way.
    expect(submittedGraph()["340:331"].inputs.value).toBe(body.durationSec);
    expect(body.durationSec).toBeGreaterThan(MAX_LTX_CLIP_DURATION_SEC - 1);
  });

  it("clamps a raw segment/plateCount duration well past the ceiling instead of ever sending/erroring past it", async () => {
    // Mirrors what `lib/clipGeneration.ts`'s `computeLtxPlateDurationSec`
    // already does client-side (163s / 5 plates ≈ 32-33s/plate raw,
    // clamped to MAX_LTX_CLIP_DURATION_SEC before this route ever sees
    // it) — this route's own defensive slice-trim must agree, in case a
    // caller ever sends an unclamped audioStartSec/audioEndSec window
    // wider than the ceiling.
    const mp3Bytes = encodeTestMp3(45, 44100, 128);

    mockAudioFetch(mp3Bytes);
    mockUploads("plate.png", "clip-overshoot.mp3");
    mockSubmit("job-overshoot");
    mockJobPoll();
    mockDownload(new Uint8Array([4, 5, 6]));
    // See the matching comment in the sibling boundary test above.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({ url: "https://abc.public.blob.vercel-storage.com/overshoot.mp4" });

    const res = await POST(
      vocalRequest({
        durationSec: MAX_LTX_CLIP_DURATION_SEC,
        audioStartSec: 0,
        audioEndSec: 33, // wider than MAX_LTX_CLIP_DURATION_SEC — must be trimmed, not rejected.
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.durationSec).toBeLessThanOrEqual(MAX_LTX_CLIP_DURATION_SEC);
  });

  it("falls back to a data: URL (never silently drops a paid render) when no persistence target is given", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads();
    mockSubmit("job-2");
    mockJobPoll();
    mockDownload(new Uint8Array([9, 9, 9]));

    const res = await POST(
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
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.videoUrl.startsWith("data:video/mp4;base64,")).toBe(true);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("still returns the render (as a data: URL), honestly flagged unsaved, when Blob persistence fails", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads();
    mockSubmit("job-3");
    mockJobPoll();
    mockDownload(new Uint8Array([7, 7, 7]));
    putMock.mockRejectedValueOnce(new Error("Vercel Blob: No token found."));

    const res = await POST(vocalRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persisted).toBe(false);
    expect(body.persistError).toContain("Vercel Blob: No token found.");
    expect(body.videoUrl.startsWith("data:video/mp4;base64,")).toBe(true);
  });

  it("surfaces a real Comfy Cloud submit failure verbatim", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Invalid node graph" }), { status: 200 }));

    const res = await POST(vocalRequest());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("invalid_request");
    expect(body.error).toContain("Invalid node graph");
  });

  it("surfaces a real Comfy Cloud execution_error verbatim", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads();
    mockSubmit("job-4");
    mockJobPoll({ status: "failed", execution_error: { exception_message: "OOMError" } });

    const res = await POST(vocalRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain("OOMError");
  });

  it("reads SaveVideo's `images` output key — a finished render is never reported as no_video_output", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads();
    mockSubmit("job-images");
    mockJobPoll({
      status: "completed",
      outputs: { "341": { images: [{ filename: "skidmarks_ltx_00001.mp4", subfolder: "video", type: "output" }] } },
    });
    mockDownload(new Uint8Array([1, 2]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({ url: "https://abc.public.blob.vercel-storage.com/x.mp4" });

    const res = await POST(vocalRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).toBeUndefined();
    // The download asked for exactly the file `images` named.
    const viewCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/view"));
    expect(String(viewCall?.[0])).toContain("filename=skidmarks_ltx_00001.mp4");
  });

  it("reports no_video_output honestly when a completed job really carries no mp4", async () => {
    mockAudioFetch(encodeTestMp3(6));
    mockUploads();
    mockSubmit("job-empty");
    mockJobPoll({ status: "completed", outputs: { "341": { images: [{ filename: "preview.png" }] } } });

    const res = await POST(vocalRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("no_video_output");
  });
});

describe("POST /api/skidmarks/generate-clip \u2014 Instrumental MiniMax H3 render path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("MINIMAX_API_KEY", "test-minimax-key");
    vi.stubEnv("MINIMAX_GROUP_ID", "");
    putMock.mockReset();
    listMock.mockReset();
    delMock.mockReset();
    listMock.mockResolvedValue({ blobs: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function h3Request(overrides: Record<string, unknown> = {}): Request {
    return postRequest({
      prompt: "a door creaks open, slow zoom",
      shotPrompt: "a door creaks open, slow zoom",
      referenceImageDataUrls: [TINY_DATA_URL],
      videoBackend: "h3",
      durationSec: 8,
      ...overrides,
    });
  }

  it("reports the honest missing_api_key outcome and never calls fetch when MINIMAX_API_KEY is unset", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "");
    const res = await POST(h3Request());
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("MINIMAX_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps calling xAI Grok, never MiniMax, when videoBackend is omitted \u2014 the server's own back-compat default (Do NOT break #49)", async () => {
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-fallback" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "done",
          video: { url: "https://vidgen.x.ai/clip.mp4", duration: 8, respect_moderation: true },
        })
      );

    const res = await POST(postRequest({ prompt: "x", referenceImageDataUrls: [TINY_DATA_URL] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.videoUrl).toBe("https://vidgen.x.ai/clip.mp4");
    const [startUrl] = fetchMock.mock.calls[0];
    expect(startUrl).toBe("https://api.x.ai/v1/videos/generations");
  });

  it("keeps calling xAI Grok when videoBackend is explicitly \"grok\"", async () => {
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { request_id: "req-grok" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "done",
          video: { url: "https://vidgen.x.ai/g.mp4", duration: 8, respect_moderation: true },
        })
      );

    const res = await POST(h3Request({ videoBackend: "grok" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.videoUrl).toBe("https://vidgen.x.ai/g.mp4");
    const [startUrl] = fetchMock.mock.calls[0];
    expect(startUrl).toBe("https://api.x.ai/v1/videos/generations");
  });

  it("submits to MiniMax's /v2/video_generation with the documented content shape, polls, downloads, and returns a data: URL when no persistence target is given", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { task_id: "task-1" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { task: { status: "success", content: { url: "https://cdn.minimax.io/clip.mp4" } } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const res = await POST(h3Request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.durationSec).toBe(8);
    expect(body.videoUrl).toBe(`data:video/mp4;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
    expect(body.persisted).toBeUndefined();

    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(submitUrl).toBe("https://api.minimax.io/v2/video_generation");
    const sentBody = JSON.parse(submitInit.body as string);
    expect(sentBody.model).toBe("MiniMax-H3");
    expect(sentBody.duration).toBe(8);
    expect(sentBody.resolution).toBe("768P");
    expect(sentBody.content).toEqual([
      { type: "text", text: "a door creaks open, slow zoom" },
      { type: "image_url", image_url: { url: TINY_DATA_URL }, role: "first_frame" },
    ]);

    const [pollUrl] = fetchMock.mock.calls[1];
    expect(pollUrl).toBe("https://api.minimax.io/v2/query/video_generation/task-1");

    const [downloadUrl] = fetchMock.mock.calls[2];
    expect(downloadUrl).toBe("https://cdn.minimax.io/clip.mp4");
  });

  it("sends an optional last_frame image when a second reference is given", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { task_id: "task-2" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { task: { status: "success", content: { url: "https://cdn.minimax.io/c2.mp4" } } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));

    await POST(h3Request({ referenceImageDataUrls: [TINY_DATA_URL, SECOND_DATA_URL] }));

    const [, submitInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(submitInit.body as string);
    expect(sentBody.content).toHaveLength(3);
    expect(sentBody.content[2]).toEqual({
      type: "image_url",
      image_url: { url: SECOND_DATA_URL },
      role: "last_frame",
    });
  });

  it("rejects more than two reference images \u2014 H3 only has first/last-frame roles, unlike Grok's up-to-3", async () => {
    const res = await POST(
      h3Request({ referenceImageDataUrls: [TINY_DATA_URL, SECOND_DATA_URL, THIRD_DATA_URL] })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(body.error.toLowerCase()).toContain("at most two reference images");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-uploads a successful render to Vercel Blob under this plate's stable pathname when a persistence target is given", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { task_id: "task-3" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { task: { status: "success", content: { url: "https://cdn.minimax.io/c3.mp4" } } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([9, 9, 9]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD verify
    putMock.mockResolvedValueOnce({
      url: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
    });

    const res = await POST(
      h3Request({ segmentId: "seg-1", plateId: "plate-1", clipIndex: 1, startSec: 0, endSec: 40 })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
      durationSec: 8,
      persisted: true,
    });
    expect(putMock).toHaveBeenCalledTimes(1);
    const [pathname] = putMock.mock.calls[0];
    expect(pathname).toBe("skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4");
  });

  it("still returns the render (as a data: URL), honestly flagged unsaved, when Blob persistence fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { task_id: "task-4" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { task: { status: "success", content: { url: "https://cdn.minimax.io/c4.mp4" } } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 7]), { status: 200 }));
    putMock.mockRejectedValueOnce(new Error("Vercel Blob: No token found."));

    const res = await POST(
      h3Request({ segmentId: "seg-1", plateId: "plate-1", clipIndex: 1, startSec: 0, endSec: 40 })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persisted).toBe(false);
    expect(body.persistError).toContain("Vercel Blob: No token found.");
    expect(body.videoUrl.startsWith("data:video/mp4;base64,")).toBe(true);
  });

  it("surfaces a real MiniMax submit failure verbatim", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "invalid api key" }));

    const res = await POST(h3Request());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe("auth_error");
    expect(body.error).toContain("invalid api key");
  });

  it("surfaces a real MiniMax job failure honestly", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { task_id: "task-5" }))
      .mockResolvedValueOnce(jsonResponse(200, { task: { status: "failed", error: "content moderation rejected" } }));

    const res = await POST(h3Request());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("upstream_error");
    expect(body.error).toContain("content moderation rejected");
  });

  it("keeps polling across pending responses before returning the finished video", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { task_id: "task-6" }))
      .mockResolvedValueOnce(jsonResponse(200, { task: { status: "processing" } }))
      .mockResolvedValueOnce(jsonResponse(200, { task: { status: "processing" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { task: { status: "success", content: { url: "https://cdn.minimax.io/final.mp4" } } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));

    const resultPromise = POST(h3Request());
    await advanceOnePoll();
    await advanceOnePoll();
    await advanceOnePoll();

    const res = await resultPromise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    vi.useRealTimers();
  });

  it("gives up honestly once the poll deadline passes, without pretending the render finished", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task_id: "task-7" }));
    fetchMock.mockResolvedValue(jsonResponse(200, { task: { status: "processing" } }));

    const resultPromise = POST(h3Request());
    for (let i = 0; i < 62; i++) {
      await advanceOnePoll();
    }

    const res = await resultPromise;
    const body = await res.json();

    expect(res.status).toBe(504);
    expect(body.code).toBe("timeout");
    expect(body.error.toLowerCase()).toContain("still processing");

    vi.useRealTimers();
  });
});

describe("POST /api/skidmarks/generate-clip — Instrumental Siray Wan 3.0 i2v Spicy", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SIRAY_API_KEY", "test-siray-key");
    putMock.mockReset();
    listMock.mockReset();
    delMock.mockReset();
    listMock.mockResolvedValue({ blobs: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function sirayRequest(overrides: Record<string, unknown> = {}): Request {
    return postRequest({
      prompt: "party plate, camera holds",
      shotPrompt: "party plate, camera holds",
      referenceImageDataUrls: [TINY_DATA_URL],
      videoBackend: "siray",
      durationSec: 17,
      ...overrides,
    });
  }

  it("reports missing_api_key and never calls fetch when SIRAY_API_KEY is unset", async () => {
    vi.stubEnv("SIRAY_API_KEY", "");
    const res = await POST(sirayRequest());
    const body = await res.json();
    expect(res.status).toBe(501);
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("SIRAY_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits Wan 3.0 Spicy, polls SUCCESS, downloads mp4, returns data URL without persistence", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { code: "Success", data: { task_id: "siray-vid-1" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { status: "SUCCESS", outputs: ["https://cdn.siray.ai/out.mp4"] } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { "Content-Type": "video/mp4" } }));

    const res = await POST(sirayRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.durationSec).toBe(17);
    expect(body.videoUrl).toBe(`data:video/mp4;base64,${Buffer.from([9, 8, 7]).toString("base64")}`);

    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(submitUrl).toBe("https://api.siray.ai/v1/video/generations");
    const sent = JSON.parse(submitInit.body as string);
    expect(sent.model).toBe("alibaba/wan-3.0-i2v-spicy");
    expect(sent.duration).toBe(17);
    expect(sent.size).toBe("720p");
    expect(sent.aspect_ratio).toBe("16:9");
    expect(sent.image).toBe(TINY_DATA_URL);
    expect(sent.prompt).toBe("party plate, camera holds");

    const [pollUrl] = fetchMock.mock.calls[1];
    expect(pollUrl).toBe("https://api.siray.ai/v1/video/generations/siray-vid-1");
  });

  it("surfaces Siray fail_reason verbatim on FAILURE", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: { task_id: "siray-fail" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { status: "FAILURE", fail_reason: "input image sensitive" } })
      );

    const res = await POST(sirayRequest());
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toContain("input image sensitive");
  });

  it("clamps duration into Siray's 2–30s range (not Grok/H3's 15s)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: { task_id: "siray-long" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { status: "SUCCESS", outputs: ["https://cdn.siray.ai/long.mp4"] } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));

    const res = await POST(sirayRequest({ durationSec: 40 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.durationSec).toBe(30);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.duration).toBe(30);
  });
});
