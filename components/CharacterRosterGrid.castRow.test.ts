import { describe, expect, it } from "vitest";
import { CAST_ROW_CLASS, CAST_ROW_TILE_CLASS } from "./CharacterRosterGrid";

describe("the Cast row (2026-10-01): one sideways line, like LOCATIONS", () => {
  it("never wraps and scrolls sideways by mouse or touch", () => {
    expect(CAST_ROW_CLASS).toContain("flex");
    expect(CAST_ROW_CLASS).toContain("overflow-x-auto");
    expect(CAST_ROW_CLASS).toContain("touch-pan-x");
    // Vertical page scroll still works when a swipe starts on the row.
    expect(CAST_ROW_CLASS).toContain("touch-pan-y");
    expect(CAST_ROW_CLASS).not.toMatch(/flex-wrap|grid/);
  });

  it("keeps every face 176px: a fixed 184px tile (4px padding each side) that never shrinks", () => {
    expect(CAST_ROW_TILE_CLASS).toBe("w-[184px] shrink-0");
  });
});
