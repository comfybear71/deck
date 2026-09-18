import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function proxyRequest(rawUrl?: string): Request {
  const base = "http://localhost/api/skidmarks/sunnybank/clip-proxy";
  return new Request(rawUrl === undefined ? base : `${base}?url=${encodeURIComponent(rawUrl)}`);
}

const ALLOWED = "https://skidmarks.aiglitch.app/api/crash/mobile/clip?fileName=a.mp4";

describe("GET /api/skidmarks/sunnybank/clip-proxy", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams an allowed clip back with its own content type", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4]);
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, { status: 200, headers: { "Content-Type": "video/mp4", "Content-Length": "5" } })
    );

    const res = await GET(proxyRequest(ALLOWED));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Length")).toBe("5");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(String(fetchMock.mock.calls[0][0])).toBe(ALLOWED);
  });

  it("allows an audio clip too — the driving MP3 is fetched the same way", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([9]), { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    );
    const res = await GET(proxyRequest("https://x.public.blob.vercel-storage.com/a.mp3"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
  });

  /** The security-critical ones: a disallowed URL must be refused
   * *before* any fetch happens — the fetch itself is the vulnerability,
   * so "we fetched it but didn't return it" would still be a hole. */
  it("refuses a disallowed host without fetching anything at all", async () => {
    for (const url of [
      "https://example.com/clip.mp4",
      "http://skidmarks.aiglitch.app/clip.mp4",
      "https://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "https://skidmarks.aiglitch.app@attacker.test/clip.mp4",
    ]) {
      const res = await GET(proxyRequest(url));
      expect(res.status, url).toBe(400);
      expect(fetchMock, url).not.toHaveBeenCalled();
    }
  });

  it("does not echo the rejected URL back", async () => {
    const res = await GET(proxyRequest("https://attacker.test/<script>alert(1)</script>"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain("attacker.test");
    expect(JSON.stringify(body)).not.toContain("script");
  });

  it("rejects a missing url param", async () => {
    const res = await GET(proxyRequest());
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to pass off a non-media body as a clip", async () => {
    // A login redirect or an error page must read as a failure, not
    // land in the zip as a .mp4 full of HTML.
    fetchMock.mockResolvedValueOnce(
      new Response("<html>sign in</html>", { status: 200, headers: { "Content-Type": "text/html" } })
    );
    const res = await GET(proxyRequest(ALLOWED));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/video or audio/i);
  });

  it("passes a 404 through as a 404, and other upstream failures as 502", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(proxyRequest(ALLOWED))).status).toBe(404);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect((await GET(proxyRequest(ALLOWED))).status).toBe(502);
  });

  it("reports an unreachable host honestly instead of throwing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    const res = await GET(proxyRequest(ALLOWED));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("socket hang up");
  });

  it("reports a timeout as a timeout", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeout);
    const res = await GET(proxyRequest(ALLOWED));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/did not respond in time/i);
  });
});
