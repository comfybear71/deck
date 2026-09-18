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
  SUNNY_BANKS_HOLD_DURATION_SEC,
  SUNNY_BANKS_SETTLE_LEAD_IN_LINE,
  SUNNY_BANKS_SETTLE_LEAD_SEC,
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

  it("real reported ask (2026-09-15): six cast members have Stuart's real reference plates", () => {
    expect(SUNNY_BANKS_CAST.Shazza.referenceImage).toBe("/skidmarks/sunnybanks/shazza-reference.jpg");
    expect(SUNNY_BANKS_CAST.Dazza.referenceImage).toBe("/skidmarks/sunnybanks/dazza-reference.jpg");
    expect(SUNNY_BANKS_CAST.Nan.referenceImage).toBe("/skidmarks/sunnybanks/nan-reference.jpg");
    expect(SUNNY_BANKS_CAST.Nuggets.referenceImage).toBe("/skidmarks/sunnybanks/nuggets-reference.jpg");
    expect(SUNNY_BANKS_CAST["Ranger Bazza"].referenceImage).toBe("/skidmarks/sunnybanks/ranger-bazza-reference.jpg");
    expect(SUNNY_BANKS_CAST["Unit 4S"].referenceImage).toBe("/skidmarks/sunnybanks/unit-4s-reference.jpg");
    // Not sent yet — an undefined reference must stay undefined, never a
    // guessed/invented path a caller could 404 on.
    expect(SUNNY_BANKS_CAST.Hans.referenceImage).toBeUndefined();
  });

  it("live-QA (2026-09-17): sheet characters have a single-subject hero still; Unit 4S is already one figure", () => {
    expect(SUNNY_BANKS_CAST.Shazza.heroImage).toBe("/skidmarks/sunnybanks/shazza-hero.jpg");
    expect(SUNNY_BANKS_CAST.Dazza.heroImage).toBe("/skidmarks/sunnybanks/dazza-hero.jpg");
    expect(SUNNY_BANKS_CAST.Nan.heroImage).toBe("/skidmarks/sunnybanks/nan-hero.jpg");
    expect(SUNNY_BANKS_CAST.Nuggets.heroImage).toBe("/skidmarks/sunnybanks/nuggets-hero.jpg");
    expect(SUNNY_BANKS_CAST["Ranger Bazza"].heroImage).toBe("/skidmarks/sunnybanks/ranger-bazza-hero.jpg");
    expect(SUNNY_BANKS_CAST["Unit 4S"].heroImage).toBeUndefined();
    expect(SUNNY_BANKS_CAST.Hans.heroImage).toBeUndefined();
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
      "Use the provided start image as the first frame. Shazza, big blonde hair, leopard-print top, cigarette, " +
        "arms folded is prominent, mouth and head move naturally while speaking, subtle gesture. Props and " +
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
  });

  it("does not append the Dazza held-object lock onto Shazza's gold string", () => {
    const prompt = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Shazza, "You right?");
    expect(prompt).not.toContain(SUNNY_BANKS_HELD_OBJECT_LOCK);
  });
});

describe("resolveSunnyBanksStartImage", () => {
  it("prefers the hero still so LTX never receives the turnaround sheet as the first frame", () => {
    expect(resolveSunnyBanksStartImage(SUNNY_BANKS_CAST.Shazza)).toBe(
      "/skidmarks/sunnybanks/shazza-hero.jpg"
    );
    expect(resolveSunnyBanksStartImage(SUNNY_BANKS_CAST.Shazza)).not.toBe(
      SUNNY_BANKS_CAST.Shazza.referenceImage
    );
  });

  it("falls back to the reference plate when there is no hero file (Unit 4S is already a single figure)", () => {
    expect(resolveSunnyBanksStartImage(SUNNY_BANKS_CAST["Unit 4S"])).toBe(
      "/skidmarks/sunnybanks/unit-4s-reference.jpg"
    );
  });
});

describe("Sunny Banks hero still files", () => {
  it("every heroImage path is a real file under public/", () => {
    for (const character of Object.values(SUNNY_BANKS_CAST)) {
      if (!character.heroImage) continue;
      expect(existsSync(resolve(process.cwd(), `public${character.heroImage}`))).toBe(true);
    }
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

  it("six locked park plates, each a real file under public/", () => {
    const ids = [
      "water_tank_dam",
      "main_entrance_sign",
      "site_laundry",
      "office_storefront",
      "tin_shed_mower",
      "caravan_interior",
    ] as const;
    expect(Object.keys(SUNNY_BANKS_LOCATIONS)).toEqual(ids);
    for (const id of ids) {
      expect(existsSync(resolve(process.cwd(), `public${SUNNY_BANKS_LOCATIONS[id].image}`))).toBe(true);
    }
  });
});

describe("buildSunnyBanksCompositePlatePrompt", () => {
  it("follows Studio plateCast order: location is Image 1, hero is Image 2", () => {
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

  it("never names the turnaround sheet — compositor uses the hero card, not the bible", () => {
    const prompt = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Shazza,
      SUNNY_BANKS_LOCATIONS.office_storefront
    );
    expect(prompt).not.toContain("shazza-reference");
    expect(prompt).not.toContain("character plate");
    expect(prompt).not.toContain("turnaround");
  });

  it("real reported bug (2026-09-18): a per-shot appearance override lands in the plate prompt verbatim", () => {
    const prompt = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Dazza,
      SUNNY_BANKS_LOCATIONS.tin_shed_mower,
      "holding two bottles"
    );
    expect(prompt).toContain(
      `Staging / tweak: Dazza, ${SUNNY_BANKS_CAST.Dazza.look}, at Tin Shed & Mower. ` +
        "Override for this shot only: holding two bottles."
    );
    // Additive: the original staging line is still there untouched, and
    // `look` itself is never rewritten.
    expect(prompt).toContain(`Staging / tweak: Dazza, ${SUNNY_BANKS_CAST.Dazza.look}, at Tin Shed & Mower.`);
    expect(prompt).toContain(SUNNY_BANKS_CAST.Dazza.look);
  });

  it("the prop line allows the override's object instead of contradicting it", () => {
    const withOverride = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Dazza,
      SUNNY_BANKS_LOCATIONS.tin_shed_mower,
      "holding two bottles"
    );
    // This is the whole bug: "Do not invent extra objects" next to
    // "Override ...: holding two bottles" is a self-contradiction, and
    // the plate came back without the bottles.
    expect(withOverride).not.toContain("Do not invent extra objects.");
    expect(withOverride).not.toContain("Do not invent a phone or extra objects.");
    expect(withOverride).toContain("exactly what the shot override names");
    expect(withOverride).toMatch(/Do not invent any other extra objects\.|Do not invent a phone or any other extra objects\./);

    // Still a real lock — the override widens it by exactly one thing,
    // it does not open the plate up to anything the model fancies.
    const shazza = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Shazza,
      SUNNY_BANKS_LOCATIONS.office_storefront,
      "wearing a fluoro vest"
    );
    expect(shazza).toContain("Only the held object named in the look lock plus exactly what the shot override names.");
  });

  it("regression guard: with no override the prompt is byte-identical to the pre-2026-09-18 string", () => {
    for (const character of Object.values(SUNNY_BANKS_CAST)) {
      for (const location of Object.values(SUNNY_BANKS_LOCATIONS)) {
        const bare = buildSunnyBanksCompositePlatePrompt(character, location);
        expect(buildSunnyBanksCompositePlatePrompt(character, location, undefined)).toBe(bare);
        // Whitespace-only / empty overrides are treated as "no override"
        // so a stray script tag cannot quietly change a locked plate.
        expect(buildSunnyBanksCompositePlatePrompt(character, location, "")).toBe(bare);
        expect(buildSunnyBanksCompositePlatePrompt(character, location, "   ")).toBe(bare);
        expect(bare).not.toContain("Override for this shot only");
        expect(bare).toContain(`Staging / tweak: ${character.name}, ${character.look}, at ${location.label}.`);
        expect(bare).toMatch(
          /Only the held object named in the look lock\. Do not invent extra objects\.|Keep any held prop already visible in <IMAGE_1>\. Do not invent a phone or extra objects\./
        );
      }
    }
  });

  it("collapses whitespace in an override the same way the route parses it", () => {
    const prompt = buildSunnyBanksCompositePlatePrompt(
      SUNNY_BANKS_CAST.Nan,
      SUNNY_BANKS_LOCATIONS.site_laundry,
      "  wrapped\n in   bandages  "
    );
    expect(prompt).toContain("Override for this shot only: wrapped in bandages.");
  });
});

describe("SUNNY_BANKS_SETTLE_LEAD_SEC", () => {
  it("is the 'second or two' settle Stuart asked for, and sits inside LTX's 2–15s window", () => {
    expect(SUNNY_BANKS_SETTLE_LEAD_SEC).toBe(1.5);
    expect(SUNNY_BANKS_SETTLE_LEAD_SEC).toBeLessThan(SUNNY_BANKS_HOLD_DURATION_SEC);
  });

  it("the appended lead-in line quotes that same constant and never rewrites gold", () => {
    expect(SUNNY_BANKS_SETTLE_LEAD_IN_LINE).toContain(`~${SUNNY_BANKS_SETTLE_LEAD_SEC} seconds`);
    expect(SUNNY_BANKS_SETTLE_LEAD_IN_LINE).toContain("holds the newly-staged pose without speaking");
    // It is an appended sentence, not an edit of the gold Speak string.
    const gold = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Dazza, "Grab us a coldie.");
    expect(gold).not.toContain(SUNNY_BANKS_SETTLE_LEAD_IN_LINE);
    expect(`${gold} ${SUNNY_BANKS_SETTLE_LEAD_IN_LINE}`.startsWith(gold)).toBe(true);
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
