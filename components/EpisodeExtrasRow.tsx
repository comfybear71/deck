"use client";

import { useState, useSyncExternalStore, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { EditGlyph, TILE_CORNER_BUTTON_CLASS, TrashGlyph } from "@/components/TileCornerGlyphs";
import type { DeckGenre } from "@/lib/deckMediaPaths";
import {
  EPISODE_EXTRA_ACCEPT,
  EPISODE_EXTRA_NAME_MAX,
  EPISODE_EXTRA_PLACEMENT_MAX,
  episodeExtraExtensionFor,
  episodeExtrasFor,
  formatEpisodeExtraSize,
  suggestedEpisodeExtraName,
  type EpisodeExtra,
} from "@/lib/episodeExtras";
import { episodeExtrasProjectFor, pinEpisodeExtrasFolder } from "@/lib/episodeExtrasProject";
import { uploadEpisodeExtra } from "@/lib/episodeExtrasUpload";
import {
  addEpisodeExtra,
  editEpisodeExtra,
  getEpisodeExtrasState,
  getSkidmarksSnapshot,
  removeEpisodeExtra,
  subscribeSkidmarks,
} from "@/lib/skidmarks";

export type EpisodeExtrasNotice = { text: string; tone: "ok" | "warn" | "error" } | null;

/** An upload in progress, shown as its own card until it lands. */
export interface EpisodeExtraUploadView {
  name: string;
  percentage: number;
}

/**
 * The EXTRAS row itself, drawn from props (so a test can draw it): one
 * sideways line of square cards, the dotted + tile at the far right, the
 * same shape as the EPISODES row. A filled card plays its file; the bin
 * (top left, two taps) takes it off the episode; the pencil (top right)
 * edits its name and placement note. The + tile is a real file input
 * inside a label, which is what opens the picker on iPhone Safari.
 */
export function EpisodeExtrasCards({
  extras,
  uploading,
  confirmDeleteId,
  canAdd,
  blockedReason,
  notice,
  onPlay,
  onEdit,
  onDelete,
  onPick,
}: {
  extras: readonly EpisodeExtra[];
  uploading: EpisodeExtraUploadView | null;
  confirmDeleteId: string | null;
  canAdd: boolean;
  blockedReason: string | null;
  notice: EpisodeExtrasNotice;
  onPlay: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onPick: (file: File) => void;
}) {
  const locked = Boolean(uploading);
  return (
    <section aria-label="Extras" className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2.5">
        <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-white/40">
          Extras
          <span aria-hidden className="ml-1.5 text-white/25">
            {"\u00b7"} {extras.length}
          </span>
        </p>
        <p className="mt-0.5 text-[10px] text-white/35">Outside clips and sounds for the edit. Never rendered, no cost.</p>
      </div>
      <div className="flex touch-pan-x touch-pan-y items-start gap-3 overflow-x-auto py-1 pl-0.5 pr-1 [scrollbar-width:thin]">
        {extras.map((extra) => {
          const confirming = confirmDeleteId === extra.id;
          return (
            <div key={extra.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => onPlay(extra.id)}
                aria-label={`Play ${extra.name}`}
                className="relative block h-28 w-28 touch-manipulation overflow-hidden rounded-2xl bg-gradient-to-br from-sky-300/20 via-indigo-400/10 to-zinc-900 text-left ring-1 ring-inset ring-white/10"
              >
                {extra.kind === "video" ? (
                  <video
                    src={`${extra.url}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <span aria-hidden className="absolute inset-0 flex items-center justify-center pb-6 text-3xl text-white/50">
                    {"\u266a"}
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4">
                  <span className="block truncate text-[11px] font-semibold text-white">{extra.name}</span>
                  <span className="block truncate text-[9px] text-white/60">
                    {extra.placement || `${extra.ext.toUpperCase()} \u00b7 no placement yet`}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(extra.id)}
                disabled={locked}
                aria-label={confirming ? `Tap again to delete ${extra.name}` : `Delete ${extra.name}`}
                title="Delete extra"
                className={`${TILE_CORNER_BUTTON_CLASS} left-1.5 top-1.5 ${
                  confirming ? "bg-red-500/80 text-white" : "bg-black/50 text-white/70 hover:bg-red-500/60"
                }`}
              >
                <TrashGlyph />
              </button>
              <button
                type="button"
                onClick={() => onEdit(extra.id)}
                disabled={locked}
                aria-label={`Edit ${extra.name}`}
                title="Edit name and placement"
                className={`${TILE_CORNER_BUTTON_CLASS} right-1.5 top-1.5 bg-black/50 text-white/80 hover:bg-black/70`}
              >
                <EditGlyph />
              </button>
            </div>
          );
        })}
        {uploading && (
          <div
            role="status"
            aria-label={`Uploading ${uploading.name}, ${uploading.percentage}%`}
            className="relative flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl bg-white/[0.04] px-2 ring-1 ring-inset ring-sky-300/40"
          >
            <span className="w-full truncate text-center text-[11px] font-semibold text-white">{uploading.name}</span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <span className="block h-full bg-sky-300" style={{ width: `${Math.max(2, uploading.percentage)}%` }} />
            </span>
            <span className="text-[10px] text-white/60">{uploading.percentage}%</span>
          </div>
        )}
        <label
          aria-label="Add an extra"
          aria-disabled={!canAdd || locked}
          className={`flex h-28 w-28 shrink-0 touch-manipulation flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/25 bg-white/[0.02] transition-colors ${
            !canAdd || locked ? "opacity-50" : "cursor-pointer hover:border-sky-300/40 hover:bg-sky-300/[0.04] active:scale-[0.98]"
          }`}
        >
          <input
            type="file"
            accept={EPISODE_EXTRA_ACCEPT}
            disabled={!canAdd || locked}
            className="sr-only"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              // Cleared so picking the same file again still fires.
              e.target.value = "";
              if (file) onPick(file);
            }}
          />
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-base text-white/50">+</span>
          <span className="text-[11px] font-medium tracking-wide text-white/50">Add</span>
        </label>
      </div>
      {!canAdd && blockedReason && <p className="mt-1.5 text-[11px] leading-snug text-white/45">{blockedReason}</p>}
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-1.5 text-[11px] leading-snug ${
            notice.tone === "error" ? "text-rose-300/90" : notice.tone === "warn" ? "text-amber-200/90" : "text-emerald-200/90"
          }`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}

type SheetState =
  | { mode: "new"; file: File; name: string; placement: string }
  | { mode: "edit"; id: string; name: string; placement: string }
  | null;

/** Name + placement note, for a new file or an existing extra. Portal to
 * `document.body` so it sits over everything on iPhone Safari. */
function ExtraDetailsSheet({
  sheet,
  onChange,
  onSave,
  onCancel,
}: {
  sheet: NonNullable<SheetState>;
  onChange: (patch: { name?: string; placement?: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const title = sheet.mode === "new" ? "Add an extra" : "Edit extra";
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <form
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-900 p-4 text-white shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <p className="text-sm font-semibold">{title}</p>
        {sheet.mode === "new" && (
          <p className="truncate text-[11px] text-white/50">
            {sheet.file.name} {"\u00b7"} {formatEpisodeExtraSize(sheet.file.size)}
          </p>
        )}
        <label className="flex flex-col gap-1 text-[11px] text-white/60">
          Name
          <input
            value={sheet.name}
            onChange={(e) => onChange({ name: e.target.value })}
            maxLength={EPISODE_EXTRA_NAME_MAX}
            placeholder="container drop"
            autoCapitalize="none"
            className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-base text-white placeholder:text-white/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-white/60">
          Where it goes
          <input
            value={sheet.placement}
            onChange={(e) => onChange({ placement: e.target.value })}
            maxLength={EPISODE_EXTRA_PLACEMENT_MAX}
            placeholder="Act III between 8 and 9"
            className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-base text-white placeholder:text-white/30"
          />
        </label>
        <p className="text-[10px] leading-snug text-white/40">
          {sheet.mode === "new"
            ? "Saved with this episode's clips. It goes in the episode zip, never into the acts."
            : "The file keeps its name in storage; the new name is used on the card and in the zip."}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-10 rounded-md px-3 text-xs text-white/60 hover:text-white">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!sheet.name.trim()}
            className="h-10 rounded-md bg-sky-300 px-4 text-xs font-semibold text-zinc-950 disabled:opacity-40"
          >
            {sheet.mode === "new" ? "Upload" : "Save"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** Plays an extra full screen. Portal to `document.body` (iOS). */
function ExtraLightbox({ extra, onClose }: { extra: EpisodeExtra; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${extra.name}`}
      onClick={onClose}
    >
      <div className="flex w-full max-w-3xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        {extra.kind === "video" ? (
          <video src={extra.url} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-xl bg-black" />
        ) : (
          <audio src={extra.url} controls autoPlay className="w-full" />
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{extra.name}</p>
            <p className="truncate text-[11px] text-white/60">{extra.placement || "No placement note"}</p>
          </div>
          <button type="button" onClick={onClose} className="h-10 shrink-0 rounded-md border border-white/20 px-4 text-xs text-white/80">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Episode Extras (2026-10-04, Stuart): the same row in every genre's
 * episode screen (Sunnybank, Skidmarks, Shorts, Music video), below the
 * acts/script. Outside video or audio files kept with the episode, with
 * a name and a placement note; saved next to the episode's clips in
 * Blob and in the session, played in a lightbox, and put in the episode
 * zip's `extras/` folder. Never rendered, never billed. See
 * `lib/episodeExtras.ts`.
 */
export function EpisodeExtrasRow({ genre }: { genre: DeckGenre }) {
  const state = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const project = episodeExtrasProjectFor(state, genre);
  const extras = episodeExtrasFor(getEpisodeExtrasState(state), project.folder);
  const [notice, setNotice] = useState<EpisodeExtrasNotice>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<EpisodeExtraUploadView | null>(null);
  const playing = extras.find((x) => x.id === playingId) ?? null;

  const pick = (file: File) => {
    setConfirmDeleteId(null);
    if (!episodeExtraExtensionFor(file.name, file.type)) {
      setNotice({ text: "That file isn't a video (mp4, mov, webm) or audio file (mp3, wav).", tone: "error" });
      return;
    }
    setNotice(null);
    setSheet({ mode: "new", file, name: suggestedEpisodeExtraName(file.name), placement: "" });
  };

  const save = async () => {
    if (!sheet) return;
    if (sheet.mode === "edit") {
      if (project.folder) editEpisodeExtra(project.folder, sheet.id, { name: sheet.name, placement: sheet.placement });
      setNotice({ text: `Saved "${sheet.name.trim()}".`, tone: "ok" });
      setSheet(null);
      return;
    }
    const folder = pinEpisodeExtrasFolder(getSkidmarksSnapshot(), genre);
    if (!folder) {
      setNotice({ text: project.blockedReason ?? "This episode has no folder yet.", tone: "warn" });
      setSheet(null);
      return;
    }
    const { file, name, placement } = sheet;
    setSheet(null);
    setUploading({ name: name.trim(), percentage: 0 });
    setNotice({ text: `Uploading "${name.trim()}"…`, tone: "ok" });
    const outcome = await uploadEpisodeExtra({
      file,
      name,
      placement,
      episodeFolder: folder,
      takenIds: episodeExtrasFor(getEpisodeExtrasState(), folder).map((x) => x.id),
      onProgress: (percentage) => setUploading({ name: name.trim(), percentage }),
    });
    setUploading(null);
    if (!outcome.ok) {
      setNotice({ text: outcome.error, tone: "error" });
      return;
    }
    addEpisodeExtra(folder, outcome.extra);
    setNotice({ text: `Added "${outcome.extra.name}" (${outcome.extra.pathname.split("/").pop()}).`, tone: "ok" });
  };

  const remove = (id: string) => {
    const extra = extras.find((x) => x.id === id);
    if (!extra || !project.folder || uploading) return;
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setNotice({ text: `Tap the bin again to delete "${extra.name}". Its file stays in storage.`, tone: "warn" });
      return;
    }
    setConfirmDeleteId(null);
    removeEpisodeExtra(project.folder, id);
    setNotice({ text: `Deleted "${extra.name}".`, tone: "ok" });
  };

  return (
    <>
      <EpisodeExtrasCards
        extras={extras}
        uploading={uploading}
        confirmDeleteId={confirmDeleteId}
        canAdd={project.canAdd}
        blockedReason={project.blockedReason}
        notice={notice}
        onPlay={(id) => {
          setConfirmDeleteId(null);
          setPlayingId(id);
        }}
        onEdit={(id) => {
          setConfirmDeleteId(null);
          const extra = extras.find((x) => x.id === id);
          if (extra) setSheet({ mode: "edit", id, name: extra.name, placement: extra.placement });
        }}
        onDelete={remove}
        onPick={pick}
      />
      {sheet && (
        <ExtraDetailsSheet
          sheet={sheet}
          onChange={(patch) => setSheet((s) => (s ? { ...s, ...patch } : s))}
          onSave={() => void save()}
          onCancel={() => setSheet(null)}
        />
      )}
      {playing && <ExtraLightbox extra={playing} onClose={() => setPlayingId(null)} />}
    </>
  );
}
