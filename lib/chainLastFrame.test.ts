import { describe, expect, it } from "vitest";
import {
  chainLastFrameToggleLabel,
  clipLoopBounds,
  nextStartAllowsChainFill,
  planChainLastFrameFill,
  plateStillAllowsChainFill,
} from "./chainLastFrame";

describe("plateStillAllowsChainFill", () => {
  it("allows empty and chained; blocks upload / generated / library", () => {
    expect(plateStillAllowsChainFill(undefined)).toBe(true);
    expect(plateStillAllowsChainFill(null)).toBe(true);
    expect(plateStillAllowsChainFill({})).toBe(true);
    expect(plateStillAllowsChainFill({ source: "chained" })).toBe(true);
    expect(plateStillAllowsChainFill({ source: "upload" })).toBe(false);
    expect(plateStillAllowsChainFill({ source: "generated" })).toBe(false);
    expect(plateStillAllowsChainFill({ source: "library" })).toBe(false);
  });
});

describe("nextStartAllowsChainFill", () => {
  it("allows a genuinely empty next start", () => {
    expect(nextStartAllowsChainFill(undefined)).toBe(true);
    expect(nextStartAllowsChainFill(null)).toBe(true);
    expect(nextStartAllowsChainFill({})).toBe(true);
  });

  it("treats a URL with no source as already filled (Generate plates / Make plate)", () => {
    expect(nextStartAllowsChainFill({ url: "https://blob.example/kept.jpg" })).toBe(false);
  });

  it("allows refresh of an already-chained start; never clobbers upload / generated / library", () => {
    expect(nextStartAllowsChainFill({ source: "chained", url: "https://blob.example/old.jpg" })).toBe(true);
    expect(nextStartAllowsChainFill({ source: "upload", url: "https://blob.example/u.jpg" })).toBe(false);
    expect(nextStartAllowsChainFill({ source: "generated", url: "https://blob.example/g.jpg" })).toBe(false);
    expect(nextStartAllowsChainFill({ source: "library", url: "https://blob.example/k.jpg" })).toBe(false);
  });
});

describe("planChainLastFrameFill", () => {
  const last = "https://blob.example/last.jpg";

  it("chain OFF: never fills, even when a last frame exists", () => {
    expect(
      planChainLastFrameFill({
        chainOn: false,
        fromIndex: 0,
        nextIndexExists: true,
        lastFrameUrl: last,
        nextStill: undefined,
      })
    ).toEqual({ action: "skip" });
  });

  it("chain ON: fills an empty next start", () => {
    expect(
      planChainLastFrameFill({
        chainOn: true,
        fromIndex: 0,
        nextIndexExists: true,
        lastFrameUrl: last,
        nextStill: undefined,
      })
    ).toEqual({ action: "fill", url: last });
  });

  it("chain ON: skips Clip 1 upload / Generate plates / sleeve Keep", () => {
    for (const source of ["upload", "generated", "library"] as const) {
      expect(
        planChainLastFrameFill({
          chainOn: true,
          fromIndex: 0,
          nextIndexExists: true,
          lastFrameUrl: last,
          nextStill: { source, url: `https://blob.example/${source}.jpg` },
        })
      ).toEqual({ action: "skip" });
    }
  });

  it("chain ON: may refresh a next start that was itself chained", () => {
    expect(
      planChainLastFrameFill({
        chainOn: true,
        fromIndex: 1,
        nextIndexExists: true,
        lastFrameUrl: last,
        nextStill: { source: "chained", url: "https://blob.example/old-chained.jpg" },
      })
    ).toEqual({ action: "fill", url: last });
  });

  it("chain ON: last clip has nothing to fill", () => {
    expect(
      planChainLastFrameFill({
        chainOn: true,
        fromIndex: 4,
        nextIndexExists: false,
        lastFrameUrl: last,
        nextStill: undefined,
      })
    ).toEqual({ action: "skip" });
  });

  it("chain ON: fails honestly when a fill is needed but lastFrameUrl is missing", () => {
    const plan = planChainLastFrameFill({
      chainOn: true,
      fromIndex: 0,
      nextIndexExists: true,
      nextStill: undefined,
    });
    expect(plan.action).toBe("fail");
    if (plan.action === "fail") expect(plan.message.toLowerCase()).toMatch(/last frame/);
  });
});

describe("clipLoopBounds — one-clip / one-plate scope", () => {
  it("full sequence: startAtClipIndex through the end", () => {
    expect(clipLoopBounds({ length: 5 })).toEqual({ ok: true, start: 0, endExclusive: 5 });
    expect(clipLoopBounds({ length: 5, startAtClipIndex: 2 })).toEqual({ ok: true, start: 2, endExclusive: 5 });
  });

  it("onlyClipIndex runs exactly that one clip", () => {
    expect(clipLoopBounds({ length: 5, onlyClipIndex: 3, startAtClipIndex: 0 })).toEqual({
      ok: true,
      start: 3,
      endExclusive: 4,
    });
  });

  it("refuses an out-of-range selected clip", () => {
    const out = clipLoopBounds({ length: 3, onlyClipIndex: 9 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message.toLowerCase()).toMatch(/not in this sequence/);
  });

  it("empty sequence", () => {
    const out = clipLoopBounds({ length: 0 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message.toLowerCase()).toMatch(/no clips/);
  });
});

describe("chainLastFrameToggleLabel", () => {
  it("matches the Music video Script Sequence copy", () => {
    expect(chainLastFrameToggleLabel(false)).toBe("Chain last→first");
    expect(chainLastFrameToggleLabel(true)).toBe("Chain last→first · ON");
  });
});
