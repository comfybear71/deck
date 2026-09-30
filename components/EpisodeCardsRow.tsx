"use client";

import { DownloadGlyph, EditGlyph, TILE_CORNER_BUTTON_CLASS, TrashGlyph } from "@/components/TileCornerGlyphs";

/** One card on an EPISODES row. */
export interface EpisodeCardView {
  id: string;
  label: string;
  /** The small line under the label ("5 shots · 4 clips"). */
  sub: string;
  /** The first finished clip, shown as the thumbnail. */
  clipUrl: string | null;
  /** The episode open in the editor. */
  active: boolean;
}

export type EpisodeRowNotice = { text: string; tone: "ok" | "warn" | "error" } | null;

/**
 * The EPISODES row itself (2026-09-30): a sideways row of square cards
 * with the dotted "+ New" tile on the far right. Each card has the same
 * round corner buttons as a band tile: the bin (top left, two taps), the
 * pencil (top right, open and jump to the editor) and the download icon
 * under it (the episode zip). Shared by Sunnybank
 * (`SunnyBanksEpisodeRow`) and Shorts (`ShortsEpisodeRow`), so both rows
 * look and work the same; each genre only says what its cards are and
 * what the taps do.
 */
export function EpisodeCardsRow({
  cards,
  busy,
  confirmDeleteId,
  downloadingId,
  notice,
  onOpen,
  onEdit,
  onDelete,
  onDownload,
  onNew,
}: {
  cards: readonly EpisodeCardView[];
  busy: boolean;
  confirmDeleteId: string | null;
  downloadingId: string | null;
  notice: EpisodeRowNotice;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div>
      <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">Episodes</p>
      <div className="flex touch-pan-x touch-pan-y items-start gap-3 overflow-x-auto py-1 pl-0.5 pr-1 [scrollbar-width:thin]">
        {cards.map((card) => {
          const confirming = confirmDeleteId === card.id;
          const downloading = downloadingId === card.id;
          return (
            <div key={card.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => onOpen(card.id)}
                disabled={busy}
                aria-label={`Open ${card.label}`}
                aria-pressed={card.active}
                className={`relative block h-28 w-28 touch-manipulation overflow-hidden rounded-2xl bg-gradient-to-br from-amber-300/25 via-orange-400/15 to-zinc-900 text-left disabled:opacity-60 ${
                  card.active ? "ring-2 ring-inset ring-amber-300" : "ring-1 ring-inset ring-white/10"
                }`}
              >
                {card.clipUrl && (
                  <video
                    src={`${card.clipUrl}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4">
                  <span className="block truncate text-[11px] font-semibold text-white">{card.label}</span>
                  <span className="block truncate text-[9px] text-white/60">{card.sub}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(card.id)}
                disabled={busy}
                aria-label={confirming ? `Tap again to delete ${card.label}` : `Delete ${card.label}`}
                title="Delete episode"
                className={`${TILE_CORNER_BUTTON_CLASS} left-1.5 top-1.5 ${
                  confirming ? "bg-red-500/80 text-white" : "bg-black/50 text-white/70 hover:bg-red-500/60"
                }`}
              >
                <TrashGlyph />
              </button>
              <button
                type="button"
                onClick={() => onEdit(card.id)}
                disabled={busy}
                aria-label={`Edit ${card.label}`}
                title="Open in the editor"
                className={`${TILE_CORNER_BUTTON_CLASS} right-1.5 top-1.5 bg-black/50 text-white/80 hover:bg-black/70`}
              >
                <EditGlyph />
              </button>
              <button
                type="button"
                onClick={() => onDownload(card.id)}
                disabled={busy}
                aria-label={`Download ${card.label} (.zip)`}
                title="Download episode (.zip)"
                className={`${TILE_CORNER_BUTTON_CLASS} right-1.5 top-9 bg-black/50 text-white/80 hover:bg-black/70`}
              >
                {downloading ? (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/70" aria-hidden />
                ) : (
                  <DownloadGlyph />
                )}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          aria-label="New episode"
          className="flex h-28 w-28 shrink-0 touch-manipulation flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/25 bg-white/[0.02] transition-colors hover:border-amber-300/40 hover:bg-amber-300/[0.04] active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-base text-white/50">
            +
          </span>
          <span className="text-[11px] font-medium tracking-wide text-white/50">New</span>
        </button>
      </div>
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-1.5 text-[11px] leading-snug ${
            notice.tone === "error"
              ? "text-rose-300/90"
              : notice.tone === "warn"
                ? "text-amber-200/90"
                : "text-emerald-200/90"
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
