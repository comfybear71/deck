import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/skidmarks/h3-key-check", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("says missing and calls nobody when MINIMAX_API_KEY is unset", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET();
    expect(await res.json()).toEqual({ status: "missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only lists tasks (never submits), and never echoes the key", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "secret-test-key");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "ok" });
    expect(text).not.toContain("secret-test-key");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v2/query/video_generation?");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v2/video_generation"))).toBe(false);
  });
});
