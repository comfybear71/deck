import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadPlan } from "./deckBlobCopyRun";
import { MOVE_PLAN_207_CSV, MOVE_PLAN_207_SHA256 } from "./deckBlobMovePlan207";

describe("bundled move plan (one-off)", () => {
  it("is byte-for-byte the approved CSV", () => {
    expect(createHash("sha256").update(MOVE_PLAN_207_CSV, "utf8").digest("hex")).toBe(MOVE_PLAN_207_SHA256);
  });

  it("passes every layout check with exactly 207 rows", () => {
    const plan = loadPlan(MOVE_PLAN_207_CSV, 207);
    expect(plan.problems).toEqual([]);
    expect(plan.rows).toHaveLength(207);
    expect(plan.bySource.reduce((n, s) => n + s.count, 0)).toBe(207);
  });
});
