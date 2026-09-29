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
import { normalizeAdultShortsState } from "./adultShorts";
import { ROSTER_EXTRA_GROUPS, normalizeRosterExtrasState, rosterExtraSourceKey, type RosterExtraGroup } from "./rosterExtras";
import { resolveMemberStillSleeve } from "./memberStillSleeve";
import { getSkidmarksCharacterLock } from "./plateGeneration";
import type { SkidmarksState } from "./skidmarks";
import { normalizeSkidmarksEpisodesState } from "./skidmarksEpisodes";
import { SUNNY_BANKS_CAST, SUNNY_BANKS_STYLE_LOCK } from "./sunnyBanks";

export type RosterGroup = "music-video" | "sunny-banks" | "skidmarks" | "adult-shorts";

export const ROSTER_GROUPS: { id: RosterGroup; label: string }[] = [
  { id: "music-video", label: "Music video" },
  { id: "sunny-banks", label: "Sunny Banks" },
  { id: "skidmarks", label: "Skidmarks" },
  { id: "adult-shorts", label: "Adult shorts" },
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
  const out: Record<RosterGroup, RosterCharacter[]> = { "music-video": [], "sunny-banks": [], skidmarks: [], "adult-shorts": [] };

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
      thumbUrl: c.pictureUrls?.[0] ?? null,
      extraPictureUrls: (c.pictureUrls ?? []).slice(1),
      look: c.look,
      neverShow: "",
      // Skidmarks characters are 3D cartoon caricatures, not photos and
      // not the flat Sunny Banks style.
      style: "render3d",
      subjectWord: c.isAnimal ? "animal" : "person",
      blockedReason: c.fictionalAdultConfirmed === true ? minorBlockReason(`${c.name} ${c.look}`) : "Not marked as a made-up adult.",
    });
  }

  // Adult shorts: the character currently in the editor, once the 18+
  // confirm is ticked. Trained like any real-looking character, and the
  // training pictures stay fully clothed (see the prompt builders).
  // Every character from the saved shorts too (newest first), one tile per name.
  const adult = normalizeAdultShortsState(state.adultShorts);
  const adultChars = adult?.ageConfirmed ? [adult.character, ...adult.saved.map((sv) => sv.character)] : [];
  const seenAdult = new Set<string>();
  for (const ac of adultChars) {
    if (!ac?.name.trim()) continue;
    const slug = slugifyCharacterName(ac.name);
    if (seenAdult.has(slug)) continue;
    seenAdult.add(slug);
    out["adult-shorts"].push({
      sourceKey: `as:${slug}`,
      group: "adult-shorts",
      name: ac.name.trim(),
      thumbUrl: ac.referenceUrls[0] ?? null,
      extraPictureUrls: ac.referenceUrls.slice(1),
      look: ac.look,
      neverShow: "",
      style: "photo",
      subjectWord: "person",
      blockedReason: minorBlockReason(`${ac.name} ${ac.look}`),
    });
  }

  // Characters added with "+ Add a character" (see `lib/rosterExtras.ts`).
  // Same name as one already in the group: their pictures go to that
  // character instead of making a second tile.
  const extras = normalizeRosterExtrasState(state.rosterExtras);
  for (const g of ROSTER_EXTRA_GROUPS) {
    // Adult shorts stay hidden until the 18+ confirm is ticked, like the editor character.
    if (g === "adult-shorts" && !adult?.ageConfirmed) continue;
    for (const x of extras?.[g] ?? []) {
      const slug = slugifyCharacterName(x.name);
      const existing = out[g].find((c) => slugifyCharacterName(c.name) === slug);
      if (existing) {
        const pics = [...new Set([existing.thumbUrl, ...existing.extraPictureUrls, ...x.pictureUrls].filter((u): u is string => Boolean(u)))];
        existing.thumbUrl = pics[0] ?? null;
        existing.extraPictureUrls = pics.slice(1, CHARACTER_LORA_MAX_IMAGES);
        if (!existing.look.trim() && x.look.trim()) existing.look = x.look;
        continue;
      }
      out[g].push({
        sourceKey: rosterExtraSourceKey(g, x.id),
        group: g,
        name: x.name,
        thumbUrl: x.pictureUrls[0] ?? null,
        extraPictureUrls: x.pictureUrls.slice(1),
        look: x.look,
        neverShow: "",
        style: EXTRA_STYLE[g],
        subjectWord: x.isAnimal ? "animal" : g === "sunny-banks" ? "character" : "person",
        blockedReason: x.isAnimal ? null : minorBlockReason(`${x.name} ${x.look}`),
      });
    }
  }
  return out;
}

/** The style an added character trains in, same as the rest of their group. */
const EXTRA_STYLE: Record<RosterExtraGroup, CharacterTrainingStyle> = {
  "music-video": "photo",
  "sunny-banks": "cartoon",
  "adult-shorts": "photo",
};

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
  "full body, three-quarter view, walking down a wet city street at night, glowing lips visible under the brim",
  "waist-up, three-quarter view, leaning on a bar, smoky low light",
  "full body silhouette against a bright sunset, turned three-quarter so the glowing lips still show",
  "head-and-shoulders from a low angle, face lost in shadow under the brim except the glowing lips, moody backlight",
  "sitting on the hood of an old car, full body, dusty roadside, harsh noon sun",
  "waist-up on a small stage, arms loose at the sides, spotlight from above",
  "full body in a doorway, light behind, long shadow on the floor",
  "three-quarter view, waist-up, rain, streetlight from the side",
  "side profile, head-and-shoulders, plain dark studio background, one rim light",
  "full body, standing in tall dry grass, overcast sky",
  "waist-up, walking toward the camera at an angle, face hidden in shadow except the glowing lips, alley at night",
  "high angle, full body, standing on a cracked desert floor",
  "waist-up, looking over the shoulder, face still in shadow except the glowing lips, motel neon",
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

// Animals: no "arms crossed" or "sitting on a chair" poses.
const ANIMAL_VARIATIONS = [
  "full body, facing the viewer, plain light grey background, soft even light",
  "three-quarter view from the left, full body, outdoors in daylight",
  "three-quarter view from the right, full body, city street behind",
  "side profile facing left, full body, plain dark background, studio light",
  "close-up of the face, curious expression, soft window light",
  "full body, mid-step walking toward the camera, midday sun",
  "head-and-shoulders, looking back over the shoulder, night, neon signs behind",
  "full body, low angle, blue sky behind",
  "full body, high angle, looking up at the camera",
  "waist-up, cheeky expression, warm golden-hour light",
  "close-up, grumpy expression, overcast daylight",
  "full body, standing on a brick wall, late afternoon side light",
  "three-quarter view, surprised expression, cool blue dusk light",
  "full body, on a pub counter, warm low light",
  "head-and-shoulders, facing the camera, neutral expression, plain white background",
];

function isAnimal(subjectWord?: string): boolean {
  return (subjectWord ?? "").trim().toLowerCase() === "animal";
}

function variationsFor(style: CharacterTrainingStyle, subjectWord?: string): string[] {
  if (isAnimal(subjectWord)) return ANIMAL_VARIATIONS;
  if (style === "faceless") return FACELESS_VARIATIONS;
  if (style === "cartoon") return CARTOON_VARIATIONS;
  return PHOTO_VARIATIONS;
}

/** What the prompts call them: "animal character", "cartoon character", "man" or "person". */
function whoWord(style: CharacterTrainingStyle, subjectWord?: string, facelessWord = "person"): string {
  if (isAnimal(subjectWord)) return "animal character";
  if (style === "cartoon" || style === "render3d") return "cartoon character";
  return style === "faceless" ? facelessWord : "person";
}

/** The closing safety line: made-up adults for people, a made-up animal for animals. */
function madeUpLine(who: string, subjectWord?: string): string {
  return isAnimal(subjectWord)
    ? `Only this one ${who} in the picture, a made-up animal, no people, no text, no watermark.`
    : `Only this one ${who} in the picture, a made-up adult, clearly over 25, not resembling any real person, fully clothed, no text, no watermark.`;
}

const MAX_LOOK_CHARS = 1100;

// Anything held in a training picture gets learned as part of the
// character and turns up in every later render, so training pictures
// are always empty-handed. Props go in per-shot prompts instead.
const HELD_PROP_RE =
  /\b(holding|holds|carrying|carries|clutching|gripping|wielding|cigarettes?|smok(e|es|ing)|vape|pipe|pies?|tea ?cups?|cups?|mugs?|glass(es)? of|cricket bat|bats?|thongs|beers?|beer cans?|stubb(y|ies)|tinnies|cans?|bottles?|coins|hair ?dryer|cameras?|whistles?|phones?|microphones?|mic|guitars?|instruments?|drinks?|guns?|rifles?|knife|knives|tools?|umbrella|bags?|tins?)\b/i;

// Arm poses in a look ("arms folded") fight each shot's own pose and
// Siray draws both sets of arms, so the shot description owns the pose.
const ARM_POSE_RE = /\b(arms?|hands?)\s+(folded|crossed|on (her|his|their) hips|in (her|his|their) pockets|raised|out)\b|\b(folded|crossed) arms\b/i;

/** The look with any held-prop clauses taken out (clauses split on commas, semicolons and dashes). */
export function stripHeldProps(look: string): string {
  return look
    .split(/\s*(?:,|;|—|–|\s-\s)\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !HELD_PROP_RE.test(part) && !ARM_POSE_RE.test(part))
    .join(", ");
}

export const EMPTY_HANDS_LINE =
  "Nothing in the hands: no props, no cigarette, no drink, no phone, no tools, no weapons, no instrument. If the reference shows them holding something, leave it out. Correct anatomy: exactly two arms and two hands, arms posed only as this shot describes, no extra or duplicated limbs.";
export const ANIMAL_ANATOMY_LINE =
  "Nothing held and no props. Correct anatomy for this animal: the right number of legs, wings or paws, no extra or duplicated limbs.";
const MAX_PROMPT_CHARS = 1900; // the Siray route refuses over 2000

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

const RENDER_3D_STYLE =
  "Stylised 3D animated caricature, like a feature-animation film still: exaggerated proportions, smooth rendered materials, soft cinematic light";

function styleLine(style: CharacterTrainingStyle): string {
  if (style === "cartoon") return `Keep the exact same cartoon style as the reference: ${SUNNY_BANKS_STYLE_LOCK}.`;
  if (style === "render3d") return `Keep the exact same 3D cartoon look as the reference. ${RENDER_3D_STYLE}.`;
  return "Photographic, realistic light and skin, sharp focus.";
}

const NEON_LIPS_RE = /neon[- ]blue lips|lips glow[^.]*neon blue/i;

/** The one feature that must show in every picture, when the look has one (Jack's neon blue lips). */
export function signatureLine(look: string): string {
  return NEON_LIPS_RE.test(look)
    ? "Must show: his lips glow a vivid neon blue and are clearly visible in this picture, the only lit feature of his shadowed face."
    : "";
}

/**
 * Siray prompts for the training pictures, starting at `startIndex` so
 * a resumed run keeps moving through the list rather than repeating.
 */
export function buildTrainingPicturePrompts(
  char: Pick<RosterCharacter, "name" | "look" | "neverShow" | "style"> & { subjectWord?: string },
  count: number,
  startIndex = 0,
): string[] {
  const animal = isAnimal(char.subjectWord);
  const list = variationsFor(char.style, char.subjectWord);
  const who = whoWord(char.style, char.subjectWord);
  const same = animal
    ? "exactly the same species, face, markings, body shape and any clothes"
    : char.style === "faceless"
      ? "exactly the same silhouette, hat, clothes and build"
      : "exactly the same face, hair, body shape and outfit";
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const variation = list[(startIndex + i) % list.length];
    const parts = [
      `The same ${who} as in the reference image (${char.name}), ${same}.`,
      `${variation}.`,
      signatureLine(char.look),
      char.look ? clip(stripHeldProps(char.look), MAX_LOOK_CHARS) : "",
      styleLine(char.style),
      animal ? ANIMAL_ANATOMY_LINE : EMPTY_HANDS_LINE,
      madeUpLine(who, char.subjectWord),
      char.neverShow ? `Do not show: ${clip(char.neverShow, 300)}.` : "",
    ];
    return clip(parts.filter(Boolean).join(" "), MAX_PROMPT_CHARS);
  });
}

/**
 * Siray prompt for the one clean base picture every training picture is
 * made from: arms down, empty hands, plain background. With a reference
 * it copies the character from their existing picture (which may show
 * props or folded arms); without one it draws them from the look.
 */
export function buildCleanReferencePrompt(
  char: Pick<RosterCharacter, "name" | "look" | "style"> & { subjectWord?: string },
  hasReference: boolean,
): string {
  const animal = isAnimal(char.subjectWord);
  const who = whoWord(char.style, char.subjectWord, "man");
  const look = stripHeldProps(char.look);
  const pose = animal
    ? "Full body, standing, facing the viewer at a slight angle, neutral expression, plain light background, even soft light."
    : char.style === "faceless"
      ? "Full body standing, three-quarter view, arms hanging relaxed at the sides, hands open and empty, face in deep shadow under the hat brim, plain dark background, one soft key light."
      : "Full body standing, facing the viewer at a slight angle, arms hanging relaxed straight down at the sides, hands open and empty, neutral expression, plain light background, even soft light.";
  const parts = [
    hasReference
      ? `The same ${who} as in the reference image (${char.name}): exactly the same ${animal ? "species, face, markings, body shape and any clothes" : "face, hair, body shape and outfit"}, but a new pose.`
      : `${char.name}: ${clip(look || "an original made-up character", MAX_LOOK_CHARS)}.`,
    pose,
    hasReference && look ? clip(look, MAX_LOOK_CHARS) : "",
    signatureLine(char.look),
    styleLine(char.style),
    animal ? ANIMAL_ANATOMY_LINE : EMPTY_HANDS_LINE,
    animal
      ? "A made-up animal character, one animal only, no people, no text, no watermark."
      : "A made-up adult, clearly over 25, not resembling any real person, fully clothed, one person only, no text, no watermark.",
  ];
  return clip(parts.filter(Boolean).join(" "), MAX_PROMPT_CHARS);
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
    char.style === "cartoon" ? `${SUNNY_BANKS_STYLE_LOCK}.` : char.style === "render3d" ? `${RENDER_3D_STYLE}.` : "Photographic, realistic.",
    "A made-up adult, clearly over 25, not resembling any real person, fully clothed, one person only, no text.",
  ];
  return clip(parts.join(" "), MAX_PROMPT_CHARS);
}
