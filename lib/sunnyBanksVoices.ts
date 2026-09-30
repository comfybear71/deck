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
 *   Hans also has no built-in picture; if his card's character has one
 *   (the face added on the Sunnybank bar), that is his picture too.
 * - A character added with "+" on the Sunnybank bar becomes a speaker
 *   once their card has a voice: their name is matched on `Name:` lines,
 *   they're in the row dropdown, and their first picture is the one
 *   laid onto the location.
 *
 * Pure: reads a `SkidmarksState`, never writes.
 */

import { isAllowedTrainingImageUrl, normalizeElevenLabsVoiceId } from "./characterLoras";
import { normalizeRosterExtrasState } from "./rosterExtras";
import type { SkidmarksState } from "./skidmarks";
import { SUNNY_BANKS_CAST, getSunnyBanksCharacterLock, resolveSunnyBanksStartImage, type SunnyBanksCharacterLock } from "./sunnyBanks";

interface CardVoice {
  name: string;
  voiceId: string;
  /** Set for a character added with "+" (not a built-in). */
  added: boolean;
  look: string;
  /** Their first Blob picture, if they have one. */
  pictureUrl: string | null;
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
    let pictureUrl: string | null = null;
    if (sourceKey.startsWith("sbx:")) {
      const extra = extras.find((x) => x.id === sourceKey.slice(4));
      if (!extra) continue;
      added = true;
      look = extra.look;
      pictureUrl = extra.pictureUrls[0] ?? card.referenceUrl ?? null;
    } else if (!sourceKey.startsWith("sb:")) {
      continue;
    } else {
      pictureUrl = card.referenceUrl && /^https:/.test(card.referenceUrl) ? card.referenceUrl : null;
    }
    const name = card.name.trim();
    const lower = name.toLowerCase();
    // A built-in's own card (sb:) wins over an added face with the same name.
    if (out.has(lower) && out.get(lower)!.added === false) continue;
    out.set(lower, { name, voiceId, added, look, pictureUrl: pictureUrl && /^https:/.test(pictureUrl) ? pictureUrl : null });
  }
  cache.set(state, out);
  return out;
}

function builtInFor(name: string): SunnyBanksCharacterLock | undefined {
  const exact = SUNNY_BANKS_CAST[name];
  if (exact) return exact;
  const lower = name.trim().toLowerCase();
  return Object.values(SUNNY_BANKS_CAST).find((c) => c.name.toLowerCase() === lower);
}

/**
 * The character a `Name:` line means, with the voice it speaks in: a
 * built-in (their card's voice wins), or an added character with a
 * voice. `undefined` = not a speaker (a `Crowd:`-style cutaway).
 */
export function resolveSunnyBanksSpeaker(name: string, state: SkidmarksState): SunnyBanksCharacterLock | undefined {
  if (!name.trim()) return undefined;
  const builtIn = builtInFor(name);
  const card = cardVoices(state).get(name.trim().toLowerCase());
  if (builtIn) {
    if (!card) return builtIn;
    const needsPicture = !resolveSunnyBanksStartImage(builtIn) && card.pictureUrl;
    return { ...builtIn, voiceId: card.voiceId, ...(needsPicture ? { heroImage: card.pictureUrl as string } : {}) };
  }
  if (!card || !card.added) return undefined;
  return {
    name: card.name,
    look: card.look.trim() || "as in their picture",
    voiceId: card.voiceId,
    ...(card.pictureUrl ? { heroImage: card.pictureUrl } : {}),
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
 * What the speak-beat route needs besides the name when the character
 * isn't fully described by the built-in table: the card's voice, and
 * for an added character (or Hans's picture) their look and picture.
 */
export function sunnyBanksSpeakerRequestExtras(
  lock: SunnyBanksCharacterLock | undefined,
): { voiceId?: string; characterCard?: { name: string; look: string; heroImageUrl?: string } } {
  if (!lock) return {};
  const builtIn = builtInFor(lock.name);
  const out: { voiceId?: string; characterCard?: { name: string; look: string; heroImageUrl?: string } } = {};
  if (lock.voiceId && lock.voiceId !== builtIn?.voiceId) out.voiceId = lock.voiceId;
  const hero = resolveSunnyBanksStartImage(lock);
  const heroIsCard = Boolean(hero && /^https:/.test(hero) && hero !== (builtIn ? resolveSunnyBanksStartImage(builtIn) : undefined));
  if (!builtIn || heroIsCard) {
    out.characterCard = { name: lock.name, look: lock.look, ...(heroIsCard ? { heroImageUrl: hero as string } : {}) };
  }
  return out;
}

/* ---- Server side: the speak-beat route's reading of those fields ---- */

/** The card fields, cleaned: `null` when absent or unusable. */
export function parseSunnyBanksCharacterCard(value: unknown): { name: string; look: string; heroImageUrl?: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { name?: unknown; look?: unknown; heroImageUrl?: unknown };
  const name = typeof v.name === "string" ? v.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 60) return null;
  const look = typeof v.look === "string" ? v.look.replace(/\s+/g, " ").trim().slice(0, 600) : "";
  const hero = typeof v.heroImageUrl === "string" && isAllowedTrainingImageUrl(v.heroImageUrl) && !v.heroImageUrl.startsWith("data:")
    ? v.heroImageUrl
    : undefined;
  return { name, look, ...(hero ? { heroImageUrl: hero } : {}) };
}

/**
 * Who is speaking: the built-in lock (with the card's picture only if
 * they have none of their own), or a card-described character added on
 * the Sunnybank bar, who needs a voice to count as a speaker.
 */
export function resolveSpeakBeatCharacter(
  characterName: string,
  card: ReturnType<typeof parseSunnyBanksCharacterCard>,
  voiceId: string | null
): SunnyBanksCharacterLock | undefined {
  if (!characterName) return undefined;
  const builtIn = getSunnyBanksCharacterLock(characterName);
  const sameCard = card && card.name.toLowerCase() === characterName.toLowerCase() ? card : null;
  if (builtIn) {
    if (sameCard?.heroImageUrl && !resolveSunnyBanksStartImage(builtIn)) return { ...builtIn, heroImage: sameCard.heroImageUrl };
    return builtIn;
  }
  if (!sameCard || !voiceId) return undefined;
  return {
    name: sameCard.name,
    look: sameCard.look || "as in their picture",
    voiceId,
    ...(sameCard.heroImageUrl ? { heroImage: sameCard.heroImageUrl } : {}),
  };
}
