/**
 * Sunnybank's locations for the renderer (2026-09-30): the saved list
 * from the Locations row, or the built-ins until it has one
 * (`effectiveDeckLocations`), as the `{ id, label, image }` locks the
 * panel, the God-script guide and the composite already use. `id` is the
 * location's key (`park_site_4`); `image` is a repo file or a Deck Blob URL.
 *
 * Pure: pass the session state in.
 */
import { effectiveDeckLocations, findDeckLocation, type DeckLocation, type DeckLocationsState } from "./deckLocations";
import type { SunnyBanksLocationLock } from "./sunnyBanks";

function toLock(l: DeckLocation): SunnyBanksLocationLock {
  const lock: SunnyBanksLocationLock = { id: l.key, label: l.name, image: l.pictureUrl ?? "" };
  if (l.peopleInPicture) lock.peopleInPicture = true;
  return lock;
}

export function sunnyBanksLocationList(state: DeckLocationsState | null | undefined): SunnyBanksLocationLock[] {
  return effectiveDeckLocations(state, "sunnybank").map(toLock);
}

/** A location by its key, its key spelled loosely, or its name. */
export function findSunnyBanksLocation(
  list: readonly SunnyBanksLocationLock[],
  token: string,
): SunnyBanksLocationLock | undefined {
  const asDeck = list.map<DeckLocation>((l) => ({
    id: l.id,
    genre: "sunnybank",
    key: l.id,
    name: l.label,
    pictureUrl: l.image || null,
    createdAt: 0,
  }));
  const hit = findDeckLocation(asDeck, token);
  return hit ? list.find((l) => l.id === hit.key) : undefined;
}

/** Why a row can't render with this location, or `null` when it can. */
export function sunnyBanksLocationProblem(
  list: readonly SunnyBanksLocationLock[],
  locationId: string,
): string | null {
  const loc = list.find((l) => l.id === locationId);
  if (!loc) return `Unknown location "${locationId}". Add it on the Locations row or fix the [Location: …] tag.`;
  if (!loc.image) return `${loc.label} has no picture yet. Add one on the Locations row.`;
  return null;
}
