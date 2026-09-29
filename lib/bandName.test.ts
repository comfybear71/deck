import { describe, expect, it } from "vitest";
import { renameLegacySeedBand, type SkidmarksBand } from "./skidmarks";

function band(over: Partial<SkidmarksBand>): SkidmarksBand {
  return { id: "solar-rebel", name: "Solar Rebel", tagline: "Ignite the static", coverSeed: 2, members: [], ...over } as SkidmarksBand;
}

describe("renameLegacySeedBand", () => {
  it("renames the untouched demo name to Soul Rebel", () => {
    expect(renameLegacySeedBand(band({})).name).toBe("Soul Rebel");
  });
  it("keeps a name Stuart typed himself", () => {
    expect(renameLegacySeedBand(band({ name: "Rasta Rebel" })).name).toBe("Rasta Rebel");
  });
  it("never touches another band called Solar Rebel", () => {
    expect(renameLegacySeedBand(band({ id: "band_x" })).name).toBe("Solar Rebel");
  });
});
