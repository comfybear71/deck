/**
 * Rename and delete for a character on any genre's Characters bar
 * (Stuart, 2026-09-30: a Sunnybank face was added as "ArSGL" instead of
 * "Hans", and there was no way to fix or remove it). The same rules and
 * the same code for Sunnybank, Music video, Skidmarks and Shorts.
 *
 * Where a character's name lives depends on where it came from (its
 * roster `sourceKey`):
 * - `sbx:` / `mvx:` / `asx:` — added with "+ Add a character" (`rosterExtras`).
 * - `mv:` — a band member (saved per band, `music-video-band` rows).
 * - `sk:` — the Skidmarks cast list (episodes point at it by id).
 * - `as:` — the character inside the Shorts editor and saved shorts.
 * - `asx:` with no added-character entry — a Shorts LoRA card on its own (Skye).
 * - `sb:` — a built-in Sunny Banks regular. Their names are Deck's cast
 *   list (voices, the `Name:` line reader), so they can't be renamed or
 *   removed here.
 *
 * Every rename and delete also goes through the character's own
 * `deck_items` row (kind `character`, `patchCharacterLoras` /
 * `removeCharacterLora` → `lib/deckItemSync.ts`): a rename is a row update
 * (revision bump, the old copy kept in `deck_item_history`), a delete is a
 * tombstone. A character that never had a card gets one on rename, so the
 * new name is saved on its own row too, not only in the session.
 *
 * Nothing here touches Blob. The id, pictures, plates and LoRA stay as
 * they are. A card keeps its `slug` (the LoRA file names and its Blob
 * folder), so a trained character's folder stays under the old name.
 */

import {
  buildCharacterLoraEntry,
  characterProfileAgeProblem,
  normalizeCharacterProfile,
  normalizeElevenLabsVoiceId,
  type CharacterProfile,
  slugifyCharacterName,
  type CharacterLoraEntry,
} from "./characterLoras";
import { buildCharacterRoster, minorBlockReason, type RosterCharacter } from "./characterRoster";
import { adultShortStarring, normalizeAdultShortsState, sameAdultShortPerson } from "./adultShorts";
import type { RosterExtraGroup } from "./rosterExtras";
import { SUNNY_BANKS_CAST } from "./sunnyBanks";
import {
  flushSkidmarksSessionNow,
  getCharacterLorasState,
  getRosterExtrasState,
  getSkidmarksEpisodesState,
  getSkidmarksSnapshot,
  patchAdultShorts,
  patchCharacterLoras,
  patchRosterExtras,
  patchSkidmarksEpisodes,
  removeCharacterLora,
  removeSkidmarksMember,
  renameSkidmarksMember,
  type SkidmarksState,
} from "./skidmarks";

export const CHARACTER_NAME_MAX = 60;

export type CharacterSource =
  | { kind: "fixed"; reason: string }
  | { kind: "extra"; group: RosterExtraGroup; id: string }
  | { kind: "member"; bandId: string; memberId: string }
  | { kind: "cast"; id: string }
  | { kind: "short"; slug: string }
  | { kind: "card" };

/** Where this character's name is kept, or why it can't be changed. */
export function characterSource(char: Pick<RosterCharacter, "sourceKey" | "name">, state: SkidmarksState): CharacterSource {
  const colon = char.sourceKey.indexOf(":");
  const prefix = colon > 0 ? char.sourceKey.slice(0, colon) : "";
  const rest = colon > 0 ? char.sourceKey.slice(colon + 1) : "";
  const extraGroup: Record<string, RosterExtraGroup> = { sbx: "sunny-banks", mvx: "music-video", asx: "adult-shorts" };
  if (prefix === "sb") {
    return {
      kind: "fixed",
      reason: `${char.name} is one of the built-in Sunny Banks regulars, so their name is part of Deck's cast list and can't be changed or removed here.`,
    };
  }
  if (prefix in extraGroup) {
    const group = extraGroup[prefix];
    if (getRosterExtrasState(state)[group].some((x) => x.id === rest)) return { kind: "extra", group, id: rest };
    if (prefix === "asx" && getCharacterLorasState(state).characters.some((c) => c.sourceKey === char.sourceKey)) return { kind: "card" };
  }
  if (prefix === "mv") {
    const band = (state.bands ?? []).find((b) => b.members.some((m) => m.id === rest));
    if (band) return { kind: "member", bandId: band.id, memberId: rest };
  }
  if (prefix === "sk" && getSkidmarksEpisodesState(state).cast.some((c) => c.id === rest)) return { kind: "cast", id: rest };
  if (prefix === "as" && rest) return { kind: "short", slug: rest };
  return { kind: "fixed", reason: `Couldn't find where ${char.name} is saved, so nothing was changed.` };
}

/** True when the panel should offer rename and the bin. */
export function characterCanBeEdited(char: RosterCharacter, state: SkidmarksState): boolean {
  return characterSource(char, state).kind !== "fixed";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Script lines that start with `Name:` (any case). */
export function countSpeakerLines(text: string | null | undefined, name: string): number {
  if (!text || !name.trim()) return 0;
  const re = new RegExp(`^\\s*${escapeRegExp(name.trim())}\\s*:`, "i");
  return text.split(/\r?\n/).filter((line) => re.test(line)).length;
}

/** Music video script parts titled "Other Singer: Name". */
function countOtherSingerParts(text: string | null | undefined, name: string): number {
  if (!text || !name.trim()) return 0;
  const re = new RegExp(`other[\\s-]?singer\\s*[:\\-]?\\s*\\(?\\s*${escapeRegExp(name.trim())}\\s*\\)?\\s*(\\[|$)`, "i");
  return text.split(/\r?\n/).filter((line) => re.test(line)).length;
}

/** A name in Deck's built-in Sunny Banks cast (what the `Name:` line reader matches). */
function isBuiltInSunnyBanksName(name: string): boolean {
  const key = name.trim().toLowerCase();
  return Object.keys(SUNNY_BANKS_CAST).some((k) => k.toLowerCase() === key);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listTitles(titles: string[]): string {
  const shown = titles.slice(0, 3).map((t) => `"${t}"`);
  return titles.length > 3 ? `${shown.join(", ")} and ${titles.length - 3} more` : shown.join(", ");
}

/** Sunny Banks scripts (the open one and every saved card) that still say `Name:`. */
function sunnyBanksUses(state: SkidmarksState, name: string): { lines: number; titles: string[] } {
  const sb = state.sunnyBanks;
  if (!sb) return { lines: 0, titles: [] };
  let lines = 0;
  const titles: string[] = [];
  const scan = (label: string, scripts: Record<string, string>, overrides: Record<string, Record<number, string>>) => {
    let n = 0;
    for (const text of Object.values(scripts ?? {})) n += countSpeakerLines(text, name);
    for (const rows of Object.values(overrides ?? {}))
      for (const v of Object.values(rows ?? {})) if (typeof v === "string" && v.trim().toLowerCase() === name.trim().toLowerCase()) n++;
    if (n > 0) {
      lines += n;
      if (!titles.includes(label)) titles.push(label);
    }
  };
  const openCard = sb.live.episodeId ? sb.workspaces.find((w) => w.id === sb.live.episodeId) : undefined;
  if (!openCard) scan(sb.live.workspaceTitle?.trim() || "the open episode", sb.live.actScripts, sb.live.characterOverrides);
  for (const w of sb.workspaces) scan(w.label, w.actScripts, w.characterOverrides);
  return { lines, titles };
}

/**
 * Why this character can't be deleted right now, in plain words, or
 * `null` when it's safe. Anything that still uses them blocks the
 * delete, so nothing is left pointing at a character that's gone.
 */
export function characterDeleteBlocker(char: RosterCharacter, state: SkidmarksState): string | null {
  const source = characterSource(char, state);
  if (source.kind === "fixed") return source.reason;
  const entry = getCharacterLorasState(state).characters.find((c) => c.sourceKey === char.sourceKey) ?? null;
  if (entry && (entry.status === "making" || entry.status === "training" || entry.status === "finishing")) {
    return `${char.name} is being trained right now. Wait for it to finish, then delete.`;
  }
  const name = char.name;
  // A Sunny Banks line like "Hans:" belongs to the built-in cast member
  // of that name (the line reader only knows the built-in cast), not to
  // an added face, so it doesn't block.
  if (char.group === "sunny-banks" && !isBuiltInSunnyBanksName(name)) {
    const uses = sunnyBanksUses(state, name);
    if (uses.lines > 0) {
      return `${name} is still on ${plural(uses.lines, "script line")} in ${listTitles(uses.titles)}. Change or remove those lines first.`;
    }
  }
  if (source.kind === "cast") {
    const eps = getSkidmarksEpisodesState(state).episodes.filter((e) => e.antiheroId === source.id || e.castIds.includes(source.id));
    if (eps.length > 0) {
      return `${name} is in ${plural(eps.length, "Skidmarks episode")} (${listTitles(eps.map((e) => e.title))}). Take them out of those episodes first.`;
    }
  }
  if (source.kind === "member") {
    const n = countOtherSingerParts(state.session?.scriptSequenceDraft?.script, name);
    if (n > 0) return `The song script still names ${name} as a singer on ${plural(n, "part")}. Change those parts first.`;
  }
  if (char.group === "adult-shorts") {
    const adult = normalizeAdultShortsState(state.adultShorts);
    const slug = slugifyCharacterName(name);
    const inEpisode = (x: Parameters<typeof adultShortStarring>[0]) =>
      slugifyCharacterName(x.character.name) === slug || adultShortStarring(x).some((p) => slugifyCharacterName(p.name) === slug);
    const saved = (adult?.saved ?? []).filter(inEpisode);
    if (saved.length > 0) {
      return `${name} stars in ${plural(saved.length, "Shorts episode")} (${listTitles(saved.map((s) => s.title))}). Delete those episodes first.`;
    }
    if (adult && inEpisode(adult)) {
      return `${name} is starring in the open Shorts episode. Pick someone else under Starring first.`;
    }
  }
  return null;
}

export type CharacterEditResult =
  | { ok: true; /** The roster key afterwards (a Shorts character's key follows its name). */ sourceKey: string; note?: string }
  | { ok: false; error: string };

/** Checks a new name without changing anything. */
export function characterRenameProblem(char: RosterCharacter, nextName: string, state: SkidmarksState): string | null {
  const source = characterSource(char, state);
  if (source.kind === "fixed") return source.reason;
  const name = nextName.replace(/\s+/g, " ").trim();
  if (!name) return "A name can't be blank.";
  if (name.length > CHARACTER_NAME_MAX) return `Keep the name under ${CHARACTER_NAME_MAX} letters.`;
  const minor = minorBlockReason(name);
  if (minor) return minor;
  const slug = slugifyCharacterName(name);
  const clash = buildCharacterRoster(state)[char.group].find(
    (c) => c.sourceKey !== char.sourceKey && slugifyCharacterName(c.name) === slug,
  );
  if (clash) return `There's already a character called ${clash.name} here.`;
  return null;
}

/**
 * Renames one character everywhere its name is kept, and saves it on
 * its own `deck_items` row. Keeps its id, pictures, plates and LoRA.
 */
export function renameRosterCharacter(char: RosterCharacter, nextName: string): CharacterEditResult {
  const state = getSkidmarksSnapshot();
  const name = nextName.replace(/\s+/g, " ").trim();
  if (name === char.name.trim()) return { ok: true, sourceKey: char.sourceKey };
  const problem = characterRenameProblem(char, name, state);
  if (problem) return { ok: false, error: problem };
  const source = characterSource(char, state);
  let nextKey = char.sourceKey;

  switch (source.kind) {
    case "extra":
      patchRosterExtras((st) => ({ ...st, [source.group]: st[source.group].map((x) => (x.id === source.id ? { ...x, name } : x)) }));
      break;
    case "member":
      renameSkidmarksMember(source.bandId, source.memberId, name);
      break;
    case "cast":
      patchSkidmarksEpisodes((st) => ({ ...st, cast: st.cast.map((c) => (c.id === source.id ? { ...c, name } : c)) }));
      break;
    case "short": {
      nextKey = `as:${slugifyCharacterName(name)}`;
      const renameIn = <T extends { character: { name: string }; starring?: { name: string }[] }>(x: T): T => ({
        ...x,
        character: slugifyCharacterName(x.character.name) === source.slug ? { ...x.character, name } : x.character,
        ...(x.starring
          ? { starring: x.starring.map((p) => (slugifyCharacterName(p.name) === source.slug ? { ...p, name } : p)) }
          : {}),
      });
      const oldName = char.name;
      const renameShots = <T extends { shots: { castNames?: string[]; speakerName?: string }[] }>(x: T): T => ({
        ...x,
        shots: x.shots.map((sh) => ({
          ...sh,
          ...(sh.castNames ? { castNames: sh.castNames.map((n) => (sameAdultShortPerson(n, oldName) ? name : n)) } : {}),
          // A talking shot's picked speaker follows the rename too.
          ...(sh.speakerName && sameAdultShortPerson(sh.speakerName, oldName) ? { speakerName: name } : {}),
        })),
      });
      patchAdultShorts((st) => ({
        ...renameShots(renameIn(st)),
        saved: st.saved.map((s) => renameShots(renameIn(s))),
      }));
      break;
    }
    case "card":
    case "fixed":
      break;
  }

  // The character's own row: rename the card, or give them one.
  const cards = getCharacterLorasState().characters;
  const card = cards.find((c) => c.sourceKey === char.sourceKey) ?? null;
  if (card) {
    patchCharacterLoras((s) => ({
      characters: s.characters.map((c) => (c.id === card.id ? { ...c, name, sourceKey: nextKey } : c)),
    }));
  } else {
    const created: CharacterLoraEntry = buildCharacterLoraEntry(
      name,
      cards.map((c) => c.slug),
      new Date(),
      { sourceKey: nextKey, trainingStyle: char.style, subjectWord: char.subjectWord },
    );
    patchCharacterLoras((s) => ({ characters: [...s.characters, created] }));
  }
  flushSkidmarksSessionNow();

  const after = getSkidmarksSnapshot();
  const oldLines =
    char.group === "sunny-banks" && !isBuiltInSunnyBanksName(char.name)
      ? sunnyBanksUses(after, char.name).lines
      : source.kind === "member"
        ? countOtherSingerParts(after.session?.scriptSequenceDraft?.script, char.name)
        : 0;
  return oldLines > 0
    ? {
        ok: true,
        sourceKey: nextKey,
        note: `${plural(oldLines, "script line")} still say "${char.name}:". Change them to "${name}:" if they mean this character.`,
      }
    : { ok: true, sourceKey: nextKey };
}

/**
 * Takes one character off the list: out of its group's list and, if it
 * has a card, a tombstone on its `deck_items` row. Blob files are never
 * deleted. Refused (with the reason) while anything still uses them.
 */
export function deleteRosterCharacter(char: RosterCharacter): CharacterEditResult {
  const state = getSkidmarksSnapshot();
  const blocker = characterDeleteBlocker(char, state);
  if (blocker) return { ok: false, error: blocker };
  const source = characterSource(char, state);
  switch (source.kind) {
    case "extra":
      patchRosterExtras((st) => ({ ...st, [source.group]: st[source.group].filter((x) => x.id !== source.id) }));
      break;
    case "member":
      removeSkidmarksMember(source.bandId, source.memberId);
      break;
    case "cast":
      patchSkidmarksEpisodes((st) => ({ ...st, cast: st.cast.filter((c) => c.id !== source.id) }));
      break;
    default:
      break;
  }
  const card = getCharacterLorasState().characters.find((c) => c.sourceKey === char.sourceKey) ?? null;
  if (card) removeCharacterLora(card.id);
  flushSkidmarksSessionNow();
  return { ok: true, sourceKey: char.sourceKey };
}

/**
 * The voice the panel shows for a character: their card's saved id, or
 * (built-in Sunny Banks regulars only) the voice Deck's cast list gives
 * them. `saved` is true only for a card's own id — the one ✕ removes.
 */
export function characterVoice(
  char: Pick<RosterCharacter, "sourceKey" | "name">,
  entry: Pick<CharacterLoraEntry, "voiceId"> | null,
): { voiceId: string; saved: boolean } | null {
  const saved = entry?.voiceId ? normalizeElevenLabsVoiceId(entry.voiceId) : null;
  if (saved) return { voiceId: saved, saved: true };
  if (char.sourceKey.startsWith("sb:")) {
    const lower = char.name.trim().toLowerCase();
    const builtIn = Object.values(SUNNY_BANKS_CAST).find((c) => c.name.toLowerCase() === lower);
    if (builtIn?.voiceId) return { voiceId: builtIn.voiceId, saved: false };
  }
  return null;
}

/** True when the open panel can save a voice for this character — every
 * genre, built-in Sunny Banks regulars included. */
export function characterCanHaveVoice(char: Pick<RosterCharacter, "sourceKey" | "name">, state: SkidmarksState): boolean {
  if (char.sourceKey.startsWith("sb:")) return true;
  if (getCharacterLorasState(state).characters.some((c) => c.sourceKey === char.sourceKey)) return true;
  return characterSource(char, state).kind !== "fixed";
}

/**
 * Saves (or, with `null`, removes) this character's ElevenLabs voice id
 * on their own card — the same `deck_items` row a rename uses. A
 * character with no card gets one. Nothing else about them changes.
 */
export function setCharacterVoiceId(char: RosterCharacter, raw: string | null): CharacterEditResult {
  const state = getSkidmarksSnapshot();
  if (!characterCanHaveVoice(char, state)) {
    return { ok: false, error: `Couldn't find where ${char.name} is saved, so nothing was changed.` };
  }
  let voiceId: string | null = null;
  if (raw !== null && raw.trim()) {
    voiceId = normalizeElevenLabsVoiceId(raw);
    if (!voiceId) return { ok: false, error: "That doesn't look like an ElevenLabs voice ID (letters and numbers, like 21m00Tcm4TlvDq8ikWAM)." };
  }
  const cards = getCharacterLorasState().characters;
  const card = cards.find((c) => c.sourceKey === char.sourceKey) ?? null;
  if (card) {
    if ((card.voiceId ?? null) === voiceId) return { ok: true, sourceKey: char.sourceKey };
    patchCharacterLoras((s) => ({
      characters: s.characters.map((c) => {
        if (c.id !== card.id) return c;
        const next: CharacterLoraEntry = { ...c };
        if (voiceId) next.voiceId = voiceId;
        else delete next.voiceId;
        return next;
      }),
    }));
  } else {
    if (!voiceId) return { ok: true, sourceKey: char.sourceKey };
    const created: CharacterLoraEntry = {
      ...buildCharacterLoraEntry(char.name, cards.map((c) => c.slug), new Date(), {
        sourceKey: char.sourceKey,
        trainingStyle: char.style,
        subjectWord: char.subjectWord,
      }),
      voiceId,
    };
    patchCharacterLoras((s) => ({ characters: [...s.characters, created] }));
  }
  flushSkidmarksSessionNow();
  return { ok: true, sourceKey: char.sourceKey };
}

/** The profile fields (age, bio, chat personality, AI-generated) show on
 * Shorts characters' open panel (2026-09-30). */
export function characterCanHaveProfile(char: Pick<RosterCharacter, "group" | "sourceKey" | "name">, state: SkidmarksState): boolean {
  return char.group === "adult-shorts" && characterCanHaveVoice(char, state);
}

/** What the open panel shows: the card's saved profile, or the defaults (AI-generated on). */
export function characterProfile(entry: Pick<CharacterLoraEntry, "profile"> | null): CharacterProfile {
  return entry?.profile ?? { aiGenerated: true };
}

/** The profile as typed in the open panel. The age is still text so the problem can be shown. */
export interface CharacterProfileDraft {
  age: string;
  bio: string;
  chatPersonality: string;
  aiGenerated: boolean;
}

/**
 * Saves this character's profile on their own card (the same `deck_items`
 * row as a rename or a voice). A character with no card gets one. An age
 * under 21 is refused with the reason and nothing is saved. The
 * "AI-generated" label is always written.
 */
export function setCharacterProfile(char: RosterCharacter, draft: CharacterProfileDraft): CharacterEditResult {
  const state = getSkidmarksSnapshot();
  if (!characterCanHaveProfile(char, state)) {
    return { ok: false, error: `Couldn't find where ${char.name} is saved, so nothing was changed.` };
  }
  const ageProblem = characterProfileAgeProblem(draft.age);
  if (ageProblem) return { ok: false, error: ageProblem };
  const minor = minorBlockReason(`${draft.bio} ${draft.chatPersonality}`);
  if (minor) return { ok: false, error: "The bio or personality reads as under 18. Describe a grown adult." };
  const profile = normalizeCharacterProfile({
    age: draft.age.trim() ? Number(draft.age.trim()) : undefined,
    bio: draft.bio,
    chatPersonality: draft.chatPersonality,
    aiGenerated: draft.aiGenerated,
  }) as CharacterProfile;
  const cards = getCharacterLorasState().characters;
  const card = cards.find((c) => c.sourceKey === char.sourceKey) ?? null;
  if (card) {
    if (JSON.stringify(card.profile ?? null) === JSON.stringify(profile)) return { ok: true, sourceKey: char.sourceKey };
    patchCharacterLoras((s) => ({ characters: s.characters.map((c) => (c.id === card.id ? { ...c, profile } : c)) }));
  } else {
    const created: CharacterLoraEntry = {
      ...buildCharacterLoraEntry(char.name, cards.map((c) => c.slug), new Date(), {
        sourceKey: char.sourceKey,
        trainingStyle: char.style,
        subjectWord: char.subjectWord,
      }),
      profile,
    };
    patchCharacterLoras((s) => ({ characters: [...s.characters, created] }));
  }
  flushSkidmarksSessionNow();
  return { ok: true, sourceKey: char.sourceKey };
}
