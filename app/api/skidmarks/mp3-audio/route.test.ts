import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MP3_AUDIO_PATH_PREFIX } from "@/lib/mp3AudioPath";

const listMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  list: (...args: unknown[]) => listMock(...args),
}));

async function importRoute() {
  return await import("./route");
}

function getRequest(query: string): Request {
  return new Request(`http://localhost/api/skidmarks/mp3-audio${query}`);
}

describe("GET /api/skidmarks/mp3-audio", () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request with no audioId without calling list()", async () => {
    const { GET } = await importRoute();
    const res = await GET(getRequest(""));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("rejects an unsafe audioId (path traversal) without calling list()", async () => {
    const { GET } = await importRoute();
    const res = await GET(getRequest("?audioId=../etc/passwd"));
    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("returns the real url when this audioId's blob exists", async () => {
    listMock.mockResolvedValueOnce({
      blobs: [{ pathname: `${MP3_AUDIO_PATH_PREFIX}abc123.mp3`, url: "https://x/a.mp3" }],
    });

    const { GET } = await importRoute();
    const res = await GET(getRequest("?audioId=abc123"));
    const body = await res.json();

    expect(listMock).toHaveBeenCalledWith({ prefix: `${MP3_AUDIO_PATH_PREFIX}abc123` });
    expect(body).toEqual({ configured: true, url: "https://x/a.mp3" });
  });

  it("returns a real, successful null url when Blob is configured but nothing's there yet", async () => {
    listMock.mockResolvedValueOnce({ blobs: [] });
    const { GET } = await importRoute();
    const res = await GET(getRequest("?audioId=abc123"));
    const body = await res.json();
    expect(body).toEqual({ configured: true, url: null });
  });

  it("doesn't match a different audioId's blob under a shared prefix collision", async () => {
    listMock.mockResolvedValueOnce({
      blobs: [{ pathname: `${MP3_AUDIO_PATH_PREFIX}abc123-other.mp3`, url: "https://x/other.mp3" }],
    });
    const { GET } = await importRoute();
    const res = await GET(getRequest("?audioId=abc123"));
    const body = await res.json();
    expect(body).toEqual({ configured: true, url: null });
  });

  it("returns the honest unconfigured outcome, not a 500, when Blob isn't set up", async () => {
    listMock.mockRejectedValueOnce(new Error("Vercel Blob: No token found."));
    const { GET } = await importRoute();
    const res = await GET(getRequest("?audioId=abc123"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ configured: false, url: null, error: "Vercel Blob: No token found." });
  });
});
