import { describe, expect, it } from "vitest";
import { addSkidmarksMember, getSkidmarksSnapshot, moveSkidmarksMember } from "./skidmarks";
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
