/**
 * Characters roster (2026-09-29) — every character Deck already knows,
 * grouped the way Stuart thinks about them (Music video, Sunny Banks,
 * Skidmarks), so the Characters screen can show one thumbnail each and
 * train a LoRA from a single tap. Pure data: reads the Skidmarks state
 * and the built-in Sunny Banks cast, never writes anything.
 *
 * The one-tap flow (see `components/CharacterLorasPanel.tsx`) uses the
 * thumbnail as Siray's reference and `buildTrainingPicturePrompts` for
 * the fresh angles, then trains. A character with no picture yet gets a
 * face made first (`buildFacePrompt`) that Stuart looks at before
 * anything is trained.
 */

import {
  AUTO_PICTURE_TARGET,
  CHARACTER_LORA_ESTIMATED_COST_USD,
  CHARACTER_LORA_MAX_IMAGES,
  SIRAY_PICTURE_COST_USD,
  slugifyCharacterName,
  type CharacterLoraEntry,
  type CharacterTrainingStyle,
} from "./characterLoras";
import { resolveMemberStillSleeve } from "./memberStillSleeve";
import { getSkidmarksCharacterLock } from "./plateGeneration";
import type { SkidmarksState } from "./skidmarks";
import { normalizeSkidmarksEpisodesState } from "./skidmarksEpisodes";
import { SUNNY_BANKS_CAST, SUNNY_BANKS_STYLE_LOCK } from "./sunnyBanks";

export type RosterGroup = "music-video" | "sunny-banks" | "skidmarks";

export const ROSTER_GROUPS: { id: RosterGroup; label: string }[] = [
  { id: "music-video", label: "Music video" },
  { id: "sunny-banks", label: "Sunny Banks" },
  { id: "skidmarks", label: "Skidmarks" },
];

export interface RosterCharacter {
  /** Stable link to the LoRA card, e.g. `mv:jack-ash-frontman`, `sb:shazza`, `sk:<cast id>`. */
  sourceKey: string;
  group: RosterGroup;
  name: string;
  /** The picture shown on the tile and handed to Siray. `null` = no picture yet. */
  thumbUrl: string | null;
  /** Other real pictures of them already in Deck (kept sleeve stills), used as training pictures too. */
  extraPictureUrls: string[];
  /** Their locked look in words, added to every Siray prompt. */
  look: string;
  /** Things that must never appear (from a lock card), added as "Do not show". */
  neverShow: string;
  style: CharacterTrainingStyle;
  subjectWord: string;
  /** Set when this character can't be trained, with the reason shown on the tile. */
  blockedReason: string | null;
}

const MINOR_WORDS = /\b(teen|teens|teenage|teenager|child|children|kid|kids|boy|girl|minor|schoolkid|schoolboy|schoolgirl|underage|juvenile|toddler|baby)\b/i;

/** Deck only trains made-up adults. A look written as a teen or child is refused outright. */
export function minorBlockReason(text: string): string | null {
  return MINOR_WORDS.test(text)
    ? "Written as under 18, so it can't be trained. Change their description to a grown adult first."
    : null;
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/** Characters Stuart has taken off the LoRA cast grid. They stay everywhere else in the app. */
export const ROSTER_HIDDEN_NAMES: ReadonlySet<string> = new Set(["hans"]);

export function buildCharacterRoster(state: SkidmarksState): Record<RosterGroup, RosterCharacter[]> {
  const out: Record<RosterGroup, RosterCharacter[]> = { "music-video": [], "sunny-banks": [], skidmarks: [] };

  const seenMembers = new Set<string>();
  for (const band of state.bands ?? []) {
    for (const m of band?.members ?? []) {
      if (!m || !m.name?.trim() || seenMembers.has(m.id)) continue;
      seenMembers.add(m.id);
      const sleeve = resolveMemberStillSleeve(m).map((e) => e.dataUrl);
      const lock = getSkidmarksCharacterLock(m);
      const look = lock?.promptHallmarks ?? "";
      const faceless = m.id === "jack-ash-frontman" || /face (stays )?(entirely )?hidden|no visible face/i.test(look);
      out["music-video"].push({
        sourceKey: `mv:${m.id}`,
        group: "music-video",
        name: m.name.trim(),
        thumbUrl: sleeve[0] ?? null,
        extraPictureUrls: sleeve.slice(1, 9),
        look,
        neverShow: lock?.negativeCues ?? "",
        style: faceless ? "faceless" : "photo",
        subjectWord: m.id === "jack-ash-frontman" ? "man" : "person",
        blockedReason: minorBlockReason(`${m.name} ${m.role ?? ""} ${look}`),
      });
    }
  }

  for (const c of Object.values(SUNNY_BANKS_CAST)) {
    if (ROSTER_HIDDEN_NAMES.has(c.name.trim().toLowerCase())) continue;
    out["sunny-banks"].push({
      sourceKey: `sb:${slugifyCharacterName(c.name)}`,
      group: "sunny-banks",
      name: c.name,
      // The hero image is one figure cropped from the sheet; the full
      // reference sheet has several people on it, which would confuse
      // Siray about who to copy.
      thumbUrl: firstNonEmpty(c.heroImage, c.referenceImage),
      extraPictureUrls: [],
      look: c.look,
      neverShow: "",
      style: "cartoon",
      subjectWord: "character",
      blockedReason: minorBlockReason(`${c.name} ${c.look}`),
    });
  }

  const episodes = normalizeSkidmarksEpisodesState(state.skidmarksEpisodes);
  for (const c of episodes?.cast ?? []) {
    out.skidmarks.push({
      sourceKey: `sk:${c.id}`,
      group: "skidmarks",
      name: c.name,
      thumbUrl: null,
      extraPictureUrls: [],
      look: c.look,
      neverShow: "",
      style: "photo",
      subjectWord: "person",
      blockedReason: c.fictionalAdultConfirmed === true ? minorBlockReason(`${c.name} ${c.look}`) : "Not marked as a made-up adult.",
    });
  }
  return out;
}

/** The LoRA card for a roster character, if one exists. */
export function entryForRosterCharacter(
  characters: readonly CharacterLoraEntry[],
  sourceKey: string,
): CharacterLoraEntry | null {
  return characters.find((c) => c.sourceKey === sourceKey) ?? null;
}

/** Candidate reference pictures for Siray, best first: the approved face, the thumbnail, then kept stills. Never used as training pictures themselves. */
export function startingPictures(char: RosterCharacter, entry: CharacterLoraEntry | null): string[] {
  const first = entry?.referenceUrl ?? char.thumbUrl;
  const all = [first, ...char.extraPictureUrls].filter((u): u is string => Boolean(u));
  return [...new Set(all)].slice(0, CHARACTER_LORA_MAX_IMAGES);
}

/** How many Siray pictures the one-tap flow will make, and the total rough cost. */
export function oneTapCost(startingCount: number, target: number = AUTO_PICTURE_TARGET): { sirayPictures: number; totalUsd: number } {
  const sirayPictures = Math.max(0, target - startingCount);
  return {
    sirayPictures,
    totalUsd: Math.round((sirayPictures * SIRAY_PICTURE_COST_USD + CHARACTER_LORA_ESTIMATED_COST_USD) * 100) / 100,
  };
}

// Variety is what makes a LoRA hold: different angles, framing, light
// and backgrounds, same person. Face-forward shots are left out of the
// faceless list on purpose (Jack's face must never resolve).
const PHOTO_VARIATIONS = [
  "head-and-shoulders portrait, facing the camera, neutral expression, soft daylight, plain light grey background",
  "three-quarter view from the left, slight smile, warm golden-hour light, outdoors",
  "three-quarter view from the right, serious expression, overcast daylight, city street behind",
  "side profile facing left, calm expression, studio lighting, dark background",
  "full body standing, relaxed pose, bright daylight, simple outdoor setting",
  "waist-up, laughing, inside a cafe, warm window light",
  "close-up of the face, thoughtful expression, soft window light",
  "sitting on a chair, waist-up, looking slightly away from the camera, evening lamp light",
  "full body walking toward the camera, midday sun, open road",
  "head-and-shoulders, looking back over the shoulder, night, neon signs behind",
  "waist-up, arms crossed, confident, plain white background, even studio light",
  "three-quarter view, surprised expression, cool blue dusk light",
  "low angle, waist-up, blue sky behind",
  "high angle, head-and-shoulders, looking up, soft light",
  "full body, leaning against a brick wall, late afternoon side light",
];

const FACELESS_VARIATIONS = [
  "full body standing, three-quarter view, desert road at dusk",
  "waist-up, side profile, hat brim throwing the face into shadow, neon sign glow behind",
  "full body walking away down a wet city street at night",
  "waist-up, three-quarter view, leaning on a bar, smoky low light",
  "full body silhouette against a bright sunset",
  "head-and-shoulders from a low angle, face lost in shadow under the brim, moody backlight",
  "sitting on the hood of an old car, full body, dusty roadside, harsh noon sun",
  "waist-up on a small stage, arms loose at the sides, spotlight from above",
  "full body in a doorway, light behind, long shadow on the floor",
  "three-quarter view, waist-up, rain, streetlight from the side",
  "side profile, head-and-shoulders, plain dark studio background, one rim light",
  "full body, standing in tall dry grass, overcast sky",
  "waist-up, walking toward the camera, face hidden in shadow, alley at night",
  "high angle, full body, standing on a cracked desert floor",
  "waist-up, back three-quarter view looking over the shoulder, face still in shadow, motel neon",
];

const CARTOON_VARIATIONS = [
  "full body standing, facing the viewer, plain pale background",
  "three-quarter view from the left, full body, outside a caravan",
  "three-quarter view from the right, waist-up, dusty caravan park road",
  "side profile facing left, full body, red dirt and gum trees",
  "waist-up, laughing, under a shade sail",
  "close-up of the face, cheeky expression",
  "full body walking, heat haze, blue sky",
  "sitting on a camp chair, full body, beside a caravan",
  "waist-up, surprised expression, inside a small tin shed",
  "full body, looking back over the shoulder, sunset sky",
  "head-and-shoulders, grumpy expression, plain pale background",
  "low angle, full body, big sky behind",
  "high angle, full body, standing on dry grass",
  "waist-up, pointing off to one side, outside a laundry block",
  "full body, arms out, mid-shout, dusty road",
];

function variationsFor(style: CharacterTrainingStyle): string[] {
  if (style === "faceless") return FACELESS_VARIATIONS;
  if (style === "cartoon") return CARTOON_VARIATIONS;
  return PHOTO_VARIATIONS;
}

const MAX_LOOK_CHARS = 1100;

// Anything held in a training picture gets learned as part of the
// character and turns up in every later render, so training pictures
// are always empty-handed. Props go in per-shot prompts instead.
const HELD_PROP_RE =
  /\b(holding|holds|carrying|carries|clutching|gripping|wielding|cigarettes?|smok(e|es|ing)|vape|pipe|pies?|tea ?cups?|cups?|mugs?|glass(es)? of|cricket bat|bats?|thongs|beers?|beer cans?|stubb(y|ies)|tinnies|cans?|bottles?|coins|hair ?dryer|cameras?|whistles?|phones?|microphones?|mic|guitars?|instruments?|drinks?|guns?|rifles?|knife|knives|tools?|umbrella|bags?|tins?)\b/i;

/** The look with any held-prop clauses taken out (clauses split on commas, semicolons and dashes). */
export function stripHeldProps(look: string): string {
  return look
    .split(/\s*(?:,|;|—|–|\s-\s)\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !HELD_PROP_RE.test(part))
    .join(", ");
}

export const EMPTY_HANDS_LINE =
  "Hands empty and relaxed: not holding anything, no props, no cigarette, no drink, no phone, no tools, no weapons, no instrument. If the reference shows them holding something, leave it out.";
const MAX_PROMPT_CHARS = 1900; // the Siray route refuses over 2000

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function styleLine(style: CharacterTrainingStyle): string {
  if (style === "cartoon") return `Keep the exact same cartoon style as the reference: ${SUNNY_BANKS_STYLE_LOCK}.`;
  return "Photographic, realistic light and skin, sharp focus.";
}

/**
 * Siray prompts for the training pictures, starting at `startIndex` so
 * a resumed run keeps moving through the list rather than repeating.
 */
export function buildTrainingPicturePrompts(
  char: Pick<RosterCharacter, "name" | "look" | "neverShow" | "style">,
  count: number,
  startIndex = 0,
): string[] {
  const list = variationsFor(char.style);
  const who = char.style === "cartoon" ? "cartoon character" : "person";
  const same =
    char.style === "faceless"
      ? "exactly the same silhouette, hat, clothes and build"
      : "exactly the same face, hair, body shape and outfit";
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const variation = list[(startIndex + i) % list.length];
    const parts = [
      `The same ${who} as in the reference image (${char.name}), ${same}.`,
      `${variation}.`,
      char.look ? clip(stripHeldProps(char.look), MAX_LOOK_CHARS) : "",
      styleLine(char.style),
      EMPTY_HANDS_LINE,
      `Only this one ${who} in the picture, a made-up adult, fully clothed, no text, no watermark.`,
      char.neverShow ? `Do not show: ${clip(char.neverShow, 300)}.` : "",
    ];
    return clip(parts.filter(Boolean).join(" "), MAX_PROMPT_CHARS);
  });
}

/** Text-only Siray prompt for a first face when a character has no picture yet. */
export function buildFacePrompt(char: Pick<RosterCharacter, "name" | "look" | "style">): string {
  const framing =
    char.style === "faceless"
      ? "Waist-up, three-quarter view, face hidden in shadow, plain dark background, one soft key light."
      : "Head-and-shoulders character reference portrait, facing the camera, neutral expression, even soft light, plain light grey background.";
  const parts = [
    `${char.name}: ${clip(stripHeldProps(char.look) || "an original made-up character", MAX_LOOK_CHARS)}.`,
    framing,
    EMPTY_HANDS_LINE,
    char.style === "cartoon" ? `${SUNNY_BANKS_STYLE_LOCK}.` : "Photographic, realistic.",
    "A made-up adult, clearly over 25, not resembling any real person, fully clothed, one person only, no text.",
  ];
  return clip(parts.join(" "), MAX_PROMPT_CHARS);
}
