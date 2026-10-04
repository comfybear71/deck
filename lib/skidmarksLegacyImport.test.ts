import { describe, expect, it } from "vitest";
import {
  importLegacyEpisodes,
  legacyAntiheroName,
  legacyEpisodeTitle,
  legacyImportOrder,
  previewLegacyEpisodes,
  spreadAcrossBeats,
  type LegacyEpisodeSource,
} from "@/lib/skidmarksLegacyImport";
import { normalizeSkidmarksEpisodesState } from "@/lib/skidmarksEpisodes";

const shot = (title: string, speaker?: string, text?: string, plateFile?: string) => ({
  title,
  summary: `${title} summary`,
  plateFile,
  beats: speaker ? [{ speaker, text }] : [],
});

const kimEp: LegacyEpisodeSource = {
  folderName: "EP03_KIM_THE_KUNT",
  savedAt: "2026-08-13T07:21:49.490Z",
  story: {
    campaignLabel: "EP03_KIM_THE_KUNT",
    intro: { title: "THE YEAR OF THE KUNT", notes: "Narrator: Tonight on Skidmarks." },
    outro: { title: "THE END", notes: "Credits." },
    scenes: [
      {
        placeName: "Cafe strip",
        shots: [
          shot("Kim arrives", "Kim the Gypsy KUNT", "Morning, peasants.", "p1.png"),
          shot("Tom", "Tom", "Yes love."),
          shot("Kim again", "Kim the Gypsy KUNT", "Move."),
        ],
      },
    ],
  },
};

const pitch: LegacyEpisodeSource = {
  folderName: "CURSOR_THE_PROJECT_PITCH",
  savedAt: "2026-08-16T02:22:27.298Z",
  story: { scenes: [{ shots: [shot("Pitch", "Kim the Gypsy KUNT", "Hi"), shot("Dap", "DAP", "Oi")] }] },
};

const school: LegacyEpisodeSource = {
  folderName: "EP04_DEEP_FRIED_GOES_TO_SCHOOL",
  story: {
    scenes: [
      {
        shots: [
          { title: "School corridor", summary: "Brittany Year11 catches Deep Fried.", beats: [{ speaker: "Brittany Year11", text: "Oi!" }] },
          shot("Terry", "Deep Fried Terry", "Chips?"),
        ],
      },
    ],
  },
};

const empty: LegacyEpisodeSource = { folderName: "The Mouth of the Hole 51_esc", story: { scenes: [{ shots: [] }] } };
const blank = { episodes: [], cast: [] };

describe("skidmarks legacy import", () => {
  it("tidies titles", () => {
    expect(legacyEpisodeTitle(kimEp)).toBe("EP03 KIM THE KUNT");
    expect(legacyEpisodeTitle({ folderName: "The Mouth of the Hole 51_esc", story: null })).toBe("The Mouth of the Hole");
  });

  it("finds the antihero from the folder name, ignoring words like 'the'", () => {
    expect(legacyAntiheroName(kimEp)).toBe("Kim the Gypsy KUNT");
    expect(legacyAntiheroName(pitch)).toBeNull();
    expect(legacyAntiheroName({ folderName: "EP01_DAP_THE_BABY_SHOWER", story: { scenes: [] } })).toBe("DAP");
  });

  it("spreads shots across the nine beats in order", () => {
    expect(spreadAcrossBeats(18).map((g) => g.length)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(spreadAcrossBeats(3).flat()).toEqual([0, 1, 2]);
    expect(spreadAcrossBeats(40).flat()).toHaveLength(40);
  });

  it("puts numbered episodes first", () => {
    expect(legacyImportOrder([pitch, empty, kimEp]).map((s) => s.folderName)[0]).toBe("EP03_KIM_THE_KUNT");
  });

  it("imports shots, lines, plates and bookends into beats", () => {
    const r = importLegacyEpisodes([kimEp], new Set([kimEp.folderName]), blank, 0);
    const ep = r.state.episodes[0];
    expect(r.imported).toBe(1);
    expect(ep.id).toBe("ep_legacy_ep03_kim_the_kunt");
    expect(ep.beats.b1.script).toContain("[Location: Cafe strip]");
    expect(ep.beats.b1.script).toContain("[Plate: p1.png]");
    expect(ep.beats.b1.script).toContain("Kim the Gypsy KUNT: Morning, peasants.");
    expect(ep.beats.intro.script).toContain("THE YEAR OF THE KUNT");
    expect(ep.beats.intro.script).toContain("Narrator: Tonight on Skidmarks.");
    expect(ep.beats.outro.script).toContain("Narrator: Credits.");
    const kim = r.state.cast.find((c) => c.id === ep.antiheroId)!;
    expect(kim.name).toBe("Kim the Gypsy KUNT");
    expect(kim.role).toBe("antihero");
    expect(ep.castIds.map((id) => r.state.cast.find((c) => c.id === id)!.name)).toEqual(["Tom"]);
  });

  it("gives an antihero only one death: the second appearance is supporting", () => {
    const r = importLegacyEpisodes([pitch, kimEp], new Set([pitch.folderName, kimEp.folderName]), blank, 0);
    const kimEpisode = r.state.episodes.find((e) => e.id.includes("kim"))!;
    const pitchEpisode = r.state.episodes.find((e) => e.id.includes("pitch"))!;
    const kimId = r.state.cast.find((c) => c.name === "Kim the Gypsy KUNT")!.id;
    expect(kimEpisode.antiheroId).toBe(kimId);
    expect(pitchEpisode.antiheroId).toBeNull();
    expect(pitchEpisode.castIds).toContain(kimId);
    expect(r.state.cast.filter((c) => c.name === "Kim the Gypsy KUNT")).toHaveLength(1);
  });

  it("imports the Year 11 character as an adult with a new name, everywhere", () => {
    const r = importLegacyEpisodes([school], new Set([school.folderName]), blank, 0);
    const json = JSON.stringify(r.state);
    expect(json).not.toMatch(/Year11/i);
    const brittany = r.state.cast.find((c) => c.name === "Brittany")!;
    expect(brittany.look).toMatch(/teacher/);
    expect(brittany.fictionalAdultConfirmed).toBe(true);
    expect(r.state.episodes[0].beats.b1.script).toContain("Brittany: Oi!");
  });

  it("skips already-imported episodes and survives normalizing", () => {
    const first = importLegacyEpisodes([kimEp], new Set([kimEp.folderName]), blank, 0);
    const again = importLegacyEpisodes([kimEp], new Set([kimEp.folderName]), first.state, 0);
    expect(again.imported).toBe(0);
    expect(again.skipped).toBe(1);
    expect(again.state.episodes).toHaveLength(1);
    expect(normalizeSkidmarksEpisodesState(first.state)).toEqual(first.state);
  });

  it("previews counts and marks empty or already-imported episodes", () => {
    const first = importLegacyEpisodes([kimEp], new Set([kimEp.folderName]), blank, 0);
    const pv = previewLegacyEpisodes([kimEp, empty], first.state);
    expect(pv[0]).toMatchObject({ alreadyImported: true, shotCount: 3, plateCount: 1, lineCount: 3 });
    expect(pv[1]).toMatchObject({ isEmpty: true, alreadyImported: false });
  });
});
