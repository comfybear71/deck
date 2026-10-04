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
import type { SkidmarksState } from "./skidmarks";
import { episodeOwnLocations } from "./episodeCast";
import { openShortsEpisodeScopeIn } from "./shortsEpisodeCast";
import { openSkidmarksEpisodeScopeIn, skidmarksEpisodeLocations } from "./skidmarksEpisodeCast";
import type { SunnyBanksLocationLock } from "./sunnyBanks";

function toLock(l: DeckLocation): SunnyBanksLocationLock {
  const lock: SunnyBanksLocationLock = { id: l.key, label: l.name, image: l.pictureUrl ?? "" };
  if (l.peopleInPicture) lock.peopleInPicture = true;
  return lock;
}

/** A show's locations (2026-10-04: Skidmarks' own Locations row too; it
 * has no built-ins, so it is empty until a place is added). */
export function sunnyBanksLocationList(
  state: DeckLocationsState | null | undefined,
  genre: "sunnybank" | "skidmarks" = "sunnybank",
): SunnyBanksLocationLock[] {
  return effectiveDeckLocations(state, genre).map(toLock);
}

/**
 * What the studio renders with: Sunny Banks' one shared list, exactly as
 * before; Skidmarks (2026-10-04) only the open episode's own places
 * (`lib/skidmarksEpisodeCast.ts`), so a new episode starts with none.
 */
export function studioLocationList(
  state: Pick<SkidmarksState, "locations" | "skidmarksStudio" | "adultShorts" | "shortsStudio">,
  genre: "sunnybank" | "skidmarks" | "shorts" = "sunnybank",
): SunnyBanksLocationLock[] {
  // Shorts (2026-10-04): the open script episode's own places, the same rule as Skidmarks.
  if (genre === "shorts") return episodeOwnLocations(state.locations, "adult-shorts", openShortsEpisodeScopeIn(state)).map(toLock);
  if (genre !== "skidmarks") return sunnyBanksLocationList(state.locations, genre);
  return skidmarksEpisodeLocations(state.locations, openSkidmarksEpisodeScopeIn(state)).map(toLock);
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
  if (!locationId) return "No location yet. Add one on the Locations row, or a [Location: …] tag above this line.";
  const loc = list.find((l) => l.id === locationId);
  if (!loc) return `Unknown location "${locationId}". Add it on the Locations row or fix the [Location: …] tag.`;
  if (!loc.image) return `${loc.label} has no picture yet. Add one on the Locations row.`;
  return null;
}
