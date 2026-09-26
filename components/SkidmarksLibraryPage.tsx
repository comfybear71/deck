"use client";

import { SkidmarksConfirmDialog } from "./SkidmarksConfirmDialog";
import { useEffect, useMemo, useState } from "react";
import {
  buildArchiveZip,
  fetchArchiveSnapshot,
  deleteSkidmarksArchivedSong,
  fetchSkidmarksArchiveIndex,
  type SkidmarksArchivedSong,
} from "@/lib/skidmarksArchive";
import { triggerBlobDownload } from "@/lib/clipRenders";
import { formatDuration } from "@/lib/skidmarks";
import {
  entryForSong,
  playlistHasSong,
  songsInPlaylist,
  type PlaylistAction,
  type SkidmarksPlaylist,
} from "@/lib/skidmarksPlaylists";

interface SkidmarksLibraryPageProps {
  /** Same restore entry point DetailSheet / ArchiveShelf use. */
  onOpenInEditor: (song: SkidmarksArchivedSong) => Promise<void>;
  /** Bumped after Archive or Open so this list re-fetches. */
  refreshToken: number;
  /** Notify parent after a successful Delete so phone shelf stays in sync if remounted. */
  onArchiveMutated?: () => void;
  /** Library playlists (shared with the phone slide-out menu). Omit to hide playlist controls. */
  playlists?: SkidmarksPlaylist[];
  playlistError?: string | null;
  onMutatePlaylists?: (change: PlaylistAction) => Promise<boolean>;
  /** Playlist being viewed (from the menu), or null for the playlist list. */
  activePlaylistId?: string | null;
  onSelectPlaylist?: (playlistId: string | null) => void;
  /** Phone layout: tighter padding, stacked row buttons. */
  compact?: boolean;
}

type LibraryTab = "songs" | "playlists" | "stills" | "episodes";

function formatArchivedAt(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function songTitle(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "") || fileName;
}

/**
 * PC Library view — Suno-like Songs list backed by the same Finished
 * Songs archive APIs as `SkidmarksArchiveShelf`. Songs tab is live;
 * Stills / Episodes are stubs for later. Phone keeps the bottom shelf.
 */
export function SkidmarksLibraryPage({
  onOpenInEditor,
  refreshToken,
  onArchiveMutated,
  playlists,
  playlistError,
  onMutatePlaylists,
  activePlaylistId = null,
  onSelectPlaylist,
  compact = false,
}: SkidmarksLibraryPageProps) {
  const playlistsEnabled = Boolean(playlists && onMutatePlaylists);
  const [songs, setSongs] = useState<SkidmarksArchivedSong[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkidmarksArchivedSong | null>(null);
  const [chosenTab, setTab] = useState<LibraryTab>("songs");
  // Opening a playlist from the menu always shows the Playlists tab.
  const tab: LibraryTab = activePlaylistId && playlistsEnabled ? "playlists" : chosenTab;
  const [query, setQuery] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [pendingPlaylistDelete, setPendingPlaylistDelete] = useState<SkidmarksPlaylist | null>(null);
  const activePlaylist = playlists?.find((p) => p.id === activePlaylistId) ?? null;

  const runPlaylistChange = async (change: PlaylistAction) => {
    if (!onMutatePlaylists || playlistBusy) return false;
    setPlaylistBusy(true);
    const ok = await onMutatePlaylists(change);
    setPlaylistBusy(false);
    return ok;
  };

  const submitNewPlaylist = async (song?: SkidmarksArchivedSong) => {
    const name = newName.trim();
    if (!name) return;
    const ok = await runPlaylistChange({ action: "create", name, entry: song ? entryForSong(song) : undefined });
    if (ok) {
      setNewName("");
      setCreating(false);
      setPickerFor(null);
    }
  };

  const performDelete = async (song: SkidmarksArchivedSong) => {
    if (busyId) return;
    setBusyId(song.id);
    setRowError(null);
    const outcome = await deleteSkidmarksArchivedSong(song.id);
    if (outcome.ok) {
      setSongs((prev) => (prev ? prev.filter((s) => s.id !== song.id) : prev));
      onArchiveMutated?.();
    } else {
      setRowError({
        id: song.id,
        message: `Couldn't delete — ${outcome.message}. The song is still in Library.`,
      });
    }
    setBusyId(null);
  };

  useEffect(() => {
    let cancelled = false;
    fetchSkidmarksArchiveIndex().then((outcome) => {
      if (cancelled) return;
      if (outcome.ok) {
        setSongs(outcome.songs);
        setListError(null);
      } else {
        setSongs([]);
        setListError(outcome.message ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const filtered = useMemo(() => {
    if (!songs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter(
      (s) =>
        s.fileName.toLowerCase().includes(q) ||
        s.bandName.toLowerCase().includes(q) ||
        songTitle(s.fileName).toLowerCase().includes(q)
    );
  }, [songs, query]);

  const handleOpen = async (song: SkidmarksArchivedSong) => {
    if (busyId) return;
    setBusyId(song.id);
    setRowError(null);
    try {
      await onOpenInEditor(song);
    } catch (err) {
      setRowError({
        id: song.id,
        message: err instanceof Error ? err.message : "Could not open this song.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDownloadZip = async (song: SkidmarksArchivedSong) => {
    if (busyId) return;
    setBusyId(song.id);
    setRowError(null);
    const snapshotOutcome = await fetchArchiveSnapshot(song.snapshotUrl);
    if (!snapshotOutcome.ok) {
      setRowError({ id: song.id, message: snapshotOutcome.message });
      setBusyId(null);
      return;
    }
    const zipOutcome = await buildArchiveZip(song, snapshotOutcome.snapshot);
    if (!zipOutcome.ok) {
      setRowError({ id: song.id, message: zipOutcome.message });
      setBusyId(null);
      return;
    }
    const zipBlob = new Blob([zipOutcome.zipBytes.slice().buffer], { type: "application/zip" });
    const safeName = `${song.bandName}-${song.fileName.replace(/\.[^./\\]+$/, "")}`.replace(
      /[^\w.-]+/g,
      "_"
    );
    triggerBlobDownload(zipBlob, `${safeName}.zip`);
    setBusyId(null);
  };

  const tabs: { id: LibraryTab; label: string; live: boolean }[] = [
    { id: "songs", label: "Songs", live: true },
    ...(playlistsEnabled ? [{ id: "playlists" as const, label: "Playlists", live: true }] : []),
    { id: "stills", label: "Stills", live: false },
    { id: "episodes", label: "Episodes", live: false },
  ];

  return (
    <div className={["mx-auto flex w-full max-w-6xl flex-col gap-5", compact ? "px-1 py-3" : "px-6 py-6"].join(" ")}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Library</h1>
          <p className="text-sm text-white/45">Finished Songs and later stills / episodes</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-0">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  if (activePlaylistId) onSelectPlaylist?.(null);
                }}
                aria-current={active ? "page" : undefined}
                className={[
                  "-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-white text-white"
                    : "border-transparent text-white/45 hover:text-white/75",
                ].join(" ")}
              >
                {t.label}
                {!t.live && (
                  <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-white/30">
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "songs" && (
          <label className="relative block max-w-md">
            <span className="sr-only">Search songs</span>
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              fill="none"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35"
            >
              <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search songs or bands"
              className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-white/25 focus:bg-white/[0.06]"
            />
          </label>
        )}
      </header>

      {tab === "playlists" && playlistsEnabled && playlistError && (
        <p className="text-sm leading-relaxed text-amber-200/70">{playlistError}</p>
      )}

      {tab === "playlists" && playlistsEnabled && !activePlaylist && (
        <div className="flex flex-col gap-3">
          {creating ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submitNewPlaylist();
              }}
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={60}
                placeholder="Playlist name"
                className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
              />
              <button
                type="submit"
                disabled={playlistBusy || !newName.trim()}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
              >
                {playlistBusy ? "Saving…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="rounded-full px-3 py-2 text-sm text-white/50"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="self-start rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/85"
            >
              + New playlist
            </button>
          )}

          {playlists!.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center text-sm text-white/40">
              No playlists yet. Make one here, or tap “+ Playlist” on any song.
            </p>
          ) : (
            <ul className="flex flex-col">
              {playlists!.map((p) => {
                const inList = songs ? songsInPlaylist(p, songs) : [];
                const cover = inList.find((s) => s.coverImage)?.coverImage;
                return (
                  <li key={p.id} className="flex items-center gap-3 border-b border-white/[0.06] px-1 py-3">
                    <button
                      type="button"
                      onClick={() => onSelectPlaylist?.(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.06] text-lg text-white/35">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element -- data-URL / blob cover
                          <img src={cover} alt="" className="h-full w-full object-cover" />
                        ) : (
                          "\u266b"
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-white/90">{p.name}</span>
                        <span className="block truncate text-[13px] text-white/45">
                          {p.entries.length} song{p.entries.length === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingPlaylistDelete(p)}
                      aria-label={`Delete playlist ${p.name}`}
                      className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-white/45"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "playlists" && playlistsEnabled && activePlaylist && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelectPlaylist?.(null)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-white/60"
            >
              {"\u2039"} All playlists
            </button>
            <h2 className="min-w-0 truncate text-lg font-semibold text-white">{activePlaylist.name}</h2>
          </div>
          {songs === null && <p className="text-sm text-white/40">Loading songs…</p>}
          {songs && songsInPlaylist(activePlaylist, songs).length === 0 && (
            <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center text-sm text-white/40">
              This playlist is empty. Go to Songs and tap “+ Playlist” on a song.
            </p>
          )}
          {songs && (
            <ul className="flex flex-col">
              {songsInPlaylist(activePlaylist, songs).map((song) => (
                <li key={song.id} className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-1 py-3">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
                    {song.coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data-URL / blob cover
                      <img src={song.coverImage} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-white/35">{"\u266b"}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white/90">{songTitle(song.fileName)}</p>
                    <p className="truncate text-[13px] text-white/50">
                      {song.bandName}
                      <span className="text-white/25"> · </span>
                      {formatDuration(song.durationSec)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpen(song)}
                      disabled={busyId === song.id}
                      className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-white/85 disabled:opacity-40"
                    >
                      {busyId === song.id ? "Working…" : "Open"}
                    </button>
                    <button
                      type="button"
                      disabled={playlistBusy}
                      onClick={() =>
                        void runPlaylistChange({ action: "remove", playlistId: activePlaylist.id, entry: entryForSong(song) })
                      }
                      className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-white/45 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                  {rowError?.id === song.id && (
                    <p role="alert" className="basis-full text-[12px] leading-snug text-rose-300/90">
                      {rowError.message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(tab === "stills" || tab === "episodes") && (
        <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center text-sm text-white/40">
          {tab === "stills"
            ? "Stills library — coming later. Plate stills stay on the Create desk for now."
            : "Episodes library — coming later. Sunnybank episode cards stay on the Create desk for now."}
        </p>
      )}

      {tab === "songs" && (
        <>
          {songs === null && <p className="text-sm text-white/40">Loading songs…</p>}

          {listError && <p className="text-sm leading-relaxed text-amber-200/70">{listError}</p>}

          {songs && songs.length === 0 && !listError && (
            <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center text-sm text-white/40">
              Nothing archived yet. Archive a song from Create to see it here.
            </p>
          )}

          {songs && songs.length > 0 && filtered.length === 0 && (
            <p className="text-sm text-white/40">No songs match “{query.trim()}”.</p>
          )}

          {filtered.length > 0 && (
            <ul className="flex flex-col">
              {filtered.map((song) => (
                <li
                  key={song.id}
                  className={[
                    "group flex items-center border-b border-white/[0.06] py-3 transition-colors hover:bg-white/[0.03]",
                    compact ? "flex-wrap gap-3 px-1" : "gap-4 px-2",
                  ].join(" ")}
                >
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
                    {song.coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data-URL / blob cover
                      <img src={song.coverImage} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-lg text-white/35">
                        {"\u266b"}
                      </span>
                    )}
                    <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white/90">
                      {formatDuration(song.durationSec)}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white/90">{songTitle(song.fileName)}</p>
                    <p className="truncate text-[13px] text-white/50">
                      {song.bandName}
                      <span className="text-white/25"> · </span>
                      {song.clipCount} clip{song.clipCount === 1 ? "" : "s"}
                      <span className="text-white/25"> · </span>
                      {song.renderedPlateCount} rendered
                      <span className="text-white/25"> · </span>
                      archived {formatArchivedAt(song.archivedAt)}
                    </p>
                    <p className="truncate text-[11px] text-white/30">{song.fileName}</p>
                  </div>

                  <div className={["flex flex-wrap gap-2", compact ? "basis-full justify-start pl-[4.25rem]" : "shrink-0 justify-end"].join(" ")}>
                    {playlistsEnabled && (
                      <button
                        type="button"
                        onClick={() => {
                          setPickerFor(pickerFor === song.id ? null : song.id);
                          setCreating(false);
                          setNewName("");
                        }}
                        aria-expanded={pickerFor === song.id}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/[0.08]"
                      >
                        + Playlist
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleOpen(song)}
                      disabled={busyId === song.id}
                      className="rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-[12px] font-medium text-white/85 transition-colors hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyId === song.id ? "Working…" : "Open in editor"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadZip(song)}
                      disabled={busyId === song.id}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Download zip
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(song)}
                      disabled={busyId === song.id}
                      aria-label={`Delete ${song.fileName} (archived ${formatArchivedAt(song.archivedAt)}) from Library`}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/45 transition-colors hover:border-rose-400/30 hover:text-rose-300/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>

                  {rowError?.id === song.id && (
                    <p role="alert" className="basis-full text-[12px] leading-snug text-rose-300/90">
                      {rowError.message}
                    </p>
                  )}

                  {playlistsEnabled && pickerFor === song.id && (
                    <div className="basis-full rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="pb-2 text-[12px] text-white/45">Add “{songTitle(song.fileName)}” to…</p>
                      <div className="flex flex-wrap gap-2">
                        {playlists!.map((p) => {
                          const has = playlistHasSong(p, song);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              disabled={playlistBusy}
                              onClick={() =>
                                void runPlaylistChange(
                                  has
                                    ? { action: "remove", playlistId: p.id, entry: entryForSong(song) }
                                    : { action: "add", playlistId: p.id, entry: entryForSong(song) }
                                )
                              }
                              aria-pressed={has}
                              className={[
                                "rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:opacity-40",
                                has ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-white/70",
                              ].join(" ")}
                            >
                              {has ? "\u2713 " : ""}
                              {p.name}
                            </button>
                          );
                        })}
                      </div>
                      <form
                        className="mt-2 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void submitNewPlaylist(song);
                        }}
                      >
                        <input
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          maxLength={60}
                          placeholder="New playlist name"
                          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-white placeholder:text-white/35 outline-none focus:border-white/25"
                        />
                        <button
                          type="submit"
                          disabled={playlistBusy || !newName.trim()}
                          className="rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-black disabled:opacity-40"
                        >
                          Create + add
                        </button>
                      </form>
                      {playlistError && <p className="pt-2 text-[12px] text-amber-200/70">{playlistError}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <SkidmarksConfirmDialog
        open={pendingPlaylistDelete !== null}
        title="Delete this playlist?"
        body={
          pendingPlaylistDelete
            ? `“${pendingPlaylistDelete.name}” (${pendingPlaylistDelete.entries.length} songs). Only the playlist is deleted. The songs stay in your Library.`
            : ""
        }
        confirmLabel="Delete playlist"
        onCancel={() => setPendingPlaylistDelete(null)}
        onConfirm={() => {
          const target = pendingPlaylistDelete;
          setPendingPlaylistDelete(null);
          if (target) {
            if (activePlaylistId === target.id) onSelectPlaylist?.(null);
            void runPlaylistChange({ action: "delete", playlistId: target.id });
          }
        }}
      />

      <SkidmarksConfirmDialog
        open={pendingDelete !== null}
        title="Delete this archived copy?"
        body={
          pendingDelete
            ? `${pendingDelete.fileName}, archived ${formatArchivedAt(pendingDelete.archivedAt)} (${pendingDelete.clipCount} clips, ${pendingDelete.renderedPlateCount} rendered). This deletes that checkpoint for good. Other copies of the same song, and whatever is on your desk, are not touched.`
            : ""
        }
        confirmLabel="Delete this copy"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void performDelete(target);
        }}
      />
    </div>
  );
}
