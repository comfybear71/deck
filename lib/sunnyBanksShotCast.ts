/**
 * Sunnybank multi-cast shots (2026-10-03, Stuart's spec): one shot can
 * lock 1–4 Cast characters to their own Cast card pictures, silent or
 * talking. Who's in the shot comes from the shared `resolveShotCast`
 * (lib/shotCast.ts), the same helper Music video and Shorts use.
 *
 * - Client: `resolveSunnyBanksRowCast` turns a queue row into the cast
 *   the route gets (`cast: [...]`), only when there are two or more
 *   people. One person = the request is exactly what it was before.
 * - Server: `parseSunnyBanksShotCast` reads that field back;
 *   `buildSunnyBanksMultiCastPlatePrompt` is the N-person xAI picture
 *   prompt; `buildSunnyBanksSpeakerListenerSuffix` and
 *   `buildSunnyBanksMultiCastHoldSuffix` are appended after the gold
 *   Speak/Hold strings (never rewriting them).
 *
 * The one-person compositing prompt (`buildSunnyBanksCompositePlatePrompt`)
 * is untouched.
 *
 * Pure: no fetch, no fs. Safe in the panel and in the route.
 */

import { isAllowedTrainingImageUrl } from "./characterLoras";
import {
  buildSpeakerListenerText,
  castFramingLine,
  castImageLabelLines,
  exactlyPeopleLine,
  MAX_SHOT_CAST,
  resolveShotCast,
  resolveShotCastPositions,
  sameShotCastName,
  SHOT_CAST_KEEP_APART_LINE,
  SHOT_CAST_MOUTHS_CLOSED_LINE,
  SHOT_CAST_SILENT_LINE,
  type ShotCast,
} from "./shotCast";
import { SUNNY_BANKS_LOOK, type StudioLook, type SunnyBanksLocationLock } from "./sunnyBanks";
import { SUNNY_BANKS_PICTURE_LOOK, type SunnyBanksCastCard } from "./sunnyBanksVoices";

/** One person in a multi-cast shot, as the panel sends it. */
export interface SunnyBanksShotCastMember {
  /** The Cast card's own name. */
  name: string;
  /** Their locked look. */
  look: string;
  /** Their Cast card main picture (Deck's Blob only). */
  pictureUrl?: string;
  /** Where they are in frame ("on the right"), when the script says or by default. */
  position?: string;
  /** This shot's look for them (`[Character Name: …]`). */
  shotLook?: string;
}

/** What the panel knows about one queue row, for its cast. */
export interface SunnyBanksRowCastInput {
  kind: "speak" | "hold";
  /** The row's character (after the row's dropdown). */
  characterName: string;
  /** A `Crowd:`-style location cutaway: never any cast. */
  cutaway: boolean;
  /** This row's own `[Action: …]`. */
  action?: string;
  /** The scene's `[Action: …]` (a later line of a two-hander). */
  sceneAction?: string;
  /** `[Cast: A, B]` on this row or its scene. */
  castNames?: readonly string[];
  /** `[Character Other: …]` looks for other Cast cards. */
  castLooks?: readonly { name: string; look: string }[];
  /** Everyone who has a line in the same scene. */
  sceneSpeakers?: readonly string[];
  /** The speaker's own `[Character Name: …]` look. */
  appearanceModifier?: string;
}

export interface SunnyBanksRowCast {
  cast: ShotCast;
  /** Filled only when `cast.isMulti`: what the route gets. */
  people: SunnyBanksShotCastMember[];
  /** The scene's speakers who are in the shot (for framing). */
  sceneSpeakers: string[];
}

const EMPTY_CAST: ShotCast = { members: [], names: [], missingPicture: [], dropped: [], isMulti: false };

/** Who is in one Sunnybank row, with each person's look and place in frame. */
export function resolveSunnyBanksRowCast(row: SunnyBanksRowCastInput, cards: readonly SunnyBanksCastCard[]): SunnyBanksRowCast {
  if (row.cutaway || !row.characterName.trim()) return { cast: EMPTY_CAST, people: [], sceneSpeakers: [] };
  const shotText = row.action?.trim() || row.sceneAction?.trim() || "";
  const cast = resolveShotCast({
    cards,
    explicit: row.castNames,
    primary: row.characterName,
    characterTags: (row.castLooks ?? []).map((l) => l.name),
    shotText: [shotText],
    sceneSpeakers: row.sceneSpeakers,
    max: MAX_SHOT_CAST,
  });
  const sceneSpeakers = (row.sceneSpeakers ?? [])
    .map((n) => cast.names.find((c) => sameShotCastName(c, n)))
    .filter((n, i, all): n is string => Boolean(n) && all.indexOf(n) === i);
  if (!cast.isMulti) return { cast, people: [], sceneSpeakers };
  const shotLookFor = (name: string, index: number) => {
    if (index === 0) return row.appearanceModifier?.trim() || "";
    return (row.castLooks ?? []).find((l) => sameShotCastName(l.name, name))?.look.trim() ?? "";
  };
  const base = cast.members.map((m, i) => ({ name: m.name, shotLook: shotLookFor(m.name, i) }));
  const positions = resolveShotCastPositions(base, [shotText]);
  const people = cast.members.map((m, i) => {
    const card = cards.find((c) => sameShotCastName(c.name, m.name));
    const person: SunnyBanksShotCastMember = { name: m.name, look: card?.look ?? "" };
    if (m.picture) person.pictureUrl = m.picture;
    if (positions[i]) person.position = positions[i];
    if (base[i].shotLook) person.shotLook = base[i].shotLook;
    return person;
  });
  return { cast, people, sceneSpeakers };
}

/**
 * The extra request fields for one row (2026-10-03). A one-person row on
 * an ordinary location gets `{}`, so its request is byte for byte what
 * it was before this change.
 */
export function sunnyBanksMultiCastRequest(args: {
  people: readonly SunnyBanksShotCastMember[];
  sceneAction?: string;
  sceneSpeakers?: readonly string[];
  scenePlateUrl?: string;
  plateTarget?: { folder: string; name: string } | null;
  locationHasPeople?: boolean;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (args.locationHasPeople) out.locationHasPeople = true;
  if (args.people.length < 2) return out;
  out.cast = args.people.map((p) => ({ ...p }));
  if (args.sceneAction?.trim()) out.sceneAction = args.sceneAction.trim();
  if (args.sceneSpeakers && args.sceneSpeakers.length > 0) out.sceneSpeakers = [...args.sceneSpeakers];
  if (args.scenePlateUrl) out.scenePlateUrl = args.scenePlateUrl;
  if (args.plateTarget) out.plateTarget = args.plateTarget;
  return out;
}

/* ---- Server side ---- */

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function blobPicture(value: unknown): string | undefined {
  const u = typeof value === "string" ? value.trim() : "";
  return u && /^https:\/\//i.test(u) && isAllowedTrainingImageUrl(u) ? u : undefined;
}

/**
 * The `cast` field, cleaned: Cast card names, looks, Blob-only pictures,
 * at most four people, the row's own character first. Fewer than two
 * people (or a list that doesn't include the row's character) = `null`,
 * and the route renders the one-person shot exactly as before.
 */
export function parseSunnyBanksShotCast(value: unknown, characterName: string): SunnyBanksShotCastMember[] | null {
  if (!Array.isArray(value)) return null;
  const out: SunnyBanksShotCastMember[] = [];
  for (const raw of value.slice(0, MAX_SHOT_CAST * 2)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const name = cleanText(v.name, 60);
    if (!name || out.some((m) => sameShotCastName(m.name, name))) continue;
    // "as in their picture" (a card with no written look) says nothing
    // the picture doesn't: left out of the multi-cast text (EP05 Act V).
    const look = cleanText(v.look, 600);
    const member: SunnyBanksShotCastMember = { name, look: look.toLowerCase() === SUNNY_BANKS_PICTURE_LOOK ? "" : look };
    const picture = blobPicture(v.pictureUrl);
    if (picture) member.pictureUrl = picture;
    const position = cleanText(v.position, 60);
    if (position) member.position = position;
    const shotLook = cleanText(v.shotLook, 600);
    if (shotLook) member.shotLook = shotLook;
    out.push(member);
    if (out.length >= MAX_SHOT_CAST) break;
  }
  const at = out.findIndex((m) => sameShotCastName(m.name, characterName));
  if (at < 0 || out.length < 2) return null;
  if (at > 0) out.unshift(...out.splice(at, 1));
  return out;
}

/** A Deck Blob picture URL or nothing (the shared plate a scene's first line made). */
export function parseSunnyBanksPlateUrl(value: unknown): string | null {
  return blobPicture(value) ?? null;
}

/** The scene's speakers (names only, at most four). */
export function parseSunnyBanksSceneSpeakers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const name = cleanText(raw, 60);
    if (name && !out.some((n) => sameShotCastName(n, name))) out.push(name);
    if (out.length >= MAX_SHOT_CAST) break;
  }
  return out;
}

/**
 * The xAI edits prompt for a shot with 2–4 people (2026-10-03). Image 1
 * is the place, images 2… are each person's Cast card picture in cast
 * order. Says exactly how many people, labels every picture with its
 * name and place, keeps faces apart, and closes every mouth (a talking
 * row's lips are LTX's job, from a closed start).
 *
 * `speaker` is set on a talking row; `sceneSpeakers` lists everyone who
 * talks on this shared picture (a two-hander keeps both faces visible).
 */
export function buildSunnyBanksMultiCastPlatePrompt(args: {
  people: readonly SunnyBanksShotCastMember[];
  location: SunnyBanksLocationLock;
  speaker?: string | null;
  sceneSpeakers?: readonly string[];
  shotAction?: string;
  /** The show's look (Sunny Banks unless said). */
  look?: StudioLook;
}): string {
  const look = args.look ?? SUNNY_BANKS_LOOK;
  const names = args.people.map((p) => p.name);
  const action = args.shotAction?.replace(/\s+/g, " ").trim() || "";
  const anyShotLook = args.people.some((p) => p.shotLook);
  const propLine =
    action || anyShotLook
      ? "Held objects: only what this shot's text below names. Do not copy any object from the pictures that the text doesn't name. Do not invent anything beyond what it names."
      : "Held objects: only what each person's own picture already shows in their hands; empty hands stay empty. Do not invent a phone or extra objects.";
  const staging = args.people
    .map((p) => [p.name, p.look, p.position].map((s) => s?.trim()).filter(Boolean).join(", "))
    .join("; ");
  const lines = [
    look.styleLock,
    `Image 1 (<IMAGE_0>) is the LOCKED background — keep that exact place, lighting and materials. Do not move the camera. ${look.keepPlaceLine} Remove any people or crowds already in image 1 — empty place only, then add only the people below.`,
    exactlyPeopleLine(names),
    ...castImageLabelLines(args.people, 2),
    SHOT_CAST_KEEP_APART_LINE,
    `${castFramingLine({ speaker: args.speaker, sceneSpeakers: args.sceneSpeakers })} Keep the locked place from image 1 behind them.`,
    `Staging: ${staging}, at ${args.location.label}.`,
    propLine,
    `${SHOT_CAST_MOUTHS_CLOSED_LINE} Every person's lips are pressed together; nobody is caught mid-word.`,
    "No captions, no watermarks, no name tags. Keep any signage that is already part of the locked place in image 1.",
  ];
  if (action) lines.push(`This shot: ${action}.`);
  for (const p of args.people) {
    if (p.shotLook) lines.push(`Shot-specific look for ${p.name}, this render only: ${p.shotLook}.`);
  }
  return lines.join("\n\n");
}

function personForText(p: SunnyBanksShotCastMember): { name: string; look?: string; position?: string } {
  return { name: p.name, look: p.look || undefined, position: p.position };
}

/**
 * Appended to the gold Speak prompt on an LTX talking row with others in
 * frame (Stuart's wording, the Shorts copy): the speaker is the only one
 * talking, everyone else listens with their mouth closed. LTX runs at
 * cfg 1, so this is positive text only, never a negative prompt.
 */
export function buildSunnyBanksSpeakerListenerSuffix(people: readonly SunnyBanksShotCastMember[], speaker: string): string {
  const s = people.find((p) => sameShotCastName(p.name, speaker)) ?? people[0];
  const listeners = people.filter((p) => p !== s);
  return buildSpeakerListenerText(personForText(s), listeners.map(personForText));
}

/** Appended to the gold Hold prompt on a silent row with others in frame. */
export function buildSunnyBanksMultiCastHoldSuffix(people: readonly SunnyBanksShotCastMember[]): string {
  const others = people.slice(1).map((p) => [p.name, p.look, p.position].map((s) => s?.trim()).filter(Boolean).join(", "));
  return [
    `Also in frame: ${others.join("; ")}.`,
    exactlyPeopleLine(people.map((p) => p.name)),
    SHOT_CAST_SILENT_LINE,
  ].join(" ");
}
