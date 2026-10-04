import { describe, expect, it } from "vitest";
import {
  SUNNY_BANKS_CAST,
  SUNNY_BANKS_HELD_OBJECT_LOCK,
  SUNNY_BANKS_LOOK,
  buildLtxSpeakingCore,
  buildSunnyBanksSpeakingPrompt,
  type StudioLook,
  type SunnyBanksCharacterLock,
} from "./sunnyBanks";
import { STUDIO_GENRES, studioGenreProfile } from "./studioGenre";

/**
 * `buildSunnyBanksSpeakingPrompt` exactly as it was on master before the
 * speaking text moved into `buildLtxSpeakingCore` (2026-10-04), so Shorts
 * could share it. Sunny Banks and Skidmarks must send the same bytes.
 */
function speakingPromptBefore(character: SunnyBanksCharacterLock, line: string, look: StudioLook = SUNNY_BANKS_LOOK): string {
  const accessory =
    character.name !== "Dazza"
      ? ""
      : ` ${SUNNY_BANKS_HELD_OBJECT_LOCK} Whatever Dazza is holding stays exactly as shown in the start image, ` +
        `without morphing or disappearing over the clip.`;
  return (
    `Use the provided start image as the first frame. ${character.name}, ${character.look} is prominent, mouth ` +
    `and head move naturally while speaking, subtle gesture. Props and background stay exactly as the start ` +
    `image, nothing new enters frame. ${character.name} says: "${line.trim()}". Camera holds. Same person and ` +
    `objects as the start image. ${look.styleLock}` +
    accessory
  );
}

const LINES = ["G'day.", "  Righto, who parked the ute on the footpath?  ", 'He said "no" twice.', ""];
const EXTRA: SunnyBanksCharacterLock[] = [
  { name: "Guest Gary", look: "tall man in a hi-vis vest" },
  { name: "No Look", look: "" },
];

describe("Sunny Banks / Skidmarks speaking prompt (unchanged by the shared core)", () => {
  const characters = [...Object.values(SUNNY_BANKS_CAST), ...EXTRA];

  it("is byte-identical to before for every regular, every show's look and every line", () => {
    expect(Object.keys(SUNNY_BANKS_CAST)).toContain("Dazza");
    let checked = 0;
    for (const genre of STUDIO_GENRES) {
      const look = studioGenreProfile(genre).look;
      for (const character of characters) {
        for (const line of LINES) {
          expect(buildSunnyBanksSpeakingPrompt(character, line, look)).toBe(speakingPromptBefore(character, line, look));
          checked++;
        }
      }
    }
    for (const character of characters) {
      expect(buildSunnyBanksSpeakingPrompt(character, "Default look.")).toBe(speakingPromptBefore(character, "Default look."));
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("the shared core is the speaking prompt minus the show's style lock", () => {
    const dazza = SUNNY_BANKS_CAST.Dazza;
    const full = buildSunnyBanksSpeakingPrompt(dazza, "Hi.");
    const core = buildLtxSpeakingCore(dazza.name, `${dazza.name}, ${dazza.look}`, "Hi.");
    expect(full.startsWith(`${core} ${SUNNY_BANKS_LOOK.styleLock}`)).toBe(true);
    expect(core.endsWith("Same person and objects as the start image.")).toBe(true);
  });
});
