import { describe, expect, it } from "vitest";
import {
  adultShortTargetFor,
  bandCoverTargetFor,
  characterPlateTargetFor,
  memberAvatarTargetFor,
  rosterPictureTargetFor,
  songPlateTargetFor,
} from "./deckMediaTargets";
import {
  addSkidmarksMember,
  attachSkidmarksMp3,
  createMp3Attachment,
  createSkidmarksBand,
  getAdultShortsState,
  getSkidmarksSnapshot,
  patchAdultShorts,
  renameSkidmarksBand,
  renameSkidmarksMember,
  selectSkidmarksBand,
} from "./skidmarks";

/** Vitest runs in `node`, so the studio store is in memory only here. */

function newBandWithMember(bandName: string, memberName: string) {
  const band = createSkidmarksBand();
  renameSkidmarksBand(band.id, bandName);
  addSkidmarksMember(band.id);
  const member = getSkidmarksSnapshot().bands.find((b) => b.id === band.id)!.members.at(-1)!;
  renameSkidmarksMember(band.id, member.id, memberName);
  return { bandId: band.id, memberId: member.id };
}

describe("band and member folders", () => {
  it("pins the folder names on first use, so a later rename doesn't move anything", () => {
    const { bandId, memberId } = newBandWithMember("BIGSEXY", "BIG SEXY");
    expect(memberAvatarTargetFor(bandId, memberId)).toEqual({
      folder: "deck/music-video/characters/big-sexy",
      name: "big-sexy-avatar",
    });
    renameSkidmarksBand(bandId, "Big Sexy Deluxe");
    renameSkidmarksMember(bandId, memberId, "Sexy");
    expect(bandCoverTargetFor(bandId)).toEqual({ folder: "deck/music-video/bands/bigsexy", name: "bigsexy-cover" });
    expect(memberAvatarTargetFor(bandId, memberId)?.folder).toBe("deck/music-video/characters/big-sexy");
    const band = getSkidmarksSnapshot().bands.find((b) => b.id === bandId)!;
    expect(band.mediaSlug).toBe("bigsexy");
    expect(band.members.find((m) => m.id === memberId)!.mediaSlug).toBe("big-sexy");
  });

  it("gives a second band with the same name its own folder", () => {
    const first = newBandWithMember("Twin Peaks", "A");
    const second = newBandWithMember("Twin Peaks", "B");
    expect(bandCoverTargetFor(first.bandId)?.folder).toBe("deck/music-video/bands/twin-peaks");
    expect(bandCoverTargetFor(second.bandId)?.folder).toBe("deck/music-video/bands/twin-peaks-2");
  });

  it("a blank new band has no folder yet (old path)", () => {
    const band = createSkidmarksBand();
    expect(bandCoverTargetFor(band.id)).toBeNull();
  });

  it("a Music video character's plates go in their member folder", () => {
    const { bandId, memberId } = newBandWithMember("Crackhaus", "SOUL REBEL");
    expect(characterPlateTargetFor({ slug: "soul_rebel", name: "SOUL REBEL", sourceKey: `mv:${memberId}` }, 16)).toEqual({
      folder: "deck/music-video/characters/soul-rebel/plates",
      name: "soul-rebel-plate-16",
    });
    expect(bandId).toBeTruthy();
  });

  it("pictures added to a band from + Add a character land in that member's folder", () => {
    const { bandId } = newBandWithMember("Stuballs", "Stuie");
    expect(rosterPictureTargetFor("music-video", "Stuie", null, 2, bandId)).toEqual({
      folder: "deck/music-video/characters/stuie/pictures",
      name: "stuie-picture-02",
    });
  });
});

describe("sections, songs, shorts", () => {
  it("files new Sunnybank and Skidmarks characters by section", () => {
    expect(characterPlateTargetFor({ slug: "shazza", name: "Shazza", sourceKey: "sb:shazza" }, 7)).toEqual({
      folder: "deck/sunnybank/characters/shazza/plates",
      name: "shazza-plate-07",
    });
    expect(rosterPictureTargetFor("skidmarks", "Dap", null, 1)?.folder).toBe("deck/skidmarks/characters/dap/pictures");
  });

  it("song plates go under the attached song", () => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("CRACK HAUL.mp3", 120));
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    const seg = mp3.segments[1];
    expect(songPlateTargetFor(seg.id, seg.plates[0].id)).toEqual({
      folder: "deck/music-video/songs/crack-haul/plates",
      name: "crack-haul-clip-02a",
    });
    expect(songPlateTargetFor("nope", "nope")).toBeNull();
  });

  it("an Adult short gets one readable folder, pinned so a rename doesn't move it", () => {
    patchAdultShorts((s) => ({
      ...s,
      ageConfirmed: true,
      mediaSlug: undefined,
      currentSavedId: null,
      character: { ...s.character, name: "BLONDE GIRL _1" },
    }));
    const plate = adultShortTargetFor("plate", 2);
    expect(plate).toEqual({ folder: "deck/shorts/shorts/blonde-girl-1", name: "blonde-girl-1-plate-02" });
    patchAdultShorts((s) => ({ ...s, character: { ...s.character, name: "Someone else" } }));
    expect(adultShortTargetFor("clip", 2)).toEqual({ folder: "deck/shorts/shorts/blonde-girl-1", name: "blonde-girl-1-clip-02" });
    expect(getAdultShortsState().mediaSlug).toBe("blonde-girl-1");
  });
});

describe("Skye", () => {
  it("is a Shorts character with readable names, before and after her row says so", () => {
    for (const sourceKey of [null, "asx:skye"]) {
      expect(characterPlateTargetFor({ slug: "skye", name: "Skye", sourceKey }, 3)).toEqual({
        folder: "deck/shorts/characters/skye/plates",
        name: "skye-plate-03",
      });
    }
  });
});
