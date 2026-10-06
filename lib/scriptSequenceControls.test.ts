import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * Continuity lock: Music video Script Sequence and the shared
 * Sunny Banks / Skidmarks / Shorts God Script panel both surface the
 * same two controls (Chain last→first, Render this). Source-grep so a
 * later layout pass cannot drop one genre's copy.
 */
describe("script-sequence controls on every God Script / Script Sequence panel", () => {
  const musicVideo = read("../components/SkidmarksScriptSequencePanel.tsx");
  const studio = read("../components/SkidmarksSunnyBanksPanel.tsx");
  const speakBeat = read("../app/api/skidmarks/sunnybank/generate-speak-beat/route.ts");

  it("Music video Script Sequence has Chain last→first, This plate, and Render this", () => {
    expect(musicVideo).toContain("chainLastFrameToggleLabel");
    expect(musicVideo).toContain("Chain last→first");
    expect(musicVideo).toContain("This plate");
    expect(musicVideo).toContain("Render this");
    expect(musicVideo).toContain("handleThisPlate");
    expect(musicVideo).toContain("handleRenderThis");
    expect(musicVideo).toContain("onlyClipIndex");
  });

  it("Sunny Banks / Skidmarks / Shorts God Script has Chain last→first and Render this", () => {
    expect(studio).toContain("chainLastFrameToggleLabel");
    expect(studio).toContain("Chain last→first");
    expect(studio).toContain("Render this");
    expect(studio).toContain("handleRenderThis");
    expect(studio).toContain("planChainLastFrameFill");
    expect(studio).toContain("chainLastFrameToNext");
    expect(studio).toContain("Make plate");
  });

  it("speak-beat returns lastFrameUrl so Chain last→first can fill the next start", () => {
    expect(speakBeat).toContain("persistBeatLastFrame");
    expect(speakBeat).toContain("lastFrameUrl");
    expect(speakBeat).toContain("extractLastVideoFrameServer");
  });
});
