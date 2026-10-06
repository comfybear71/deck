import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
}));

const extractMock = vi.fn();
vi.mock("@/lib/serverVideoFrame", () => ({
  extractLastVideoFrameServer: (...args: unknown[]) => extractMock(...args),
}));

import { POST } from "./route";

const ALLOWED_VIDEO_URL = "https://abc123.public.blob.vercel-storage.com/skidmarks/clip-renders/seg/plate/01_0000-0040_render.mp4";
const EXTRACTED_FRAME_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
const SAVED_FRAME_URL = "https://abc123.public.blob.vercel-storage.com/skidmarks/chain-last-frame/deadbeef.jpg";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/last-frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/skidmarks/last-frame", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    putMock.mockReset();
    extractMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts and saves the last frame for an allowed, real clip URL — no paid API call involved", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "video/mp4" } })
    );
    extractMock.mockResolvedValueOnce({ ok: true, bytes: EXTRACTED_FRAME_BYTES });
    putMock.mockResolvedValueOnce({ url: SAVED_FRAME_URL, pathname: "skidmarks/chain-last-frame/deadbeef.jpg" });
    // The HEAD verify.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const res = await POST(postRequest({ videoUrl: ALLOWED_VIDEO_URL }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, url: SAVED_FRAME_URL });
    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenCalledTimes(1);
    // Content-addressed: same URL in, same pathname out, every time.
    const [pathname, , options] = putMock.mock.calls[0];
    expect(pathname).toMatch(/^skidmarks\/chain-last-frame\/[0-9a-f]{40}\.jpg$/);
    expect(options).toMatchObject({ contentType: "image/jpeg", allowOverwrite: true });
  });

  it("refuses a disallowed host without fetching anything at all", async () => {
    const res = await POST(postRequest({ videoUrl: "https://attacker.test/clip.mp4" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(extractMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("refuses a missing videoUrl", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses invalid JSON without throwing", async () => {
    const res = await POST(
      new Request("http://localhost/api/skidmarks/last-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an honest failure when the clip host itself fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await POST(postRequest({ videoUrl: ALLOWED_VIDEO_URL }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/404/);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("reports an honest failure when extraction itself fails, rather than pretending to succeed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "video/mp4" } })
    );
    extractMock.mockResolvedValueOnce({ ok: false, message: "ffmpeg could not extract the last frame: corrupt input." });

    const res = await POST(postRequest({ videoUrl: ALLOWED_VIDEO_URL }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body).toEqual({ ok: false, message: "ffmpeg could not extract the last frame: corrupt input." });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("reports an honest failure when the extracted frame can't be saved to Blob", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "video/mp4" } })
    );
    extractMock.mockResolvedValueOnce({ ok: true, bytes: EXTRACTED_FRAME_BYTES });
    putMock.mockRejectedValueOnce(new Error("no Blob store configured"));

    const res = await POST(postRequest({ videoUrl: ALLOWED_VIDEO_URL }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/no Blob store configured/);
  });

  it("the same source video always resolves to the same saved pathname", async () => {
    for (let i = 0; i < 2; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "video/mp4" } })
      );
      extractMock.mockResolvedValueOnce({ ok: true, bytes: EXTRACTED_FRAME_BYTES });
      putMock.mockResolvedValueOnce({ url: SAVED_FRAME_URL, pathname: "skidmarks/chain-last-frame/deadbeef.jpg" });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await POST(postRequest({ videoUrl: ALLOWED_VIDEO_URL }));
    }
    expect(putMock.mock.calls[0][0]).toBe(putMock.mock.calls[1][0]);
  });
});
