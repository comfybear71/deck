/**
 * Finished Songs is one row per attached song file, not a stack of
 * checkpoints. Same band + same MP3 filename = the same song. A later
 * Archive replaces the older card; the next shelf load also collapses
 * copies already sitting in the index (My Best Friend listed three
 * times, Simulation.mp3 twice, etc.).
 *
 * When collapsing existing copies, keep the one with more work — more
 * rendered plates, then more clips, then the newer timestamp — so the
 * 20-render Simulation instruments row wins over the 16-render one,
 * and Simulation.mp3's 23/23 wins over the empty 11/0 pair. A fresh
 * Archive of that file still replaces with whatever is on the desk.
 */

export interface ArchiveIdentityFields {
  id: string;
  bandId: string;
  fileName: string;
  archivedAt: number;
  clipCount: number;
  renderedPlateCount: number;
}

export function normalizeArchiveFileName(fileName: string): string {
  return fileName.trim().replace(/\s+/g, " ").toLowerCase();
}

export function archiveSongIdentity(bandId: string, fileName: string): string {
  return `${bandId}\u0000${normalizeArchiveFileName(fileName)}`;
}

function identityKey(song: { id: string; bandId?: unknown; fileName?: unknown }): string {
  if (typeof song.bandId === "string" && typeof song.fileName === "string") {
    return archiveSongIdentity(song.bandId, song.fileName);
  }
  return `\u0001${song.id}`;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** True when `a` should replace `b` as the one kept row for that song. */
export function isBetterArchivedSong(
  a: { id: string; archivedAt?: unknown; clipCount?: unknown; renderedPlateCount?: unknown },
  b: { id: string; archivedAt?: unknown; clipCount?: unknown; renderedPlateCount?: unknown }
): boolean {
  const aRenders = numeric(a.renderedPlateCount);
  const bRenders = numeric(b.renderedPlateCount);
  if (aRenders !== bRenders) return aRenders > bRenders;
  const aClips = numeric(a.clipCount);
  const bClips = numeric(b.clipCount);
  if (aClips !== bClips) return aClips > bClips;
  const aAt = numeric(a.archivedAt);
  const bAt = numeric(b.archivedAt);
  if (aAt !== bAt) return aAt > bAt;
  return a.id > b.id;
}

export function collapseArchivedSongsByIdentity<
  T extends { id: string; bandId?: unknown; fileName?: unknown; archivedAt?: unknown; clipCount?: unknown; renderedPlateCount?: unknown },
>(songs: T[]): { kept: T[]; dropped: T[] } {
  const best = new Map<string, T>();
  for (const song of songs) {
    const key = identityKey(song);
    const current = best.get(key);
    if (!current || isBetterArchivedSong(song, current)) {
      best.set(key, song);
    }
  }

  const kept: T[] = [];
  const dropped: T[] = [];
  const keptKeys = new Set<string>();
  for (const song of songs) {
    const key = identityKey(song);
    const winner = best.get(key);
    if (winner && song.id === winner.id && !keptKeys.has(key)) {
      kept.push(song);
      keptKeys.add(key);
    } else {
      dropped.push(song);
    }
  }
  return { kept, dropped };
}

export function songsShareArchiveIdentity(
  a: { bandId?: unknown; fileName?: unknown },
  b: { bandId?: unknown; fileName?: unknown }
): boolean {
  if (typeof a.bandId !== "string" || typeof a.fileName !== "string") return false;
  if (typeof b.bandId !== "string" || typeof b.fileName !== "string") return false;
  return archiveSongIdentity(a.bandId, a.fileName) === archiveSongIdentity(b.bandId, b.fileName);
}
