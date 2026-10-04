"use client";

import { isSafeDeckMediaSlug, studioEpisodeFolder } from "@/lib/deckMediaPaths";
import { useState, useSyncExternalStore } from "react";
import {
  getEpisodeExtrasState,
  getSkidmarksSnapshot,
  getStudioState,
  getSunnyBanksLiveOrDefault,
  deleteSunnyBanksWorkspace,
  openSunnyBanksWorkspace,
  saveSunnyBanksProjectWorkspace,
  startNewSunnyBanksEpisode,
  subscribeSkidmarks,
} from "@/lib/skidmarks";
import { getSunnyBanksBusy, setSunnyBanksBusy, subscribeSunnyBanksBusy } from "@/lib/sunnyBanksBusy";
import { EpisodeCardsRow, type EpisodeRowNotice } from "@/components/EpisodeCardsRow";
import { downloadSunnyBanksEpisodeZip, inStudioGenre, SUNNY_BANKS_EDITOR_ID } from "@/components/SkidmarksSunnyBanksPanel";
import type { StudioGenre } from "@/lib/studioGenre";
import { episodeExtrasFor, episodeFolderFor } from "@/lib/episodeExtras";
import {
  buildEmptySunnyBanksLive,
  defaultSunnyBanksLiveFingerprint,
  describeSunnyBanksWorkspace,
  fingerprintWorkspace,
  type SunnyBanksWorkspaceSnapshot,
} from "@/lib/sunnyBanksWorkspace";


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
 * The row itself is the shared `EpisodeCardsRow` (Shorts uses the same
 * one, 2026-09-30). Each card has the same small round corner buttons as a band tile
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
 *
 * Skidmarks has the same row (2026-10-04, `genre="skidmarks"`), on its
 * own episode cards.
 */
/** An episode's Extras folder; Shorts' script episodes are in `deck/shorts/episodes/` (2026-10-04). */
function studioExtrasFolder(genre: StudioGenre, slug: string | undefined): string | null {
  if (genre !== "shorts") return episodeFolderFor(genre, slug);
  return isSafeDeckMediaSlug(slug) ? studioEpisodeFolder("shorts", slug) : null;
}

export function SunnyBanksEpisodeRow({ genre = "sunnybank" }: { genre?: StudioGenre } = {}) {
  const studioState = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const busy = useSyncExternalStore(subscribeSunnyBanksBusy, getSunnyBanksBusy, () => false);
  const [notice, setNotice] = useState<EpisodeRowNotice>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const studio = getStudioState(genre, studioState);
  const live = studio?.live ?? getSunnyBanksLiveOrDefault(studioState, genre);
  const workspaces = studio?.workspaces ?? [];
  const liveFingerprint = fingerprintWorkspace(live);
  const activeId =
    (live.episodeId && workspaces.some((workspace) => workspace.id === live.episodeId) ? live.episodeId : null) ??
    workspaces.find((workspace) => workspace.fingerprint === liveFingerprint)?.id ??
    null;

  const say = (text: string, tone: "ok" | "warn" | "error" = "ok") => setNotice({ text, tone });

  /** Save what's on screen first when no saved card already holds it. */
  const keepLiveWork = (): string | null => {
    if (activeId) return null;
    if (
      liveFingerprint === fingerprintWorkspace(buildEmptySunnyBanksLive(genre)) ||
      (genre === "sunnybank" && liveFingerprint === defaultSunnyBanksLiveFingerprint())
    ) {
      return null;
    }
    return saveSunnyBanksProjectWorkspace(genre).label;
  };

  const handleOpen = (workspace: SunnyBanksWorkspaceSnapshot) => {
    setConfirmDeleteId(null);
    if (busy || workspace.id === activeId) return;
    const saved = keepLiveWork();
    openSunnyBanksWorkspace(workspace.id, genre);
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
    startNewSunnyBanksEpisode(genre);
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
    deleteSunnyBanksWorkspace(workspace.id, genre);
    if (isOpen) startNewSunnyBanksEpisode(genre);
    say(`Deleted "${workspace.label}".`);
  };

  const handleDownload = async (workspace: SunnyBanksWorkspaceSnapshot) => {
    setConfirmDeleteId(null);
    if (busy || downloadingId) return;
    setDownloadingId(workspace.id);
    setSunnyBanksBusy(true, "zip");
    say(`Preparing "${workspace.label}"…`);
    try {
      // The zip reads the script with this show's cast and locations.
      const result = await inStudioGenre(genre, () =>
        downloadSunnyBanksEpisodeZip(
        {
          title: workspace.label,
          defaultLocationId: workspace.defaultLocationId,
          actIds: workspace.actIds,
          actScripts: workspace.actScripts,
          characterOverrides: workspace.characterOverrides,
          locationOverrides: workspace.locationOverrides,
          locationPickTags: workspace.locationPickTags,
          runtimeMap: workspace.runtimeMap,
          extras: episodeExtrasFor(
            getEpisodeExtrasState(studioState),
            studioExtrasFolder(genre, workspace.mediaSlug ?? (workspace.id === activeId ? live.mediaSlug : undefined)),
          ),
        },
        ({ done, total }) => say(`Getting clip ${done} of ${total}…`)
        )
      );
      const allIn = result.fetchedClipCount === result.clipCount && result.fetchedExtraCount === result.extraCount;
      const extrasText =
        result.extraCount === 0
          ? ""
          : result.fetchedExtraCount === result.extraCount
            ? ` and ${result.extraCount} extra${result.extraCount === 1 ? "" : "s"}`
            : ` and ${result.fetchedExtraCount} of ${result.extraCount} extras`;
      say(
        result.fetchedClipCount === result.clipCount
          ? `Downloaded "${workspace.label}" — ${result.clipCount} clip${result.clipCount === 1 ? "" : "s"}${extrasText}.` +
              (allIn ? "" : " The rest could not be fetched; try again on a better connection.")
          : `Downloaded "${workspace.label}" — ${result.fetchedClipCount} of ${result.clipCount} clips${extrasText}. ` +
              "The rest could not be fetched; try again on a better connection.",
        allIn ? "ok" : "warn"
      );
    } catch (err) {
      say(err instanceof Error ? err.message : "Could not build the episode zip.", "error");
    } finally {
      setDownloadingId(null);
      setSunnyBanksBusy(false, "zip");
    }
  };

  const byId = (id: string) => workspaces.find((workspace) => workspace.id === id);
  return (
    <EpisodeCardsRow
      cards={workspaces.map((workspace) => ({
        id: workspace.id,
        label: workspace.label,
        sub: describeSunnyBanksWorkspace(workspace),
        clipUrl: firstClipUrl(workspace),
        active: workspace.id === activeId,
      }))}
      busy={busy}
      confirmDeleteId={confirmDeleteId}
      downloadingId={downloadingId}
      notice={notice}
      onOpen={(id) => {
        const workspace = byId(id);
        if (workspace) handleOpen(workspace);
      }}
      onEdit={(id) => {
        const workspace = byId(id);
        if (workspace) handleEdit(workspace);
      }}
      onDelete={(id) => {
        const workspace = byId(id);
        if (workspace) handleDelete(workspace);
      }}
      onDownload={(id) => {
        const workspace = byId(id);
        if (workspace) void handleDownload(workspace);
      }}
      onNew={handleNew}
    />
  );
}
