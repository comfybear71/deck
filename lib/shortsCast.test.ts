import { describe, expect, it } from "vitest";
import { buildAdultShortsStillPrompt } from "./adultShorts";
import { buildCharacterLoraEntry, SKYE_SEED } from "./characterLoras";
import { buildCharacterRoster } from "./characterRoster";
import { characterDeleteBlocker } from "./characterEdits";
import { buildRosterExtraCharacter } from "./rosterExtras";
import {
  findShortsCastCharacter,
  resolveShortsRenderCharacter,
  shortsCastList,
  shortsCastPictures,
  shortsCharacterFromCast,
} from "./shortsCast";
import { getSkidmarksSnapshot, type SkidmarksState } from "./skidmarks";

const REF = (n: number) => `https://blob.example/deck/shorts/shorts/blonde-girl-1/blonde-girl-1-ref-0${n}.jpg`;
const SKYLAR = { name: "SKYLAR", look: "", referenceUrls: [REF(1), REF(2), REF(3)] };

/** Stuart's data on 2026-09-30: Skylar in the editor and on EP01, with her own LoRA card. */
function skylarState(extra: Partial<SkidmarksState> = {}, character = SKYLAR): SkidmarksState {
  const base = getSkidmarksSnapshot();
  const card = {
    ...buildCharacterLoraEntry("SKYLAR", [], new Date(), { sourceKey: "as:skylar" }),
    referenceUrl: "https://blob.example/deck/shorts/characters/skylar/skylar-reference.jpg",
  };
  return {
    ...base,
    characterLoras: {
      characters: [
        {
          ...SKYE_SEED,
          referenceUrl: "https://blob.example/deck/shorts/characters/skye/skye-reference.jpg",
          trainingImageUrls: [1, 2, 3, 4].map((n) => `https://blob.example/deck/shorts/characters/skye/plates/skye-plate-0${n}.jpg`),
        },
        card,
      ],
    },
    adultShorts: {
      ageConfirmed: true,
      character,
      shots: [{ id: "a", prompt: "walks in", durationSec: 5, referenceIndex: 1, plateUrl: null, chainFromPrevious: false, clipUrl: null }],
      saved: [
        {
          id: "short_mumdrqaw_97e2b2ad",
          title: "BLONDE GIRL _1",
          savedAt: "2026-09-29T00:00:00Z",
          character: SKYLAR,
          shots: [{ id: "a", prompt: "walks in", durationSec: 5, referenceIndex: 1, plateUrl: null, chainFromPrevious: false, clipUrl: null }],
        },
      ],
      currentSavedId: "short_mumdrqaw_97e2b2ad",
    } as unknown as SkidmarksState["adultShorts"],
    ...extra,
  };
}

describe("Skylar's pictures and look live on her Cast card (the old Character box is gone)", () => {
  it("her Cast card carries her three pictures, in order, read from the episode with nothing moved", () => {
    const skylar = findShortsCastCharacter(skylarState(), "Skylar")!;
    expect(skylar.sourceKey).toBe("as:skylar");
    expect(shortsCastPictures(skylar)).toEqual([REF(1), REF(2), REF(3)]);
  });

  it("renders use exactly the same name, look and pictures as the old box did", () => {
    const st = skylarState();
    const r = resolveShortsRenderCharacter(st);
    expect(r).toEqual(SKYLAR);
    // Her pictures keep their order, and the still prompt is unchanged.
    expect(r.referenceUrls[1]).toBe(REF(2));
    expect(buildAdultShortsStillPrompt(r, { prompt: "walks in" })).toBe(buildAdultShortsStillPrompt(SKYLAR, { prompt: "walks in" }));
  });

  it("the pictures stay on her Cast card when the editor moves to another girl (EP01 still holds them)", () => {
    const st = skylarState({}, { name: "Skye", look: "", referenceUrls: [] });
    expect(shortsCastPictures(findShortsCastCharacter(st, "SKYLAR")!)).toEqual([REF(1), REF(2), REF(3)]);
  });

  it("pictures from every episode with her join her one Cast card, earlier ones first", () => {
    const st = skylarState({}, { name: "SKYLAR", look: "", referenceUrls: [REF(1)] });
    const tile = buildCharacterRoster(st)["adult-shorts"].filter((c) => c.name === "SKYLAR");
    expect(tile).toHaveLength(1);
    expect([tile[0].thumbUrl, ...tile[0].extraPictureUrls]).toEqual([REF(1), REF(2), REF(3)]);
  });

  it("an episode missing pictures gets them from her Cast card, its own order first", () => {
    const st = skylarState({}, { name: "SKYLAR", look: "", referenceUrls: [REF(3)] });
    expect(resolveShortsRenderCharacter(st).referenceUrls).toEqual([REF(3), REF(1), REF(2)]);
  });

  it("a look added on the Cast row is used when the episode has none", () => {
    const extra = { ...buildRosterExtraCharacter("SKYLAR", "wavy blonde hair, gold necklaces"), id: "sky" };
    const st = skylarState({ rosterExtras: { "music-video": [], "sunny-banks": [], "adult-shorts": [extra] } });
    expect(resolveShortsRenderCharacter(st).look).toBe("wavy blonde hair, gold necklaces");
  });

  it("a card-only girl (Skye) can star: her picked character comes from her Cast card", () => {
    const st = skylarState();
    const skye = shortsCastList(st).find((c) => c.sourceKey === "asx:skye");
    expect(skye).toBeTruthy();
    const picked = shortsCharacterFromCast(skye!);
    expect(picked.name).toBe("Skye");
    expect(picked.referenceUrls).toEqual([
      "https://blob.example/deck/shorts/characters/skye/skye-reference.jpg",
      "https://blob.example/deck/shorts/characters/skye/plates/skye-plate-01.jpg",
      "https://blob.example/deck/shorts/characters/skye/plates/skye-plate-02.jpg",
    ]);
  });

  it("nothing shows (or renders from the Cast) before the 18+ confirm", () => {
    const st = skylarState();
    const locked = { ...st, adultShorts: { ...st.adultShorts!, ageConfirmed: false } } as SkidmarksState;
    expect(shortsCastList(locked)).toEqual([]);
    expect(resolveShortsRenderCharacter(locked)).toEqual(SKYLAR);
  });

  it("her delete is still blocked while she's in EP01, in plain words", () => {
    const st = skylarState();
    const skylar = findShortsCastCharacter(st, "SKYLAR")!;
    expect(characterDeleteBlocker(skylar, st)).toMatch(/Shorts episode/);
  });
});
