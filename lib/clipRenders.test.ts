import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildForceDownloadUrl,
  buildRendersZip,
  fetchPersistedClipRenders,
  toBundleEntries,
  type PersistedClipRender,
} from "./clipRenders";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

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
      { segmentId: "seg-1", url: "https://x.public.blob.vercel-storage.com/a.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
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
          { segmentId: "seg-1", url: "https://x/a.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
          { segmentId: "seg-2" }, // missing fields
          "not even an object",
        ],
      })
    );

    const outcome = await fetchPersistedClipRenders(["seg-1", "seg-2"]);
    expect(outcome).toEqual({
      ok: true,
      renders: [{ segmentId: "seg-1", url: "https://x/a.mp4", clipIndex: 1, startSec: 0, endSec: 40 }],
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

describe("toBundleEntries", () => {
  it("names each entry with this feature's own zero-padded numeric filename convention", () => {
    const entries = toBundleEntries([
      { segmentId: "seg-1", url: "https://x/a.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
      { segmentId: "seg-2", url: "https://x/b.mp4", clipIndex: 2, startSec: 40, endSec: 90 },
    ]);
    expect(entries.map((e) => e.filename)).toEqual(["01_0000-0040_render.mp4", "02_0040-0090_render.mp4"]);
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

  it("fetches every render's bytes and bundles them into a real zip unzip can extract, named per this feature's numeric convention", async () => {
    const bodyA = new TextEncoder().encode("fake mp4 for clip one");
    const bodyB = new TextEncoder().encode("fake mp4 for clip two, a little longer this time");
    fetchMock
      .mockResolvedValueOnce(new Response(bodyA))
      .mockResolvedValueOnce(new Response(bodyB));

    const outcome = await buildRendersZip([
      { segmentId: "seg-1", url: "https://x/a.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
      { segmentId: "seg-2", url: "https://x/b.mp4", clipIndex: 2, startSec: 40, endSec: 90 },
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
      { segmentId: "seg-1", url: "https://x/a.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
    ]);
    expect(outcome).toEqual({ ok: false, message: "Downloading 01_0000-0040_render.mp4 returned HTTP 404." });
  });

  it("reports an honest failure when the network itself fails, e.g. a CORS regression", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await buildRendersZip([
      { segmentId: "seg-1", url: "https://x/a.mp4", clipIndex: 1, startSec: 0, endSec: 40 },
    ]);
    expect(outcome).toEqual({ ok: false, message: "Failed to fetch" });
  });
});
