import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const BLOB = "https://abc123.public.blob.vercel-storage.com";

afterEach(() => {
  vi.unstubAllGlobals();
});

function formRequest(value: unknown): Request {
  const form = new FormData();
  form.set("request", JSON.stringify(value));
  return new Request("http://x/api/skidmarks/adult-shorts/clips-zip", { method: "POST", body: form });
}

describe("POST /api/skidmarks/adult-shorts/clips-zip", () => {
  it("answers a plain 400 and fetches nothing for a link that isn't Deck's", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(formRequest({ episode: "ep01-x", clips: [{ url: "https://evil.test/a.mp4", shot: 1, character: "" }] }));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/isn't one of Deck's saved clips/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("streams a zip named for the episode, and lists a clip it couldn't fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("/1.mp4") ? new Response(new Uint8Array([1, 2, 3])) : new Response("no", { status: 404 }))),
    );
    const res = await POST(
      formRequest({
        episode: "ep01-blonde-girl-1",
        clips: [
          { url: `${BLOB}/a/1.mp4`, shot: 1, character: "Skylar" },
          { url: `${BLOB}/a/2.mp4`, shot: 2, character: "Skylar" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ep01-blonde-girl-1.zip"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("ep01-blonde-girl-1-shot-01-skylar.mp4");
    expect(text).toContain("missing.txt");
    expect(text).toContain("ep01-blonde-girl-1-shot-02-skylar.mp4: the clip host answered 404");
  });
});
