/**
 * Skidmarks episodes on the Sunny Banks structure (2026-10-04, Stuart:
 * "drop the nine-beat outline editor and give Skidmarks exactly the
 * Sunny Banks structure"). A Skidmarks episode is now the same episode
 * card as a Sunny Banks one (`SunnyBanksWorkspaceSnapshot`: acts, a
 * script per act, a render row per line), plus the ids of who's in it
 * from the one shared Skidmarks Cast (`castIds`).
 *
 * Episodes saved by the old nine-beat editor still load: they are turned
 * into an episode card here, in code, when they are read (the session
 * load and a `deck_items` row alike). Nothing is written to the database
 * by this; the next real edit saves the new shape the usual way.
 */
import {
  SKIDMARKS_BEATS,
  SKIDMARKS_STARTER_SCRIPTS,
  normalizeSkidmarksEpisode,
  type SkidmarksCastMember,
  type SkidmarksEpisode,
} from "./skidmarksEpisodes";
import {
  fingerprintWorkspace,
  normalizeSunnyBanksWorkspace,
  type SkidmarksSunnyBanksState,
  type SunnyBanksWorkspaceSnapshot,
} from "./sunnyBanksWorkspace";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One old beat's text in the new script's words: `[Shot: …]` becomes
 * `[Action: …]`, `[SFX: …]` is dropped (sound is added in the edit, and
 * the new script box would read it out loud), and `[Name: look]` for a
 * cast member becomes `[Character Name: look]`.
 */
export function legacySkidmarksBeatToScript(script: string, castNames: readonly string[]): string {
  const names = [...castNames].filter((n) => n.trim()).sort((a, b) => b.length - a.length);
  const nameTag = names.length > 0 ? new RegExp(`^\\[(${names.map(escapeRegExp).join("|")})\\s*:`, "i") : null;
  return script
    .split(/\r?\n/)
    .flatMap((raw) => {
      const line = raw.trim();
      if (/^\[SFX:[^\]]*\]$/i.test(line)) return [];
      const shot = /^\[Shot:\s*([^\]]*)\]$/i.exec(line);
      if (shot) return shot[1].trim() ? [`[Action: ${shot[1].trim()}]`] : [];
      if (/^\[Location:\s*\]$/i.test(line)) return [];
      if (nameTag?.test(line)) return [line.replace(nameTag, (_m, name: string) => `[Character ${name}:`)];
      return [raw];
    })
    .join("\n")
    .trim();
}

/**
 * An episode from the nine-beat editor as an episode card: one act per
 * beat that has something written beyond the starter text (an
 * `=== BEAT ===` header, then its text), its title, and who was in it.
 * Same id, so its `deck_items` row stays the same row.
 */
export function legacySkidmarksEpisodeToWorkspace(
  episode: SkidmarksEpisode,
  cast: readonly Pick<SkidmarksCastMember, "id" | "name">[] = [],
): SunnyBanksWorkspaceSnapshot {
  const castNames = cast.map((c) => c.name);
  const acts: Array<{ id: string; script: string }> = [];
  for (const meta of SKIDMARKS_BEATS) {
    const text = episode.beats[meta.id]?.script ?? "";
    if (!text.trim() || text.trim() === SKIDMARKS_STARTER_SCRIPTS[meta.id].trim()) continue;
    const body = legacySkidmarksBeatToScript(text, castNames);
    if (!body) continue;
    const id = ROMAN[acts.length] ?? String(acts.length + 1);
    const heading = meta.number === null ? meta.label : `${meta.number}. ${meta.label}`;
    acts.push({ id, script: `=== ${heading.toUpperCase()} ===\n${body}` });
  }
  if (acts.length === 0) acts.push({ id: "I", script: "" });
  const actIds = acts.map((a) => a.id);
  const blank = <T,>(value: () => T): Record<string, T> => Object.fromEntries(actIds.map((act) => [act, value()]));
  const castIds = [episode.antiheroId, ...episode.castIds].filter(
    (id, i, all): id is string => typeof id === "string" && id.length > 0 && all.indexOf(id) === i,
  );
  const content = {
    workspaceTitle: episode.title,
    defaultLocationId: "",
    actIds,
    activeAct: actIds[0],
    actScripts: Object.fromEntries(acts.map((a) => [a.id, a.script])),
    characterOverrides: blank(() => ({})),
    locationOverrides: blank(() => ({})),
    runtimeMap: blank(() => ({})),
    ...(castIds.length > 0 ? { castIds } : {}),
  };
  const snapshot: SunnyBanksWorkspaceSnapshot = {
    id: episode.id,
    savedAt: episode.updatedAt,
    fingerprint: fingerprintWorkspace(content),
    label: episode.title,
    defaultLocationId: content.defaultLocationId,
    actIds: content.actIds,
    activeAct: content.activeAct,
    actScripts: content.actScripts,
    characterOverrides: content.characterOverrides,
    locationOverrides: content.locationOverrides,
    runtimeMap: content.runtimeMap,
  };
  if (castIds.length > 0) snapshot.castIds = castIds;
  return snapshot;
}

function isLegacyEpisodeShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return !Array.isArray(v.actIds) && !!v.beats && typeof v.beats === "object";
}

/**
 * One Skidmarks episode card, cleaned: an episode card as it is, or an
 * old nine-beat episode turned into one. `null` if it is neither. Used
 * by per-item saving (`deck_items` kind `skidmarks-episode`) on both the
 * page and the server, so the two always agree.
 */
export function normalizeSkidmarksEpisodeCard(value: unknown): SunnyBanksWorkspaceSnapshot | null {
  if (isLegacyEpisodeShape(value)) {
    const legacy = normalizeSkidmarksEpisode(value);
    return legacy ? legacySkidmarksEpisodeToWorkspace(legacy) : null;
  }
  return normalizeSunnyBanksWorkspace(value, "skidmarks");
}

/**
 * The Skidmarks studio with any old nine-beat episodes from the session
 * added to its shelf (after its own cards, newest first), skipping any
 * whose id is already a card. `studio` is `null` until the first edit.
 */
export function withLegacySkidmarksEpisodes(
  studio: SkidmarksSunnyBanksState | null,
  episodes: readonly SkidmarksEpisode[],
  cast: readonly Pick<SkidmarksCastMember, "id" | "name">[],
  emptyStudio: () => SkidmarksSunnyBanksState,
): SkidmarksSunnyBanksState | null {
  if (episodes.length === 0) return studio;
  const base = studio ?? emptyStudio();
  const have = new Set(base.workspaces.map((w) => w.id));
  const added = episodes
    .filter((ep) => !have.has(ep.id))
    .map((ep) => legacySkidmarksEpisodeToWorkspace(ep, cast))
    .sort((a, b) => b.savedAt - a.savedAt);
  if (added.length === 0) return studio;
  return { ...base, workspaces: [...base.workspaces, ...added], saveSeq: base.saveSeq + added.length };
}
