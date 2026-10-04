import { describe, expect, it } from "vitest";
import {
  extractVideoBackendOverride,
  ignoredVideoBackendWarning,
  normalizeSilentShotBackend,
  parseRowVideoBackend,
  pickRowVideoBackend,
  musicVideoClipBackend,
  rowVideoBackendChip,
  stripVideoBackendTags,
  videoBackendTagLabel,
} from "./videoBackendRouting";
import { estimateRowVideoCostUsd } from "./clipGeneration";

describe("pickRowVideoBackend", () => {
  it("talking rows stay on LTX", () => {
    expect(pickRowVideoBackend({ kind: "speak", silentDefault: "h3" })).toEqual({ backend: "ltx" });
    expect(pickRowVideoBackend({ kind: "speak", override: "ltx" })).toEqual({ backend: "ltx" });
  });

  it("a [GROK] or [H3] tag on a talking row is ignored, and says so", () => {
    expect(pickRowVideoBackend({ kind: "speak", override: "grok" })).toEqual({ backend: "ltx", ignoredOverride: "grok" });
    expect(pickRowVideoBackend({ kind: "speak", override: "h3" })).toEqual({ backend: "ltx", ignoredOverride: "h3" });
    expect(ignoredVideoBackendWarning("h3")).toContain("[H3] ignored");
  });

  it("silent rows default to Grok, follow the switch, and a tag wins", () => {
    expect(pickRowVideoBackend({ kind: "hold" })).toEqual({ backend: "grok" });
    expect(pickRowVideoBackend({ kind: "hold", silentDefault: "h3" })).toEqual({ backend: "h3" });
    expect(pickRowVideoBackend({ kind: "hold", silentDefault: "h3", override: "ltx" })).toEqual({ backend: "ltx" });
    expect(pickRowVideoBackend({ kind: "hold", silentDefault: "grok", override: "h3" })).toEqual({ backend: "h3" });
  });
});

describe("the override tag", () => {
  it("is read in any case and removed from the line", () => {
    expect(extractVideoBackendOverride("[grok] Ranger Bazza:")).toEqual({ rest: "Ranger Bazza:", override: "grok" });
    expect(extractVideoBackendOverride("Shazza: You right? [ H3 ]")).toEqual({ rest: "Shazza: You right?", override: "h3" });
    expect(extractVideoBackendOverride("[LTX]")).toEqual({ rest: "", override: "ltx" });
  });

  it("the last tag on a line wins", () => {
    expect(extractVideoBackendOverride("[GROK] [H3] Crowd:").override).toBe("h3");
  });

  it("leaves a line with no tag exactly as it was", () => {
    expect(extractVideoBackendOverride("Dazza:  [laughs] yeah")).toEqual({ rest: "Dazza:  [laughs] yeah" });
    expect(stripVideoBackendTags("[whispers] mate")).toBe("[whispers] mate");
    expect(stripVideoBackendTags("[GROK] mate")).toBe("mate");
  });
});

describe("small helpers", () => {
  it("parses and normalises", () => {
    expect(parseRowVideoBackend("GROK")).toBe("grok");
    expect(parseRowVideoBackend("siray")).toBe("siray");
    expect(parseRowVideoBackend("kling")).toBeUndefined();
    expect(parseRowVideoBackend(3)).toBeUndefined();
    expect(normalizeSilentShotBackend("h3")).toBe("h3");
    expect(normalizeSilentShotBackend("ltx")).toBe("grok");
    expect(normalizeSilentShotBackend(undefined)).toBe("grok");
    expect(videoBackendTagLabel("siray")).toBe("[SIRAY]");
  });

  it("a finished row shows the engine it used; an older finished row reads LTX", () => {
    expect(rowVideoBackendChip({ status: "done", used: "grok", planned: "h3" })).toBe("grok");
    expect(rowVideoBackendChip({ status: "done", planned: "grok" })).toBe("ltx");
    expect(rowVideoBackendChip({ status: "idle", planned: "h3" })).toBe("h3");
  });

  it("costs a 5s row per engine", () => {
    expect(estimateRowVideoCostUsd("grok", 5)).toBeCloseTo(0.71, 5);
    expect(estimateRowVideoCostUsd("h3", 5)).toBeCloseTo(0.4, 5);
    expect(estimateRowVideoCostUsd("ltx", 5)).toBeCloseTo(0.65, 5);
  });
});

describe("musicVideoClipBackend", () => {
  it("shows the engine the latest render used, else the clip's setting", () => {
    expect(musicVideoClipBackend({ vocal: true, instrumentalModel: "h3" })).toBe("ltx");
    expect(musicVideoClipBackend({ vocal: false, instrumentalModel: "siray" })).toBe("siray");
    expect(
      musicVideoClipBackend({
        vocal: false,
        instrumentalModel: "h3",
        sent: [{ engine: "Grok", sentAt: 2 }, undefined, { engine: "H3", sentAt: 1 }],
      })
    ).toBe("grok");
  });
});
