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
  adultShortShotPeople,
  adultShortTalkingWithNobody,
  normalizeAdultShortsState,
  withAdultShortShotPeople,
  type AdultShortsShot,
} from "./adultShorts";
import { shortsPlateReferences, shortsShotCast, shortsShotPeople } from "./shortsCast";

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


/**
 * "Nobody in this shot" with people starring (2026-10-04, Stuart: the
 * last chip can be unticked, or tap Nobody). Saved per shot as
 * `nobodyInShot: true`; no picks (absent) still means everyone starring.
 */
const NED = { name: "Ned", look: "", referenceUrls: ["https://abc123.public.blob.vercel-storage.com/deck/shorts/characters/ned/ned-01.jpg"], subjectWord: "man" as const };
const RAE = { name: "Rae", look: "", referenceUrls: ["https://abc123.public.blob.vercel-storage.com/deck/shorts/characters/rae/rae-01.jpg"], subjectWord: "woman" as const };
const shotOf = (extra: Partial<AdultShortsShot> = {}): AdultShortsShot => ({
  id: "shot_x",
  prompt: EMPTY_ROAD.prompt,
  durationSec: 5,
  referenceIndex: 0,
  plateUrl: null,
  clipUrl: null,
  lastFrameUrl: null,
  sirayTaskId: null,
  chainFromPrevious: false,
  ...extra,
});

describe("Nobody in this shot, with people starring", () => {
  it("no picks still means everyone starring (every shot saved before this, EP03's too)", () => {
    expect(adultShortShotPeople([NED, RAE], shotOf()).map((p) => p.name)).toEqual(["Ned", "Rae"]);
    expect(adultShortShotPeople([NED], shotOf()).map((p) => p.name)).toEqual(["Ned"]);
  });

  it("nobodyInShot: no people, no pictures, no names, the nobody prompt, for plate and clip", () => {
    const shot = shotOf({ nobodyInShot: true });
    const people = shortsShotPeople([NED, RAE], shot);
    expect(people).toEqual([]);
    expect(shortsPlateReferences(people)).toEqual([]);
    const cast = shortsShotCast([NED, RAE], shot);
    expect(cast.names).toEqual([]);
    expect(cast.missingPicture).toEqual([]);
    // Even when the prompt names someone starring.
    expect(shortsShotCast([NED, RAE], { ...shot, prompt: "Ned walks off" } as AdultShortsShot).names).toEqual([]);
    const still = buildAdultShortsStillPrompt(people, shot, { adult: false });
    const motion = buildAdultShortsMotionPrompt(people, shot, { adult: false });
    for (const p of [still, motion]) {
      expect(p).toBe(`${EMPTY_ROAD.prompt} ${ADULT_SHORTS_NOBODY_LOCK} ${ADULT_SHORTS_NOBODY_GENERAL_CONTENT_LOCK}`);
      expect(p).not.toMatch(/Ned|Rae/);
    }
  });

  it("unticking the last person (or Nobody) saves nobodyInShot; ticking someone back clears it", () => {
    const starring = [NED, RAE];
    const nobody = withAdultShortShotPeople(shotOf({ castNames: ["Ned"], speakerName: "Ned" }), starring, []);
    expect(nobody.nobodyInShot).toBe(true);
    expect(nobody).not.toHaveProperty("castNames");
    expect(nobody).not.toHaveProperty("speakerName");
    const ned = withAdultShortShotPeople(nobody, starring, ["Ned"]);
    expect(ned).not.toHaveProperty("nobodyInShot");
    expect(ned.castNames).toEqual(["Ned"]);
    // Everyone = no picks saved, exactly as before.
    const all = withAdultShortShotPeople(nobody, starring, ["Rae", "Ned"]);
    expect(all).not.toHaveProperty("nobodyInShot");
    expect(all).not.toHaveProperty("castNames");
    // One person starring can be unticked too.
    expect(withAdultShortShotPeople(shotOf(), [NED], []).nobodyInShot).toBe(true);
  });

  it("is saved per shot and survives a load, in the editor and in the Library", () => {
    const state = normalizeAdultShortsState({
      ageConfirmed: true,
      adult: false,
      starring: [NED],
      character: NED,
      shots: [shotOf({ id: "a" }), shotOf({ id: "b", nobodyInShot: true }), shotOf({ id: "c", castNames: ["Ned"] })],
      saved: [{ id: "short_1", title: "T", savedAt: 1, character: NED, starring: [NED], shots: [shotOf({ id: "b", nobodyInShot: true })] }],
    })!;
    expect(state.shots.map((s) => s.nobodyInShot ?? null)).toEqual([null, true, null]);
    expect(state.shots[0]).not.toHaveProperty("nobodyInShot");
    expect(state.shots[2].castNames).toEqual(["Ned"]);
    expect(state.saved[0].shots[0].nobodyInShot).toBe(true);
    // Junk is dropped; nobody wins over a stale pick list.
    const junk = normalizeAdultShortsState({ shots: [shotOf({ id: "j", nobodyInShot: "yes" as unknown as true }), { ...shotOf({ id: "k", castNames: ["Ned"] }), nobodyInShot: true }] })!;
    expect(junk.shots[0]).not.toHaveProperty("nobodyInShot");
    expect(junk.shots[1].nobodyInShot).toBe(true);
    expect(junk.shots[1]).not.toHaveProperty("castNames");
  });

  it("a talking shot with nobody in it is blocked (nobody can say the Line); a silent one is fine", () => {
    expect(adultShortTalkingWithNobody(shotOf({ nobodyInShot: true, line: "Hello there. [pause]" }))).toBe(true);
    expect(adultShortTalkingWithNobody(shotOf({ nobodyInShot: true }))).toBe(false);
    expect(adultShortTalkingWithNobody(shotOf({ line: "Hello there. [pause]" }))).toBe(false);
  });
});
