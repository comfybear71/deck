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

  it("refuses anything else", async () => {
    expect(await tokenOptionsFor("deck/../skidmarks/x.jpg")).toBeInstanceOf(Error);
    expect(await tokenOptionsFor("deck/Sunnybank/X.jpg")).toBeInstanceOf(Error);
    expect(await tokenOptionsFor("other/x.jpg")).toBeInstanceOf(Error);
  });
});
