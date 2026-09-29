/**
 * Pure planning half of the one-time seeds
 * (`scripts/seed-deck-items-characters.ts`,
 * `scripts/seed-deck-items-sunnybank-episodes.ts`): turns the
 * `characterLoras` / `sunnyBanks` value from Stuart's `skidmarks_sessions`
 * row into the `deck_items` rows it would insert. No database access here, so it is unit-tested
 * and the script's `--dry-run` prints exactly what a real run writes.
 *
 * The app itself never seeds; only that script, run by hand, does.
 */
import { normalizeCharacterLoraEntry } from "./characterLoras";
import {
  DECK_FOLDER_LABELS,
  DECK_ITEM_MAX_DATA_BYTES,
  characterFolder,
  isValidDeckItemId,
  type DeckFolder,
} from "./deckItems";
import {
  countSunnyBanksDoneClips,
  normalizeSunnyBanksWorkspace,
  pickSunnyBanksEpisodeMediaSlug,
  type SunnyBanksWorkspaceSnapshot,
} from "./sunnyBanksWorkspace";

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

/* ------------------------------------------------------------------ */
/* Step 2: Sunnybank episodes                                           */
/* ------------------------------------------------------------------ */

export interface SunnybankEpisodeSeedRow {
  itemId: string;
  label: string;
  savedAt: number;
  /** The media folder this episode is pinned to (`deck/sunnybank/episodes/<mediaSlug>/`). */
  mediaSlug: string;
  /** `true` when the card had no `mediaSlug` yet and the seed pins one from its name. */
  mediaSlugNew: boolean;
  acts: number;
  clips: number;
  bytes: number;
  data: Record<string, unknown>;
}

export interface SunnybankEpisodeSeedPlan {
  rows: SunnybankEpisodeSeedRow[];
  /** Entries on the shelf that can't become a row, and why. */
  skipped: { index: number; reason: string }[];
  /** `sunnyBanks` was missing/`null` in the session (nothing saved for Sunnybank at all). */
  sessionHasNoSunnybank: boolean;
  /** The live working copy's name, for the report only. It is not an item and is never seeded. */
  liveTitle: string | null;
}

/**
 * Turns the `sunnyBanks` value from Stuart's session row into the
 * `deck_items` rows (kind `sunnybank-episode`, folder `sunnybank`) the
 * seed would insert: one per saved episode card, keyed by the card's own
 * `id`. Cards with no pinned `mediaSlug` get one from their name (the
 * same slug the readable Blob paths already used for them), unique on
 * the shelf.
 */
export function planSunnybankEpisodeSeed(sunnyBanks: unknown): SunnybankEpisodeSeedPlan {
  const plan: SunnybankEpisodeSeedPlan = { rows: [], skipped: [], sessionHasNoSunnybank: false, liveTitle: null };
  const studio = sunnyBanks && typeof sunnyBanks === "object" ? (sunnyBanks as { live?: unknown; workspaces?: unknown }) : null;
  if (!studio) {
    plan.sessionHasNoSunnybank = true;
    return plan;
  }
  const live = studio.live && typeof studio.live === "object" ? (studio.live as { workspaceTitle?: unknown }) : null;
  plan.liveTitle = typeof live?.workspaceTitle === "string" ? live.workspaceTitle : null;
  if (!Array.isArray(studio.workspaces)) return plan;
  const seen = new Set<string>();
  const cards: { index: number; card: SunnyBanksWorkspaceSnapshot }[] = [];
  studio.workspaces.forEach((raw, index) => {
    const card = normalizeSunnyBanksWorkspace(raw);
    if (!card) return plan.skipped.push({ index, reason: "not an episode card (no id or savedAt)" });
    if (!isValidDeckItemId(card.id)) return plan.skipped.push({ index, reason: `unusable id ${JSON.stringify(card.id)}` });
    if (seen.has(card.id)) return plan.skipped.push({ index, reason: `duplicate id ${card.id} (first copy kept)` });
    seen.add(card.id);
    cards.push({ index, card });
  });
  const taken = cards.map((c) => c.card.mediaSlug).filter((s): s is string => Boolean(s));
  for (const { index, card } of cards) {
    let mediaSlugNew = false;
    let data = card;
    if (!card.mediaSlug) {
      const slug = pickSunnyBanksEpisodeMediaSlug(card.label, taken);
      taken.push(slug);
      data = { ...card, mediaSlug: slug };
      mediaSlugNew = true;
    }
    const bytes = JSON.stringify(data).length;
    if (bytes > DECK_ITEM_MAX_DATA_BYTES) {
      plan.skipped.push({ index, reason: `${card.id} is ${bytes} bytes, over the ${DECK_ITEM_MAX_DATA_BYTES}-byte item limit` });
      continue;
    }
    plan.rows.push({
      itemId: card.id,
      label: card.label,
      savedAt: card.savedAt,
      mediaSlug: data.mediaSlug as string,
      mediaSlugNew,
      acts: card.actIds.length,
      clips: countSunnyBanksDoneClips(card.runtimeMap, card.actIds),
      bytes,
      data: data as unknown as Record<string, unknown>,
    });
  }
  return plan;
}
