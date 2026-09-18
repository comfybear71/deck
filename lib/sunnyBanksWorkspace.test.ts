import { describe, expect, it } from "vitest";
import {
  buildDefaultSunnyBanksLive,
  buildEmptySunnyBanksLive,
  isSunnyBanksLiveSaved,
  buildSunnyBanksWorkspaceFromLive,
  describeSunnyBanksWorkspace,
  fingerprintWorkspace,
  mintWorkspaceId,
  normalizeSunnyBanksStudio,
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
