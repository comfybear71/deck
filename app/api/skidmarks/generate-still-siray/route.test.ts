import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Blob is mocked so this file can never upload a real file (2026-09-30:
// a run with BLOB_READ_WRITE_TOKEN set in the shell put junk test images
// into the live store). `put` rejects, which is exactly what the route
// sees with no token: it keeps the image as a data: URL, not saved.
const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  list: vi.fn(async () => ({ blobs: [] })),
  del: vi.fn(async () => undefined),
  head: vi.fn(async () => {
    throw new Error("Blob is mocked in this test.");
  }),
}));

import { POST } from "./route";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const REFERENCE = "data:image/jpeg;base64,AAAA";

function postRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/skidmarks/generate-still-siray", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/skidmarks/generate-still-siray", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SIRAY_API_KEY", "test-siray-key");
    // No real Blob token in any test here, even if the shell has one.
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    putMock.mockReset();
    putMock.mockRejectedValue(new Error("Blob is mocked in this test."));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reports the honest missing_api_key outcome and never calls fetch when SIRAY_API_KEY is unset", async () => {
    vi.stubEnv("SIRAY_API_KEY", "");
    const res = await POST(postRequest({ prompt: "front wide", referenceImageDataUrls: [REFERENCE] }));
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.code).toBe("missing_api_key");
    expect(body.error).toContain("SIRAY_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing prompt", async () => {
    const res = await POST(postRequest({ referenceImageDataUrls: [REFERENCE] }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts zero reference images and submits the t2i spicy model (no images field)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: { task_id: "task-t2i" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { status: "SUCCESS", outputs: ["https://cdn.siray.ai/t2i.png"] } })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { "content-type": "image/png" } })
      );

    const res = await POST(postRequest({ prompt: "adult party glitter rain", referenceImageDataUrls: [] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.dataUrl).toMatch(/^data:image\/png;base64,/);

    const submittedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(submittedBody.model).toBe("bytedance/seedream-4.5-t2i-spicy");
    expect(submittedBody.images).toBeUndefined();
    expect(submittedBody.prompt).toBe("adult party glitter rain");
    // No token: the route never tries Blob at all.
    expect(putMock).not.toHaveBeenCalled();
  });

  it("with a Blob token, the save goes to the mocked put (never the real store)", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token-not-real");
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: { task_id: "task-blob" } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { status: "SUCCESS", outputs: ["https://cdn.siray.ai/b.png"] } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "image/png" } }));
    const res = await POST(postRequest({ prompt: "wide", referenceImageDataUrls: [] }));
    const body = await res.json();
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("also accepts a missing referenceImageDataUrls field as zero refs (t2i)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: { task_id: "task-t2i-2" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { status: "SUCCESS", outputs: ["https://cdn.siray.ai/t2i2.png"] } })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/png" } })
      );

    const res = await POST(postRequest({ prompt: "neon party" }));
    expect(res.status).toBe(200);
    const submittedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(submittedBody.model).toBe("bytedance/seedream-4.5-t2i-spicy");
    expect(submittedBody.images).toBeUndefined();
  });

  it("rejects more than four reference images (one per person in a Shorts shot)", async () => {
    const res = await POST(
      postRequest({ prompt: "front wide", referenceImageDataUrls: [REFERENCE, REFERENCE, REFERENCE, REFERENCE, REFERENCE] }),
    );
    expect(res.status).toBe(400);
  });

  it("sends every reference to Siray for a two-person shot, in order", async () => {
    const second = REFERENCE.replace("base64,", "base64,AA");
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "stop here" }));
    await POST(postRequest({ prompt: "two people", referenceImageDataUrls: [REFERENCE, second] }));
    const submittedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(submittedBody.model).toBe("bytedance/seedream-4.5-ref2i-spicy");
    expect(submittedBody.images).toEqual([REFERENCE, second]);
  });

  it("rejects a reference that isn't a real data: image URL", async () => {
    const res = await POST(postRequest({ prompt: "front wide", referenceImageDataUrls: ["not-a-data-url"] }));
    expect(res.status).toBe(400);
  });

  it("runs the full real pipeline end to end and returns a data: URL", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: { task_id: "task-1" } })) // submit
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { status: "SUCCESS", outputs: ["https://cdn.siray.ai/out.png"] } })
      ) // poll
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } })
      ); // download

    const res = await POST(postRequest({ prompt: "front wide", referenceImageDataUrls: [REFERENCE] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dataUrl).toMatch(/^data:image\/png;base64,/);

    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(submitUrl).toBe("https://api.siray.ai/v1/images/generations/async");
    const submittedBody = JSON.parse(submitInit.body as string);
    expect(submittedBody.prompt).toBe("front wide");
    expect(submittedBody.model).toBe("bytedance/seedream-4.5-ref2i-spicy");
    expect(submittedBody.images).toEqual([REFERENCE]);
  });

  it("surfaces a real submit failure verbatim", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(402, { error: "Insufficient credits" }));
    const res = await POST(postRequest({ prompt: "front wide", referenceImageDataUrls: [REFERENCE] }));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body.code).toBe("payment_required");
  });

  it("surfaces a real poll failure verbatim", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: { task_id: "task-2" } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { status: "FAILURE", fail_reason: "content policy" } }));

    const res = await POST(postRequest({ prompt: "front wide", referenceImageDataUrls: [REFERENCE] }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toContain("content policy");
  });
});
