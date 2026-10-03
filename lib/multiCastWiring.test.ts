import { describe, expect, it } from "vitest";
import { shortsShotCast, shortsShotPeople } from "./shortsCast";
import { builtInDeckLocations, normalizeDeckLocation } from "./deckLocations";
import { sunnyBanksLocationList } from "./sunnyBanksLocations";
import { buildEmptySunnyBanksLive, normalizeSunnyBanksStudio } from "./sunnyBanksWorkspace";
import { sunnybankPlateTarget } from "./deckMediaPaths";
import {
  buildSunnyBanksMultiCastHoldSuffix,
  buildSunnyBanksMultiCastPlatePrompt,
  parseSunnyBanksPlateUrl,
  parseSunnyBanksShotCast,
  sunnyBanksMultiCastRequest,
} from "./sunnyBanksShotCast";

/** Per-genre wiring for multi-cast shots (2026-10-03): saving, names and the shared pieces. */

const BLOB = "https://abc123.public.blob.vercel-storage.com/deck";

describe("Shorts: its picker goes through the shared helper", () => {
  const person = (name: string, pics: string[]) => ({ name, look: "", referenceUrls: pics });
  const STARRING = [person("SKYLAR", [`${BLOB}/s1.jpg`]), person("JADE", [`${BLOB}/j1.jpg`]), person("MIA", [])];

  it("keeps the starring order and the shot's own picks, matched in any capitals", () => {
    expect(shortsShotCast(STARRING, { castNames: ["jade", "Skylar"] }).names).toEqual(["SKYLAR", "JADE"]);
    expect(shortsShotPeople(STARRING, { castNames: ["jade", "Skylar"] }).map((p) => p.name)).toEqual(["SKYLAR", "JADE"]);
    expect(shortsShotCast(STARRING, {}).names).toEqual(["SKYLAR", "JADE", "MIA"]);
  });

  it("lists anyone with no picture, so the plate refuses before billing", () => {
    expect(shortsShotCast(STARRING, {}).missingPicture).toEqual(["MIA"]);
    expect(shortsShotCast(STARRING, { castNames: ["SKYLAR"] }).missingPicture).toEqual([]);
  });
});

describe("Locations: 'People already in this picture'", () => {
  it("is kept only when ticked, and reaches Sunnybank's location lock", () => {
    const [first] = builtInDeckLocations("sunnybank");
    expect(normalizeDeckLocation({ ...first, peopleInPicture: true })?.peopleInPicture).toBe(true);
    expect(normalizeDeckLocation({ ...first, peopleInPicture: "yes" })).not.toHaveProperty("peopleInPicture");
    expect(normalizeDeckLocation(first)).not.toHaveProperty("peopleInPicture");
    const list = sunnyBanksLocationList({ locations: [{ ...first, peopleInPicture: true }] });
    expect(list.find((l) => l.id === first.key)?.peopleInPicture).toBe(true);
    expect(sunnyBanksLocationList(null).some((l) => l.peopleInPicture)).toBe(false);
  });
});

describe("Sunnybank saving: the shared plate and who was in the shot", () => {
  it("keeps an https plate and 2–4 names; drops junk; an old row gains nothing", () => {
    const live = buildEmptySunnyBanksLive();
    const studio = normalizeSunnyBanksStudio({
      live: {
        ...live,
        runtimeMap: {
          I: {
            0: { lineKey: "Stuie:Hello BLOOM", status: "done", videoUrl: "https://b/x.mp4", plateUrl: `${BLOB}/p.png`, castNames: ["Stuie", "Bloom"] },
            1: { lineKey: "Bloom:", status: "error", plateUrl: "javascript:alert(1)", castNames: ["Bloom"] },
            2: { lineKey: "Shazza:", status: "done", videoUrl: "https://b/z.mp4" },
          },
        },
      },
      workspaces: [],
      saveSeq: 0,
    })!;
    const rows = studio.live.runtimeMap.I;
    expect(rows[0].plateUrl).toBe(`${BLOB}/p.png`);
    expect(rows[0].castNames).toEqual(["Stuie", "Bloom"]);
    expect(rows[1].plateUrl).toBeUndefined();
    expect(rows[1].castNames).toBeUndefined();
    expect("plateUrl" in rows[2]).toBe(false);
    expect("castNames" in rows[2]).toBe(false);
  });

  it("the plate's file name is readable: episode, act, beat, who, plate", () => {
    expect(sunnybankPlateTarget({ episodeSlug: "ep05", actId: "V", beatNumber: 1, castNames: ["Stuie", "Bloom"] })).toEqual({
      folder: "deck/sunnybank/episodes/ep05/act-v",
      name: "ep05-act-v-beat-01-stuie-bloom-plate",
    });
    expect(sunnybankPlateTarget({ episodeSlug: "../x", actId: "I", beatNumber: 1, castNames: ["A", "B"] })).toBeNull();
  });
});

describe("Sunnybank request and server parsing", () => {
  const person = (name: string, pic = true) => ({
    name,
    look: `${name} look`,
    ...(pic ? { pictureUrl: `${BLOB}/sunnybank/characters/${name.toLowerCase()}/${name.toLowerCase()}.jpg` } : {}),
  });

  it("a one-person row on a normal location sends nothing new", () => {
    expect(sunnyBanksMultiCastRequest({ people: [], sceneSpeakers: [] })).toEqual({});
    expect(sunnyBanksMultiCastRequest({ people: [], sceneSpeakers: [], locationHasPeople: true })).toEqual({
      locationHasPeople: true,
    });
  });

  it("the server puts the speaker first, caps at four, keeps Blob pictures only, needs two people", () => {
    const parsed = parseSunnyBanksShotCast(
      [person("Bloom"), { ...person("Stuie"), pictureUrl: "https://evil.example/x.jpg" }, person("Nan"), person("Shazza"), person("Dazza")],
      "stuie",
    )!;
    expect(parsed.map((p) => p.name)).toEqual(["Stuie", "Bloom", "Nan", "Shazza"]);
    expect(parsed[0].pictureUrl).toBeUndefined();
    expect(parseSunnyBanksShotCast([person("Stuie")], "Stuie")).toBeNull();
    expect(parseSunnyBanksShotCast([person("Bloom"), person("Nan")], "Stuie")).toBeNull();
    expect(parseSunnyBanksPlateUrl("https://evil.example/plate.png")).toBeNull();
  });

  it("the plate prompt: exactly N people, each picture labelled in order, everyone's mouth closed", () => {
    const people = [person("Stuie"), person("Bloom"), person("Nan"), person("Shazza")].map((p, i) => ({
      ...p,
      position: ["on the right", "front left", "behind", "far left"][i],
    }));
    const prompt = buildSunnyBanksMultiCastPlatePrompt({
      people,
      location: { id: "park_site_4", label: "Park Site 4", image: "" },
      speaker: "Stuie",
    });
    expect(prompt).toContain("Exactly 4 people in frame: Stuie, Bloom, Nan and Shazza.");
    expect(prompt.indexOf("Image 2 (<IMAGE_1>) is Stuie")).toBeLessThan(prompt.indexOf("Image 5 (<IMAGE_4>) is Shazza"));
    expect(prompt).toContain("All mouths closed.");
    expect(prompt).toContain("Stuie is the one talking");
    const hold = buildSunnyBanksMultiCastHoldSuffix(people.slice(0, 2));
    expect(hold).toContain("Also in frame: Bloom, Bloom look, front left.");
    expect(hold).toContain("every mouth stays closed the whole clip");
  });
});
