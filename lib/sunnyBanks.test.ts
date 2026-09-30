import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSunnyBanksHoldBeatPathname,
  buildSunnyBanksHoldPrompt,
  buildSunnyBanksSpeakBeatPathname,
  buildSunnyBanksSpeakingPrompt,
  buildSunnyBanksCompositePlatePrompt,
  buildUnit4sLine,
  getSunnyBanksCharacterLock,
  getSunnyBanksLocation,
  resolveSunnyBanksStartImage,
  SUNNY_BANKS_CAST,
  SUNNY_BANKS_DEFAULT_LOCATION_ID,
  SUNNY_BANKS_LOCATIONS,
  SUNNY_BANKS_HELD_OBJECT_LOCK,
  SUNNY_BANKS_STYLE_LOCK,
} from "./sunnyBanks";

describe("SUNNY_BANKS_CAST", () => {
  it("real reported ask (2026-09-15): all six series regulars plus the aliens have a real voice id, except Hans", () => {
    expect(SUNNY_BANKS_CAST.Shazza.voiceId).toBe("Vuun8WKmo2MZSUXgLPGw");
    expect(SUNNY_BANKS_CAST.Nuggets.voiceId).toBe("URQwIuGxmxWfCgwXuDxA");
    expect(SUNNY_BANKS_CAST.Nan.voiceId).toBe("u57uR2xbwGdASNetz0GB");
    expect(SUNNY_BANKS_CAST.Dazza.voiceId).toBe("Kn29eGLhsovCLwKvKi2q");
    expect(SUNNY_BANKS_CAST["Ranger Bazza"].voiceId).toBe("lT1zujgSfYwPzAlTNE9z");
    expect(SUNNY_BANKS_CAST["Unit 4S"].voiceId).toBe("9AMMyX2GM74yY0KQwYkF");
    expect(SUNNY_BANKS_CAST.Hans.voiceId).toBeUndefined();
  });

  it("getSunnyBanksCharacterLock is a real lookup, not a guess for an unknown name", () => {
    expect(getSunnyBanksCharacterLock("Shazza")).toBe(SUNNY_BANKS_CAST.Shazza);
    expect(getSunnyBanksCharacterLock("Some Guest")).toBeUndefined();
  });

  it("Cast card pictures only (2026-10-01): the built-in table carries no pictures, and the old repo stills are gone", () => {
    for (const character of Object.values(SUNNY_BANKS_CAST)) {
      for (const key of Object.keys(character)) expect(["name", "look", "voiceId", "guest"]).toContain(key);
      expect(character.castPicture).toBeUndefined();
      expect(resolveSunnyBanksStartImage(character)).toBeUndefined();
    }
    for (const slug of ["shazza", "dazza", "nan", "nuggets", "ranger-bazza", "unit-4s", "hans"]) {
      expect(existsSync(resolve(process.cwd(), `public/skidmarks/sunnybanks/${slug}-hero.jpg`))).toBe(false);
      expect(existsSync(resolve(process.cwd(), `public/skidmarks/sunnybanks/${slug}-reference.jpg`))).toBe(false);
    }
  });

  it("real reported ask (2026-09-15): only Hans is a guest — the six series regulars aren't", () => {
    expect(SUNNY_BANKS_CAST.Hans.guest).toBe(true);
    expect(SUNNY_BANKS_CAST.Shazza.guest).toBeFalsy();
    expect(SUNNY_BANKS_CAST.Dazza.guest).toBeFalsy();
    expect(SUNNY_BANKS_CAST.Nan.guest).toBeFalsy();
    expect(SUNNY_BANKS_CAST.Nuggets.guest).toBeFalsy();
    expect(SUNNY_BANKS_CAST["Ranger Bazza"].guest).toBeFalsy();
    expect(SUNNY_BANKS_CAST["Unit 4S"].guest).toBeFalsy();
  });
});

describe("buildSunnyBanksSpeakingPrompt", () => {
  it("matches the worked gold example (Shazza) field-for-field", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(
      SUNNY_BANKS_CAST.Shazza,
      "We haven't got any shade, Dazza. So it's forty-seven degrees of structural integrity. Stop complaining and finish your breakfast"
    );
    expect(prompt).toBe(
      "Use the provided start image as the first frame. Shazza, middle-aged woman, huge curly blonde hair, gold " +
        "hoop earrings, cigarette in her mouth, arms folded, leopard-print singlet top, frayed denim shorts is " +
        "prominent, mouth and head move naturally while speaking, subtle gesture. Props and " +
        "background stay exactly as the start image, nothing new enters frame. Shazza says: \"We haven't got " +
        "any shade, Dazza. So it's forty-seven degrees of structural integrity. Stop complaining and finish " +
        "your breakfast\". Camera holds. Same person and objects as the start image. " +
        SUNNY_BANKS_STYLE_LOCK
    );
  });

  it("never emits [SPEECH] or [VISUAL] — the gold doc's own explicit \"do not\"", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Nuggets, "G'day");
    expect(prompt).not.toContain("[SPEECH]");
    expect(prompt).not.toContain("[VISUAL]");
  });

  it("trims the line before quoting it", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Nan, "  put the kettle on  ");
    expect(prompt).toContain('Nan says: "put the kettle on".');
  });

  it("appends a held-object lock for Dazza after the gold template, without rewriting his look string", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Dazza, "Yeah nah.");
    expect(prompt).toContain(SUNNY_BANKS_CAST.Dazza.look);
    expect(prompt).toContain('Dazza says: "Yeah nah.".');
    expect(prompt).toContain(SUNNY_BANKS_HELD_OBJECT_LOCK);
    expect(prompt).toContain("without morphing or disappearing");
    expect(prompt.startsWith("Use the provided start image as the first frame. Dazza,")).toBe(true);
    // EP01 (2026-09-30): naming "coins" drew Dazza as a coin. No prop is named any more.
    expect(prompt).not.toMatch(/coin|hair dryer|beer|stubbies/i);
    expect(buildSunnyBanksHoldPrompt(SUNNY_BANKS_CAST.Dazza)).not.toMatch(/coin|hair dryer|beer|stubbies/i);
  });

  it("every look is one clear description: no alternate outfits and no bare props (2026-09-30)", () => {
    for (const character of Object.values(SUNNY_BANKS_CAST)) {
      expect(character.look, character.name).not.toMatch(/as on that plate|\beither\b|\bor\b|depending|\bearly:|\blater:/i);
      expect(character.look, character.name).not.toMatch(/coins?|hair dryer|mountain bike|high-vis|akubra|thongs/i);
      // A prop that stays is held or worn, never a bare noun at the end of a clause.
      for (const clause of character.look.split(/,\s*/)) {
        if (/\b(cigarette|pie|teacup|cricket bat|flip-flop|whistle|camera)\b/i.test(clause)) {
          expect(clause, `${character.name}: "${clause}"`).toMatch(/\b(in her|in his|in each|in both|held|on her|on a|around his)\b/i);
        }
      }
    }
  });

  it("does not append the Dazza held-object lock onto Shazza's gold string", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Shazza, "You right?");
    expect(prompt).not.toContain(SUNNY_BANKS_HELD_OBJECT_LOCK);
  });
});

describe("resolveSunnyBanksStartImage", () => {
  it("is the Cast card picture and nothing else", () => {
    const pic = "https://abc.public.blob.vercel-storage.com/deck/sunnybank/characters/dazza/dazza-reference.jpg";
    expect(resolveSunnyBanksStartImage({ ...SUNNY_BANKS_CAST.Dazza, castPicture: pic })).toBe(pic);
    expect(resolveSunnyBanksStartImage({ ...SUNNY_BANKS_CAST.Dazza, castPicture: "  " })).toBeUndefined();
    expect(resolveSunnyBanksStartImage(SUNNY_BANKS_CAST.Dazza)).toBeUndefined();
  });
});

describe("SUNNY_BANKS_LOCATIONS", () => {
  it("defaults to office storefront and looks up by id, never guessing", () => {
    expect(SUNNY_BANKS_DEFAULT_LOCATION_ID).toBe("office_storefront");
    expect(getSunnyBanksLocation("office_storefront")?.image).toBe(
      "/skidmarks/sunnybanks/office-storefront.jpg"
    );
    expect(getSunnyBanksLocation("not-a-place")).toBeUndefined();
  });

  it("nine locked park plates (Stuart's three added 2026-09-30), each a real 1280x720 file under public/", () => {
    const ids = [
      "water_tank_dam",
      "main_entrance_sign",
      "site_laundry",
      "office_storefront",
      "tin_shed_mower",
      "caravan_interior",
      "park_site_4",
      "office_booth",
      "rock_art_outcrop",
    ] as const;
    expect(Object.keys(SUNNY_BANKS_LOCATIONS)).toEqual(ids);
    for (const id of ids) {
      expect(existsSync(resolve(process.cwd(), `public${SUNNY_BANKS_LOCATIONS[id].image}`))).toBe(true);
    }
    expect(SUNNY_BANKS_LOCATIONS.park_site_4).toEqual({ id: "park_site_4", label: "Park Site 4", image: "/skidmarks/sunnybanks/park-site-4.jpg" });
    expect(SUNNY_BANKS_LOCATIONS.office_booth.label).toBe("Site Office Booth");
    expect(SUNNY_BANKS_LOCATIONS.rock_art_outcrop.image).toBe("/skidmarks/sunnybanks/rock-art-outcrop.jpg");
    // Only a real built-in, never something off the object's prototype.
    expect(getSunnyBanksLocation("toString")).toBeUndefined();
  });
});

describe("buildSunnyBanksCompositePlatePrompt", () => {
  it("follows Studio plateCast order: location is Image 1, the Cast card picture is Image 2", () => {
    const prompt = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Shazza,
      SUNNY_BANKS_LOCATIONS.office_storefront
    );
    expect(prompt).toContain("<IMAGE_0> is the LOCKED background");
    expect(prompt).toContain("<IMAGE_1> is the person");
    expect(prompt).toContain("Place that same person from image 2 into image 1.");
    expect(prompt).toContain("Office Storefront");
    expect(prompt).toContain("Shazza");
    expect(prompt).toContain("cigarette");
    expect(prompt).toContain(SUNNY_BANKS_STYLE_LOCK);
    expect(prompt).not.toContain("Use the provided start image as the first frame.");
    expect(prompt).not.toBe(buildSunnyBanksHoldPrompt(SUNNY_BANKS_CAST.Shazza));
  });

  it("never names a picture file or a turnaround sheet", () => {
    const prompt = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Shazza,
      SUNNY_BANKS_LOCATIONS.office_storefront
    );
    expect(prompt).not.toContain("shazza-reference");
    expect(prompt).not.toContain("character plate");
    expect(prompt).not.toContain("turnaround");
  });

  it("with no appearance override, is byte-identical to the pre-2026-09-18 prompt (regression guard)", () => {
    const withoutParam = buildSunnyBanksCompositePlatePrompt(SUNNY_BANKS_CAST.Dazza, SUNNY_BANKS_LOCATIONS.tin_shed_mower);
    const withEmptyOverride = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Dazza,
      SUNNY_BANKS_LOCATIONS.tin_shed_mower,
      "   "
    );
    expect(withoutParam).toContain("Do not change their clothes.");
    expect(withoutParam).toBe(withEmptyOverride);
  });

  it("real reported bug (2026-09-18): an appearance override reaches the picture itself, not just the later motion prompt", () => {
    const prompt = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Dazza,
      SUNNY_BANKS_LOCATIONS.tin_shed_mower,
      "holding two bottles of amber liquid, one in each hand"
    );
    expect(prompt).toContain("Shot-specific override for this render only: holding two bottles of amber liquid, one in each hand.");
    // The override changes what's held, so the blanket "don't change
    // their clothes" line (which would contradict it) must not appear —
    // a narrower, override-aware line takes its place instead.
    expect(prompt).not.toContain("Do not change their clothes.");
    expect(prompt).toContain("Change only what the shot-specific override below explicitly names.");
    expect(prompt).not.toContain("Only the held object named in the look lock.");
    expect(prompt).toContain("Held objects: only what this shot's text below names.");
    // Still keeps every other lock: same person, no second person, same place.
    expect(prompt).toContain("<IMAGE_0> is the LOCKED background");
    expect(prompt).toContain("do not invent a second person");
    expect(prompt).toContain(SUNNY_BANKS_STYLE_LOCK);
    expect(prompt).toContain("Dazza");
  });

  it("EP02 Act I row 16 (2026-10-01): never keeps a prop just because it's in the picture", () => {
    for (const character of Object.values(SUNNY_BANKS_CAST)) {
      const prompt = buildSunnyBanksCompositePlatePrompt(character, SUNNY_BANKS_LOCATIONS.office_booth);
      expect(prompt).not.toContain("Keep any held prop already visible");
      expect(prompt).toContain("Do not copy");
    }
    // Dazza's look names nothing held, so his hands are empty unless the shot says otherwise.
    expect(buildSunnyBanksCompositePlatePrompt(SUNNY_BANKS_CAST.Dazza, SUNNY_BANKS_LOCATIONS.office_booth)).toContain(
      "Empty hands. Do not copy any object from image 2."
    );
    // A look that names what's held still says only that.
    expect(buildSunnyBanksCompositePlatePrompt(SUNNY_BANKS_CAST.Nuggets, SUNNY_BANKS_LOCATIONS.office_booth)).toContain(
      "Only the held object named in the look lock. Do not copy any other object from image 2."
    );
  });

  it("EP02 Act I row 16 (2026-10-01): a silent hold's [Action:] text reaches the start still and decides what's held", () => {
    const action =
      "Dazza ambles across the red dirt towards the site office booth, beer can in hand, thongs flapping. Full figure, side on";
    const prompt = buildSunnyBanksCompositePlatePrompt(SUNNY_BANKS_CAST.Dazza, SUNNY_BANKS_LOCATIONS.office_booth, undefined, action);
    expect(prompt).toContain(`This shot: ${action}.`);
    expect(prompt).toContain("Held objects: only what this shot's text below names.");
    expect(prompt).toContain("Pose and anything held follow this shot's text below.");
    expect(prompt).not.toContain("Keep the EXACT body pose");
    expect(prompt).not.toContain("Empty hands.");
    expect(prompt).toContain("Site Office Booth");
    // Blank action text changes nothing.
    expect(buildSunnyBanksCompositePlatePrompt(SUNNY_BANKS_CAST.Dazza, SUNNY_BANKS_LOCATIONS.office_booth, undefined, "  ")).toBe(
      buildSunnyBanksCompositePlatePrompt(SUNNY_BANKS_CAST.Dazza, SUNNY_BANKS_LOCATIONS.office_booth)
    );
  });
});

describe("buildSunnyBanksHoldPrompt", () => {
  it("carries no dialogue and locks the camera, matching the gold hold shape", () => {
    const prompt = buildSunnyBanksHoldPrompt(SUNNY_BANKS_CAST["Ranger Bazza"]);
    expect(prompt).toContain("No dialogue. Camera holds, no cuts.");
    expect(prompt).toContain(SUNNY_BANKS_STYLE_LOCK);
    expect(prompt).not.toContain(" says:");
  });

  it("already describes one person on the start image — the multi-Shazza Hold was the sheet, not this string", () => {
    const prompt = buildSunnyBanksHoldPrompt(SUNNY_BANKS_CAST.Shazza);
    expect(prompt).toContain("Use the provided start image as the first frame.");
    expect(prompt).toContain("Same person and objects as the start image.");
    expect(prompt).toContain("No dialogue. Camera holds, no cuts.");
    expect(prompt).not.toContain("character plate");
    expect(prompt).not.toContain(SUNNY_BANKS_HELD_OBJECT_LOCK);
  });

  it("locks Dazza's held objects on a Hold too — the 5s idle is where a beer/dryer morphs", () => {
    const prompt = buildSunnyBanksHoldPrompt(SUNNY_BANKS_CAST.Dazza);
    expect(prompt).toContain(SUNNY_BANKS_HELD_OBJECT_LOCK);
    expect(prompt).toContain("No dialogue. Camera holds, no cuts.");
  });
});

describe("buildSunnyBanksHoldBeatPathname", () => {
  it("nests under hold-beats, never speak-beats, and slugifies a spaced name", () => {
    const hold = buildSunnyBanksHoldBeatPathname("Ranger Bazza", 123);
    const speak = buildSunnyBanksSpeakBeatPathname("Ranger Bazza", 123);
    expect(hold).toBe("sunnybanks/hold-beats/123-ranger-bazza.mp4");
    expect(speak).toBe("sunnybanks/speak-beats/123-ranger-bazza.mp4");
    expect(hold).not.toBe(speak);
  });
});

describe("buildUnit4sLine", () => {
  it("real reported shape (2026-09-15): yup-yups and a drawn-out nah, not an English line", () => {
    const line = buildUnit4sLine(8);
    expect(line).toMatch(/^(Yup yup(, )?)+\. Na+h\.$/);
  });

  it("scales up with a longer beat — more reps and a longer nah", () => {
    const short = buildUnit4sLine(4);
    const long = buildUnit4sLine(24);
    const shortYupCount = short.split("Yup yup").length - 1;
    const longYupCount = long.split("Yup yup").length - 1;
    expect(longYupCount).toBeGreaterThan(shortYupCount);
    const shortNahLength = short.match(/Na+h/)?.[0].length ?? 0;
    const longNahLength = long.match(/Na+h/)?.[0].length ?? 0;
    expect(longNahLength).toBeGreaterThan(shortNahLength);
  });

  it("clamps a nonsense/out-of-range duration instead of producing an empty or absurd line", () => {
    expect(buildUnit4sLine(0)).toMatch(/^Yup yup\. Naa+h\.$/);
    expect(buildUnit4sLine(-5)).toMatch(/^Yup yup\. Naa+h\.$/);
    expect(buildUnit4sLine(9999)).toMatch(/^(Yup yup(, )?)+\. Na{8}h\.$/);
  });
});
