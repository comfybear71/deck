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
 * - `shorts` (2026-10-04, Stuart: "rebuild Shorts to work like Skidmarks
 *   and Sunny Banks"): each episode's own Shorts Cast and Locations
 *   (`lib/shortsEpisodeCast.ts`), no built-ins, the photoreal look below
 *   (it carries the Shorts adult and content locks), clips in
 *   `deck/shorts/episodes/<episode>/…`. Plates on Siray (Seedream,
 *   uncensored) by default, or Grok; silent shots on Siray by default,
 *   or Grok / H3. The shot-card episodes (EP01–EP03) keep their own
 *   editor (`components/AdultShortsPanel.tsx`), untouched.
 *
 * Anything that doesn't say which show it is means Sunny Banks, so every
 * Sunny Banks request, prompt and saved episode is exactly what it was.
 */
import { ADULT_SHORTS_CONTENT_LOCK, ADULT_SHORTS_GROUP_ADULT_LOCK, ADULT_SHORTS_MOTION_GROUP_ADULT_LOCK } from "./adultShorts";
import { SUNNY_BANKS_LOOK, type StudioLook } from "./sunnyBanks";
import type { SilentShotBackend } from "./videoBackendRouting";

export type StudioGenre = "sunnybank" | "skidmarks" | "shorts";

export const STUDIO_GENRES: readonly StudioGenre[] = ["sunnybank", "skidmarks", "shorts"];

/** `"skidmarks"` / `"shorts"` name their show; anything else (missing, junk) is Sunny Banks. */
export function parseStudioGenre(value: unknown): StudioGenre {
  return value === "skidmarks" || value === "shorts" ? value : "sunnybank";
}

/** What makes a row's start picture (2026-10-04): Grok (xAI image edit) or
 * Siray (Seedream 4.5 reference edit, uncensored). */
export type PlateEngine = "grok" | "siray";

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

/**
 * The Shorts look (2026-10-04): real live-action footage, never a
 * cartoon or a render. An episode's own look ("Gritty 16mm film, heavy
 * film grain…", EP03) goes in its `[Action:]` text and wins. It carries
 * the Shorts adult lock and content rule, so every Shorts prompt (plate,
 * talking or silent) has them, and Siray's clip check
 * (`/\badult\b…, clearly over 25/`) passes.
 */
export const SHORTS_STYLE_LOCK =
  "photorealistic live-action film footage, real people with natural skin texture, real light and real places, " +
  `looks filmed by a real camera. ${ADULT_SHORTS_GROUP_ADULT_LOCK} ${ADULT_SHORTS_CONTENT_LOCK}`;

/**
 * A talking row's plate (2026-10-04, EP03 shot 3): LTX only moves a
 * mouth it can see. Ned's head tilted down at his beer can gave no
 * lip-sync; facing the camera did. Added to a Shorts talking row's plate.
 */
export const SHORTS_TALKING_PLATE_LINE =
  "The speaker's head is level and their face is turned towards the camera (at most a three-quarter view), " +
  "mouth fully visible and not covered, not looking down.";

/**
 * The Shorts look on motion prompts (talking, silent, cutaway; 2026-10-04):
 * the same, minus "same face, hair and body as their reference", which
 * only a plate (made from the pictures) can follow. A talking row then
 * ends the way a shot-card talking shot does (PR 252).
 */
export const SHORTS_MOTION_STYLE_LOCK =
  "photorealistic live-action film footage, real people with natural skin texture, real light and real places, " +
  `looks filmed by a real camera. ${ADULT_SHORTS_MOTION_GROUP_ADULT_LOCK} ${ADULT_SHORTS_CONTENT_LOCK}`;

export const SHORTS_LOOK: StudioLook = {
  styleLock: SHORTS_STYLE_LOCK,
  motionStyleLock: SHORTS_MOTION_STYLE_LOCK,
  ambienceSentence: "",
  idleAmbience: "",
  keepPlaceLine: "Do not swap the location for a different place.",
  talkingPlateLine: SHORTS_TALKING_PLATE_LINE,
  cutawayCarriesStyleLock: true,
};

export interface StudioGenreProfile {
  genre: StudioGenre;
  /** The show's name in messages ("Sunny Banks", "Skidmarks"). */
  showName: string;
  look: StudioLook;
  /** The old flat Blob prefix for a clip with no episode folder yet. */
  legacyBlobPrefix: string;
  /** Has the built-in Sunny Banks cast and locations. */
  builtIns: boolean;
  /** The engines the silent-shot switch offers, default first. */
  silentBackends: readonly SilentShotBackend[];
  /** The engines a plate can be made on, default first. */
  plateEngines: readonly PlateEngine[];
}

export const STUDIO_GENRE_PROFILES: Record<StudioGenre, StudioGenreProfile> = {
  sunnybank: {
    genre: "sunnybank",
    showName: "Sunny Banks",
    look: SUNNY_BANKS_LOOK,
    legacyBlobPrefix: "sunnybanks",
    builtIns: true,
    silentBackends: ["grok", "h3"],
    plateEngines: ["grok"],
  },
  skidmarks: {
    genre: "skidmarks",
    showName: "Skidmarks",
    look: SKIDMARKS_LOOK,
    legacyBlobPrefix: "skidmarks/studio",
    builtIns: false,
    silentBackends: ["grok", "h3"],
    plateEngines: ["grok"],
  },
  shorts: {
    genre: "shorts",
    showName: "Shorts",
    look: SHORTS_LOOK,
    legacyBlobPrefix: "shorts/studio",
    builtIns: false,
    silentBackends: ["siray", "grok", "h3"],
    plateEngines: ["siray", "grok"],
  },
};

export function studioGenreProfile(genre: StudioGenre | undefined): StudioGenreProfile {
  return STUDIO_GENRE_PROFILES[genre ?? "sunnybank"];
}

/** Which roster group a show's Cast cards are in. */
export function studioCastGroup(genre: StudioGenre): "sunny-banks" | "skidmarks" | "adult-shorts" {
  return genre === "skidmarks" ? "skidmarks" : genre === "shorts" ? "adult-shorts" : "sunny-banks";
}

/** The show's silent-shot engine: the saved switch when the show offers it, else its default. */
export function studioSilentBackend(genre: StudioGenre, saved: unknown): SilentShotBackend {
  const offered = studioGenreProfile(genre).silentBackends;
  return offered.includes(saved as SilentShotBackend) ? (saved as SilentShotBackend) : offered[0];
}

/** The show's plate engine: the saved switch when the show offers it, else its default. */
export function studioPlateEngine(genre: StudioGenre, saved: unknown): PlateEngine {
  const offered = studioGenreProfile(genre).plateEngines;
  return offered.includes(saved as PlateEngine) ? (saved as PlateEngine) : offered[0];
}
