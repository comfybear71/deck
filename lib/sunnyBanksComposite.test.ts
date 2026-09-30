import { describe, expect, it } from "vitest";
import { resolveBeatStartImage, resolveLocationLock } from "./sunnyBanksComposite";

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
