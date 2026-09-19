import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMemberLookRequest,
  buildPlateGenerationRequest,
  buildSirayCharacterPrompt,
  generatePlateStill,
  getSkidmarksCharacterLock,
  plateGenerationHoldsIdentity,
  resolveVocalistForPrompt,
  shotPromptMentionsLockedCharacter,
} from "./plateGeneration";
import type { SkidmarksMember } from "./skidmarks";

function member(overrides: Partial<SkidmarksMember>): SkidmarksMember {
  return { id: "member-id", name: "", emoji: "", looks: [], ...overrides };
}

describe("resolveVocalistForPrompt", () => {
  it("resolves to undefined for a band with no named members yet", () => {
    expect(resolveVocalistForPrompt([member({ id: "blank" })])).toBeUndefined();
    expect(resolveVocalistForPrompt([])).toBeUndefined();
  });

  it("resolves the sole named member unambiguously, matching both seed bands", () => {
    const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
    expect(resolveVocalistForPrompt([jackAsh])).toBe(jackAsh);

    const nova = member({ id: "solar-rebel-vocals", name: "Nova", role: "Vocals" });
    expect(resolveVocalistForPrompt([nova])).toBe(nova);
  });

  it("prefers a member whose role reads like the vocalist/lead over other named members", () => {
    const drummer = member({ id: "drummer", name: "Rusty", role: "Drums" });
    const singer = member({ id: "singer", name: "Mo", role: "Lead vocals" });
    expect(resolveVocalistForPrompt([drummer, singer])).toBe(singer);
  });

  it("falls back to the first named member when no role matches", () => {
    const first = member({ id: "a", name: "Alex", role: "Bass" });
    const second = member({ id: "b", name: "Bo", role: "Synth" });
    expect(resolveVocalistForPrompt([first, second])).toBe(first);
  });

  it("skips blank members when picking the fallback", () => {
    const blank = member({ id: "blank" });
    const named = member({ id: "named", name: "Rio", role: "Guitar" });
    expect(resolveVocalistForPrompt([blank, named])).toBe(named);
  });
});

describe("getSkidmarksCharacterLock", () => {
  it("locks Jack Ash's face-in-shadow, glowing neon-blue-lips look", () => {
    const lock = getSkidmarksCharacterLock("jack-ash-frontman");
    expect(lock).toBeDefined();
    expect(lock?.promptHallmarks.toLowerCase()).toContain("neon blue");
    expect(lock?.promptHallmarks.toLowerCase()).toContain("shadow");
    expect(lock?.promptHallmarks.toLowerCase()).toContain("fedora");
    // The follow-up lock: never a lit/visible face, even in close-up.
    expect(lock?.promptHallmarks.toLowerCase()).toContain("hidden in deep shadow at all times");
    expect(lock?.negativeCues?.toLowerCase()).toContain("face lit or visible");
    expect(lock?.negativeCues?.toLowerCase()).toContain("normal skin tone");
    // Strengthened negatives from the live bug report (fully lit face, no
    // fedora, wrong person entirely — see plateGeneration.test.ts's
    // "live bug report" test below for the exact repro).
    expect(lock?.negativeCues?.toLowerCase()).toContain("fully lit face");
    expect(lock?.negativeCues?.toLowerCase()).toContain("bare head with no fedora");
    expect(lock?.negativeCues?.toLowerCase()).toContain("recognizable facial features visible in light");
    expect(lock?.negativeCues?.toLowerCase()).toContain("generic-looking person");
    // Live-QA fix (2026-09-13, "every fucking image is staring straight
    // out the camera"): the lock now also bans a front-facing/camera
    // stare explicitly, on top of the pre-existing face-in-shadow rule —
    // a fedora'd but square-to-camera shot violated the brief just as
    // much as a lit face did.
    expect(lock?.promptHallmarks.toLowerCase()).toContain("never turned");
    expect(lock?.promptHallmarks.toLowerCase()).toContain("toward the camera");
    expect(lock?.negativeCues?.toLowerCase()).toContain("staring straight into the camera");
    expect(lock?.negativeCues?.toLowerCase()).toContain("direct");
    expect(lock?.negativeCues?.toLowerCase()).toContain("lens");
  });

  it("returns undefined for any member without an explicit lock", () => {
    expect(getSkidmarksCharacterLock("solar-rebel-vocals")).toBeUndefined();
    expect(getSkidmarksCharacterLock("some-new-member-id")).toBeUndefined();
  });
});

describe("shotPromptMentionsLockedCharacter", () => {
  const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash" });

  it("matches Stuart's actual first-name phrasing ('door -> keyhole -> Jack seated')", () => {
    expect(
      shotPromptMentionsLockedCharacter("Looking through the keyhole, we see Jack seated, backlit.", jackAsh)
    ).toBe(true);
  });

  it("matches the full name too, case-insensitively", () => {
    expect(shotPromptMentionsLockedCharacter("a wide shot of JACK ASH walking into the desert", jackAsh)).toBe(true);
  });

  it("does not match on a substring inside another word", () => {
    expect(shotPromptMentionsLockedCharacter("a hijacked car speeds through the desert", jackAsh)).toBe(false);
  });

  it("returns false for a shot prompt that never names the character at all", () => {
    expect(shotPromptMentionsLockedCharacter("a door creaks open in an empty hallway", jackAsh)).toBe(false);
  });

  it("returns false for a member with no explicit character lock, even if named", () => {
    const nova = member({ id: "solar-rebel-vocals", name: "Nova" });
    expect(shotPromptMentionsLockedCharacter("Nova steps into the spotlight", nova)).toBe(false);
  });
});

const BAND_NAME = "Jack Ash";
const JACK_ASH_AVATAR = "data:image/jpeg;base64,jackAshPhotoBytes";

describe("buildPlateGenerationRequest", () => {
  /**
   * Real reported bug (2026-09-19), with a screenshot: a band member's
   * own photo was attached and the render came back a *blend* — the shot
   * prompt's described woman (afro, hoop earrings, olive tank top) fused
   * with the photo's man (dreadlocks, purple sunglasses) into a person
   * who was neither.
   *
   * Cause was the prompt's shape, not any one string: the user's
   * paragraph led and was by far the longest, most specific text in the
   * request, and the identity photo was introduced afterwards as a
   * "likeness reference". Ported the original Skidmarks repo's
   * `buildPlatePrompt` order instead (`src/lib/plateCast.ts`) — identity
   * locks first, the director's text last as `Staging / tweak:`.
   */
  describe("holding one artist against a contradicting shot prompt (2026-09-19)", () => {
    const soulRebel = member({
      id: "solar-rebel-vocalist",
      name: "Soul Rebel",
      role: "Vocals",
      avatarImage: "data:image/jpeg;base64,soulRebelPhoto",
    });
    const CONTRADICTING =
      "Over-the-shoulder view looking past a soulful female vocalist with a large, beautiful afro adorned " +
      "with wooden beads. She wears a simple olive green tank top and silver hoop earrings.";

    it("leads with the identity lock, not the shot prompt, when a photo is attached", () => {
      const { prompt } = buildPlateGenerationRequest({
        shotPrompt: CONTRADICTING,
        vocal: true,
        model: "ltx-lipsync",
        bandName: "Solar Rebel",
        vocalist: soulRebel,
      });
      expect(prompt.startsWith(CONTRADICTING)).toBe(false);
      expect(prompt.startsWith("the provided reference photo is the person")).toBe(true);
    });

    it("demotes the contradicting description to a trailing staging tweak, verbatim", () => {
      const { prompt, shotPrompt } = buildPlateGenerationRequest({
        shotPrompt: CONTRADICTING,
        vocal: true,
        model: "ltx-lipsync",
        bandName: "Solar Rebel",
        vocalist: soulRebel,
      });
      // Never dropped or reworded — it is still the director's text.
      expect(prompt).toContain(`Staging / tweak: ${CONTRADICTING}`);
      // And it must come after every lock, not before any of them.
      expect(prompt.indexOf("Staging / tweak:")).toBeGreaterThan(
        prompt.indexOf("Do not turn them into a different person")
      );
      // `shotPrompt` stays the raw user text for MAX_PROMPT_LENGTH.
      expect(shotPrompt).toBe(CONTRADICTING);
    });

    it("carries the three anti-blend locks the old shape had none of", () => {
      const { prompt } = buildPlateGenerationRequest({
        shotPrompt: CONTRADICTING,
        vocal: true,
        model: "ltx-lipsync",
        bandName: "Solar Rebel",
        vocalist: soulRebel,
      });
      expect(prompt).toContain("Do not turn them into a different person.");
      expect(prompt).toContain("do not change their gender");
      expect(prompt).toContain("Never merge two people into one face.");
      expect(prompt).toContain("One person only.");
    });

    it("leaves a person-less B-roll plate exactly as it was — nothing to hold, nothing to invert", () => {
      const withoutArtist = buildPlateGenerationRequest({
        shotPrompt: "an empty tropical beach at golden hour, no people",
        vocal: false,
        model: "grok",
        bandName: "Solar Rebel",
        vocalist: soulRebel,
      });
      // No identity reference on an Instrumental clip for an unlocked
      // member, so the original shot-prompt-first shape must survive.
      expect(withoutArtist.referenceImageDataUrls).toEqual([]);
      expect(withoutArtist.prompt.startsWith("an empty tropical beach at golden hour, no people")).toBe(true);
      expect(withoutArtist.prompt).not.toContain("Staging / tweak:");
    });
  });

  it("always leads with Stuart's own shot prompt, verbatim", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "a door creaks open in an empty hallway",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
    });
    expect(prompt.startsWith("a door creaks open in an empty hallway")).toBe(true);
  });

  it("returns `shotPrompt` as just Stuart's own (trimmed) text, distinct from the longer merged `prompt`", () => {
    const { prompt, shotPrompt } = buildPlateGenerationRequest({
      shotPrompt: "  Jack seated in a dim room, feet apart, backlit.  ",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(shotPrompt).toBe("Jack seated in a dim room, feet apart, backlit.");
    // The full merged prompt carries the character lock text on top \u2014
    // meaningfully longer than the raw shot prompt alone (this is
    // exactly why the server validates `shotPrompt`'s length, not
    // `prompt`'s \u2014 see `app/api/skidmarks/generate-still/route.ts`).
    expect(prompt.length).toBeGreaterThan(shotPrompt.length + 200);
  });

  it("reproduces Stuart's exact bug report: a ~400-char shot prompt + Jack Ash lock + 'Use last plate' pushes the merged prompt past 2000 chars on its own \u2014 shotPrompt itself stays well under", () => {
    // Stuart's literal report: cleared the shot-prompt box, pasted ~400
    // characters for Jack Ash with "Use last plate" checked (continuity),
    // and got "Prompt is too long \u2014 over 2000 characters" even though
    // his own visible text was nowhere near 2000. This is the exact
    // shape that triggers it: a real ~400-char shot prompt, Jack Ash as
    // the resolved vocalist/cast member (his lock is real and lengthy),
    // and `continuityStillDataUrl` set (what "Use last plate" produces).
    const fourHundredCharShotPrompt = "Jack seated in a dim room, backlit, feet apart. ".repeat(9).slice(0, 400);
    expect(fourHundredCharShotPrompt.length).toBe(400);

    const { prompt, shotPrompt } = buildPlateGenerationRequest({
      shotPrompt: fourHundredCharShotPrompt,
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
      continuityStillDataUrl: "data:image/jpeg;base64,previousPlateBytes",
    });

    // The bug, confirmed: the merged prompt alone clears 2000 chars from
    // *only* 400 real user characters \u2014 the old check (against
    // `prompt.length`) would have rejected this outright.
    expect(prompt.length).toBeGreaterThan(2000);
    // The fix: `shotPrompt` \u2014 what the server now actually validates
    // \u2014 is exactly Stuart's own text, comfortably under the cap.
    expect(shotPrompt).toBe(fourHundredCharShotPrompt);
    expect(shotPrompt.length).toBeLessThan(2000);
  });

  it("an Instrumental/B-roll clip has no vocalist mention and no reference images at all", () => {
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "a door creaks open in an empty hallway",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    // The band name itself is expected in every prompt ("Music video for
    // Jack Ash.") — what must NOT happen on an Instrumental/B-roll clip
    // is the vocalist being *featured*/locked-in as a character.
    expect(prompt).not.toContain("the vocalist");
    expect(prompt).not.toContain("Do not show:");
    expect(prompt).not.toContain("neon blue");
    // Audit Part 3: no factory framing/camera line on an Instrumental still.
    expect(prompt).not.toContain("Wide dynamic cinematic music-video establishing shot");
    expect(prompt).not.toContain("camera angle");
    expect(referenceImageDataUrls).toEqual([]);
  });

  it("follow-up fix: an Instrumental clip that names Jack Ash directly still carries his identity ref + lock", () => {
    // Stuart's own "door -> keyhole -> Jack seated" case: a 40s
    // Instrumental clip whose shot prompt puts the locked character in
    // frame. Must NOT get the Vocal-only "Feature ... the vocalist" line,
    // but MUST still get the identity reference and the hallmark/negative
    // cue lock — the exact gap this follow-up closes.
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "Looking through the keyhole of the last image, we see Jack seated in a dim room, feet apart.",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(referenceImageDataUrls).toEqual([JACK_ASH_AVATAR]);
    expect(prompt).not.toContain("the vocalist");
    expect(prompt).toContain("Do not show:");
    expect(prompt.toLowerCase()).toContain("neon blue");
    expect(prompt.toLowerCase()).toContain("hidden in deep shadow at all times");
    expect(prompt).toContain("is the person — same face identity");
    expect(prompt).toContain("Do not turn them into a different person.");
  });

  it("live bug repro: the exact reported Instrumental prompt now carries Jack Ash's identity ref + strengthened lock", () => {
    // Stuart's literal report: generated plate 3 on the Instrumental
    // opener with this shot prompt and got back a fully-lit, fedora-less,
    // wrong-looking face. This is the exact text from that report.
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt:
        "Looking through the keyhole of the last image we can see Jack Ash sitting in a dim room with his " +
        "legs spread a bit apart his feet on the floor",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(referenceImageDataUrls).toEqual([JACK_ASH_AVATAR]);
    expect(prompt).toContain("is the person — same face identity");
    expect(prompt).toContain("Do not turn them into a different person.");
    // The "not a generic stand-in" phrasing went with the old trailing
    // likeness line; the replacement locks say it harder, up front.
    expect(prompt.toLowerCase()).toContain("never merge two people into one face");
    expect(prompt.toLowerCase()).toContain("one person only");
    expect(prompt.toLowerCase()).toContain("fedora");
    expect(prompt.toLowerCase()).toContain("hidden in deep shadow at all times");
    expect(prompt.toLowerCase()).toContain("neon blue");
    expect(prompt).toContain("Do not show:");
    expect(prompt.toLowerCase()).toContain("fully lit face");
    expect(prompt.toLowerCase()).toContain("bare head with no fedora");
    expect(prompt.toLowerCase()).toContain("generic-looking person");
  });

  it("follow-up fix, signal 2: an Instrumental plate that continues from a plate that itself already featured him locks the character even without re-naming him", () => {
    // A later beat in the same story ("he stands, still in shadow") that
    // never re-says "Jack" but is chained via "Use last plate" — from a
    // plate that itself already featured him — shouldn't silently drop
    // the lock either.
    const previousPlate = "data:image/jpeg;base64,previousPlateBytes";
    const { prompt, referenceImageDataUrls, featuresLockedCharacter } = buildPlateGenerationRequest({
      shotPrompt: "he rises slowly from the chair and turns toward the window",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
      continuityStillDataUrl: previousPlate,
      continuityFeaturesLockedCharacter: true,
    });
    expect(referenceImageDataUrls).toEqual([previousPlate, JACK_ASH_AVATAR]);
    expect(prompt).toContain("Do not show:");
    expect(prompt.toLowerCase()).toContain("neon blue");
    expect(featuresLockedCharacter).toBe(true);
  });

  it("live bug repro: a door -> keyhole continuity chain must NOT inherit the lock when the plate it continues from never featured him", () => {
    // Stuart's exact live-QA report: plate 2 (an explicit, keyhole-only
    // prompt naming no one) continued from plate 1 (the door, also
    // empty of people) via "Use last plate," and the old "any
    // continuity image at all" signal wrongly injected Jack's
    // silhouette/neon lips into this person-less shot just because the
    // band happens to be Jack Ash.
    const doorPlate = "data:image/jpeg;base64,doorPlateBytes";
    const { prompt, referenceImageDataUrls, featuresLockedCharacter } = buildPlateGenerationRequest({
      shotPrompt: "Looking through the door's keyhole into a dim room beyond, neon-blue light spilling around the edges of the frame.",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
      continuityStillDataUrl: doorPlate,
      // The door plate never featured him — this is the exact fact
      // `lib/skidmarks.ts`'s `SkidmarksPlateStill.featuresLockedCharacter`
      // would resolve to `false`/`undefined` for it.
      continuityFeaturesLockedCharacter: false,
    });
    // Continuity reference only — never the identity photo, never the
    // hallmark/negative-cue lock, for a shot that never named or showed him.
    expect(referenceImageDataUrls).toEqual([doorPlate]);
    expect(prompt).not.toContain("Do not show:");
    expect(prompt.toLowerCase()).not.toContain("neon blue");
    expect(prompt.toLowerCase()).not.toContain("fedora");
    expect(featuresLockedCharacter).toBe(false);
  });

  it("continuity alone (continuityFeaturesLockedCharacter omitted/undefined) never invents the lock on its own", () => {
    const doorPlate = "data:image/jpeg;base64,doorPlateBytes";
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "Looking through the keyhole, an empty dim room beyond.",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
      continuityStillDataUrl: doorPlate,
      // No explicit `continuityFeaturesLockedCharacter` at all — the
      // default (falsy) must never be treated as "yes, he's in frame."
    });
    expect(referenceImageDataUrls).toEqual([doorPlate]);
    expect(prompt).not.toContain("Do not show:");
    expect(prompt.toLowerCase()).not.toContain("neon blue");
  });

  it("featuresLockedCharacter is true whenever a Vocal clip auto-includes the locked vocalist, false on a plain Instrumental clip that never mentions or continues from him", () => {
    const vocalCase = buildPlateGenerationRequest({
      shotPrompt: "singing into a vintage microphone",
      vocal: true,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(vocalCase.featuresLockedCharacter).toBe(true);

    const plainInstrumentalCase = buildPlateGenerationRequest({
      shotPrompt: "a door creaks open in an empty hallway",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(plainInstrumentalCase.featuresLockedCharacter).toBe(false);
  });

  it("signal 2 does not apply to an un-locked member — plain continuity alone never invents a lock", () => {
    const previousPlate = "data:image/jpeg;base64,previousPlateBytes";
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "the alley stretches on, neon signs flickering",
      vocal: false,
      model: "grok",
      bandName: "Solar Rebel",
      vocalist: member({ id: "solar-rebel-vocals", name: "Nova", avatarImage: "data:image/jpeg;base64,novaBytes" }),
      continuityStillDataUrl: previousPlate,
    });
    // Only the continuity reference, never an identity one, for a member
    // with no explicit character lock.
    expect(referenceImageDataUrls).toEqual([previousPlate]);
    expect(prompt).not.toContain("Do not show:");
  });

  it("an Instrumental clip naming an un-locked member still doesn't feature or reference them", () => {
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "Nova walks alone down a neon-lit alley",
      vocal: false,
      model: "grok",
      bandName: "Solar Rebel",
      vocalist: member({ id: "solar-rebel-vocals", name: "Nova", avatarImage: "data:image/jpeg;base64,novaBytes" }),
    });
    expect(referenceImageDataUrls).toEqual([]);
    expect(prompt).not.toContain("the vocalist");
    expect(prompt).not.toContain("Do not show:");
  });

  /**
   * 2026-09-19 live bug: Generate plates dropped the artist photo on
   * Intro/Instrumental because resolvePlateIdentity only attached
   * avatarImage when vocal===true or the member was Jack-locked. The
   * identity-safe / Generate plates path always resolves a place still
   * first and passes it as locationStillDataUrl — that signal means the
   * artist is IN FRAME on every person plate (all artists, all songs).
   * Photo is the lock; costume words alone must never invent a face.
   */
  describe("Generate plates path: place still always attaches artist photo", () => {
    const PLACE = "data:image/jpeg;base64,emptyPlaceBytes";
    const ARTIST = "data:image/jpeg;base64,novaPhotoBytes";
    const nova = member({ id: "solar-rebel-vocals", name: "Nova", avatarImage: ARTIST });

    it("Instrumental person plate gets avatarImage as identity ref (unlocked artist)", () => {
      const { prompt, referenceImageDataUrls, featuresLockedCharacter } = buildPlateGenerationRequest({
        shotPrompt: "driving at night in a leather jacket, chrome headphones, gold chain",
        vocal: false,
        model: "grok",
        bandName: "Solar Rebel",
        vocalist: nova,
        locationStillDataUrl: PLACE,
      });
      expect(referenceImageDataUrls).toEqual([PLACE, ARTIST]);
      expect(prompt).toContain("is the person");
      expect(prompt).toContain("Do not turn them into a different person.");
      expect(prompt).toContain("Staging / tweak:");
      expect(prompt).toContain("driving at night in a leather jacket");
      // Unlocked artist: photo hold only — no Soul Rebel / Jack lock card.
      expect(prompt).not.toContain("Do not show:");
      expect(prompt).not.toContain("the vocalist");
      expect(featuresLockedCharacter).toBe(true);
    });

    it("Intro person plate gets avatarImage as identity ref", () => {
      const { referenceImageDataUrls, prompt } = buildPlateGenerationRequest({
        shotPrompt: "walking onto the stage, small smile, mouth closed",
        vocal: false,
        model: "grok",
        bandName: "Solar Rebel",
        vocalist: nova,
        locationStillDataUrl: PLACE,
      });
      expect(referenceImageDataUrls).toEqual([PLACE, ARTIST]);
      expect(prompt).toContain("is the person");
      expect(plateGenerationHoldsIdentity({
        shotPrompt: "walking onto the stage, small smile, mouth closed",
        vocal: false,
        model: "grok",
        bandName: "Solar Rebel",
        vocalist: nova,
        locationStillDataUrl: PLACE,
      })).toBe(true);
    });

    it("does not invent a face when place is set but the artist has no photo", () => {
      const noPhoto = member({ id: "solar-rebel-vocals", name: "Nova" });
      const params = {
        shotPrompt: "leather jacket, chrome headphones, gold chain — invent this face",
        vocal: false as const,
        model: "grok" as const,
        bandName: "Solar Rebel",
        vocalist: noPhoto,
        locationStillDataUrl: PLACE,
      };
      expect(plateGenerationHoldsIdentity(params)).toBe(false);
      const { referenceImageDataUrls, prompt } = buildPlateGenerationRequest(params);
      // No identity image — callers (runGeneratePlates) must fail the clip
      // before this; if they don't, we still refuse to attach a fake face.
      expect(referenceImageDataUrls).toEqual([PLACE]);
      expect(prompt).not.toContain("is the person");
      expect(prompt).not.toContain("Do not turn them into a different person.");
    });

    it("person-less B-roll without a place still still omits identity (door/keyhole unchanged)", () => {
      const { referenceImageDataUrls } = buildPlateGenerationRequest({
        shotPrompt: "a brass keyhole, lit from behind, dust in the light",
        vocal: false,
        model: "grok",
        bandName: "Solar Rebel",
        vocalist: nova,
      });
      expect(referenceImageDataUrls).toEqual([]);
      expect(plateGenerationHoldsIdentity({
        shotPrompt: "a brass keyhole, lit from behind, dust in the light",
        vocal: false,
        model: "grok",
        bandName: "Solar Rebel",
        vocalist: nova,
      })).toBe(false);
    });
  });

  it("follow-up fix: combines continuity (first) and the Instrumental cast-ref identity (second) in order", () => {
    const previousPlate = "data:image/jpeg;base64,previousPlateBytes";
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "the door creaks open and Jack steps into view, still seated",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
      continuityStillDataUrl: previousPlate,
    });
    expect(referenceImageDataUrls).toEqual([previousPlate, JACK_ASH_AVATAR]);
    expect(prompt).toContain("<IMAGE_0>");
    expect(prompt).toContain("<IMAGE_1>");
    // 2026-09-19: the identity note is now a leading lock, not a trailing
    // "likeness reference" line — see `buildPlateGenerationRequest`.
    expect(prompt).toContain("<IMAGE_1> is the person — same face identity");
    expect(prompt).toContain("Do not turn them into a different person.");
    expect(prompt.toLowerCase()).toContain("neon blue");
  });

  it("routes a Vocal + LTX Lip-sync clip to tight, off-axis framing — never a camera-facing stare", () => {
    // Live-QA fix (2026-09-13): this framing hint used to end in
    // ", camera-facing, " — an affirmative style instruction telling
    // the model to point the vocalist's eyes at the lens, which fought
    // directly against a locked character's own no-stare lock. Reworded
    // to an angled ¾/profile framing instead, and must never contain
    // the literal phrases "camera-facing"/"looking at camera"/
    // "straight-on portrait" even in passing.
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "singing into a vintage microphone",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "generic-singer", name: "Rio" }),
    });
    expect(prompt).toContain("Tight cinematic close/medium framing");
    expect(prompt).toContain("lip-sync-ready");
    expect(prompt).toContain("Feature Rio, the vocalist, in the scene.");
    expect(prompt.toLowerCase()).not.toContain("camera-facing");
    expect(prompt.toLowerCase()).not.toContain("looking at camera");
    expect(prompt.toLowerCase()).not.toContain("straight-on portrait");
    expect(prompt.toLowerCase()).toMatch(/\u00be|profile/);
    expect(prompt.toLowerCase()).toContain("away from the lens");
  });

  it("does not apply the tight lip-sync framing to a Vocal clip manually set to a non-lip-sync model", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "singing into a vintage microphone",
      vocal: true,
      model: "grok",
      bandName: BAND_NAME,
      vocalist: member({ id: "generic-singer", name: "Rio" }),
    });
    expect(prompt).not.toContain("lip-sync-ready");
    expect(prompt).not.toContain("Wide dynamic cinematic music-video establishing shot");
    // The vocalist auto-include rule is about `vocal`, not the model tag.
    expect(prompt).toContain("Feature Rio, the vocalist, in the scene.");
  });

  it("audit Part 3: an H3-tagged still gets his shot text and the footer only — no factory framing line", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "a lone chair in an empty room",
      vocal: false,
      model: "h3",
      bandName: BAND_NAME,
    });
    expect(prompt.startsWith("a lone chair in an empty room")).toBe(true);
    expect(prompt).not.toContain("Simple, clean single-subject still");
    expect(prompt).not.toContain("Wide dynamic");
  });

  it("mentions a generic vocalist by name without inventing hallmarks they were never locked with", () => {
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "singing under a spotlight",
      vocal: true,
      model: "ltx-lipsync",
      bandName: "Solar Rebel",
      vocalist: member({ id: "solar-rebel-vocals", name: "Nova" }),
    });
    expect(prompt).toContain("Feature Nova, the vocalist, in the scene.");
    expect(prompt).not.toContain("Do not show:");
    expect(referenceImageDataUrls).toEqual([]); // no avatarImage set on this fixture
  });

  it("locks Jack Ash's hallmarks and negative cues into the prompt whenever he's the resolved vocalist", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "singing into a vintage microphone on a desert highway at night",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(prompt).toContain("Feature Jack Ash, the vocalist, in the scene.");
    expect(prompt.toLowerCase()).toContain("neon blue");
    expect(prompt.toLowerCase()).toContain("hidden in deep shadow at all times");
    expect(prompt).toContain("Do not show:");
    expect(prompt.toLowerCase()).toContain("face lit or visible");
  });

  it("passes Jack Ash's avatarImage as a single identity reference, untagged, when it's the only reference", () => {
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "singing on a desert highway at night",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
    });
    expect(referenceImageDataUrls).toEqual([JACK_ASH_AVATAR]);
    expect(prompt).not.toContain("<IMAGE_0>");
    expect(prompt).toContain("is the person — same face identity");
    expect(prompt).toContain("Do not turn them into a different person.");
  });

  it("never sends an identity reference for a vocalist with no picked avatarImage", () => {
    const { referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "singing on a desert highway at night",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash" }),
    });
    expect(referenceImageDataUrls).toEqual([]);
  });

  it("passes the previous clip's still as a single continuity reference, untagged, when used alone", () => {
    const previousPlate = "data:image/jpeg;base64,previousPlateBytes";
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "the same hallway, a hand reaching for the doorknob",
      vocal: false,
      model: "grok",
      bandName: BAND_NAME,
      continuityStillDataUrl: previousPlate,
    });
    expect(referenceImageDataUrls).toEqual([previousPlate]);
    expect(prompt).not.toContain("<IMAGE_0>");
    expect(prompt).toContain("Continue directly from the previous shot's plate");
  });

  it("combines continuity (first) and identity (second) into a tagged `images` order for Jack Ash", () => {
    const previousPlate = "data:image/jpeg;base64,previousPlateBytes";
    const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
      shotPrompt: "Jack steps out from behind the door, seated now, singing",
      vocal: true,
      model: "ltx-lipsync",
      bandName: BAND_NAME,
      vocalist: member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR }),
      continuityStillDataUrl: previousPlate,
    });

    // Continuity always first, identity second — the single source of
    // truth `app/api/skidmarks/generate-still/route.ts` relies on to map
    // this array onto xAI's own `images` order.
    expect(referenceImageDataUrls).toEqual([previousPlate, JACK_ASH_AVATAR]);
    expect(prompt).toContain("<IMAGE_0>");
    expect(prompt).toContain("<IMAGE_1>");
    // 2026-09-19, second pass: with an artist to hold, the continuity
    // plate stops being a vague "continue from this" note and becomes
    // the locked *place* the artist is composited into — image 1 of a
    // two-image composite, exactly as the original Skidmarks repo sends
    // it. The old "Continue directly from \u2026" line only survives for
    // a plate with nobody in it, where there is nothing to composite.
    expect(prompt).toContain("<IMAGE_0> is the LOCKED place");
    expect(prompt).toContain("Place that same person from <IMAGE_1> into <IMAGE_0>.");
    expect(prompt).not.toContain("Continue directly from");
    // 2026-09-19: the identity note is a leading lock, not a trailing
    // "likeness reference" line — see `buildPlateGenerationRequest`.
    expect(prompt).toContain("<IMAGE_1> is the person — same face identity");
    expect(prompt).toContain("Do not turn them into a different person.");
    // The character lock still applies on top of the continuity/identity notes.
    expect(prompt.toLowerCase()).toContain("neon blue");
  });

  /**
   * The regression this whole change exists for. Stuart's real report,
   * three rounds deep: his own artist's photo is attached and the render
   * comes back as somebody else \u2014 a woman with an afro against a
   * photo of a man, then a blend, then "not one render was SOUL REBEL"
   * even after the prompt was reordered.
   *
   * Reordering alone could not fix it because the *request* asked the
   * model to paint a scene, which means inventing the person in it. The
   * original Skidmarks repo never asks that: image 1 is the place, image
   * 2 is the person, "place that same person from image 2 into image 1."
   * These assert that request, not a wording preference.
   */
  describe("composites a locked artist into a locked place", () => {
    const LOCATION = "data:image/jpeg;base64,emptyRoadsideMotelBytes";
    const ARTIST = "data:image/jpeg;base64,soulRebelPhotoBytes";
    const soulRebel = member({ id: "solar-rebel-vocals", name: "Soul Rebel", avatarImage: ARTIST });
    // A shot prompt that describes a *different* person in detail \u2014
    // the exact shape that used to win against the photo.
    const DESCRIBES_SOMEONE_ELSE =
      "a woman with a huge afro and gold hoop earrings, olive tank top, leaning on the bonnet of a rusted car outside a roadside motel at dusk";

    it("sends the place first and the artist second, and says to put one into the other", () => {
      const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
        shotPrompt: DESCRIBES_SOMEONE_ELSE,
        vocal: true,
        model: "ltx-lipsync",
        bandName: "Solar Rebel",
        vocalist: soulRebel,
        locationStillDataUrl: LOCATION,
      });

      // Place is image 0, artist is image 1 \u2014 the order
      // `app/api/skidmarks/generate-still/route.ts` maps straight onto
      // xAI's own `images` array.
      expect(referenceImageDataUrls).toEqual([LOCATION, ARTIST]);
      expect(prompt).toContain("<IMAGE_0> is the LOCKED place");
      expect(prompt).toContain("<IMAGE_1> is the person");
      expect(prompt).toContain("Place that same person from <IMAGE_1> into <IMAGE_0>.");
      expect(prompt).toContain("One person only.");
    });

    it("keeps Stuart's own words, but last, as a staging tweak \u2014 never as the brief for who to draw", () => {
      const { prompt, shotPrompt } = buildPlateGenerationRequest({
        shotPrompt: DESCRIBES_SOMEONE_ELSE,
        vocal: true,
        model: "ltx-lipsync",
        bandName: "Solar Rebel",
        vocalist: soulRebel,
        locationStillDataUrl: LOCATION,
      });

      // Verbatim and never dropped \u2026
      expect(prompt).toContain(`Staging / tweak: ${DESCRIBES_SOMEONE_ELSE}`);
      // \u2026 but the identity lock has to reach the model first, or the
      // longest, most specific text in the request decides who gets
      // drawn. This is the assertion that would have caught the bug.
      expect(prompt.indexOf("<IMAGE_1> is the person")).toBeLessThan(prompt.indexOf("Staging / tweak:"));
      expect(prompt.indexOf("<IMAGE_0> is the LOCKED place")).toBeLessThan(prompt.indexOf("Staging / tweak:"));
      // Still validated on its own, never on the merge \u2014 see
      // AGENTS.md's prompt-length lock.
      expect(shotPrompt).toBe(DESCRIBES_SOMEONE_ELSE);
    });

    it("prefers a continuity plate over the place still \u2014 one background image, never both", () => {
      const previousPlate = "data:image/jpeg;base64,previousPlateBytes";
      const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
        shotPrompt: DESCRIBES_SOMEONE_ELSE,
        vocal: true,
        model: "ltx-lipsync",
        bandName: "Solar Rebel",
        vocalist: soulRebel,
        continuityStillDataUrl: previousPlate,
        locationStillDataUrl: LOCATION,
      });
      expect(referenceImageDataUrls).toEqual([previousPlate, ARTIST]);
      expect(referenceImageDataUrls).not.toContain(LOCATION);
      expect(prompt).toContain("from the previous shot");
    });

    it("still locks the artist when no place still could be attached \u2014 degraded, not broken", () => {
      const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest({
        shotPrompt: DESCRIBES_SOMEONE_ELSE,
        vocal: true,
        model: "ltx-lipsync",
        bandName: "Solar Rebel",
        vocalist: soulRebel,
      });
      expect(referenceImageDataUrls).toEqual([ARTIST]);
      expect(prompt).toContain("is the person");
      expect(prompt).not.toContain("LOCKED place");
      expect(prompt).not.toContain("Place that same person");
    });

    /**
     * The other half of the lock: a person-less B-roll plate must be
     * byte-for-byte what it was. There is nobody to drift, so inverting
     * its prompt would change every door/keyhole plate for no reason \u2014
     * and buying it a place still would be spending real money on an
     * image nothing uses.
     */
    it("leaves a plate with nobody in it completely alone", () => {
      const params = {
        shotPrompt: "a brass keyhole, lit from behind, dust in the light",
        vocal: false,
        model: "grok" as const,
        bandName: "Solar Rebel",
        vocalist: member({ id: "solar-rebel-vocals", name: "Soul Rebel", avatarImage: ARTIST }),
      };
      expect(plateGenerationHoldsIdentity(params)).toBe(false);
      const { prompt, referenceImageDataUrls } = buildPlateGenerationRequest(params);
      expect(referenceImageDataUrls).toEqual([]);
      // Stuart's own words lead, exactly as before.
      expect(prompt.startsWith(params.shotPrompt)).toBe(true);
      expect(prompt).not.toContain("LOCKED place");
      expect(prompt).not.toContain("Staging / tweak:");
    });

    it("plateGenerationHoldsIdentity agrees with what the request actually does", () => {
      const holding = {
        shotPrompt: DESCRIBES_SOMEONE_ELSE,
        vocal: true,
        model: "ltx-lipsync" as const,
        bandName: "Solar Rebel",
        vocalist: soulRebel,
      };
      expect(plateGenerationHoldsIdentity(holding)).toBe(true);
      // No photo yet \u2014 nothing to hold, so nothing to composite into.
      expect(
        plateGenerationHoldsIdentity({
          ...holding,
          vocalist: member({ id: "solar-rebel-vocals", name: "Soul Rebel" }),
        })
      ).toBe(false);
    });
  });

  it("always names the band in the final prompt", () => {
    const { prompt } = buildPlateGenerationRequest({
      shotPrompt: "a keyhole, lit from behind",
      vocal: false,
      model: "grok",
      bandName: "Solar Rebel",
    });
    expect(prompt).toContain("Music video for Solar Rebel.");
  });
});

describe("buildMemberLookRequest", () => {
  it("real reported bug: the member-casting Generate button used to never call a real image model at all — this is the request it now sends", () => {
    const request = buildMemberLookRequest({
      memberName: "Stuie",
      bandName: "Grok Bot & the Destroyers",
      prompt: "chrome headphones, stage lights, leather jacket",
      photoreal: 80,
    });
    expect(request.prompt).toContain("chrome headphones, stage lights, leather jacket");
    expect(request.prompt).toContain("Character portrait of Stuie, a member of Grok Bot & the Destroyers.");
    expect(request.shotPrompt).toBe("chrome headphones, stage lights, leather jacket");
    expect(request.referenceImageDataUrls).toEqual([]);
  });

  it("still builds a real, non-empty prompt when Stuart leaves the look prompt blank", () => {
    const request = buildMemberLookRequest({
      memberName: "Rock Grok",
      bandName: "Solar Rebel",
      prompt: "",
      photoreal: 80,
    });
    expect(request.shotPrompt).toBe("");
    expect(request.prompt.length).toBeGreaterThan(0);
    expect(request.prompt).toContain("Rock Grok");
  });

  it("falls back to a generic name for a not-yet-named member", () => {
    const request = buildMemberLookRequest({
      memberName: "",
      bandName: "Solar Rebel",
      prompt: "",
      photoreal: 80,
    });
    expect(request.prompt).toContain("the character");
  });

  it("wires an identity reference through when the member already has a photo, so re-generating stays the same person", () => {
    const request = buildMemberLookRequest({
      memberName: "Jack Ash",
      bandName: "Jack Ash",
      prompt: "front porch at dusk",
      photoreal: 80,
      identityReferenceDataUrl: "data:image/jpeg;base64,AAAA",
    });
    expect(request.referenceImageDataUrls).toEqual(["data:image/jpeg;base64,AAAA"]);
    expect(request.prompt).toContain("Use the reference image as the exact likeness");
  });

  it("steers stylization wording off the photoreal slider", () => {
    const veryReal = buildMemberLookRequest({
      memberName: "Nova",
      bandName: "Solar Rebel",
      prompt: "",
      photoreal: 100,
    });
    expect(veryReal.prompt).toContain("Fully photoreal");

    const stylized = buildMemberLookRequest({
      memberName: "Nova",
      bandName: "Solar Rebel",
      prompt: "",
      photoreal: 60,
    });
    expect(stylized.prompt).toContain("Stylized illustrated look");

    const middle = buildMemberLookRequest({
      memberName: "Nova",
      bandName: "Solar Rebel",
      prompt: "",
      photoreal: 80,
    });
    expect(middle.prompt).toContain("Photoreal cinematic look");
  });
});

describe("buildSirayCharacterPrompt", () => {
  // Live-QA fix (2026-09-13): `generatePlateStillViaSiray` used to send
  // Siray nothing but the bare camera-position sentence from
  // `lib/sirayPositions.ts` — zero identity-lock/hallmark/negative-cue
  // text — which is exactly why Auto-plate's Siray-routed Jack Ash
  // fills drifted off-identity ("not even Jack Ash, some white cunt")
  // and stared into the lens with nothing telling them not to.
  // `buildSirayCharacterPrompt` is the fix: it merges the same lock text
  // `buildPlateGenerationRequest` already injects for the xAI path.
  const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: JACK_ASH_AVATAR });

  it("merges Jack Ash's hallmarks and negative cues (including the no-stare camera rule) onto a bare position prompt", () => {
    const merged = buildSirayCharacterPrompt("Front MCU — chest-up, mouth readable.", jackAsh);
    expect(merged.startsWith("Front MCU — chest-up, mouth readable.")).toBe(true);
    expect(merged.toLowerCase()).toContain("neon blue");
    expect(merged.toLowerCase()).toContain("hidden in deep shadow at all times");
    expect(merged).toContain("Do not show:");
    expect(merged.toLowerCase()).toContain("staring straight into the camera");
    expect(merged.toLowerCase()).toContain("fully lit face");
  });

  it("merges the lock onto every position, including an off-mouth/from-behind one", () => {
    const merged = buildSirayCharacterPrompt("Straight back.", jackAsh);
    expect(merged.startsWith("Straight back.")).toBe(true);
    expect(merged.toLowerCase()).toContain("fedora");
  });

  it("is a no-op for a vocalist with no explicit character lock", () => {
    const nova = member({ id: "solar-rebel-vocals", name: "Nova", avatarImage: "data:image/jpeg;base64,novaBytes" });
    expect(buildSirayCharacterPrompt("Profile left — lips still readable.", nova)).toBe(
      "Profile left — lips still readable."
    );
  });

  it("is a no-op when no vocalist is resolved at all", () => {
    expect(buildSirayCharacterPrompt("Overhead.", undefined)).toBe("Overhead.");
  });

  it("stays comfortably under app/api/skidmarks/generate-still-siray/route.ts's own 2000-char prompt cap", () => {
    // That route's own `MAX_PROMPT_LENGTH` validates the merged prompt
    // directly (unlike the xAI route, Siray gets one plain `prompt`
    // field, no separate raw-shotPrompt split) — Jack Ash's hallmarks +
    // negative cues alone run over a thousand characters, so this is a
    // real constraint, not a hypothetical one.
    const merged = buildSirayCharacterPrompt("Front MCU — chest-up, mouth readable.", jackAsh);
    expect(merged.length).toBeLessThan(2000);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("generatePlateStill", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a real success with the dataUrl the route reported", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { dataUrl: "data:image/jpeg;base64,AAAA" }));

    const outcome = await generatePlateStill({
      prompt: "a desert highway at night",
      shotPrompt: "a desert highway at night",
      referenceImageDataUrls: [],
    });

    expect(outcome).toEqual({ ok: true, dataUrl: "data:image/jpeg;base64,AAAA" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/generate-still");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "a desert highway at night",
      shotPrompt: "a desert highway at night",
      referenceImageDataUrls: [],
    });
  });

  it("reports the honest 'unconfigured' outcome for a missing_api_key response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(501, { error: "XAI_API_KEY is not set on the server.", code: "missing_api_key" })
    );

    const outcome = await generatePlateStill({ prompt: "x", shotPrompt: "x", referenceImageDataUrls: [] });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: true,
      message: "XAI_API_KEY is not set on the server.",
    });
  });

  it("reports a real failure honestly, distinct from 'unconfigured'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: "xAI Grok Imagine returned 401: Incorrect API key provided.", code: "auth_error" })
    );

    const outcome = await generatePlateStill({ prompt: "x", shotPrompt: "x", referenceImageDataUrls: [] });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "xAI Grok Imagine returned 401: Incorrect API key provided.",
    });
  });

  it("reports a real network error honestly (no fetch success to parse)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const outcome = await generatePlateStill({ prompt: "x", shotPrompt: "x", referenceImageDataUrls: [] });

    expect(outcome).toEqual({ ok: false, unconfigured: false, message: "Failed to fetch" });
  });

  it("reports a real failure if a 200 response is somehow missing dataUrl", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    const outcome = await generatePlateStill({ prompt: "x", shotPrompt: "x", referenceImageDataUrls: [] });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "Still generation succeeded but returned no image.",
    });
  });
});

/** Per-artist lock card (2026-09-16): a member's own card is the lock. */
describe("getSkidmarksCharacterLock with a member's own lock card", () => {
  it("a new artist with a filled card is locked, on both channels", () => {
    const nova = member({
      id: "solar-rebel-vocals",
      name: "Nova",
      lock: { lookRules: "Always a chrome visor covering the eyes, silver bob, red jacket.", neverShow: "visible eyes, a second person" },
    });
    const lock = getSkidmarksCharacterLock(nova);
    expect(lock?.promptHallmarks).toBe("Always a chrome visor covering the eyes, silver bob, red jacket.");
    expect(lock?.negativeCues).toBe("visible eyes, a second person");
    expect(lock?.directorNote).toBe("Always a chrome visor covering the eyes, silver bob, red jacket");
  });

  it("a new artist with no card, or a blank card, has no lock", () => {
    expect(getSkidmarksCharacterLock(member({ id: "solar-rebel-vocals", name: "Nova" }))).toBeUndefined();
    expect(getSkidmarksCharacterLock(member({ id: "solar-rebel-vocals", name: "Nova", lock: { lookRules: "   ", neverShow: "eyes" } }))).toBeUndefined();
  });

  it("Jack Ash keeps the built-in lock while his card is blank, and his card overrides it once filled", () => {
    const jack = member({ id: "jack-ash-frontman", name: "Jack Ash" });
    expect(getSkidmarksCharacterLock(jack)?.promptHallmarks).toContain("fedora");
    const edited = member({ id: "jack-ash-frontman", name: "Jack Ash", lock: { lookRules: "Red fedora now.", neverShow: "" } });
    expect(getSkidmarksCharacterLock(edited)?.promptHallmarks).toBe("Red fedora now.");
    expect(getSkidmarksCharacterLock(edited)?.negativeCues).toBeUndefined();
    expect(getSkidmarksCharacterLock("jack-ash-frontman")?.promptHallmarks).toContain("fedora"); // id lookup unchanged
  });

  it("a card-locked artist gets the lock text on a Vocal still, same as Jack", () => {
    const nova = member({ id: "solar-rebel-vocals", name: "Nova", avatarImage: "https://blob.example/nova.jpg", lock: { lookRules: "Chrome visor always on.", neverShow: "visible eyes" } });
    const { prompt, referenceImageDataUrls, featuresLockedCharacter } = buildPlateGenerationRequest({
      shotPrompt: "Nova at the mic",
      vocal: true,
      model: "ltx-lipsync",
      bandName: "Solar Rebel",
      vocalist: nova,
    });
    expect(prompt).toContain("Chrome visor always on.");
    expect(prompt).toContain("Do not show: visible eyes.");
    expect(referenceImageDataUrls).toEqual(["https://blob.example/nova.jpg"]);
    expect(featuresLockedCharacter).toBe(true);
  });
});
