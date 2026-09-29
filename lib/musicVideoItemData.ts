/**
 * Music video bands and songs as `deck_items` rows (per-item saving,
 * the same pattern as characters, see `docs/deck/PER_ITEM_SAVING.md`).
 * Pure: no store, no network. Shared by the server (`prepareDeckItemData`
 * in `lib/deckItems-server.ts`), the browser (`lib/musicVideoItems.ts`)
 * and the one-time seed (`lib/musicVideoItemsSeed.ts`), so all three
 * clean a band or a song exactly the same way.
 *
 * - **Band** (`kind = "music-video-band"`, `item_id` = the band's own id, e.g.
 *   `jack-ash`, `band_<uuid>`): the band as the studio holds it (name,
 *   cover, pinned `mediaSlug`, members with their avatar, looks, lock
 *   and sleeve). Each member also carries `characterId`: the id of its
 *   character row (`kind = "character"`, the card whose sourceKey is
 *   `mv:<member id>`), or `null` if it has none yet. That is a
 *   reference only: nothing from the character card (training pictures,
 *   LoRA links, status) is copied into the band row. The live link the
 *   app follows is still the card's `sourceKey`; `characterId` is
 *   written fresh every time the band saves.
 * - **Song** (`kind = "music-video-song"`, `item_id` = the MP3 attach id,
 *   `mp3_<uuid>`, minted once when the file was attached): the song on
 *   the desk: its band id, the MP3 attachment (clips, plates, prompts,
 *   audio link) and the Script Sequence draft.
 *
 * Both ids are fixed when the thing is made and never change, so a
 * rename never moves a row, and never moves a media folder either (the
 * band's folder comes from its pinned `mediaSlug`, a song's from its MP3
 * file name, see `lib/deckMediaPaths.ts`).
 *
 * URLs only, never picture bytes: any inline `data:` picture is left out
 * of a row (the same rule `stripUnsyncableImageBytesForWire` applies to
 * the session save); the real link lands on the next save once the
 * upload to Blob has gone through.
 *
 * Every cleaner returns its object with keys in sorted order, all the
 * way down, so two copies compare equal whatever order the keys came
 * back in (Postgres `jsonb` reorders them).
 */
import { isValidDeckItemId, type DeckFolder } from "./deckItems";
import { normalizeMemberStillSleeve } from "./memberStillSleeve";
import type {
  SkidmarksBand,
  SkidmarksMember,
  SkidmarksMp3Attachment,
  SkidmarksScriptSequenceDraft,
  SkidmarksSession,
} from "./skidmarks";

/** Bands and songs both live in the Music video folder. */
export const MUSIC_VIDEO_ITEM_FOLDER: DeckFolder = "music-video";

/** One song row: the song on the Music video desk. */
export interface MusicVideoSongItem {
  /** The MP3's `attachId`. */
  id: string;
  bandId: string | null;
  mp3: SkidmarksMp3Attachment;
  scriptSequenceDraft: SkidmarksScriptSequenceDraft | null;
}

/** A band member as stored in a band row: the member plus a reference to its character row. */
export type MusicVideoBandRowMember = SkidmarksMember & { characterId: string | null };
export type MusicVideoBandRow = Omit<SkidmarksBand, "members"> & { members: MusicVideoBandRowMember[] };

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInlineBytes(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("data:");
}

/** A deep copy with object keys in sorted order (arrays keep their order). */
export function sortKeysDeep<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) {
      const out: Obj = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * A deep copy with every inline `data:` picture left out: a string field
 * holding one is dropped, and an object whose own `dataUrl` is one (a
 * plate still, a sleeve entry) is dropped whole, like the session's own
 * wire strip does. `undefined` fields are dropped too, as JSON would.
 */
export function withoutInlineBytes<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const x of v) {
        if (isInlineBytes(x)) continue;
        if (isObj(x) && isInlineBytes(x.dataUrl)) continue;
        out.push(walk(x));
      }
      return out;
    }
    if (isObj(v)) {
      const out: Obj = {};
      for (const [k, x] of Object.entries(v)) {
        if (x === undefined || isInlineBytes(x)) continue;
        if (isObj(x) && isInlineBytes(x.dataUrl)) continue;
        out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

function cleanMember(raw: unknown): SkidmarksMember | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const { characterId: _ref, ...rest } = raw;
  void _ref;
  const m = withoutInlineBytes(rest) as Obj;
  const member: Obj = {
    ...m,
    id: raw.id,
    name: typeof m.name === "string" ? m.name : "",
    emoji: typeof m.emoji === "string" ? m.emoji : "",
    looks: Array.isArray(m.looks) ? m.looks.filter(isObj) : [],
  };
  // Same sleeve cleaning a session load does (`normalizeState`).
  if ("stillSleeve" in member) {
    const sleeve = normalizeMemberStillSleeve(member.stillSleeve);
    if (sleeve) member.stillSleeve = sleeve;
    else delete member.stillSleeve;
  }
  return member as unknown as SkidmarksMember;
}

/**
 * One band, cleaned (defaults filled in, no inline bytes, no
 * `characterId` references). `null` for anything that isn't a usable
 * band. Unknown fields are kept, so a row never loses something a newer
 * build added.
 */
export function cleanBandItem(raw: unknown): SkidmarksBand | null {
  if (!isObj(raw) || !isValidDeckItemId(raw.id)) return null;
  const b = withoutInlineBytes(raw) as Obj;
  const seen = new Set<string>();
  const members: SkidmarksMember[] = [];
  for (const m of Array.isArray(raw.members) ? raw.members : []) {
    const member = cleanMember(m);
    if (!member || seen.has(member.id)) continue;
    seen.add(member.id);
    members.push(member);
  }
  return sortKeysDeep({
    ...b,
    id: raw.id,
    name: typeof b.name === "string" ? b.name : "",
    tagline: typeof b.tagline === "string" ? b.tagline : "",
    coverSeed: typeof b.coverSeed === "number" && Number.isFinite(b.coverSeed) ? b.coverSeed : 0,
    editIcon: b.editIcon === "camera" ? "camera" : "pencil",
    members,
  }) as SkidmarksBand;
}

/** The character row a member points at: the card whose sourceKey is `mv:<member id>`. */
export function characterIdForMember(
  memberId: string,
  characters: readonly { id: string; sourceKey: string | null }[],
): string | null {
  const key = `mv:${memberId}`;
  const card = characters.find((c) => c.sourceKey === key && isValidDeckItemId(c.id));
  return card ? card.id : null;
}

/** What a band row stores: the cleaned band, each member with its `characterId` reference. */
export function bandRowData(
  band: SkidmarksBand,
  characters: readonly { id: string; sourceKey: string | null }[],
): MusicVideoBandRow | null {
  const clean = cleanBandItem(band);
  if (!clean) return null;
  return sortKeysDeep({
    ...clean,
    members: clean.members.map((m) => ({ ...m, characterId: characterIdForMember(m.id, characters) })),
  });
}

/** A band row as the server keeps it: cleaned, with each member's
 * `characterId` kept if it is a well-formed id, `null` otherwise. */
export function cleanBandRowData(raw: unknown): MusicVideoBandRow | null {
  const clean = cleanBandItem(raw);
  if (!clean || !isObj(raw)) return null;
  const refs = new Map<string, string | null>();
  for (const m of Array.isArray(raw.members) ? raw.members : []) {
    if (isObj(m) && typeof m.id === "string" && !refs.has(m.id)) {
      refs.set(m.id, isValidDeckItemId(m.characterId) ? m.characterId : null);
    }
  }
  return sortKeysDeep({ ...clean, members: clean.members.map((m) => ({ ...m, characterId: refs.get(m.id) ?? null })) });
}

function cleanDraft(raw: unknown): SkidmarksScriptSequenceDraft | null {
  if (!isObj(raw) || typeof raw.script !== "string") return null;
  return withoutInlineBytes(raw) as unknown as SkidmarksScriptSequenceDraft;
}

/** One song, cleaned (no inline bytes). `null` for anything that isn't a usable song. */
export function cleanSongItem(raw: unknown): MusicVideoSongItem | null {
  if (!isObj(raw) || !isValidDeckItemId(raw.id)) return null;
  const mp3 = raw.mp3;
  if (!isObj(mp3) || mp3.attachId !== raw.id || typeof mp3.fileName !== "string" || !Array.isArray(mp3.segments)) {
    return null;
  }
  return sortKeysDeep({
    id: raw.id,
    bandId: typeof raw.bandId === "string" && raw.bandId ? raw.bandId : null,
    mp3: withoutInlineBytes(mp3) as unknown as SkidmarksMp3Attachment,
    scriptSequenceDraft: cleanDraft(raw.scriptSequenceDraft),
  });
}

/** The song on the desk as a row, or `null` when no MP3 is attached. */
export function songItemFromSession(session: Pick<SkidmarksSession, "bandId" | "mp3" | "scriptSequenceDraft">): MusicVideoSongItem | null {
  const mp3 = session.mp3;
  if (!mp3 || typeof mp3.attachId !== "string" || !mp3.attachId) return null;
  return { id: mp3.attachId, bandId: session.bandId, mp3, scriptSequenceDraft: session.scriptSequenceDraft ?? null };
}
