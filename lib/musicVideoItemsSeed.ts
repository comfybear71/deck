/**
 * Pure planning half of the one-time Music video seed
 * (`scripts/seed-deck-items-music-video.ts`), the same shape as
 * `lib/deckItemsSeed.ts` for characters: turns the bands and the desk's
 * song from Stuart's `skidmarks_sessions` row into the `deck_items` rows
 * it would insert. No database access here, so it is unit-tested and the
 * script's dry run prints exactly what a real run writes.
 *
 * The app itself never seeds; only that script, run by hand, does.
 */
import { isValidDeckItemId } from "./deckItems";
import {
  MUSIC_VIDEO_ITEM_FOLDER,
  bandRowData,
  cleanSongItem,
  songItemFromSession,
  type MusicVideoBandRow,
  type MusicVideoSongItem,
} from "./musicVideoItemData";
import type { SkidmarksMp3Attachment, SkidmarksScriptSequenceDraft } from "./skidmarks";

export interface BandSeedRow {
  itemId: string;
  folder: typeof MUSIC_VIDEO_ITEM_FOLDER;
  name: string;
  members: { memberId: string; name: string; characterId: string | null }[];
  data: MusicVideoBandRow;
}

export interface SongSeedRow {
  itemId: string;
  folder: typeof MUSIC_VIDEO_ITEM_FOLDER;
  fileName: string;
  bandId: string | null;
  clipCount: number;
  data: MusicVideoSongItem;
}

export interface MusicVideoSeedPlan {
  bands: BandSeedRow[];
  songs: SongSeedRow[];
  /** Entries in the session that can't become a row, and why. */
  skipped: { what: string; reason: string }[];
  /** `bands` was missing in the session (the app then shows only its built-in bands). */
  sessionHasNoBands: boolean;
  /** Built-in bands Stuart deleted (`removedSeedBandIds`), for the report. */
  removedSeedBandIds: string[];
}

type CharacterRef = { id: string; sourceKey: string | null };

interface SessionLike {
  bands?: unknown;
  removedSeedBandIds?: unknown;
  session?: { bandId?: unknown; mp3?: unknown; scriptSequenceDraft?: unknown } | null;
}

export function planMusicVideoSeed(state: unknown, characters: readonly CharacterRef[]): MusicVideoSeedPlan {
  const s = (state && typeof state === "object" ? state : {}) as SessionLike;
  const plan: MusicVideoSeedPlan = {
    bands: [],
    songs: [],
    skipped: [],
    sessionHasNoBands: !Array.isArray(s.bands),
    removedSeedBandIds: Array.isArray(s.removedSeedBandIds)
      ? s.removedSeedBandIds.filter((id): id is string => typeof id === "string")
      : [],
  };

  const seen = new Set<string>();
  (Array.isArray(s.bands) ? s.bands : []).forEach((raw, index) => {
    const id = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;
    if (!isValidDeckItemId(id)) return plan.skipped.push({ what: `band #${index}`, reason: `unusable id ${JSON.stringify(id)}` });
    if (seen.has(id)) return plan.skipped.push({ what: `band ${id}`, reason: "duplicate id (first copy kept)" });
    const data = bandRowData(raw as never, characters);
    if (!data) return plan.skipped.push({ what: `band ${id}`, reason: "not a band" });
    seen.add(id);
    plan.bands.push({
      itemId: id,
      folder: MUSIC_VIDEO_ITEM_FOLDER,
      name: data.name,
      members: data.members.map((m) => ({ memberId: m.id, name: m.name, characterId: m.characterId })),
      data,
    });
  });

  // The song on the desk. A session load drops it when its band is gone,
  // so the seed does too.
  const session = s.session ?? {};
  const mp3 = session.mp3 && typeof session.mp3 === "object" ? (session.mp3 as SkidmarksMp3Attachment) : null;
  if (mp3) {
    const bandId = typeof session.bandId === "string" ? session.bandId : null;
    const draft = (session.scriptSequenceDraft ?? null) as SkidmarksScriptSequenceDraft | null;
    const desk = songItemFromSession({ bandId, mp3, scriptSequenceDraft: draft });
    const song = desk ? cleanSongItem(desk) : null;
    const fileName = typeof mp3.fileName === "string" ? mp3.fileName : "(no file name)";
    if (!bandId || !seen.has(bandId)) {
      plan.skipped.push({ what: `song ${fileName}`, reason: "its band isn't in the session (a load drops it too)" });
    } else if (!song) {
      plan.skipped.push({ what: `song ${fileName}`, reason: "no attach id, or not a usable song" });
    } else {
      plan.songs.push({
        itemId: song.id,
        folder: MUSIC_VIDEO_ITEM_FOLDER,
        fileName: song.mp3.fileName,
        bandId: song.bandId,
        clipCount: song.mp3.segments.length,
        data: song,
      });
    }
  }
  return plan;
}

/** Plain-text tree of what the Music video folder will hold. */
export function formatMusicVideoSeedTree(plan: MusicVideoSeedPlan): string {
  const lines: string[] = ["Deck", "└── Music video"];
  lines.push(`    ├── Bands (${plan.bands.length})`);
  plan.bands.forEach((b, i) => {
    const lastBand = i === plan.bands.length - 1;
    lines.push(`    │   ${lastBand ? "└──" : "├──"} ${b.name || "(no name)"}  [${b.itemId}]`);
    const pad = `    │   ${lastBand ? "    " : "│   "}`;
    b.members.forEach((m, j) => {
      const ref = m.characterId ? `character ${m.characterId}` : "no character row yet";
      lines.push(`${pad}${j === b.members.length - 1 ? "└──" : "├──"} ${m.name || "(no name)"}  [${m.memberId} → ${ref}]`);
    });
  });
  lines.push(`    └── Songs (${plan.songs.length})`);
  plan.songs.forEach((sg, i) => {
    lines.push(`        ${i === plan.songs.length - 1 ? "└──" : "├──"} ${sg.fileName}  [${sg.itemId}, band ${sg.bandId}, ${sg.clipCount} clips]`);
  });
  return lines.join("\n");
}
