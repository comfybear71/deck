import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadMinimaxH3Video,
  extractMinimaxErrorMessage,
  MINIMAX_H3_MODEL,
  MINIMAX_H3_RESOLUTION,
  pollMinimaxH3Video,
  resolveMinimaxCredentials,
  submitMinimaxH3Video,
} from "./minimaxH3";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CREDS = { apiKey: "test-minimax-key" };

describe("resolveMinimaxCredentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null when MINIMAX_API_KEY is unset", () => {
    vi.stubEnv("MINIMAX_API_KEY", "");
    expect(resolveMinimaxCredentials()).toBeNull();
  });

  it("returns just the apiKey when MINIMAX_GROUP_ID is unset", () => {
    vi.stubEnv("MINIMAX_API_KEY", "abc");
    vi.stubEnv("MINIMAX_GROUP_ID", "");
    expect(resolveMinimaxCredentials()).toEqual({ apiKey: "abc" });
  });

  it("includes groupId when MINIMAX_GROUP_ID is set", () => {
    vi.stubEnv("MINIMAX_API_KEY", "abc");
    vi.stubEnv("MINIMAX_GROUP_ID", "grp-1");
    expect(resolveMinimaxCredentials()).toEqual({ apiKey: "abc", groupId: "grp-1" });
  });
});

describe("MINIMAX_H3_MODEL / MINIMAX_H3_RESOLUTION", () => {
  it("uses the real model id and the cheaper 768P tier, hardcoded", () => {
    expect(MINIMAX_H3_MODEL).toBe("MiniMax-H3");
    expect(MINIMAX_H3_RESOLUTION).toBe("768P");
  });
});

describe("extractMinimaxErrorMessage", () => {
  it("reads a bare string error", () => {
    expect(extractMinimaxErrorMessage({ error: "Invalid API key" })).toBe("Invalid API key");
  });

  it("reads an { error: { code, message } } object, joining both", () => {
    expect(extractMinimaxErrorMessage({ error: { code: "1004", message: "auth failed" } })).toBe(
      "1004: auth failed"
    );
  });

  it("reads a nested task.error object or string", () => {
    expect(extractMinimaxErrorMessage({ task: { error: "boom" } })).toBe("boom");
    expect(extractMinimaxErrorMessage({ task: { error: { message: "boom2" } } })).toBe("boom2");
  });

  it("reads base_resp.status_msg", () => {
    expect(extractMinimaxErrorMessage({ base_resp: { status_msg: "insufficient balance" } })).toBe(
      "insufficient balance"
    );
  });

  it("returns an empty string for an unrecognized/empty payload rather than throwing", () => {
    expect(extractMinimaxErrorMessage(null)).toBe("");
    expect(extractMinimaxErrorMessage({})).toBe("");
  });
});

describe("submitMinimaxH3Video", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("submits to /v2/video_generation with the documented content shape (text + first_frame image)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task_id: "task-1" }));

    const outcome = await submitMinimaxH3Video(
      { prompt: "a door creaks open", firstImageUrl: "data:image/png;base64,door", durationSec: 8 },
      CREDS
    );

    expect(outcome).toEqual({ ok: true, taskId: "task-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.minimax.io/v2/video_generation");
    expect(init.headers).toEqual({ Authorization: "Bearer test-minimax-key", "Content-Type": "application/json" });
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.model).toBe("MiniMax-H3");
    expect(sentBody.duration).toBe(8);
    expect(sentBody.resolution).toBe("768P");
    expect(sentBody.content).toEqual([
      { type: "text", text: "a door creaks open" },
      { type: "image_url", image_url: { url: "data:image/png;base64,door" }, role: "first_frame" },
    ]);
  });

  it("appends a last_frame image item only when lastImageUrl is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task_id: "task-2" }));

    await submitMinimaxH3Video(
      {
        prompt: "x",
        firstImageUrl: "data:image/png;base64,a",
        lastImageUrl: "data:image/png;base64,b",
        durationSec: 5,
      },
      CREDS
    );

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.content).toHaveLength(3);
    expect(sentBody.content[2]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,b" },
      role: "last_frame",
    });
  });

  it("sends Group-Id only when the credentials carry one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task_id: "task-3" }));
    await submitMinimaxH3Video(
      { prompt: "x", firstImageUrl: "data:image/png;base64,a", durationSec: 5 },
      { apiKey: "k", groupId: "grp-1" }
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Group-Id"]).toBe("grp-1");
  });

  it("classifies a real 401 as auth_error, with MiniMax's own error message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "invalid api key" }));
    const outcome = await submitMinimaxH3Video(
      { prompt: "x", firstImageUrl: "data:image/png;base64,a", durationSec: 5 },
      CREDS
    );
    expect(outcome).toMatchObject({ ok: false, status: 401, code: "auth_error" });
    expect((outcome as { error: string }).error).toContain("invalid api key");
  });

  it("reports an honest failure when the 200 body has no task_id at all", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const outcome = await submitMinimaxH3Video(
      { prompt: "x", firstImageUrl: "data:image/png;base64,a", durationSec: 5 },
      CREDS
    );
    expect(outcome).toMatchObject({ ok: false, code: "no_task_id" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await submitMinimaxH3Video(
      { prompt: "x", firstImageUrl: "data:image/png;base64,a", durationSec: 5 },
      CREDS
    );
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});

describe("pollMinimaxH3Video", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("polls /v2/query/video_generation/{taskId} and reports pending for an in-flight status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task: { status: "processing" } }));
    const outcome = await pollMinimaxH3Video("task-1", CREDS);
    expect(outcome).toEqual({ ok: true, status: "pending" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.minimax.io/v2/query/video_generation/task-1");
  });

  it("reports done with the video url once the task succeeds", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { task: { status: "success", content: { url: "https://cdn.minimax.io/video.mp4" } } })
    );
    const outcome = await pollMinimaxH3Video("task-2", CREDS);
    expect(outcome).toEqual({ ok: true, status: "done", videoUrl: "https://cdn.minimax.io/video.mp4" });
  });

  it("falls back to a bare top-level status/url shape, not just the nested task object", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "done", url: "https://cdn.minimax.io/v2.mp4" }));
    const outcome = await pollMinimaxH3Video("task-3", CREDS);
    expect(outcome).toEqual({ ok: true, status: "done", videoUrl: "https://cdn.minimax.io/v2.mp4" });
  });

  it("reports no_video_output if a done status carries no url anywhere", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task: { status: "done" } }));
    const outcome = await pollMinimaxH3Video("task-4", CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "no_video_output" });
  });

  it("reports an honest failure for a failed/cancelled task", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { task: { status: "failed", error: "content moderation rejected" } })
    );
    const outcome = await pollMinimaxH3Video("task-5", CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "upstream_error" });
    expect((outcome as { error: string }).error).toContain("content moderation rejected");
  });

  it("treats an unrecognized status string as still pending, not a hard failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { task: { status: "some_new_status" } }));
    const outcome = await pollMinimaxH3Video("task-6", CREDS);
    expect(outcome).toEqual({ ok: true, status: "pending" });
  });

  it("classifies a real HTTP failure honestly", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}));
    const outcome = await pollMinimaxH3Video("task-7", CREDS);
    expect(outcome).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await pollMinimaxH3Video("task-8", CREDS);
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});

describe("downloadMinimaxH3Video", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("downloads the video with a plain, unauthenticated GET", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const outcome = await downloadMinimaxH3Video("https://cdn.minimax.io/video.mp4");
    expect(outcome).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cdn.minimax.io/video.mp4");
    expect(init.headers).toBeUndefined();
  });

  it("reports an honest failure for a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const outcome = await downloadMinimaxH3Video("https://cdn.minimax.io/gone.mp4");
    expect(outcome).toMatchObject({ ok: false, code: "upstream_error" });
  });

  it("reports a real network error honestly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await downloadMinimaxH3Video("https://cdn.minimax.io/video.mp4");
    expect(outcome).toMatchObject({ ok: false, code: "network_error" });
  });
});
