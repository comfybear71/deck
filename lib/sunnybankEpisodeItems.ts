/**
 * Per-item saving for Sunnybank episodes (step 2 of Stuart's "save each
 * thing on its own" plan). One saved episode card (a
 * `SunnyBanksWorkspaceSnapshot` on the episode shelf) is one `deck_items`
 * row, kind `sunnybank-episode`, folder `sunnybank`, item id = the card's
 * own `id`, which never changes once minted (not on re-save, not on
 * rename; see `upsertSunnyBanksWorkspace`). The live working copy is not
 * an item; it keeps riding in the whole-session save as before.
 *
 * Same engine and rules as every other kind (`lib/deckItemSync.ts`):
 * only a real change writes, loading never writes, a card missing from a
 * device never deletes (only `deleteSunnyBanksWorkspace`, the card's ✕
 * tap, does), a 409 means this device takes the server's copy, and the
 * client never seeds (`scripts/seed-deck-items-sunnybank-episodes.ts`
 * does, by hand). This file only says which kind it is, how one card is
 * cleaned, and that cards this device didn't have go on the shelf newest
 * first. The named exports below keep the names this kind has always
 * had; they are thin aliases onto the shared engine.
 */
import type { DeckItemRecord } from "./deckItems";
import {
  DECK_ITEM_DEBOUNCE_MS,
  changedDeckItemIds,
  createDeckItemSync,
  entryFromDeckItem,
  overlayDeckItems,
  sameDeckItem,
  type DeckItemKindConfig,
  type DeckItemSync,
  type DeckItemSyncDeps,
  type DeckItemSyncMode,
} from "./deckItemSync";
import { normalizeSunnyBanksWorkspace, type SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";

export const SUNNYBANK_EPISODE_ITEMS: DeckItemKindConfig<SunnyBanksWorkspaceSnapshot> = {
  kind: "sunnybank-episode",
  normalize: normalizeSunnyBanksWorkspace,
  noun: "Sunnybank episode",
  // The shelf is newest first, so episodes this device didn't have go
  // after its own, newest of them first.
  orderMissing: (x, y) => y.savedAt - x.savedAt,
};

/* Aliases onto the shared engine, under this kind's own names. */

type Episode = SunnyBanksWorkspaceSnapshot;

export const SUNNYBANK_EPISODE_ITEM_DEBOUNCE_MS = DECK_ITEM_DEBOUNCE_MS;
export type SunnybankEpisodeItemSyncMode = DeckItemSyncMode;

export function sameEpisode(a: Episode, b: Episode): boolean {
  return sameDeckItem(SUNNYBANK_EPISODE_ITEMS, a, b);
}

export function changedEpisodeIds(before: readonly Episode[], after: readonly Episode[]): string[] {
  return changedDeckItemIds(SUNNYBANK_EPISODE_ITEMS, before, after);
}

export function episodeFromItem(item: DeckItemRecord): Episode | null {
  return entryFromDeckItem(SUNNYBANK_EPISODE_ITEMS, item);
}

export function overlayEpisodeItems(
  local: readonly Episode[],
  items: readonly DeckItemRecord[],
  deletedIds: Iterable<string>,
  keepLocal: ReadonlySet<string> = new Set(),
): { episodes: Episode[]; changed: boolean } {
  const { entries, changed } = overlayDeckItems(SUNNYBANK_EPISODE_ITEMS, local, items, deletedIds, keepLocal);
  return { episodes: entries, changed };
}

export interface SunnybankEpisodeItemSyncDeps extends Omit<DeckItemSyncDeps<Episode>, "getEntries" | "applyServerEntries"> {
  /** This device's current shelf. */
  getEpisodes: () => Episode[];
  /** Put server cards on the shelf. Must NOT go through `persist()` /
   * `saveSunnyBanksProjectWorkspace` (that would count as a local edit
   * and write it back up). */
  applyServerEpisodes: (next: Episode[]) => void;
}

export interface SunnybankEpisodeItemSync extends Omit<DeckItemSync<Episode>, "deleteItem"> {
  /** A real ✕ tap on one card. `snapshot` is the card as it was just before. */
  deleteEpisode(id: string, snapshot: Episode | null): void;
}

export function createSunnybankEpisodeItemSync(deps: SunnybankEpisodeItemSyncDeps): SunnybankEpisodeItemSync {
  const { getEpisodes, applyServerEpisodes, ...rest } = deps;
  const sync = createDeckItemSync(SUNNYBANK_EPISODE_ITEMS, { ...rest, getEntries: getEpisodes, applyServerEntries: applyServerEpisodes });
  return { ...sync, deleteEpisode: sync.deleteItem };
}
