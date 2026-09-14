import { describe, expect, it } from "vitest";
import { buildDemoSegments, type SkidmarksClipSegment } from "./skidmarks";
import {
  estimateAutoPlateCostUsd,
  ESTIMATED_STILL_COST_USD,
  MAX_AUTO_PLATE_BRIEF_LENGTH,
  planAutoPlateFill,
  SIRAY_STILL_COST_USD,
} from "./autoPlate";

const LOCATION_WORDS = /highway|motel|dive bar|gas station|drive-in|underpass|pickup truck|crossroads/i;

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

  /**
   * Stuart's exact wording for *Talking to Concrete*'s 0:00–0:40
   * opener, recreating three plates lost in the Neon-migration incident
   * — pasted verbatim, not paraphrased. Locks the real text in place so
   * a future "tidy up the prompts" pass can't silently drift from what
   * he actually asked for, the same way `CONCRETE_OPENER_SHOTS`'s own
   * inline comments explain each line's job.
   */
  it("uses Stuart's exact door/keyhole/Jack wording, dead-on framing and all", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3]);
    const targets = planAutoPlateFill(segments, "door, keyhole, Jack", "Jack Ash");

    expect(targets[0].shotPrompt).toBe(
      "Front-on dark door, keyhole centered, mild blue neon only in the cracks around the frame, no light from the hole."
    );
    expect(targets[1].shotPrompt).toBe(
      "Same door, same angle, closer — keyhole centered and large, mild half-strength blue seep inside the hole only, no beam, no angle."
    );
    expect(targets[2].shotPrompt).toBe(
      "Same keyhole as the frame. Jack Ash, black brim fedora, sitting in a dim room, legs slightly apart, feet on the floor, hands on knees, face in deep shadow under the brim, neon blue lips only, no other face light. Not a new man, no lit portrait, no bare head."
    );
    // Names him by name specifically — this is what keeps
    // `shotPromptMentionsLockedCharacter` (lib/plateGeneration.ts)
    // firing his identity reference + hallmark lock on plate 3, the
    // actual fix for the "random guy" failure mode Stuart hit before.
    expect(targets[2].shotPrompt).toMatch(/\bJack\b/);
  });

  it("never applies the scripted opener to a later clip, even if it too has empty plates", () => {
    const segments = withPlateCount(buildDemoSegments(210), [1, 3]);
    // A single trigger word (not 2+ comma-separated phrases) so this
    // brief only ever exercises the opener, never the separate
    // "2+ places in the brief become this run's own locations" feature
    // (see `parseBriefLocationPhrases`) — a brief with real comma-
    // separated places is covered by its own tests below.
    const targets = planAutoPlateFill(segments, "door", "Jack Ash");
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
    // The filename's "concrete" is only the *trigger* keyword — the
    // opener's own shot 1 wording doesn't have to repeat it back
    // (Stuart's exact text for shot 1 doesn't), it just has to be the
    // scripted door shot and not a generic fallback prompt.
    expect(targets[0].shotPrompt.toLowerCase()).toContain("door");
  });

  it("caps the brief at MAX_AUTO_PLATE_BRIEF_LENGTH before matching keywords", () => {
    const segments = withPlateCount(buildDemoSegments(210), [1]).slice(0, 1);
    const longBrief = "x".repeat(MAX_AUTO_PLATE_BRIEF_LENGTH + 50) + " door";
    // "door" sits past the cap, so it should never actually be seen.
    const targets = planAutoPlateFill(segments, longBrief, "Jack Ash");
    expect(targets[0].shotPrompt.toLowerCase()).not.toContain("crumbling concrete wall");
  });

  // Stuart's ask (2026-09-14): Auto-plate is specifically so he never
  // has to type a per-clip location himself — a generic fill (xAI path,
  // no master still) has to actually name a real place, not just
  // describe the camera framing.
  it("gives every generic (xAI) fill a real backdrop, not just camera framing", () => {
    const segments = withPlateCount(buildDemoSegments(210), [4]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "a normal brief with no opener keywords", "Jack Ash");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.shotPrompt).toMatch(LOCATION_WORDS);
    }
  });

  it("varies the backdrop across several generic fills, not the same location every time", () => {
    const segments = withPlateCount(buildDemoSegments(210), [6]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "a normal brief with no opener keywords", "Jack Ash");
    const locations = targets.map((t) => t.shotPrompt.match(LOCATION_WORDS)?.[0]);
    expect(new Set(locations).size).toBeGreaterThan(1);
  });

  // 2026-09-14, Stuart's ask: the brief itself can list real places
  // instead of just triggering the hand-authored table.
  it("uses the brief's own comma-separated places as this run's locations, not the hand-authored table", () => {
    const segments = withPlateCount(buildDemoSegments(210), [4]).slice(0, 1);
    const briefPlaces = ["neon rooftop at dusk", "empty subway platform", "rain-slick alley", "quiet diner booth"];
    const targets = planAutoPlateFill(segments, briefPlaces.join(", "), "Jack Ash");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(briefPlaces.some((place) => target.shotPrompt.includes(place))).toBe(true);
      expect(target.shotPrompt).not.toMatch(LOCATION_WORDS);
    }
  });

  it("cycles the brief's own places deterministically, not the same one every time", () => {
    const segments = withPlateCount(buildDemoSegments(210), [4]).slice(0, 1);
    const briefPlaces = ["neon rooftop at dusk", "empty subway platform", "rain-slick alley"];
    const targets = planAutoPlateFill(segments, briefPlaces.join(", "), "Jack Ash");
    const used = targets.map((t) => briefPlaces.find((place) => t.shotPrompt.includes(place)));
    expect(new Set(used).size).toBeGreaterThan(1);
  });

  it("splits brief places on \" / \" as well as commas", () => {
    const segments = withPlateCount(buildDemoSegments(210), [4]).slice(0, 1);
    const briefPlaces = ["neon rooftop at dusk", "empty subway platform"];
    const targets = planAutoPlateFill(segments, briefPlaces.join(" / "), "Jack Ash");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(briefPlaces.some((place) => target.shotPrompt.includes(place))).toBe(true);
    }
  });

  it("falls back to the hand-authored table when the brief has fewer than two place phrases", () => {
    const segments = withPlateCount(buildDemoSegments(210), [4]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "a mood board with no commas at all", "Jack Ash");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.shotPrompt).toMatch(LOCATION_WORDS);
    }
  });

  it("Stuart's real example brief: the scripted opener still wins on clip 1's first three plates, the brief's own places drive the rest", () => {
    const segments = withPlateCount(buildDemoSegments(210), [4]).slice(0, 1);
    const brief = "red hallway door, fence gate in the dirt, night pool shallow end, wet concrete in the rain";
    const targets = planAutoPlateFill(segments, brief, "Jack Ash");
    expect(targets).toHaveLength(4);
    expect(targets[0].shotPrompt).toContain("door");
    expect(targets[1].shotPrompt).toContain("keyhole");
    expect(targets[2].shotPrompt).toContain("Jack");
    // The 4th plate falls past the 3-shot scripted opener — a real
    // generic fill, using the brief's own places.
    const briefPlaces = [
      "red hallway door",
      "fence gate in the dirt",
      "night pool shallow end",
      "wet concrete in the rain",
    ];
    expect(briefPlaces.some((place) => targets[3].shotPrompt.includes(place))).toBe(true);
  });
});

describe("ESTIMATED_STILL_COST_USD", () => {
  it("is a small, positive, rough per-still estimate", () => {
    expect(ESTIMATED_STILL_COST_USD).toBeGreaterThan(0);
    expect(ESTIMATED_STILL_COST_USD).toBeLessThan(0.1);
  });
});

const MASTER_STILL = "data:image/jpeg;base64,MASTER";

describe("planAutoPlateFill — master-still routing (Siray)", () => {
  it("keeps every fill on the generic xAI templates when no master still is passed, unchanged from today", () => {
    const segments = withPlateCount(buildDemoSegments(210), [1]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "", "Jack Ash");
    expect(targets[0].siray).toBeUndefined();
  });

  it("routes every non-scripted-opener fill to Siray once a master still is passed", () => {
    const segments = withPlateCount(buildDemoSegments(210), [2, 2]);
    const targets = planAutoPlateFill(segments, "", "Jack Ash", "", MASTER_STILL);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.siray).toEqual({ referenceImageDataUrl: MASTER_STILL });
    }
  });

  it("the scripted door/keyhole/Jack opener still wins over master-still routing when the brief mentions it", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "door, keyhole, Jack", "Jack Ash", "", MASTER_STILL);
    expect(targets[0].siray).toBeUndefined();
    expect(targets[0].shotPrompt).toContain("door");
  });

  it("gives the first clip's first empty slot an off-axis position, never the front-facing wide master (1/2)", () => {
    // Live-QA fix (2026-09-13, "every fucking image is staring straight
    // out the camera"): "Front wide"/"Front ¾" (1/2) are themselves
    // front-facing per Stuart's explicit ban — `pickSirayPosition` now
    // falls back to the off-axis mouth-on subset (5–8: "¾"/profile) for
    // this slot instead. See `lib/sirayPositions.test.ts` for the
    // dedicated pool-level coverage of this fallback.
    const segments = withPlateCount(buildDemoSegments(210), [2]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "", "Jack Ash", "", MASTER_STILL);
    expect(targets[0].shotPrompt).not.toMatch(/Front wide|Front ¾/);
    expect(targets[0].shotPrompt.toLowerCase()).toMatch(/\u00be|profile/);
  });

  it("routes a Vocal clip's later slots to off-axis mouth-on framing language, never a front position", () => {
    // buildDemoSegments' own seed cadence: index 0 is instrumental,
    // index 1 ("verse") is vocal — used at array index 1 (not the
    // "first clip" slot) so this exercises the plain vocal branch, not
    // the first-clip wide-master override.
    const segments = withPlateCount(buildDemoSegments(210), [1, 1]);
    expect(segments[1].label).toBe("verse");
    const targets = planAutoPlateFill(segments, "", "Jack Ash", "", MASTER_STILL);
    const target = targets.find((t) => t.segmentId === segments[1].id);
    expect(target).toBeDefined();
    expect(target!.shotPrompt.toLowerCase()).toMatch(/\u00be|profile/);
    expect(target!.shotPrompt.toLowerCase()).not.toMatch(/front mcu|front cu|low front/);
  });

  it("routes an Instrumental clip's slots to off-mouth framing language", () => {
    // Index 2 ("instrumental") is the first *non-first-clip*
    // instrumental segment in the seed cadence — keeps this clear of
    // the first-clip wide-master override, which index 0 would trigger.
    const segments = withPlateCount(buildDemoSegments(210), [1, 1, 1]);
    expect(segments[2].label).toBe("instrumental");
    const targets = planAutoPlateFill(segments, "", "Jack Ash", "", MASTER_STILL);
    const target = targets.find((t) => t.segmentId === segments[2].id);
    expect(target).toBeDefined();
    expect(target!.shotPrompt.toLowerCase()).toMatch(/back|high front|overhead|over-shoulder/);
  });

  // Stuart's ask (2026-09-14): `SIRAY_17_POSITIONS` is camera framing
  // only, so a Siray-routed fill needs its own real backdrop too, not
  // just whatever's already in the master reference photo.
  it("gives every Siray-routed fill a real backdrop alongside its camera position", () => {
    const segments = withPlateCount(buildDemoSegments(210), [6]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "", "Jack Ash", "", MASTER_STILL);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.shotPrompt).toMatch(LOCATION_WORDS);
    }
    const locations = targets.map((t) => t.shotPrompt.match(LOCATION_WORDS)?.[0]);
    expect(new Set(locations).size).toBeGreaterThan(1);
  });

  it("also uses the brief's own 2+ places for a Siray-routed fill's backdrop, not the hand-authored table", () => {
    const segments = withPlateCount(buildDemoSegments(210), [4]).slice(0, 1);
    const briefPlaces = ["neon rooftop at dusk", "empty subway platform"];
    const targets = planAutoPlateFill(segments, briefPlaces.join(", "), "Jack Ash", "", MASTER_STILL);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(briefPlaces.some((place) => target.shotPrompt.includes(place))).toBe(true);
      expect(target.shotPrompt).not.toMatch(LOCATION_WORDS);
    }
  });
});

describe("estimateAutoPlateCostUsd", () => {
  it("sums ESTIMATED_STILL_COST_USD for every xAI-routed target", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "", "Jack Ash");
    expect(estimateAutoPlateCostUsd(targets)).toBeCloseTo(targets.length * ESTIMATED_STILL_COST_USD, 6);
  });

  it("sums SIRAY_STILL_COST_USD for every Siray-routed target", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "", "Jack Ash", "", MASTER_STILL);
    expect(estimateAutoPlateCostUsd(targets)).toBeCloseTo(targets.length * SIRAY_STILL_COST_USD, 6);
  });

  it("sums a real mix correctly — the scripted opener stays xAI-priced even with a master still set", () => {
    const segments = withPlateCount(buildDemoSegments(210), [3]).slice(0, 1);
    const targets = planAutoPlateFill(segments, "door, keyhole, Jack", "Jack Ash", "", MASTER_STILL);
    const expected = targets.reduce(
      (sum, t) => sum + (t.siray ? SIRAY_STILL_COST_USD : ESTIMATED_STILL_COST_USD),
      0
    );
    expect(estimateAutoPlateCostUsd(targets)).toBeCloseTo(expected, 6);
  });

  it("returns 0 for an empty target list", () => {
    expect(estimateAutoPlateCostUsd([])).toBe(0);
  });
});
