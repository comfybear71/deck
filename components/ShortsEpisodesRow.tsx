"use client";

import { useState, useSyncExternalStore } from "react";
import { EpisodeCardsRow, type EpisodeRowNotice } from "@/components/EpisodeCardsRow";
import { useStudioEpisodeCards } from "@/components/SunnyBanksEpisodeRow";
import { useShotCardEpisodeCards } from "@/components/ShortsEpisodeRow";
import { getAdultShortsState, getSkidmarksSnapshot, getStudioState, setShortsEditor, subscribeSkidmarks } from "@/lib/skidmarks";
import { shortsOpenEditor } from "@/lib/shortsEpisodeCast";
import { shotCardsSavedAsScript } from "@/lib/shortsShotCardStudio";

/** Shot-card episode ids on the shared row, so they can never clash with a script episode's. */
const CARDS_PREFIX = "cards:";

/**
 * Shorts' one EPISODES row (2026-10-04, Stuart: "Shorts must work exactly
 * like Skidmarks and Sunny Banks, with the same UI"). It's the same row
 * as theirs (`EpisodeCardsRow` with the script studio's episode cards),
 * plus the older shot-card episodes (EP01–EP03) first, marked "Shot
 * cards". Since 2026-10-05 every card opens in the script studio: a
 * shot-card episode is shown there converted to a script on the fly
 * (`lib/shortsShotCardStudio.ts`), and once it's changed it is a script
 * episode on this row (the shot-card card then hides; its cards are kept).
 * "+ New" always starts a script episode. No editor switch any more.
 */
export function ShortsEpisodesRow() {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const [notice, setNotice] = useState<EpisodeRowNotice>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const say = (text: string, tone: "ok" | "warn" | "error" = "ok") => setNotice({ text, tone });
  const editor = shortsOpenEditor(snapshot.adultShorts);
  const unprefix = (id: string | null) => (id?.startsWith(CARDS_PREFIX) ? id.slice(CARDS_PREFIX.length) : id);
  const cardsCtx = {
    say,
    confirmDeleteId: unprefix(confirmDeleteId),
    setConfirmDeleteId: (id: string | null) => setConfirmDeleteId(id ? `${CARDS_PREFIX}${id}` : null),
  };
  const script = useStudioEpisodeCards(
    "shorts",
    { say, confirmDeleteId, setConfirmDeleteId },
    { shown: editor === "script", onShow: () => setShortsEditor("script") },
  );
  const cards = useShotCardEpisodeCards(cardsCtx, { shown: editor === "cards", onShow: () => setShortsEditor("cards") });
  const adult = getAdultShortsState(snapshot);
  if (!adult.ageConfirmed) return null;
  // A shot-card episode already saved as a script episode shows once, as that script episode.
  const savedAsScript = shotCardsSavedAsScript(adult, getStudioState("shorts", snapshot)?.workspaces ?? []);
  const shotCards = cards.cards.filter((c) => !savedAsScript.has(c.id));

  const isCard = (id: string) => id.startsWith(CARDS_PREFIX);
  const pick =
    (onCard: (id: string) => void, onScript: (id: string) => void) =>
    (id: string): void => {
      if (isCard(id)) onCard(id.slice(CARDS_PREFIX.length));
      else onScript(id);
    };
  const busy = script.busy || cards.busy;
  return (
    <EpisodeCardsRow
      cards={[...shotCards.map((c) => ({ ...c, id: `${CARDS_PREFIX}${c.id}` })), ...script.cards]}
      busy={busy}
      confirmDeleteId={confirmDeleteId}
      downloadingId={script.downloadingId}
      notice={notice}
      onOpen={pick(cards.onOpen, script.onOpen)}
      onEdit={pick(cards.onEdit, script.onEdit)}
      onDelete={pick(cards.onDelete, script.onDelete)}
      onDownload={pick(cards.onDownload, script.onDownload)}
      onNew={script.onNew}
    />
  );
}
