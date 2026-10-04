/**
 * Test fixtures (2026-10-04): a Skidmarks studio with the pilot open, so
 * tests written for "the Skidmarks Cast" see the pilot's own Cast (every
 * card from before episodes had their own). Tests only.
 */
import { SKIDMARKS_PILOT_MEDIA_SLUG } from "./skidmarksEpisodeCast";
import { buildEmptySunnyBanksLive, type SkidmarksSunnyBanksState } from "./sunnyBanksWorkspace";

export function pilotOpenSkidmarksStudio(): SkidmarksSunnyBanksState {
  return {
    live: { ...buildEmptySunnyBanksLive("skidmarks"), workspaceTitle: "EP00 — Cornish Arsehole", mediaSlug: SKIDMARKS_PILOT_MEDIA_SLUG },
    workspaces: [],
    saveSeq: 0,
  };
}
