/**
 * Skidmarks old-episode import (2026-09-27). Turns the episodes saved in
 * the old Skidmarks app (Crash Lab, `skidmarks.aiglitch.app`) into Deck's
 * nine-beat episodes. Pure mapping only; the fetch is a read-only GET in
 * `app/api/skidmarks/legacy-episodes/route.ts`. Nothing is ever written
 * back to the old app, and nothing here spends money.
 *
 * Old episodes are a list of shots (title, summary, plate, speaker lines).
 * Shots are spread across beats 1..9 in their original order; the old
 * intro/outro narration goes into the intro/outro. Ids are deterministic
 * (`ep_legacy_*`, `cast_legacy_*`) so re-importing never duplicates.
 *
 * Cast rule: Stuart confirmed on 2026-09-27 that the whole old cast is made
 * up and adult. Two names implied a minor or an unclear age, so they are
 * renamed on import (see LEGACY_CAST_OVERRIDES).
 */

import {
  buildStarterBeats,
  SKIDMARKS_BEATS,
  type SkidmarksBeatId,
  type SkidmarksCastMember,
  type SkidmarksEpisode,
  type SkidmarksEpisodesState,
} from "@/lib/skidmarksEpisodes";

export interface LegacyBeatLine {
  text?: string;
  speaker?: string;
}
export interface LegacyShot {
  title?: string;
  summary?: string;
  plateFile?: string;
  sfx?: unknown[];
  beats?: LegacyBeatLine[];
}
export interface LegacyScene {
  title?: string;
  placeName?: string;
  shots?: LegacyShot[];
}
export interface LegacyBookend {
  title?: string;
  notes?: string;
  sfx?: unknown[];
}
export interface LegacyStory {
  intro?: LegacyBookend;
  outro?: LegacyBookend;
  scenes?: LegacyScene[];
  gagNote?: string;
  campaignLabel?: string;
}
export interface LegacyEpisodeSource {
  folderName: string;
  label?: string;
  savedAt?: string;
  story: LegacyStory | null;
}

/** Names changed on import so every character is clearly an adult. */
export const LEGACY_CAST_OVERRIDES: Record<string, { name: string; look: string }> = {
  "brittany year11": { name: "Brittany", look: "Year 11 teacher, thirties, school lanyard" },
  "young declan": { name: "Declan", look: "twenties, hi-vis apprentice" },
  // Old prompt already says mid-20s; the look makes that explicit.
  "young fiancée": { name: "Young Fiancée", look: "mid-20s" },
};

/** Short words ignored when matching a speaker's name to the folder name. */
const NAME_STOPWORDS = new Set(["the", "and", "from", "for", "with", "too", "mr", "mrs"]);

/** Speakers that are not characters. */
const NON_CHARACTER_SPEAKERS = new Set(["", "?", "narrator", "voiceover", "vo"]);

export const LEGACY_PLATE_URL_BASE = "https://skidmarks.aiglitch.app/api/crash/gen/file?name=";

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** "EP03_KIM_THE_KUNT" to "EP03 KIM THE KUNT"; drops the old app's "51_esc" suffix. */
export function legacyEpisodeTitle(src: LegacyEpisodeSource): string {
  const raw = clean(src.story?.campaignLabel) || clean(src.label) || src.folderName;
  return raw.replace(/\s\d+_[a-z0-9]{3}$/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim() || src.folderName;
}

export function legacyCastName(speaker: string): { name: string; look: string } {
  const key = clean(speaker).toLowerCase();
  const override = LEGACY_CAST_OVERRIDES[key];
  if (override) return override;
  return { name: clean(speaker), look: "" };
}

function allShots(story: LegacyStory | null): { shot: LegacyShot; scene: LegacyScene; firstInScene: boolean }[] {
  const out: { shot: LegacyShot; scene: LegacyScene; firstInScene: boolean }[] = [];
  for (const scene of story?.scenes ?? []) {
    (scene.shots ?? []).forEach((shot, i) => out.push({ shot, scene, firstInScene: i === 0 }));
  }
  return out;
}

/** Character speakers in order of how often they speak (most first). */
export function legacySpeakers(story: LegacyStory | null): string[] {
  const counts = new Map<string, { name: string; n: number; first: number }>();
  let order = 0;
  for (const { shot } of allShots(story)) {
    for (const line of shot.beats ?? []) {
      const s = clean(line.speaker);
      if (NON_CHARACTER_SPEAKERS.has(s.toLowerCase())) continue;
      const k = s.toLowerCase();
      const cur = counts.get(k);
      if (cur) cur.n += 1;
      else counts.set(k, { name: s, n: 1, first: order++ });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first).map((c) => c.name);
}

/**
 * The episode's antihero: the speaker whose name appears in the folder
 * name (EP03_KIM_THE_KUNT is Kim), else the "EPnn_NAME_" word (EP01_DAP),
 * else null so Stuart picks one in the editor.
 */
export function legacyAntiheroName(src: LegacyEpisodeSource): string | null {
  const folder = ` ${src.folderName.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const speakers = legacySpeakers(src.story);
  let best: { name: string; score: number } | null = null;
  for (const s of speakers) {
    const words = s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w));
    const score = words.filter((w) => folder.includes(` ${w} `)).length;
    if (score > 0 && (!best || score > best.score)) best = { name: s, score };
  }
  if (best) return best.name;
  const m = /^EP\d+_([A-Z]+)_/.exec(src.folderName);
  if (m) {
    const word = m[1];
    const match = speakers.find((s) => s.toLowerCase() === word.toLowerCase());
    return match ?? word;
  }
  return null;
}

function sfxLines(sfx: unknown[] | undefined): string[] {
  return (sfx ?? [])
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? clean((x as { label?: string; text?: string }).label ?? (x as { text?: string }).text) : ""))
    .map(clean)
    .filter(Boolean)
    .map((x) => `[SFX: ${x}]`);
}

function speakerLabel(speaker: string): string {
  const s = clean(speaker);
  if (!s || s === "?") return "";
  if (NON_CHARACTER_SPEAKERS.has(s.toLowerCase())) return "Narrator";
  return legacyCastName(s).name;
}

/** Rewrites overridden names inside free text (titles, summaries, lines). */
function renameInText(text: string): string {
  let out = text;
  for (const [from, to] of Object.entries(LEGACY_CAST_OVERRIDES)) {
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_]*"), "gi");
    out = out.replace(re, to.name);
  }
  return out;
}

function shotScript(shot: LegacyShot, scene: LegacyScene, firstInScene: boolean): string {
  const lines: string[] = [];
  if (firstInScene && clean(scene.placeName)) lines.push(`[Location: ${clean(scene.placeName)}]`);
  lines.push(`[Shot: ${clean(shot.title) || "untitled shot"}]`);
  const summary = clean(shot.summary);
  if (summary && summary.toLowerCase() !== clean(shot.title).toLowerCase()) lines.push(summary);
  if (clean(shot.plateFile)) lines.push(`[Plate: ${clean(shot.plateFile)}]`);
  lines.push(...sfxLines(shot.sfx));
  for (const b of shot.beats ?? []) {
    const text = clean(b.text);
    if (!text) continue;
    const who = speakerLabel(b.speaker ?? "");
    lines.push(who ? `${who}: ${text}` : text);
  }
  return renameInText(lines.join("\n"));
}

function bookendScript(b: LegacyBookend | undefined, kind: "intro" | "outro"): string {
  const lines: string[] = [];
  const title = clean(b?.title);
  lines.push(kind === "intro" ? `[Shot: title card${title ? ` \u2014 ${title}` : ""}]` : `[Shot: credits roll${title ? ` \u2014 ${title}` : ""}]`);
  const sfx = sfxLines(b?.sfx);
  lines.push(...(sfx.length ? sfx : [kind === "intro" ? "[SFX: theme sting, title whoosh]" : "[SFX: sting out]"]));
  const notes = clean(b?.notes);
  if (notes) lines.push(/^narrator\s*:/i.test(notes) ? notes : `Narrator: ${notes}`);
  return renameInText(lines.join("\n"));
}

const STORY_BEATS: SkidmarksBeatId[] = SKIDMARKS_BEATS.filter((b) => b.number !== null).map((b) => b.id);

/** Splits `n` shots across the nine beats in order (earlier beats get the extra). */
export function spreadAcrossBeats(n: number): number[][] {
  const out: number[][] = STORY_BEATS.map(() => []);
  for (let i = 0; i < n; i++) out[Math.floor((i * STORY_BEATS.length) / n)].push(i);
  return out;
}

export function legacyEpisodeId(folderName: string): string {
  return `ep_legacy_${slug(folderName)}`;
}
export function legacyCastId(name: string): string {
  return `cast_legacy_${slug(name)}`;
}

export interface LegacyImportPreview {
  folderName: string;
  title: string;
  shotCount: number;
  plateCount: number;
  lineCount: number;
  antiheroName: string | null;
  castNames: string[];
  alreadyImported: boolean;
  /** Empty episodes (no shots) are shown but untick by default. */
  isEmpty: boolean;
}

export function previewLegacyEpisodes(
  sources: readonly LegacyEpisodeSource[],
  state: SkidmarksEpisodesState
): LegacyImportPreview[] {
  const have = new Set(state.episodes.map((e) => e.id));
  return sources.map((src) => {
    const shots = allShots(src.story);
    const antihero = legacyAntiheroName(src);
    const antiName = antihero ? legacyCastName(antihero).name : null;
    const cast = legacySpeakers(src.story)
      .map((s) => legacyCastName(s).name)
      .filter((n) => n !== antiName);
    return {
      folderName: src.folderName,
      title: legacyEpisodeTitle(src),
      shotCount: shots.length,
      plateCount: shots.filter((s) => clean(s.shot.plateFile)).length,
      lineCount: shots.reduce((n, s) => n + (s.shot.beats ?? []).filter((b) => clean(b.text)).length, 0),
      antiheroName: antiName,
      castNames: cast,
      alreadyImported: have.has(legacyEpisodeId(src.folderName)),
      isEmpty: shots.length === 0,
    };
  });
}

/**
 * Merges the picked old episodes into `state`. Existing cast with the same
 * name is reused. An antihero only dies once, so if that character already
 * headlines another episode the imported one gets no antihero and they join
 * as supporting cast instead. Already-imported episodes are skipped.
 */
export function importLegacyEpisodes(
  sources: readonly LegacyEpisodeSource[],
  picked: ReadonlySet<string>,
  state: SkidmarksEpisodesState,
  now: number = Date.now()
): { state: SkidmarksEpisodesState; imported: number; skipped: number } {
  const cast: SkidmarksCastMember[] = [...state.cast];
  const episodes: SkidmarksEpisode[] = [...state.episodes];
  const haveEpisode = new Set(episodes.map((e) => e.id));
  let imported = 0;
  let skipped = 0;

  const ensureCast = (name: string, look: string, wantAntihero: boolean): SkidmarksCastMember => {
    const existing = cast.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (wantAntihero && existing.role !== "antihero") {
        const upgraded = { ...existing, role: "antihero" as const };
        cast[cast.indexOf(existing)] = upgraded;
        return upgraded;
      }
      return existing;
    }
    const member: SkidmarksCastMember = {
      id: legacyCastId(name),
      name,
      role: wantAntihero ? "antihero" : "supporting",
      look,
      fictionalAdultConfirmed: true,
      createdAt: now,
    };
    cast.push(member);
    return member;
  };

  for (const src of legacyImportOrder(sources)) {
    if (!picked.has(src.folderName)) continue;
    const id = legacyEpisodeId(src.folderName);
    if (haveEpisode.has(id)) {
      skipped += 1;
      continue;
    }
    const antiRaw = legacyAntiheroName(src);
    let antiheroId: string | null = null;
    let antiheroName: string | null = null;
    if (antiRaw) {
      const { name, look } = legacyCastName(antiRaw);
      const taken = cast.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const alreadyDies = taken && episodes.some((e) => e.antiheroId === taken.id);
      if (!alreadyDies) {
        antiheroId = ensureCast(name, look, true).id;
        antiheroName = name;
      }
    }
    const castIds: string[] = [];
    for (const s of legacySpeakers(src.story)) {
      const { name, look } = legacyCastName(s);
      if (antiheroName && name.toLowerCase() === antiheroName.toLowerCase()) continue;
      const m = ensureCast(name, look, false);
      if (!castIds.includes(m.id)) castIds.push(m.id);
    }

    const beats = buildStarterBeats();
    const shots = allShots(src.story);
    const groups = spreadAcrossBeats(shots.length);
    STORY_BEATS.forEach((beatId, i) => {
      const parts = groups[i].map((idx) => shotScript(shots[idx].shot, shots[idx].scene, shots[idx].firstInScene));
      if (parts.length) beats[beatId] = { ...beats[beatId], script: parts.join("\n\n") };
      else if (beatId !== "b1") beats[beatId] = { ...beats[beatId], script: "" };
    });
    beats.intro = { ...beats.intro, script: bookendScript(src.story?.intro, "intro") };
    beats.outro = { ...beats.outro, script: bookendScript(src.story?.outro, "outro") };

    const savedAt = src.savedAt ? Date.parse(src.savedAt) : NaN;
    const stamp = Number.isFinite(savedAt) ? savedAt : now;
    episodes.push({
      id,
      title: legacyEpisodeTitle(src),
      antiheroId,
      castIds,
      beats,
      createdAt: stamp,
      updatedAt: stamp,
    });
    haveEpisode.add(id);
    imported += 1;
  }
  return { state: { episodes, cast }, imported, skipped };
}

/**
 * Numbered episodes (EP01..) first, then the rest oldest first, so a
 * character's antihero slot goes to their own numbered episode (Kim dies
 * in EP03, not in a test pitch).
 */
export function legacyImportOrder<T extends LegacyEpisodeSource>(sources: readonly T[]): T[] {
  const num = (f: string) => {
    const m = /^EP(\d+)_/i.exec(f);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  const time = (s: LegacyEpisodeSource) => {
    const t = s.savedAt ? Date.parse(s.savedAt) : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return [...sources].sort((a, b) => num(a.folderName) - num(b.folderName) || time(a) - time(b));
}

/** Old app folders that are UI tests, not episodes. */
export function isLegacyTestFolder(folderName: string): boolean {
  return /^STOCK_UI_TEST/i.test(folderName);
}
