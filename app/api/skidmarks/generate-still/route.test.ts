import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyXaiFailure, extractXaiErrorMessage, POST } from "./route";

/**
 * `extractXaiErrorMessage`/`classifyXaiFailure` are pure — no `fetch`/
 * `NextResponse` needed — so they're exercised directly here, same split
 * as `app/api/skidmarks/transcribe/route.test.ts` uses for its own
 * ElevenLabs equivalents. xAI's API is OpenAI-compatible, so its error
 * bodies are expected to follow that shape (`{ error: { message, type,
 * code } }`, or occasionally a bare `{ error: "..." }` string) — neither
 * shape has been observed against a real *failing* xAI request in this
 * sandbox (the two live calls made while building this feature both
 * succeeded — see `lib/plateGeneration.ts`'s module doc comment), so
 * these fixtures are inferred from OpenAI's documented error convention,
 * not confirmed against a real xAI error response.
 */
describe("extractXaiErrorMessage", () => {
  it("parses the OpenAI-compatible { error: { message } } shape", () => {
    expect(extractXaiErrorMessage({ error: { message: "Invalid API key provided.", type: "invalid_request_error" } })).toBe(
      "Invalid API key provided."
    );
  });

  it("falls back to a bare string `error`", () => {
    expect(extractXaiErrorMessage({ error: "Something went wrong." })).toBe("Something went wrong.");
  });

  it("returns null for an empty or malformed payload rather than throwing", () => {
    expect(extractXaiErrorMessage(null)).toBeNull();
    expect(extractXaiErrorMessage(undefined)).toBeNull();
    expect(extractXaiErrorMessage("just a string")).toBeNull();
    expect(extractXaiErrorMessage({})).toBeNull();
    expect(extractXaiErrorMessage({ error: {} })).toBeNull();
    expect(extractXaiErrorMessage({ error: { message: "" } })).toBeNull();
  });
});

describe("classifyXaiFailure", () => {
  it("maps 401/403 to auth_error", () => {
    expect(classifyXaiFailure(401)).toEqual({ httpStatus: 401, code: "auth_error" });
    expect(classifyXaiFailure(403)).toEqual({ httpStatus: 403, code: "auth_error" });
  });

  it("maps 429 to rate_limited", () => {
    expect(classifyXaiFailure(429)).toEqual({ httpStatus: 429, code: "rate_limited" });
  });

  it("maps 402 to payment_required", () => {
    expect(classifyXaiFailure(402)).toEqual({ httpStatus: 402, code: "payment_required" });
  });

  it("maps 400/422 to invalid_request", () => {
    expect(classifyXaiFailure(400)).toEqual({ httpStatus: 422, code: "invalid_request" });
    expect(classifyXaiFailure(422)).toEqual({ httpStatus: 422, code: "invalid_request" });
  });

  it("falls back to upstream_error for anything else", () => {
    expect(classifyXaiFailure(500)).toEqual({ httpStatus: 502, code: "upstream_error" });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/generate-still", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const TINY_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("POST /api/skidmarks/generate-still", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // This sandbox's own process has a real XAI_API_KEY set (used for the
    // live verification calls documented in `lib/plateGeneration.ts`'s
    // module doc comment) — stub it per test so each test reflects a
    // deliberately chosen configuration, not this sandbox's own.
    vi.stubEnv("XAI_API_KEY", "test-key");
    vi.stubEnv("XAI_IMAGE_MODEL", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reports the honest missing_api_key outcome and never calls fetch when XAI_API_KEY is unset", async () => {
    vi.stubEnv("XAI_API_KEY", "");

    const res = await POST(postRequest({ prompt: "a desert highway at night" }));
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("XAI_API_KEY");
    expect(body.error.toLowerCase()).toContain("redeploy");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing prompt without calling fetch", async () => {
    const res = await POST(postRequest({}));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a reference image that isn't a data: URL", async () => {
    const res = await POST(
      postRequest({ prompt: "a desert highway at night", referenceImageDataUrls: ["https://example.com/a.jpg"] })
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects more reference images than this route accepts", async () => {
    const res = await POST(
      postRequest({
        prompt: "a desert highway at night",
        referenceImageDataUrls: [TINY_DATA_URL, TINY_DATA_URL, TINY_DATA_URL, TINY_DATA_URL],
      })
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls /images/generations (not /images/edits) and returns a data: URL when there are no reference images", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: [{ b64_json: "AAAA", mime_type: "image/jpeg" }], usage: { cost_in_usd_ticks: 1 } })
    );

    const res = await POST(postRequest({ prompt: "a desert highway at night" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dataUrl).toBe("data:image/jpeg;base64,AAAA");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/images/generations");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.model).toBe("grok-imagine-image-2.0");
    expect(sentBody.n).toBe(1);
    expect(sentBody.image).toBeUndefined();
    expect(sentBody.images).toBeUndefined();
  });

  it("calls /images/edits with a single `image` object for exactly one reference", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: [{ b64_json: "BBBB", mime_type: "image/jpeg" }] })
    );

    const res = await POST(
      postRequest({ prompt: "continue the scene", referenceImageDataUrls: [TINY_DATA_URL] })
    );
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/images/edits");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.image).toEqual({ url: TINY_DATA_URL, type: "image_url" });
    expect(sentBody.images).toBeUndefined();
  });

  it("calls /images/edits with an `images` array, in order, for two or more references", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: [{ b64_json: "CCCC", mime_type: "image/jpeg" }] })
    );
    const secondRef = "data:image/png;base64,iVBORw0KGgo=";

    await POST(
      postRequest({
        prompt: "continue the scene, using <IMAGE_0> for continuity and <IMAGE_1> for likeness",
        referenceImageDataUrls: [TINY_DATA_URL, secondRef],
      })
    );

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.image).toBeUndefined();
    expect(sentBody.images).toEqual([
      { url: TINY_DATA_URL, type: "image_url" },
      { url: secondRef, type: "image_url" },
    ]);
  });

  it("honors an XAI_IMAGE_MODEL override without a code change", async () => {
    vi.stubEnv("XAI_IMAGE_MODEL", "grok-imagine-image");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: "DDDD", mime_type: "image/jpeg" }] }));

    await POST(postRequest({ prompt: "a desert highway at night" }));

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe("grok-imagine-image");
  });

  it("surfaces a real xAI failure's message and classified code verbatim", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: "Incorrect API key provided.", type: "invalid_request_error" } })
    );

    const res = await POST(postRequest({ prompt: "a desert highway at night" }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe("auth_error");
    expect(body.error).toContain("Incorrect API key provided.");
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const res = await POST(postRequest({ prompt: "a desert highway at night" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("network_error");
    expect(body.error).toContain("Failed to fetch");
  });

  it("downloads and re-encodes a bare `url` response into a data: URL, as a defensive fallback", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ url: "https://xai-temp.example.com/img.png" }] }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/png" } })
      );

    const res = await POST(postRequest({ prompt: "a desert highway at night" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://xai-temp.example.com/img.png");
  });

  it("reports no_image if a successful response carries neither b64_json nor url", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{}] }));

    const res = await POST(postRequest({ prompt: "a desert highway at night" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("no_image");
  });
});
