"use client";

import { useEffect, useState } from "react";
import {
  buildArchiveZip,
  fetchArchiveSnapshot,
  fetchSkidmarksArchiveIndex,
  type SkidmarksArchivedSong,
} from "@/lib/skidmarksArchive";
import { triggerBlobDownload } from "@/lib/clipRenders";
import { formatDuration } from "@/lib/skidmarks";

interface SkidmarksArchiveShelfProps {
  /** Restores an archived song into the live top workspace — the
   * shelf's own job ends at fetching the row list and reporting which
   * one was tapped; the actual snapshot fetch, session restore, and
   * removing it from the archive index all happen in the caller
   * (`SkidmarksDetailSheet`), which is also the one place that knows
   * whether something else is already live and needs archiving first. */
  onOpenInEditor: (song: SkidmarksArchivedSong) => Promise<void>;
  /** Bumped by the parent right after a successful Archive (or a
   * successful "Open in editor" removal) so this shelf re-fetches the
   * index instead of polling on its own. */
  refreshToken: number;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatArchivedAt(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The page-bottom "finished songs" archive shelf — one collapsible list
 * of every song Stuart's archived, each row showing just enough to
 * recognize it (cover, title, clip/render counts, when) plus its two
 * real actions: **Open in editor** (restore it into the live top
 * workspace) and **Download project zip** (MP3 + prompts + plate
 * stills + renders + motion texts, "as practical" — see
 * `lib/skidmarksArchive.ts`'s `buildArchiveZip`).
 *
 * Per AGENTS.md's "one live edit workspace on top, never a second
 * doubled MP3/plates UI" lock: this shelf never shows a live-editable
 * copy of anything, only a static row per archived song — the *only*
 * place plates/prompts/timeline become editable again is the top
 * workspace, after "Open in editor" restores that exact song into it.
 */
export function SkidmarksArchiveShelf({ onOpenInEditor, refreshToken }: SkidmarksArchiveShelfProps) {
  const [open, setOpen] = useState(true);
  const [songs, setSongs] = useState<SkidmarksArchivedSong[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

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
      setRowError({ id: song.id, message: err instanceof Error ? err.message : "Could not open this song." });
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
    const safeName = `${song.bandName}-${song.fileName.replace(/\.[^./\\]+$/, "")}`.replace(/[^\w.-]+/g, "_");
    triggerBlobDownload(zipBlob, `${safeName}.zip`);
    setBusyId(null);
  };

  if (songs === null) return null; // still loading — no flash of an empty shelf

  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
          Finished songs
          <span aria-hidden className="ml-1.5 text-white/25">
            {"\u00b7"} {songs.length}
          </span>
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <>
          {listError && <p className="text-[11px] leading-relaxed text-amber-200/70">{listError}</p>}
          {songs.length === 0 && !listError && (
            <p className="text-[11px] leading-relaxed text-white/35">Nothing archived yet.</p>
          )}
          <div className="flex flex-col gap-2">
            {songs.map((song) => (
              <div key={song.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center gap-3">
                  {song.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data-URL cover, next/image can't optimize it
                    <img src={song.coverImage} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-sm text-white/40">
                      {"\u266b"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white/85">{song.bandName}</p>
                    <p className="truncate text-[11px] text-white/40">{song.fileName}</p>
                  </div>
                </div>

                <p className="text-[10px] text-white/35">
                  {song.clipCount} clip{song.clipCount === 1 ? "" : "s"} · {song.renderedPlateCount} rendered ·{" "}
                  {formatDuration(song.durationSec)} · archived {formatArchivedAt(song.archivedAt)}
                </p>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpen(song)}
                    disabled={busyId === song.id}
                    className="flex-1 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyId === song.id ? "Working\u2026" : "Open in editor"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadZip(song)}
                    disabled={busyId === song.id}
                    className="flex-1 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Download zip
                  </button>
                </div>

                {rowError?.id === song.id && (
                  <p role="alert" className="text-[10px] leading-snug text-rose-300/90">
                    {rowError.message}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
