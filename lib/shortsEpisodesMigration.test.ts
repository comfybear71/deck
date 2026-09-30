import { describe, expect, it } from "vitest";
import { buildAdultShortsShot } from "./adultShorts";
import { formatShortsEpisodesPlan, planShortsEpisodes } from "./shortsEpisodesMigration";

const BLOB = "https://abc123.public.blob.vercel-storage.com";
const shots = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    ...buildAdultShortsShot(`shot_${i + 1}`),
    prompt: `shot ${i + 1}`,
    clipUrl: i === 0 ? null : `${BLOB}/clip-${i + 1}.mp4`,
    plateUrl: i < 2 ? `${BLOB}/plate-${i + 1}.jpg` : null,
  }));
const SAVED = { id: "short_a", title: "BLONDE GIRL _1", savedAt: "2026-09-29T07:54:24.872Z", character: { name: "", look: "", referenceUrls: [] }, shots: shots(5) };

describe("Shorts → episodes dry run", () => {
  it("the saved short is EP01, open, showing the editor's shots; the first save keeps every one", () => {
    const plan = planShortsEpisodes(
      { ageConfirmed: true, character: { name: "SKYLAR", look: "", referenceUrls: [] }, shots: shots(7), saved: [SAVED], currentSavedId: "short_a" },
      [{ itemId: "short_a", folder: "adult-shorts", data: SAVED, revision: 2, updatedAt: "t", deletedAt: null }],
    );
    expect(plan.cards).toEqual([
      { id: "short_a", code: "EP01", title: "BLONDE GIRL _1", open: true, character: "SKYLAR", shots: 7, clips: 6, folder: "deck/shorts/episodes/ep01-blonde-girl-1/" },
    ]);
    expect(plan.firstSave).toMatchObject({ cardId: "short_a", code: "EP01", newCard: false, shots: 7, clips: 6, character: "SKYLAR" });
    expect(plan.editorShots.every((s) => s.keptOnCard)).toBe(true);
    expect(plan.lost).toEqual([]);
    expect(formatShortsEpisodesPlan(plan)).toMatch(/Nothing lost\.\nNothing was written/);
  });

  it("an editor with shots and no card becomes a new EP card on the first save", () => {
    const plan = planShortsEpisodes({ ageConfirmed: true, character: { name: "Mia", look: "", referenceUrls: [] }, shots: shots(2), saved: [], currentSavedId: null }, []);
    expect(plan.cards).toEqual([]);
    expect(plan.firstSave).toMatchObject({ code: "EP01", newCard: true, shots: 2 });
    expect(plan.lost).toEqual([]);
  });
});
