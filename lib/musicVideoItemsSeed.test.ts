import { describe, expect, it } from "vitest";
import { formatMusicVideoSeedTree, planMusicVideoSeed } from "./musicVideoItemsSeed";

const cards = [{ id: "clora_jack", sourceKey: "mv:jack-ash-frontman" }];
const jack = { id: "jack-ash", name: "Jack Ash", tagline: "", coverSeed: 1, editIcon: "pencil", members: [{ id: "jack-ash-frontman", name: "Jack Ash", emoji: "🎸", looks: [] }] };
const stu = { id: "band_s", name: "STUBALLS", tagline: "", coverSeed: 2, editIcon: "camera", members: [{ id: "member_s", name: "Stuie", emoji: "x", looks: [] }] };
const mp3 = { attachId: "mp3_a", fileName: "CRACK HAUL.mp3", segments: [{ id: "c1" }, { id: "c2" }] };

describe("planMusicVideoSeed", () => {
  it("one row per band with member → character references, plus the desk's song", () => {
    const plan = planMusicVideoSeed(
      { bands: [jack, stu], session: { bandId: "band_s", mp3, scriptSequenceDraft: { script: "v1" } }, removedSeedBandIds: [] },
      cards,
    );
    expect(plan.bands.map((b) => [b.itemId, b.folder])).toEqual([
      ["jack-ash", "music-video"],
      ["band_s", "music-video"],
    ]);
    expect(plan.bands[0].members).toEqual([{ memberId: "jack-ash-frontman", name: "Jack Ash", characterId: "clora_jack" }]);
    expect(plan.bands[1].members[0].characterId).toBeNull();
    expect(plan.songs).toMatchObject([{ itemId: "mp3_a", fileName: "CRACK HAUL.mp3", bandId: "band_s", clipCount: 2 }]);
    expect(plan.songs[0].data.scriptSequenceDraft).toEqual({ script: "v1" });
    expect(plan.skipped).toEqual([]);
  });

  it("no song rows when the desk is empty", () => {
    const plan = planMusicVideoSeed({ bands: [jack], session: { bandId: "jack-ash", mp3: null } }, cards);
    expect(plan.songs).toEqual([]);
  });

  it("skips duplicates, junk, and a song whose band is gone, and says why", () => {
    const plan = planMusicVideoSeed({ bands: [jack, { ...jack }, { name: "no id" }, 7], session: { bandId: "band_gone", mp3 } }, cards);
    expect(plan.bands).toHaveLength(1);
    expect(plan.skipped.map((s) => s.what)).toEqual(["band jack-ash", "band #2", "band #3", "song CRACK HAUL.mp3"]);
  });

  it("flags a session with no bands list", () => {
    expect(planMusicVideoSeed({}, [])).toMatchObject({ bands: [], sessionHasNoBands: true });
  });

  it("draws a folder tree", () => {
    const tree = formatMusicVideoSeedTree(planMusicVideoSeed({ bands: [jack], session: { bandId: "jack-ash", mp3 } }, cards));
    expect(tree).toContain("Music video");
    expect(tree).toContain("Jack Ash  [jack-ash-frontman → character clora_jack]");
    expect(tree).toContain("CRACK HAUL.mp3  [mp3_a, band jack-ash, 2 clips]");
  });
});
