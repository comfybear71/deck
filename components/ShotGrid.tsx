"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CastChips } from "@/components/CastChips";

/**
 * The shared SHOT GRID (Stuart, 2026-09-30): every genre's shot list as
 * compact tiles instead of long stacked rows. Each tile is the shot's
 * picture (its plate, or the clip's own first frame), with the clip over
 * it once rendered (hover plays it on a computer; the opened panel has
 * the full player), a small shot number, its status and the engine chip.
 * Two across on a phone, three or four on a computer.
 *
 * Tapping a tile opens that shot's panel under the grid, with every one
 * of its controls (the caller draws them: `renderPanel`). Tapping it again,
 * or ✕, closes it. Used by Shorts' shots and Sunnybank's act clips; purely
 * presentational, nothing here saves anything.
 *
 * `layout="split"` (Shorts only, 2026-09-30): on a tablet or computer the
 * grid is the left column and the open shot's panel the right one,
 * sticky so it stays in view while the grid scrolls; each rendered
 * tile's ▶ plays its clip right there, with sound. A phone stays stacked
 * (grid first, panel under it). Sunnybank uses the default `"stacked"`,
 * which is exactly the grid as it was.
 */

export type ShotTileStatus = "empty" | "rendering" | "rendered" | "failed";

export interface ShotTileView {
  id: string;
  /** Shown on the tile, 1-based. */
  number: number;
  /** One short line under the tile, e.g. "Shazza · 3.2s". Optional. */
  caption?: string;
  /** The plate / still. */
  pictureUrl: string | null;
  clipUrl: string | null;
  status: ShotTileStatus;
  /** Overrides the status words, e.g. "Making plate…". */
  statusText?: string;
  /** The engine chip, e.g. `[SIRAY]`. */
  engine?: { label: string; title?: string } | null;
  /** Who is in the shot when it's two or more people (2026-10-03): drawn as chips under the tile. */
  cast?: { names: readonly string[]; missing?: readonly string[] } | null;
}

const STATUS_TEXT: Record<ShotTileStatus, string> = {
  empty: "No clip",
  rendering: "Rendering…",
  rendered: "Rendered",
  failed: "Failed",
};

const STATUS_DOT: Record<ShotTileStatus, string> = {
  empty: "bg-white/30",
  rendering: "animate-pulse bg-amber-300",
  rendered: "bg-emerald-400",
  failed: "bg-red-400",
};

/** The grid's own classes, exported for tests and anything that needs to line up with it. */
export const SHOT_GRID_CLASS = "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4";
/** The grid in the left column of `layout="split"`: two across, three on a wide screen. */
export const SHOT_GRID_SPLIT_CLASS = "grid grid-cols-2 gap-2 xl:grid-cols-3";
/** `layout="split"`'s two columns from tablet width up (phone: stacked). */
export const SHOT_GRID_SPLIT_WRAP_CLASS = "flex flex-col gap-2 md:grid md:grid-cols-2 md:items-start md:gap-3";
/** The open panel in `layout="split"`: sticky in the right column from tablet width up. */
export const SHOT_GRID_SPLIT_PANEL_CLASS = "md:sticky md:top-2 md:max-h-[calc(100dvh-7rem)] md:overflow-y-auto";

export type ShotGridLayout = "stacked" | "split";

/** The split layout only splits from `md` (768px) up. */
function isSplitWide(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-width: 768px)").matches;
}

/** iOS Safari only draws a video's first frame once it's asked for a time. */
function previewSrc(url: string, hasPoster: boolean): string {
  return hasPoster || url.includes("#") ? url : `${url}#t=0.1`;
}

function ShotTile({
  tile,
  open,
  onToggle,
  labelPrefix,
  inlinePlay = false,
}: {
  tile: ShotTileView;
  open: boolean;
  onToggle: () => void;
  labelPrefix: string;
  /** The ▶ plays the clip in the tile, with sound (split layout). */
  inlinePlay?: boolean;
}) {
  const status = tile.statusText ?? STATUS_TEXT[tile.status];
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused && playing) {
      v.pause();
      return;
    }
    v.muted = false;
    v.loop = false;
    void v.play().catch(() => setPlaying(false));
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* Holds the tile and its ▶ in the split layout; lays out as nothing at all otherwise. */}
      <div className={inlinePlay ? "relative" : "contents"}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${labelPrefix} ${tile.number}: ${status}. ${open ? "Close" : "Open"}`}
          className={[
            "relative block aspect-video w-full touch-manipulation overflow-hidden rounded-lg border bg-black/40 text-left [-webkit-tap-highlight-color:transparent]",
            open ? "border-sky-400/80 ring-2 ring-sky-400/50" : "border-white/10 hover:border-white/25",
          ].join(" ")}
        >
          {tile.clipUrl ? (
            <video
              ref={videoRef}
              src={previewSrc(tile.clipUrl, Boolean(tile.pictureUrl))}
              poster={tile.pictureUrl ?? undefined}
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden
              onMouseEnter={(e) => {
                if (!playing) void e.currentTarget.play().catch(() => {});
              }}
              onMouseLeave={(e) => {
                if (!playing) e.currentTarget.pause();
              }}
              onPlay={(e) => {
                if (!e.currentTarget.muted) setPlaying(true);
              }}
              onPause={(e) => {
                setPlaying(false);
                e.currentTarget.muted = true;
                e.currentTarget.loop = true;
              }}
              onEnded={() => setPlaying(false)}
              className="h-full w-full object-cover"
            />
          ) : tile.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tile.pictureUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[11px] text-white/30">No plate</span>
          )}
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white/90">{tile.number}</span>
          {tile.engine && (
            <span title={tile.engine.title} className="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-bold tracking-wide text-red-400">
              {tile.engine.label}
            </span>
          )}
          <span className="absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/85">
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[tile.status]}`} />
            <span className="truncate">{status}</span>
          </span>
          {tile.clipUrl && !inlinePlay && (
            <span aria-hidden className="absolute bottom-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white/85">
              ▶
            </span>
          )}
        </button>
        {tile.clipUrl && inlinePlay && (
          // Its own button beside the tile's (a button can't hold a button):
          // plays the clip right in the tile, with sound.
          <button
            type="button"
            onClick={togglePlay}
            aria-label={`${playing ? "Pause" : "Play"} ${labelPrefix.toLowerCase()} ${tile.number}`}
            className="absolute bottom-1 right-1 flex h-7 w-7 touch-manipulation items-center justify-center rounded-full bg-black/75 text-[11px] text-white hover:bg-black"
          >
            {playing ? "❚❚" : "▶"}
          </button>
        )}
      </div>
      {tile.caption && <p className="truncate px-0.5 text-[11px] leading-tight text-white/60">{tile.caption}</p>}
      {tile.cast && tile.cast.names.length > 1 && (
        <CastChips names={tile.cast.names} missing={tile.cast.missing} className="px-0.5" />
      )}
    </div>
  );
}

export function ShotGrid({
  tiles,
  openId,
  onToggle,
  renderPanel,
  onAdd,
  addLabel = "+ Add shot",
  labelPrefix = "Shot",
  panelTitle,
  layout = "stacked",
  emptyPanelHint,
}: {
  tiles: readonly ShotTileView[];
  /** The open tile, or `null`. */
  openId: string | null;
  /** Tap on a tile: open it, or close it when it's the open one (`null`). */
  onToggle: (id: string | null) => void;
  /** Every control for one shot, drawn under the grid when it's open. */
  renderPanel: (id: string) => ReactNode;
  /** A dotted tile at the end that adds a shot. Absent = no add tile. */
  onAdd?: () => void;
  addLabel?: string;
  /** "Shot" → "Shot 3". */
  labelPrefix?: string;
  /** The panel's heading; default "<labelPrefix> <number>". */
  panelTitle?: (tile: ShotTileView) => ReactNode;
  /** `"split"`: grid left, sticky panel right from tablet width up (Shorts). Default `"stacked"`. */
  layout?: ShotGridLayout;
  /** Split layout, nothing open: a hint in the right column (tablet width up). */
  emptyPanelHint?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const open = openId ? (tiles.find((t) => t.id === openId) ?? null) : null;
  const split = layout === "split";
  useEffect(() => {
    if (!openId) return;
    // Bring the panel into view on a phone, where it sits under the grid.
    // In the split layout on a wider screen it's already beside the grid.
    if (split && isSplitWide()) return;
    panelRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
    });
  }, [openId, split]);
  return (
    <div className={split ? SHOT_GRID_SPLIT_WRAP_CLASS : "flex flex-col gap-2"}>
      <div className={split ? SHOT_GRID_SPLIT_CLASS : SHOT_GRID_CLASS}>
        {tiles.map((tile) => (
          <ShotTile
            key={tile.id}
            tile={tile}
            open={tile.id === openId}
            onToggle={() => onToggle(tile.id === openId ? null : tile.id)}
            labelPrefix={labelPrefix}
            inlinePlay={split}
          />
        ))}
        {onAdd && (
          <div className="flex min-w-0 flex-col gap-1">
            <button
              type="button"
              onClick={onAdd}
              className="flex aspect-video w-full touch-manipulation items-center justify-center rounded-lg border-2 border-dashed border-white/20 text-xs text-white/55 hover:border-white/40 hover:text-white/80"
            >
              {addLabel}
            </button>
          </div>
        )}
      </div>
      {!open && split && emptyPanelHint && (
        <p className="hidden rounded-2xl border border-dashed border-white/10 p-4 text-center text-xs text-white/35 md:block">{emptyPanelHint}</p>
      )}
      {open && (
        <div ref={panelRef} className={`scroll-mt-4 rounded-2xl border border-sky-400/25 bg-white/[0.02] p-3${split ? ` ${SHOT_GRID_SPLIT_PANEL_CLASS}` : ""}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium text-white">
              {panelTitle ? panelTitle(open) : `${labelPrefix} ${open.number}`}
              {open.engine && (
                <span title={open.engine.title} className="ml-1.5 align-middle text-[9px] font-bold tracking-wide text-red-400">
                  {open.engine.label}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => onToggle(null)}
              aria-label={`Close ${labelPrefix.toLowerCase()} ${open.number}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/50 hover:text-white"
            >
              ✕
            </button>
          </div>
          {renderPanel(open.id)}
        </div>
      )}
    </div>
  );
}
