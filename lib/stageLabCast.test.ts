import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCharacterLoraEntry } from "./characterLoras";
import { normalizeSkidmarksState, type SkidmarksState } from "./skidmarks";
import { buildEmptySunnyBanksLive, buildSunnyBanksWorkspaceFromLive, type SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";
import {
  DELICIAE_NOT_FOUND,
  DELICIAE_SHORTS_FOLDER,
  deliciaeStagePack,
  extraToStageMember,
  findDeliciaeShortsWorkspace,
  stageCastMainPicture,
} from "./stageLabCast";

const PIC = "https://example.com";
const HOUSE_REF = `${PIC}/house-reference-v2.jpg`;
const PIP_REF = `${PIC}/pip-reference.jpg`;
const GROKBOT_PIC = `${PIC}/grokbot-main.jpg`;
const HOUSE_TRAINING = `${PIC}/house-training-01.jpg`;

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
  const houseExtra = extra("chr_house", "House", "deliciae", "object");
  const pipExtra = extra("chr_pip", "Pip", "deliciae", "animal");
  const grokbotExtra = extra("chr_grokbot", "Grokbot", "deliciae", "object", GROKBOT_PIC);
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
    sunnyBanks: {
      live: { ...buildEmptySunnyBanksLive("sunnybank"), workspaceTitle: "EP05 — The Influencer Influx", mediaSlug: "ep05-the-influencer-influx" },
      workspaces: [skidCard("ws-ep05", "EP05 — The Influencer Influx", "ep05-the-influencer-influx")],
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
        pipExtra,
        houseExtra,
        grokbotExtra,
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
    characterLoras: {
      characters: [
        {
          ...buildCharacterLoraEntry("House", [], new Date(), {
            sourceKey: "asx:chr_house",
            referenceUrl: HOUSE_REF,
            subjectWord: "object",
          }),
          trainingImageUrls: [HOUSE_TRAINING, `${PIC}/house-training-02.jpg`],
        },
        {
          ...buildCharacterLoraEntry("Pip", [], new Date(), {
            sourceKey: "asx:chr_pip",
            referenceUrl: PIP_REF,
            subjectWord: "animal",
          }),
          trainingImageUrls: [`${PIC}/pip-training-01.jpg`],
        },
        {
          ...buildCharacterLoraEntry("Grokbot", [], new Date(), {
            sourceKey: "asx:chr_grokbot",
            referenceUrl: `${PIC}/grokbot-reference.jpg`,
            subjectWord: "object",
          }),
          trainingImageUrls: [`${PIC}/grokbot-training-01.jpg`],
        },
      ],
    },
  });
}

const OTHER_SHOW_NAMES = [
  "Baby Shower",
  "Cornish Arsehole",
  "Influencer Influx",
  "Golden Nugget",
  "OnlyFans",
  "Something To Hold",
  "Dap",
  "Eli",
  "town_street",
  "courthouse",
  "dap_bedroom",
];

describe("Stage lab Deliciae lock", () => {
  it("finds the Shorts folder deliciae, not Good Boy and not Baby Shower", () => {
    const state = deliciaeState();
    const found = findDeliciaeShortsWorkspace(state);
    expect(found?.mediaSlug).toBe(DELICIAE_SHORTS_FOLDER);
    expect(found?.id).toBe("ws-deliciae");
  });

  it("Deliciae Cast is Arthur, Dennis, Mira, Pip, House, Grokbot — no droid, no other shows", () => {
    const pack = deliciaeStagePack(deliciaeState());
    expect(pack.found).toBe(true);
    expect(pack.actors.map((a) => a.name)).toEqual(["Arthur", "Dennis", "Mira", "Pip", "House", "Grokbot"]);
    expect(pack.actors.some((a) => /droid/i.test(a.name))).toBe(false);
    expect(pack.actors.map((a) => a.name)).not.toContain("Dap");
    expect(pack.actors.map((a) => a.name)).not.toContain("Eli");
  });

  it("Deliciae Locations are that episode's strip, not town_street / park / kitchen / courthouse", () => {
    const keys = deliciaeStagePack(deliciaeState()).locations.map((l) => l.key);
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

  it("does not list or fall back to any other project name", () => {
    const pack = deliciaeStagePack(deliciaeState());
    const blob = JSON.stringify(pack);
    for (const name of OTHER_SHOW_NAMES) {
      expect(blob, name).not.toContain(name);
    }
  });

  it("Good Boy-only session is Deliciae not found — no fallback", () => {
    const goodBoy = shortsCard("ws-good-boy", "Deliciae", "good-boy");
    const state = normalizeSkidmarksState({
      shortsStudio: {
        live: { ...buildEmptySunnyBanksLive("shorts"), workspaceTitle: "Deliciae", mediaSlug: "good-boy", episodeId: goodBoy.id },
        workspaces: [goodBoy],
        saveSeq: 1,
      },
    });
    const pack = deliciaeStagePack(state);
    expect(pack.found).toBe(false);
    expect(pack.error).toBe(DELICIAE_NOT_FOUND);
    expect(pack.actors).toEqual([]);
    expect(pack.locations).toEqual([]);
  });

  it("Baby Shower only is Deliciae not found, never that show's Cast", () => {
    const baby = skidCard("ws-baby", "EP01 — The Baby Shower", "ep01-the-baby-shower");
    const state = normalizeSkidmarksState({
      skidmarksStudio: {
        live: { ...buildEmptySunnyBanksLive("skidmarks"), workspaceTitle: baby.label, mediaSlug: baby.mediaSlug, episodeId: baby.id },
        workspaces: [baby],
        saveSeq: 1,
      },
      skidmarksEpisodes: {
        episodes: [],
        cast: [{ id: "cast_dap", name: "Dap", role: "antihero", look: "dap", fictionalAdultConfirmed: true, createdAt: 1, pictureUrls: [`${PIC}/dap.jpg`], kind: "person", episode: "ep01-the-baby-shower" }],
      },
      locations: { locations: [loc("skidmarks", "town_street", undefined, 1)] },
    });
    const pack = deliciaeStagePack(state);
    expect(pack.found).toBe(false);
    expect(pack.error).toBe(DELICIAE_NOT_FOUND);
    expect(pack.actors).toEqual([]);
    expect(JSON.stringify(pack)).not.toContain("Dap");
    expect(JSON.stringify(pack)).not.toContain("town_street");
  });
});

describe("Stage lab Cast main picture", () => {
  it("House-like Object with empty pictureUrls uses the LoRA referenceUrl (Cast strip main picture)", () => {
    const house = extra("chr_house", "House", "deliciae", "object");
    const cards = [
      {
        ...buildCharacterLoraEntry("House", [], new Date(), {
          sourceKey: "asx:chr_house",
          referenceUrl: HOUSE_REF,
          subjectWord: "object",
        }),
        trainingImageUrls: [HOUSE_TRAINING],
      },
    ];
    expect(house.pictureUrls).toEqual([]);
    expect(stageCastMainPicture(house, cards)).toBe(HOUSE_REF);
    const member = extraToStageMember(house, cards);
    expect(member.kind).toBe("object");
    expect(member.pictureUrl).toBe(HOUSE_REF);
  });

  it("falls back to the first training picture when referenceUrl and extra pictures are empty", () => {
    const house = extra("chr_house", "House", "deliciae", "object");
    const cards = [
      {
        ...buildCharacterLoraEntry("House", [], new Date(), { sourceKey: "asx:chr_house", subjectWord: "object" }),
        trainingImageUrls: [HOUSE_TRAINING],
      },
    ];
    expect(stageCastMainPicture(house, cards)).toBe(HOUSE_TRAINING);
  });

  it("Pip and Grokbot resolve pictures too — Object kind does not skip the lookup", () => {
    const pack = deliciaeStagePack(deliciaeState());
    expect(pack.actors.find((a) => a.name === "Pip")?.pictureUrl).toBe(PIP_REF);
    expect(pack.actors.find((a) => a.name === "Pip")?.kind).toBe("animal");
    expect(pack.actors.find((a) => a.name === "Grokbot")?.kind).toBe("object");
    expect(pack.actors.find((a) => a.name === "Grokbot")?.pictureUrl).toBe(`${PIC}/grokbot-reference.jpg`);
    expect(pack.actors.find((a) => a.name === "House")?.pictureUrl).toBe(HOUSE_REF);
    expect(pack.actors.find((a) => a.name === "Arthur")?.pictureUrl).toBe(`${PIC}/arthur.jpg`);
  });
});

describe("Stage lab never enumerates other shows", () => {
  it("lab cast module does not import other-genre episode lists", () => {
    const text = readFileSync(resolve(process.cwd(), "lib/stageLabCast.ts"), "utf8");
    expect(text).not.toMatch(/skidmarksStudio/);
    expect(text).not.toMatch(/skidmarksEpisodeCast/);
    expect(text).not.toMatch(/SKIDMARKS_EPISODE_ITEMS/);
    expect(text).not.toMatch(/SUNNYBANK_EPISODE_ITEMS/);
    expect(text).not.toMatch(/SUNNY_BANKS_CAST/);
    expect(text).not.toMatch(/ADULT_SHORT_ITEMS/);
    expect(text).not.toMatch(/listStageLabProjects/);
    expect(text).not.toMatch(/kind=shorts-episode/);
    expect(text).not.toMatch(/kind=skidmarks-episode/);
    expect(text).not.toMatch(/kind=sunnybank-episode/);
    expect(text).not.toMatch(/kind=adult-short/);
  });

  it("StageLab UI has no project picker and no other-show names", () => {
    const text = readFileSync(resolve(process.cwd(), "components/StageLab.tsx"), "utf8");
    expect(text).not.toMatch(/aria-label="Project"/);
    expect(text).not.toMatch(/\+ Scene/);
    expect(text).not.toMatch(/onSelectProject/);
    expect(text).not.toMatch(/pickDefaultStageLabProject/);
    for (const name of OTHER_SHOW_NAMES) {
      expect(text, name).not.toContain(name);
    }
  });
});
