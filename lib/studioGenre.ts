/**
 * Which show the episode studio is working on (2026-10-04, Stuart:
 * "give Skidmarks exactly the Sunny Banks structure"). The episode row,
 * the script box, the render rows and the render route are one set of
 * code; this file holds everything that differs between the two shows,
 * so neither show is a special case of the other.
 *
 * - `sunnybank`: the built-in cast, the flat 2D cartoon lock, clips in
 *   `deck/sunnybank/episodes/<episode>/…`.
 * - `skidmarks`: each episode's own Cast (`skidmarksEpisodes.cast`,
 *   cards `sk:<id>`, filtered by `lib/skidmarksEpisodeCast.ts`), no built-ins, the semi-photoreal lock below, clips
 *   in `deck/skidmarks/episodes/<episode>/…`.
 *
 * Anything that doesn't say which show it is means Sunny Banks, so every
 * Sunny Banks request, prompt and saved episode is exactly what it was.
 */
import { SUNNY_BANKS_LOOK, type StudioLook } from "./sunnyBanks";

export type StudioGenre = "sunnybank" | "skidmarks";

export const STUDIO_GENRES: readonly StudioGenre[] = ["sunnybank", "skidmarks"];

/** `"skidmarks"` is Skidmarks; anything else (missing, junk) is Sunny Banks. */
export function parseStudioGenre(value: unknown): StudioGenre {
  return value === "skidmarks" ? "skidmarks" : "sunnybank";
}

/**
 * The Skidmarks look for every motion and plating prompt (2026-10-04).
 * From the show's `STYLE_LOCK.md` (locked 2026-08-02: "a stylised 3D
 * animated feature render… a film set of a street… caricature modelled
 * into the anatomy, never drawn"), with the realism dial moved to
 * Stuart's 60–80% photoreal. Its banned words stay banned: the only one
 * left is inside "not a cartoon", the same negation the lock itself used.
 * `lib/studioGenre.test.ts` checks both.
 */
export const SKIDMARKS_STYLE_LOCK =
  "semi-photoreal stylised 3D feature film render, about 60 to 80 percent photographic: believable skin, fabric, " +
  "brick, metal and grass, soft directional daylight with a little bounce, warm lifted colour, sharp focus, the " +
  "world reads as a real place built as a film set, caricature modelled into the anatomy (bigger eyes, longer " +
  "nose, wider mouth) and never drawn. Same character design and proportions as their picture. Not a photograph " +
  "and not a cartoon";

/** Banned in a Skidmarks prompt (`STYLE_LOCK.md`, "Words that must never appear"). */
export const SKIDMARKS_BANNED_WORDS: readonly string[] = [
  "cartoon",
  "comix",
  "comic",
  "ink outlines",
  "black outlines",
  "crosshatching",
  "flat colour",
  "hand-drawn",
  "illustration",
  "cel",
  "speed lines",
  "2D",
  "underground comix",
  "R. Crumb",
];

export const SKIDMARKS_LOOK: StudioLook = {
  styleLock: SKIDMARKS_STYLE_LOCK,
  // No heat haze and no flies: those are Sunny Banks' outback.
  ambienceSentence: "",
  idleAmbience: "",
  keepPlaceLine: "Do not swap the location for a different place.",
};

/**
 * The Skidmarks look for Cast card pictures (Siray/Seedream, which has no
 * negative prompt, so positive words only and no banned word at all).
 */
export const SKIDMARKS_PICTURE_STYLE =
  "semi-photoreal stylised 3D feature film render, about 70 percent photographic, believable skin, hair and " +
  "fabric, soft directional daylight, warm lifted colour, sharp focus, caricature modelled into the anatomy";

export interface StudioGenreProfile {
  genre: StudioGenre;
  /** The show's name in messages ("Sunny Banks", "Skidmarks"). */
  showName: string;
  look: StudioLook;
  /** The old flat Blob prefix for a clip with no episode folder yet. */
  legacyBlobPrefix: string;
  /** Has the built-in Sunny Banks cast and locations. */
  builtIns: boolean;
}

export const STUDIO_GENRE_PROFILES: Record<StudioGenre, StudioGenreProfile> = {
  sunnybank: {
    genre: "sunnybank",
    showName: "Sunny Banks",
    look: SUNNY_BANKS_LOOK,
    legacyBlobPrefix: "sunnybanks",
    builtIns: true,
  },
  skidmarks: {
    genre: "skidmarks",
    showName: "Skidmarks",
    look: SKIDMARKS_LOOK,
    legacyBlobPrefix: "skidmarks/studio",
    builtIns: false,
  },
};

export function studioGenreProfile(genre: StudioGenre | undefined): StudioGenreProfile {
  return STUDIO_GENRE_PROFILES[genre ?? "sunnybank"];
}

/** Which roster group a show's Cast cards are in. */
export function studioCastGroup(genre: StudioGenre): "sunny-banks" | "skidmarks" {
  return genre === "skidmarks" ? "skidmarks" : "sunny-banks";
}
