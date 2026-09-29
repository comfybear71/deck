/**
 * Per-item saving for character cards (step 1 of Stuart's "save each
 * thing on its own" plan). One card is one `deck_items` row, kind
 * `character`, folder from its sourceKey (`characterFolder`).
 *
 * Same engine and rules as every other kind (`lib/deckItemSync.ts`):
 * only a real change writes (`patchCharacterLoras` hands every edit over
 * with the before/after lists), loading never writes, a card missing from
 * a device never deletes (only `removeCharacterLora`, the delete tap,
 * does), a 409 means this device takes the server's copy, and the client
 * never seeds (`scripts/seed-deck-items-characters.ts` does, by hand).
 * No `localStorage`.
 *
 * This file only says which kind it is and how one card is cleaned. The
 * named exports below keep the names characters have always had; they
 * are thin aliases onto the shared engine, pinned by
 * `lib/characterItems.test.ts`.
 */
import { normalizeCharacterLoraEntry, type CharacterLoraEntry } from "./characterLoras";
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

export const CHARACTER_ITEMS: DeckItemKindConfig<CharacterLoraEntry> = {
  kind: "character",
  normalize: normalizeCharacterLoraEntry,
  noun: "character",
};

/* Aliases onto the shared engine, under the names characters have always used. */

export const CHARACTER_ITEM_DEBOUNCE_MS = DECK_ITEM_DEBOUNCE_MS;
export type CharacterItemSyncMode = DeckItemSyncMode;

/** Same card, field for field, once both are cleaned the same way. */
export function sameCharacter(a: CharacterLoraEntry, b: CharacterLoraEntry): boolean {
  return sameDeckItem(CHARACTER_ITEMS, a, b);
}

/** Ids of cards in `after` that are new or different; a missing card is never listed. */
export function changedCharacterIds(before: readonly CharacterLoraEntry[], after: readonly CharacterLoraEntry[]): string[] {
  return changedDeckItemIds(CHARACTER_ITEMS, before, after);
}

/** A server row as a card, or `null` if it isn't a usable one. */
export function characterFromItem(item: DeckItemRecord): CharacterLoraEntry | null {
  return entryFromDeckItem(CHARACTER_ITEMS, item);
}

/** Lays the server's cards over this device's list (see `overlayDeckItems`). */
export function overlayCharacterItems(
  local: readonly CharacterLoraEntry[],
  items: readonly DeckItemRecord[],
  deletedIds: Iterable<string>,
  keepLocal: ReadonlySet<string> = new Set(),
): { characters: CharacterLoraEntry[]; changed: boolean } {
  const { entries, changed } = overlayDeckItems(CHARACTER_ITEMS, local, items, deletedIds, keepLocal);
  return { characters: entries, changed };
}

export interface CharacterItemSyncDeps
  extends Omit<DeckItemSyncDeps<CharacterLoraEntry>, "getEntries" | "applyServerEntries"> {
  /** This device's current card list. */
  getCharacters: () => CharacterLoraEntry[];
  /** Put server cards on screen. Must NOT go through `patchCharacterLoras`
   * (that would count as a local edit and write it back up). */
  applyServerCharacters: (next: CharacterLoraEntry[]) => void;
}

export interface CharacterItemSync extends Omit<DeckItemSync<CharacterLoraEntry>, "deleteItem"> {
  /** A real delete tap on one card. `snapshot` is the card as it was just before. */
  deleteCharacter(id: string, snapshot: CharacterLoraEntry | null): void;
}

export function createCharacterItemSync(deps: CharacterItemSyncDeps): CharacterItemSync {
  const { getCharacters, applyServerCharacters, ...rest } = deps;
  const sync = createDeckItemSync(CHARACTER_ITEMS, { ...rest, getEntries: getCharacters, applyServerEntries: applyServerCharacters });
  return { ...sync, deleteCharacter: sync.deleteItem };
}
