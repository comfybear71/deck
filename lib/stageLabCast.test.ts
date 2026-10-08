import { describe, expect, it } from "vitest";
import { normalizeSkidmarksState, type SkidmarksState } from "./skidmarks";
import { buildEmptySunnyBanksLive, buildSunnyBanksWorkspaceFromLive, type SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";
import {
  listStageLabProjects,
  pickDefaultStageLabProject,
  projectChipLabel,
  stageLabFromState,
  stagePackForProject,
} from "./stageLabCast";

const PIC = "https://example.com";

function shortsCard(id: string, label: string, slug: string): SunnyBanksWorkspaceSnapshot {
  const live = { ...buildEmptySunnyBanksLive("shorts"), workspaceTitle: label, mediaSlug: slug, episodeId: id };
  return { ...buildSunnyBanksWorkspaceFromLive(live, 1, 0, "shorts"), id, label, mediaSlug: slug };
}

function skidCard(id: string, label: string, slug: string): SunnyBanksWorkspaceSnapshot {
  const live = { ...buildEmptySunnyBanksLive("skidmarks"), workspaceTitle: label, mediaSlug: slug, episodeId: id };
  return { ...buildSunnyBanksWorkspaceFromLive(live, 1, 0, "skidmarks"), id, label, mediaSlug: slug };
}

function extra(
  id: string,
  name: string,
  episode: string,
  kind: "person" | "animal" | "object",
  picture?: string,
) {
  return {
    id,
    name,
    look: name === "House" ? "wall speaker, cyan ring" : "",
    episode,
    createdAt: 1,
    pictureUrls: picture ? [picture] : [],
    fictionalAdultConfirmed: true as const,
    kind,
  };
}

function loc(genre: "adult-shorts" | "skidmarks", key: string, episode: string | undefined, createdAt: number) {
  return {
    genre,
    key,
    name: key,
    episode,
    pictureUrl: `${PIC}/${key}.jpg`,
    createdAt,
  };
}

function deliciaeState(): SkidmarksState {
  const deliciae = shortsCard("ws-deliciae", "Deliciae", "deliciae");
  const goodBoy = shortsCard("ws-good-boy", "Deliciae", "good-boy");
  const hold = shortsCard("ws-hold", "Something To Hold", "something-to-hold");
  const baby = skidCard("ws-baby", "EP01 — The Baby Shower", "ep01-the-baby-shower");
  return normalizeSkidmarksState({
    shortsStudio: {
      live: { ...buildEmptySunnyBanksLive("shorts"), workspaceTitle: "Deliciae", mediaSlug: "deliciae", episodeId: "ws-deliciae" },
      workspaces: [goodBoy, deliciae, hold],
      saveSeq: 1,
    },
    skidmarksStudio: {
      live: { ...buildEmptySunnyBanksLive("skidmarks"), workspaceTitle: baby.label, mediaSlug: baby.mediaSlug, episodeId: baby.id },
      workspaces: [baby],
      saveSeq: 1,
    },
    adultShorts: { ageConfirmed: true, editor: "script", character: { name: "", look: "", referenceUrls: [] }, shots: [], saved: [], currentSavedId: null },
    rosterExtras: {
      "music-video": [],
      "sunny-banks": [],
      "adult-shorts": [
        extra("chr_arthur", "Arthur", "deliciae", "person", `${PIC}/arthur.jpg`),
        extra("chr_dennis", "Dennis", "deliciae", "person", `${PIC}/dennis.jpg`),
        extra("chr_mira", "Mira", "deliciae", "person", `${PIC}/mira.jpg`),
        extra("chr_pip", "Pip", "deliciae", "animal"),
        extra("chr_house", "House", "deliciae", "object"),
        extra("chr_eli", "Eli", "something-to-hold", "person", `${PIC}/eli.jpg`),
      ],
    },
    skidmarksEpisodes: {
      episodes: [],
      cast: [
        {
          id: "cast_dap",
          name: "Dap",
          role: "antihero",
          look: "dap",
          fictionalAdultConfirmed: true,
          createdAt: 1,
          pictureUrls: [`${PIC}/dap.jpg`],
          kind: "person",
          episode: "ep01-the-baby-shower",
        },
        {
          id: "cast_sparrow",
          name: "Sparrow",
          role: "supporting",
          look: "bird",
          fictionalAdultConfirmed: true,
          createdAt: 1,
          pictureUrls: [`${PIC}/sparrow.jpg`],
          kind: "animal",
          episode: "ep01-the-baby-shower",
        },
      ],
    },
    locations: {
      locations: [
        loc("skidmarks", "town_street", undefined, 1),
        loc("skidmarks", "park", undefined, 2),
        loc("skidmarks", "kitchen", "ep01-the-baby-shower", 3),
        loc("skidmarks", "courthouse", "ep01-the-baby-shower", 4),
        loc("skidmarks", "dap_bedroom", "ep01-the-baby-shower", 5),
        loc("adult-shorts", "ai_facility", "deliciae", 10),
        loc("adult-shorts", "arthur_flat", "deliciae", 11),
        loc("adult-shorts", "arthur_kitchen", "deliciae", 12),
        loc("adult-shorts", "arthur_bedroom", "deliciae", 13),
        loc("adult-shorts", "holo_restaurant", "deliciae", 14),
        loc("adult-shorts", "park_window", "deliciae", 15),
        loc("adult-shorts", "futuristic_park", "deliciae", 16),
        loc("adult-shorts", "eli_flat", "something-to-hold", 20),
      ],
    },
    characterLoras: { characters: [] },
  });
}

describe("Stage lab project scope", () => {
  it("defaults to the Shorts Deliciae folder, not Good Boy and not Baby Shower", () => {
    const state = deliciaeState();
    const projects = listStageLabProjects(state);
    const picked = pickDefaultStageLabProject(projects);
    expect(picked?.mediaSlug).toBe("deliciae");
    expect(picked?.genre).toBe("shorts");
    expect(picked?.label).toBe("Deliciae");
    expect(projectChipLabel(projects[0], projects)).toMatch(/good-boy|deliciae/);
  });

  it("Deliciae Cast is Arthur, Dennis, Mira, Pip, House — no droid, no other shows", () => {
    const state = deliciaeState();
    const { defaultProjectId, byProject, projects } = stageLabFromState(state);
    const pack = byProject[defaultProjectId!];
    expect(pack.actors.map((a) => a.name)).toEqual(["Arthur", "Dennis", "Mira", "Pip", "House"]);
    expect(pack.actors.some((a) => /droid/i.test(a.name))).toBe(false);
    expect(pack.actors.map((a) => a.name)).not.toContain("Dap");
    expect(pack.actors.map((a) => a.name)).not.toContain("Eli");
    expect(pack.actors.find((a) => a.name === "House")?.kind).toBe("object");
    expect(pack.actors.find((a) => a.name === "House")?.pictureUrl).toBeNull();
    expect(pack.actors.find((a) => a.name === "Pip")?.kind).toBe("animal");
    expect(projects.find((p) => p.id === defaultProjectId)?.genre).toBe("shorts");
  });

  it("Deliciae Locations are that episode's strip, not town_street / park / kitchen / courthouse", () => {
    const state = deliciaeState();
    const { defaultProjectId, byProject } = stageLabFromState(state);
    const keys = byProject[defaultProjectId!].locations.map((l) => l.key);
    expect(keys).toEqual([
      "ai_facility",
      "arthur_flat",
      "arthur_kitchen",
      "arthur_bedroom",
      "holo_restaurant",
      "park_window",
      "futuristic_park",
    ]);
    expect(keys).not.toContain("town_street");
    expect(keys).not.toContain("park");
    expect(keys).not.toContain("kitchen");
    expect(keys).not.toContain("courthouse");
    expect(keys).not.toContain("dap_bedroom");
    expect(keys).not.toContain("eli_flat");
  });

  it("switching to Baby Shower does not keep Deliciae Cast or Locations", () => {
    const state = deliciaeState();
    const baby = listStageLabProjects(state).find((p) => p.mediaSlug === "ep01-the-baby-shower")!;
    const pack = stagePackForProject(state, baby);
    expect(pack.actors.map((a) => a.name).sort()).toEqual(["Dap", "Sparrow"]);
    expect(pack.locations.map((l) => l.key)).toEqual(["kitchen", "courthouse", "dap_bedroom"]);
    expect(pack.actors.map((a) => a.name)).not.toContain("Arthur");
  });

  it("never invents a Service droid card", () => {
    const state = deliciaeState();
    const { byProject } = stageLabFromState(state);
    for (const pack of Object.values(byProject)) {
      expect(pack.actors.some((a) => /droid/i.test(a.name))).toBe(false);
    }
  });
});
