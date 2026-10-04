import { describe, expect, it } from "vitest";
import {
  deleteSunnyBanksWorkspace,
  ensureSunnyBanksEpisodeMediaSlug,
  getSkidmarksSnapshot,
  getStudioState,
  getSunnyBanksLiveOrDefault,
  openSunnyBanksWorkspace,
  patchSunnyBanksLive,
  saveSunnyBanksProjectWorkspace,
  setSunnyBanksSilentShotBackend,
  startNewSunnyBanksEpisode,
} from "./skidmarks";

/**
 * One store, two shows (2026-10-04): every Sunny Banks call without a
 * show name works on `sunnyBanks` exactly as before; the same calls with
 * "skidmarks" work on `skidmarksStudio` and never touch Sunny Banks.
 */
describe("Skidmarks episodes live on their own shelf", () => {
  it("an edit, save, New and reopen with skidmarks never touch Sunny Banks", () => {
    const sunnyBefore = getSkidmarksSnapshot().sunnyBanks;
    startNewSunnyBanksEpisode("skidmarks");
    patchSunnyBanksLive(
      (live) => ({
        ...live,
        workspaceTitle: "Cornish Arsehole",
        castIds: ["c_dap"],
        actScripts: { ...live.actScripts, I: "[Location: town_street]\nDAP: Alright?" },
      }),
      "skidmarks",
    );
    expect(getSkidmarksSnapshot().sunnyBanks).toBe(sunnyBefore);

    const studio = getStudioState("skidmarks")!;
    expect(studio.live.workspaceTitle).toBe("Cornish Arsehole");
    expect(studio.live.castIds).toEqual(["c_dap"]);
    // Auto-saved onto a card, like Sunny Banks.
    expect(studio.workspaces).toHaveLength(1);
    const id = studio.workspaces[0].id;
    expect(studio.workspaces[0].label).toBe("Cornish Arsehole");
    expect(studio.workspaces[0].castIds).toEqual(["c_dap"]);

    const saved = saveSunnyBanksProjectWorkspace("skidmarks");
    expect(saved.id).toBe(id);
    startNewSunnyBanksEpisode("skidmarks");
    expect(getSunnyBanksLiveOrDefault(getSkidmarksSnapshot(), "skidmarks").actScripts.I).toBe("");
    expect(getSunnyBanksLiveOrDefault(getSkidmarksSnapshot(), "skidmarks").defaultLocationId).toBe("");
    openSunnyBanksWorkspace(id, "skidmarks");
    const reopened = getStudioState("skidmarks")!.live;
    expect(reopened.episodeId).toBe(id);
    expect(reopened.castIds).toEqual(["c_dap"]);
    expect(reopened.actScripts.I).toContain("DAP: Alright?");
    // A readable clip folder name from the title.
    expect(ensureSunnyBanksEpisodeMediaSlug("skidmarks")).toBe("cornish-arsehole");
    expect(getSkidmarksSnapshot().sunnyBanks).toBe(sunnyBefore);

    setSunnyBanksSilentShotBackend("grok", "skidmarks");
    expect(getSkidmarksSnapshot().sunnyBanks).toBe(sunnyBefore);

    deleteSunnyBanksWorkspace(id, "skidmarks");
    expect(getStudioState("skidmarks")!.workspaces).toHaveLength(0);
    expect(getSkidmarksSnapshot().sunnyBanks).toBe(sunnyBefore);
  });

  it("without a show name the calls are Sunny Banks', and Skidmarks is untouched", () => {
    const skBefore = getSkidmarksSnapshot().skidmarksStudio;
    startNewSunnyBanksEpisode();
    patchSunnyBanksLive((live) => ({ ...live, workspaceTitle: "EP09", actScripts: { ...live.actScripts, I: "Nan: G'day." } }));
    expect(getSkidmarksSnapshot().skidmarksStudio).toBe(skBefore);
    expect(getSkidmarksSnapshot().sunnyBanks?.live.workspaceTitle).toBe("EP09");
    expect(getSkidmarksSnapshot().sunnyBanks?.live.castIds).toBeUndefined();
  });
});
