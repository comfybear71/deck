import { beforeEach, describe, expect, it } from "vitest";
import {
  appendKeptStillToSleeve,
  buildLibraryPlateStill,
  MEMBER_SLEEVE_AVATAR_ID,
  resolveMemberStillSleeve,
  urlIsInMemberSleeve,
} from "./memberStillSleeve";
import { plateStillCountsAsReady } from "./scriptSequenceRunner";
import {
  addSkidmarksMember,
  applySkidmarksMemberSleeveStillToPlate,
  attachSkidmarksMp3,
  createMp3Attachment,
  getSkidmarksSnapshot,
  keepSkidmarksMemberSleeveStill,
  selectSkidmarksBand,
  setSkidmarksClipPlateStill,
  setSkidmarksMemberAvatarImage,
  type SkidmarksPlateStill,
} from "./skidmarks";

describe("resolveMemberStillSleeve", () => {
  it("includes avatar then kept stills, deduped by URL", () => {
    const sleeve = resolveMemberStillSleeve({
      avatarImage: "https://blob.example/avatar.jpg",
      stillSleeve: [
        { id: "s1", dataUrl: "https://blob.example/plate-a.jpg", createdAt: 1 },
        { id: "s2", dataUrl: "https://blob.example/avatar.jpg", createdAt: 2 },
        { id: "s3", dataUrl: "https://blob.example/plate-a.jpg", createdAt: 3 },
      ],
    });
    expect(sleeve.map((e) => e.dataUrl)).toEqual([
      "https://blob.example/avatar.jpg",
      "https://blob.example/plate-a.jpg",
    ]);
    expect(sleeve[0].id).toBe(MEMBER_SLEEVE_AVATAR_ID);
  });

  it("never invents stills when the member has none", () => {
    expect(resolveMemberStillSleeve({ looks: [] } as never)).toEqual([]);
    expect(resolveMemberStillSleeve(undefined)).toEqual([]);
  });
});

describe("appendKeptStillToSleeve", () => {
  it("adds a Keep'd URL and skips avatar / duplicates", () => {
    const member = {
      avatarImage: "https://blob.example/avatar.jpg",
      stillSleeve: [] as { id: string; dataUrl: string; createdAt: number }[],
    };
    const once = appendKeptStillToSleeve(member, "https://blob.example/plate-a.jpg", () => "id-a");
    expect(once).toHaveLength(1);
    expect(once[0].dataUrl).toBe("https://blob.example/plate-a.jpg");

    const again = appendKeptStillToSleeve({ ...member, stillSleeve: once }, "https://blob.example/plate-a.jpg");
    expect(again).toHaveLength(1);

    const avatarKeep = appendKeptStillToSleeve(
      { ...member, stillSleeve: once },
      "https://blob.example/avatar.jpg"
    );
    expect(avatarKeep).toHaveLength(1);
  });
});

describe("buildLibraryPlateStill", () => {
  it("marks source library so Generate plates can skip without generate-still", () => {
    const still = buildLibraryPlateStill("https://blob.example/kept.jpg", 42);
    expect(still).toEqual({
      dataUrl: "https://blob.example/kept.jpg",
      source: "library",
      createdAt: 42,
    });
    expect(plateStillCountsAsReady(still, ["https://blob.example/avatar.jpg"])).toBe(true);
  });

  it("counts a library-applied avatar URL as ready (unlike Timeline preview)", () => {
    const avatar = "https://blob.example/avatar.jpg";
    const preview: SkidmarksPlateStill = {
      dataUrl: avatar,
      source: "generated",
      createdAt: 1,
      featuresLockedCharacter: true,
    };
    expect(plateStillCountsAsReady(preview, [avatar])).toBe(false);
    expect(plateStillCountsAsReady(buildLibraryPlateStill(avatar), [avatar])).toBe(true);
  });
});

describe("member sleeve store (Neon session member record)", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("song-a.mp3", 120));
  });

  it("Keep adds to the member sleeve", () => {
    const band = getSkidmarksSnapshot().bands.find((b) => b.id === "jack-ash")!;
    const member = band.members[0];
    keepSkidmarksMemberSleeveStill(band.id, member.id, "https://blob.example/kept-1.jpg");
    const updated = getSkidmarksSnapshot().bands.find((b) => b.id === "jack-ash")!.members[0];
    expect(updated.stillSleeve?.map((e) => e.dataUrl)).toEqual(["https://blob.example/kept-1.jpg"]);
    expect(urlIsInMemberSleeve(updated, "https://blob.example/kept-1.jpg")).toBe(true);
  });

  it("pick applies a library still without inventing a new URL", () => {
    const band = getSkidmarksSnapshot().bands.find((b) => b.id === "jack-ash")!;
    const member = band.members[0];
    const url = "https://blob.example/kept-2.jpg";
    keepSkidmarksMemberSleeveStill(band.id, member.id, url);
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    const plateId = segment.plates[0].id;
    applySkidmarksMemberSleeveStillToPlate(segment.id, plateId, url);
    const still = getSkidmarksSnapshot().session.mp3!.segments[0].plates[0].still;
    expect(still?.dataUrl).toBe(url);
    expect(still?.source).toBe("library");
    expect(plateStillCountsAsReady(still, [member.avatarImage])).toBe(true);
  });

  it("Generate plates skip logic treats library still like an approved still", () => {
    const library = buildLibraryPlateStill("https://blob.example/lib.jpg");
    expect(plateStillCountsAsReady(library, [])).toBe(true);
    // Empty / missing still is not ready — Generate plates must still spend.
    expect(plateStillCountsAsReady(undefined, [])).toBe(false);
  });

  it("song switch keeps the sleeve on the member", () => {
    const band = getSkidmarksSnapshot().bands.find((b) => b.id === "jack-ash")!;
    const member = band.members[0];
    const url = "https://blob.example/across-songs.jpg";
    keepSkidmarksMemberSleeveStill(band.id, member.id, url);
    attachSkidmarksMp3(createMp3Attachment("song-b.mp3", 90));
    const after = getSkidmarksSnapshot().bands.find((b) => b.id === "jack-ash")!.members[0];
    expect(after.stillSleeve?.map((e) => e.dataUrl)).toContain(url);
    // New song wiped plate stills, but not the sleeve.
    expect(getSkidmarksSnapshot().session.mp3!.fileName).toBe("song-b.mp3");
  });

  it("member switch isolates sleeves — no cross-member bleed", () => {
    const bandId = "jack-ash";
    addSkidmarksMember(bandId);
    const members = getSkidmarksSnapshot().bands.find((b) => b.id === bandId)!.members;
    expect(members.length).toBeGreaterThanOrEqual(2);
    const a = members[0];
    const b = members[members.length - 1];
    setSkidmarksMemberAvatarImage(bandId, b.id, "https://blob.example/b-avatar.jpg");
    keepSkidmarksMemberSleeveStill(bandId, a.id, "https://blob.example/only-a.jpg");
    keepSkidmarksMemberSleeveStill(bandId, b.id, "https://blob.example/only-b.jpg");

    const fresh = getSkidmarksSnapshot().bands.find((band) => band.id === bandId)!.members;
    const memberA = fresh.find((m) => m.id === a.id)!;
    const memberB = fresh.find((m) => m.id === b.id)!;

    expect(urlIsInMemberSleeve(memberA, "https://blob.example/only-a.jpg")).toBe(true);
    expect(urlIsInMemberSleeve(memberA, "https://blob.example/only-b.jpg")).toBe(false);
    expect(urlIsInMemberSleeve(memberB, "https://blob.example/only-b.jpg")).toBe(true);
    expect(urlIsInMemberSleeve(memberB, "https://blob.example/only-a.jpg")).toBe(false);
    expect(resolveMemberStillSleeve(memberA).map((e) => e.dataUrl)).not.toContain(
      "https://blob.example/only-b.jpg"
    );
    expect(resolveMemberStillSleeve(memberB).map((e) => e.dataUrl)).not.toContain(
      "https://blob.example/only-a.jpg"
    );
  });

  it("setting a plate still via library path never uses setSkidmarksClipPlateStill with generated source by accident", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    const plateId = segment.plates[0].id;
    setSkidmarksClipPlateStill(segment.id, plateId, {
      dataUrl: "https://blob.example/generated.jpg",
      source: "generated",
      createdAt: Date.now(),
    });
    applySkidmarksMemberSleeveStillToPlate(segment.id, plateId, "https://blob.example/from-sleeve.jpg");
    const still = getSkidmarksSnapshot().session.mp3!.segments[0].plates[0].still!;
    expect(still.source).toBe("library");
    expect(still.dataUrl).toBe("https://blob.example/from-sleeve.jpg");
  });
});
