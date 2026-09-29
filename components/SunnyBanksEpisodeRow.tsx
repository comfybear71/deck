"use client";

import { useState, useSyncExternalStore } from "react";
import {
  getSkidmarksSnapshot,
  getSunnyBanksLiveOrDefault,
  deleteSunnyBanksWorkspace,
  openSunnyBanksWorkspace,
  saveSunnyBanksProjectWorkspace,
  startNewSunnyBanksEpisode,
  subscribeSkidmarks,
} from "@/lib/skidmarks";
import { getSunnyBanksBusy, setSunnyBanksBusy, subscribeSunnyBanksBusy } from "@/lib/sunnyBanksBusy";
import { DownloadGlyph, EditGlyph, TILE_CORNER_BUTTON_CLASS, TrashGlyph } from "@/components/TileCornerGlyphs";
import { downloadSunnyBanksEpisodeZip, SUNNY_BANKS_EDITOR_ID } from "@/components/SkidmarksSunnyBanksPanel";
import {
  buildEmptySunnyBanksLive,
  defaultSunnyBanksLiveFingerprint,
  describeSunnyBanksWorkspace,
  fingerprintWorkspace,
  type SunnyBanksWorkspaceSnapshot,
} from "@/lib/sunnyBanksWorkspace";

const EMPTY_LIVE_FINGERPRINT = fingerprintWorkspace(buildEmptySunnyBanksLive());

/** The first finished clip in the episode, used as its thumbnail. */
function firstClipUrl(workspace: SunnyBanksWorkspaceSnapshot): string | null {
  for (const act of workspace.actIds) {
    const rows = workspace.runtimeMap[act] ?? {};
    const indexes = Object.keys(rows)
      .map(Number)
      .sort((a, b) => a - b);
    for (const index of indexes) {
      const row = rows[index];
      if (row?.status === "done" && typeof row.videoUrl === "string" && row.videoUrl.length > 0) {
        return row.videoUrl;
      }
    }
  }
  return null;
}

/**
 * Sunny Banks episodes as a sideways row of thumbnails, right under the
 * START A PROJECT tiles (Stuart, 2026-09-30), like Music video's "Choose a
 * band" albums. Tap one to open it. The dotted + tile on the far right
 * starts a new episode.
 *
 * Each card has the same small round corner buttons as a band tile
 * (2026-09-30): the bin (top left) deletes the card after a second tap,
 * the pencil (top right) opens the episode and scrolls to the editor,
 * and the download icon under it builds the episode zip (script, gold
 * prompts and every finished clip). These replace the old "Episode
 * workspace" list, Save and Download buttons at the bottom of the panel;
 * every change is now saved onto the open card as it happens.
 *
 * Nothing on screen is ever thrown away: if the episode being worked on
 * has changes no saved card holds, it is saved first, then the other
 * episode (or a blank one) opens.
 */
export function SunnyBanksEpisodeRow() {
  const studioState = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const busy = useSyncExternalStore(subscribeSunnyBanksBusy, getSunnyBanksBusy, () => false);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" | "error" } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const live = studioState.sunnyBanks?.live ?? getSunnyBanksLiveOrDefault(studioState);
  const workspaces = studioState.sunnyBanks?.workspaces ?? [];
  const liveFingerprint = fingerprintWorkspace(live);
  const activeId =
    (live.episodeId && workspaces.some((workspace) => workspace.id === live.episodeId) ? live.episodeId : null) ??
    workspaces.find((workspace) => workspace.fingerprint === liveFingerprint)?.id ??
    null;

  const say = (text: string, tone: "ok" | "warn" | "error" = "ok") => setNotice({ text, tone });

  /** Save what's on screen first when no saved card already holds it. */
  const keepLiveWork = (): string | null => {
    if (activeId) return null;
    if (liveFingerprint === EMPTY_LIVE_FINGERPRINT || liveFingerprint === defaultSunnyBanksLiveFingerprint()) {
      return null;
    }
    return saveSunnyBanksProjectWorkspace().label;
  };

  const handleOpen = (workspace: SunnyBanksWorkspaceSnapshot) => {
    setConfirmDeleteId(null);
    if (busy || workspace.id === activeId) return;
    const saved = keepLiveWork();
    openSunnyBanksWorkspace(workspace.id);
    say(saved ? `Saved "${saved}", then opened "${workspace.label}".` : `Opened "${workspace.label}".`);
  };

  /** Pencil: open the episode (if it isn't already) and jump to the editor. */
  const handleEdit = (workspace: SunnyBanksWorkspaceSnapshot) => {
    if (busy) return;
    handleOpen(workspace);
    if (typeof document !== "undefined") {
      window.setTimeout(() => {
        document.getElementById(SUNNY_BANKS_EDITOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  };

  const handleNew = () => {
    setConfirmDeleteId(null);
    if (busy) return;
    const saved = keepLiveWork();
    startNewSunnyBanksEpisode();
    say(saved ? `Saved "${saved}", then started a new episode.` : "Started a new episode.");
  };

  /** Two taps, like the confirm dialog on a band: the first says what
   * will happen, the second deletes. The card goes; clip files already
   * in storage are not touched. Deleting the open episode also clears
   * the editor, or the next edit would save it straight back as a card. */
  const handleDelete = (workspace: SunnyBanksWorkspaceSnapshot) => {
    if (busy) return;
    const isOpen = workspace.id === activeId;
    if (confirmDeleteId !== workspace.id) {
      setConfirmDeleteId(workspace.id);
      say(
        `Tap the bin again to delete "${workspace.label}".` +
          (isOpen ? " It's the episode that's open, so the editor will go blank." : ""),
        "warn"
      );
      return;
    }
    setConfirmDeleteId(null);
    deleteSunnyBanksWorkspace(workspace.id);
    if (isOpen) startNewSunnyBanksEpisode();
    say(`Deleted "${workspace.label}".`);
  };

  const handleDownload = async (workspace: SunnyBanksWorkspaceSnapshot) => {
    setConfirmDeleteId(null);
    if (busy || downloadingId) return;
    setDownloadingId(workspace.id);
    setSunnyBanksBusy(true, "zip");
    say(`Preparing "${workspace.label}"…`);
    try {
      const result = await downloadSunnyBanksEpisodeZip(
        {
          title: workspace.label,
          defaultLocationId: workspace.defaultLocationId,
          actIds: workspace.actIds,
          actScripts: workspace.actScripts,
          characterOverrides: workspace.characterOverrides,
          locationOverrides: workspace.locationOverrides,
          runtimeMap: workspace.runtimeMap,
        },
        ({ done, total }) => say(`Getting clip ${done} of ${total}…`)
      );
      say(
        result.fetchedClipCount === result.clipCount
          ? `Downloaded "${workspace.label}" — ${result.clipCount} clip${result.clipCount === 1 ? "" : "s"}.`
          : `Downloaded "${workspace.label}" — ${result.fetchedClipCount} of ${result.clipCount} clips. ` +
              "The rest could not be fetched; try again on a better connection.",
        result.fetchedClipCount === result.clipCount ? "ok" : "warn"
      );
    } catch (err) {
      say(err instanceof Error ? err.message : "Could not build the episode zip.", "error");
    } finally {
      setDownloadingId(null);
      setSunnyBanksBusy(false, "zip");
    }
  };

  return (
    <div>
      <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">Episodes</p>
      <div className="flex touch-pan-x touch-pan-y items-start gap-3 overflow-x-auto py-1 pl-0.5 pr-1 [scrollbar-width:thin]">
        {workspaces.map((workspace) => {
          const clip = firstClipUrl(workspace);
          const active = workspace.id === activeId;
          const confirming = confirmDeleteId === workspace.id;
          const downloading = downloadingId === workspace.id;
          return (
            <div key={workspace.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => handleOpen(workspace)}
                disabled={busy}
                aria-label={`Open ${workspace.label}`}
                aria-pressed={active}
                className={`relative block h-28 w-28 touch-manipulation overflow-hidden rounded-2xl bg-gradient-to-br from-amber-300/25 via-orange-400/15 to-zinc-900 text-left disabled:opacity-60 ${
                  active ? "ring-2 ring-inset ring-amber-300" : "ring-1 ring-inset ring-white/10"
                }`}
              >
                {clip && (
                  <video
                    src={`${clip}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4">
                  <span className="block truncate text-[11px] font-semibold text-white">{workspace.label}</span>
                  <span className="block truncate text-[9px] text-white/60">{describeSunnyBanksWorkspace(workspace)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(workspace)}
                disabled={busy}
                aria-label={confirming ? `Tap again to delete ${workspace.label}` : `Delete ${workspace.label}`}
                title="Delete episode"
                className={`${TILE_CORNER_BUTTON_CLASS} left-1.5 top-1.5 ${
                  confirming ? "bg-red-500/80 text-white" : "bg-black/50 text-white/70 hover:bg-red-500/60"
                }`}
              >
                <TrashGlyph />
              </button>
              <button
                type="button"
                onClick={() => handleEdit(workspace)}
                disabled={busy}
                aria-label={`Edit ${workspace.label}`}
                title="Open in the editor"
                className={`${TILE_CORNER_BUTTON_CLASS} right-1.5 top-1.5 bg-black/50 text-white/80 hover:bg-black/70`}
              >
                <EditGlyph />
              </button>
              <button
                type="button"
                onClick={() => void handleDownload(workspace)}
                disabled={busy}
                aria-label={`Download ${workspace.label} (.zip)`}
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
          onClick={handleNew}
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
