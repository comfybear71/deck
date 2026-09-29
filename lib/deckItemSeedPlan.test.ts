import { describe, expect, it } from "vitest";
import { buildStarterEpisode } from "./skidmarksEpisodes";
import { buildAdultShortsShot } from "./adultShorts";
import { DECK_FOLDER_LABELS } from "./deckItems";
import { formatDeckItemSeedTree, planDeckItemSeed } from "./deckItemSeedPlan";
import { SKIDMARKS_EPISODE_ITEMS } from "./skidmarksEpisodeItems";
import { ADULT_SHORT_ITEMS } from "./adultShortItems";

const ep = (id: string, title: string) => buildStarterEpisode(title, 1_759_000_000_000, id);
const short = (id: string, title: string) => ({
  id,
  title,
  savedAt: "2026-09-29T10:00:00.000Z",
  character: { name: "Skye", look: "", referenceUrls: [] },
  shots: [{ ...buildAdultShortsShot("shot_1"), prompt: "x" }],
});

const planEpisodes = (list: unknown) => planDeckItemSeed(SKIDMARKS_EPISODE_ITEMS, "skidmarks", (e) => e.title, list);
const planShorts = (list: unknown) => planDeckItemSeed(ADULT_SHORT_ITEMS, "adult-shorts", (s) => s.title, list);

describe("planDeckItemSeed: Skidmarks episodes", () => {
  it("one row per episode, keeping its own id, in the skidmarks folder", () => {
    const plan = planEpisodes([ep("ep_a", "EP01 · One"), ep("ep_b", "EP02 · Two")]);
    expect(plan.rows.map((r) => [r.itemId, r.folder, r.title])).toEqual([
      ["ep_a", "skidmarks", "EP01 · One"],
      ["ep_b", "skidmarks", "EP02 · Two"],
    ]);
    expect(plan.kind).toBe("skidmarks-episode");
    expect(plan.skipped).toEqual([]);
  });

  it("skips duplicates and junk, and says why", () => {
    const plan = planEpisodes([ep("ep_a", "A"), ep("ep_a", "A again"), { title: "no id" }, 7, { ...ep("x", "bad"), id: "bad id" }]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.skipped.map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });

  it("flags a session with no episode list", () => {
    expect(planEpisodes(null)).toMatchObject({ rows: [], sessionHasNoList: true });
    expect(planEpisodes(undefined)).toMatchObject({ rows: [], sessionHasNoList: true });
  });
});

describe("planDeckItemSeed: shorts", () => {
  it("one row per saved short, keeping its own id, in the adult-shorts folder", () => {
    const plan = planShorts([short("short_1", "Skye · beach"), short("short_2", "Skye · pool")]);
    expect(plan.rows.map((r) => [r.itemId, r.folder])).toEqual([
      ["short_1", "adult-shorts"],
      ["short_2", "adult-shorts"],
    ]);
    expect(plan.kind).toBe("adult-short");
  });

  it("skips a short with no shots (the Library never keeps one)", () => {
    const plan = planShorts([{ ...short("short_1", "empty"), shots: [] }]);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });

  it("draws a folder tree", () => {
    const tree = formatDeckItemSeedTree(planShorts([short("short_1", "Skye · beach")]), "Shorts");
    expect(tree).toContain(`└── ${DECK_FOLDER_LABELS["adult-shorts"]}`);
    expect(tree).toContain("Shorts (1)");
    expect(tree).toContain("Skye · beach  [short_1]");
  });
});
