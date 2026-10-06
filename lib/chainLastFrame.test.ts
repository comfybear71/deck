import { describe, expect, it } from "vitest";
import {
  chainFromPreviousBlocksRender,
  chainFromPreviousButtonTitle,
  chainFromPreviousLabel,
  chainFromPreviousStatusText,
  clipLoopBounds,
  nextStartAllowsChainFill,
  planChainLastFrameFill,
  plateStillAllowsChainFill,
  resolveChainFromPreviousStatus,
  resolveRowStartPlateUrl,
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

describe("chainFromPreviousLabel", () => {
  it("names the shot the row above actually is", () => {
    expect(chainFromPreviousLabel(1)).toBe("Chain from shot 1");
    expect(chainFromPreviousLabel(4)).toBe("Chain from shot 4");
  });
});

describe("resolveChainFromPreviousStatus", () => {
  it("off when the toggle itself is off, regardless of the previous row's state", () => {
    expect(
      resolveChainFromPreviousStatus({ chainOn: false, fromRowNumber: 1, previousDone: true, previousLastFrameUrl: "https://x/last.jpg" })
    ).toEqual({ kind: "off" });
  });

  it("waiting when the previous row hasn't rendered yet", () => {
    expect(resolveChainFromPreviousStatus({ chainOn: true, fromRowNumber: 2, previousDone: false })).toEqual({
      kind: "waiting",
      fromRowNumber: 2,
    });
  });

  it("ready the moment the previous row is Done and already has a last frame", () => {
    expect(
      resolveChainFromPreviousStatus({
        chainOn: true,
        fromRowNumber: 1,
        previousDone: true,
        previousLastFrameUrl: "https://x/last.jpg",
      })
    ).toEqual({ kind: "ready", fromRowNumber: 1, url: "https://x/last.jpg" });
  });

  it("needs extraction when the previous row is Done but only has its finished video, no saved last frame yet", () => {
    expect(
      resolveChainFromPreviousStatus({
        chainOn: true,
        fromRowNumber: 1,
        previousDone: true,
        previousVideoUrl: "https://x/clip.mp4",
      })
    ).toEqual({ kind: "need-extract", fromRowNumber: 1, videoUrl: "https://x/clip.mp4" });
  });

  it("extracting while the caller's own free extraction call is in flight", () => {
    expect(
      resolveChainFromPreviousStatus({
        chainOn: true,
        fromRowNumber: 1,
        previousDone: true,
        previousVideoUrl: "https://x/clip.mp4",
        extracting: true,
      })
    ).toEqual({ kind: "extracting", fromRowNumber: 1 });
  });

  it("unavailable with the caller's own honest extraction-failure message", () => {
    expect(
      resolveChainFromPreviousStatus({
        chainOn: true,
        fromRowNumber: 1,
        previousDone: true,
        previousVideoUrl: "https://x/clip.mp4",
        extractionError: "ffmpeg could not extract the last frame: corrupt file.",
      })
    ).toEqual({ kind: "unavailable", fromRowNumber: 1, message: "ffmpeg could not extract the last frame: corrupt file." });
  });

  it("unavailable with its own honest fallback message when the previous row somehow has no clip at all", () => {
    const status = resolveChainFromPreviousStatus({ chainOn: true, fromRowNumber: 3, previousDone: true });
    expect(status.kind).toBe("unavailable");
    if (status.kind === "unavailable") expect(status.message.toLowerCase()).toMatch(/shot 3/);
  });
});

describe("resolveRowStartPlateUrl", () => {
  it("never overwrites a manual plate while chain is off", () => {
    expect(resolveRowStartPlateUrl({ chainStatus: { kind: "off" }, ownPlateUrl: "https://x/manual.jpg" })).toBe(
      "https://x/manual.jpg"
    );
  });

  it("never overwrites a manual plate while chain isn't resolved yet", () => {
    expect(
      resolveRowStartPlateUrl({ chainStatus: { kind: "waiting", fromRowNumber: 1 }, ownPlateUrl: "https://x/manual.jpg" })
    ).toBe("https://x/manual.jpg");
    expect(
      resolveRowStartPlateUrl({
        chainStatus: { kind: "unavailable", fromRowNumber: 1, message: "nope" },
        ownPlateUrl: "https://x/manual.jpg",
      })
    ).toBe("https://x/manual.jpg");
  });

  it("deliberately overrides a manual plate once chain is ready — that's the point of turning it on", () => {
    expect(
      resolveRowStartPlateUrl({
        chainStatus: { kind: "ready", fromRowNumber: 1, url: "https://x/last.jpg" },
        ownPlateUrl: "https://x/manual.jpg",
      })
    ).toBe("https://x/last.jpg");
  });

  it("stays undefined when there's no manual plate and chain isn't ready", () => {
    expect(resolveRowStartPlateUrl({ chainStatus: { kind: "off" } })).toBeUndefined();
    expect(resolveRowStartPlateUrl({ chainStatus: { kind: "waiting", fromRowNumber: 1 } })).toBeUndefined();
  });
});

describe("chainFromPreviousBlocksRender", () => {
  it("never blocks when chain is off or already resolved", () => {
    expect(chainFromPreviousBlocksRender({ kind: "off" })).toBe(false);
    expect(chainFromPreviousBlocksRender({ kind: "ready", fromRowNumber: 1, url: "https://x/last.jpg" })).toBe(false);
  });

  it("blocks on every other state", () => {
    expect(chainFromPreviousBlocksRender({ kind: "waiting", fromRowNumber: 1 })).toBe(true);
    expect(chainFromPreviousBlocksRender({ kind: "need-extract", fromRowNumber: 1, videoUrl: "https://x/clip.mp4" })).toBe(true);
    expect(chainFromPreviousBlocksRender({ kind: "extracting", fromRowNumber: 1 })).toBe(true);
    expect(chainFromPreviousBlocksRender({ kind: "unavailable", fromRowNumber: 1, message: "nope" })).toBe(true);
  });
});

describe("chainFromPreviousButtonTitle / chainFromPreviousStatusText", () => {
  it("names the right shot in both the on and off title", () => {
    expect(chainFromPreviousButtonTitle(true, 2)).toMatch(/shot 2/);
    expect(chainFromPreviousButtonTitle(false, 2)).toMatch(/shot 2/);
  });

  it("has no status text for off/ready — those render their own chrome", () => {
    expect(chainFromPreviousStatusText({ kind: "off" })).toBeUndefined();
    expect(chainFromPreviousStatusText({ kind: "ready", fromRowNumber: 1, url: "https://x/last.jpg" })).toBeUndefined();
  });

  it("surfaces the real extraction-failure message verbatim", () => {
    expect(chainFromPreviousStatusText({ kind: "unavailable", fromRowNumber: 1, message: "custom failure text" })).toBe(
      "custom failure text"
    );
  });
});
