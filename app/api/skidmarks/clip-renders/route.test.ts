import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIP_RENDER_PATH_PREFIX } from "@/lib/clipRenderBlob";
import { deckProjectsPrefixes } from "@/lib/deckMediaPaths";

const TREE_PREFIX_COUNT = deckProjectsPrefixes().length;

const listMock = vi.fn();
const delMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  list: (...args: unknown[]) => listMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}));

async function importRoute() {
  return await import("./route");
}

function getRequest(query: string): Request {
  return new Request(`http://localhost/api/skidmarks/clip-renders${query}`);
}

function deleteRequest(query: string): Request {
  return new Request(`http://localhost/api/skidmarks/clip-renders${query}`, { method: "DELETE" });
}

describe("GET /api/skidmarks/clip-renders", () => {
  beforeEach(() => {
    listMock.mockReset();
    delMock.mockReset();
    // The readable tree's project folders are listed too; empty unless a test says otherwise.
    listMock.mockResolvedValue({ blobs: [] });
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
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01_0000-0040_render.mp4`, url: "https://x/a.mp4", uploadedAt: new Date("2026-01-01T00:00:00Z") },
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-2/plate-1/02_0040-0090_render.mp4`, url: "https://x/b.mp4", uploadedAt: new Date("2026-01-01T00:00:00Z") },
        // A clip nobody asked about this time \u2014 must not leak into the response.
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-3/plate-1/03_0090-0120_render.mp4`, url: "https://x/c.mp4", uploadedAt: new Date("2026-01-01T00:00:00Z") },
        // A stray blob under this prefix that doesn't match this feature's own naming \u2014 dropped, not guessed at.
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/not-a-render.txt`, url: "https://x/d.txt", uploadedAt: new Date("2026-01-01T00:00:00Z") },
        // The pre-per-plate pathname scheme (no plate folder) \u2014 also dropped, see the migration note.
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/01_0000-0040_render.mp4`, url: "https://x/legacy.mp4", uploadedAt: new Date("2026-01-01T00:00:00Z") },
      ],
    });

    const { GET } = await importRoute();
    const res = await GET(getRequest("?segmentIds=seg-1,seg-2"));
    const body = await res.json();

    expect(listMock).toHaveBeenCalledTimes(1 + TREE_PREFIX_COUNT);
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

  it("returns only the most recently uploaded blob when two sit under the same plate's prefix (write-time cleanup didn't run/failed)", async () => {
    // A live-QA'd real gap: a re-render whose computed filename drifted
    // from the previous take (a reordered timeline, a plate count
    // change) left both the stale and the fresh blob listed under the
    // same `seg-1/plate-1/` prefix. This route must report the plate
    // once, using the newer upload \u2014 never both, and never
    // arbitrarily whichever `list()` happened to return first.
    listMock.mockResolvedValueOnce({
      blobs: [
        {
          pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01_0000-0040_render.mp4`,
          url: "https://x/stale.mp4",
          uploadedAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/02_0040-0080_render.mp4`,
          url: "https://x/fresh.mp4",
          uploadedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    });

    const { GET } = await importRoute();
    const res = await GET(getRequest("?segmentIds=seg-1"));
    const body = await res.json();

    expect(body.configured).toBe(true);
    expect(body.renders).toHaveLength(1);
    expect(body.renders[0]).toMatchObject({ segmentId: "seg-1", plateId: "plate-1", url: "https://x/fresh.mp4" });
  });

  it("picks the latest blob regardless of which order list() happens to return them in", async () => {
    listMock.mockResolvedValueOnce({
      blobs: [
        {
          pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/02_0040-0080_render.mp4`,
          url: "https://x/fresh.mp4",
          uploadedAt: new Date("2026-01-02T00:00:00Z"),
        },
        {
          pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01_0000-0040_render.mp4`,
          url: "https://x/stale.mp4",
          uploadedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const { GET } = await importRoute();
    const res = await GET(getRequest("?segmentIds=seg-1"));
    const body = await res.json();

    expect(body.renders).toHaveLength(1);
    expect(body.renders[0].url).toBe("https://x/fresh.mp4");
  });

  it("de-duplicates a segmentIds list containing the same id twice", async () => {
    listMock.mockResolvedValueOnce({ blobs: [] });
    const { GET } = await importRoute();
    await GET(getRequest("?segmentIds=seg-1,seg-1,seg-1"));
    expect(listMock).toHaveBeenCalledTimes(1 + TREE_PREFIX_COUNT);
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

describe("DELETE /api/skidmarks/clip-renders", () => {
  beforeEach(() => {
    listMock.mockReset();
    delMock.mockReset();
    // The readable tree's project folders are listed too; empty unless a test says otherwise.
    listMock.mockResolvedValue({ blobs: [] });
  });

  it("rejects a request missing segmentId or plateId without calling list()/del()", async () => {
    const { DELETE } = await importRoute();
    const res = await DELETE(deleteRequest("?segmentId=seg-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(listMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });

  it("rejects an unsafe segmentId/plateId", async () => {
    const { DELETE } = await importRoute();
    const res = await DELETE(deleteRequest("?segmentId=../etc&plateId=plate-1"));
    expect(res.status).toBe(400);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("deletes every blob under this exact plate's own prefix, not the whole shared prefix", async () => {
    listMock.mockResolvedValueOnce({
      blobs: [
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01_0000-0040_render.mp4` },
        { pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01a_0000-0040_render.mp4` },
      ],
    });

    const { DELETE } = await importRoute();
    const res = await DELETE(deleteRequest("?segmentId=seg-1&plateId=plate-1"));
    const body = await res.json();

    expect(listMock).toHaveBeenCalledWith({ prefix: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/` });
    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock).toHaveBeenCalledWith([
      `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01_0000-0040_render.mp4`,
      `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01a_0000-0040_render.mp4`,
    ]);
    expect(res.status).toBe(200);
    expect(body).toEqual({ deleted: true });
  });

  it("reports a real success (nothing to delete) rather than an error when the plate has no persisted render", async () => {
    listMock.mockResolvedValueOnce({ blobs: [] });
    const { DELETE } = await importRoute();
    const res = await DELETE(deleteRequest("?segmentId=seg-1&plateId=plate-1"));
    const body = await res.json();

    expect(delMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(body).toEqual({ deleted: true });
  });

  it("returns an honest, non-silent failure (not a fake success) when Blob isn't configured", async () => {
    listMock.mockRejectedValueOnce(new Error("Vercel Blob: No token found."));
    const { DELETE } = await importRoute();
    const res = await DELETE(deleteRequest("?segmentId=seg-1&plateId=plate-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ deleted: false, error: "Vercel Blob: No token found." });
  });

  it("returns an honest failure when del() itself throws after a successful list()", async () => {
    listMock.mockResolvedValueOnce({
      blobs: [{ pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01_0000-0040_render.mp4` }],
    });
    delMock.mockRejectedValueOnce(new Error("Vercel Blob: delete failed."));

    const { DELETE } = await importRoute();
    const res = await DELETE(deleteRequest("?segmentId=seg-1&plateId=plate-1"));
    const body = await res.json();

    expect(body).toEqual({ deleted: false, error: "Vercel Blob: delete failed." });
  });
});

describe("renders in the readable deck/ tree (2026-09-30)", () => {
  const songs = "deck/music-video/songs/";
  const at = (d: string) => new Date(d);

  beforeEach(() => {
    listMock.mockReset();
    delMock.mockReset();
    listMock.mockImplementation(async ({ prefix }: { prefix: string }) => {
      if (prefix === CLIP_RENDER_PATH_PREFIX) {
        return { blobs: [{ pathname: `${CLIP_RENDER_PATH_PREFIX}seg-1/plate-1/01_0000-0040_render.mp4`, url: "https://x/old.mp4", uploadedAt: at("2026-09-01T00:00:00Z") }] };
      }
      if (prefix === songs) {
        return {
          blobs: [
            { pathname: `${songs}crack-haul/renders/seg-2/plate-1/crack-haul-clip-02a-0040-0090.mp4`, url: "https://x/new.mp4", uploadedAt: at("2026-09-30T00:00:00Z") },
            { pathname: `${songs}crack-haul/renders/seg-2/plate-1/crack-haul-clip-02a-0040-0090-last-frame.jpg`, url: "https://x/new.jpg", uploadedAt: at("2026-09-30T00:00:00Z") },
            { pathname: `${songs}crack-haul/plates/crack-haul-clip-02a.jpg`, url: "https://x/plate.jpg", uploadedAt: at("2026-09-30T00:00:00Z") },
          ],
        };
      }
      return { blobs: [] };
    });
  });

  it("shows old and new renders side by side, and nothing that isn't a render", async () => {
    const { GET } = await importRoute();
    const body = await (await GET(getRequest("?segmentIds=seg-1,seg-2"))).json();
    expect(body.renders).toEqual([
      { segmentId: "seg-1", plateId: "plate-1", url: "https://x/old.mp4", filename: "01_0000-0040_render.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
      { segmentId: "seg-2", plateId: "plate-1", url: "https://x/new.mp4", filename: "crack-haul-clip-02a-0040-0090.mp4", clipIndex: 2, startSec: 40, endSec: 90 },
    ]);
  });

  it("the newest take wins when a plate has one in each place", async () => {
    listMock.mockImplementation(async ({ prefix }: { prefix: string }) => {
      if (prefix === CLIP_RENDER_PATH_PREFIX) {
        return { blobs: [{ pathname: `${CLIP_RENDER_PATH_PREFIX}seg-2/plate-1/02a_0040-0090_render.mp4`, url: "https://x/old.mp4", uploadedAt: at("2026-09-01T00:00:00Z") }] };
      }
      if (prefix === songs) {
        return { blobs: [{ pathname: `${songs}crack-haul/renders/seg-2/plate-1/crack-haul-clip-02a-0040-0090.mp4`, url: "https://x/new.mp4", uploadedAt: at("2026-09-30T00:00:00Z") }] };
      }
      return { blobs: [] };
    });
    const { GET } = await importRoute();
    const body = await (await GET(getRequest("?segmentIds=seg-2"))).json();
    expect(body.renders.map((r: { url: string }) => r.url)).toEqual(["https://x/new.mp4"]);
  });

  it("follows Blob's page cursor so renders past the first page still show", async () => {
    listMock.mockImplementation(async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
      if (prefix === songs && !cursor) return { blobs: [], hasMore: true, cursor: "page-2" };
      if (prefix === songs && cursor === "page-2") {
        return { blobs: [{ pathname: `${songs}crack-haul/renders/seg-2/plate-1/crack-haul-clip-02a-0040-0090.mp4`, url: "https://x/new.mp4", uploadedAt: at("2026-09-30T00:00:00Z") }] };
      }
      return { blobs: [] };
    });
    const { GET } = await importRoute();
    const body = await (await GET(getRequest("?segmentIds=seg-2"))).json();
    expect(body.renders).toHaveLength(1);
  });

  it("Remove clears the plate's files in both places, and only that plate's", async () => {
    listMock.mockImplementation(async ({ prefix }: { prefix: string }) => {
      if (prefix === `${CLIP_RENDER_PATH_PREFIX}seg-2/plate-1/`) {
        return { blobs: [{ pathname: `${CLIP_RENDER_PATH_PREFIX}seg-2/plate-1/02_0040-0090_render.mp4`, url: "u", uploadedAt: at("2026-09-01T00:00:00Z") }] };
      }
      if (prefix === songs) {
        return {
          blobs: [
            { pathname: `${songs}crack-haul/renders/seg-2/plate-1/crack-haul-clip-02a-0040-0090.mp4`, url: "u", uploadedAt: at("2026-09-30T00:00:00Z") },
            { pathname: `${songs}crack-haul/renders/seg-2/plate-1/crack-haul-clip-02a-0040-0090-last-frame.jpg`, url: "u", uploadedAt: at("2026-09-30T00:00:00Z") },
            { pathname: `${songs}crack-haul/renders/seg-2/plate-2/crack-haul-clip-02b-0040-0090.mp4`, url: "u", uploadedAt: at("2026-09-30T00:00:00Z") },
            { pathname: `${songs}crack-haul/plates/crack-haul-clip-02a.jpg`, url: "u", uploadedAt: at("2026-09-30T00:00:00Z") },
          ],
        };
      }
      return { blobs: [] };
    });
    delMock.mockResolvedValue(undefined);
    const { DELETE } = await importRoute();
    const body = await (await DELETE(deleteRequest("?segmentId=seg-2&plateId=plate-1"))).json();
    expect(body).toEqual({ deleted: true });
    expect(delMock).toHaveBeenCalledWith([
      `${CLIP_RENDER_PATH_PREFIX}seg-2/plate-1/02_0040-0090_render.mp4`,
      `${songs}crack-haul/renders/seg-2/plate-1/crack-haul-clip-02a-0040-0090.mp4`,
      `${songs}crack-haul/renders/seg-2/plate-1/crack-haul-clip-02a-0040-0090-last-frame.jpg`,
    ]);
  });
});
