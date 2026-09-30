"use client";

import { useState, useSyncExternalStore } from "react";
import {
  ADULT_SHORTS_TITLE_MAX,
  adultShortEpisodeCode,
  adultShortEpisodeNumbers,
  adultShortEpisodeView,
  describeAdultShortEpisode,
  firstAdultShortClipUrl,
  nextAdultShortEpisodeNumber,
  type AdultShortsSaved,
} from "@/lib/adultShorts";
import {
  getAdultShortsState,
  getSkidmarksSnapshot,
  openAdultShortEpisode,
  removeSavedAdultShort,
  startNewAdultShortEpisode,
  subscribeSkidmarks,
} from "@/lib/skidmarks";
import { getShortsBusy, subscribeShortsBusy } from "@/lib/shortsBusy";
import { downloadShortsEpisodeZip, shortsZipEpisodeName } from "@/lib/shortsClipsZip";
import { EpisodeCardsRow, type EpisodeRowNotice } from "@/components/EpisodeCardsRow";

/** The Shorts editor's anchor, for the pencil's "jump to the editor". */
export const SHORTS_EDITOR_ID = "shorts-editor";

/**
 * Shorts episodes (2026-09-30, Stuart: "make Shorts match Sunnybank's
 * layout and flow"): the same sideways EPISODES row as Sunnybank
 * (`EpisodeCardsRow`), right under the project tiles. Each card is one
 * saved short, its own `deck_items` row (kind `adult-short`), with its own
 * shots on Siray. Tap to open, pencil to jump to the editor, bin twice to
 * delete (clip files in storage are not touched), download for a zip of
 * its finished clips (built on the server, works on iPhone Safari), and
 * "+ New" for a blank workspace with a name you type (2026-09-30: no one
 * starring, one empty shot, 18+ off; its folder is `ep02-<name>`).
 *
 * Every change in the editor is saved onto the open card as it happens
 * (`autoSaveAdultShortEditor`), so opening another card never loses work.
 * The open card shows the live editor, so the shots already on screen
 * (Skylar's five) show on EP01 straight away. While a plate, clip or zip
 * is going, the row is locked so a clip can't land in the wrong episode.
 */
export function ShortsEpisodeRow() {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const busy = useSyncExternalStore(subscribeShortsBusy, getShortsBusy, () => false);
  const [notice, setNotice] = useState<EpisodeRowNotice>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** "+ New" asks for the short's name first; `null` = not asking. */
  const [naming, setNaming] = useState<string | null>(null);
  const state = getAdultShortsState(snapshot);
  if (!state.ageConfirmed) return null;

  const numbers = adultShortEpisodeNumbers(state.saved);
  // In episode order, EP01 first (the Library tab keeps newest first).
  const episodes = state.saved.slice().sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));
  const code = (entry: AdultShortsSaved) => adultShortEpisodeCode(numbers.get(entry.id) ?? 1);
  const labelFor = (entry: AdultShortsSaved) => `${code(entry)} · ${entry.title}`;
  const byId = (id: string) => state.saved.find((entry) => entry.id === id);
  const say = (text: string, tone: "ok" | "warn" | "error" = "ok") => setNotice({ text, tone });

  const open = (id: string): AdultShortsSaved | null => {
    setConfirmDeleteId(null);
    const entry = byId(id);
    if (!entry || busy) return null;
    if (entry.id !== state.currentSavedId) {
      openAdultShortEpisode(entry.id);
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
    const isOpen = entry.id === state.currentSavedId;
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
    const result = downloadShortsEpisodeZip({
      episode: shortsZipEpisodeName(numbers.get(entry.id) ?? 1, entry.title, entry.mediaSlug),
      clips: view.shots.flatMap((shot, i) =>
        shot.clipUrl && shot.clipUrl.startsWith("https:") ? [{ url: shot.clipUrl, shot: i + 1, character: who }] : [],
      ),
    });
    say(
      result.ok
        ? `Downloading ${labelFor(entry)}: ${result.clipCount} clip${result.clipCount === 1 ? "" : "s"}.`
        : result.error,
      result.ok ? "ok" : "warn",
    );
  };

  const startNew = () => {
    setConfirmDeleteId(null);
    if (busy) return;
    setNotice(null);
    setNaming((n) => (n === null ? "" : null));
  };

  const createNamed = () => {
    const name = (naming ?? "").replace(/\s+/g, " ").trim();
    if (!name || busy) return;
    const code = adultShortEpisodeCode(nextAdultShortEpisodeNumber(state.saved));
    startNewAdultShortEpisode(name);
    setNaming(null);
    say(`Started ${code} · ${name}. Pick who's starring, then write the first shot. It gets its card once a shot has something in it.`);
    window.setTimeout(() => {
      document.getElementById(SHORTS_EDITOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  return (
    <>
    <EpisodeCardsRow
      cards={episodes.map((entry) => {
        const view = adultShortEpisodeView(state, entry);
        return {
          id: entry.id,
          label: labelFor(entry),
          sub: describeAdultShortEpisode(view.shots),
          clipUrl: firstAdultShortClipUrl(view.shots),
          active: entry.id === state.currentSavedId,
        };
      })}
      busy={busy}
      confirmDeleteId={confirmDeleteId}
      downloadingId={null}
      notice={notice}
      onOpen={(id) => void open(id)}
      onEdit={edit}
      onDelete={remove}
      onDownload={download}
      onNew={startNew}
    />
    {naming !== null && (
      <form
        className="-mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          createNamed();
        }}
      >
        <input
          autoFocus
          value={naming}
          onChange={(e) => setNaming(e.target.value)}
          maxLength={ADULT_SHORTS_TITLE_MAX}
          placeholder="Name this short, e.g. Brother vs Rambo"
          aria-label="New short's name"
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-base text-white placeholder:text-white/30 sm:text-sm"
        />
        <button
          type="submit"
          disabled={!naming.trim() || busy}
          className="rounded-md bg-sky-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          Start
        </button>
        <button type="button" onClick={() => setNaming(null)} className="rounded-md px-2 py-1.5 text-xs text-white/50 hover:text-white">
          Cancel
        </button>
      </form>
    )}
    </>
  );
}
