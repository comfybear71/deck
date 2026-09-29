/**
 * Per-item saving for Music video (2026-09-30): each band in
 * `SkidmarksState.bands` is also one `deck_items` row (kind
 * `music-video-band`), and so is the song on the desk (kind
 * `music-video-song`), both in folder `music-video`. Same engine and
 * rules as every other kind (`lib/deckItemSync.ts`); this only says which
 * kind it is, how one band or song is cleaned (`lib/musicVideoItemData.ts`)
 * and how server rows are laid over the studio state. The rules:
 *
 * - only a band or song that really changed is sent, one debounced PUT
 *   each; loading never writes;
 * - a band or song missing from this device (an old phone copy, a thin
 *   session) is never deleted because of it. Only the band's own trash
 *   tap (`removeSkidmarksBand`) and the MP3 card's own remove tap
 *   (`clearSkidmarksMp3`) delete, and both are soft deletes with a
 *   history copy;
 * - a 409 means this device takes the server's copy;
 * - the client never seeds: until `scripts/seed-deck-items-music-video.ts`
 *   has run, this stays off and the whole-session save carries on as
 *   before. The whole-session save also keeps running as a mirror.
 *
 * The desk holds one song at a time, so "this device's songs" is just
 * the song on the desk (none, or one). Laying the server's songs over
 * the screen only ever refreshes that one song; it never puts a
 * different song on the desk.
 *
 * `lib/skidmarks.ts` wires it in. No `localStorage`.
 */
import type { DeckItemKindConfig } from "./deckItemSync";
import {
  bandRowData,
  cleanBandItem,
  cleanSongItem,
  songItemFromSession,
  type MusicVideoSongItem,
} from "./musicVideoItemData";
import type { SkidmarksBand, SkidmarksState } from "./skidmarks";

type CharacterRef = { id: string; sourceKey: string | null };

/** Bands. Each PUT carries the members' `characterId` references,
 * worked out from the character cards on screen at save time. */
export function musicVideoBandItems(getCharacters: () => readonly CharacterRef[]): DeckItemKindConfig<SkidmarksBand> {
  return {
    kind: "music-video-band",
    normalize: cleanBandItem,
    noun: "band",
    toData: (band) => bandRowData(band, getCharacters()) ?? band,
  };
}

export const MUSIC_VIDEO_SONG_ITEMS: DeckItemKindConfig<MusicVideoSongItem> = {
  kind: "music-video-song",
  normalize: cleanSongItem,
  noun: "song",
};

/** This device's songs for the engine: the song on the desk, if any. */
export function deskSongItems(state: Pick<SkidmarksState, "session">): MusicVideoSongItem[] {
  const song = songItemFromSession(state.session);
  return song ? [song] : [];
}

/**
 * The studio state with the server's bands on screen (the engine's
 * overlay has already decided which copy wins). A hand-seeded band the
 * server has deleted is recorded in `removedSeedBandIds`, the same as a
 * delete tap does, so it isn't re-made from the built-in list; if the
 * active band is gone, the desk resets the way `removeSkidmarksBand`
 * resets it. Never touches anything else.
 */
export function withServerBands(
  state: SkidmarksState,
  bands: SkidmarksBand[],
  seedBandIds: ReadonlySet<string>,
): SkidmarksState {
  const nextIds = new Set(bands.map((b) => b.id));
  const droppedSeeds = state.bands.filter((b) => seedBandIds.has(b.id) && !nextIds.has(b.id)).map((b) => b.id);
  const removedSeedBandIds =
    droppedSeeds.length > 0 ? Array.from(new Set([...state.removedSeedBandIds, ...droppedSeeds])) : state.removedSeedBandIds;
  const activeGone = state.session.bandId !== null && !nextIds.has(state.session.bandId);
  return {
    ...state,
    bands,
    removedSeedBandIds,
    session: activeGone ? { ...state.session, bandId: null, mp3: null, scriptSequenceDraft: null } : state.session,
  };
}

/**
 * The studio state with the server's copy of the song on the desk.
 * Only the desk's own song (same attach id) is ever refreshed; other
 * server songs are left where they are (in their rows). If the server
 * has deleted the desk's song, the desk is cleared, like its remove tap
 * does. Returns `state` itself when nothing changes.
 */
export function withServerDeskSong(state: SkidmarksState, songs: MusicVideoSongItem[]): SkidmarksState {
  const desk = songItemFromSession(state.session);
  if (!desk) return state;
  const server = songs.find((s) => s.id === desk.id);
  if (!server) {
    return { ...state, session: { ...state.session, mp3: null, scriptSequenceDraft: null } };
  }
  if (server.mp3 === desk.mp3 && server.scriptSequenceDraft === desk.scriptSequenceDraft && server.bandId === desk.bandId) {
    return state; // the engine kept this device's own copy
  }
  const bandId = server.bandId && state.bands.some((b) => b.id === server.bandId) ? server.bandId : state.session.bandId;
  return {
    ...state,
    session: { ...state.session, bandId, mp3: server.mp3, scriptSequenceDraft: server.scriptSequenceDraft },
  };
}
