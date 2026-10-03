import { describe, expect, it } from "vitest";
import {
  buildSpeakerListenerText,
  castFramingLine,
  castImageLabelLines,
  exactlyPeopleLine,
  findCastNameMentions,
  formatShotCastNames,
  MAX_SHOT_CAST,
  parseCastTagNames,
  resolveShotCast,
  resolveShotCastPositions,
  shotCastNameKey,
  XAI_EDIT_MAX_IMAGES,
} from "./shotCast";

/** The one shared "who's in this shot" helper (2026-10-03), used by every genre. */

const PIC = (n: string) => `https://abc.public.blob.vercel-storage.com/deck/sunnybank/characters/${n}/${n}-picture-01.jpg`;
const CARDS = [
  { name: "Ranger Bazza", picture: PIC("ranger-bazza") },
  { name: "Bloom", picture: PIC("bloom") },
  { name: "Stuie", picture: PIC("stuie") },
  { name: "Nan", picture: PIC("nan") },
  { name: "Shazza", picture: PIC("shazza") },
  { name: "Dazza", picture: null },
  { name: "Bazza", picture: PIC("bazza") },
];

describe("resolveShotCast picks, in order", () => {
  it("one person stays one person (the old single-card shot)", () => {
    const cast = resolveShotCast({ cards: CARDS, primary: "Shazza", shotText: ["counts a stack of bills"] });
    expect(cast.names).toEqual(["Shazza"]);
    expect(cast.isMulti).toBe(false);
  });

  it("speaker, then [Character X] names, then names in the shot text, then the scene's other speakers", () => {
    const cast = resolveShotCast({
      cards: CARDS,
      primary: "Stuie",
      characterTags: ["Bloom"],
      shotText: ["Nan watches from the van"],
      sceneSpeakers: ["Stuie", "Shazza"],
    });
    expect(cast.names).toEqual(["Stuie", "Bloom", "Nan", "Shazza"]);
    expect(cast.members.map((m) => m.source)).toEqual(["primary", "character-tag", "shot-text", "scene-speaker"]);
  });

  it("an explicit [Cast:] list is exact (plus the speaker), nothing else is added", () => {
    const cast = resolveShotCast({
      cards: CARDS,
      explicit: ["bloom"],
      primary: "Stuie",
      shotText: ["Nan and Shazza in the background"],
    });
    expect(cast.names).toEqual(["Stuie", "Bloom"]);
  });

  it("matches any capitals and spacing, and returns the Cast card's own spelling (STUIE = Stuie)", () => {
    expect(shotCastNameKey("STUIE")).toBe(shotCastNameKey("Stuie"));
    const cast = resolveShotCast({ cards: CARDS, primary: "STUIE", shotText: ["BLOOM, the man-bun guy front left"] });
    expect(cast.names).toEqual(["Stuie", "Bloom"]);
  });

  it("dedupes: the speaker named in the action, or twice, is one person", () => {
    const cast = resolveShotCast({
      cards: CARDS,
      primary: "Ranger Bazza",
      characterTags: ["Bloom", "BLOOM"],
      shotText: ["Ranger Bazza rising out of the muddy dam, Bloom in front"],
      sceneSpeakers: ["Ranger Bazza"],
    });
    expect(cast.names).toEqual(["Ranger Bazza", "Bloom"]);
  });

  it("caps at four; the rest are listed as dropped", () => {
    const cast = resolveShotCast({ cards: CARDS, primary: "Stuie", shotText: ["Bloom, Nan, Shazza and Ranger Bazza"] });
    expect(MAX_SHOT_CAST).toBe(4);
    expect(cast.names).toHaveLength(4);
    expect(cast.names).toEqual(["Stuie", "Bloom", "Nan", "Shazza"]);
    expect(cast.dropped).toEqual(["Ranger Bazza"]);
  });

  it("whole words only, longest name first", () => {
    expect(findCastNameMentions("bananas and nanna", CARDS)).toEqual([]);
    expect(findCastNameMentions("Ranger Bazza waves at Nan", CARDS)).toEqual(["Ranger Bazza", "Nan"]);
    expect(findCastNameMentions("Bazza alone", CARDS)).toEqual(["Bazza"]);
  });

  it("lists anyone picked with no Cast card picture (the caller refuses before billing)", () => {
    const cast = resolveShotCast({ cards: CARDS, primary: "Shazza", shotText: ["Dazza hands her a beer"] });
    expect(cast.names).toEqual(["Shazza", "Dazza"]);
    expect(cast.missingPicture).toEqual(["Dazza"]);
  });

  it("names that aren't Cast cards are skipped", () => {
    const cast = resolveShotCast({ cards: CARDS, primary: "Crowd", explicit: ["Nobody"], shotText: ["a stranger"] });
    expect(cast.names).toEqual([]);
  });
});

describe("shared text pieces", () => {
  it("[Cast: …] takes commas, & and 'and'", () => {
    expect(parseCastTagNames("STUIE, Bloom & Nan and Ranger Bazza")).toEqual(["STUIE", "Bloom", "Nan", "Ranger Bazza"]);
  });

  it("positions come from each person's own words in the shot text", () => {
    const action =
      "Both men stay in frame the whole time, mouths closed. BLOOM, the man-bun guy front left, folds his arms and nods slowly; STUIE, on the right, scratches his head and shifts his weight.";
    expect(resolveShotCastPositions([{ name: "Stuie" }, { name: "Bloom" }], [action])).toEqual(["on the right", "front left"]);
  });

  it("a person's own look wins; nobody placed anywhere gets left-to-right slots; only some placed leaves the rest blank", () => {
    expect(
      resolveShotCastPositions(
        [{ name: "Ranger Bazza" }, { name: "Bloom", shotLook: "back to camera, yoga tree pose, foreground" }],
        ["Ranger Bazza rising out of the muddy dam"],
      ),
    ).toEqual(["", "foreground"]);
    expect(resolveShotCastPositions([{ name: "A" }, { name: "B" }], ["they chat"])).toEqual(["on the left", "on the right"]);
    expect(resolveShotCastPositions([{ name: "A" }, { name: "B" }], ["they chat"], { defaults: false })).toEqual(["", ""]);
  });

  it("speaker/listener text is Stuart's wording", () => {
    expect(
      buildSpeakerListenerText(
        { name: "STUIE", look: "thin bloke in a singlet", position: "on the right" },
        [{ name: "BLOOM", look: "long blond man-bun", position: "front left" }],
      ),
    ).toBe(
      "STUIE, thin bloke in a singlet, on the right, is the only one speaking, mouth and jaw in clear sync with the audio. " +
        "BLOOM, long blond man-bun, front left, listens silently, lips pressed together, mouth closed the whole clip.",
    );
  });

  it("labels each picture after the place, and says exactly how many people", () => {
    expect(castImageLabelLines([{ name: "STUIE", position: "on the right" }, { name: "BLOOM" }], 2)).toEqual([
      "Image 2 (<IMAGE_1>) is STUIE, on the right — same face identity, hair, age, body and clothes as in image 2. Do not turn STUIE into a different person.",
      "Image 3 (<IMAGE_2>) is BLOOM — same face identity, hair, age, body and clothes as in image 3. Do not turn BLOOM into a different person.",
    ]);
    expect(exactlyPeopleLine(["STUIE", "BLOOM"])).toMatch(/^Exactly 2 people in frame: STUIE and BLOOM\./);
    expect(XAI_EDIT_MAX_IMAGES).toBe(5);
  });

  it("framing: one talker is nearer and larger; a two-hander keeps both faces visible", () => {
    expect(castFramingLine({ speaker: "STUIE", sceneSpeakers: ["STUIE"] })).toContain("STUIE is the one talking: nearer the camera and larger");
    const both = castFramingLine({ speaker: "STUIE", sceneSpeakers: ["STUIE", "BLOOM"] });
    expect(both).toContain("STUIE and BLOOM all talk in this scene");
    expect(both).not.toContain("larger");
    expect(castFramingLine({})).toContain("follows the shot text");
  });

  it("chips text", () => {
    expect(formatShotCastNames(["STUIE", "BLOOM"])).toBe("STUIE + BLOOM");
  });
});
