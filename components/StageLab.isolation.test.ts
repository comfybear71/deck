import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function src(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const GENRE_UI = [
  "components/SkidmarksSunnyBanksPanel.tsx",
  "components/AdultShortsPanel.tsx",
  "components/SkidmarksScriptSequencePanel.tsx",
  "components/SkidmarksDetailSheet.tsx",
  "components/GraphView.tsx",
] as const;

const LAB_UI = ["components/StageLab.tsx", "app/stage-lab/page.tsx"] as const;

const LAB_LIBS = [
  "lib/stageLab.ts",
  "lib/stageLabStore.ts",
  "lib/stageLabCast.ts",
  "lib/stageLabPlate.ts",
] as const;

describe("Stage lab isolation", () => {
  it("the lab UI does not import genre panels or session persist", () => {
    for (const file of LAB_UI) {
      const text = src(file);
      expect(text).not.toMatch(/SkidmarksSunnyBanksPanel/);
      expect(text).not.toMatch(/AdultShortsPanel/);
      expect(text).not.toMatch(/SkidmarksScriptSequencePanel/);
      expect(text).not.toMatch(/SkidmarksDetailSheet/);
      expect(text).not.toMatch(/GraphView/);
      expect(text).not.toMatch(/from ["']@\/lib\/skidmarks["']/);
      expect(text).not.toMatch(/from ["']@\/lib\/deckItemSync["']/);
      expect(text).not.toMatch(/persist\s*\(/);
    }
  });

  it("lab libs never call persist() or genre panel imports", () => {
    for (const file of LAB_LIBS) {
      const text = src(file);
      expect(text, file).not.toMatch(/SkidmarksSunnyBanksPanel/);
      expect(text, file).not.toMatch(/\bpersist\s*\(/);
      expect(text, file).not.toMatch(/subscribeSkidmarks\b/);
      expect(text, file).not.toMatch(/patchCharacterLoras/);
      expect(text, file).not.toMatch(/deleteSunnyBanksWorkspace/);
    }
  });

  it("genre screens and the graph do not mention /stage-lab", () => {
    for (const file of GENRE_UI) {
      const text = src(file);
      expect(text, file).not.toMatch(/stage-lab/);
      expect(text, file).not.toMatch(/StageLab/);
    }
  });
});
