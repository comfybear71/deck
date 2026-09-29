/**
 * Per-item saving for Skidmarks episodes (2026-09-30): each episode in
 * `SkidmarksState.skidmarksEpisodes.episodes` is also one `deck_items`
 * row (kind `skidmarks-episode`, folder `skidmarks`). Same engine and
 * rules as every other kind (`lib/deckItemSync.ts`); this only says
 * which kind it is and how one episode is cleaned. The cast list stays
 * in the whole-session save for now.
 */
import type { DeckItemKindConfig } from "./deckItemSync";
import { normalizeSkidmarksEpisode, type SkidmarksEpisode } from "./skidmarksEpisodes";

export const SKIDMARKS_EPISODE_ITEMS: DeckItemKindConfig<SkidmarksEpisode> = {
  kind: "skidmarks-episode",
  normalize: normalizeSkidmarksEpisode,
  noun: "Skidmarks episode",
};
