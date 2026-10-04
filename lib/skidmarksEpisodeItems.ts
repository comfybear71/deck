/**
 * Per-item saving for Skidmarks episodes (2026-09-30): each episode card
 * is also one `deck_items` row (kind `skidmarks-episode`, folder
 * `skidmarks`). Same engine and rules as every other kind
 * (`lib/deckItemSync.ts`); this only says which kind it is and how one
 * episode is cleaned.
 *
 * Since 2026-10-04 a Skidmarks episode is the same episode card as a
 * Sunny Banks one (`SkidmarksState.skidmarksStudio.workspaces`). A row
 * saved by the old nine-beat editor still reads: it is turned into an
 * episode card in code (`lib/skidmarksStudio.ts`), nothing rewritten.
 * The cast list stays in the whole-session save.
 */
import type { DeckItemKindConfig } from "./deckItemSync";
import { normalizeSkidmarksEpisodeCard } from "./skidmarksStudio";
import type { SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";

export const SKIDMARKS_EPISODE_ITEMS: DeckItemKindConfig<SunnyBanksWorkspaceSnapshot> = {
  kind: "skidmarks-episode",
  normalize: normalizeSkidmarksEpisodeCard,
  noun: "Skidmarks episode",
};
