/**
 * Pure planning half of the one-time seeds for the kinds that live in one
 * project folder (Skidmarks episodes, shorts; 2026-09-30). The same job
 * `lib/deckItemsSeed.ts` does for characters: turns one list from
 * Stuart's `skidmarks_sessions` row into the `deck_items` rows it would
 * insert. No database access here, so it is unit-tested and a seed
 * script's `--dry-run` prints exactly what a real run writes.
 *
 * The app itself never seeds; only the scripts, run by hand, do.
 */
import { DECK_FOLDER_LABELS, isValidDeckItemId, type DeckFolder, type DeckItemKind } from "./deckItems";
import type { DeckItemEntry, DeckItemKindConfig } from "./deckItemSync";

export interface DeckItemSeedRow {
  itemId: string;
  folder: DeckFolder;
  /** What Stuart sees it called (episode title, short title). */
  title: string;
  data: Record<string, unknown>;
}

export interface DeckItemSeedPlan {
  kind: DeckItemKind;
  folder: DeckFolder;
  rows: DeckItemSeedRow[];
  /** Entries in the session that can't become a row, and why. */
  skipped: { index: number; reason: string }[];
  /** The list was missing/`null` in the session (nothing made yet on any device that saved). */
  sessionHasNoList: boolean;
}

export function planDeckItemSeed<T extends DeckItemEntry>(
  config: DeckItemKindConfig<T>,
  folder: DeckFolder,
  titleOf: (entry: T) => string,
  list: unknown,
): DeckItemSeedPlan {
  const plan: DeckItemSeedPlan = { kind: config.kind, folder, rows: [], skipped: [], sessionHasNoList: false };
  if (!Array.isArray(list)) {
    plan.sessionHasNoList = true;
    return plan;
  }
  const seen = new Set<string>();
  list.forEach((raw, index) => {
    const entry = config.normalize(raw);
    if (!entry) return plan.skipped.push({ index, reason: `not a ${config.noun} (no id, or nothing in it)` });
    if (!isValidDeckItemId(entry.id)) return plan.skipped.push({ index, reason: `unusable id ${JSON.stringify(entry.id)}` });
    if (seen.has(entry.id)) return plan.skipped.push({ index, reason: `duplicate id ${entry.id} (first copy kept)` });
    seen.add(entry.id);
    plan.rows.push({ itemId: entry.id, folder, title: titleOf(entry), data: entry as unknown as Record<string, unknown> });
  });
  return plan;
}

/** Plain-text folder tree of what the folder will hold. */
export function formatDeckItemSeedTree(plan: DeckItemSeedPlan, heading: string): string {
  const lines = ["Deck", `└── ${DECK_FOLDER_LABELS[plan.folder]}`, `    └── ${heading} (${plan.rows.length})`];
  plan.rows.forEach((r, j) => lines.push(`        ${j === plan.rows.length - 1 ? "└──" : "├──"} ${r.title || "(no title)"}  [${r.itemId}]`));
  return lines.join("\n");
}
