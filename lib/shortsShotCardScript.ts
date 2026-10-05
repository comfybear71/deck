/**
 * Every Shorts episode in the script studio (2026-10-05, Stuart: "I want
 * EVERYTHING in script form, the same UI as Skidmarks and Sunny Banks").
 *
 * The older Shorts episodes (EP01–EP03) were made on shot cards: one card
 * per shot with a prompt, a Line, "In this shot" picks and a Speaker. This
 * turns those shots into the script studio's script, one row per shot, in
 * the same order:
 *
 *     === ACT I — SCENE 1 — hostel_brisbane ===
 *     [Location: hostel_brisbane]
 *     [Character Ava: ]
 *     [Action: Close-up of Ava at the bar…]
 *     Ava: Nice night for it.
 *
 * - a scene heading each time the place changes;
 * - `[Location: key]` above every shot (the episode's own place whose name
 *   the prompt mentions; else the shot before's);
 * - `[Character Name: look]` above a talking shot;
 * - `[Action: the shot's prompt]`;
 * - `Name: line`, or `Name:` for a silent shot of someone on the Cast, or
 *   `Crowd:` for a shot with nobody from the Cast in it.
 *
 * Who a shot is of: the shot's own picks ("In this shot"), else its
 * Speaker, else the Cast names in its prompt ("Close-up of Jack" is
 * Jack). Never the episode's Starring list: that is what made a shot of
 * Jack read "Sam + Kenji, Speaker Sam" on the old cards.
 *
 * Every plate and finished clip stays on its own row (the row's runtime:
 * Done with the same clip, the same plate), so nothing is re-rendered.
 * Pure: nothing is saved here. The shot cards themselves are never
 * changed; they stay as the backup.
 */
import type { AdultShortsShot } from "./adultShorts";
import { buildEmptySunnyBanksLive, type SunnyBanksLiveState, type SunnyBanksRowRuntime } from "./sunnyBanksWorkspace";

/** The one act a converted episode is written into. */
export const SHOT_CARD_SCRIPT_ACT = "I";

export interface ShotCardScriptCastMember {
  name: string;
  look?: string;
}

export interface ShotCardScriptLocation {
  /** The key a `[Location: …]` tag names (the studio's location id). */
  key: string;
  /** Its name on the Locations row. */
  name: string;
}

export interface ShotCardScriptInput {
  /** The episode's name, for the scene heading when it has no places. */
  title: string;
  shots: readonly AdultShortsShot[];
  /** The episode's own Cast cards (the names a `Name:` row can use). */
  cast: readonly ShotCardScriptCastMember[];
  /** The episode's own places. */
  locations: readonly ShotCardScriptLocation[];
  /**
   * The person a shot is of when nothing in the shot names anyone: only
   * for the older one-person episodes (EP01, EP02), whose every shot was
   * of that one person. `null` for an episode with more people.
   */
  onlyCharacter?: string | null;
}

/** How a shot's person was found. */
export type ShotCardCharacterSource = "picks" | "speaker" | "prompt" | "only-character" | "none";

export interface ShotCardCharacter {
  /** The person the row is for, spelled as on their Cast card, or `null` (a `Crowd:` row). */
  name: string | null;
  /** Everyone in the shot by its picks, when that is more than one person. */
  castNames?: string[];
  source: ShotCardCharacterSource;
  /** Why this one deserves a second look, in plain words. */
  doubt?: string;
  /** The prompt named several people and nothing said which one the shot is of. */
  severalNamed?: true;
}

/** What happened to one shot, for the dry run and the report. */
export interface ShotCardRowReport {
  shot: number;
  row: "talking" | "silent" | "crowd";
  character: string | null;
  source: ShotCardCharacterSource;
  locationKey: string | null;
  doubt?: string;
  locationDoubt?: string;
  hasClip: boolean;
  hasPlate: boolean;
}

export interface ShotCardScript {
  script: string;
  /** Row number (0-based, one per shot) → the row's runtime. */
  runtime: Record<number, SunnyBanksRowRuntime>;
  rows: ShotCardRowReport[];
}

function squash(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** A prompt or Line as one script line: no line breaks, and no square
 * brackets that would read as a script tag inside `[Action: …]`. */
function asActionText(text: string): string {
  return squash(text.replace(/\[/g, "(").replace(/\]/g, ")"));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameName(a: string, b: string): boolean {
  return squash(a).toLowerCase() === squash(b).toLowerCase();
}

/** The Cast card spelling of a typed name, else the name as typed. */
function castSpelling(cast: readonly ShotCardScriptCastMember[], name: string): string {
  return cast.find((c) => sameName(c.name, name))?.name ?? squash(name);
}

function nameRegExp(name: string, flags = "i"): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(squash(name))}(?![\\p{L}\\p{N}])`, `${flags}u`);
}

/** Cast names in a prompt, in the order they first appear. */
export function castNamesInPrompt(prompt: string, cast: readonly ShotCardScriptCastMember[]): string[] {
  const hits: Array<{ name: string; at: number }> = [];
  for (const member of cast) {
    if (!squash(member.name)) continue;
    const m = nameRegExp(member.name).exec(prompt);
    if (m) hits.push({ name: member.name, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

/** "Close-up of Jack", "Extreme close-up of Jack's face", "shot of Mia": who the camera is on. */
function framedSubject(prompt: string, names: readonly string[]): string | null {
  const framed = names.filter((name) =>
    new RegExp(
      `(?:close[- ]?up|shot|portrait|framing)\\s+of\\s+(?:the\\s+)?${nameRegExp(name, "").source}`,
      "iu",
    ).test(prompt),
  );
  return framed.length === 1 ? framed[0] : null;
}

/** "No people." / "No people around" / "Nobody." as its own sentence (not "no one visible in the hatch"). */
const NO_PEOPLE_RE = /(?:^|[.!?]\s*)(?:no people|no one|nobody|no person)\b/i;

/**
 * Who one shot is of (see the file comment): picks, else Speaker, else
 * the Cast names in its prompt. Never the episode's Starring.
 */
export function resolveShotCardCharacter(
  shot: Pick<AdultShortsShot, "castNames" | "speakerName" | "nobodyInShot" | "prompt" | "line">,
  cast: readonly ShotCardScriptCastMember[],
  onlyCharacter: string | null = null,
): ShotCardCharacter {
  const talking = squash(shot.line).length > 0;
  const prompt = shot.prompt ?? "";
  const saysNoPeople = NO_PEOPLE_RE.test(prompt);
  const picks = (shot.castNames ?? []).map((n) => squash(n)).filter(Boolean);
  const speaker = squash(shot.speakerName);
  if (shot.nobodyInShot) {
    return talking
      ? { name: null, source: "none", doubt: "Has a Line but was marked Nobody; kept as a Crowd row with the Line in a note above it." }
      : { name: null, source: "none" };
  }
  if (picks.length > 0) {
    const names = picks.map((n) => castSpelling(cast, n));
    const speakerPick = speaker ? names.find((n) => sameName(n, speaker)) : undefined;
    const name = speakerPick ?? names[0];
    const notOnCast = names.filter((n) => !cast.some((c) => sameName(c.name, n)));
    const doubts: string[] = [];
    if (notOnCast.length > 0) doubts.push(`${notOnCast.join(", ")} not on this episode's Cast`);
    if (!talking && saysNoPeople) doubts.push(`picked ${names.join(" + ")}, but the prompt says nobody is in it`);
    return {
      name,
      ...(names.length > 1 ? { castNames: names } : {}),
      source: "picks",
      ...(doubts.length > 0 ? { doubt: `${doubts.join("; ")}.` } : {}),
    };
  }
  if (speaker) {
    const name = castSpelling(cast, speaker);
    const onCast = cast.some((c) => sameName(c.name, name));
    return { name, source: "speaker", ...(onCast ? {} : { doubt: `${name} not on this episode's Cast.` }) };
  }
  const named = castNamesInPrompt(prompt, cast);
  if (named.length === 1) {
    const doubt =
      !talking && saysNoPeople ? `The prompt names ${named[0]} but also says nobody is in it (e.g. a photo or poster).` : undefined;
    return { name: named[0], source: "prompt", ...(doubt ? { doubt } : {}) };
  }
  if (named.length > 1) {
    const subject = framedSubject(prompt, named);
    if (subject) return { name: subject, source: "prompt" };
    return {
      name: named[0],
      source: "prompt",
      doubt: `The prompt names ${named.join(" and ")}; used ${named[0]} (named first).`,
      severalNamed: true,
    };
  }
  // An older one-person episode (EP01, EP02): its shots were all of that
  // one person ("She lifts her head…"), unless the prompt says nobody.
  if (onlyCharacter && squash(onlyCharacter) && !saysNoPeople) {
    return {
      name: castSpelling(cast, onlyCharacter),
      source: "only-character",
      doubt: `Nothing in the shot names anyone; used ${squash(onlyCharacter)}, the episode's one character.`,
    };
  }
  if (talking) {
    return { name: null, source: "none", doubt: "Has a Line but nothing says who; kept as a Crowd row with the Line in a note above it." };
  }
  return { name: null, source: "none" };
}

function locationTokens(loc: ShotCardScriptLocation): string[] {
  const words = `${loc.key} ${loc.name}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  const out = new Set(words);
  // Australian state short forms Stuart uses in place names.
  const LONG: Record<string, string> = {
    qld: "queensland",
    nsw: "new south wales",
    nt: "northern territory",
    wa: "western australia",
    sa: "south australia",
    vic: "victoria",
    tas: "tasmania",
  };
  for (const w of words) if (LONG[w]) out.add(LONG[w]);
  return [...out];
}

/**
 * The episode's place a prompt is at: the one whose key or name words the
 * prompt uses most (a word several places share counts for less). `null`
 * when it names none of them.
 */
export function inferShotLocation(
  prompt: string,
  locations: readonly ShotCardScriptLocation[],
): { key: string | null; tiedWith?: string[] } {
  if (locations.length === 0) return { key: null };
  const tokens = locations.map(locationTokens);
  const share = new Map<string, number>();
  for (const list of tokens) for (const t of list) share.set(t, (share.get(t) ?? 0) + 1);
  const scores = locations.map((loc, i) => ({
    key: loc.key,
    score: tokens[i].reduce((sum, t) => (nameRegExp(t).test(prompt) ? sum + 1 / (share.get(t) ?? 1) : sum), 0),
  }));
  const best = Math.max(...scores.map((s) => s.score));
  if (best <= 0) return { key: null };
  const top = scores.filter((s) => Math.abs(s.score - best) < 1e-9).map((s) => s.key);
  return top.length === 1 ? { key: top[0] } : { key: top[0], tiedWith: top };
}

/** The shot cards as one act of script, with each shot's runtime. */
export function shotCardEpisodeToScript(input: ShotCardScriptInput): ShotCardScript {
  const lines: string[] = [];
  const runtime: Record<number, SunnyBanksRowRuntime> = {};
  const rows: ShotCardRowReport[] = [];
  const locName = (key: string) => input.locations.find((l) => l.key === key)?.name || key;
  // Places first, so the shots before the first named place take the first one named after them.
  const inferred = input.shots.map((shot) => inferShotLocation(shot.prompt ?? "", input.locations));
  const firstNamed = inferred.find((l) => l.key)?.key ?? null;
  let current: string | null = null;
  let scene = 0;
  let headingPlace: string | null | undefined;
  input.shots.forEach((shot, index) => {
    const found = inferred[index];
    let locationDoubt: string | undefined;
    let key = found.key;
    if (found.tiedWith && found.tiedWith.length > 1) {
      // A tie keeps the place the shots were already at, when it's one of them.
      if (current && found.tiedWith.includes(current)) key = current;
      else locationDoubt = `Prompt fits ${found.tiedWith.join(" or ")} equally; used ${key}.`;
    }
    if (!key && input.locations.length > 0) {
      key = current ?? firstNamed;
      if (key) locationDoubt = `Prompt names no place; used ${key} (${current ? "same as the shot before" : "the first place named later"}).`;
    }
    current = key;
    if (headingPlace === undefined || key !== headingPlace) {
      scene += 1;
      headingPlace = key;
      const label = key ? locName(key) : squash(input.title) || "Episode";
      if (lines.length > 0) lines.push("");
      lines.push(`=== ACT ${SHOT_CARD_SCRIPT_ACT} — SCENE ${scene} — ${label} ===`);
    }
    lines.push("");
    if (key) lines.push(`[Location: ${key}]`);
    const who = resolveShotCardCharacter(shot, input.cast, input.onlyCharacter ?? null);
    const spoken = squash(shot.line);
    const talking = spoken.length > 0 && who.name !== null;
    // Who's in the picture. The studio otherwise counts every Cast name in
    // the [Action:] as in the shot ("…looking off at Liam" would add Liam),
    // so a row whose person is known says exactly who with [Cast: …]: the
    // shot's picks, or its one person when the prompt names others too.
    // Only a prompt naming several people with nothing to choose between
    // them is left to the studio (everyone named), and it's flagged.
    const prompt = shot.prompt ?? "";
    const others = who.name ? castNamesInPrompt(prompt, input.cast).filter((n) => !sameName(n, who.name!)) : [];
    const pinned = who.castNames ?? (who.source === "picks" && who.name ? [who.name] : null) ?? (who.name && others.length > 0 && !who.severalNamed ? [who.name] : null);
    if (pinned) lines.push(`[Cast: ${pinned.join(", ")}]`);
    const inPicture = pinned ?? (who.name ? [who.name, ...others] : []);
    if (talking && who.name) {
      const look = squash(input.cast.find((c) => sameName(c.name, who.name!))?.look);
      lines.push(`[Character ${who.name}: ${look}]`);
    }
    const action = asActionText(prompt);
    if (action) lines.push(`[Action: ${action}]`);
    if (spoken && !who.name) lines.push(`# Line (nobody named): ${spoken}`);
    const speakerLine = who.name ? (talking ? `${who.name}: ${spoken}` : `${who.name}:`) : "Crowd:";
    lines.push(speakerLine);

    const clip = squash(shot.clipUrl);
    const plate = squash(shot.plateUrl);
    const hasClip = /^https:\/\//i.test(clip);
    const hasPlate = /^https:\/\//i.test(plate);
    const characterName = who.name ?? "Crowd";
    const row: SunnyBanksRowRuntime = {
      lineKey: speakerLine,
      status: hasClip ? "done" : "idle",
      characterName,
      line: talking ? spoken : "",
    };
    if (hasClip) {
      row.videoUrl = clip;
      if (typeof shot.durationSec === "number" && Number.isFinite(shot.durationSec)) row.durationSec = shot.durationSec;
      // Shot cards: a talking shot was lip-synced on LTX, every other one was Siray.
      row.videoBackend = talking ? "ltx" : "siray";
    } else if (shot.sirayTaskId && /^[A-Za-z0-9_.:-]{1,128}$/.test(shot.sirayTaskId)) {
      row.sirayTaskId = shot.sirayTaskId;
    }
    if (hasPlate) {
      row.plateUrl = plate;
      // The plate is only reused for the same people (see the studio's plate rules).
      if (inPicture.length > 0) row.castNames = inPicture;
    }
    runtime[index] = row;
    rows.push({
      shot: index + 1,
      row: !who.name ? "crowd" : talking ? "talking" : "silent",
      character: who.name,
      source: who.source,
      locationKey: key,
      ...(who.doubt ? { doubt: who.doubt } : {}),
      ...(locationDoubt ? { locationDoubt } : {}),
      hasClip,
      hasPlate,
    });
  });
  return { script: lines.join("\n"), runtime, rows };
}

/** Just the finished clips as Done rows (one per shot), for the episode card's "1 act · N clips". */
export function shotCardClipRuntimes(shots: readonly Pick<AdultShortsShot, "clipUrl">[]): Record<number, SunnyBanksRowRuntime> {
  const out: Record<number, SunnyBanksRowRuntime> = {};
  shots.forEach((shot, i) => {
    const url = squash(shot.clipUrl);
    if (/^https:\/\//i.test(url)) out[i] = { lineKey: `shot-${i + 1}`, status: "done", videoUrl: url };
  });
  return out;
}

/**
 * The script studio's live episode for a shot-card episode: the converted
 * script in Act I, every plate and clip on its row, the episode's folder
 * (`mediaSlug`) so new clips land beside the old ones. No `episodeId`:
 * it isn't a script card until Stuart changes something in it.
 */
export function shotCardEpisodeToStudioLive(
  input: ShotCardScriptInput & { label: string; mediaSlug?: string | null },
): SunnyBanksLiveState {
  const converted = shotCardEpisodeToScript(input);
  const empty = buildEmptySunnyBanksLive("shorts");
  const firstKey = converted.rows.find((r) => r.locationKey)?.locationKey ?? empty.defaultLocationId;
  const live: SunnyBanksLiveState = {
    ...empty,
    workspaceTitle: squash(input.label),
    defaultLocationId: firstKey,
    actIds: [SHOT_CARD_SCRIPT_ACT],
    activeAct: SHOT_CARD_SCRIPT_ACT,
    actScripts: { [SHOT_CARD_SCRIPT_ACT]: converted.script },
    characterOverrides: { [SHOT_CARD_SCRIPT_ACT]: {} },
    locationOverrides: { [SHOT_CARD_SCRIPT_ACT]: {} },
    runtimeMap: { [SHOT_CARD_SCRIPT_ACT]: converted.runtime },
  };
  delete live.episodeId;
  if (input.mediaSlug) live.mediaSlug = input.mediaSlug;
  else delete live.mediaSlug;
  return live;
}
