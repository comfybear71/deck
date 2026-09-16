import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  list: (...args: unknown[]) => listMock(...args),
  put: (...args: unknown[]) => putMock(...args),
}));

async function importRoute() {
  return await import("./route");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const INDEX_PATHNAME = "skidmarks/archive/index.json";
const goodSong = {
  id: "song-1",
  bandId: "band-1",
  bandName: "Jack Ash",
  fileName: "trapped.mp3",
  archivedAt: 1,
  durationSec: 60,
  clipCount: 4,
  renderedPlateCount: 4,
  snapshotUrl: "https://blob.example/skidmarks/archive/song-1/snapshot.json",
};

function mockFetchResponses(map: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = map[url];
      if (body === undefined) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    })
  );
}

describe("GET /api/skidmarks/archive", () => {
  beforeEach(() => {
    listMock.mockReset();
    putMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns configured:false, not a crash, when Blob itself isn't reachable", async () => {
    listMock.mockRejectedValueOnce(new Error("no BLOB_READ_WRITE_TOKEN"));
    const { GET } = await importRoute();
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ configured: false, songs: [], error: "no BLOB_READ_WRITE_TOKEN" });
  });

  it("returns the index as-is when every snapshot is already listed — no orphans, no extra write", async () => {
    listMock
      .mockResolvedValueOnce({ blobs: [{ pathname: INDEX_PATHNAME, url: "https://blob.example/index.json", uploadedAt: new Date() }] })
      .mockResolvedValueOnce({
        blobs: [
          { pathname: "skidmarks/archive/index.json", url: "https://blob.example/index.json", uploadedAt: new Date() },
          { pathname: "skidmarks/archive/song-1/snapshot.json", url: goodSong.snapshotUrl, uploadedAt: new Date() },
        ],
      });
    mockFetchResponses({ "https://blob.example/index.json": [goodSong] });

    const { GET } = await importRoute();
    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({ configured: true, songs: [goodSong] });
    expect(putMock).not.toHaveBeenCalled(); // already consistent — no write needed
  });

  it("real recovery case (2026-09-16): a snapshot that uploaded but was never listed reappears on the shelf, self-healed", async () => {
    // The index only knows about song-1; song-2's full snapshot exists
    // in Blob (it uploaded fine) but its index POST never landed.
    listMock
      .mockResolvedValueOnce({ blobs: [{ pathname: INDEX_PATHNAME, url: "https://blob.example/index.json", uploadedAt: new Date() }] })
      .mockResolvedValueOnce({
        blobs: [
          { pathname: "skidmarks/archive/index.json", url: "https://blob.example/index.json", uploadedAt: new Date() },
          { pathname: "skidmarks/archive/song-1/snapshot.json", url: goodSong.snapshotUrl, uploadedAt: new Date("2026-09-14T00:00:00Z") },
          {
            pathname: "skidmarks/archive/song-2/snapshot.json",
            url: "https://blob.example/skidmarks/archive/song-2/snapshot.json",
            uploadedAt: new Date("2026-09-16T01:00:00Z"),
          },
        ],
      });
    mockFetchResponses({
      "https://blob.example/index.json": [goodSong],
      "https://blob.example/skidmarks/archive/song-2/snapshot.json": {
        band: { id: "band-2", name: "Jack Ash", coverImage: "https://blob.example/cover.jpg" },
        mp3: {
          fileName: "give-me-something.mp3",
          durationSec: 180,
          audioUrl: "https://blob.example/song.mp3",
          segments: [
            { plates: [{ still: { dataUrl: "https://blob.example/still.jpg" } }] },
            { plates: [{}] }, // no still — not rendered
          ],
        },
      },
    });

    const { GET } = await importRoute();
    const res = await GET();
    const body = await res.json();

    expect(body.configured).toBe(true);
    expect(body.songs).toHaveLength(2);
    const recovered = body.songs.find((s: { id: string }) => s.id === "song-2");
    expect(recovered).toMatchObject({
      id: "song-2",
      bandId: "band-2",
      bandName: "Jack Ash",
      fileName: "give-me-something.mp3",
      durationSec: 180,
      clipCount: 2,
      renderedPlateCount: 1,
      snapshotUrl: "https://blob.example/skidmarks/archive/song-2/snapshot.json",
      audioUrl: "https://blob.example/song.mp3",
    });
    // Self-healed: written back to the index so it stays found on every future load, not just this one.
    expect(putMock).toHaveBeenCalledTimes(1);
    const [, writtenBody] = putMock.mock.calls[0];
    const written = JSON.parse(writtenBody as string);
    expect(written).toHaveLength(2);
    expect(written.some((s: { id: string }) => s.id === "song-2")).toBe(true);
  });

  it("skips a snapshot blob that isn't a real, complete song rather than listing a broken row", async () => {
    listMock
      .mockResolvedValueOnce({ blobs: [] })
      .mockResolvedValueOnce({
        blobs: [{ pathname: "skidmarks/archive/broken/snapshot.json", url: "https://blob.example/broken.json", uploadedAt: new Date() }],
      });
    mockFetchResponses({ "https://blob.example/broken.json": { band: null, mp3: null } });

    const { GET } = await importRoute();
    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({ configured: true, songs: [] });
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/skidmarks/archive", () => {
  beforeEach(() => {
    listMock.mockReset();
    putMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("adds a new song to the front of the index", async () => {
    listMock.mockResolvedValueOnce({ blobs: [] });
    const { POST } = await importRoute();
    const res = await POST(postRequest({ action: "add", song: goodSong }));
    const body = await res.json();
    expect(body).toEqual({ ok: true, songs: [goodSong] });
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown action", async () => {
    const { POST } = await importRoute();
    const res = await POST(postRequest({ action: "nope" }));
    expect(res.status).toBe(400);
  });
});
