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

/**
 * Stage lab must stay a separate sandbox. Genre screens must not link
 * to it; the lab must not import those screens or the session persist
 * path (so a tap cannot rewrite an episode).
 */
describe("Stage lab isolation", () => {
  it("the lab does not import genre panels or session persist", () => {
    const files = ["components/StageLabMock.tsx", "app/stage-lab/page.tsx"];
    for (const file of files) {
      const text = src(file);
      expect(text).not.toMatch(/SkidmarksSunnyBanksPanel/);
      expect(text).not.toMatch(/AdultShortsPanel/);
      expect(text).not.toMatch(/SkidmarksScriptSequencePanel/);
      expect(text).not.toMatch(/SkidmarksDetailSheet/);
      expect(text).not.toMatch(/GraphView/);
      expect(text).not.toMatch(/deckItemSync/);
      expect(text).not.toMatch(/from ["']@\/lib\/skidmarks["']/);
      expect(text).not.toMatch(/from ["']@\/lib\/deckItemSync["']/);
    }
  });

  it("genre screens and the graph do not mention /stage-lab", () => {
    for (const file of GENRE_UI) {
      const text = src(file);
      expect(text, file).not.toMatch(/stage-lab/);
      expect(text, file).not.toMatch(/StageLabMock/);
    }
  });
});
