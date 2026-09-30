/**
 * Per-item saving for locations (2026-09-30): each place on a genre's
 * Locations row (`SkidmarksState.locations.locations[]`) is one
 * `deck_items` row (kind `location`, folder = its genre). Same engine and
 * rules as every other kind (`lib/deckItemSync.ts`); this only says which
 * kind it is and how one location is cleaned.
 */
import { compareDeckLocations, normalizeDeckLocation, type DeckLocation } from "./deckLocations";
import type { DeckItemKindConfig } from "./deckItemSync";

export const LOCATION_ITEMS: DeckItemKindConfig<DeckLocation> = {
  kind: "location",
  normalize: normalizeDeckLocation,
  noun: "location",
  // Rows scroll oldest first, so locations this device didn't have go
  // after its own in the order they were made.
  orderMissing: compareDeckLocations,
};
