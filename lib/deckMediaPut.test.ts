import { beforeEach, describe, expect, it, vi } from "vitest";

const putMock = vi.fn();
vi.mock("@vercel/blob", () => ({ put: (...a: unknown[]) => putMock(...a) }));

import { putDeckMediaOrLegacy } from "./deckMediaPut";

const target = { folder: "deck/shorts/shorts/short-3f9a2c", name: "short-3f9a2c-clip-02" };
const exists = () => new Error("Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.");

beforeEach(() => putMock.mockReset());

describe("putDeckMediaOrLegacy", () => {
  it("saves at the readable name with overwrite off", async () => {
    putMock.mockImplementation(async (pathname: string) => ({ url: `https://b/${pathname}`, pathname }));
    const out = await putDeckMediaOrLegacy(Buffer.from("x"), { target, ext: "mp4", contentType: "video/mp4", legacyPathname: "skidmarks/adult-shorts/1.mp4" });
    expect(out.pathname).toBe("deck/shorts/shorts/short-3f9a2c/short-3f9a2c-clip-02.mp4");
    expect(putMock).toHaveBeenCalledWith(out.pathname, expect.anything(), expect.objectContaining({ allowOverwrite: false, addRandomSuffix: false }));
  });

  it("moves on to -v2, -v3 when a name is taken, never overwriting", async () => {
    putMock
      .mockRejectedValueOnce(exists())
      .mockRejectedValueOnce(exists())
      .mockImplementation(async (pathname: string) => ({ url: `https://b/${pathname}`, pathname }));
    const out = await putDeckMediaOrLegacy(Buffer.from("x"), { target, ext: "mp4", contentType: "video/mp4", legacyPathname: "legacy.mp4" });
    expect(out.pathname).toBe("deck/shorts/shorts/short-3f9a2c/short-3f9a2c-clip-02-v3.mp4");
    for (const call of putMock.mock.calls) expect(call[2]).toMatchObject({ allowOverwrite: false });
  });

  it("falls back to the old path on any other failure", async () => {
    putMock.mockRejectedValueOnce(new Error("network")).mockImplementation(async (pathname: string) => ({ url: `https://b/${pathname}`, pathname }));
    const out = await putDeckMediaOrLegacy(Buffer.from("x"), { target, ext: "mp4", contentType: "video/mp4", legacyPathname: "skidmarks/adult-shorts/1.mp4" });
    expect(out.pathname).toBe("skidmarks/adult-shorts/1.mp4");
    expect(putMock.mock.calls[1][2]).not.toHaveProperty("allowOverwrite");
  });

  it("uses the old path exactly as before without a target", async () => {
    putMock.mockImplementation(async (pathname: string) => ({ url: `https://b/${pathname}`, pathname }));
    await putDeckMediaOrLegacy(Buffer.from("x"), { target: null, ext: "jpg", contentType: "image/jpeg", legacyPathname: "skidmarks/plate-stills/siray-1.jpg" });
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenCalledWith("skidmarks/plate-stills/siray-1.jpg", expect.anything(), {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
    });
  });
});
