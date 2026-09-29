import { describe, expect, it } from "vitest";
import { buildCharacterLoraEntry, SKYE_SEED } from "./characterLoras";
import { formatCharacterSeedTree, planCharacterSeed, planSunnybankEpisodeSeed } from "./deckItemsSeed";
import { buildEmptySunnyBanksLive, buildSunnyBanksWorkspaceFromLive } from "./sunnyBanksWorkspace";

const c = (id: string, name: string, sourceKey: string | null) => ({ ...buildCharacterLoraEntry(name, []), id, sourceKey });

describe("planCharacterSeed", () => {
  it("one row per card, foldered by sourceKey, with counts", () => {
    const plan = planCharacterSeed({
      characters: [SKYE_SEED, c("clora_1", "Shazza", "sb:shazza"), c("clora_2", "Jack Ash", "mv:jack"), c("clora_3", "Big Sexy", "as:big")],
    });
    expect(plan.rows.map((r) => [r.itemId, r.folder])).toEqual([
      ["clora_skye", "deck"],
      ["clora_1", "sunnybank"],
      ["clora_2", "music-video"],
      ["clora_3", "adult-shorts"],
    ]);
    expect(plan.perFolder).toEqual({ deck: 1, sunnybank: 1, "music-video": 1, skidmarks: 0, "adult-shorts": 1 });
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
    expect(tree).toContain("Skye  [clora_skye]");
  });
});

describe("planSunnybankEpisodeSeed", () => {
  const card = (id: string, label: string, extra: Record<string, unknown> = {}) => {
    const live = { ...buildEmptySunnyBanksLive(), workspaceTitle: label };
    return { ...buildSunnyBanksWorkspaceFromLive(live, 1_727_600_000_000, 1), id, ...extra };
  };

  it("one row per saved episode card, keyed by its own id, with a pinned media folder", () => {
    const plan = planSunnybankEpisodeSeed({
      live: { ...buildEmptySunnyBanksLive(), workspaceTitle: "Working copy" },
      workspaces: [card("ws-1", "The Big Wet"), card("ws-2", "Drop Bears", { mediaSlug: "drop-bears" }), card("ws-3", "The Big Wet")],
      saveSeq: 3,
    });
    expect(plan.rows.map((r) => [r.itemId, r.label, r.mediaSlug, r.mediaSlugNew])).toEqual([
      ["ws-1", "The Big Wet", "the-big-wet", true],
      ["ws-2", "Drop Bears", "drop-bears", false],
      ["ws-3", "The Big Wet", "the-big-wet-2", true],
    ]);
    expect(plan.rows[0].data).toMatchObject({ id: "ws-1", mediaSlug: "the-big-wet" });
    expect(plan.liveTitle).toBe("Working copy");
    expect(plan.skipped).toEqual([]);
  });

  it("skips junk and duplicates, and reports a session with no Sunnybank at all", () => {
    const plan = planSunnybankEpisodeSeed({ live: buildEmptySunnyBanksLive(), workspaces: [card("ws-1", "A"), card("ws-1", "B"), { nope: 1 }] });
    expect(plan.rows.map((r) => r.itemId)).toEqual(["ws-1"]);
    expect(plan.skipped).toHaveLength(2);
    expect(planSunnybankEpisodeSeed(null)).toMatchObject({ sessionHasNoSunnybank: true, rows: [] });
  });
});
