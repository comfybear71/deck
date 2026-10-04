"use client";

import { useSyncExternalStore } from "react";
import {
  adultShortEpisodeCode,
  adultShortEpisodeNumbers,
  adultShortEpisodeView,
  describeAdultShortEpisode,
  firstAdultShortClipUrl,
  type AdultShortsSaved,
} from "@/lib/adultShorts";
import {
  getAdultShortsState,
  getEpisodeExtrasState,
  getSkidmarksSnapshot,
  openAdultShortEpisode,
  removeSavedAdultShort,
  subscribeSkidmarks,
} from "@/lib/skidmarks";
import { getShortsBusy, subscribeShortsBusy } from "@/lib/shortsBusy";
import { downloadShortsEpisodeZip, shortsZipEpisodeName } from "@/lib/shortsClipsZip";
import type { EpisodeRowCards, EpisodeRowContext } from "@/components/SunnyBanksEpisodeRow";
import { episodeExtraZipItems, episodeExtrasFor, episodeFolderFor } from "@/lib/episodeExtras";

/** The Shorts editor's anchor, for the pencil's "jump to the editor". */
export const SHORTS_EDITOR_ID = "shorts-editor";

/**
 * Shorts' shot-card episodes (2026-09-30; EP01–EP03): one card per saved
 * short, its own `deck_items` row (kind `adult-short`), with its own
 * shots on Siray. Since 2026-10-04 they sit on Shorts' one EPISODES row
 * (`ShortsEpisodesRow`) next to the script episodes, the same row as
 * Sunny Banks and Skidmarks. Tap to open, pencil to jump to the editor,
 * bin twice to delete (clip files in storage are not touched), download
 * for a zip of its finished clips. "+ New" on that row starts a script
 * episode; shot-card episodes are never started there any more.
 *
 * Every change in the editor is saved onto the open card as it happens
 * (`autoSaveAdultShortEditor`), so opening another card never loses work.
 * While a plate, clip or zip is going, the cards are locked so a clip
 * can't land in the wrong episode. `shown`: whether the shot cards are
 * the editor on screen; `onShow` puts them there.
 */
export function useShotCardEpisodeCards(
  { say, confirmDeleteId, setConfirmDeleteId }: EpisodeRowContext,
  { shown = true, onShow }: { shown?: boolean; onShow?: () => void } = {},
): Omit<EpisodeRowCards, "onNew"> {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const busy = useSyncExternalStore(subscribeShortsBusy, getShortsBusy, () => false);
  const state = getAdultShortsState(snapshot);

  const numbers = adultShortEpisodeNumbers(state.saved);
  // In episode order, EP01 first (the Library tab keeps newest first).
  const episodes = state.saved.slice().sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));
  const code = (entry: AdultShortsSaved) => adultShortEpisodeCode(numbers.get(entry.id) ?? 1);
  const labelFor = (entry: AdultShortsSaved) => `${code(entry)} · ${entry.title}`;
  const byId = (id: string) => state.saved.find((entry) => entry.id === id);

  const open = (id: string): AdultShortsSaved | null => {
    setConfirmDeleteId(null);
    const entry = byId(id);
    if (!entry || busy) return null;
    if (entry.id !== state.currentSavedId) {
      openAdultShortEpisode(entry.id);
      onShow?.();
      say(`Opened ${labelFor(entry)}.`);
    } else if (!shown) {
      onShow?.();
      say(`Opened ${labelFor(entry)}.`);
    }
    return entry;
  };

  const edit = (id: string) => {
    if (!open(id)) return;
    window.setTimeout(() => {
      document.getElementById(SHORTS_EDITOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const remove = (id: string) => {
    const entry = byId(id);
    if (!entry || busy) return;
    const isOpen = shown && entry.id === state.currentSavedId;
    if (confirmDeleteId !== entry.id) {
      setConfirmDeleteId(entry.id);
      say(
        `Tap the bin again to delete ${labelFor(entry)}. Its clips stay in storage.` +
          (isOpen ? " It's the episode that's open, so the editor will go blank." : ""),
        "warn",
      );
      return;
    }
    setConfirmDeleteId(null);
    removeSavedAdultShort(entry.id);
    say(`Deleted ${labelFor(entry)}.`);
  };

  const download = (id: string) => {
    setConfirmDeleteId(null);
    const entry = byId(id);
    if (!entry || busy) return;
    const view = adultShortEpisodeView(state, entry);
    const who = view.character.name.trim();
    // The open short's folder may be pinned on the editor before its card.
    const slug = entry.mediaSlug ?? (entry.id === state.currentSavedId ? state.mediaSlug : undefined);
    const extras = episodeExtrasFor(getEpisodeExtrasState(snapshot), episodeFolderFor("shorts", slug));
    const result = downloadShortsEpisodeZip({
      episode: shortsZipEpisodeName(numbers.get(entry.id) ?? 1, entry.title, entry.mediaSlug),
      clips: view.shots.flatMap((shot, i) =>
        shot.clipUrl && shot.clipUrl.startsWith("https:") ? [{ url: shot.clipUrl, shot: i + 1, character: who }] : [],
      ),
      ...(extras.length > 0 ? { extras: episodeExtraZipItems(extras) } : {}),
    });
    say(
      result.ok
        ? `Downloading ${labelFor(entry)}: ${result.clipCount} clip${result.clipCount === 1 ? "" : "s"}` +
            (result.extraCount > 0 ? ` and ${result.extraCount} extra${result.extraCount === 1 ? "" : "s"}.` : ".")
        : result.error,
      result.ok ? "ok" : "warn",
    );
  };

  return {
    cards: episodes.map((entry) => {
      const view = adultShortEpisodeView(state, entry);
      return {
        id: entry.id,
        label: labelFor(entry),
        sub: `Shot cards · ${describeAdultShortEpisode(view.shots)}`,
        clipUrl: firstAdultShortClipUrl(view.shots),
        active: shown && entry.id === state.currentSavedId,
      };
    }),
    busy,
    downloadingId: null,
    onOpen: (id) => void open(id),
    onEdit: edit,
    onDelete: remove,
    onDownload: download,
  };
}
