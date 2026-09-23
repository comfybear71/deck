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

interface SkidmarksLibraryPageProps {
  /** Same restore entry point DetailSheet / ArchiveShelf use. */
  onOpenInEditor: (song: SkidmarksArchivedSong) => Promise<void>;
  /** Bumped after Archive or Open so this list re-fetches. */
  refreshToken: number;
  /** Notify parent after a successful Delete so phone shelf stays in sync if remounted. */
  onArchiveMutated?: () => void;
}

type LibraryTab = "songs" | "stills" | "episodes";

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
export function SkidmarksLibraryPage({ onOpenInEditor, refreshToken, onArchiveMutated }: SkidmarksLibraryPageProps) {
  const [songs, setSongs] = useState<SkidmarksArchivedSong[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkidmarksArchivedSong | null>(null);
  const [tab, setTab] = useState<LibraryTab>("songs");
  const [query, setQuery] = useState("");

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
    { id: "stills", label: "Stills", live: false },
    { id: "episodes", label: "Episodes", live: false },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
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
                onClick={() => setTab(t.id)}
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

      {tab !== "songs" && (
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
                  className="group flex items-center gap-4 border-b border-white/[0.06] px-2 py-3 transition-colors hover:bg-white/[0.03]"
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

                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
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
                </li>
              ))}
            </ul>
          )}
        </>
      )}

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
