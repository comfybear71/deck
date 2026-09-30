import { describe, expect, it } from "vitest";
import { builtInDeckLocations } from "./deckLocations";
import { findSunnyBanksLocation, sunnyBanksLocationList, sunnyBanksLocationProblem } from "./sunnyBanksLocations";
import { buildSunnyBanksGodScriptPrompt, listSunnyBanksLocationIds } from "./sunnyBanksGodScriptGuide";

describe("Sunnybank's locations for the renderer (2026-09-30)", () => {
  it("is the built-ins until saved, then the saved list with Blob pictures", () => {
    expect(sunnyBanksLocationList(null)).toHaveLength(9);
    const boat = {
      id: "loc_sunnybank_boat_ramp",
      genre: "sunnybank" as const,
      key: "boat_ramp",
      name: "Boat Ramp",
      pictureUrl: "https://abc.public.blob.vercel-storage.com/deck/sunnybank/locations/boat-ramp.jpg",
      createdAt: 50,
    };
    const list = sunnyBanksLocationList({ locations: [...builtInDeckLocations("sunnybank"), boat] });
    expect(list.at(-1)).toEqual({ id: "boat_ramp", label: "Boat Ramp", image: boat.pictureUrl });
    expect(findSunnyBanksLocation(list, "Boat Ramp")?.id).toBe("boat_ramp");
    expect(findSunnyBanksLocation(list, "office_storefront")?.label).toBe("Office Storefront");
  });

  it("an unknown or picture-less location is a problem, never the storefront", () => {
    const list = sunnyBanksLocationList(null);
    expect(sunnyBanksLocationProblem(list, "park_site_4")).toBeNull();
    expect(sunnyBanksLocationProblem(list, "moon_base")).toMatch(/Unknown location "moon_base"/);
    const noPic = [{ id: "shed", label: "Shed", image: "" }];
    expect(sunnyBanksLocationProblem(noPic, "shed")).toMatch(/Shed has no picture yet/);
  });

  it("the God-script guide lists the saved locations", () => {
    expect(listSunnyBanksLocationIds().map((l) => l.id)).toContain("park_site_4");
    const custom = [{ id: "boat_ramp", label: "Boat Ramp" }];
    expect(listSunnyBanksLocationIds(custom)).toEqual(custom);
    expect(buildSunnyBanksGodScriptPrompt(custom)).toContain("boat_ramp");
    expect(buildSunnyBanksGodScriptPrompt(custom)).not.toContain("water_tank_dam  ");
  });
});
