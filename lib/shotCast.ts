/**
 * Who is in one shot (2026-10-03, Stuart's multi-cast spec). ONE pure
 * helper, used by every genre (Sunnybank, Music video, Shorts), so a
 * shot can lock 1–4 Cast characters to their own Cast card pictures,
 * silent or talking, the same way everywhere.
 *
 * `resolveShotCast` picks, in this order, deduped and capped at four:
 *   1. an explicit list: a `[Cast: A, B]` tag, or the Shorts "In this
 *      shot" picker (`castNames`). An explicit list is EXACT: nobody
 *      else is added, apart from the speaker/primary (who has to be in
 *      frame to lip-sync). It's the way to say "just these people".
 *   2. the speaker (talking) or primary (silent row / the vocalist);
 *   3. any `[Character X: …]` tag naming another Cast card;
 *   4. whole-word Cast-name matches in the shot's own text (`[Action: …]`,
 *      the shot prompt);
 *   5. the speakers of the other lines in the same scene.
 *
 * Name matching is case-insensitive and ignores spaces and punctuation
 * ("STUIE" is the Cast card "Stuie", "ranger bazza" is "Ranger Bazza"),
 * the same way the Shorts Cast row already matches names. Text matches
 * are whole words only ("Nan" never matches "banana").
 *
 * Deliberately NOT a source: names inside the spoken words. EP02 Act I
 * has Ranger Bazza saying "Let's go and catch up with shazza"; a line
 * about someone doesn't put them in the frame, and counting it would
 * change rows that render one person today.
 *
 * Only the main Cast card picture is used (`picture`). A picked person
 * with no picture is listed in `missingPicture`, and every caller
 * refuses to bill the shot until it's added (same rule as
 * `missing_cast_picture`).
 *
 * One person in the result = the shot behaves exactly as before; every
 * caller only switches to its multi-person path when `isMulti`.
 */

/** Most people one shot can lock. One location + four people = five images, xAI's documented edit cap. */
export const MAX_SHOT_CAST = 4;

/** Most images one xAI `/v1/images/edits` call takes (docs.x.ai "Multi-Image Editing", checked 2026-10-03: five). */
export const XAI_EDIT_MAX_IMAGES = 5;

export interface ShotCastCard {
  /** The Cast card's own name, as Deck shows it. */
  name: string;
  /** The Cast card's main picture, or null when it has none yet. */
  picture: string | null;
}

export type ShotCastSource = "explicit" | "primary" | "character-tag" | "shot-text" | "scene-speaker";

export interface ShotCastMember {
  /** The Cast card's own name (never the script's spelling). */
  name: string;
  picture: string | null;
  source: ShotCastSource;
}

export interface ShotCastInput {
  /** Every Cast card this genre can use. */
  cards: readonly ShotCastCard[];
  /** `[Cast: A, B]` or the Shorts picker. Empty/absent = no explicit list. */
  explicit?: readonly string[] | null;
  /** The speaker (talking row), the silent row's character, or the vocalist. */
  primary?: string | null;
  /** Names from `[Character X: …]` tags on this shot. */
  characterTags?: readonly string[];
  /** The shot's own text: `[Action: …]`, the shot prompt. */
  shotText?: readonly (string | null | undefined)[];
  /** Speakers of the other lines in the same scene. */
  sceneSpeakers?: readonly string[];
  /** Defaults to `MAX_SHOT_CAST`. */
  max?: number;
}

export interface ShotCast {
  members: ShotCastMember[];
  names: string[];
  /** Picked people whose Cast card has no main picture. */
  missingPicture: string[];
  /** Picked past the cap (left out). */
  dropped: string[];
  /** More than one person: the multi-person path. */
  isMulti: boolean;
}

/** "STUIE" = "Stuie" = "stuie", "Ranger Bazza" = "ranger-bazza". */
export function shotCastNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function sameShotCastName(a: string, b: string): boolean {
  const ka = shotCastNameKey(a);
  return ka.length > 0 && ka === shotCastNameKey(b);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole-word, case-insensitive matcher for one name ("Ranger  Bazza" across any spacing). */
function nameRegExp(name: string): RegExp | null {
  const words = name.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * Cast card names said in a piece of text, whole words only, in the order
 * they first appear. A longer name wins over a shorter one inside it
 * ("Ranger Bazza" over a card called "Bazza").
 */
export function findCastNameMentions(text: string, cards: readonly Pick<ShotCastCard, "name">[]): string[] {
  if (!text.trim()) return [];
  const taken: Array<[number, number]> = [];
  const hits: Array<{ index: number; name: string }> = [];
  const byLength = [...cards].filter((c) => c.name.trim()).sort((a, b) => b.name.length - a.name.length);
  for (const card of byLength) {
    const re = nameRegExp(card.name);
    if (!re) continue;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      hits.push({ index: start, name: card.name });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  const out: string[] = [];
  for (const hit of hits) if (!out.some((n) => sameShotCastName(n, hit.name))) out.push(hit.name);
  return out;
}

/** `[Cast: STUIE, Bloom & Nan]` → ["STUIE", "Bloom", "Nan"]. Commas, "&", "+" or " and ". */
export function parseCastTagNames(inner: string): string[] {
  return inner
    .split(/\s*(?:,|&|\+|;|\band\b)\s*/i)
    .map((n) => n.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The shared answer to "who is in this shot?" for every genre. See the module comment for the order. */
export function resolveShotCast(input: ShotCastInput): ShotCast {
  const max = Math.max(1, Math.min(MAX_SHOT_CAST, input.max ?? MAX_SHOT_CAST));
  const cardFor = (name: string | null | undefined) =>
    name && name.trim() ? input.cards.find((c) => sameShotCastName(c.name, name)) : undefined;

  const picked: ShotCastMember[] = [];
  const dropped: string[] = [];
  const add = (name: string | null | undefined, source: ShotCastSource) => {
    const card = cardFor(name);
    if (!card) return;
    if (picked.some((m) => sameShotCastName(m.name, card.name)) || dropped.some((n) => sameShotCastName(n, card.name))) return;
    if (picked.length >= max) {
      dropped.push(card.name);
      return;
    }
    picked.push({ name: card.name, picture: card.picture && card.picture.trim() ? card.picture : null, source });
  };

  const explicit = (input.explicit ?? []).filter((n) => cardFor(n));
  if (explicit.length > 0) {
    for (const name of explicit) add(name, "explicit");
    add(input.primary, "primary");
  } else {
    add(input.primary, "primary");
    for (const name of input.characterTags ?? []) add(name, "character-tag");
    for (const text of input.shotText ?? []) {
      if (typeof text !== "string") continue;
      for (const name of findCastNameMentions(text, input.cards)) add(name, "shot-text");
    }
    for (const name of input.sceneSpeakers ?? []) add(name, "scene-speaker");
  }

  // The primary always leads (an explicit list may name them second).
  const primaryCard = cardFor(input.primary);
  if (primaryCard) {
    const at = picked.findIndex((m) => sameShotCastName(m.name, primaryCard.name));
    if (at > 0) picked.unshift(...picked.splice(at, 1));
  }

  return {
    members: picked,
    names: picked.map((m) => m.name),
    missingPicture: picked.filter((m) => !m.picture).map((m) => m.name),
    dropped,
    isMulti: picked.length > 1,
  };
}

/** The chips text: "STUIE + BLOOM". */
export function formatShotCastNames(names: readonly string[]): string {
  return names.join(" + ");
}

/* ------------------------------------------------------------------ */
/* Where each person stands, and the shared prompt pieces.             */
/* ------------------------------------------------------------------ */

export interface ShotCastPerson {
  name: string;
  /** Their locked look (one line). */
  look?: string;
  /** "on the right", "front left", "foreground"… empty = not said. */
  position?: string;
}

const POSITION_RE =
  /\b((?:front|back|far|rear)[\s-]+(?:left|right)|(?:on\s+the\s+|to\s+the\s+|at\s+the\s+)?(?:far\s+)?(?:left|right)(?:\s+of\s+(?:frame|the\s+frame|centre|center))?|(?:in\s+the\s+)?(?:foreground|background|middle\s+distance)|(?:in\s+the\s+)?(?:centre|center|middle)(?:\s+of\s+(?:frame|the\s+frame))?|(?:nearest|closest)\s+(?:to\s+)?(?:the\s+)?camera)\b/i;

/**
 * The part of one clause about one person: from their name up to the next
 * other person's name ("STUIE, on the right, talks to BLOOM" → "STUIE, on
 * the right, talks to "). Empty when the clause doesn't name them.
 */
function clausePartAbout(clause: string, name: string, otherNames: readonly string[]): string {
  const re = nameRegExp(name);
  if (!re) return "";
  const match = re.exec(clause);
  if (!match) return "";
  const start = match.index;
  let end = clause.length;
  for (const other of otherNames) {
    const ore = nameRegExp(other);
    if (!ore) continue;
    let m: RegExpExecArray | null;
    while ((m = ore.exec(clause)) !== null) {
      if (m.index > start && m.index < end) end = m.index;
    }
  }
  return clause.slice(start, end);
}

/** The first place-in-frame phrase in a piece of text, as written. */
export function findPositionPhrase(text: string): string {
  const match = text.match(POSITION_RE);
  return match ? match[1].replace(/\s+/g, " ").trim().toLowerCase() : "";
}

const DEFAULT_SLOTS: Record<number, string[]> = {
  2: ["on the left", "on the right"],
  3: ["on the left", "in the centre", "on the right"],
  4: ["far left", "left of centre", "right of centre", "far right"],
};

/**
 * Where each person is in the frame. Their own shot look ("…, foreground")
 * first, then the clause of the shot text that names them ("BLOOM, the
 * man-bun guy front left, folds his arms; STUIE, on the right, …"). If
 * nobody's place is written anywhere, people go left to right in cast
 * order. If only some are written, the rest get none, so the picture
 * never contradicts the script.
 */
export function resolveShotCastPositions(
  people: readonly { name: string; shotLook?: string }[],
  shotText: readonly (string | null | undefined)[],
  /** `false` = only places the text names (a picture that's already made). */
  opts: { defaults?: boolean } = {},
): string[] {
  const clauses = shotText
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .flatMap((t) => t.split(/[;.!?\n]+/))
    .map((c) => c.trim())
    .filter(Boolean);
  const others = (name: string) => people.map((q) => q.name).filter((n) => !sameShotCastName(n, name));
  const written = people.map((p) => {
    const own = p.shotLook ? findPositionPhrase(p.shotLook) : "";
    if (own) return own;
    for (const clause of clauses) {
      const part = clausePartAbout(clause, p.name, others(p.name));
      if (!part) continue;
      const phrase = findPositionPhrase(part);
      if (phrase) return phrase;
    }
    return "";
  });
  if (people.length < 2 || opts.defaults === false) return written;
  if (written.some(Boolean)) return written;
  const slots = DEFAULT_SLOTS[people.length] ?? [];
  return people.map((_, i) => slots[i] ?? "");
}

function personBits(p: ShotCastPerson): string {
  return [p.name.trim(), p.look?.trim(), p.position?.trim()].filter(Boolean).join(", ");
}

/** "STUIE, thin bloke, on the right," — or just "STUIE" when there's no look or place (no stray comma). */
function personSubject(p: ShotCastPerson): string {
  const bits = personBits(p);
  return bits === p.name.trim() ? bits : `${bits},`;
}

/**
 * LTX talking line with more than one person in frame (2026-10-03,
 * Stuart's wording, word for word): the speaker is the only one talking,
 * everyone else listens with their mouth closed. LTX runs at cfg 1, where
 * the negative prompt does nothing, so "mouth closed" lives here.
 */
export function buildSpeakerListenerText(speaker: ShotCastPerson, listeners: readonly ShotCastPerson[]): string {
  const lines = [
    `${personSubject(speaker)} is the only one speaking, mouth and jaw in clear sync with the audio.`,
    ...listeners.map((p) => `${personSubject(p)} listens silently, lips pressed together, mouth closed the whole clip.`),
  ];
  return lines.join(" ");
}

/** A silent shot with more than one person: everyone animates, nobody talks. */
export const SHOT_CAST_SILENT_LINE =
  "Everyone in frame animates naturally (breathing, weight shifts, small gestures, reacting to each other), and every mouth stays closed the whole clip. Nobody speaks.";

/** "Exactly 2 people in frame: STUIE and BLOOM. No one else." */
export function exactlyPeopleLine(names: readonly string[]): string {
  const list =
    names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Exactly ${names.length} people in frame: ${list}. No one else, no passer-by, no extra body in the distance.`;
}

/**
 * One label line per person's picture: "Image 2 is STUIE, on the right —
 * same face identity, hair, age and body as in image 2." `firstImage` is
 * the 1-based number of the first person's picture (2 when image 1 is
 * the place).
 */
export function castImageLabelLines(people: readonly ShotCastPerson[], firstImage: number): string[] {
  return people.map((p, i) => {
    const n = firstImage + i;
    const where = p.position?.trim() ? `, ${p.position.trim()}` : "";
    return (
      `Image ${n} (<IMAGE_${n - 1}>) is ${p.name}${where} — same face identity, hair, age, body and clothes as in image ${n}. ` +
      `Do not turn ${p.name} into a different person.`
    );
  });
}

/** Every person stays themselves. */
export const SHOT_CAST_KEEP_APART_LINE =
  "Place each person from their own picture into image 1. Each keeps their own face, hair, clothes and body from their own picture only. Never swap faces between them, never merge two people into one, never copy one person twice.";

/** Composite plates for any shot (talking or silent): nobody is caught mid-word on frame 0. */
export const SHOT_CAST_MOUTHS_CLOSED_LINE = "All mouths closed.";

/**
 * Who the camera favours. A talking shot with one speaker in the scene:
 * the speaker is nearer the camera and larger, everyone else turned
 * toward them. A shared plate for a scene where several people talk
 * (the two-hander): every speaker's face stays clearly visible, nobody
 * favoured, because the same picture is used for each of their lines.
 * Silent shots: placement follows the shot text only.
 */
export function castFramingLine(args: { speaker?: string | null; sceneSpeakers?: readonly string[] }): string {
  const speakers = (args.sceneSpeakers ?? []).filter((n, i, all) => all.findIndex((m) => sameShotCastName(m, n)) === i);
  if (speakers.length > 1) {
    const list = `${speakers.slice(0, -1).join(", ")} and ${speakers[speakers.length - 1]}`;
    return `${list} all talk in this scene: each of their faces is clearly visible to the camera, three-quarter view, turned slightly toward each other. Nobody is hidden behind anyone.`;
  }
  if (args.speaker && args.speaker.trim()) {
    const s = args.speaker.trim();
    return `Unless the shot text says otherwise, ${s} is the one talking: nearer the camera and larger in frame, face clearly visible; everyone else is turned toward ${s}.`;
  }
  return "Where each person stands follows the shot text; everyone stays clearly in frame.";
}
