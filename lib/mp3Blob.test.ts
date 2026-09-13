import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  upload: (...args: unknown[]) => uploadMock(...args),
}));

import { fetchSkidmarksMp3AudioUrl, uploadSkidmarksMp3Audio } from "./mp3Blob";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("uploadSkidmarksMp3Audio", () => {
  beforeEach(() => {
    uploadMock.mockReset();
  });

  it("uploads to this audioId's own pathname via the shared blob-upload token route", async () => {
    uploadMock.mockResolvedValueOnce({ url: "https://x.public.blob.vercel-storage.com/skidmarks/mp3-audio/abc.mp3" });

    const outcome = await uploadSkidmarksMp3Audio(new Blob(["fake mp3"]), "abc");

    expect(outcome).toEqual({ ok: true, url: "https://x.public.blob.vercel-storage.com/skidmarks/mp3-audio/abc.mp3" });
    const [pathname, , options] = uploadMock.mock.calls[0];
    expect(pathname).toBe("skidmarks/mp3-audio/abc.mp3");
    expect(options).toMatchObject({
      access: "public",
      handleUploadUrl: "/api/skidmarks/blob-upload",
      contentType: "audio/mpeg",
    });
  });

  it("classifies a missing-credentials failure as honestly unconfigured", async () => {
    uploadMock.mockRejectedValueOnce(new Error("No read-write token found."));
    const outcome = await uploadSkidmarksMp3Audio(new Blob(["x"]), "abc");
    expect(outcome).toEqual({ ok: false, unconfigured: true, message: "No read-write token found." });
  });

  it("classifies any other failure as a real, non-unconfigured failure", async () => {
    uploadMock.mockRejectedValueOnce(new Error("Network error."));
    const outcome = await uploadSkidmarksMp3Audio(new Blob(["x"]), "abc");
    expect(outcome).toEqual({ ok: false, unconfigured: false, message: "Network error." });
  });
});

describe("fetchSkidmarksMp3AudioUrl", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests this audioId as a query param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: true, url: "https://x/a.mp3" }));
    await fetchSkidmarksMp3AudioUrl("abc 123");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/mp3-audio?audioId=abc%20123");
  });

  it("returns the real url the route reports", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: true, url: "https://x/a.mp3" }));
    const outcome = await fetchSkidmarksMp3AudioUrl("abc");
    expect(outcome).toEqual({ ok: true, url: "https://x/a.mp3" });
  });

  it("returns ok with a null url \u2014 a real 'not there yet' answer, not a failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: true, url: null }));
    const outcome = await fetchSkidmarksMp3AudioUrl("abc");
    expect(outcome).toEqual({ ok: true, url: null });
  });

  it("reports the honest unconfigured/failure outcome without throwing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { configured: false, url: null, error: "Vercel Blob is not configured." }));
    const outcome = await fetchSkidmarksMp3AudioUrl("abc");
    expect(outcome).toEqual({ ok: false, message: "Vercel Blob is not configured." });
  });

  it("reports a real network error honestly rather than throwing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await fetchSkidmarksMp3AudioUrl("abc");
    expect(outcome).toEqual({ ok: false, message: "Failed to fetch" });
  });
});
