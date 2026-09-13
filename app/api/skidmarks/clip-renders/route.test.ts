import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIP_RENDER_PATH_PREFIX } from "@/lib/clipRenderBlob";

const listMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  list: (...args: unknown[]) => listMock(...args),
}));

async function importRoute() {
  return await import("./route");
}

function getRequest(query: string): Request {
  return new Request(`http://localhost/api/skidmarks/clip-renders${query}`);
}

describe("GET /api/skidmarks/clip-renders", () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request with no segmentIds without calling list()", async () => {
    const { GET } = await importRoute();
    const res = await GET(getRequest(""));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("lists the shared prefix once and filters to only the requested, well-formed segment ids", async () => {
    listMock.mockResolvedValueOnce({
      blobs: [
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01_0000-0040_render.mp4`, url: "https://x/a.mp4" },
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-2/plate-1/02_0040-0090_render.mp4`, url: "https://x/b.mp4" },
        // A clip nobody asked about this time \u2014 must not leak into the response.
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-3/plate-1/03_0090-0120_render.mp4`, url: "https://x/c.mp4" },
        // A stray blob under this prefix that doesn't match this feature's own naming \u2014 dropped, not guessed at.
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/not-a-render.txt`, url: "https://x/d.txt" },
        // The pre-per-plate pathname scheme (no plate folder) \u2014 also dropped, see the migration note.
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/01_0000-0040_render.mp4`, url: "https://x/legacy.mp4" },
      ],
    });

    const { GET } = await importRoute();
    const res = await GET(getRequest("?segmentIds=seg-1,seg-2"));
    const body = await res.json();

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith({ prefix: CLIP_RENDER_PATH_PREFIX });
    expect(body).toEqual({
      configured: true,
      renders: [
        {
          segmentId: "seg-1",
          plateId: "plate-1",
          url: "https://x/a.mp4",
          filename: "01_0000-0040_render.mp4",
          clipIndex: 1,
          startSec: 0,
          endSec: 40,
        },
        {
          segmentId: "seg-2",
          plateId: "plate-1",
          url: "https://x/b.mp4",
          filename: "02_0040-0090_render.mp4",
          clipIndex: 2,
          startSec: 40,
          endSec: 90,
        },
      ],
    });
  });

  it("de-duplicates a segmentIds list containing the same id twice", async () => {
    listMock.mockResolvedValueOnce({ blobs: [] });
    const { GET } = await importRoute();
    await GET(getRequest("?segmentIds=seg-1,seg-1,seg-1"));
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("ignores an unsafe id in the query string rather than passing it through", async () => {
    listMock.mockResolvedValueOnce({ blobs: [] });
    const { GET } = await importRoute();
    const res = await GET(getRequest("?segmentIds=seg-1,../etc/passwd"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.configured).toBe(true);
  });

  it("returns the honest unconfigured outcome, not a 500, when Blob isn't set up", async () => {
    listMock.mockRejectedValueOnce(new Error("Vercel Blob: No token found."));
    const { GET } = await importRoute();
    const res = await GET(getRequest("?segmentIds=seg-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ configured: false, renders: [], error: "Vercel Blob: No token found." });
  });
});
