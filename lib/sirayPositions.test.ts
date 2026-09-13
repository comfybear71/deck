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

// Stuart's explicit ban, live-QA'd 2026-09-13 ("every fucking image is
// staring straight out the camera") — `pickSirayPosition` must never
// auto-pick any of these, since every Siray-routed still shows a
// character in frame by design (see `lib/plateGeneration.ts`'s
// `buildSirayCharacterPrompt` doc comment).
const FRONT_FACING_INDEXES = [1, 2, 3, 4, 12, 17];

describe("pickSirayPosition", () => {
  it("never auto-picks a front-facing position, for any real combination of inputs", () => {
    for (const vocal of [true, false]) {
      for (const isFirstClip of [true, false]) {
        for (const isFirstEmptySlotInClip of [true, false]) {
          for (let rotationIndex = 0; rotationIndex < 10; rotationIndex += 1) {
            const p = pickSirayPosition({ vocal, isFirstClip, isFirstEmptySlotInClip, rotationIndex });
            expect(FRONT_FACING_INDEXES).not.toContain(p.index);
          }
        }
      }
    }
  });

  it("falls back to an off-axis mouth-on position for the first clip's first empty slot — the wide group (1/2) is itself all front-facing", () => {
    const p = pickSirayPosition({ vocal: false, isFirstClip: true, isFirstEmptySlotInClip: true, rotationIndex: 0 });
    expect([5, 6, 7, 8]).toContain(p.index);
  });

  it("picks from the off-axis mouth-on group (5/6/7/8) for a Vocal clip, not the first-clip-opener case", () => {
    const p = pickSirayPosition({ vocal: true, isFirstClip: false, isFirstEmptySlotInClip: false, rotationIndex: 0 });
    expect([5, 6, 7, 8]).toContain(p.index);
  });

  it("picks from the off-mouth group for an Instrumental clip — unaffected by the front-facing ban", () => {
    const p = pickSirayPosition({ vocal: false, isFirstClip: false, isFirstEmptySlotInClip: false, rotationIndex: 0 });
    expect([9, 10, 11, 14, 15, 16]).toContain(p.index);
  });

  it("a Vocal first clip's first slot also falls back to the off-axis mouth-on subset, not a front wide master", () => {
    const p = pickSirayPosition({ vocal: true, isFirstClip: true, isFirstEmptySlotInClip: true, rotationIndex: 0 });
    expect([5, 6, 7, 8]).toContain(p.index);
  });

  it("cycles deterministically through the pool rather than repeating the same position", () => {
    const picks = Array.from({ length: 4 }, (_, i) =>
      pickSirayPosition({ vocal: true, isFirstClip: false, isFirstEmptySlotInClip: false, rotationIndex: i }).index
    );
    // 4 off-axis mouth-on positions exist (5/6/7/8) — one full cycle
    // should hit each once.
    expect(new Set(picks).size).toBe(4);
    // And wraps back to the start on the 5th.
    const fifth = pickSirayPosition({
      vocal: true,
      isFirstClip: false,
      isFirstEmptySlotInClip: false,
      rotationIndex: 4,
    });
    expect(fifth.index).toBe(picks[0]);
  });

  it("handles a negative rotationIndex without throwing or returning undefined", () => {
    expect(() =>
      pickSirayPosition({ vocal: false, isFirstClip: false, isFirstEmptySlotInClip: false, rotationIndex: -1 })
    ).not.toThrow();
  });
});
