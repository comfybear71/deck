import { describe, expect, it } from "vitest";
import {
  ADULT_SHORTS_ADULT_LOCK,
  ADULT_SHORTS_CONTENT_LOCK,
  ADULT_SHORTS_GENERAL_CONTENT_LOCK,
  ADULT_SHORTS_GROUP_ADULT_LOCK,
  adultShortIsAdult,
  adultShortShotPeople,
  adultShortStarring,
  autoSaveAdultShortEditor,
  buildAdultShortsMotionPrompt,
  buildAdultShortsShot,
  buildAdultShortsStillPrompt,
  editorHasUnsavedChanges,
  normalizeAdultShortsState,
  openSavedAdultShort,
  setAdultShortStarring,
  startBlankAdultShort,
  type AdultShortsState,
} from "./adultShorts";
import { buildCharacterLoraEntry, SKYE_SEED } from "./characterLoras";
import { buildRosterExtraCharacter } from "./rosterExtras";
import { resolveShortsStarring, shortsPlateReferences, shortsShotPeople } from "./shortsCast";
import { getSkidmarksSnapshot, type SkidmarksState } from "./skidmarks";
import { adultShortEpisodeSlug } from "./deckMediaPaths";

const REF = (n: number) => `https://blob.example/deck/shorts/shorts/blonde-girl-1/blonde-girl-1-ref-0${n}.jpg`;
const BRO = (n: number) => `https://blob.example/deck/shorts/characters/brother/pictures/brother-picture-0${n}.jpg`;
const SKYLAR = { name: "SKYLAR", look: "", referenceUrls: [REF(1), REF(2), REF(3)] };
const BROTHER = { name: "Brother", look: "short dark hair, beard", referenceUrls: [BRO(1)] };

/** Skylar's EP01 as saved before this change (no starring list, no 18+ switch). */
const EP01 = {
  id: "short_mumdrqaw_97e2b2ad",
  title: "BLONDE GIRL _1",
  savedAt: "2026-09-29T00:00:00Z",
  character: SKYLAR,
  shots: [{ ...buildAdultShortsShot("shot_1"), prompt: "Lounging on a couch", referenceIndex: 1 }],
};

function editor(extra: Partial<AdultShortsState> = {}): AdultShortsState {
  return normalizeAdultShortsState({
    ageConfirmed: true,
    character: SKYLAR,
    shots: EP01.shots,
    saved: [EP01],
    currentSavedId: EP01.id,
    ...extra,
  })!;
}

describe("older shorts keep working (Skylar's EP01)", () => {
  it("EP01 reads as 18+ with Skylar the one person starring, and loading changes nothing", () => {
    const st = editor();
    expect(adultShortIsAdult(st)).toBe(true);
    expect(adultShortIsAdult(st.saved[0])).toBe(true);
    expect(adultShortStarring(st)).toEqual([SKYLAR]);
    expect(st.starring).toBeUndefined();
    expect(editorHasUnsavedChanges(st)).toBe(false);
    expect(autoSaveAdultShortEditor(st, new Date())).toBe(st);
  });

  it("a one-person prompt still says Character: SKYLAR, and a woman's lock is word for word the same", () => {
    const p = buildAdultShortsStillPrompt([{ ...SKYLAR, subjectWord: "woman" }], { prompt: "Lounging" });
    expect(p).toBe(`Lounging Character: SKYLAR. ${ADULT_SHORTS_ADULT_LOCK} ${ADULT_SHORTS_CONTENT_LOCK}`);
  });
});

describe("anyone can star, and more than one person", () => {
  it("a man's lock says man, not woman; anyone else is a person", () => {
    const man = buildAdultShortsMotionPrompt([{ ...BROTHER, subjectWord: "man" }], { prompt: "flexes" });
    expect(man).toContain("Adult man, clearly over 25");
    expect(man).toContain("Keep his identity consistent");
    expect(man).not.toMatch(/woman/i);
    const person = buildAdultShortsStillPrompt([{ ...BROTHER, subjectWord: "person" }], { prompt: "flexes" });
    expect(person).toContain("Adult person, clearly over 25");
  });

  it("a two-person shot names both, says which picture is who, and uses the group lock", () => {
    const people = [{ ...SKYLAR, subjectWord: "person" }, { ...BROTHER, subjectWord: "man" }];
    const still = buildAdultShortsStillPrompt(people, { prompt: "They arm-wrestle" });
    expect(still).toContain("Characters: SKYLAR; Brother, short dark hair, beard.");
    expect(still).toContain("Reference 1 is SKYLAR, Reference 2 is Brother.");
    expect(still).toContain(ADULT_SHORTS_GROUP_ADULT_LOCK);
    const motion = buildAdultShortsMotionPrompt(people, { prompt: "They arm-wrestle" });
    expect(motion).toContain("Keep everyone's identity consistent");
  });

  it("each person's main face goes to the plate, one each, in order (no From picker)", () => {
    expect(shortsPlateReferences([SKYLAR, BROTHER])).toEqual([REF(1), BRO(1)]);
    expect(shortsPlateReferences([BROTHER, SKYLAR])).toEqual([BRO(1), REF(1)]);
    // One person in the shot: just their main face, as before.
    expect(shortsPlateReferences([SKYLAR])).toEqual([REF(1)]);
    // Nobody in the shot: no pictures (made from the words only).
    expect(shortsPlateReferences([])).toEqual([]);
  });

  it("two people sharing the same first picture: the second gets their next one", () => {
    const twin = { name: "Twin", look: "", referenceUrls: [REF(1), BRO(2)] };
    expect(shortsPlateReferences([SKYLAR, twin])).toEqual([REF(1), BRO(2)]);
  });

  it("an old shot's saved From index is kept on the shot but no longer picks the picture", () => {
    const st = normalizeAdultShortsState({ ageConfirmed: true, character: SKYLAR, shots: EP01.shots, saved: [EP01] })!;
    expect(st.shots[0].referenceIndex).toBe(1);
    expect(st.saved[0].shots[0].referenceIndex).toBe(1);
    expect(shortsPlateReferences(shortsShotPeople([{ ...SKYLAR }], st.shots[0]))).toEqual([REF(1)]);
  });

  it("a shot has everyone starring by default, or just its own picks", () => {
    const starring = [SKYLAR, BROTHER];
    expect(adultShortShotPeople(starring, {}).map((p) => p.name)).toEqual(["SKYLAR", "Brother"]);
    expect(adultShortShotPeople(starring, { castNames: ["brother"] }).map((p) => p.name)).toEqual(["Brother"]);
    // A pick who no longer stars falls back to everyone.
    expect(adultShortShotPeople(starring, { castNames: ["Rambo"] }).map((p) => p.name)).toEqual(["SKYLAR", "Brother"]);
  });

  it("setting who's starring keeps `character` as the first of them, and saves onto the card", () => {
    const st = setAdultShortStarring(editor(), [SKYLAR, BROTHER, { ...BROTHER }]);
    expect(st.starring!.map((p) => p.name)).toEqual(["SKYLAR", "Brother"]);
    expect(st.character).toEqual(SKYLAR);
    const saved = autoSaveAdultShortEditor(st, new Date("2026-09-30T07:00:00Z"));
    expect(saved.saved[0].starring!.map((p) => p.name)).toEqual(["SKYLAR", "Brother"]);
    // Re-opening the card brings the whole cast back.
    const reopened = openSavedAdultShort({ ...saved, starring: [] }, EP01.id);
    expect(adultShortStarring(reopened).map((p) => p.name)).toEqual(["SKYLAR", "Brother"]);
  });

  it("each person is read through their own Cast card, with their card's word (woman, man, person)", () => {
    const base = getSkidmarksSnapshot();
    const skylarCard = { ...buildCharacterLoraEntry("SKYLAR", [], new Date(), { sourceKey: "as:skylar" }) };
    const extra = { ...buildRosterExtraCharacter("Brother", "short dark hair, beard", { pictureUrls: [BRO(1), BRO(2)] }), id: "bro" };
    const state: SkidmarksState = {
      ...base,
      characterLoras: { characters: [SKYE_SEED, skylarCard] },
      rosterExtras: { "music-video": [], "sunny-banks": [], "adult-shorts": [extra] },
      adultShorts: setAdultShortStarring(editor(), [SKYLAR, { name: "Brother", look: "", referenceUrls: [] }]),
    };
    const people = resolveShortsStarring(state);
    expect(people.map((p) => p.name)).toEqual(["SKYLAR", "Brother"]);
    expect(people[0].referenceUrls).toEqual([REF(1), REF(2), REF(3)]);
    expect(people[1].referenceUrls).toEqual([BRO(1), BRO(2)]);
    expect(people[1].look).toBe("short dark hair, beard");
    expect(shortsShotPeople(people, { castNames: ["Brother"] }).map((p) => p.name)).toEqual(["Brother"]);
  });
});

describe("each episode's own 18+ switch", () => {
  it("off: the prompts say fully clothed, nothing sexual; on: the old rule", () => {
    const off = buildAdultShortsStillPrompt([BROTHER], { prompt: "arm wrestling" }, { adult: false });
    expect(off).toContain(ADULT_SHORTS_GENERAL_CONTENT_LOCK);
    expect(off).not.toContain(ADULT_SHORTS_CONTENT_LOCK);
    const on = buildAdultShortsStillPrompt([BROTHER], { prompt: "arm wrestling" }, { adult: true });
    expect(on).toContain(ADULT_SHORTS_CONTENT_LOCK);
  });
});

describe("+ New: a blank workspace with its name", () => {
  it("no one starring, one empty shot, 18+ off, the typed name; nothing saved until a shot has something", () => {
    const blank = startBlankAdultShort(editor(), "  Brother   vs Rambo ");
    expect(blank.title).toBe("Brother vs Rambo");
    expect(adultShortStarring(blank)).toEqual([]);
    expect(blank.character.name).toBe("");
    expect(blank.shots).toHaveLength(1);
    expect(blank.shots[0].prompt).toBe("");
    expect(blank.adult).toBe(false);
    expect(blank.currentSavedId).toBeNull();
    expect(blank.mediaSlug).toBeUndefined();
    expect(autoSaveAdultShortEditor(blank, new Date())).toBe(blank);

    const typed = { ...blank, shots: blank.shots.map((s) => ({ ...s, prompt: "Two brothers arm-wrestle" })) };
    const saved = autoSaveAdultShortEditor(typed, new Date("2026-09-30T07:00:00Z"), "short_ep02");
    const ep2 = saved.saved.find((x) => x.id === "short_ep02")!;
    expect(ep2).toMatchObject({ title: "Brother vs Rambo", adult: false, episodeNumber: 2, starring: [] });
    expect(saved.title).toBeUndefined();
    expect(adultShortEpisodeSlug(2, ep2.title)).toBe("ep02-brother-vs-rambo");
    // EP01 is untouched and still 18+.
    expect(saved.saved.find((x) => x.id === EP01.id)).toEqual(editor().saved[0]);
  });
});
