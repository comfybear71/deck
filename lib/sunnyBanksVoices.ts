/**
 * Sunny Banks voices from character cards (2026-09-30). A voice id typed
 * on a character's open panel is saved on that character's own card
 * (`CharacterLoraEntry.voiceId`, one `deck_items` row). This is the one
 * place the Sunny Banks line reader looks them up, by name, the same
 * way it matches `Name:` lines:
 *
 * - A built-in cast member (`SUNNY_BANKS_CAST`) whose card has a voice
 *   speaks with the card's voice instead of the hard-coded one. Hans has
 *   no built-in voice, so his card's voice is what makes `Hans:` speak.
 * - A character added with "+" on the Sunnybank bar becomes a speaker
 *   once their card has a voice: their name is matched on `Name:` lines,
 *   and they're in the row dropdown.
 *
 * Pictures (2026-10-01, Stuart: "only our new character images plus 15
 * LoRA trained images, nothing else"): every Sunnybank character, built-in
 * or added, uses only their own Cast card's pictures
 * (`sunnyBanksCastPictures`). Their main picture is the one laid onto
 * the location. There is no built-in or repo picture any more, and no
 * card picture means no picture: the row says so and doesn't render.
 *
 * Pure: reads a `SkidmarksState`, never writes.
 */

import { isAllowedTrainingImageUrl, normalizeElevenLabsVoiceId } from "./characterLoras";
import { normalizeRosterExtrasState } from "./rosterExtras";
import type { SkidmarksState } from "./skidmarks";
import { SUNNY_BANKS_CAST, getSunnyBanksCharacterLock, resolveSunnyBanksStartImage, type SunnyBanksCharacterLock } from "./sunnyBanks";

/** The look an added character with no written look gets: "as in their
 * picture". Fine inside the one-person gold prompt; the multi-cast text
 * leaves it out ("STUIE, on the right, is the only one speaking"). */
export const SUNNY_BANKS_PICTURE_LOOK = "as in their picture";

interface CardVoice {
  name: string;
  voiceId: string;
  /** Set for a character added with "+" (not a built-in). */
  added: boolean;
  look: string;
}

/** One lookup per state: the store hands out a new object on every change. */
const cache = new WeakMap<SkidmarksState, Map<string, CardVoice>>();

/** Sunny Banks cards with a voice, keyed by lower-case name. */
function cardVoices(state: SkidmarksState): Map<string, CardVoice> {
  const cached = cache.get(state);
  if (cached) return cached;
  const out = new Map<string, CardVoice>();
  const extras = normalizeRosterExtrasState(state.rosterExtras)?.["sunny-banks"] ?? [];
  for (const card of state.characterLoras?.characters ?? []) {
    const voiceId = normalizeElevenLabsVoiceId(card.voiceId);
    const sourceKey = card.sourceKey ?? "";
    if (!voiceId || !card.name.trim()) continue;
    let added = false;
    let look = "";
    if (sourceKey.startsWith("sbx:")) {
      const extra = extras.find((x) => x.id === sourceKey.slice(4));
      if (!extra) continue;
      added = true;
      look = extra.look;
    } else if (!sourceKey.startsWith("sb:")) {
      continue;
    }
    const name = card.name.trim();
    const lower = name.toLowerCase();
    // A built-in's own card (sb:) wins over an added face with the same name.
    if (out.has(lower) && out.get(lower)!.added === false) continue;
    out.set(lower, { name, voiceId, added, look });
  }
  cache.set(state, out);
  return out;
}

/** A Sunnybank character's Cast card pictures (2026-10-01). */
export interface SunnyBanksCastPictures {
  /** The Cast card's main picture: its approved reference picture, else
   * (an added character) the first picture on the card, else its first
   * training picture. `null` = no Cast card picture at all. */
  main: string | null;
  /** The card's training pictures (the 15 the LoRA was trained on). */
  training: string[];
  /** The trained LoRA file, when there is one. */
  loraFile: string | null;
}

const NO_CAST_PICTURES: SunnyBanksCastPictures = { main: null, training: [], loraFile: null };

/** Deck's own Blob pictures only (never a repo path or a data URL). */
function blobPicture(url: string | null | undefined): string | null {
  const u = typeof url === "string" ? url.trim() : "";
  return u && /^https:\/\//i.test(u) && isAllowedTrainingImageUrl(u) ? u : null;
}

const pictureCache = new WeakMap<SkidmarksState, Map<string, SunnyBanksCastPictures>>();

/** Every Sunnybank Cast card's pictures, keyed by lower-case name. */
function castPictureMap(state: SkidmarksState): Map<string, SunnyBanksCastPictures> {
  const cached = pictureCache.get(state);
  if (cached) return cached;
  const out = new Map<string, SunnyBanksCastPictures>();
  const fromBuiltInCard = new Set<string>();
  const extras = normalizeRosterExtrasState(state.rosterExtras)?.["sunny-banks"] ?? [];
  for (const card of state.characterLoras?.characters ?? []) {
    const sourceKey = card.sourceKey ?? "";
    const name = card.name.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    let firstCardPicture: string | null = null;
    if (sourceKey.startsWith("sbx:")) {
      const extra = extras.find((x) => x.id === sourceKey.slice(4));
      if (!extra) continue;
      firstCardPicture = blobPicture(extra.pictureUrls[0]);
    } else if (!sourceKey.startsWith("sb:")) {
      continue;
    }
    // A built-in's own card (sb:) wins over an added face with the same name.
    if (fromBuiltInCard.has(lower)) continue;
    const training = card.trainingImageUrls.map(blobPicture).filter((u): u is string => Boolean(u));
    out.set(lower, {
      main: blobPicture(card.referenceUrl) ?? firstCardPicture ?? training[0] ?? null,
      training,
      loraFile: card.loraFile?.trim() || null,
    });
    if (sourceKey.startsWith("sb:")) fromBuiltInCard.add(lower);
  }
  pictureCache.set(state, out);
  return out;
}

/** A Sunnybank character's Cast card pictures, by name. Nothing else is ever a picture for them. */
export function sunnyBanksCastPictures(name: string, state: SkidmarksState): SunnyBanksCastPictures {
  return castPictureMap(state).get(name.trim().toLowerCase()) ?? NO_CAST_PICTURES;
}

function builtInFor(name: string): SunnyBanksCharacterLock | undefined {
  const exact = SUNNY_BANKS_CAST[name];
  if (exact) return exact;
  const lower = name.trim().toLowerCase();
  return Object.values(SUNNY_BANKS_CAST).find((c) => c.name.toLowerCase() === lower);
}

/**
 * The character a `Name:` line means, with the voice it speaks in and
 * their Cast card main picture: a built-in (their card's voice wins), or
 * an added character with a voice. `undefined` = not a speaker (a
 * `Crowd:`-style cutaway). `castPicture` is unset when their Cast card
 * has no picture.
 */
export function resolveSunnyBanksSpeaker(name: string, state: SkidmarksState): SunnyBanksCharacterLock | undefined {
  if (!name.trim()) return undefined;
  const builtIn = builtInFor(name);
  const card = cardVoices(state).get(name.trim().toLowerCase());
  const picture = sunnyBanksCastPictures(name, state).main;
  const withPicture = picture ? { castPicture: picture } : {};
  if (builtIn) {
    return { ...builtIn, ...(card ? { voiceId: card.voiceId } : {}), ...withPicture };
  }
  if (!card || !card.added) return undefined;
  return {
    name: card.name,
    look: card.look.trim() || SUNNY_BANKS_PICTURE_LOOK,
    voiceId: card.voiceId,
    ...withPicture,
  };
}

/** Every name the line reader matches: the built-in cast, then added characters with a voice. Longest first. */
export function sunnyBanksSpeakerNames(state: SkidmarksState): string[] {
  const names = Object.keys(SUNNY_BANKS_CAST);
  const seen = new Set(names.map((n) => n.toLowerCase()));
  for (const v of cardVoices(state).values()) {
    if (!v.added || seen.has(v.name.toLowerCase())) continue;
    seen.add(v.name.toLowerCase());
    names.push(v.name);
  }
  return names.sort((a, b) => b.length - a.length);
}

/** The built-in cast plus added characters with a voice, for the row dropdown (built-ins first). */
export function sunnyBanksSpeakerList(state: SkidmarksState): SunnyBanksCharacterLock[] {
  const list = Object.keys(SUNNY_BANKS_CAST).map((k) => resolveSunnyBanksSpeaker(k, state) ?? SUNNY_BANKS_CAST[k]);
  for (const v of cardVoices(state).values()) {
    if (!v.added || builtInFor(v.name)) continue;
    const lock = resolveSunnyBanksSpeaker(v.name, state);
    if (lock && !list.some((c) => c.name.toLowerCase() === lock.name.toLowerCase())) list.push(lock);
  }
  return list;
}

/**
 * What the speak-beat route needs besides the name: the card's voice,
 * the Cast card main picture (every character, 2026-10-01), and for an
 * added character their look.
 */
export function sunnyBanksSpeakerRequestExtras(
  lock: SunnyBanksCharacterLock | undefined,
): { voiceId?: string; characterCard?: SunnyBanksCharacterCard } {
  if (!lock) return {};
  const builtIn = builtInFor(lock.name);
  const out: { voiceId?: string; characterCard?: SunnyBanksCharacterCard } = {};
  if (lock.voiceId && lock.voiceId !== builtIn?.voiceId) out.voiceId = lock.voiceId;
  const picture = resolveSunnyBanksStartImage(lock);
  if (!builtIn || picture) {
    out.characterCard = { name: lock.name, look: lock.look, ...(picture ? { pictureUrl: picture } : {}) };
  }
  return out;
}

/* ---- Server side: the speak-beat route's reading of those fields ---- */

/** What the panel sends about the character: name, look, Cast card main picture. */
export interface SunnyBanksCharacterCard {
  name: string;
  look: string;
  /** The Cast card main picture (Deck's Blob only). */
  pictureUrl?: string;
}

/** The card fields, cleaned: `null` when absent or unusable. */
export function parseSunnyBanksCharacterCard(value: unknown): SunnyBanksCharacterCard | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { name?: unknown; look?: unknown; pictureUrl?: unknown };
  const name = typeof v.name === "string" ? v.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 60) return null;
  const look = typeof v.look === "string" ? v.look.replace(/\s+/g, " ").trim().slice(0, 600) : "";
  const picture = typeof v.pictureUrl === "string" ? blobPicture(v.pictureUrl) : null;
  return { name, look, ...(picture ? { pictureUrl: picture } : {}) };
}

/**
 * Who is speaking: the built-in lock with their Cast card picture, or a
 * card-described character added on the Sunnybank bar, who needs a voice
 * to count as a speaker. The picture is only ever the one the card sent;
 * with none, `castPicture` is unset and the route refuses to render.
 */
export function resolveSpeakBeatCharacter(
  characterName: string,
  card: SunnyBanksCharacterCard | null,
  voiceId: string | null
): SunnyBanksCharacterLock | undefined {
  if (!characterName) return undefined;
  const builtIn = getSunnyBanksCharacterLock(characterName);
  const sameCard = card && card.name.toLowerCase() === characterName.toLowerCase() ? card : null;
  const withPicture = sameCard?.pictureUrl ? { castPicture: sameCard.pictureUrl } : {};
  if (builtIn) return { ...builtIn, ...withPicture };
  if (!sameCard || !voiceId) return undefined;
  return {
    name: sameCard.name,
    look: sameCard.look || SUNNY_BANKS_PICTURE_LOOK,
    voiceId,
    ...withPicture,
  };
}

/* ---- Multi-cast shots (2026-10-03): every Sunnybank Cast card ---- */

/** One Sunnybank Cast card for `resolveShotCast` (lib/shotCast.ts): voice or not. */
export interface SunnyBanksCastCard {
  name: string;
  look: string;
  /** The Cast card main picture, or null. */
  picture: string | null;
  /** Has a voice (can say a line). */
  speaks: boolean;
}

const castCardCache = new WeakMap<SkidmarksState, SunnyBanksCastCard[]>();

/**
 * Every Sunnybank Cast card: the built-in cast, then every character
 * added with "+" (with or without a voice). A second person in a shot
 * doesn't need a voice, only their main picture, so this list is wider
 * than `sunnyBanksSpeakerNames`. Same pictures as `sunnyBanksCastPictures`.
 */
export function sunnyBanksCastCards(state: SkidmarksState): SunnyBanksCastCard[] {
  const cached = castCardCache.get(state);
  if (cached) return cached;
  const out: SunnyBanksCastCard[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(SUNNY_BANKS_CAST)) {
    const lock = resolveSunnyBanksSpeaker(key, state) ?? SUNNY_BANKS_CAST[key];
    seen.add(lock.name.toLowerCase());
    out.push({
      name: lock.name,
      look: lock.look,
      picture: sunnyBanksCastPictures(lock.name, state).main,
      speaks: Boolean(lock.voiceId),
    });
  }
  const extras = normalizeRosterExtrasState(state.rosterExtras)?.["sunny-banks"] ?? [];
  for (const extra of extras) {
    const name = extra.name.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const voice = cardVoices(state).get(name.toLowerCase());
    out.push({
      name,
      look: extra.look.trim() || SUNNY_BANKS_PICTURE_LOOK,
      picture: sunnyBanksCastPictures(name, state).main ?? blobPicture(extra.pictureUrls[0]),
      speaks: Boolean(voice),
    });
  }
  castCardCache.set(state, out);
  return out;
}
