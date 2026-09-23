"use client";

import { SkidmarksConfirmDialog } from "./SkidmarksConfirmDialog";
import { useEffect, useState } from "react";
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
  /** Notify parent after a successful Delete so Create's Finished Songs shelf stays in sync. */
  onArchiveMutated?: () => void;
}

function formatArchivedAt(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * PC Library view — Suno-like Songs list backed by the same Finished
 * Songs archive APIs as `SkidmarksArchiveShelf` (index fetch, Open in
 * editor, Download zip, Delete). Phone keeps the bottom shelf; this
 * page only mounts inside the ≥1024px PC shell.
 */
export function SkidmarksLibraryPage({ onOpenInEditor, refreshToken, onArchiveMutated }: SkidmarksLibraryPageProps) {
  const [songs, setSongs] = useState<SkidmarksArchivedSong[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkidmarksArchivedSong | null>(null);

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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Library</h1>
        <p className="text-sm text-white/45">
          Finished Songs archive
          {songs !== null && (
            <span aria-hidden className="ml-1.5 text-white/30">
              {"\u00b7"} {songs.length}
            </span>
          )}
        </p>
      </header>

      {songs === null && (
        <p className="text-sm text-white/40">Loading songs…</p>
      )}

      {listError && <p className="text-sm leading-relaxed text-amber-200/70">{listError}</p>}

      {songs && songs.length === 0 && !listError && (
        <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center text-sm text-white/40">
          Nothing archived yet. Archive a song from Create to see it here.
        </p>
      )}

      {songs && songs.length > 0 && (
        <div className="flex flex-col">
          <div
            className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_5.5rem_7rem_minmax(14rem,auto)] gap-3 border-b border-white/10 px-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-white/35"
            aria-hidden
          >
            <span>Title</span>
            <span>Band</span>
            <span>Duration</span>
            <span>Archived</span>
            <span className="text-right">Actions</span>
          </div>

          <ul className="flex flex-col">
            {songs.map((song) => (
              <li
                key={song.id}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_5.5rem_7rem_minmax(14rem,auto)] items-center gap-3 border-b border-white/[0.06] px-3 py-3 transition-colors hover:bg-white/[0.03]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {song.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data-URL cover
                    <img
                      src={song.coverImage}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-base text-white/40">
                      {"\u266b"}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white/90">{song.fileName}</p>
                    <p className="truncate text-[11px] text-white/35">
                      {song.clipCount} clip{song.clipCount === 1 ? "" : "s"} · {song.renderedPlateCount}{" "}
                      rendered
                    </p>
                  </div>
                </div>

                <p className="truncate text-sm text-white/70">{song.bandName}</p>
                <p className="text-sm text-white/55">{formatDuration(song.durationSec)}</p>
                <p className="text-sm text-white/45">{formatArchivedAt(song.archivedAt)}</p>

                <div className="flex flex-wrap justify-end gap-2">
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
                  <p
                    role="alert"
                    className="col-span-full text-[12px] leading-snug text-rose-300/90"
                  >
                    {rowError.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
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
