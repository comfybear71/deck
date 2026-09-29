/**
 * Pure planning half of the one-time seed
 * (`scripts/seed-deck-items-characters.ts`): turns the `characterLoras`
 * value from Stuart's `skidmarks_sessions` row into the `deck_items`
 * rows it would insert. No database access here, so it is unit-tested
 * and the script's `--dry-run` prints exactly what a real run writes.
 *
 * The app itself never seeds; only that script, run by hand, does.
 */
import { normalizeCharacterLoraEntry } from "./characterLoras";
import { DECK_FOLDER_LABELS, characterFolder, isValidDeckItemId, type DeckFolder } from "./deckItems";

export interface CharacterSeedRow {
  itemId: string;
  folder: DeckFolder;
  name: string;
  sourceKey: string | null;
  data: Record<string, unknown>;
}

export interface CharacterSeedPlan {
  rows: CharacterSeedRow[];
  /** Folder → how many rows, in the agreed folder order. */
  perFolder: Record<DeckFolder, number>;
  /** Entries in the session that can't become a row, and why. */
  skipped: { index: number; reason: string }[];
  /** `characterLoras` was missing/`null` in the session (the app then shows only the Skye seed). */
  sessionHasNoCharacters: boolean;
}

export const DECK_FOLDER_ORDER: DeckFolder[] = ["deck", "sunnybank", "music-video", "skidmarks", "adult-shorts"];

export function planCharacterSeed(characterLoras: unknown): CharacterSeedPlan {
  const perFolder = Object.fromEntries(DECK_FOLDER_ORDER.map((f) => [f, 0])) as Record<DeckFolder, number>;
  const plan: CharacterSeedPlan = { rows: [], perFolder, skipped: [], sessionHasNoCharacters: false };
  const list =
    characterLoras && typeof characterLoras === "object"
      ? (characterLoras as { characters?: unknown }).characters
      : undefined;
  if (!Array.isArray(list)) {
    plan.sessionHasNoCharacters = true;
    return plan;
  }
  const seen = new Set<string>();
  list.forEach((raw, index) => {
    const entry = normalizeCharacterLoraEntry(raw);
    if (!entry) return plan.skipped.push({ index, reason: "not a character card (no id)" });
    if (!isValidDeckItemId(entry.id)) return plan.skipped.push({ index, reason: `unusable id ${JSON.stringify(entry.id)}` });
    if (seen.has(entry.id)) return plan.skipped.push({ index, reason: `duplicate id ${entry.id} (first copy kept)` });
    seen.add(entry.id);
    const folder = characterFolder(entry.sourceKey);
    perFolder[folder] += 1;
    plan.rows.push({
      itemId: entry.id,
      folder,
      name: entry.name,
      sourceKey: entry.sourceKey,
      data: entry as unknown as Record<string, unknown>,
    });
  });
  return plan;
}

/** Plain-text folder tree of what the Characters folders will hold. */
export function formatCharacterSeedTree(plan: CharacterSeedPlan): string {
  const lines: string[] = ["Deck"];
  const byFolder = (f: DeckFolder) => plan.rows.filter((r) => r.folder === f);
  const leaf = (r: CharacterSeedRow) => `${r.name || "(no name)"}  [${r.itemId}${r.sourceKey ? `, ${r.sourceKey}` : ""}]`;
  const root = byFolder("deck");
  const sub = DECK_FOLDER_ORDER.filter((f) => f !== "deck");
  sub.forEach((f, i) => {
    const last = i === sub.length - 1 && root.length === 0;
    const rows = byFolder(f);
    lines.push(`${last ? "└──" : "├──"} ${DECK_FOLDER_LABELS[f]}`);
    const pad = last ? "    " : "│   ";
    lines.push(`${pad}└── Characters (${rows.length})`);
    rows.forEach((r, j) => lines.push(`${pad}    ${j === rows.length - 1 ? "└──" : "├──"} ${leaf(r)}`));
  });
  if (root.length > 0) {
    lines.push(`└── (Deck root, no project) Characters (${root.length})`);
    root.forEach((r, j) => lines.push(`    ${j === root.length - 1 ? "└──" : "├──"} ${leaf(r)}`));
  }
  return lines.join("\n");
}
