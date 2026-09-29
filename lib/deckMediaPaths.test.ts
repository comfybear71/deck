import { describe, expect, it } from "vitest";
import {
  adultShortTarget,
  bandCoverTarget,
  buildDeckMediaPathname,
  characterMediaOwner,
  characterPlateTarget,
  characterReferenceTarget,
  deckMediaSlug,
  deckMediaStem,
  isBlobAlreadyExistsError,
  isDeckMediaPathname,
  isDeckMediaTarget,
  memberAvatarTarget,
  memberLookTarget,
  memberMediaOwner,
  parseDeckMediaTarget,
  randomDeckMediaTag,
  sirayOriginalTarget,
  songMediaSlug,
  songPlateTarget,
  sunnybankBeatTarget,
  uniqueDeckMediaSlug,
} from "./deckMediaPaths";

const noMember = () => null;

describe("deckMediaSlug", () => {
  it("makes readable lowercase slugs from real names", () => {
    expect(deckMediaSlug("Ranger Bazza")).toBe("ranger-bazza");
    expect(deckMediaSlug("BIG SEXY")).toBe("big-sexy");
    expect(deckMediaSlug("Unit 4S")).toBe("unit-4s");
    expect(deckMediaSlug("BLONDE GIRL _1")).toBe("blonde-girl-1");
    expect(deckMediaSlug("Man\u2019s Best friends")).toBe("mans-best-friends");
    expect(deckMediaSlug("Café Noël")).toBe("cafe-noel");
  });

  it("falls back when a name has nothing usable", () => {
    expect(deckMediaSlug("", "band")).toBe("band");
    expect(deckMediaSlug("\u{1F3B8}\u{1F3B8}", "member")).toBe("member");
  });

  it("caps length without leaving a trailing dash", () => {
    const s = deckMediaSlug("a".repeat(39) + " bbbb");
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });

  it("adds -2, -3 for clashes", () => {
    expect(uniqueDeckMediaSlug("dazza", [])).toBe("dazza");
    expect(uniqueDeckMediaSlug("dazza", ["dazza"])).toBe("dazza-2");
    expect(uniqueDeckMediaSlug("dazza", ["dazza", "dazza-2"])).toBe("dazza-3");
  });
});

describe("character folders", () => {
  const card = (slug: string, name: string, sourceKey: string | null) => ({ slug, name, sourceKey });

  it("files each section's characters under it, from the card's fixed slug", () => {
    expect(characterMediaOwner(card("shazza", "Shazza", "sb:shazza"), noMember).folder).toBe(
      "deck/sunnybank/characters/shazza",
    );
    expect(characterMediaOwner(card("ranger_bazza", "Ranger Bazza", "sb:ranger_bazza"), noMember).folder).toBe(
      "deck/sunnybank/characters/ranger-bazza",
    );
    expect(characterMediaOwner(card("dap", "Dap", "sk:cast_1"), noMember).folder).toBe("deck/skidmarks/characters/dap");
    // No top-level character folder: Skye (no section prefix) is a Shorts character.
    expect(characterMediaOwner(card("skye", "Skye", null), noMember)).toMatchObject({
      folder: "deck/shorts/characters/skye",
      tagged: true,
    });
    expect(characterMediaOwner(card("blonde", "Blonde", "asx:1"), noMember)).toMatchObject({
      folder: "deck/shorts/characters/blonde",
      tagged: true,
    });
  });

  it("uses the card slug, not the live name, so a rename never moves the folder", () => {
    expect(characterMediaOwner(card("shazza", "Shaz the Great", "sb:shazza"), noMember).folder).toBe(
      "deck/sunnybank/characters/shazza",
    );
  });

  it("files a Music video character like every other genre, sharing its band member's folder name", () => {
    const owner = characterMediaOwner(card("big_sexy_card", "BIG SEXY", "mv:member_1"), (id) =>
      id === "member_1" ? "big-sexy" : null,
    );
    expect(owner.folder).toBe("deck/music-video/characters/big-sexy");
    expect(memberMediaOwner("big-sexy").folder).toBe(owner.folder);
    expect(characterPlateTarget(owner, 3)).toEqual({
      folder: "deck/music-video/characters/big-sexy/plates",
      name: "big-sexy-plate-03",
    });
  });

  it("falls back to deck/music-video/characters when the member is gone", () => {
    expect(characterMediaOwner(card("jack_ash", "Jack Ash", "mv:gone"), noMember).folder).toBe(
      "deck/music-video/characters/jack-ash",
    );
  });

  it("names plates and references readably", () => {
    const owner = characterMediaOwner(card("shazza", "Shazza", "sb:shazza"), noMember);
    expect(buildDeckMediaPathname(characterPlateTarget(owner, 7), "jpg")).toBe(
      "deck/sunnybank/characters/shazza/plates/shazza-plate-07.jpg",
    );
    expect(buildDeckMediaPathname(characterReferenceTarget(owner), "jpg")).toBe(
      "deck/sunnybank/characters/shazza/shazza-reference.jpg",
    );
    expect(sirayOriginalTarget(characterPlateTarget(owner, 7))).toEqual({
      folder: "deck/sunnybank/characters/shazza/plates/originals",
      name: "shazza-plate-07",
    });
  });

  it("gives every Adult shorts character file its own random tag", () => {
    const owner = characterMediaOwner(card("blonde", "Blonde", "as:1"), noMember);
    const a = characterPlateTarget(owner, 1).name;
    const b = characterPlateTarget(owner, 1).name;
    expect(a).toMatch(/^blonde-[0-9a-f]{6}-plate-01$/);
    expect(a).not.toBe(b);
  });
});

describe("bands, songs, shorts, episodes", () => {
  it("band and member files", () => {
    expect(buildDeckMediaPathname(bandCoverTarget("bigsexy"), "jpg")).toBe("deck/music-video/bands/bigsexy/bigsexy-cover.jpg");
    expect(buildDeckMediaPathname(memberAvatarTarget("big-sexy"), "jpg")).toBe(
      "deck/music-video/characters/big-sexy/big-sexy-avatar.jpg",
    );
    expect(buildDeckMediaPathname(memberLookTarget("stuie", 2), "png")).toBe(
      "deck/music-video/characters/stuie/looks/stuie-look-02.png",
    );
  });

  it("song plates", () => {
    expect(songMediaSlug("CRACK HAUL.mp3")).toBe("crack-haul");
    expect(buildDeckMediaPathname(songPlateTarget("crack-haul", 3, 1), "jpg")).toBe(
      "deck/music-video/songs/crack-haul/plates/crack-haul-clip-03b.jpg",
    );
  });

  it("adult shorts use the short's random tag in folder and names", () => {
    expect(buildDeckMediaPathname(adultShortTarget("3f9a2c", "plate", 2), "jpg")).toBe(
      "deck/shorts/shorts/short-3f9a2c/short-3f9a2c-plate-02.jpg",
    );
    expect(randomDeckMediaTag()).toMatch(/^[0-9a-f]{6}$/);
  });

  it("Sunnybank beats go under the episode's pinned slug, or nowhere when it has none", () => {
    expect(
      sunnybankBeatTarget({ episodeSlug: "the-big-wet", actId: "II", beatNumber: 3, characterName: "Shazza", kind: "speak" }),
    ).toEqual({
      folder: "deck/sunnybank/episodes/the-big-wet/act-ii",
      name: "the-big-wet-act-ii-beat-03-shazza-speak",
    });
    expect(sunnybankBeatTarget({ episodeSlug: null, actId: "I", beatNumber: 1, characterName: "Nan", kind: "hold" })).toBeNull();
    expect(sunnybankBeatTarget({ episodeSlug: "  ", actId: "I", beatNumber: 1, characterName: "Nan", kind: "hold" })).toBeNull();
    expect(sunnybankBeatTarget({ episodeSlug: "The Big Wet", actId: "I", beatNumber: 1, characterName: "Nan", kind: "hold" })).toBeNull();
  });
});

describe("safety and versions", () => {
  it("never overwrites: later tries get -v2, -v3", () => {
    const t = { folder: "deck/sunnybank/characters/shazza", name: "shazza-reference" };
    expect(buildDeckMediaPathname(t, "jpg", 1)).toBe("deck/sunnybank/characters/shazza/shazza-reference.jpg");
    expect(buildDeckMediaPathname(t, "jpg", 2)).toBe("deck/sunnybank/characters/shazza/shazza-reference-v2.jpg");
    expect(deckMediaStem("deck/a/short-1-clip-02-v2.mp4")).toBe("short-1-clip-02-v2");
  });

  it("only accepts clean deck/ targets and pathnames", () => {
    expect(isDeckMediaTarget({ folder: "deck/sunnybank/characters/shazza", name: "shazza-plate-01" })).toBe(true);
    expect(parseDeckMediaTarget({ folder: "deck/../skidmarks", name: "x" })).toBeNull();
    expect(parseDeckMediaTarget({ folder: "skidmarks/plate-stills", name: "x" })).toBeNull();
    expect(parseDeckMediaTarget({ folder: "deck/Sunnybank", name: "x" })).toBeNull();
    expect(parseDeckMediaTarget({ folder: "deck/a", name: "a/b" })).toBeNull();
    expect(parseDeckMediaTarget("deck/a/b")).toBeNull();
    expect(isDeckMediaPathname("deck/sunnybank/characters/shazza/plates/shazza-plate-07.jpg")).toBe(true);
    expect(isDeckMediaPathname("deck/sunnybank/characters/shazza/plates/shazza-plate-07-v2.jpg")).toBe(true);
    expect(isDeckMediaPathname("deck/x.jpg")).toBe(false);
    expect(isDeckMediaPathname("deck/a/../b/c.jpg")).toBe(false);
    expect(isDeckMediaPathname("deck/a/b.exe")).toBe(false);
    expect(isDeckMediaPathname("skidmarks/member-photos/abc.jpg")).toBe(false);
  });

  it("recognises Blob's 'already exists' answer", () => {
    expect(isBlobAlreadyExistsError(new Error("Vercel Blob: This blob already exists, use `allowOverwrite: true`"))).toBe(true);
    expect(isBlobAlreadyExistsError(new Error("Failed to retrieve the client token"))).toBe(false);
  });
});
