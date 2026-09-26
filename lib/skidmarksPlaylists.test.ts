import { describe, expect, it } from "vitest";
import {
  applyPlaylistAction,
  parsePlaylistAction,
  songsInPlaylist,
  type SkidmarksPlaylist,
} from "./skidmarksPlaylists";
import type { SkidmarksArchivedSong } from "./skidmarksArchive";

const song = (id: string, fileName: string, bandId = "jack-ash"): SkidmarksArchivedSong => ({
  id,
  bandId,
  bandName: "Jack Ash",
  fileName,
  archivedAt: 1,
  durationSec: 60,
  clipCount: 3,
  renderedPlateCount: 3,
  snapshotUrl: `https://blob.example/${id}.json`,
});

const entry = (s: SkidmarksArchivedSong) => ({ songId: s.id, bandId: s.bandId, fileName: s.fileName });
let n = 0;
const newId = () => `pl-${++n}`;

describe("playlists", () => {
  it("creates, adds without duplicates, removes, renames and deletes", () => {
    const a = song("a", "trapped.mp3");
    let lists: SkidmarksPlaylist[] = applyPlaylistAction([], { action: "create", name: "Road trip" }, 1, newId);
    expect(lists).toHaveLength(1);
    const id = lists[0].id;
    lists = applyPlaylistAction(lists, { action: "add", playlistId: id, entry: entry(a) }, 2, newId);
    lists = applyPlaylistAction(lists, { action: "add", playlistId: id, entry: entry(a) }, 3, newId);
    expect(lists[0].entries).toHaveLength(1);
    lists = applyPlaylistAction(lists, { action: "rename", playlistId: id, name: "Drive" }, 4, newId);
    expect(lists[0].name).toBe("Drive");
    lists = applyPlaylistAction(lists, { action: "remove", playlistId: id, entry: entry(a) }, 5, newId);
    expect(lists[0].entries).toHaveLength(0);
    lists = applyPlaylistAction(lists, { action: "delete", playlistId: id }, 6, newId);
    expect(lists).toHaveLength(0);
  });

  it("finds a re-archived song by band + filename when its id changed", () => {
    const old = song("old-id", "trapped.mp3");
    const reArchived = song("new-id", "trapped.mp3");
    const list: SkidmarksPlaylist = { id: "p", name: "x", entries: [entry(old)], createdAt: 1, updatedAt: 1 };
    expect(songsInPlaylist(list, [reArchived, song("b", "east.mp3")])).toEqual([reArchived]);
  });

  it("skips songs deleted from Library", () => {
    const list: SkidmarksPlaylist = { id: "p", name: "x", entries: [entry(song("gone", "gone.mp3"))], createdAt: 1, updatedAt: 1 };
    expect(songsInPlaylist(list, [song("b", "east.mp3")])).toEqual([]);
  });

  it("rejects malformed changes", () => {
    expect(parsePlaylistAction({ action: "create", name: "   " })).toBeNull();
    expect(parsePlaylistAction({ action: "add", playlistId: "p" })).toBeNull();
    expect(parsePlaylistAction({ action: "nuke" })).toBeNull();
    expect(parsePlaylistAction({ action: "create", name: "  Big   Sexy " })).toEqual({ action: "create", name: "Big Sexy", entry: undefined });
  });
});
