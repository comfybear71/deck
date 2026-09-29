/**
 * Per-item saving for shorts (2026-09-30): each saved short in
 * `SkidmarksState.adultShorts.saved` (the Shorts Library) is also one
 * `deck_items` row (kind `adult-short`, folder `adult-shorts`, the key
 * the database and code already use). Same engine and rules as every
 * other kind (`lib/deckItemSync.ts`); this only says which kind it is and
 * how one short is cleaned. The open editor (character, shot list, age
 * confirm) stays in the whole-session save, as before.
 */
import { normalizeAdultShortsSavedEntry, type AdultShortsSaved } from "./adultShorts";
import type { DeckItemKindConfig } from "./deckItemSync";

export const ADULT_SHORT_ITEMS: DeckItemKindConfig<AdultShortsSaved> = {
  kind: "adult-short",
  normalize: normalizeAdultShortsSavedEntry,
  noun: "short",
};
