import { describe, expect, it } from "vitest";
import { formatLocationSeedTree, planLocationSeed } from "./deckLocationsSeed";

describe("planLocationSeed (dry run only; 2026-09-30)", () => {
  it("with nothing saved yet: Sunnybank's nine built-ins, each picture copied to deck/sunnybank/locations/", () => {
    const plan = planLocationSeed(null);
    expect(plan.sessionHasNoList).toBe(true);
    expect(plan.rows).toHaveLength(9);
    expect(plan.rows[6]).toMatchObject({
      itemId: "loc_sunnybank_park_site_4",
      folder: "sunnybank",
      title: "Park Site 4",
      source: "built-in",
      blobCopy: { fromPublicPath: "/skidmarks/sunnybanks/park-site-4.jpg", toPathname: "deck/sunnybank/locations/park-site-4.jpg" },
    });
    expect(formatLocationSeedTree(plan)).toContain("└── Sunnybank\n    └── Locations (9)");
  });

  it("merges in what the session already has, and doesn't re-add built-ins Sunnybank already saved", () => {
    const motel = {
      id: "loc_music_video_roadside_motel",
      genre: "music-video",
      key: "roadside_motel",
      name: "Roadside Motel",
      pictureUrl: "https://abc.public.blob.vercel-storage.com/deck/music-video/locations/roadside-motel.jpg",
      createdAt: 5,
    };
    const shed = { id: "loc_sunnybank_tin_shed_mower", genre: "sunnybank", key: "tin_shed_mower", name: "The Shed", pictureUrl: "/skidmarks/sunnybanks/tin-shed-mower.jpg", createdAt: 1 };
    const plan = planLocationSeed({ locations: [motel, shed, motel, { nope: true }] });
    expect(plan.rows.map((r) => [r.itemId, r.folder, r.source])).toEqual([
      ["loc_music_video_roadside_motel", "music-video", "session"],
      ["loc_sunnybank_tin_shed_mower", "sunnybank", "session"],
    ]);
    expect(plan.rows[0].blobCopy).toBeNull();
    expect(plan.rows[1].blobCopy?.toPathname).toBe("deck/sunnybank/locations/tin-shed-mower.jpg");
    expect(plan.skipped.map((s) => s.index)).toEqual([2, 3]);
  });
});
