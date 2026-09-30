import { describe, expect, it } from "vitest";
import {
  buildDeckLocation,
  builtInDeckLocations,
  deckLocationItemId,
  deckLocationKeyFromName,
  deckLocationNameProblem,
  deckLocationPictureTarget,
  effectiveDeckLocations,
  findDeckLocation,
  normalizeDeckLocation,
  normalizeDeckLocationsState,
  withBuiltInsSaved,
  type DeckLocation,
} from "./deckLocations";
import { prepareDeckItemData } from "./deckItems-server";
import { DECK_ITEM_KINDS, isDeckItemKind } from "./deckItems";
import { LOCATION_ITEMS } from "./locationItems";
import { coverCrop } from "./locationPicture";
import { isDeckMediaPathname } from "./deckMediaPaths";

/**
 * Locations (2026-09-30): one LOCATIONS row above the Characters row in
 * every genre, saved per item (kind `location`, folder = genre), with
 * Sunnybank's built-ins shown until it has saved locations.
 */

const MOTEL: DeckLocation = {
  id: "loc_music_video_roadside_motel",
  genre: "music-video",
  key: "roadside_motel",
  name: "Roadside Motel",
  pictureUrl: "https://abc.public.blob.vercel-storage.com/deck/music-video/locations/roadside-motel.jpg",
  createdAt: 5,
};

describe("deck locations: the pure rules", () => {
  it("readable keys and ids, and one Blob folder per genre", () => {
    expect(deckLocationKeyFromName("Park Site 4")).toBe("park_site_4");
    expect(deckLocationKeyFromName("Tin Shed & Mower")).toBe("tin_shed_mower");
    expect(deckLocationItemId("adult-shorts", "hotel_room")).toBe("loc_adult_shorts_hotel_room");
    expect(deckLocationPictureTarget("sunnybank", "park_site_4")).toEqual({ folder: "deck/sunnybank/locations", name: "park-site-4" });
    // Shorts files live under deck/shorts/, like its characters.
    expect(deckLocationPictureTarget("adult-shorts", "hotel_room")).toEqual({ folder: "deck/shorts/locations", name: "hotel-room" });
    expect(isDeckMediaPathname("deck/music-video/locations/roadside-motel.jpg")).toBe(true);
  });

  it("cleans a saved location and refuses anything off-shape", () => {
    expect(normalizeDeckLocation(MOTEL)).toEqual(MOTEL);
    expect(normalizeDeckLocation({ ...MOTEL, genre: "cooking" })).toBeNull();
    expect(normalizeDeckLocation({ ...MOTEL, key: "Bad Key" })).toBeNull();
    expect(normalizeDeckLocation({ ...MOTEL, name: "   " })).toBeNull();
    expect(normalizeDeckLocation({ ...MOTEL, id: "loc_music_video_something_else" })).toBeNull();
    // Only https or a repo file under /skidmarks/, never data: bytes or a relative trick.
    expect(normalizeDeckLocation({ ...MOTEL, pictureUrl: "data:image/jpeg;base64,AAAA" })?.pictureUrl).toBeNull();
    expect(normalizeDeckLocation({ ...MOTEL, pictureUrl: "/skidmarks/../secrets.jpg" })?.pictureUrl).toBeNull();
    expect(normalizeDeckLocation({ ...MOTEL, pictureUrl: "/skidmarks/sunnybanks/park-site-4.jpg" })?.pictureUrl).toBe(
      "/skidmarks/sunnybanks/park-site-4.jpg",
    );
    const state = normalizeDeckLocationsState({ locations: [MOTEL, MOTEL, { junk: 1 }] });
    expect(state?.locations).toEqual([MOTEL]);
    expect(normalizeDeckLocationsState(null)).toBeNull();
  });

  it("Sunnybank shows its nine built-ins until it has saved locations; the others start empty", () => {
    const built = builtInDeckLocations("sunnybank");
    expect(built.map((l) => l.key)).toEqual([
      "water_tank_dam",
      "main_entrance_sign",
      "site_laundry",
      "office_storefront",
      "tin_shed_mower",
      "caravan_interior",
      "park_site_4",
      "office_booth",
      "rock_art_outcrop",
    ]);
    expect(built.find((l) => l.key === "park_site_4")).toMatchObject({ name: "Park Site 4", pictureUrl: "/skidmarks/sunnybanks/park-site-4.jpg" });
    expect(effectiveDeckLocations(null, "sunnybank")).toEqual(built);
    expect(effectiveDeckLocations(null, "music-video")).toEqual([]);
    // Another genre's locations never count as Sunnybank's.
    expect(effectiveDeckLocations({ locations: [MOTEL] }, "sunnybank")).toEqual(built);
    expect(effectiveDeckLocations({ locations: [MOTEL] }, "music-video")).toEqual([MOTEL]);
    // Once Sunnybank has saved locations, those are the list.
    const saved = withBuiltInsSaved({ locations: [MOTEL] }, "sunnybank");
    expect(saved.locations).toHaveLength(10);
    const onlyOne = { locations: [saved.locations[1]] };
    expect(effectiveDeckLocations(onlyOne, "sunnybank").map((l) => l.key)).toEqual(["water_tank_dam"]);
    // Materialising twice doesn't double up.
    expect(withBuiltInsSaved(saved, "sunnybank").locations).toHaveLength(10);
  });

  it("finds a location by key, a loose key or its name", () => {
    const list = builtInDeckLocations("sunnybank");
    expect(findDeckLocation(list, "park_site_4")?.key).toBe("park_site_4");
    expect(findDeckLocation(list, "Park Site 4")?.key).toBe("park_site_4");
    expect(findDeckLocation(list, "park-site-4")?.key).toBe("park_site_4");
    expect(findDeckLocation(list, "fibro caravan interior")?.key).toBe("caravan_interior");
    expect(findDeckLocation(list, "moon base")).toBeUndefined();
    expect(findDeckLocation(list, "  ")).toBeUndefined();
  });

  it("a new location gets a free key; a clashing name is refused", () => {
    const list = builtInDeckLocations("sunnybank");
    expect(deckLocationNameProblem(list, "")).toMatch(/needs a name/);
    expect(deckLocationNameProblem(list, "park site 4")).toMatch(/already a location called Park Site 4/);
    expect(deckLocationNameProblem(list, "Park Site 4", "loc_sunnybank_park_site_4")).toBeNull();
    const added = buildDeckLocation("sunnybank", list, "  Boat   Ramp ", null, 99);
    expect(added).toEqual({
      ok: true,
      value: { id: "loc_sunnybank_boat_ramp", genre: "sunnybank", key: "boat_ramp", name: "Boat Ramp", pictureUrl: null, createdAt: 99 },
    });
    // A renamed location keeps its key, so a new one with that key's name gets _2.
    const renamed = [{ ...list[0], key: "boat_ramp", id: "loc_sunnybank_boat_ramp", name: "Old Jetty" }];
    const second = buildDeckLocation("sunnybank", renamed, "Boat Ramp", null);
    expect(second.ok && second.value.key).toBe("boat_ramp_2");
  });

  it("the picture is cropped to fill 1280x720 without stretching", () => {
    expect(coverCrop(1280, 720, 1280, 720)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
    expect(coverCrop(1000, 1000, 1280, 720)).toEqual({ sx: 0, sy: 219, sw: 1000, sh: 563 });
    expect(coverCrop(4000, 1000, 1280, 720)).toEqual({ sx: 1111, sy: 0, sw: 1778, sh: 1000 });
  });
});

describe("deck_items kind `location`", () => {
  it("is a kind, cleaned by the same rules, and foldered by its genre on the server", () => {
    expect(DECK_ITEM_KINDS).toContain("location");
    expect(isDeckItemKind("location")).toBe(true);
    expect(LOCATION_ITEMS.kind).toBe("location");
    expect(prepareDeckItemData("location", MOTEL.id, MOTEL)).toEqual({ ok: true, data: MOTEL, folder: "music-video" });
    const park = builtInDeckLocations("sunnybank")[6];
    expect(prepareDeckItemData("location", park.id, park)).toMatchObject({ ok: true, folder: "sunnybank" });
    expect(prepareDeckItemData("location", "loc_other", MOTEL)).toEqual({ ok: false, error: "The location's id doesn't match the item id." });
    expect(prepareDeckItemData("location", MOTEL.id, { name: "x" })).toEqual({ ok: false, error: "That isn't a location." });
  });
});
