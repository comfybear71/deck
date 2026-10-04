/**
 * Episode Extras (2026-10-04, Stuart's ask): outside files kept with an
 * episode, the same in every genre (Sunnybank, Skidmarks, Shorts, Music
 * video). An extra is a video (mp4, mov, webm) or audio file (mp3, wav)
 * Stuart made somewhere else, e.g. a "container drop" shot, with a
 * placement note saying where it goes in the edit ("Act III between 8
 * and 9"). Extras never go into the acts, never render and cost nothing.
 *
 * - The file goes in Blob next to the episode's clips, under a readable
 *   name: `deck/<genre>/<episodes|songs>/<episode>/extras/container-drop.mp4`.
 *   A name already used in that episode gets `-2`, `-3`… (never a random
 *   tag). The name is fixed when the file is uploaded, so renaming the
 *   extra later never moves the file.
 * - The list lives in the session state (`SkidmarksState.episodeExtras`,
 *   the same Neon row as the episodes' clips and rows), keyed by the
 *   episode's Blob folder, so it is there on every device after a reload.
 * - The episode zip gets an `extras/` folder:
 *   `extras/act-3-between-8-and-9 - container-drop.mp4`.
 *
 * Pure: no network, no store. The upload is `lib/episodeExtrasUpload.ts`,
 * the row is `components/EpisodeExtrasRow.tsx`.
 */

import {
  adultShortFolder,
  deckMediaSlug,
  deckProjectFolder,
  isSafeDeckMediaFolder,
  isSafeDeckMediaSlug,
  songMediaSlug,
  uniqueDeckMediaSlug,
  type DeckGenre,
} from "./deckMediaPaths";

/** The file types an extra can be. */
export const EPISODE_EXTRA_EXTENSIONS = ["mp4", "mov", "webm", "mp3", "wav"] as const;
export type EpisodeExtraExtension = (typeof EPISODE_EXTRA_EXTENSIONS)[number];

export type EpisodeExtraKind = "video" | "audio";

/** What each file type is sent to Blob as. */
export const EPISODE_EXTRA_CONTENT_TYPES: Record<EpisodeExtraExtension, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/** Every content type the upload token accepts for an extra (browsers
 * and phones name the same file type a few different ways). */
export const EPISODE_EXTRA_ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
] as const;

/** The file picker's `accept`: types and extensions both, so iPhone
 * Safari (Photos and Files) and Windows both offer the right files. */
export const EPISODE_EXTRA_ACCEPT = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  ".mp4",
  ".mov",
  ".webm",
  ".mp3",
  ".wav",
].join(",");

/** Big enough for any real clip; stops a wrong pick (a whole film) going up. */
export const EPISODE_EXTRA_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export const EPISODE_EXTRA_NAME_MAX = 80;
export const EPISODE_EXTRA_PLACEMENT_MAX = 120;

/** One extra, as saved. `id` is its readable file name (`container-drop`,
 * `container-drop-2`), unique within its episode. */
export interface EpisodeExtra {
  id: string;
  /** What Stuart called it ("container drop"). Editable. */
  name: string;
  /** Where it goes ("Act III between 8 and 9"). Editable, may be empty. */
  placement: string;
  url: string;
  /** Blob pathname, `deck/…/extras/container-drop.mp4`. */
  pathname: string;
  ext: EpisodeExtraExtension;
  kind: EpisodeExtraKind;
  /** The file's own name on the phone or PC, for reference. */
  originalFileName: string;
  sizeBytes: number;
  createdAt: number;
}

/** Extras by episode folder (`deck/skidmarks/episodes/cornish-arsehole`). */
export interface EpisodeExtrasState {
  byEpisode: Record<string, EpisodeExtra[]>;
}

export function emptyEpisodeExtrasState(): EpisodeExtrasState {
  return { byEpisode: {} };
}

export function isEpisodeExtraExtension(value: unknown): value is EpisodeExtraExtension {
  return typeof value === "string" && (EPISODE_EXTRA_EXTENSIONS as readonly string[]).includes(value);
}

export function episodeExtraKind(ext: EpisodeExtraExtension): EpisodeExtraKind {
  return ext === "mp3" || ext === "wav" ? "audio" : "video";
}

/** The extension for a picked file: its name first, then its type.
 * `null` = not a file an extra can be. */
export function episodeExtraExtensionFor(fileName: string, contentType = ""): EpisodeExtraExtension | null {
  const fromName = fileName.toLowerCase().match(/\.([a-z0-9]{2,4})$/)?.[1];
  if (fromName === "m4v") return "mp4";
  if (isEpisodeExtraExtension(fromName)) return fromName;
  const type = contentType.toLowerCase().split(";")[0].trim();
  if (type === "video/mp4") return "mp4";
  if (type === "video/quicktime") return "mov";
  if (type === "video/webm") return "webm";
  if (type === "audio/mpeg" || type === "audio/mp3") return "mp3";
  if (type === "audio/wav" || type === "audio/x-wav" || type === "audio/wave" || type === "audio/vnd.wave") return "wav";
  return null;
}

/** A name to start the name box with: the picked file's name, tidied. */
export function suggestedEpisodeExtraName(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EPISODE_EXTRA_NAME_MAX);
}

export function cleanEpisodeExtraText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** An episode's Blob folder, where its clips already go: Sunnybank and
 * Skidmarks `deck/<genre>/episodes/<episode>`, Shorts
 * `deck/shorts/episodes/ep01-…`, Music video `deck/music-video/songs/<song>`.
 * `null` without a pinned folder name. */
export function episodeFolderFor(genre: DeckGenre, slug: string | null | undefined): string | null {
  if (!isSafeDeckMediaSlug(slug)) return null;
  return genre === "shorts" ? adultShortFolder(slug) : deckProjectFolder(genre, slug);
}

/** A Music video song's folder, from its MP3 file name (as its plates and audio). */
export function songEpisodeFolder(fileName: string | null | undefined): string | null {
  const name = (fileName ?? "").trim();
  return name ? episodeFolderFor("music-video", songMediaSlug(name)) : null;
}

/** `deck/<genre>/<episodes|songs>/<episode>/extras`. */
export function episodeExtrasFolder(episodeFolder: string): string {
  return `${episodeFolder}/extras`;
}

/** The file name for a new extra: its name as a slug, with `-2`, `-3`…
 * when another extra in the same episode already has it. */
export function episodeExtraFileSlug(name: string, taken: Iterable<string>): string {
  return uniqueDeckMediaSlug(deckMediaSlug(name, "extra"), taken);
}

/** The slug after `slug` in the `-2`, `-3`… run, for when Blob already
 * holds a file of that name (an extra deleted earlier keeps its file). */
export function nextEpisodeExtraFileSlug(slug: string, taken: Iterable<string>): string {
  const base = slug.replace(/-\d+$/, "");
  return uniqueDeckMediaSlug(base, [...taken, slug, ...(base === slug ? [] : [base])]);
}

export function episodeExtraPathname(episodeFolder: string, slug: string, ext: EpisodeExtraExtension): string {
  return `${episodeExtrasFolder(episodeFolder)}/${slug}.${ext}`;
}

/** Is this an extra's Blob pathname (`deck/…/extras/<slug>.<ext>`)? The
 * upload token route issues tokens for these. */
export function isEpisodeExtraPathname(pathname: string): boolean {
  if (typeof pathname !== "string" || pathname.includes("..") || pathname.includes("\\")) return false;
  const slash = pathname.lastIndexOf("/");
  if (slash <= 0) return false;
  const folder = pathname.slice(0, slash);
  const file = pathname.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return false;
  return (
    folder.endsWith("/extras") &&
    folder.split("/").length >= 4 &&
    isSafeDeckMediaFolder(folder) &&
    isSafeDeckMediaSlug(file.slice(0, dot)) &&
    isEpisodeExtraExtension(file.slice(dot + 1))
  );
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/[^\s]+$/i.test(value) && value.length <= 2000;
}

function normalizeExtra(value: unknown, episodeFolder: string): EpisodeExtra | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isSafeDeckMediaSlug(v.id) || !isHttpsUrl(v.url) || !isEpisodeExtraExtension(v.ext)) return null;
  const name = cleanEpisodeExtraText(v.name, EPISODE_EXTRA_NAME_MAX) || v.id;
  const pathname = typeof v.pathname === "string" && isEpisodeExtraPathname(v.pathname)
    ? v.pathname
    : episodeExtraPathname(episodeFolder, v.id, v.ext);
  return {
    id: v.id,
    name,
    placement: cleanEpisodeExtraText(v.placement, EPISODE_EXTRA_PLACEMENT_MAX),
    url: v.url,
    pathname,
    ext: v.ext,
    kind: episodeExtraKind(v.ext),
    originalFileName: cleanEpisodeExtraText(v.originalFileName, 200),
    sizeBytes: typeof v.sizeBytes === "number" && Number.isFinite(v.sizeBytes) && v.sizeBytes >= 0 ? Math.floor(v.sizeBytes) : 0,
    createdAt: typeof v.createdAt === "number" && Number.isFinite(v.createdAt) ? v.createdAt : 0,
  };
}

/** Reads the saved state; anything off-shape is dropped. `null` = none saved. */
export function normalizeEpisodeExtrasState(value: unknown): EpisodeExtrasState | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { byEpisode?: unknown }).byEpisode;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const byEpisode: Record<string, EpisodeExtra[]> = {};
  for (const [folder, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSafeDeckMediaFolder(folder) || !Array.isArray(list)) continue;
    const seen = new Set<string>();
    const extras: EpisodeExtra[] = [];
    for (const item of list) {
      const extra = normalizeExtra(item, folder);
      if (!extra || seen.has(extra.id)) continue;
      seen.add(extra.id);
      extras.push(extra);
    }
    if (extras.length > 0) byEpisode[folder] = extras;
  }
  return { byEpisode };
}

export function episodeExtrasHaveUserContent(state: EpisodeExtrasState | null | undefined): boolean {
  return !!state && Object.values(state.byEpisode).some((list) => list.length > 0);
}

export function episodeExtrasFor(state: EpisodeExtrasState | null | undefined, episodeFolder: string | null | undefined): EpisodeExtra[] {
  if (!state || !episodeFolder) return [];
  return state.byEpisode[episodeFolder] ?? [];
}

/** Pure updaters the store uses. */
export function withEpisodeExtraAdded(state: EpisodeExtrasState | null | undefined, episodeFolder: string, extra: EpisodeExtra): EpisodeExtrasState {
  const base = state ?? emptyEpisodeExtrasState();
  const list = (base.byEpisode[episodeFolder] ?? []).filter((x) => x.id !== extra.id);
  return { byEpisode: { ...base.byEpisode, [episodeFolder]: [...list, extra] } };
}

export function withEpisodeExtraEdited(
  state: EpisodeExtrasState | null | undefined,
  episodeFolder: string,
  id: string,
  patch: { name?: string; placement?: string },
): EpisodeExtrasState {
  const base = state ?? emptyEpisodeExtrasState();
  const list = base.byEpisode[episodeFolder] ?? [];
  return {
    byEpisode: {
      ...base.byEpisode,
      [episodeFolder]: list.map((x) =>
        x.id !== id
          ? x
          : {
              ...x,
              ...(patch.name !== undefined ? { name: cleanEpisodeExtraText(patch.name, EPISODE_EXTRA_NAME_MAX) || x.name } : {}),
              ...(patch.placement !== undefined ? { placement: cleanEpisodeExtraText(patch.placement, EPISODE_EXTRA_PLACEMENT_MAX) } : {}),
            },
      ),
    },
  };
}

export function withEpisodeExtraRemoved(state: EpisodeExtrasState | null | undefined, episodeFolder: string, id: string): EpisodeExtrasState {
  const base = state ?? emptyEpisodeExtrasState();
  const list = (base.byEpisode[episodeFolder] ?? []).filter((x) => x.id !== id);
  const byEpisode = { ...base.byEpisode };
  if (list.length > 0) byEpisode[episodeFolder] = list;
  else delete byEpisode[episodeFolder];
  return { byEpisode };
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };

function romanToNumber(roman: string): number | null {
  let total = 0;
  const s = roman.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const n = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]] ?? 0;
    if (!n) return null;
    total += n < next ? -n : n;
  }
  return total > 0 && total < 200 ? total : null;
}

/** The placement note as a file-name part: "Act III between 8 and 9" →
 * `act-3-between-8-and-9` (an act's roman numeral becomes its number). */
export function episodeExtraPlacementSlug(placement: string): string {
  const withNumbers = placement.replace(/\bact\s+([ivxlc]+)\b/gi, (whole, roman: string) => {
    const n = romanToNumber(roman);
    return n ? `act ${n}` : whole;
  });
  return deckMediaSlug(withNumbers, "");
}

/** The name an extra has inside the episode zip:
 * `extras/act-3-between-8-and-9 - container-drop.mp4`, or
 * `extras/container-drop.mp4` with no placement note. */
export function episodeExtraZipName(extra: Pick<EpisodeExtra, "name" | "placement" | "ext" | "id">): string {
  const where = episodeExtraPlacementSlug(extra.placement);
  const what = deckMediaSlug(extra.name, extra.id);
  return `extras/${where ? `${where} - ` : ""}${what}.${extra.ext}`;
}

/** Every extra's zip name and link, in the order they were added; two
 * that would get the same name get `-2`, `-3`… */
export function episodeExtrasZipEntries(
  extras: readonly Pick<EpisodeExtra, "id" | "name" | "placement" | "ext" | "url">[],
): { name: string; url: string }[] {
  const used = new Set<string>();
  return extras.map((extra) => {
    const full = episodeExtraZipName(extra);
    const dot = full.lastIndexOf(".");
    const stem = full.slice(0, dot);
    let name = full;
    for (let n = 2; used.has(name); n++) name = `${stem}-${n}${full.slice(dot)}`;
    used.add(name);
    return { name, url: extra.url };
  });
}

/** "12.4 MB", for the card and the save sheet. */
export function formatEpisodeExtraSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** What a page sends a zip route about an extra: enough to name it there. */
export interface EpisodeExtraZipItem {
  id: string;
  name: string;
  placement: string;
  ext: EpisodeExtraExtension;
  url: string;
}

export const EPISODE_EXTRAS_ZIP_MAX = 50;

export function episodeExtraZipItems(extras: readonly EpisodeExtra[]): EpisodeExtraZipItem[] {
  return extras.map(({ id, name, placement, ext, url }) => ({ id, name, placement, ext, url }));
}

/** Reads the extras a zip request carries. Each link must pass
 * `isAllowedUrl` (Deck's own storage); a bad one refuses the whole zip. */
export function parseEpisodeExtraZipItems(
  value: unknown,
  isAllowedUrl: (url: string) => boolean,
): { ok: true; items: EpisodeExtraZipItem[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, items: [] };
  if (!Array.isArray(value)) return { ok: false, error: "The extras list isn't readable." };
  if (value.length > EPISODE_EXTRAS_ZIP_MAX) return { ok: false, error: `Keep it to ${EPISODE_EXTRAS_ZIP_MAX} extras.` };
  const items: EpisodeExtraZipItem[] = [];
  for (const raw of value) {
    const v = (raw ?? {}) as Record<string, unknown>;
    const url = typeof v.url === "string" ? v.url.trim() : "";
    if (!isAllowedUrl(url)) return { ok: false, error: "An extra's link isn't one of Deck's saved files." };
    if (!isEpisodeExtraExtension(v.ext)) return { ok: false, error: "An extra isn't a video or audio file." };
    const id = isSafeDeckMediaSlug(v.id) ? v.id : "extra";
    items.push({
      id,
      name: cleanEpisodeExtraText(v.name, EPISODE_EXTRA_NAME_MAX) || id,
      placement: cleanEpisodeExtraText(v.placement, EPISODE_EXTRA_PLACEMENT_MAX),
      ext: v.ext,
      url,
    });
  }
  return { ok: true, items };
}
