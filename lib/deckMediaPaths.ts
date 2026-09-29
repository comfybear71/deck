/**
 * Where new media files go in Blob: the same tree as the data, with
 * readable names (2026-09-30, step 2 of the Blob tidy-up).
 *
 *   deck/sunnybank/characters/shazza/plates/shazza-plate-07.jpg
 *   deck/music-video/characters/big-sexy/big-sexy-avatar.jpg
 *   deck/music-video/songs/crack-haul/plates/crack-haul-clip-03a.jpg
 *   deck/shorts/shorts/short-3f9a2c/short-3f9a2c-plate-02.jpg
 *   deck/shorts/characters/skye/plates/skye-7b1e04-plate-03.jpg
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
 * - Everything under `deck/shorts/` (the Adult shorts section, and Skye)
 *   carries a short random tag so the paths can't be guessed from a name.
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

/** The file name without folder or extension, e.g. `short-3f9a2c-clip-02-v2`. */
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

/** Short random hex tag for Adult shorts names (privacy). */
export function randomDeckMediaTag(length = 6): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export function isDeckMediaTag(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{4,12}$/.test(value);
}

function twoDigits(n: number): string {
  return String(Math.max(1, Math.floor(n))).padStart(2, "0");
}

/** A folder plus the slug its file names start with. */
export interface DeckMediaOwner {
  folder: string;
  fileSlug: string;
  /** Adult shorts: every file name gets its own random tag. */
  tagged: boolean;
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

/** The only genre difference: Shorts file names carry a random tag. */
export function deckGenreTagsNames(genre: DeckGenre): boolean {
  return genre === "shorts";
}

/** `deck/<genre>/characters/<char>` — the same for every genre. */
export function deckCharacterOwner(genre: DeckGenre, characterSlug: string): DeckMediaOwner {
  return {
    folder: `${DECK_MEDIA_ROOT}/${genre}/characters/${characterSlug}`,
    fileSlug: characterSlug,
    tagged: deckGenreTagsNames(genre),
  };
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
    case "sk":
      return deckCharacterOwner("skidmarks", slug);
    case "mv":
      return deckCharacterOwner("music-video", (rest && memberSlug(rest)) || slug);
    case "mvx":
      return deckCharacterOwner("music-video", slug);
    default:
      return deckCharacterOwner("shorts", slug);
  }
}

function ownerName(owner: DeckMediaOwner, role: string): string {
  const tag = owner.tagged ? `-${randomDeckMediaTag()}` : "";
  return `${owner.fileSlug}${tag}-${role}`;
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

/** `deck/shorts/shorts/short-3f9a2c` — the tag is random, pinned on the short. */
export function adultShortFolder(tag: string): string {
  return deckProjectFolder("shorts", `short-${tag}`);
}

/** `short-3f9a2c-plate-02`, `short-3f9a2c-clip-02`, `short-3f9a2c-ref-01`. */
export function adultShortTarget(tag: string, role: "ref" | "plate" | "clip", n: number): DeckMediaTarget {
  return { folder: adultShortFolder(tag), name: `short-${tag}-${role}-${twoDigits(n)}` };
}

// ---- Sunnybank episodes --------------------------------------------------

/** `deck/sunnybank/episodes/the-big-wet/act-i/the-big-wet-act-i-beat-03-shazza-speak`.
 * Episodes have no stable id yet (the shelf keys them by name), so this
 * uses the episode name at render time; blank name → `null` (old path). */
export function sunnybankBeatTarget(args: {
  episodeTitle: string;
  actId: string;
  beatNumber: number;
  characterName: string;
  kind: "speak" | "hold";
}): DeckMediaTarget | null {
  const title = args.episodeTitle.trim();
  if (!title) return null;
  const episode = deckMediaSlug(title, "episode");
  const act = `act-${deckMediaSlug(args.actId, "1")}`;
  const who = deckMediaSlug(args.characterName, "crowd");
  const target = {
    folder: `${deckProjectFolder("sunnybank", episode)}/${act}`,
    name: `${episode}-${act}-beat-${twoDigits(args.beatNumber)}-${who}-${args.kind}`,
  };
  return isDeckMediaTarget(target) ? target : null;
}
