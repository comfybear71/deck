import { describe, expect, it } from "vitest";
import { buildCharacterLoraEntry, SKYE_SEED } from "./characterLoras";
import { formatCharacterSeedTree, planCharacterSeed } from "./deckItemsSeed";

const c = (id: string, name: string, sourceKey: string | null) => ({ ...buildCharacterLoraEntry(name, []), id, sourceKey });

describe("planCharacterSeed", () => {
  it("one row per card, foldered by sourceKey, with counts", () => {
    const plan = planCharacterSeed({
      characters: [SKYE_SEED, c("clora_1", "Shazza", "sb:shazza"), c("clora_2", "Jack Ash", "mv:jack"), c("clora_3", "Big Sexy", "as:big")],
    });
    expect(plan.rows.map((r) => [r.itemId, r.folder])).toEqual([
      ["clora_skye", "adult-shorts"],
      ["clora_1", "sunnybank"],
      ["clora_2", "music-video"],
      ["clora_3", "adult-shorts"],
    ]);
    expect(plan.perFolder).toEqual({ deck: 0, sunnybank: 1, "music-video": 1, skidmarks: 0, "adult-shorts": 2 });
    expect(plan.skipped).toEqual([]);
  });

  it("skips duplicates and junk, and says why", () => {
    const plan = planCharacterSeed({ characters: [c("clora_1", "A", null), c("clora_1", "A again", null), { name: "no id" }, 7] });
    expect(plan.rows).toHaveLength(1);
    expect(plan.skipped.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it("flags a session with no characterLoras list (never invents the Skye seed)", () => {
    expect(planCharacterSeed(null)).toMatchObject({ rows: [], sessionHasNoCharacters: true });
    expect(planCharacterSeed({})).toMatchObject({ rows: [], sessionHasNoCharacters: true });
  });

  it("stores the cleaned card as the row data", () => {
    const plan = planCharacterSeed({ characters: [{ id: "clora_x", name: "X", trainingImageUrls: ["http://bad", "https://ok"] }] });
    expect(plan.rows[0].data).toMatchObject({ id: "clora_x", trainingImageUrls: ["https://ok"], status: "draft" });
  });

  it("draws a folder tree", () => {
    const tree = formatCharacterSeedTree(planCharacterSeed({ characters: [SKYE_SEED, c("clora_1", "Shazza", "sb:shazza")] }));
    expect(tree).toContain("Sunnybank");
    expect(tree).toContain("Shazza  [clora_1, sb:shazza]");
    expect(tree).toContain("Skye  [clora_skye, asx:skye]");
  });
});
