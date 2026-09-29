/**
 * ONE-TIME SEED for per-item saving: shorts (the Shorts Library). Run by
 * hand, never by the app, never on deploy.
 *
 * Reads `adultShorts.saved` from Stuart's `skidmarks_sessions` row and
 * inserts each saved short as one `deck_items` row (kind `adult-short`,
 * folder `adult-shorts`, revision 1, its own `short_…` id). The open
 * editor is not a saved short and stays in the session. Refuses if the
 * owner already has any short rows (live or deleted), if the tables
 * haven't been created, or if there are no saved shorts.
 *
 *   # See what it would do. Read-only (READ ONLY transaction):
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-adult-shorts.ts --dry-run
 *
 *   # Really insert (only after checking the dry run):
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-adult-shorts.ts --write
 *
 * Steps and guards: `scripts/seedDeckItemsKind.ts`.
 */
import { planDeckItemSeed } from "../lib/deckItemSeedPlan";
import { ADULT_SHORT_ITEMS } from "../lib/adultShortItems";
import { runDeckItemSeed } from "./seedDeckItemsKind";

runDeckItemSeed({
  script: "seed-deck-items-adult-shorts.ts",
  kind: "adult-short",
  label: "shorts",
  treeHeading: "Shorts",
  statePath: ["adultShorts", "saved"],
  plan: (list) => planDeckItemSeed(ADULT_SHORT_ITEMS, "adult-shorts", (s) => s.title, list),
}).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
