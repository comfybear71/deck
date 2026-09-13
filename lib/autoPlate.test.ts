import { describe, expect, it } from "vitest";
import { buildDemoSegments, type SkidmarksClipSegment } from "./skidmarks";
import { ESTIMATED_STILL_COST_USD, MAX_AUTO_PLATE_BRIEF_LENGTH, planAutoPlateFill } from "./autoPlate";

function withPlateCount(segments: SkidmarksClipSegment[], counts: number[]): SkidmarksClipSegment[] {
  return segments.map((segment, i) => {
    const count = counts[i] ?? 1;
    const plates = Array.from({ length: count }, (_, j) => segment.plates[j] ?? { id: `${segment.id}-plate-${j}` });
    return { ...segment, plates };
  });
}

function fillPlate(segment: SkidmarksClipSegment, plateIndex: number): SkidmarksClipSegment {
  return {
    ...segment,
    plates: segment.plates.map((p, i) =>
      i === plateIndex ? { ...p, still: { dataUrl: "data:image/jpeg;base64,X", source: "generated", createdAt: 1 } } : p
    ),
  };
}

describe("planAutoPlateFill", () => {
  it("returns nothing to do when every plate is already filled", () => {
    const segments = withPlateCount(buildDemoSegments(210), [1]).map((s) => fillPlate(s, 0));
    const targets = planAutoPlateFill(segments.slice(0, 1), "", "Jack Ash");
    expect(targets).toEqual([]);
  });

  it("plans one target per empty plate, never for an already-filled one", () => {
    let segments = withPlateCount(buildDemoSegments(210), [2]).slice(0, 1);
    segments = [fillPlate(segments[0], 0)];

    const targets = planAutoPlateFill(segments, "some generic brief", "Jack Ash");
    expect(targets).toHaveLength(1);
    expect(targets[0].plateId).toBe(segments[0].plates[1].id);
  });

  it("gives generic empty plates varied shot prompts (not the exact same line repeated)", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "a normal brief with no opener keywords", "Jack Ash");
    expect(targets).toHaveLength(3);
    const distinctPrompts = new Set(targets.map((t) => t.shotPrompt));
    expect(distinctPrompts.size).toBeGreaterThan(1);
  });

  it("never plans a continuity reference for a generic (non-opener) fill", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "a normal brief with no opener keywords", "Jack Ash");
    expect(targets.every((t) => t.continueFromPreviousPlate === false)).toBe(true);
  });

  it("applies the scripted door \u2192 keyhole \u2192 Jack opener only to the first clip, only when the brief mentions it", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3, 1]);
    const targets = planAutoPlateFill(segments, "door, keyhole, Jack, neon-blue", "Jack Ash");

    const firstClipTargets = targets.filter((t) => t.segmentId === segments[0].id);
    expect(firstClipTargets).toHaveLength(3);
    expect(firstClipTargets[0].shotPrompt).toContain("door");
    expect(firstClipTargets[1].shotPrompt).toContain("keyhole");
    expect(firstClipTargets[2].shotPrompt).toContain("Jack");
    expect(firstClipTargets[0].continueFromPreviousPlate).toBe(false);
    expect(firstClipTargets[1].continueFromPreviousPlate).toBe(true);
    expect(firstClipTargets[2].continueFromPreviousPlate).toBe(true);
  });

  it("never applies the scripted opener to a later clip, even if it too has empty plates", () => {
    const segments = withPlateCount(buildDemoSegments(210), [1, 3]);
    const targets = planAutoPlateFill(segments, "door, keyhole, Jack", "Jack Ash");
    const secondClipTargets = targets.filter((t) => t.segmentId === segments[1].id);
    expect(secondClipTargets.every((t) => !t.shotPrompt.toLowerCase().includes("keyhole"))).toBe(true);
  });

  it("doesn't apply the scripted opener when the brief doesn't mention it, even on the first clip", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "just a mood board, nothing specific", "Jack Ash");
    expect(targets.every((t) => !t.shotPrompt.toLowerCase().includes("keyhole"))).toBe(true);
  });

  it("falls back to the attached filename as a hint when the typed brief is blank", () => {
    const segments = withPlateCount(buildDemoSegments(210), [1]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "", "Jack Ash", "JACK ASH - behind the concrete door.mp3");
    expect(targets[0].shotPrompt.toLowerCase()).toContain("concrete");
  });

  it("caps the brief at MAX_AUTO_PLATE_BRIEF_LENGTH before matching keywords", () => {
    const segments = withPlateCount(buildDemoSegments(210), [1]).slice(0, 1);
    const longBrief = "x".repeat(MAX_AUTO_PLATE_BRIEF_LENGTH + 50) + " door";
    // "door" sits past the cap, so it should never actually be seen.
    const targets = planAutoPlateFill(segments, longBrief, "Jack Ash");
    expect(targets[0].shotPrompt.toLowerCase()).not.toContain("crumbling concrete wall");
  });
});

describe("ESTIMATED_STILL_COST_USD", () => {
  it("is a small, positive, rough per-still estimate", () => {
    expect(ESTIMATED_STILL_COST_USD).toBeGreaterThan(0);
    expect(ESTIMATED_STILL_COST_USD).toBeLessThan(0.1);
  });
});
