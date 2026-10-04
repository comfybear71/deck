import { beforeEach, describe, expect, it, vi } from "vitest";

type TokenHook = (pathname: string) => Promise<Record<string, unknown>>;
const handleUploadMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({ handleUpload: (...a: unknown[]) => handleUploadMock(...a) }));

import { POST } from "./route";

async function tokenOptionsFor(pathname: string): Promise<Record<string, unknown> | Error> {
  let result: Record<string, unknown> | Error = new Error("not called");
  handleUploadMock.mockImplementationOnce(async ({ onBeforeGenerateToken }: { onBeforeGenerateToken: TokenHook }) => {
    try {
      result = await onBeforeGenerateToken(pathname);
    } catch (err) {
      result = err as Error;
    }
    return { ok: true };
  });
  await POST(new Request("https://deck.test/api/skidmarks/blob-upload", { method: "POST", body: JSON.stringify({ type: "blob.generate-client-token" }) }));
  return result;
}

beforeEach(() => handleUploadMock.mockReset());

describe("POST /api/skidmarks/blob-upload", () => {
  it("issues deck/ tokens with overwrite off", async () => {
    const opts = await tokenOptionsFor("deck/sunnybank/characters/shazza/plates/shazza-plate-07.jpg");
    expect(opts).toMatchObject({ allowOverwrite: false, addRandomSuffix: false });
  });

  it("keeps the old prefixes exactly as before", async () => {
    expect(await tokenOptionsFor("skidmarks/member-photos/abc.jpg")).toMatchObject({ allowOverwrite: true });
    expect(await tokenOptionsFor("skidmarks/mp3-audio/abc.mp3")).toMatchObject({ allowOverwrite: true });
  });

  it("Episode Extras (2026-10-04): an episode's extras folder gets video/audio types, never overwriting", async () => {
    const opts = await tokenOptionsFor("deck/skidmarks/episodes/cornish-arsehole/extras/container-drop.mov");
    expect(opts).toMatchObject({ allowOverwrite: false, addRandomSuffix: false });
    expect((opts as { allowedContentTypes: string[] }).allowedContentTypes).toEqual(
      expect.arrayContaining(["video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/wav"]),
    );
    expect(await tokenOptionsFor("deck/shorts/episodes/ep01-x/extras/scream.wav")).toMatchObject({ allowOverwrite: false });
    // Only the extras folder takes .mov/.wav; nothing else changes.
    expect(await tokenOptionsFor("deck/skidmarks/episodes/cornish-arsehole/act-i/x.mov")).toBeInstanceOf(Error);
    expect(await tokenOptionsFor("deck/skidmarks/episodes/cornish-arsehole/extras/x.exe")).toBeInstanceOf(Error);
  });

  it("refuses anything else", async () => {
    expect(await tokenOptionsFor("deck/../skidmarks/x.jpg")).toBeInstanceOf(Error);
    expect(await tokenOptionsFor("deck/Sunnybank/X.jpg")).toBeInstanceOf(Error);
    expect(await tokenOptionsFor("other/x.jpg")).toBeInstanceOf(Error);
  });
});
