/**
 * The Locations row's actions (2026-09-30): add, rename, replace the
 * picture, delete. The same code for Sunnybank, Music video, Skidmarks
 * and Shorts; each saves through `patchDeckLocations` /
 * `removeDeckLocation` (its own `deck_items` row, kind `location`).
 *
 * A genre that shows built-ins (Sunnybank, until it has saved locations)
 * copies them into the saved list on its first edit, so the row never
 * jumps and every built-in keeps its key (`office_storefront`,
 * `park_site_4`...) — the keys scripts and saved rows point at. Each
 * edit is sent straight away (like a character rename), not debounced.
 *
 * A location's key never changes, so a rename never breaks a script's
 * `[Location: park_site_4]` or a saved row. Pictures are uploaded before
 * any of this is called (`lib/locationPicture.ts`).
 */
import {
  buildDeckLocation,
  cleanDeckLocationName,
  deckLocationNameProblem,
  savedDeckLocations,
  withBuiltInsSaved,
  type DeckLocation,
  type DeckLocationEdit,
  type DeckLocationGenre,
  type DeckLocationsState,
} from "./deckLocations";
import { flushSkidmarksSessionNow, getDeckLocationsState, patchDeckLocations, removeDeckLocation } from "./skidmarks";

/** The saved list with the genre's built-ins in, before an edit. */
function materialised(genre: DeckLocationGenre): DeckLocationsState {
  const state = getDeckLocationsState();
  if (savedDeckLocations(state, genre).length > 0) return state;
  const next = withBuiltInsSaved(state, genre);
  if (next.locations.length !== state.locations.length) patchDeckLocations(() => next);
  return next;
}

export function addDeckLocation(genre: DeckLocationGenre, name: string, pictureUrl: string | null): DeckLocationEdit<DeckLocation> {
  const state = getDeckLocationsState();
  const list = savedDeckLocations(withBuiltInsSaved(state, genre), genre);
  const built = buildDeckLocation(genre, list, name, pictureUrl);
  if (!built.ok) return built;
  materialised(genre);
  patchDeckLocations((s) => ({ locations: [...s.locations, built.value] }));
  flushSkidmarksSessionNow();
  return built;
}

export function renameDeckLocation(genre: DeckLocationGenre, id: string, name: string): DeckLocationEdit<string> {
  const list = savedDeckLocations(withBuiltInsSaved(getDeckLocationsState(), genre), genre);
  if (!list.some((l) => l.id === id)) return { ok: false, error: "That location isn't on the row any more." };
  const problem = deckLocationNameProblem(list, name, id);
  if (problem) return { ok: false, error: problem };
  const clean = cleanDeckLocationName(name);
  materialised(genre);
  patchDeckLocations((s) => ({ locations: s.locations.map((l) => (l.id === id ? { ...l, name: clean } : l)) }));
  flushSkidmarksSessionNow();
  return { ok: true, value: clean };
}

export function setDeckLocationPicture(genre: DeckLocationGenre, id: string, pictureUrl: string): DeckLocationEdit<string> {
  const list = savedDeckLocations(withBuiltInsSaved(getDeckLocationsState(), genre), genre);
  if (!list.some((l) => l.id === id)) return { ok: false, error: "That location isn't on the row any more." };
  materialised(genre);
  patchDeckLocations((s) => ({ locations: s.locations.map((l) => (l.id === id ? { ...l, pictureUrl } : l)) }));
  flushSkidmarksSessionNow();
  return { ok: true, value: pictureUrl };
}

/** "People already in this picture — don't add Cast" (2026-10-03). Unticked removes the flag. */
export function setDeckLocationPeopleInPicture(genre: DeckLocationGenre, id: string, on: boolean): DeckLocationEdit<boolean> {
  const list = savedDeckLocations(withBuiltInsSaved(getDeckLocationsState(), genre), genre);
  if (!list.some((l) => l.id === id)) return { ok: false, error: "That location isn't on the row any more." };
  materialised(genre);
  patchDeckLocations((s) => ({
    locations: s.locations.map((l) => {
      if (l.id !== id) return l;
      const { peopleInPicture: _old, ...rest } = l;
      void _old;
      return on ? { ...rest, peopleInPicture: true as const } : rest;
    }),
  }));
  flushSkidmarksSessionNow();
  return { ok: true, value: on };
}

/** The two-tap bin. The picture stays in Blob (nothing is ever deleted there). */
export function deleteDeckLocation(genre: DeckLocationGenre, id: string): DeckLocationEdit<string> {
  const list = savedDeckLocations(withBuiltInsSaved(getDeckLocationsState(), genre), genre);
  if (!list.some((l) => l.id === id)) return { ok: false, error: "That location isn't on the row any more." };
  materialised(genre);
  removeDeckLocation(id);
  flushSkidmarksSessionNow();
  return { ok: true, value: id };
}
