/**
 * Per-item saving (2026-09-30, step 1 of Stuart's "save each thing on
 * its own" plan). Shared, pure pieces used by the API route, the server
 * module, the seed script and the client.
 *
 * Why: everything used to live in one Neon row (`skidmarks_sessions`),
 * so on 2026-09-29 an old phone copy overwrote that row and wiped the
 * character trainings along with everything else. Here each thing is
 * its own row in `deck_items`, written only when that one thing
 * changes, with its own revision, so a stale device can at worst be
 * refused on the one card it touched, never wipe the rest.
 *
 * Step 1 covered characters (`kind = "character"`). Step 2 adds Sunnybank
 * episodes (`kind = "sunnybank-episode"`, one row per saved episode card,
 * folder `sunnybank`), Skidmarks episodes (`skidmarks-episode`, folder
 * `skidmarks`) and saved shorts (`adult-short`, folder `adult-shorts`).
 * The tables are created by
 * `db/migrations/2026-09-30_deck_items.sql`, run by hand. Nothing in the
 * app creates them.
 */

/** The kinds this build saves per item. Later steps add more.
 * `character`: one character card (`SkidmarksState.characterLoras.characters[]`).
 * `sunnybank-episode`: one saved Sunnybank episode card.
 * `skidmarks-episode`: one Skidmarks episode (`SkidmarksState.skidmarksEpisodes.episodes[]`).
 * `adult-short`: one saved short from the Shorts Library (`SkidmarksState.adultShorts.saved[]`).
 * `music-video-band` / `music-video-song`: one Music video band, and the
 * song on the desk (see `lib/musicVideoItemData.ts`). */
export const DECK_ITEM_KINDS = [
  "character",
  "sunnybank-episode",
  "skidmarks-episode",
  "adult-short",
  "music-video-band",
  "music-video-song",
] as const;
export type DeckItemKind = (typeof DECK_ITEM_KINDS)[number];

/**
 * Kinds that one seed script puts in together. A kind counts as seeded
 * (per-item saving switched on) once any row of any kind in its group
 * exists, so Music video songs switch on with its bands even when no
 * song was on the desk the day the seed ran.
 */
export function deckItemSeedKinds(kind: DeckItemKind): DeckItemKind[] {
  switch (kind) {
    case "music-video-band":
    case "music-video-song":
      return ["music-video-band", "music-video-song"];
    default:
      return [kind];
  }
}

export function isDeckItemKind(value: unknown): value is DeckItemKind {
  return typeof value === "string" && (DECK_ITEM_KINDS as readonly string[]).includes(value);
}

/**
 * The folder a row lives in. Matches the agreed layout: Deck at the
 * root, then Sunnybank, Music video, Skidmarks and Adult shorts. A
 * character keeps one home folder even when a band or episode uses it.
 */
export type DeckFolder = "deck" | "sunnybank" | "music-video" | "skidmarks" | "adult-shorts";

export const DECK_FOLDER_LABELS: Record<DeckFolder, string> = {
  deck: "Deck",
  sunnybank: "Sunnybank",
  "music-video": "Music video",
  skidmarks: "Skidmarks",
  "adult-shorts": "Shorts",
};

/**
 * A character's home folder, from its `sourceKey` prefix (see
 * `lib/characterRoster.ts` and `lib/rosterExtras.ts`'s
 * `rosterExtraSourceKey`): `sb:`/`sbx:` Sunnybank, `mv:`/`mvx:` Music
 * video, `sk:` Skidmarks, `as:`/`asx:` Adult shorts. A card with no
 * `sourceKey` (anyone added by hand on the LoRA cards list) sits at the
 * Deck root. Skye is a Shorts character (`asx:skye`) like any other.
 */
export function characterFolder(sourceKey: string | null | undefined): DeckFolder {
  const prefix = typeof sourceKey === "string" ? sourceKey.split(":", 1)[0] : "";
  switch (prefix) {
    case "sb":
    case "sbx":
      return "sunnybank";
    case "mv":
    case "mvx":
      return "music-video";
    case "sk":
      return "skidmarks";
    case "as":
    case "asx":
      return "adult-shorts";
    default:
      return "deck";
  }
}

/**
 * The folder every row of a kind lives in, for the kinds that belong to
 * one project. Characters are foldered per card instead (`characterFolder`).
 * Shorts keep the `adult-shorts` key the database and code already use.
 */
export const DECK_ITEM_KIND_FOLDERS: Partial<Record<DeckItemKind, DeckFolder>> = {
  "sunnybank-episode": "sunnybank",
  "skidmarks-episode": "skidmarks",
  "adult-short": "adult-shorts",
};

/** `expectedRevision` for an item this device has never seen on the server. */
export const DECK_ITEM_NEW_REVISION = 0;

/** How many earlier versions of one item `deck_item_history` keeps. */
export const DECK_ITEM_HISTORY_KEEP = 20;

/** Biggest `data` one item may carry (URLs only, never image bytes). */
export const DECK_ITEM_MAX_DATA_BYTES = 256 * 1024;

/** One row as the API hands it out. */
export interface DeckItemRecord<T = unknown> {
  itemId: string;
  folder: string;
  data: T;
  revision: number;
  updatedAt: string | null;
  /** Set only on a soft-deleted row (never in a GET's `items`). */
  deletedAt: string | null;
}

/** A soft-deleted row, so a device can drop its old copy. */
export interface DeckItemTombstone {
  itemId: string;
  revision: number;
}

/** Item ids are app-made (`clora_<uuid>`, `clora_skye`, a Sunnybank
 * episode's `ws-<savedAt>-<seq>-<fingerprint>`, a Skidmarks episode's
 * `ep_<uuid>`, a short's `short_<time>_<rand>`, a band's `band_<uuid>` or
 * `jack-ash`, a song's `mp3_<uuid>`); anything else is refused. */
export function isValidDeckItemId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_.:-]+$/.test(value);
}

export const DECK_ITEMS_TABLE_MISSING_MESSAGE =
  "Per-item saving isn't set up yet: the deck_items tables are missing. " +
  "Run db/migrations/2026-09-30_deck_items.sql by hand. Until then everything still saves the old way.";

export const DECK_ITEMS_ENDPOINT = "/api/deck/items";
