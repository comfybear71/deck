/**
 * ONE-TIME SEED for per-item saving: Skidmarks episodes. Run by hand,
 * never by the app, never on deploy.
 *
 * Reads `skidmarksStudio.workspaces` (the episode cards, 2026-10-04) from Stuart's `skidmarks_sessions`
 * row and inserts each episode as one `deck_items` row (kind
 * `skidmarks-episode`, folder `skidmarks`, revision 1, its own id).
 * Refuses if the owner already has any episode rows (live or deleted), if
 * the tables haven't been created, or if there are no episodes.
 *
 *   # See what it would do. Read-only (READ ONLY transaction):
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-skidmarks-episodes.ts --dry-run
 *
 *   # Really insert (only after checking the dry run):
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-skidmarks-episodes.ts --write
 *
 * Steps and guards: `scripts/seedDeckItemsKind.ts`.
 */
import { planDeckItemSeed } from "../lib/deckItemSeedPlan";
import { SKIDMARKS_EPISODE_ITEMS } from "../lib/skidmarksEpisodeItems";
import { runDeckItemSeed } from "./seedDeckItemsKind";

runDeckItemSeed({
  script: "seed-deck-items-skidmarks-episodes.ts",
  kind: "skidmarks-episode",
  label: "Skidmarks episodes",
  treeHeading: "Episodes",
  statePath: ["skidmarksStudio", "workspaces"],
  plan: (list) => planDeckItemSeed(SKIDMARKS_EPISODE_ITEMS, "skidmarks", (ep) => ep.label, list),
}).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
