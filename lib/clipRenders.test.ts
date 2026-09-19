import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildForceDownloadUrl,
  buildRendersZip,
  deletePersistedClipRender,
  fetchPersistedClipRenders,
  findPersistedRenderForClip,
  persistedRenderKey,
  sortPersistedRenders,
  type PersistedClipRender,
} from "./clipRenders";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("persistedRenderKey", () => {
  it("joins segmentId and plateId with a colon", () => {
    expect(persistedRenderKey("seg-1", "plate-1")).toBe("seg-1:plate-1");
  });
});

describe("findPersistedRenderForClip", () => {
  const render = (overrides: Partial<PersistedClipRender> = {}): PersistedClipRender => ({
    segmentId: "seg-old",
    plateId: "plate-old",
    url: "https://blob.example/clip.mp4",
    filename: "01_clip.mp4",
    clipIndex: 1,
    startSec: 0,
    endSec: 10,
    ...overrides,
  });

  it("hits by segmentId/plateId first", () => {
    const map = new Map<string, PersistedClipRender>();
    const r = render();
    map.set(persistedRenderKey(r.segmentId, r.plateId), r);
    expect(findPersistedRenderForClip(map, "seg-old", "plate-old", 0, 10)).toBe(r);
  });

  it("falls back to exact startSec/endSec when ids were reminted", () => {
    const map = new Map<string, PersistedClipRender>();
    const r = render({ segmentId: "seg-old", plateId: "plate-old", startSec: 0, endSec: 10 });
    map.set(persistedRenderKey(r.segmentId, r.plateId), r);
    // New reminted ids, same time range
    expect(findPersistedRenderForClip(map, "seg-new", "plate-new", 0, 10)).toBe(r);
  });

  it("returns undefined when neither id nor time range match", () => {
    const map = new Map<string, PersistedClipRender>();
    const r = render({ startSec: 0, endSec: 10 });
    map.set(persistedRenderKey(r.segmentId, r.plateId), r);
    expect(findPersistedRenderForClip(map, "seg-x", "plate-x", 50, 60)).toBeUndefined();
  });
});

describe("fetchPersistedClipRenders", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok with an empty list without calling fetch when given no segment ids", async () => {
    const outcome = await fetchPersistedClipRenders([]);
    expect(outcome).toEqual({ ok: true, renders: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests every given segment id as one comma-separated query param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: true, renders: [] }));
    await fetchPersistedClipRenders(["seg-1", "seg-2"]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/clip-renders?segmentIds=seg-1%2Cseg-2");
  });

  it("returns the real persisted renders the route reports", async () => {
    const renders: PersistedClipRender[] = [
      {
        segmentId: "seg-1",
        plateId: "plate-1",
        url: "https://x.public.blob.vercel-storage.com/a.mp4",
        filename: "01_0000-0040_render.mp4",
        clipIndex: 1,
        startSec: 0,
        endSec: 40,
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: true, renders }));

    const outcome = await fetchPersistedClipRenders(["seg-1"]);
    expect(outcome).toEqual({ ok: true, renders });
  });

  it("filters out malformed entries rather than crashing on an unexpected shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
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
          { segmentId: "seg-2" }, // missing fields
          "not even an object",
        ],
      })
    );

    const outcome = await fetchPersistedClipRenders(["seg-1", "seg-2"]);
    expect(outcome).toEqual({
      ok: true,
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
      ],
    });
  });

  it("reports the honest unconfigured/failure outcome without throwing when Blob isn't set up", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { configured: false, renders: [], error: "Vercel Blob is not configured." })
    );

    const outcome = await fetchPersistedClipRenders(["seg-1"]);
    expect(outcome).toEqual({ ok: false, renders: [], message: "Vercel Blob is not configured." });
  });

  it("reports a real network error honestly rather than throwing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await fetchPersistedClipRenders(["seg-1"]);
    expect(outcome).toEqual({ ok: false, renders: [], message: "Failed to fetch" });
  });
});

function render(overrides: Partial<PersistedClipRender>): PersistedClipRender {
  return {
    segmentId: "seg",
    plateId: "plate",
    url: "https://x/a.mp4",
    filename: "01_0000-0040_render.mp4",
    clipIndex: 1,
    startSec: 0,
    endSec: 40,
    ...overrides,
  };
}

describe("sortPersistedRenders", () => {
  it("orders by clip position (clipIndex), regardless of input order", () => {
    const third = render({ segmentId: "seg-3", plateId: "p", clipIndex: 3, startSec: 80, endSec: 120, filename: "03_0080-0120_render.mp4" });
    const first = render({ segmentId: "seg-1", plateId: "p", clipIndex: 1, startSec: 0, endSec: 40, filename: "01_0000-0040_render.mp4" });
    const second = render({ segmentId: "seg-2", plateId: "p", clipIndex: 2, startSec: 40, endSec: 80, filename: "02_0040-0080_render.mp4" });

    expect(sortPersistedRenders([third, first, second])).toEqual([first, second, third]);
  });

  it("orders more than one plate on the same clip by their lettered filename (01a before 01b)", () => {
    const plateB = render({ segmentId: "seg-1", plateId: "plate-b", clipIndex: 1, startSec: 0, endSec: 40, filename: "01b_0000-0040_render.mp4" });
    const plateA = render({ segmentId: "seg-1", plateId: "plate-a", clipIndex: 1, startSec: 0, endSec: 40, filename: "01a_0000-0040_render.mp4" });

    expect(sortPersistedRenders([plateB, plateA])).toEqual([plateA, plateB]);
  });

  it("never sorts a 3-digit clip index lexically after a 2-digit one — clipIndex is numeric, not string, comparison", () => {
    const clip99 = render({ segmentId: "seg-99", plateId: "p", clipIndex: 99, startSec: 3900, endSec: 3940, filename: "99_3900-3940_render.mp4" });
    const clip100 = render({ segmentId: "seg-100", plateId: "p", clipIndex: 100, startSec: 3940, endSec: 3980, filename: "100_3940-3980_render.mp4" });

    expect(sortPersistedRenders([clip100, clip99])).toEqual([clip99, clip100]);
  });

  it("does not mutate the input array", () => {
    const list = [render({ clipIndex: 2 }), render({ clipIndex: 1 })];
    const original = [...list];
    sortPersistedRenders(list);
    expect(list).toEqual(original);
  });

  it("keeps stable order after a re-render overwrites the same plate's url \u2014 never 'most recently rendered'", () => {
    // Simulates `hooks/useSkidmarksClipRenders.ts`'s `addRender`: a
    // re-render of an already-rendered plate only replaces that plate's
    // `url` (same segmentId/plateId/clipIndex/startSec/endSec/filename —
    // `lib/clipRenderBlob.ts`'s pathname is stable across takes), it
    // never changes its position-defining fields.
    const doorPlate = render({ segmentId: "seg-1", plateId: "door", clipIndex: 1, startSec: 0, endSec: 40, filename: "01_0000-0040_render.mp4", url: "https://x/door-v1.mp4" });
    const keyholePlate = render({ segmentId: "seg-2", plateId: "keyhole", clipIndex: 2, startSec: 40, endSec: 80, filename: "02_0040-0080_render.mp4", url: "https://x/keyhole-v1.mp4" });
    const jackPlate = render({ segmentId: "seg-3", plateId: "jack", clipIndex: 3, startSec: 80, endSec: 120, filename: "03_0080-0120_render.mp4", url: "https://x/jack-v1.mp4" });

    const before = sortPersistedRenders([jackPlate, doorPlate, keyholePlate]);
    expect(before.map((r) => r.plateId)).toEqual(["door", "keyhole", "jack"]);

    // Re-render the *first* clip's plate (door) \u2014 a fresh url, same
    // identity/position fields, "just re-rendered" so it would sort
    // first under a naive "most recently rendered" order.
    const doorPlateReRendered = { ...doorPlate, url: "https://x/door-v2.mp4" };
    const after = sortPersistedRenders([jackPlate, keyholePlate, doorPlateReRendered]);
    expect(after.map((r) => r.plateId)).toEqual(["door", "keyhole", "jack"]);
    expect(after[0].url).toBe("https://x/door-v2.mp4");
  });
});

describe("deletePersistedClipRender", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a DELETE with segmentId/plateId as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deleted: true }));
    await deletePersistedClipRender("seg-1", "plate-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/clip-renders?segmentId=seg-1&plateId=plate-1");
    expect(init).toEqual({ method: "DELETE" });
  });

  it("returns ok on a real deleted:true response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deleted: true }));
    const outcome = await deletePersistedClipRender("seg-1", "plate-1");
    expect(outcome).toEqual({ ok: true });
  });

  it("reports an honest failure \u2014 never a silent success \u2014 when the route reports deleted:false", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { deleted: false, error: "Vercel Blob: No token found." }));
    const outcome = await deletePersistedClipRender("seg-1", "plate-1");
    expect(outcome).toEqual({ ok: false, message: "Vercel Blob: No token found." });
  });

  it("reports an honest failure on a non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "Missing `segmentId`/`plateId`.", code: "invalid_request" }));
    const outcome = await deletePersistedClipRender("", "plate-1");
    expect(outcome).toEqual({ ok: false, message: "Missing `segmentId`/`plateId`." });
  });

  it("reports a real network error honestly rather than throwing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await deletePersistedClipRender("seg-1", "plate-1");
    expect(outcome).toEqual({ ok: false, message: "Failed to fetch" });
  });
});

describe("buildForceDownloadUrl", () => {
  it("appends Vercel Blob's documented ?download=1 param", () => {
    expect(buildForceDownloadUrl("https://x.public.blob.vercel-storage.com/a.mp4")).toBe(
      "https://x.public.blob.vercel-storage.com/a.mp4?download=1"
    );
  });

  it("uses & instead of ? when the url already has a query string", () => {
    expect(buildForceDownloadUrl("https://x/a.mp4?v=2")).toBe("https://x/a.mp4?v=2&download=1");
  });
});

describe("buildRendersZip", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches every render's bytes and bundles them into a real zip unzip can extract, named per each render's own filename", async () => {
    const bodyA = new TextEncoder().encode("fake mp4 for clip one");
    const bodyB = new TextEncoder().encode("fake mp4 for clip two, a little longer this time");
    fetchMock
      .mockResolvedValueOnce(new Response(bodyA))
      .mockResolvedValueOnce(new Response(bodyB));

    const outcome = await buildRendersZip([
      { segmentId: "seg-1", plateId: "plate-1", url: "https://x/a.mp4", filename: "01_0000-0040_render.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
      { segmentId: "seg-2", plateId: "plate-1", url: "https://x/b.mp4", filename: "02_0040-0090_render.mp4", clipIndex: 2, startSec: 40, endSec: 90 },
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");

    const dir = mkdtempSync(join(tmpdir(), "skidmarks-bundle-test-"));
    const zipPath = join(dir, "bundle.zip");
    writeFileSync(zipPath, outcome.zipBytes);
    try {
      execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
      const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
      expect(listing).toContain("01_0000-0040_render.mp4");
      expect(listing).toContain("02_0040-0090_render.mp4");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports an honest failure (not a throw) when a render's fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const outcome = await buildRendersZip([
      { segmentId: "seg-1", plateId: "plate-1", url: "https://x/a.mp4", filename: "01_0000-0040_render.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
    ]);
    expect(outcome).toEqual({ ok: false, message: "Downloading 01_0000-0040_render.mp4 returned HTTP 404." });
  });

  it("reports an honest failure when the network itself fails, e.g. a CORS regression", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await buildRendersZip([
      { segmentId: "seg-1", plateId: "plate-1", url: "https://x/a.mp4", filename: "01_0000-0040_render.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
    ]);
    expect(outcome).toEqual({ ok: false, message: "Failed to fetch" });
  });
});
