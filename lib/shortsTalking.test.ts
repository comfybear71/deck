import { describe, expect, it } from "vitest";
import {
  ADULT_SHORTS_CONTENT_LOCK,
  ADULT_SHORTS_GENERAL_CONTENT_LOCK,
  ADULT_SHORTS_GROUP_ADULT_LOCK,
  adultShortSpeaker,
  buildAdultShortsShot,
  buildAdultShortsTalkingPrompt,
  editorHasContent,
  formatAdultShortsTalkingCost,
  isAdultShortTalkingShot,
  normalizeAdultShortsState,
} from "./adultShorts";
import { talkingPromptWithLine } from "./adultShortsTalking";
import { buildCharacterLoraEntry } from "./characterLoras";
import { resolveShortsStarring } from "./shortsCast";
import { adultShortTarget } from "./deckMediaPaths";
import type { SkidmarksState } from "./skidmarks";

const SKYLAR = { name: "SKYLAR", look: "", referenceUrls: ["https://blob.example/deck/shorts/shorts/blonde-girl-1/blonde-girl-1-ref-01.jpg"] };
const BROTHER = { name: "Brother", look: "short dark hair", referenceUrls: ["https://blob.example/b.jpg"] };

describe("Shorts talking shots (a shot with a Line)", () => {
  it("a Line makes a talking shot; blank or missing stays silent on Siray", () => {
    expect(isAdultShortTalkingShot({ line: "[laughs] Hi" })).toBe(true);
    expect(isAdultShortTalkingShot({ line: "   " })).toBe(false);
    expect(isAdultShortTalkingShot({})).toBe(false);
  });

  it("the Line and speaker are saved on the shot, tags kept; older shots have neither", () => {
    const st = normalizeAdultShortsState({
      ageConfirmed: true,
      character: SKYLAR,
      shots: [
        { ...buildAdultShortsShot("a"), line: "[whispers] You came back.", speakerName: " Brother " },
        { ...buildAdultShortsShot("b"), line: "   " },
        buildAdultShortsShot("c"),
      ],
      saved: [],
    })!;
    expect(st.shots[0].line).toBe("[whispers] You came back.");
    expect(st.shots[0].speakerName).toBe("Brother");
    expect("line" in st.shots[1]).toBe(false);
    expect("line" in st.shots[2]).toBe(false);
    expect("speakerName" in st.shots[2]).toBe(false);
  });

  it("a Line alone counts as content (the episode gets saved)", () => {
    expect(editorHasContent({ character: { name: "", look: "", referenceUrls: [] }, shots: [{ ...buildAdultShortsShot("a"), line: "Hi" }] })).toBe(true);
  });

  it("the speaker is the picked one if they're in the shot, else the first person", () => {
    const people = [SKYLAR, BROTHER];
    expect(adultShortSpeaker(people, {})?.name).toBe("SKYLAR");
    expect(adultShortSpeaker(people, { speakerName: "brother" })?.name).toBe("Brother");
    expect(adultShortSpeaker(people, { speakerName: "Rambo" })?.name).toBe("SKYLAR");
    expect(adultShortSpeaker([], {})).toBeNull();
  });

  it("the LTX prompt keeps the adult lock and the episode's content rule", () => {
    const off = buildAdultShortsTalkingPrompt([{ ...BROTHER, subjectWord: "man" }], { prompt: "At the caravan" }, "Brother", { adult: false });
    expect(off).toContain("Brother speaks to camera, lips in sync with the audio.");
    expect(off).toContain("Adult man, clearly over 25");
    expect(off).toContain(ADULT_SHORTS_GENERAL_CONTENT_LOCK);
    const on = buildAdultShortsTalkingPrompt([SKYLAR, BROTHER], { prompt: "Arm-wrestle" }, "SKYLAR", { adult: true });
    expect(on).toContain(ADULT_SHORTS_GROUP_ADULT_LOCK);
    expect(on).toContain(ADULT_SHORTS_CONTENT_LOCK);
    // More than one person (2026-10-03): the shared speaker/listener text.
    expect(on).toContain("SKYLAR speaks to camera.");
    expect(on).toContain("SKYLAR is the only one speaking, mouth and jaw in clear sync with the audio.");
    expect(on).toContain("Brother listens silently, lips pressed together, mouth closed the whole clip.");
    expect(on).not.toContain("Everyone else listens.");
  });

  it("the picture prompt quotes only the words; the tags go to ElevenLabs", () => {
    expect(talkingPromptWithLine("P.", "Brother", "[whispers] Nobody move. [laughs]")).toBe('Brother says: "Nobody move." P.');
    expect(talkingPromptWithLine("P.", "Brother", "[laughs]")).toBe('Brother says: "[laughs]" P.');
    // The locks at the end always survive a long line.
    const long = talkingPromptWithLine("LOCKS.", "B", "x".repeat(3000));
    expect(long.endsWith(" LOCKS.")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(2000);
  });

  it("the price reads the way Sunnybank shows talking lines", () => {
    expect(formatAdultShortsTalkingCost()).toBe("~$0.13/s");
  });

  it("the voice file is named in the episode folder", () => {
    expect(adultShortTarget("ep02-brother-vs-rambo", "voice", 3)).toEqual({
      folder: "deck/shorts/episodes/ep02-brother-vs-rambo",
      name: "ep02-brother-vs-rambo-voice-03",
    });
  });

  it("each starring person's voice comes from their own Cast card", () => {
    const card = { ...buildCharacterLoraEntry("SKYLAR", [], new Date(), { sourceKey: "as:skylar", trainingStyle: "photo" }), voiceId: "Yre4AbCdEfGh12345678" };
    const state = {
      // EP01-style older episode open (its Cast is the shared one from before 2026-10-04).
      adultShorts: {
        ageConfirmed: true,
        character: SKYLAR,
        starring: [SKYLAR, BROTHER],
        shots: [buildAdultShortsShot("a")],
        saved: [{ id: "short_old_ep01", title: "EP01", savedAt: "2026-09-29T00:00:00Z", character: SKYLAR, shots: [buildAdultShortsShot("a")] }],
        currentSavedId: "short_old_ep01",
      },
      characterLoras: { characters: [card] },
    } as unknown as SkidmarksState;
    const people = resolveShortsStarring(state);
    expect(people.find((p) => p.name === "SKYLAR")?.voiceId).toBe("Yre4AbCdEfGh12345678");
    expect(people.find((p) => p.name === "Brother")?.voiceId).toBeUndefined();
  });
});
