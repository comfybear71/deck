import { songsShareArchiveIdentity } from "@/lib/skidmarksArchiveDedupe";
import type { SkidmarksArchivedSong } from "@/lib/skidmarksArchive";

/**
 * Library playlists: named groups of Finished Songs, saved on the
 * server (one Blob JSON, same store as the archive index) so the phone
 * and the PC see the same playlists.
 *
 * Each entry keeps the archived song's id AND its band + MP3 filename.
 * Re-archiving a song can give it a new id (the archive keeps one row
 * per band + filename), so a playlist still finds it by band + filename.
 */
export interface SkidmarksPlaylistEntry {
  songId: string;
  bandId: string;
  fileName: string;
}

export interface SkidmarksPlaylist {
  id: string;
  name: string;
  entries: SkidmarksPlaylistEntry[];
  createdAt: number;
  updatedAt: number;
}

export type PlaylistAction =
  | { action: "create"; name: string; entry?: SkidmarksPlaylistEntry }
  | { action: "rename"; playlistId: string; name: string }
  | { action: "delete"; playlistId: string }
  | { action: "add"; playlistId: string; entry: SkidmarksPlaylistEntry }
  | { action: "remove"; playlistId: string; entry: SkidmarksPlaylistEntry };

export const PLAYLIST_NAME_MAX = 60;

export function cleanPlaylistName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, PLAYLIST_NAME_MAX);
  return name.length > 0 ? name : null;
}

function isEntry(value: unknown): value is SkidmarksPlaylistEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.songId === "string" && typeof v.bandId === "string" && typeof v.fileName === "string";
}

export function isPlaylistShape(value: unknown): value is SkidmarksPlaylist {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.entries) &&
    v.entries.every(isEntry) &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number"
  );
}

export function entryForSong(song: Pick<SkidmarksArchivedSong, "id" | "bandId" | "fileName">): SkidmarksPlaylistEntry {
  return { songId: song.id, bandId: song.bandId, fileName: song.fileName };
}

function sameEntry(a: SkidmarksPlaylistEntry, b: SkidmarksPlaylistEntry): boolean {
  return a.songId === b.songId || songsShareArchiveIdentity(a, b);
}

/** Parse a POST body into an action, or null if it's malformed. */
export function parsePlaylistAction(body: unknown): PlaylistAction | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const playlistId = typeof b.playlistId === "string" && b.playlistId ? b.playlistId : null;
  switch (b.action) {
    case "create": {
      const name = cleanPlaylistName(b.name);
      if (!name) return null;
      if (b.entry !== undefined && !isEntry(b.entry)) return null;
      return { action: "create", name, entry: b.entry as SkidmarksPlaylistEntry | undefined };
    }
    case "rename": {
      const name = cleanPlaylistName(b.name);
      return playlistId && name ? { action: "rename", playlistId, name } : null;
    }
    case "delete":
      return playlistId ? { action: "delete", playlistId } : null;
    case "add":
    case "remove":
      return playlistId && isEntry(b.entry) ? { action: b.action, playlistId, entry: b.entry } : null;
    default:
      return null;
  }
}

/**
 * Apply one change and return the new list. Pure, so the route and the
 * tests share it. Unknown playlist ids leave the list unchanged. Adding
 * a song that's already in the playlist is a no-op (no duplicates).
 */
export function applyPlaylistAction(
  playlists: SkidmarksPlaylist[],
  change: PlaylistAction,
  now: number,
  newId: () => string
): SkidmarksPlaylist[] {
  if (change.action === "create") {
    return [
      {
        id: newId(),
        name: change.name,
        entries: change.entry ? [change.entry] : [],
        createdAt: now,
        updatedAt: now,
      },
      ...playlists,
    ];
  }
  if (change.action === "delete") {
    return playlists.filter((p) => p.id !== change.playlistId);
  }
  return playlists.map((p) => {
    if (p.id !== change.playlistId) return p;
    if (change.action === "rename") return { ...p, name: change.name, updatedAt: now };
    if (change.action === "add") {
      if (p.entries.some((e) => sameEntry(e, change.entry))) return p;
      return { ...p, entries: [...p.entries, change.entry], updatedAt: now };
    }
    return { ...p, entries: p.entries.filter((e) => !sameEntry(e, change.entry)), updatedAt: now };
  });
}

/** The Library songs in this playlist, in playlist order. Entries whose song was deleted from Library are skipped. */
export function songsInPlaylist(playlist: SkidmarksPlaylist, songs: SkidmarksArchivedSong[]): SkidmarksArchivedSong[] {
  const out: SkidmarksArchivedSong[] = [];
  for (const entry of playlist.entries) {
    const song =
      songs.find((s) => s.id === entry.songId) ??
      songs.find((s) => songsShareArchiveIdentity(s, entry));
    if (song && !out.includes(song)) out.push(song);
  }
  return out;
}

export function playlistHasSong(playlist: SkidmarksPlaylist, song: SkidmarksArchivedSong): boolean {
  return playlist.entries.some((e) => sameEntry(e, entryForSong(song)));
}

const PLAYLISTS_ENDPOINT = "/api/skidmarks/playlists";

export type PlaylistsOutcome =
  | { ok: true; playlists: SkidmarksPlaylist[] }
  | { ok: false; playlists: SkidmarksPlaylist[]; message: string };

async function readOutcome(res: Response): Promise<PlaylistsOutcome> {
  let body: { configured?: unknown; playlists?: unknown; error?: unknown } | null = null;
  try {
    body = await res.json();
  } catch {
    // handled below
  }
  if (!res.ok || !body || body.configured !== true) {
    return {
      ok: false,
      playlists: [],
      message: typeof body?.error === "string" ? body.error : `Playlists unavailable (${res.status}).`,
    };
  }
  const playlists = Array.isArray(body.playlists) ? body.playlists.filter(isPlaylistShape) : [];
  return { ok: true, playlists };
}

export async function fetchSkidmarksPlaylists(): Promise<PlaylistsOutcome> {
  try {
    return await readOutcome(await fetch(PLAYLISTS_ENDPOINT, { cache: "no-store" }));
  } catch (err) {
    return { ok: false, playlists: [], message: err instanceof Error ? err.message : "Network error." };
  }
}

export async function mutateSkidmarksPlaylists(change: PlaylistAction): Promise<PlaylistsOutcome> {
  try {
    const res = await fetch(PLAYLISTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    return await readOutcome(res);
  } catch (err) {
    return { ok: false, playlists: [], message: err instanceof Error ? err.message : "Network error." };
  }
}
