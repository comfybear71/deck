/**
 * Shorts' older shot-card episodes (EP01–EP03) open in the script studio
 * (2026-10-05, Stuart: "everything in script form, the same UI as
 * Skidmarks and Sunny Banks"; `lib/shortsShotCardScript.ts` does the
 * conversion).
 *
 * Converted on the fly, every time the episode is opened: the shot cards
 * stay exactly as they are and nothing is written just by looking. The
 * first change Stuart makes in the studio (an edit, a render, a plate)
 * saves the converted episode as a script episode on the EPISODES row
 * (`adoptShortsShotCardLive` in `lib/skidmarks.ts`), in the same folder
 * as its old clips; from then on the shot-card version is hidden from
 * the row and kept untouched as the backup.
 *
 * Pure: pass the session state in.
 */
import {
  adultShortEpisodeCode,
  adultShortEpisodeNumbers,
  adultShortStarring,
  editorHasContent,
  type AdultShortsSaved,
  type AdultShortsState,
} from "./adultShorts";
import { shortsOpenEditor } from "./shortsEpisodeCast";
import { shotCardEpisodeToScript, shotCardEpisodeToStudioLive, type ShotCardScript, type ShotCardScriptInput } from "./shortsShotCardScript";
import type { SkidmarksState } from "./skidmarks";
import { studioLocationList } from "./sunnyBanksLocations";
import { SUNNY_BANKS_PICTURE_LOOK, sunnyBanksCastCards } from "./sunnyBanksVoices";
import type { SunnyBanksLiveState, SunnyBanksWorkspaceSnapshot } from "./sunnyBanksWorkspace";

/** The shot-card episode open right now (the shot-card editor picked on the EPISODES row), or `null`. */
function openShotCardEpisode(state: SkidmarksState): { adult: AdultShortsState; card: AdultShortsSaved | undefined } | null {
  const adult = state.adultShorts;
  if (!adult || shortsOpenEditor(adult) !== "cards") return null;
  const card = adult.currentSavedId ? adult.saved.find((x) => x.id === adult.currentSavedId) : undefined;
  if (!card && !editorHasContent(adult)) return null;
  // Already saved as a script episode: that card is the one to open, not a second copy.
  if (card && shotCardsSavedAsScript(adult, state.shortsStudio?.workspaces ?? []).has(card.id)) return null;
  return { adult, card };
}

/** The conversion's inputs for the open shot-card episode (its own Cast and places). */
function conversionInput(state: SkidmarksState): (ShotCardScriptInput & { label: string; mediaSlug: string | null }) | null {
  const open = openShotCardEpisode(state);
  if (!open) return null;
  const { adult, card } = open;
  const title = (card?.title ?? adult.title ?? "").trim();
  const number = card ? adultShortEpisodeNumbers(adult.saved).get(card.id) : undefined;
  const label = card ? `${adultShortEpisodeCode(number ?? 1)} · ${title}` : title;
  // The editor is the open card's working copy (its shots are the newest).
  const starring = adultShortStarring(adult)
    .map((p) => p.name.trim())
    .filter(Boolean);
  // Only the older one-person episodes: their every Line was that person's.
  const onlyCharacter = starring.length <= 1 ? starring[0] || adult.character.name.trim() || null : null;
  return {
    title,
    label,
    mediaSlug: adult.mediaSlug ?? card?.mediaSlug ?? null,
    shots: adult.shots,
    // The episode's own Cast (this is read while the shot-card episode is the open one).
    cast: sunnyBanksCastCards(state, "shorts").map((c) => ({
      name: c.name,
      look: c.look === SUNNY_BANKS_PICTURE_LOOK ? "" : c.look,
    })),
    locations: studioLocationList(state, "shorts").map((l) => ({ key: l.id, name: l.label })),
    onlyCharacter,
  };
}

let cached: { state: SkidmarksState; live: SunnyBanksLiveState | null } | null = null;

/**
 * The open shot-card episode as the script studio's live episode, or
 * `null` when a script episode (or nothing) is open. Read-only.
 */
export function shortsShotCardStudioLive(state: SkidmarksState): SunnyBanksLiveState | null {
  if (cached?.state === state) return cached.live;
  const input = conversionInput(state);
  const live = input ? shotCardEpisodeToStudioLive(input) : null;
  cached = { state, live };
  return live;
}

/** The same conversion with its per-shot notes (who, where, and why it may need a look). */
export function shortsShotCardConversion(state: SkidmarksState): ShotCardScript | null {
  const input = conversionInput(state);
  return input ? shotCardEpisodeToScript(input) : null;
}

/**
 * Shot-card episodes already saved as a script episode: a script card
 * in the same folder (the conversion keeps the folder). They're hidden
 * from the EPISODES row; the shot cards themselves are never deleted.
 */
export function shotCardsSavedAsScript(
  adult: Pick<AdultShortsState, "saved" | "currentSavedId" | "mediaSlug"> | null | undefined,
  workspaces: readonly Pick<SunnyBanksWorkspaceSnapshot, "mediaSlug">[],
): Set<string> {
  const out = new Set<string>();
  if (!adult) return out;
  const folders = new Set(workspaces.map((w) => w.mediaSlug).filter((s): s is string => Boolean(s)));
  for (const card of adult.saved) {
    const slug = card.mediaSlug ?? (card.id === adult.currentSavedId ? adult.mediaSlug : undefined);
    if (slug && folders.has(slug)) out.add(card.id);
  }
  return out;
}
