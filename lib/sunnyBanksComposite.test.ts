import { afterEach, describe, expect, it, vi } from "vitest";
import { SUNNY_BANKS_CAST } from "./sunnyBanks";
import {
  compositeSunnyBanksCharacterOntoLocation,
  readSunnyBanksBlobPictureDataUrl,
  resolveBeatStartImage,
  resolveLocationLock,
} from "./sunnyBanksComposite";

describe("Sunnybank beat location (2026-09-30)", () => {
  it("names the real place in the compositing prompt, never quietly the storefront", () => {
    expect(resolveLocationLock("park_site_4").label).toBe("Park Site 4");
    expect(resolveLocationLock("boat_ramp", "Boat Ramp")).toEqual({ id: "boat_ramp", label: "Boat Ramp", image: "" });
    expect(resolveLocationLock("boat_ramp").label).toBe("boat ramp");
    expect(resolveLocationLock("office_storefront", "The Shop").label).toBe("The Shop");
    expect(resolveLocationLock("").label).toBe("the location in image 1");
    expect(resolveLocationLock("moon_base").label).not.toMatch(/Storefront/);
  });

  it("uses the sent canvas, else the location's own picture from the repo or Deck's Blob only", async () => {
    expect(await resolveBeatStartImage("data:image/jpeg;base64,AAAA", "/skidmarks/sunnybanks/park-site-4.jpg")).toBe("data:image/jpeg;base64,AAAA");
    expect(await resolveBeatStartImage("", "/skidmarks/sunnybanks/park-site-4.jpg")).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    expect(await resolveBeatStartImage("", "/etc/passwd")).toBe("");
    expect(await resolveBeatStartImage("", "https://evil.test/x.jpg")).toBe("");
    expect(await resolveBeatStartImage(undefined, undefined)).toBe("");
  });
});

describe("Cast card pictures only (2026-10-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("no Cast card picture is an error, never a quiet skip onto the bare location", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("XAI_API_KEY", "test-xai-key");
    const out = await compositeSunnyBanksCharacterOntoLocation({ locationDataUrl: "data:image/jpeg;base64,AAAA", character: SUNNY_BANKS_CAST.Dazza });
    expect(out).toMatchObject({ ok: false, status: 400, code: "missing_cast_picture" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a character picture is only ever read from Deck's Blob, never a repo file", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await readSunnyBanksBlobPictureDataUrl("/skidmarks/sunnybanks/office-booth.jpg")).toBeNull();
    expect(await readSunnyBanksBlobPictureDataUrl("https://evil.test/dazza.jpg")).toBeNull();
    expect(await readSunnyBanksBlobPictureDataUrl("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
