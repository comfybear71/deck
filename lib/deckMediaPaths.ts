/**
 * Where new media files go in Blob: the same tree as the data, with
 * readable names (2026-09-30, step 2 of the Blob tidy-up).
 *
 *   deck/sunnybank/characters/shazza/plates/shazza-plate-07.jpg
 *   deck/music-video/characters/big-sexy/big-sexy-avatar.jpg
 *   deck/music-video/songs/crack-haul/plates/crack-haul-clip-03a.jpg
 *   deck/shorts/episodes/ep01-blonde-girl-1/ep01-blonde-girl-1-plate-02.jpg
 *   deck/shorts/characters/skye/plates/skye-plate-03.jpg
 *
 * Pure: no network, no store. Shared by the browser upload helpers
 * (`lib/memberPhotoBlob.ts`, `lib/plateStillBlob.ts`), the server
 * `put()` routes (`lib/deckMediaPut.ts`) and the token route
 * (`app/api/skidmarks/blob-upload/route.ts`), which uses the same
 * checks to refuse anything outside this shape.
 *
 * Rules:
 * - Every folder and file name is a lowercase slug (`a-z`, `0-9`, `-`).
 * - Folder slugs come from something fixed when the item was first
 *   saved (a character's own `slug`, a band's pinned `mediaSlug`), never
 *   the live display name, so a rename never moves or breaks anything.
 *   Links in the data are full URLs anyway; nothing is ever re-derived.
 * - Nothing is overwritten: if a name is taken the next try is `-v2`,
 *   then `-v3`… (`buildDeckMediaPathname`), and `deck/` uploads are
 *   always `allowOverwrite: false`.
 * - Every genre, Shorts included, is fully readable: no random tags.
 * - There is no top-level character folder: a character with no section
 *   (Skye, anyone added by hand) is filed under Shorts.
 * - Anything without a known folder keeps its old `skidmarks/...` path.
 */

export const DECK_MEDIA_ROOT = "deck";

/** A place for one new file: its folder and its name without extension. */
export interface DeckMediaTarget {
  folder: string;
  name: string;
}

/** How many `-vN` names an upload tries before giving up on the tree. */
export const DECK_MEDIA_MAX_VERSION = 30;

const SLUG_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 40;
const MAX_NAME_LENGTH = 120;
const MAX_FOLDER_LENGTH = 200;
const MAX_FOLDER_DEPTH = 8;

export const DECK_MEDIA_EXTENSIONS = ["jpg", "png", "webp", "mp4", "mp3", "json"] as const;
export type DeckMediaExtension = (typeof DECK_MEDIA_EXTENSIONS)[number];

/** Readable, lowercase, dash-separated. "Ranger Bazza" → `ranger-bazza`,
 * "Man’s Best friends" → `mans-best-friends`. Empty → `fallback`. */
export function deckMediaSlug(text: string, fallback = "item"): string {
  const s = (text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019\u2018`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return s || fallback;
}

/** A slug nobody in `taken` has yet: `dazza`, then `dazza-2`, `dazza-3`… */
export function uniqueDeckMediaSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function isSafeDeckMediaSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_NAME_LENGTH && SLUG_SEGMENT_RE.test(value);
}

/** `deck/...` with slug segments only. No `..`, no empty parts. */
export function isSafeDeckMediaFolder(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_FOLDER_LENGTH) return false;
  const parts = value.split("/");
  if (parts[0] !== DECK_MEDIA_ROOT || parts.length < 2 || parts.length > MAX_FOLDER_DEPTH) return false;
  return parts.slice(1).every((p) => SLUG_SEGMENT_RE.test(p));
}

export function isDeckMediaTarget(value: unknown): value is DeckMediaTarget {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isSafeDeckMediaFolder(v.folder) && isSafeDeckMediaSlug(v.name);
}

/** Reads a target sent over the wire (a route body). Anything off-shape is `null`. */
export function parseDeckMediaTarget(value: unknown): DeckMediaTarget | null {
  if (!isDeckMediaTarget(value)) return null;
  return { folder: value.folder, name: value.name };
}

/** Is this a pathname in the tree (`deck/.../name.ext`)? The token route
 * only issues `deck/` tokens for pathnames that pass this. */
export function isDeckMediaPathname(pathname: string): boolean {
  const slash = pathname.lastIndexOf("/");
  if (slash <= 0) return false;
  const folder = pathname.slice(0, slash);
  const file = pathname.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = file.slice(dot + 1);
  return (
    isSafeDeckMediaFolder(folder) &&
    isSafeDeckMediaSlug(file.slice(0, dot)) &&
    (DECK_MEDIA_EXTENSIONS as readonly string[]).includes(ext)
  );
}

/** `folder/name.ext` for the first try, `folder/name-v2.ext` for the second… */
export function buildDeckMediaPathname(target: DeckMediaTarget, ext: DeckMediaExtension, version = 1): string {
  const suffix = version > 1 ? `-v${Math.floor(version)}` : "";
  return `${target.folder}/${target.name}${suffix}.${ext}`;
}

/** The file name without folder or extension, e.g. `blonde-girl-1-clip-02-v2`. */
export function deckMediaStem(pathname: string): string {
  const file = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Blob's own answer when a pathname is taken and overwrite is off:
 * "Vercel Blob: This blob already exists, use `allowOverwrite: true`…". */
export function isBlobAlreadyExistsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /already exists/i.test(message);
}

export function extensionForImageContentType(contentType: string): "jpg" | "png" | "webp" {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

function twoDigits(n: number): string {
  return String(Math.max(1, Math.floor(n))).padStart(2, "0");
}

/** A folder plus the slug its file names start with. */
export interface DeckMediaOwner {
  folder: string;
  fileSlug: string;
}

// ---- One shared shape for every genre ----------------------------------------

/** The four genres. Each has the same two folders: its characters, and
 * its projects (episodes, songs, shorts). */
export type DeckGenre = "sunnybank" | "music-video" | "skidmarks" | "shorts";

export const DECK_GENRE_PROJECTS_FOLDER: Record<DeckGenre, string> = {
  sunnybank: "episodes",
  "music-video": "songs",
  skidmarks: "episodes",
  shorts: "shorts",
};

/** `deck/<genre>/characters/<char>` — the same for every genre. */
export function deckCharacterOwner(genre: DeckGenre, characterSlug: string): DeckMediaOwner {
  return {
    folder: `${DECK_MEDIA_ROOT}/${genre}/characters/${characterSlug}`,
    fileSlug: characterSlug,
  };
}

/** A Skidmarks Cast card made in an episode (2026-10-04):
 * `deck/skidmarks/episodes/<episode>/characters/<char>`. */
export function skidmarksEpisodeCharacterOwner(episodeSlug: string, characterSlug: string): DeckMediaOwner {
  return {
    folder: `${DECK_MEDIA_ROOT}/skidmarks/${DECK_GENRE_PROJECTS_FOLDER.skidmarks}/${episodeSlug}/characters/${characterSlug}`,
    fileSlug: characterSlug,
  };
}

export const DECK_GENRES: readonly DeckGenre[] = ["sunnybank", "music-video", "skidmarks", "shorts"];

export function isDeckGenre(value: unknown): value is DeckGenre {
  return typeof value === "string" && (DECK_GENRES as readonly string[]).includes(value);
}

/** Every genre's projects folder, `deck/<genre>/<episodes|songs|shorts>/`
 * — what a shelf lists to find renders and archives in the new tree. */
export function deckProjectsPrefixes(): string[] {
  return DECK_GENRES.map((g) => `${DECK_MEDIA_ROOT}/${g}/${DECK_GENRE_PROJECTS_FOLDER[g]}/`);
}

/** Which project a render or archive belongs to (`music-video` + `crack-haul`). */
export interface DeckMediaProject {
  genre: DeckGenre;
  slug: string;
}

/** Reads a project sent over the wire. Anything off-shape is `null`. */
export function parseDeckMediaProject(value: unknown): DeckMediaProject | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return isDeckGenre(v.genre) && isSafeDeckMediaSlug(v.slug) && v.slug.length <= 40 ? { genre: v.genre, slug: v.slug } : null;
}

/** `deck/<genre>/<episodes|songs|shorts>/<project>` — the same for every genre. */
export function deckProjectFolder(genre: DeckGenre, projectSlug: string): string {
  return `${DECK_MEDIA_ROOT}/${genre}/${DECK_GENRE_PROJECTS_FOLDER[genre]}/${projectSlug}`;
}

// ---- Characters ----------------------------------------------------------

/** A character card's own `slug` (fixed when the card was made, e.g.
 * `ranger_bazza`) as a folder slug (`ranger-bazza`). */
export function characterMediaSlug(cardSlug: string, name = ""): string {
  return deckMediaSlug(cardSlug.replace(/_/g, "-"), deckMediaSlug(name, "character"));
}

/**
 * A character's home folder from its `sourceKey` prefix — the same split
 * as `characterFolder` in `lib/deckItems.ts`: `sb:`/`sbx:` Sunnybank,
 * `mv:`/`mvx:` Music video, `sk:` Skidmarks, `as:`/`asx:` Shorts. A
 * character with no prefix (Skye, anyone added by hand) is a Shorts
 * character: there is no top-level character folder. Every genre uses
 * `deckCharacterOwner`, so the shape is always
 * `deck/<genre>/characters/<char>/...`. A Music video character linked
 * to a band member (`mv:<memberId>`) uses the member's pinned folder
 * name, which `memberSlug` looks up, so the card and the member share
 * one folder.
 */
export function characterMediaOwner(
  card: { slug: string; name: string; sourceKey: string | null | undefined },
  memberSlug: (memberId: string) => string | null,
  /** Skidmarks (2026-10-04): the episode a Cast card belongs to, by cast
   * id (`"new"` = a card about to be made in the open episode). A card
   * with an episode keeps its files with that episode:
   * `deck/skidmarks/episodes/<episode>/characters/<char>/…`. Cards from
   * before then (no episode) keep `deck/skidmarks/characters/<char>/…`. */
  skidmarksEpisode: (castId: string) => string | null = () => null,
): DeckMediaOwner {
  const slug = characterMediaSlug(card.slug, card.name);
  const key = typeof card.sourceKey === "string" ? card.sourceKey : "";
  const colon = key.indexOf(":");
  const prefix = colon > 0 ? key.slice(0, colon) : "";
  const rest = colon > 0 ? key.slice(colon + 1) : "";
  switch (prefix) {
    case "sb":
    case "sbx":
      return deckCharacterOwner("sunnybank", slug);
    case "sk": {
      const episode = rest ? skidmarksEpisode(rest) : null;
      return isSafeDeckMediaSlug(episode) ? skidmarksEpisodeCharacterOwner(episode, slug) : deckCharacterOwner("skidmarks", slug);
    }
    case "mv":
      return deckCharacterOwner("music-video", (rest && memberSlug(rest)) || slug);
    case "mvx":
      return deckCharacterOwner("music-video", slug);
    default:
      return deckCharacterOwner("shorts", slug);
  }
}

function ownerName(owner: DeckMediaOwner, role: string): string {
  return `${owner.fileSlug}-${role}`;
}

/** `…/plates/shazza-plate-07` — `n` is the plate's 1-based place in the list. */
export function characterPlateTarget(owner: DeckMediaOwner, n: number): DeckMediaTarget {
  return { folder: `${owner.folder}/plates`, name: ownerName(owner, `plate-${twoDigits(n)}`) };
}

/** `…/shazza-reference` */
export function characterReferenceTarget(owner: DeckMediaOwner): DeckMediaTarget {
  return { folder: owner.folder, name: ownerName(owner, "reference") };
}

/** `…/shazza-reference-candidate` — a clean picture waiting for a yes. */
export function characterReferenceCandidateTarget(owner: DeckMediaOwner): DeckMediaTarget {
  return { folder: owner.folder, name: ownerName(owner, "reference-candidate") };
}

/** `…/pictures/shazza-picture-03` — a character's own pictures. */
export function characterPictureTarget(owner: DeckMediaOwner, n: number): DeckMediaTarget {
  return { folder: `${owner.folder}/pictures`, name: ownerName(owner, `picture-${twoDigits(n)}`) };
}

/** Siray's full-size original of a picture that is then shrunk and saved
 * at `target`: same name, in an `originals` folder next to it. */
export function sirayOriginalTarget(target: DeckMediaTarget): DeckMediaTarget | null {
  const folder = `${target.folder}/originals`;
  return isSafeDeckMediaFolder(folder) ? { folder, name: target.name } : null;
}

// ---- Music video -----------------------------------------------------------

/** A band's own folder, for its cover: `deck/music-video/bands/bigsexy`.
 * Bands are the one thing only Music video has; the members themselves
 * are ordinary Music video characters. */
export function bandMediaFolder(bandSlug: string): string {
  return `${DECK_MEDIA_ROOT}/music-video/bands/${bandSlug}`;
}

/** A band member is a Music video character: `deck/music-video/characters/big-sexy`. */
export function memberMediaOwner(memberSlug: string): DeckMediaOwner {
  return deckCharacterOwner("music-video", memberSlug);
}

/** `deck/music-video/bands/bigsexy/bigsexy-cover` */
export function bandCoverTarget(bandSlug: string): DeckMediaTarget {
  return { folder: bandMediaFolder(bandSlug), name: `${bandSlug}-cover` };
}

/** `deck/music-video/characters/big-sexy/big-sexy-avatar` */
export function memberAvatarTarget(memberSlug: string): DeckMediaTarget {
  const owner = memberMediaOwner(memberSlug);
  return { folder: owner.folder, name: ownerName(owner, "avatar") };
}

/** `deck/music-video/characters/big-sexy/looks/big-sexy-look-03` */
export function memberLookTarget(memberSlug: string, n: number): DeckMediaTarget {
  const owner = memberMediaOwner(memberSlug);
  return { folder: `${owner.folder}/looks`, name: ownerName(owner, `look-${twoDigits(n)}`) };
}

/** A song's folder slug from its MP3 file name: "CRACK HAUL.mp3" → `crack-haul`. */
export function songMediaSlug(fileName: string): string {
  return deckMediaSlug(fileName.replace(/\.[a-z0-9]{2,4}$/i, ""), "song");
}

/** The song's own audio: `deck/music-video/songs/crack-haul/crack-haul.mp3`. */
export function songAudioTarget(songSlug: string): DeckMediaTarget {
  return { folder: deckProjectFolder("music-video", songSlug), name: songSlug };
}

/** A song's archive snapshot: `deck/music-video/songs/crack-haul/archive/crack-haul-archive.json`
 * (`-v2`… for a later Archive while an older one is still there). */
export function projectArchiveTarget(project: DeckMediaProject): DeckMediaTarget {
  return { folder: `${deckProjectFolder(project.genre, project.slug)}/archive`, name: `${project.slug}-archive` };
}

/** Matches an archive snapshot anywhere in the tree; `[1]` is its stem. */
export const DECK_ARCHIVE_PATHNAME_RE =
  /^deck\/[a-z0-9-]+\/(?:episodes|songs|shorts)\/[a-z0-9-]+\/archive\/([a-z0-9-]+)\.json$/;

/** `deck/music-video/songs/crack-haul/plates/crack-haul-clip-03b` —
 * clip number is 1-based, plate letter 0 → `a` (matches the render
 * file names Resolve already gets). */
export function songPlateTarget(songSlug: string, clipNumber: number, plateLetterIndex: number): DeckMediaTarget {
  const letter = String.fromCharCode(97 + Math.max(0, Math.min(25, Math.floor(plateLetterIndex))));
  return {
    folder: `${deckProjectFolder("music-video", songSlug)}/plates`,
    name: `${songSlug}-clip-${twoDigits(clipNumber)}${letter}`,
  };
}

// ---- Adult shorts ----------------------------------------------------------

/** A Shorts episode's folder name: `ep01-blonde-girl-1` (2026-09-30). */
export const ADULT_SHORT_EPISODE_SLUG_RE = /^ep\d{2,3}-[a-z0-9]/;

/** `ep01-blonde-girl-1` from episode 1 and its title (or character name). */
export function adultShortEpisodeSlug(episodeNumber: number, title: string): string {
  const n = String(Math.max(1, Math.min(999, Math.floor(episodeNumber)))).padStart(2, "0");
  return `ep${n}-${deckMediaSlug(title, "short")}`;
}

/**
 * The short's own folder. An episode folder name (`ep01-blonde-girl-1`,
 * 2026-09-30) goes under `deck/shorts/episodes/`, like every other
 * genre's episodes. A short pinned before that (`blonde-girl-1`) keeps
 * `deck/shorts/shorts/`, so one short never ends up split across two
 * folders.
 */
export function adultShortFolder(shortSlug: string): string {
  if (ADULT_SHORT_EPISODE_SLUG_RE.test(shortSlug)) return `${DECK_MEDIA_ROOT}/shorts/episodes/${shortSlug}`;
  return deckProjectFolder("shorts", shortSlug);
}

/** `ep01-blonde-girl-1-plate-02`, `…-clip-02`, `…-ref-01`, `…-voice-02` (a talking shot's spoken line). */
export function adultShortTarget(shortSlug: string, role: "ref" | "plate" | "clip" | "voice", n: number): DeckMediaTarget {
  return { folder: adultShortFolder(shortSlug), name: `${shortSlug}-${role}-${twoDigits(n)}` };
}

// ---- Sunnybank episodes --------------------------------------------------

/** `deck/sunnybank/episodes/the-big-wet/act-i/the-big-wet-act-i-beat-03-shazza-speak`.
 * `episodeSlug` is the episode's pinned `mediaSlug` (set once from its
 * name, see `lib/sunnyBanksWorkspace.ts`), never the live name, so a
 * rename never moves where its clips go. No slug (an episode with no
 * name yet) → `null`, and the render keeps the old path. */
export function sunnybankBeatTarget(args: {
  episodeSlug: string | null | undefined;
  actId: string;
  beatNumber: number;
  characterName: string;
  kind: "speak" | "hold";
  /** Which show (2026-10-04): Skidmarks clips go under `deck/skidmarks/episodes/…`. Sunny Banks when left out. */
  genre?: "sunnybank" | "skidmarks";
}): DeckMediaTarget | null {
  if (!isSafeDeckMediaSlug(args.episodeSlug)) return null;
  const episode = args.episodeSlug;
  const act = `act-${deckMediaSlug(args.actId, "1")}`;
  const who = deckMediaSlug(args.characterName, "crowd");
  const target = {
    folder: `${deckProjectFolder(args.genre ?? "sunnybank", episode)}/${act}`,
    name: `${episode}-${act}-beat-${twoDigits(args.beatNumber)}-${who}-${args.kind}`,
  };
  return isDeckMediaTarget(target) ? target : null;
}

/** A multi-cast shot's shared picture (2026-10-03):
 * `deck/sunnybank/episodes/the-big-wet/act-v/the-big-wet-act-v-beat-03-stuie-bloom-plate`.
 * Named after the first row of the scene that made it and everyone in it,
 * so the folder reads like Deck. No slug → `null` (the old flat path). */
export function sunnybankPlateTarget(args: {
  episodeSlug: string | null | undefined;
  actId: string;
  beatNumber: number;
  castNames: readonly string[];
  /** Which show (2026-10-04): Skidmarks clips go under `deck/skidmarks/episodes/…`. Sunny Banks when left out. */
  genre?: "sunnybank" | "skidmarks";
}): DeckMediaTarget | null {
  if (!isSafeDeckMediaSlug(args.episodeSlug)) return null;
  const episode = args.episodeSlug;
  const act = `act-${deckMediaSlug(args.actId, "1")}`;
  const who = args.castNames.map((n) => deckMediaSlug(n, "")).filter(Boolean).join("-") || "cast";
  const target = {
    folder: `${deckProjectFolder(args.genre ?? "sunnybank", episode)}/${act}`,
    name: `${episode}-${act}-beat-${twoDigits(args.beatNumber)}-${who}-plate`.slice(0, 120).replace(/-+$/g, ""),
  };
  return isDeckMediaTarget(target) ? target : null;
}
