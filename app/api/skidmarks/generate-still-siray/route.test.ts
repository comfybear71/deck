import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("rejects zero reference images", async () => {
    const res = await POST(postRequest({ prompt: "front wide", referenceImageDataUrls: [] }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.toLowerCase()).toContain("exactly one reference image");
  });

  it("rejects more than one reference image", async () => {
    const res = await POST(postRequest({ prompt: "front wide", referenceImageDataUrls: [REFERENCE, REFERENCE] }));
    expect(res.status).toBe(400);
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
