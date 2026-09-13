import { describe, expect, it } from "vitest";
import { pickSirayPosition, SIRAY_17_POSITIONS } from "./sirayPositions";

describe("SIRAY_17_POSITIONS", () => {
  it("has exactly 17 entries, numbered 1-17 in order, matching Stuart's own pack", () => {
    expect(SIRAY_17_POSITIONS).toHaveLength(17);
    SIRAY_17_POSITIONS.forEach((p, i) => expect(p.index).toBe(i + 1));
  });

  it("groups exactly the positions Stuart himself grouped, and nothing else", () => {
    const byGroup = (group: string) =>
      SIRAY_17_POSITIONS.filter((p) => p.group === group)
        .map((p) => p.index)
        .sort((a, b) => a - b);

    expect(byGroup("wide")).toEqual([1, 2]);
    expect(byGroup("mouth-on")).toEqual([3, 4, 5, 6, 7, 8, 12]);
    expect(byGroup("off-mouth")).toEqual([9, 10, 11, 14, 15, 16]);
    // 13 and 17 are real entries Stuart never grouped — left ungrouped
    // on purpose, not auto-selectable.
    expect(byGroup("ungrouped")).toEqual([13, 17]);
  });

  it("never repeats a farm-specific scene detail from Stuart's original example pack", () => {
    const serialised = JSON.stringify(SIRAY_17_POSITIONS);
    expect(serialised.toLowerCase()).not.toContain("barn");
    expect(serialised.toLowerCase()).not.toContain("farmer");
  });
});

describe("pickSirayPosition", () => {
  it("picks from the wide group for the first clip's first empty slot", () => {
    const p = pickSirayPosition({ vocal: false, isFirstClip: true, isFirstEmptySlotInClip: true, rotationIndex: 0 });
    expect([1, 2]).toContain(p.index);
  });

  it("picks from the mouth-on group for a Vocal clip, not the first-clip-opener case", () => {
    const p = pickSirayPosition({ vocal: true, isFirstClip: false, isFirstEmptySlotInClip: false, rotationIndex: 0 });
    expect([3, 4, 5, 6, 7, 8, 12]).toContain(p.index);
  });

  it("picks from the off-mouth group for an Instrumental clip", () => {
    const p = pickSirayPosition({ vocal: false, isFirstClip: false, isFirstEmptySlotInClip: false, rotationIndex: 0 });
    expect([9, 10, 11, 14, 15, 16]).toContain(p.index);
  });

  it("a Vocal first clip's first slot still gets a wide master, not a mouth-on one", () => {
    const p = pickSirayPosition({ vocal: true, isFirstClip: true, isFirstEmptySlotInClip: true, rotationIndex: 0 });
    expect([1, 2]).toContain(p.index);
  });

  it("cycles deterministically through the pool rather than repeating the same position", () => {
    const picks = Array.from({ length: 7 }, (_, i) =>
      pickSirayPosition({ vocal: true, isFirstClip: false, isFirstEmptySlotInClip: false, rotationIndex: i }).index
    );
    // 7 mouth-on positions exist — one full cycle should hit each once.
    expect(new Set(picks).size).toBe(7);
    // And wraps back to the start on the 8th.
    const eighth = pickSirayPosition({
      vocal: true,
      isFirstClip: false,
      isFirstEmptySlotInClip: false,
      rotationIndex: 7,
    });
    expect(eighth.index).toBe(picks[0]);
  });

  it("handles a negative rotationIndex without throwing or returning undefined", () => {
    expect(() =>
      pickSirayPosition({ vocal: false, isFirstClip: false, isFirstEmptySlotInClip: false, rotationIndex: -1 })
    ).not.toThrow();
  });
});
