import { describe, expect, it } from "vitest";
import {
  ADULT_SHORTS_ADULT_LOCK,
  ADULT_SHORTS_CONTENT_LOCK,
  ADULT_SHORTS_GENERAL_CONTENT_LOCK,
  ADULT_SHORTS_NOBODY_ADULT_LOCK,
  ADULT_SHORTS_NOBODY_GENERAL_CONTENT_LOCK,
  ADULT_SHORTS_NOBODY_LOCK,
  buildAdultShortsMotionPrompt,
  buildAdultShortsStillPrompt,
} from "./adultShorts";
import { shortsPlateReferences, shortsShotPeople } from "./shortsCast";

/**
 * A shot with nobody in it (2026-10-04, EP03 shot 13: an empty outback
 * highway with crows; the Siray plate came back with a man in the road,
 * twice). No Cast picture was sent, but the prompt ended "Adult person,
 * clearly over 25, … same face, hair and body as the reference.
 * Everyone fully clothed." — asking for someone who isn't there.
 */
const EMPTY_ROAD = {
  prompt:
    "Gritty 16mm film, dim, muddy colours. Empty landscape, wide shot down a long straight empty outback highway. A flock of black crows lifts off the road and flies away from camera.",
};
const PERSON_WORDS = /\b(person|people|character|reference|identity|everyone|anyone|woman|man|her|his|their|face|body)\b/i;

describe("a shot with nobody in it", () => {
  it("sends no picture and names nobody (nobody starring, no picks)", () => {
    const people = shortsShotPeople([], {});
    expect(people).toEqual([]);
    expect(shortsPlateReferences(people)).toEqual([]);
  });

  it("the plate prompt (18+ off, like EP03) is the shot text, the look and the content rule: no person wording", () => {
    const p = buildAdultShortsStillPrompt([], EMPTY_ROAD, { adult: false });
    expect(p).toBe(`${EMPTY_ROAD.prompt} ${ADULT_SHORTS_NOBODY_LOCK} ${ADULT_SHORTS_NOBODY_GENERAL_CONTENT_LOCK}`);
    expect(p.slice(EMPTY_ROAD.prompt.length)).not.toMatch(PERSON_WORDS);
    expect(p).not.toContain(ADULT_SHORTS_GENERAL_CONTENT_LOCK);
    expect(p).not.toMatch(/Adult person/);
  });

  it("the clip prompt has no 'keep their identity' either", () => {
    const m = buildAdultShortsMotionPrompt([], EMPTY_ROAD, { adult: false });
    expect(m).toBe(`${EMPTY_ROAD.prompt} ${ADULT_SHORTS_NOBODY_LOCK} ${ADULT_SHORTS_NOBODY_GENERAL_CONTENT_LOCK}`);
    expect(m).not.toMatch(/identity|reference/i);
  });

  it("an 18+ episode keeps its age rule and content rule, without a reference or a face to copy", () => {
    for (const p of [buildAdultShortsStillPrompt([], EMPTY_ROAD), buildAdultShortsMotionPrompt([], EMPTY_ROAD, { adult: true })]) {
      expect(p).toBe(`${EMPTY_ROAD.prompt} ${ADULT_SHORTS_NOBODY_LOCK} ${ADULT_SHORTS_NOBODY_ADULT_LOCK} ${ADULT_SHORTS_CONTENT_LOCK}`);
      expect(p).not.toMatch(/reference|identity|same face/i);
    }
  });

  it("an old episode with an empty 'character' (no name, no look) is nobody too", () => {
    expect(buildAdultShortsStillPrompt({ name: "", look: "", referenceUrls: [] }, EMPTY_ROAD, { adult: false })).toBe(
      buildAdultShortsStillPrompt([], EMPTY_ROAD, { adult: false }),
    );
  });

  it("a shot with someone in it is exactly as before", () => {
    const ava = { name: "Ava", look: "short dark hair", referenceUrls: ["https://abc123.public.blob.vercel-storage.com/a.jpg"], subjectWord: "woman" as const };
    const p = buildAdultShortsStillPrompt([ava], { prompt: "At the bar." }, { adult: false });
    expect(p).toBe(`At the bar. Character: Ava, short dark hair. ${ADULT_SHORTS_ADULT_LOCK} ${ADULT_SHORTS_GENERAL_CONTENT_LOCK}`);
  });
});
