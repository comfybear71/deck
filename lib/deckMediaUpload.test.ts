import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({ upload: (...a: unknown[]) => uploadMock(...a) }));

import { uploadToDeckTreeOrLegacy } from "./deckMediaUpload";

const target = { folder: "deck/sunnybank/characters/shazza/plates", name: "shazza-plate-07" };
const ok = async (pathname: string) => ({ url: `https://b/${pathname}`, pathname });

beforeEach(() => uploadMock.mockReset());

describe("uploadToDeckTreeOrLegacy", () => {
  it("uploads to the readable name", async () => {
    uploadMock.mockImplementation(ok);
    const out = await uploadToDeckTreeOrLegacy(new Blob(["x"]), "image/jpeg", "jpg", target, () => "legacy.jpg");
    expect(out.pathname).toBe("deck/sunnybank/characters/shazza/plates/shazza-plate-07.jpg");
  });

  it("tries -v2 when the name is taken", async () => {
    uploadMock.mockRejectedValueOnce(new Error("Vercel Blob: This blob already exists")).mockImplementation(ok);
    const out = await uploadToDeckTreeOrLegacy(new Blob(["x"]), "image/jpeg", "jpg", target, () => "legacy.jpg");
    expect(out.pathname).toBe("deck/sunnybank/characters/shazza/plates/shazza-plate-07-v2.jpg");
  });

  it("keeps the old path working when the tree upload fails for another reason", async () => {
    uploadMock.mockRejectedValueOnce(new Error("Failed to retrieve the client token")).mockImplementation(ok);
    const out = await uploadToDeckTreeOrLegacy(new Blob(["x"]), "image/jpeg", "jpg", target, () => "skidmarks/member-photos/u.jpg");
    expect(out.pathname).toBe("skidmarks/member-photos/u.jpg");
  });

  it("uses the old path when there's no target or a bad one", async () => {
    uploadMock.mockImplementation(ok);
    expect((await uploadToDeckTreeOrLegacy(new Blob(["x"]), "image/jpeg", "jpg", null, () => "old.jpg")).pathname).toBe("old.jpg");
    expect(
      (await uploadToDeckTreeOrLegacy(new Blob(["x"]), "image/jpeg", "jpg", { folder: "deck/../x", name: "y" }, () => "old2.jpg")).pathname,
    ).toBe("old2.jpg");
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });
});
