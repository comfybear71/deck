/**
 * Shorts → episodes, in code on load (2026-09-30). Nothing is rewritten:
 * every saved short is already its own `deck_items` row (kind
 * `adult-short`), and those rows become the EPISODES cards. The open
 * short is EP01 (or its own number), the editor's shots show on it at
 * once, and the next edit saves them onto that same row.
 *
 * This file is the read-only check of exactly that, for the dry run
 * (`scripts/shorts-episodes-dry-run.ts`): it takes the session's Shorts
 * part and the `adult-short` rows, lays the rows over the session list
 * the same way the page does (`overlayDeckItems`), and works out each
 * card's episode number, what it shows, and what the first save would
 * write, without writing anything. Pure.
 */
import {
  adultShortEpisodeCode,
  adultShortEpisodeNumbers,
  adultShortEpisodeView,
  autoSaveAdultShortEditor,
  describeAdultShortEpisode,
  normalizeAdultShortsState,
  type AdultShortsSaved,
} from "./adultShorts";
import { ADULT_SHORT_ITEMS } from "./adultShortItems";
import { adultShortEpisodeSlug, isSafeDeckMediaSlug } from "./deckMediaPaths";
import type { DeckItemRecord } from "./deckItems";
import { overlayDeckItems } from "./deckItemSync";

export interface ShortsEpisodePlanCard {
  id: string;
  code: string;
  title: string;
  open: boolean;
  character: string;
  shots: number;
  clips: number;
  /** Where its new files will go (`deck/shorts/episodes/ep01-…/`), or its old folder if one is pinned. */
  folder: string;
}

export interface ShortsEpisodesPlan {
  ageConfirmed: boolean;
  cards: ShortsEpisodePlanCard[];
  /** The editor's shots, and whether each one's plate/clip link is on its card after the first save. */
  editorShots: { id: string; plate: boolean; clip: boolean; keptOnCard: boolean }[];
  /** What the first edit would save onto the open card (`null` = nothing, it already matches). */
  firstSave: { cardId: string; code: string; newCard: boolean; shots: number; clips: number; character: string } | null;
  /** Anything that would be lost. Empty is the only acceptable answer. */
  lost: string[];
}

export function planShortsEpisodes(
  sessionAdultShorts: unknown,
  rows: readonly DeckItemRecord[],
  deletedIds: readonly string[] = [],
): ShortsEpisodesPlan {
  const base = normalizeAdultShortsState(sessionAdultShorts);
  if (!base) return { ageConfirmed: false, cards: [], editorShots: [], firstSave: null, lost: [] };
  const { entries } = overlayDeckItems(ADULT_SHORT_ITEMS, base.saved, rows, deletedIds);
  const state = { ...base, saved: entries, currentSavedId: entries.some((x) => x.id === base.currentSavedId) ? base.currentSavedId : null };
  const numbers = adultShortEpisodeNumbers(state.saved);
  const folderFor = (entry: AdultShortsSaved) => {
    const slug = isSafeDeckMediaSlug(entry.mediaSlug) ? entry.mediaSlug : adultShortEpisodeSlug(numbers.get(entry.id) ?? 1, entry.title);
    return /^ep\d{2,3}-/.test(slug) ? `deck/shorts/episodes/${slug}/` : `deck/shorts/shorts/${slug}/`;
  };
  const cards = state.saved
    .slice()
    .sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0))
    .map((entry) => {
      const view = adultShortEpisodeView(state, entry);
      return {
        id: entry.id,
        code: adultShortEpisodeCode(numbers.get(entry.id) ?? 1),
        title: entry.title,
        open: entry.id === state.currentSavedId,
        character: view.character.name.trim() || "(no name)",
        shots: view.shots.length,
        clips: view.shots.filter((s) => s.clipUrl).length,
        folder: folderFor(entry),
      };
    });

  const saved = autoSaveAdultShortEditor(state, new Date(), "short_new_card");
  const target = saved.saved.find((x) => x.id === saved.currentSavedId) ?? null;
  const firstSave =
    saved === state || !target
      ? null
      : {
          cardId: target.id,
          code: adultShortEpisodeCode(adultShortEpisodeNumbers(saved.saved).get(target.id) ?? 1),
          newCard: !state.saved.some((x) => x.id === target.id),
          shots: target.shots.length,
          clips: target.shots.filter((s) => s.clipUrl).length,
          character: target.character.name.trim() || "(no name)",
        };
  const onCard = target ?? state.saved.find((x) => x.id === state.currentSavedId) ?? null;
  const editorShots = state.shots.map((s) => {
    const kept = onCard?.shots.find((x) => x.id === s.id);
    return {
      id: s.id,
      plate: Boolean(s.plateUrl),
      clip: Boolean(s.clipUrl),
      keptOnCard: Boolean(kept && kept.plateUrl === s.plateUrl && kept.clipUrl === s.clipUrl && kept.prompt === s.prompt),
    };
  });
  const lost: string[] = [];
  const hasWork = state.shots.some((s) => s.prompt.trim() || s.plateUrl || s.clipUrl);
  if (state.ageConfirmed && hasWork) {
    for (const s of editorShots) if (!s.keptOnCard) lost.push(`editor shot ${s.id} would not be on its episode card`);
  }
  // Every card that isn't the open one keeps its own saved shots untouched.
  for (const entry of state.saved) {
    if (entry.id === target?.id) continue;
    const after = saved.saved.find((x) => x.id === entry.id);
    if (!after || JSON.stringify(after.shots) !== JSON.stringify(entry.shots)) lost.push(`${entry.title} would change`);
  }
  return { ageConfirmed: state.ageConfirmed, cards, editorShots, firstSave, lost };
}

export function formatShortsEpisodesPlan(plan: ShortsEpisodesPlan): string {
  const lines: string[] = [];
  lines.push(`18+ confirmed: ${plan.ageConfirmed ? "yes" : "no (the Shorts screen shows the 18+ confirm first)"}`);
  lines.push(`EPISODES row: ${plan.cards.length} card${plan.cards.length === 1 ? "" : "s"}`);
  for (const c of plan.cards) {
    lines.push(
      `  ${c.code} · ${c.title}${c.open ? "  [open in the editor]" : ""} — ${c.character}, ${describeAdultShortEpisode(
        Array.from({ length: c.shots }, (_, i) => ({ clipUrl: i < c.clips ? "x" : null })),
      )}, new files → ${c.folder}`,
    );
  }
  lines.push(`Editor shots: ${plan.editorShots.length}`);
  plan.editorShots.forEach((s, i) =>
    lines.push(`  shot ${i + 1} (${s.id}): plate ${s.plate ? "yes" : "no"}, clip ${s.clip ? "yes" : "no"}, on its episode card after the first save: ${s.keptOnCard ? "yes" : "NO"}`),
  );
  lines.push(
    plan.firstSave
      ? `First edit saves onto ${plan.firstSave.newCard ? "a NEW card" : "the same row"} ${plan.firstSave.code} (${plan.firstSave.cardId}): ${plan.firstSave.character}, ${plan.firstSave.shots} shots, ${plan.firstSave.clips} clips. Its old copy stays in deck_item_history.`
      : "First edit: nothing to save, the card already matches the editor.",
  );
  lines.push(plan.lost.length ? `WOULD LOSE: ${plan.lost.join("; ")}` : "Nothing lost.");
  lines.push("Nothing was written (read-only).");
  return lines.join("\n");
}
