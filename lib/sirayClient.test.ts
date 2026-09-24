import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveSirayCredentials,
  SIRAY_SEEDREAM_45_REF2I_SPICY,
  SIRAY_SEEDREAM_45_T2I_SPICY,
  SIRAY_SEEDREAM_45_SIZE,
  siraySubmitStillImage,
  sirayPollStillImage,
  sirayDownloadStill,
} from "./sirayClient";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CREDS = { apiKey: "test-siray-key" };

describe("resolveSirayCredentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null when SIRAY_API_KEY is unset", () => {
    vi.stubEnv("SIRAY_API_KEY", "");
    expect(resolveSirayCredentials()).toBeNull();
  });

  it("returns the key when set", () => {
    vi.stubEnv("SIRAY_API_KEY", "abc");
    expect(resolveSirayCredentials()).toEqual({ apiKey: "abc" });
  });
});

describe("siraySubmitStillImage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("submits to /v1/images/generations/async with the Seedream ref2i model and returns the task id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: "Success", data: { task_id: "task-1" } }));

    const outcome = await siraySubmitStillImage("front wide", ["data:image/jpeg;base64,AAAA"], CREDS);

    expect(outcome).toEqual({ ok: true, taskId: "task-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.siray.ai/v1/images/generations/async");
    expect(init.headers).toEqual({ Authorization: "Bearer test-siray-key", "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: SIRAY_SEEDREAM_45_REF2I_SPICY,
      prompt: "front wide",
      size: SIRAY_SEEDREAM_45_SIZE,
      images: ["data:image/jpeg;base64,AAAA"],
    });
  });

  it("with zero references submits the t2i spicy model and omits images", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: "Success", data: { task_id: "task-t2i" } }));

    const outcome = await siraySubmitStillImage("party lights", [], CREDS);

    expect(outcome).toEqual({ ok: true, taskId: "task-t2i" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe(SIRAY_SEEDREAM_45_T2I_SPICY);
    expect(body.images).toBeUndefined();
    expect(body.prompt).toBe("party lights");
  });

  it("parses a bare (non-nested) task_id too", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task_id: "task-2" }));
    const outcome = await siraySubmitStillImage("x", ["data:image/jpeg;base64,AAAA"], CREDS);
    expect(outcome).toEqual({ ok: true, taskId: "task-2" });
  });

  it("reports an honest failure when the 200 body has no task id at all", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: "Success" }));
    const outcome = await siraySubmitStillImage("x", ["data:image/jpeg;base64,AAAA"], CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "no_task_id" });
  });

  it("maps a 401 to auth_error and a 402 to payment_required", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    expect(await siraySubmitStillImage("x", [], CREDS)).toMatchObject({ code: "auth_error" });

    fetchMock.mockResolvedValueOnce(jsonResponse(402, {}));
    expect(await siraySubmitStillImage("x", [], CREDS)).toMatchObject({ code: "payment_required" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await siraySubmitStillImage("x", [], CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});

describe("sirayPollStillImage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("polls GET /v1/images/generations/async/{taskId} and resolves the output URL on SUCCESS", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: { status: "SUCCESS", outputs: ["https://cdn.siray.ai/out.png"] } })
    );

    const outcome = await sirayPollStillImage("task-1", CREDS, 60_000, 0);

    expect(outcome).toEqual({ ok: true, outputUrl: "https://cdn.siray.ai/out.png" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.siray.ai/v1/images/generations/async/task-1");
    expect(init.headers).toEqual({ Authorization: "Bearer test-siray-key" });
  });

  it("keeps polling through NOT_START/SUBMITTED/QUEUED/IN_PROGRESS before resolving", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { status: "QUEUED" } }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { status: "IN_PROGRESS" } }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { status: "SUCCESS", outputs: ["https://x/out.png"] } }));

    const outcome = await sirayPollStillImage("task-2", CREDS, 60_000, 0);

    expect(outcome).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces fail_reason verbatim on FAILURE", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { status: "FAILURE", fail_reason: "NSFW content blocked" } }));
    const outcome = await sirayPollStillImage("task-3", CREDS, 60_000, 0);
    expect(outcome).toMatchObject({ ok: false, code: "upstream_error" });
    expect((outcome as { error: string }).error).toContain("NSFW content blocked");
  });

  it("reports no_image when SUCCESS carries no output URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { status: "SUCCESS", outputs: [] } }));
    const outcome = await sirayPollStillImage("task-4", CREDS, 60_000, 0);
    expect(outcome).toMatchObject({ ok: false, code: "no_image" });
  });

  it("gives up honestly once the deadline passes", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { status: "IN_PROGRESS" } }));
    const outcome = await sirayPollStillImage("task-5", CREDS, 10, 1000);
    expect(outcome).toMatchObject({ ok: false, code: "timeout" });
  });

  it("classifies an HTTP failure while polling rather than looping forever", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    const outcome = await sirayPollStillImage("task-6", CREDS, 60_000, 0);
    expect(outcome).toMatchObject({ ok: false, status: 401, code: "auth_error" });
  });
});

describe("sirayDownloadStill", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("downloads the finished still's bytes with no auth header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/png" } })
    );
    const outcome = await sirayDownloadStill("https://cdn.siray.ai/out.png");
    expect(outcome).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toBeUndefined();
  });

  it("reports an honest error for a failed download", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const outcome = await sirayDownloadStill("https://cdn.siray.ai/gone.png");
    expect(outcome).toMatchObject({ ok: false, code: "upstream_error" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await sirayDownloadStill("https://cdn.siray.ai/out.png");
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});
