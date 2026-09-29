import { describe, expect, it } from "vitest";
import {
  addSkidmarksMember,
  addSkidmarksMemberWithPictures,
  createSkidmarksBand,
  getSkidmarksSnapshot,
  MAX_MEMBERS_PER_BAND,
  moveSkidmarksMember,
} from "./skidmarks";
import { onlyBandCharacters, type RosterCharacter } from "./characterRoster";

const ids = (bandId: string) => getSkidmarksSnapshot().bands.find((b) => b.id === bandId)!.members.map((m) => m.id);

describe("moveSkidmarksMember", () => {
  it("swaps a member up or down and ignores moves past either end", () => {
    const bandId = "jack-ash";
    addSkidmarksMember(bandId);
    const before = ids(bandId);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const last = before[before.length - 1];
    moveSkidmarksMember(bandId, last, -1);
    const after = ids(bandId);
    expect(after[after.length - 2]).toBe(last);
    expect(after.slice().sort()).toEqual(before.slice().sort());
    moveSkidmarksMember(bandId, after[0], -1);
    expect(ids(bandId)).toEqual(after);
  });
});

describe("onlyBandCharacters", () => {
  const char = (sourceKey: string) => ({ sourceKey }) as RosterCharacter;
  const list = [char("mv:a"), char("mv:b"), char("mvx:extra")];
  it("keeps only the chosen band's members plus added characters", () => {
    expect(onlyBandCharacters(list, ["b"]).map((c) => c.sourceKey)).toEqual(["mv:b", "mvx:extra"]);
  });
  it("shows everyone when no band is given", () => {
    expect(onlyBandCharacters(list, undefined)).toHaveLength(3);
  });
});

describe("addSkidmarksMemberWithPictures", () => {
  const band = (id: string) => getSkidmarksSnapshot().bands.find((b) => b.id === id)!;
  it("adds a new member with the first picture as their photo", () => {
    const { id } = createSkidmarksBand();
    const before = band(id).members.length;
    const memberId = addSkidmarksMemberWithPictures(id, "Zed Test", "red cap", ["https://x/1.jpg", "https://x/2.jpg"]);
    expect(memberId).toBeTruthy();
    const m = band(id).members.find((x) => x.id === memberId)!;
    expect(band(id).members).toHaveLength(before + 1);
    expect(m.name).toBe("Zed Test");
    expect(m.avatarImage).toBe("https://x/1.jpg");
    expect(m.lock?.lookRules).toBe("red cap");
  });
  it("gives the pictures to a member with the same name instead of adding again", () => {
    const { id } = createSkidmarksBand();
    const first = addSkidmarksMemberWithPictures(id, "Yara", "", ["https://y/1.jpg"]);
    const count = band(id).members.length;
    const again = addSkidmarksMemberWithPictures(id, "  yara ", "", ["https://y/2.jpg"]);
    expect(again).toBe(first);
    expect(band(id).members).toHaveLength(count);
    expect(band(id).members.find((x) => x.id === first)!.avatarImage).toBe("https://y/1.jpg");
  });
  it("returns null when the band is full", () => {
    const { id } = createSkidmarksBand();
    for (let i = band(id).members.length; i < MAX_MEMBERS_PER_BAND; i++) addSkidmarksMember(id);
    expect(addSkidmarksMemberWithPictures(id, "One Too Many", "", [])).toBeNull();
  });
});
