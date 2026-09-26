"use client";

import { useEffect } from "react";
import type { DeckPcRailId } from "./DeckPcRail";
import type { SkidmarksPlaylist } from "@/lib/skidmarksPlaylists";

interface DeckMobileDrawerProps {
  open: boolean;
  active: DeckPcRailId;
  playlists: SkidmarksPlaylist[];
  activePlaylistId: string | null;
  onSelect: (id: DeckPcRailId) => void;
  onOpenPlaylist: (playlistId: string) => void;
  onClose: () => void;
  onBackToMap: () => void;
}

const ITEMS: { id: DeckPcRailId; label: string; glyph: string }[] = [
  { id: "create", label: "Create", glyph: "\uff0b" },
  { id: "library", label: "Library", glyph: "\u266b" },
];

/**
 * Phone slide-out menu for Skidmarks (Suno-style): Create, Library and
 * your playlists, sliding in from the left over the desk. The PC keeps
 * its always-visible `DeckPcRail`; this only mounts on phone/tablet.
 */
export function DeckMobileDrawer({
  open,
  active,
  playlists,
  activePlaylistId,
  onSelect,
  onOpenPlaylist,
  onClose,
  onBackToMap,
}: DeckMobileDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={["absolute inset-0 z-30", open ? "pointer-events-auto" : "pointer-events-none"].join(" ")}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={[
          "absolute inset-0 bg-black/60 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />
      <nav
        aria-label="Skidmarks menu"
        className={[
          "absolute inset-y-0 left-0 flex w-[78%] max-w-[300px] flex-col border-r border-white/10 bg-zinc-950 shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex items-center gap-2 px-4 pb-3 pt-5">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-400/15 text-sm font-semibold text-rose-300"
          >
            {"\u2665"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Skidmarks</p>
            <p className="truncate text-[11px] text-white/40">Deck</p>
          </div>
        </div>

        <ul className="flex flex-col gap-1 px-2 py-2">
          {ITEMS.map(({ id, label, glyph }) => {
            const isActive = active === id && !(id === "library" && activePlaylistId);
            return (
              <li key={id}>
                <button
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() => onSelect(id)}
                  aria-current={isActive ? "page" : undefined}
                  className={[
                    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-medium transition-colors",
                    isActive ? "bg-white/[0.08] text-white" : "text-white/60 active:bg-white/[0.06]",
                  ].join(" ")}
                >
                  <span aria-hidden className="w-5 text-center text-base text-white/50">
                    {glyph}
                  </span>
                  {label}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-white/10 px-2 pt-3">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">Playlists</p>
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2">
            {playlists.length === 0 && (
              <li className="px-3 py-2 text-[13px] text-white/35">
                None yet. Make one from Library.
              </li>
            )}
            {playlists.map((p) => {
              const isActive = active === "library" && activePlaylistId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    tabIndex={open ? 0 : -1}
                    onClick={() => onOpenPlaylist(p.id)}
                    className={[
                      "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors",
                      isActive ? "bg-white/[0.08] text-white" : "text-white/65 active:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-white/35">{p.entries.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={onBackToMap}
            className="flex w-full items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] font-medium text-white/60 active:bg-white/[0.07]"
          >
            Back to map
          </button>
        </div>
      </nav>
    </div>
  );
}
