import { describe, expect, it } from "vitest";
import {
  buildDefaultSunnyBanksLive,
  buildEmptySunnyBanksLive,
  isSunnyBanksLiveSaved,
  buildSunnyBanksWorkspaceFromLive,
  describeSunnyBanksWorkspace,
  fingerprintWorkspace,
  liveFromSunnyBanksWorkspace,
  mintWorkspaceId,
  normalizeSunnyBanksStudio,
  pickSunnyBanksEpisodeMediaSlug,
  sunnyBanksStudioHasUserContent,
  upsertSunnyBanksWorkspace,
} from "./sunnyBanksWorkspace";

describe("Sunny Banks workspace snapshots", () => {
  it("describes the whole episode, not the open Act pill", () => {
    const live = buildDefaultSunnyBanksLive();
    const snapshot = buildSunnyBanksWorkspaceFromLive({ ...live, activeAct: "II" }, 1, 1);
    expect(describeSunnyBanksWorkspace(snapshot)).toBe("3 acts · 46 clips");
    expect(describeSunnyBanksWorkspace(snapshot)).not.toContain("Act II");
  });

  it("upserts the same episode name so Act I and Act II do not become two cards", () => {
    const live = buildDefaultSunnyBanksLive();
    const first = buildSunnyBanksWorkspaceFromLive({ ...live, activeAct: "II" }, 1, 1);
    const second = buildSunnyBanksWorkspaceFromLive({ ...live, activeAct: "I" }, 2, 2);
    const next = upsertSunnyBanksWorkspace([first], second);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(first.id);
    expect(next[0].actIds).toEqual(["I", "II", "III"]);
    expect(next[0].activeAct).toBe("I");
    expect(countLabel(next)).toBe(1);
  });

  it("keeps a second card when the episode name is different", () => {
    const live = buildDefaultSunnyBanksLive();
    const first = buildSunnyBanksWorkspaceFromLive(live, 1, 1);
    const second = buildSunnyBanksWorkspaceFromLive({ ...live, workspaceTitle: "EP03 — Something Else" }, 2, 2);
    expect(upsertSunnyBanksWorkspace([first], second)).toHaveLength(2);
  });

  it("treats a named card as user content even when the live copy is still the seed", () => {
    const live = buildDefaultSunnyBanksLive();
    expect(sunnyBanksStudioHasUserContent({ live, workspaces: [], saveSeq: 0 })).toBe(false);
    expect(
      sunnyBanksStudioHasUserContent({
        live,
        workspaces: [buildSunnyBanksWorkspaceFromLive(live, 1, 1)],
        saveSeq: 1,
      })
    ).toBe(true);
  });

  it("treats an Act III script edit as user content without a named card", () => {
    const live = buildDefaultSunnyBanksLive();
    live.actScripts.III = `${live.actScripts.III}\nCrowd:`;
    expect(sunnyBanksStudioHasUserContent({ live, workspaces: [], saveSeq: 0 })).toBe(true);
  });

  it("hydrates a saved studio blob and remaps a mid-render row to idle", () => {
    const live = buildDefaultSunnyBanksLive();
    live.runtimeMap.I[0] = { lineKey: "Ranger Bazza: Well here we go", status: "rendering" };
    const snapshot = buildSunnyBanksWorkspaceFromLive(live, 9, 1);
    const restored = normalizeSunnyBanksStudio({
      live,
      workspaces: [snapshot],
      saveSeq: 1,
    });
    expect(restored?.workspaces).toHaveLength(1);
    expect(restored?.live.runtimeMap.I[0]?.status).toBe("idle");
    expect(restored?.workspaces[0].actScripts.II).toBe(live.actScripts.II);
  });

  it("mints distinct ids when seq differs even if the fingerprint matches", () => {
    const live = buildDefaultSunnyBanksLive();
    const fingerprint = fingerprintWorkspace(live);
    expect(mintWorkspaceId(1, 1, fingerprint)).not.toBe(mintWorkspaceId(1, 2, fingerprint));
  });
});

function countLabel(workspaces: Array<{ label: string }>): number {
  return new Set(workspaces.map((workspace) => workspace.label.trim().toLowerCase())).size;
}

describe("buildEmptySunnyBanksLive (2026-09-18)", () => {
  it("is genuinely blank — not the Crash Lab EP02 demo seed", () => {
    const empty = buildEmptySunnyBanksLive();
    const seeded = buildDefaultSunnyBanksLive();

    expect(empty.workspaceTitle).toBe("");
    for (const act of empty.actIds) {
      expect(empty.actScripts[act]).toBe("");
      expect(empty.runtimeMap[act]).toEqual({});
      expect(empty.characterOverrides[act]).toEqual({});
      expect(empty.locationOverrides[act]).toEqual({});
    }
    // The default builder is the demo episode, which is the opposite of
    // what "New Episode" means.
    expect(seeded.actScripts[seeded.actIds[0]]).not.toBe("");
    expect(fingerprintWorkspace(empty)).not.toBe(fingerprintWorkspace(seeded));
  });

  it("keeps the three starting acts, with the first one active", () => {
    const empty = buildEmptySunnyBanksLive();
    expect(empty.actIds).toEqual(["I", "II", "III"]);
    expect(empty.activeAct).toBe("I");
  });

  it("counts as real user content, so a refresh can't reseed EP02 over it", () => {
    // If a blank episode read as "nothing here", the seed would come
    // back on the next load and quietly undo New Episode.
    expect(
      sunnyBanksStudioHasUserContent({ live: buildEmptySunnyBanksLive(), workspaces: [], saveSeq: 0 })
    ).toBe(true);
  });
});

describe("isSunnyBanksLiveSaved (2026-09-18)", () => {
  const live = buildDefaultSunnyBanksLive();

  const saved = buildSunnyBanksWorkspaceFromLive(live, 1, 1);

  it("is true when a saved card already holds exactly what is on screen", () => {
    expect(isSunnyBanksLiveSaved(live, [saved])).toBe(true);
  });

  it("is false when nothing has been saved at all", () => {
    expect(isSunnyBanksLiveSaved(live, [])).toBe(false);
  });

  it("is false once the live copy has moved on from every saved card", () => {
    const edited = { ...live, actScripts: { ...live.actScripts, I: "Shazza: brand new line." } };
    expect(isSunnyBanksLiveSaved(edited, [saved])).toBe(false);
  });

  it("counts a rename as unsaved — the saved card really does still carry the old name", () => {
    // The stored fingerprint covers the title too. Erring toward "not
    // saved yet" costs one extra tap on Save; the opposite costs work.
    expect(isSunnyBanksLiveSaved({ ...live, workspaceTitle: "Totally different name" }, [saved])).toBe(false);
  });

  it("matches against any saved card, not just the most recent", () => {
    const other = buildSunnyBanksWorkspaceFromLive(
      { ...live, actScripts: { ...live.actScripts, I: "Dazza: something else." } },
      2,
      2
    );
    expect(isSunnyBanksLiveSaved(live, [other, saved])).toBe(true);
  });
});

describe("stable episode ids and pinned media folders (2026-09-30)", () => {
  const named = (title: string) => {
    const live = { ...buildEmptySunnyBanksLive(), workspaceTitle: title };
    live.actScripts = { ...live.actScripts, I: "SHAZZA: G'day" };
    return live;
  };

  it("a rename updates the same card: same id, same media folder, one card", () => {
    const first = buildSunnyBanksWorkspaceFromLive(named("The Big Wet"), 1, 1);
    const shelf = upsertSunnyBanksWorkspace([], first);
    expect(shelf[0].mediaSlug).toBe("the-big-wet");
    const renamed = buildSunnyBanksWorkspaceFromLive(named("The Big Dry"), 2, 2);
    const next = upsertSunnyBanksWorkspace(shelf, renamed, shelf[0].id);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: first.id, label: "The Big Dry", mediaSlug: "the-big-wet" });
  });

  it("without an episode id it falls back to the old match-by-name", () => {
    const first = upsertSunnyBanksWorkspace([], buildSunnyBanksWorkspaceFromLive(named("EP1"), 1, 1));
    const again = upsertSunnyBanksWorkspace(first, buildSunnyBanksWorkspaceFromLive(named("EP1"), 2, 2));
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(first[0].id);
    expect(upsertSunnyBanksWorkspace(first, buildSunnyBanksWorkspaceFromLive(named("EP2"), 3, 3))).toHaveLength(2);
  });

  it("an episode id that is no longer on the shelf (card deleted) adds a new card", () => {
    const next = upsertSunnyBanksWorkspace([], buildSunnyBanksWorkspaceFromLive(named("EP1"), 1, 1), "ws-gone");
    expect(next).toHaveLength(1);
  });

  it("media folders are unique on the shelf and a pinned one is never replaced", () => {
    const a = upsertSunnyBanksWorkspace([], buildSunnyBanksWorkspaceFromLive(named("Drop Bears"), 1, 1));
    const b = upsertSunnyBanksWorkspace(a, buildSunnyBanksWorkspaceFromLive(named("Drop  Bears!"), 2, 2));
    expect(b.map((w) => w.mediaSlug)).toEqual(["drop-bears-2", "drop-bears"]);
    const withLiveSlug = upsertSunnyBanksWorkspace([], buildSunnyBanksWorkspaceFromLive(named("Later name"), 3, 3), null, "first-name");
    expect(withLiveSlug[0].mediaSlug).toBe("first-name");
  });

  it("the episode id and media folder are not part of the fingerprint (old cards still read as saved)", () => {
    const live = named("EP1");
    const card = buildSunnyBanksWorkspaceFromLive(live, 1, 1);
    expect(fingerprintWorkspace({ ...live, episodeId: card.id, mediaSlug: "ep1" })).toBe(fingerprintWorkspace(live));
    expect(isSunnyBanksLiveSaved({ ...live, episodeId: card.id, mediaSlug: "ep1" }, [card])).toBe(true);
  });

  it("opening a card carries its id and media folder into the live copy, and both survive a reload", () => {
    const [card] = upsertSunnyBanksWorkspace([], buildSunnyBanksWorkspaceFromLive(named("EP1"), 1, 1));
    const live = liveFromSunnyBanksWorkspace(card);
    expect(live).toMatchObject({ episodeId: card.id, mediaSlug: "ep1" });
    const reloaded = normalizeSunnyBanksStudio(JSON.parse(JSON.stringify({ live, workspaces: [card], saveSeq: 1 })));
    expect(reloaded?.live).toMatchObject({ episodeId: card.id, mediaSlug: "ep1" });
    expect(reloaded?.workspaces[0].mediaSlug).toBe("ep1");
  });

  it("a bad media folder name from storage is dropped, not trusted", () => {
    const reloaded = normalizeSunnyBanksStudio({ live: { ...named("EP1"), mediaSlug: "../x" }, workspaces: [], saveSeq: 0 });
    expect(reloaded?.live.mediaSlug).toBeUndefined();
  });

  it("New Episode starts with no episode id or media folder", () => {
    const live = buildEmptySunnyBanksLive();
    expect(live.episodeId).toBeUndefined();
    expect(live.mediaSlug).toBeUndefined();
    expect(pickSunnyBanksEpisodeMediaSlug("", [])).toBe("episode");
  });
});

describe("saved location keys are kept (2026-09-30)", () => {
  it("keeps a saved or not-yet-added location instead of turning it into the storefront", async () => {
    const { normalizeSunnyBanksLive } = await import("./sunnyBanksWorkspace");
    const live = buildDefaultSunnyBanksLive();
    const next = normalizeSunnyBanksLive({
      ...live,
      defaultLocationId: "park_site_4",
      locationOverrides: { ...live.locationOverrides, I: { 0: "boat_ramp", 1: "office_booth", 2: "Bad Key!", 3: 7 } },
    })!;
    expect(next.defaultLocationId).toBe("park_site_4");
    expect(next.locationOverrides.I[0]).toBe("boat_ramp");
    expect(next.locationOverrides.I[1]).toBe("office_booth");
    // Only a malformed value falls back to the episode's default.
    expect(next.locationOverrides.I[2]).toBe("park_site_4");
    expect(next.locationOverrides.I[3]).toBeUndefined();
    expect(normalizeSunnyBanksLive({ ...live, defaultLocationId: "../../etc" })!.defaultLocationId).toBe(
      buildDefaultSunnyBanksLive().defaultLocationId,
    );
  });
});

describe("silent-row engine fields (2026-09-30)", () => {
  it("keeps a row's videoBackend and the studio's Grok/H3 switch; drops junk", async () => {
    const { normalizeSunnyBanksStudio, buildEmptySunnyBanksLive } = await import("./sunnyBanksWorkspace");
    const live = buildEmptySunnyBanksLive();
    const studio = normalizeSunnyBanksStudio({
      live: {
        ...live,
        runtimeMap: {
          I: {
            0: { lineKey: "Ranger Bazza:", status: "done", videoUrl: "https://b/x.mp4", videoBackend: "h3" },
            1: { lineKey: "Crowd:", status: "done", videoUrl: "https://b/y.mp4", videoBackend: "siray" },
            2: { lineKey: "Shazza:", status: "done", videoUrl: "https://b/z.mp4" },
          },
        },
      },
      workspaces: [],
      saveSeq: 0,
      silentShotBackend: "h3",
    })!;
    expect(studio.silentShotBackend).toBe("h3");
    expect(studio.live.runtimeMap.I[0].videoBackend).toBe("h3");
    expect(studio.live.runtimeMap.I[1].videoBackend).toBeUndefined();
    // An older Done row is untouched: no field invented.
    expect("videoBackend" in studio.live.runtimeMap.I[2]).toBe(false);
    expect(normalizeSunnyBanksStudio({ live, workspaces: [], saveSeq: 0, silentShotBackend: "ltx" })!.silentShotBackend).toBeUndefined();
  });
});
