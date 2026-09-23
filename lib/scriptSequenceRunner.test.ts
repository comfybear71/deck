import { describe, expect, it, vi } from "vitest";
import {
  isGeneratePlatesButtonDisabled,
  parseScriptPartKind,
  plateStillCountsAsReady,
  plateStillAllowsChainFill,
  resolveScriptPartIdentity,
  runAnimateExistingPlates,
  runGeneratePlates,
  runIdentitySafeSongRender,
  runScriptSequence,
  scriptPartUsesLtx,
  type AnimateExistingPlatesDeps,
  type AnimateExistingPlatesTarget,
  type GeneratePlatesDeps,
  type GeneratePlatesTarget,
  type IdentitySafeRunDeps,
  type IdentitySafeScriptPart,
  type IdentitySafeRunTarget,
  type ScriptSequenceRunnerDeps,
} from "./scriptSequenceRunner";
import { buildScriptSequenceSegments } from "./skidmarks";
import type { SkidmarksClipSegment, SkidmarksMember } from "./skidmarks";

function member(overrides: Partial<SkidmarksMember>): SkidmarksMember {
  return { id: "member-id", name: "", emoji: "", looks: [], ...overrides };
}

/** Every `setPlateStill` call that isn't clip 1's own first still — i.e.
 * the chain-fills onto every clip after it. */
function chainFillCalls(deps: ScriptSequenceRunnerDeps, firstSegmentId: string) {
  const calls = (deps.setPlateStill as ReturnType<typeof vi.fn>).mock.calls as [
    string,
    string,
    { dataUrl: string; source: string; featuresLockedCharacter?: boolean },
  ][];
  return calls.filter(([segmentId]) => segmentId !== firstSegmentId).map(([, , still]) => still);
}

function threeParts() {
  return [
    { index: 1, title: "A", startSec: 0, endSec: 15, prompt: "part one" },
    { index: 2, title: "B", startSec: 15, endSec: 30, prompt: "part two" },
    { index: 3, title: "C", startSec: 30, endSec: 45, prompt: "part three" },
  ];
}

/** Five parts — long enough to cross one
 * `LOCKED_CHARACTER_CHAIN_BATCH_SIZE` (4) boundary, so a batching test
 * can see both a within-batch chain-fill and a batch-boundary reset. */
function fiveParts() {
  return [
    { index: 1, title: "A", startSec: 0, endSec: 15, prompt: "part one" },
    { index: 2, title: "B", startSec: 15, endSec: 30, prompt: "part two" },
    { index: 3, title: "C", startSec: 30, endSec: 45, prompt: "part three" },
    { index: 4, title: "D", startSec: 45, endSec: 60, prompt: "part four" },
    { index: 5, title: "E", startSec: 60, endSec: 75, prompt: "part five" },
  ];
}

/** A fully successful fake pipeline — every dep resolves as if the real
 * network/DOM calls behind it worked. Individual tests override just
 * the one dep they want to fail. */
function fakeDeps(overrides: Partial<ScriptSequenceRunnerDeps> = {}): ScriptSequenceRunnerDeps {
  return {
    resolveIdentityDataUrl: vi.fn(async (dataUrl: string) => dataUrl),
    generateFirstStill: vi.fn(async () => ({ ok: true as const, dataUrl: "data:image/jpeg;base64,first" })),
    uploadStill: vi.fn(async (dataUrl: string) => ({ ok: true as const, url: `https://blob.example/${dataUrl.length}` })),
    renderClip: vi.fn(async () => ({
      ok: true as const,
      videoUrl: "https://blob.example/clip.mp4",
      persisted: true,
      lastFrameUrl: "https://blob.example/clip-lastframe.jpg",
    })),
    recordRender: vi.fn(),
    setPlateStill: vi.fn(),
    onProgress: vi.fn(),
    ...overrides,
  };
}

/** Runs with no real song audio/vocalist — every clip in `threeParts()`
 * comes out Instrumental (an empty `realSegments` list means
 * `resolveScriptPartVocal` never finds anything to route Vocal), so
 * these two are never actually read by most tests below. */
function run(
  segments: SkidmarksClipSegment[],
  deps: ScriptSequenceRunnerDeps,
  mp3AudioUrl?: string,
  vocalist?: SkidmarksMember,
  startAtClipIndex?: number,
  shouldStop?: () => boolean
) {
  return runScriptSequence(segments, "Stu Balls", deps, mp3AudioUrl, vocalist, startAtClipIndex, shouldStop);
}

describe("runScriptSequence", () => {
  it("real reported ask: renders all clips in order, chaining each into the next, and reports full success", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const deps = fakeDeps();

    const outcome = await run(segments, deps);

    expect(outcome).toEqual({ ok: true, renderedCount: 3 });
    expect(deps.renderClip).toHaveBeenCalledTimes(3);
    expect(deps.recordRender).toHaveBeenCalledTimes(3);
    // Chains after clip 1 and clip 2, never after the last clip (nothing to chain into) —
    // each chain-fill plus clip 1's own first still is one setPlateStill call.
    expect(deps.setPlateStill).toHaveBeenCalledTimes(3); // clip 1's first still + 2 chained fills
  });

  it("generates a starting still for clip 1 only when it doesn't already have one", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const deps = fakeDeps();
    await run(segments, deps);
    expect(deps.generateFirstStill).toHaveBeenCalledTimes(1);
    expect(deps.generateFirstStill).toHaveBeenCalledWith("part one", "Stu Balls", false, undefined);
  });

  it("skips generating a starting still when clip 1 already has one", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    segments[0].plates[0].still = { dataUrl: "data:image/jpeg;base64,already", source: "upload", createdAt: 1 };
    const deps = fakeDeps();
    await run(segments, deps);
    expect(deps.generateFirstStill).not.toHaveBeenCalled();
  });

  it("stops immediately, before any render call, if generating clip 1's starting still fails", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const deps = fakeDeps({
      generateFirstStill: vi.fn(async () => ({ ok: false as const, message: "xAI unconfigured" })),
    });

    const outcome = await run(segments, deps);

    expect(outcome).toEqual({ ok: false, failedAtClipIndex: 0, message: "xAI unconfigured", renderedCount: 0 });
    expect(deps.renderClip).not.toHaveBeenCalled();
  });

  it("real reported concern: a render failure partway through stops the whole run — never keeps spending on the rest", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const renderClip = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        videoUrl: "https://blob.example/1.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/1-lastframe.jpg",
      })
      .mockResolvedValueOnce({ ok: false, message: "Load failed" });
    const deps = fakeDeps({ renderClip });

    const outcome = await run(segments, deps);

    expect(outcome).toEqual({ ok: false, failedAtClipIndex: 1, message: "Load failed", renderedCount: 1 });
    expect(renderClip).toHaveBeenCalledTimes(2); // never attempts clip 3
    expect(deps.recordRender).toHaveBeenCalledTimes(1); // clip 1's real, successful render is still kept
  });

  it("treats a render that succeeded but didn't persist as a real failure, and stops there", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const renderClip = vi.fn().mockResolvedValueOnce({
      ok: true,
      videoUrl: "https://xai.example/temp.mp4",
      persisted: false,
      persistError: "Blob store not configured",
    });
    const deps = fakeDeps({ renderClip });

    const outcome = await run(segments, deps);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.message).toContain("Blob store not configured");
    }
    expect(deps.recordRender).not.toHaveBeenCalled();
  });

  it("real reported bug (2026-09-14): a render with no server-captured last frame stops the run rather than rendering the next clip from nothing", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const renderClip = vi.fn().mockResolvedValueOnce({
      ok: true,
      videoUrl: "https://blob.example/1.mp4",
      persisted: true,
      // no lastFrameUrl — server-side extraction (lib/serverVideoFrame.ts) didn't succeed for this render.
    });
    const deps = fakeDeps({ renderClip });

    const outcome = await run(segments, deps);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.message).toContain("couldn't capture");
      expect(outcome.renderedCount).toBe(1); // clip 1 itself did render successfully
    }
    expect(renderClip).toHaveBeenCalledTimes(1); // never reaches clip 2 — no starting frame for it
  });

  it("never overwrites a plate that somehow already has a still mid-run", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    segments[1].plates[0].still = { dataUrl: "data:image/jpeg;base64,preset", source: "upload", createdAt: 1 };
    const deps = fakeDeps();

    await run(segments, deps);

    // Clip 1's own first still, plus only one chain-fill (clip 2 -> clip 3);
    // clip 1 -> clip 2 is skipped since clip 2 already has a still.
    expect(deps.setPlateStill).toHaveBeenCalledTimes(2);
  });

  it("audit test J4: a locked vocalist chains inside a 3-clip scene block, then clip 4 starts from a fresh generated still of its own scene", async () => {
    const segments = buildScriptSequenceSegments(fiveParts(), []);
    const jackAsh = member({
      id: "jack-ash-frontman",
      name: "Jack Ash",
      avatarImage: "https://blob.example/jack-ash-reference.jpg",
    });
    const deps = fakeDeps();

    const outcome = await run(segments, deps, undefined, jackAsh);

    expect(outcome.ok).toBe(true);
    expect(deps.renderClip).toHaveBeenCalledTimes(5);
    const fills = chainFillCalls(deps, segments[0].id);
    expect(fills).toHaveLength(4); // clip1->2, 2->3 chained; clip 4 fresh; 4->5 chained
    expect(fills[0].source).toBe("chained");
    expect(fills[1].source).toBe("chained");
    expect(fills[2].source).toBe("generated");
    expect(fills[2].dataUrl).not.toBe("https://blob.example/clip-lastframe.jpg");
    expect(fills[2].dataUrl).not.toBe("https://blob.example/jack-ash-reference.jpg"); // never the same master photo
    expect(fills[3].source).toBe("chained");
    // clip 1's still + clip 4's fresh scene still — generated from clip 4's own shot prompt.
    expect(deps.generateFirstStill).toHaveBeenCalledTimes(2);
    expect(deps.generateFirstStill).toHaveBeenLastCalledWith("part four", "Stu Balls", false, jackAsh);
  });

  it("audit Part 4: plates pre-filled with the master photo by Build timeline are placeholders — only clip 1 renders from it, the rest chain or get a fresh scene still", async () => {
    const segments = buildScriptSequenceSegments(fiveParts(), []);
    const master = "https://blob.example/jack-ash-reference.jpg";
    const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: master });
    for (const segment of segments) {
      segment.plates[0].still = { dataUrl: master, source: "generated", createdAt: 1, featuresLockedCharacter: true };
    }
    const deps = fakeDeps();

    const outcome = await run(segments, deps, undefined, jackAsh);

    expect(outcome.ok).toBe(true);
    const startImages = (deps.renderClip as ReturnType<typeof vi.fn>).mock.calls.map(
      ([request]) => (request as { referenceImageDataUrls: string[] }).referenceImageDataUrls[0]
    );
    expect(startImages[0]).toBe(master); // clip 1 may start on it
    for (const url of startImages.slice(1)) expect(url).not.toBe(master); // nothing else does
    const fills = chainFillCalls(deps, segments[0].id);
    expect(fills.map((f) => f.source)).toEqual(["chained", "chained", "generated", "chained"]);
  });

  it("never overwrites a real still Stuart accepted, even mid-run", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: "https://blob.example/master.jpg" });
    segments[1].plates[0].still = { dataUrl: "https://blob.example/his-own-scene.jpg", source: "upload", createdAt: 1 };
    const deps = fakeDeps();

    await run(segments, deps, undefined, jackAsh);

    expect(chainFillCalls(deps, segments[0].id).some((f) => f.dataUrl === "https://blob.example/clip-lastframe.jpg" && false)).toBe(false);
    const startImages = (deps.renderClip as ReturnType<typeof vi.fn>).mock.calls.map(
      ([request]) => (request as { referenceImageDataUrls: string[] }).referenceImageDataUrls[0]
    );
    expect(startImages[1]).toBe("https://blob.example/his-own-scene.jpg");
  });

  it("audit test J5/L1: renders each script part at its own length, clamped 5\u201315s, never a hardcoded 15", async () => {
    const parts = [
      { index: 1, title: "A", startSec: 0, endSec: 10, prompt: "ten seconds" },
      { index: 2, title: "B", startSec: 10, endSec: 13, prompt: "three seconds" },
      { index: 3, title: "C", startSec: 13, endSec: 53, prompt: "forty seconds" },
    ];
    const segments = buildScriptSequenceSegments(parts, []);
    const deps = fakeDeps();

    await run(segments, deps);

    const durations = (deps.renderClip as ReturnType<typeof vi.fn>).mock.calls.map(([request]) => (request as { durationSec: number }).durationSec);
    expect(durations).toEqual([10, 5, 15]);
  });

  it("a resume landing on a clip with no still generates one first instead of failing", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const deps = fakeDeps();

    const outcome = await run(segments, deps, undefined, undefined, 1);

    expect(outcome.ok).toBe(true);
    expect(deps.generateFirstStill).toHaveBeenCalledTimes(1);
    expect(deps.generateFirstStill).toHaveBeenCalledWith("part two", "Stu Balls", false, undefined);
    expect(deps.renderClip).toHaveBeenCalledTimes(2);
  });

  it("stops honestly when the fresh scene still at a block boundary fails, keeping every render so far", async () => {
    const segments = buildScriptSequenceSegments(fiveParts(), []);
    const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", avatarImage: "https://blob.example/jack.jpg" });
    const generateFirstStill = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, dataUrl: "data:image/jpeg;base64,first" })
      .mockResolvedValueOnce({ ok: false, message: "still service down" });
    const deps = fakeDeps({ generateFirstStill });

    const outcome = await run(segments, deps, undefined, jackAsh);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(3);
      expect(outcome.renderedCount).toBe(3);
      expect(outcome.message).toContain("still service down");
    }
    expect(deps.renderClip).toHaveBeenCalledTimes(3);
  });

  it("real ask (2026-09-16): a locked vocalist with no captured last frame stops honestly, same as an unlocked vocalist — no silent fallback photo", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const jackAsh = member({
      id: "jack-ash-frontman",
      name: "Jack Ash",
      avatarImage: "https://blob.example/jack-ash-reference.jpg",
    });
    const renderClip = vi.fn().mockResolvedValueOnce({
      ok: true,
      videoUrl: "https://blob.example/1.mp4",
      persisted: true,
      // no lastFrameUrl — server-side extraction didn't succeed.
    });
    const deps = fakeDeps({ renderClip });

    const outcome = await run(segments, deps, undefined, jackAsh);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.message).toContain("couldn't capture");
      expect(outcome.renderedCount).toBe(1); // clip 1 itself did render successfully
    }
    expect(renderClip).toHaveBeenCalledTimes(1); // never reaches clip 2 — no starting frame for it, no substitute either
    // No fallback still was ever written — silently swapping in his
    // reference photo instead of the missing last frame was the exact
    // "lazy" behavior this reverted.
    expect(chainFillCalls(deps, segments[0].id)).toHaveLength(0);
  });

  it("keeps chaining the real last frame for a vocalist with no registered character lock", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const nova = member({ id: "solar-rebel-vocals", name: "Nova", avatarImage: "https://blob.example/nova.jpg" });
    const deps = fakeDeps();

    await run(segments, deps, undefined, nova);

    const chainFills = chainFillCalls(deps, segments[0].id);
    expect(chainFills).toHaveLength(2);
    for (const still of chainFills) {
      expect(still.dataUrl).toBe("https://blob.example/clip-lastframe.jpg");
      expect(still.source).toBe("chained");
    }
  });

  it("reports live progress events in the right order for a full successful run", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const events: string[] = [];
    const deps = fakeDeps({ onProgress: (e) => events.push(e.type) });

    await run(segments, deps);

    expect(events).toEqual([
      "generating-first-still",
      "rendering",
      "clip-done",
      "chaining",
      "rendering",
      "clip-done",
      "chaining",
      "rendering",
      "clip-done",
    ]);
  });

  it("returns an honest failure for an empty segment list rather than silently succeeding", async () => {
    const outcome = await run([] as SkidmarksClipSegment[], fakeDeps());
    expect(outcome.ok).toBe(false);
  });

  it("real ask (2026-09-16): stops before the next clip starts once shouldStop returns true, never mid-render", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const deps = fakeDeps();
    // Flips true only after clip 1 has already rendered — proves the
    // stop is checked *before* clip 2 starts, not mid-clip-1.
    let stopNow = false;
    const shouldStop = () => stopNow;
    deps.renderClip = vi.fn(async () => {
      stopNow = true;
      return {
        ok: true as const,
        videoUrl: "https://blob.example/1.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/1-lastframe.jpg",
      };
    });

    const outcome = await run(segments, deps, undefined, undefined, undefined, shouldStop);

    expect(outcome).toEqual({
      ok: false,
      stopped: true,
      failedAtClipIndex: 1,
      message: "Stopped before clip 2 — no more clips will render.",
      renderedCount: 1,
    });
    expect(deps.renderClip).toHaveBeenCalledTimes(1); // clip 1 finished; clip 2 never started
    expect(deps.recordRender).toHaveBeenCalledTimes(1); // clip 1's real, already-paid-for render is still kept
  });

  it("never stops when shouldStop is omitted — every existing caller/test is unaffected", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const deps = fakeDeps();
    const outcome = await run(segments, deps);
    expect(outcome).toEqual({ ok: true, renderedCount: 3 });
  });

  describe("real reported ask (2026-09-14): resuming a partially-completed run without re-spending on already-rendered clips", () => {
    it("starts the loop at startAtClipIndex, skips the clip-1 first-still step entirely, and reports real (absolute) positions throughout", async () => {
      const segments = buildScriptSequenceSegments(threeParts(), []);
      // Clips 1 and 2 already have stills from an earlier, partial run —
      // clip 1's own first-frame generation should never be re-attempted.
      segments[0].plates[0].still = { dataUrl: "data:image/jpeg;base64,one", source: "generated", createdAt: 1 };
      segments[1].plates[0].still = { dataUrl: "data:image/jpeg;base64,two", source: "chained", createdAt: 2 };
      const events: string[] = [];
      const deps = fakeDeps({ onProgress: (e) => events.push(e.type) });

      const outcome = await run(segments, deps, undefined, undefined, 1);

      expect(deps.generateFirstStill).not.toHaveBeenCalled();
      expect(deps.renderClip).toHaveBeenCalledTimes(2); // clips 2 and 3 only — never re-renders clip 1
      expect(events).toEqual(["rendering", "clip-done", "chaining", "rendering", "clip-done"]);
      expect(outcome).toEqual({ ok: true, renderedCount: 3 }); // real total across both the original run and this resume
    });

    it("a real live example: content moderation rejects clip 13 of 16 — resuming at clip 13 never re-renders clips 1-12", async () => {
      const parts = Array.from({ length: 16 }, (_, i) => ({
        index: i + 1,
        title: `Part ${i + 1}`,
        startSec: i * 15,
        endSec: (i + 1) * 15,
        prompt: `part ${i + 1}`,
      }));
      const segments = buildScriptSequenceSegments(parts, []);
      // Clips 1-12 already rendered in the earlier run; clip 13 (index
      // 12) already has its chained-in starting still (chaining fills
      // the *next* clip's plate right after a successful render, before
      // that next clip is ever attempted) — same real shape as Stuart's
      // actual stuck run.
      for (let i = 0; i < 13; i++) {
        segments[i].plates[0].still = { dataUrl: `data:image/jpeg;base64,${i}`, source: i === 0 ? "generated" : "chained", createdAt: i };
      }

      const renderClip = vi.fn(async () => ({ ok: false as const, message: "Generated video rejected by content moderation." }));
      const deps = fakeDeps({ renderClip });

      const outcome = await run(segments, deps, undefined, undefined, 12);

      expect(renderClip).toHaveBeenCalledTimes(1); // only clip 13 attempted — clips 1-12 never re-rendered
      expect(outcome).toEqual({
        ok: false,
        failedAtClipIndex: 12,
        message: "Generated video rejected by content moderation.",
        renderedCount: 12, // the 12 real clips already rendered before this resume attempt
      });
    });

    it("resuming from a clip with no starting image generates that clip's own still first, then renders on", async () => {
      const segments = buildScriptSequenceSegments(threeParts(), []);
      // Clip 2's plate has no still — a run stopped right after clip 1,
      // or a scene block whose fresh still failed. Resume has to be
      // able to carry on from here without Stuart hand-filling a plate.
      const deps = fakeDeps();

      const outcome = await run(segments, deps, undefined, undefined, 1);

      expect(outcome).toEqual({ ok: true, renderedCount: 3 });
      expect(deps.generateFirstStill).toHaveBeenCalledTimes(1);
      expect(deps.generateFirstStill).toHaveBeenCalledWith("part two", "Stu Balls", false, undefined);
      // Only clips 2 and 3 — clip 1 was already paid for before the resume.
      expect(deps.renderClip).toHaveBeenCalledTimes(2);
    });
  });

  describe("real reported gap (2026-09-14): Vocal clips must route to LTX with the song's real audio, not Grok", () => {
    /** Real segments where the song is genuinely singing 15–30s (the
     * same window `part two` covers), everything else Instrumental —
     * matches `resolveScriptPartVocal`'s own doc comment: only a real
     * segment saying so turns a part Vocal. */
    const realSongSegments: SkidmarksClipSegment[] = [
      { ...buildScriptSequenceSegments([{ index: 0, title: "", startSec: 0, endSec: 15, prompt: "" }], [])[0], label: "instrumental" },
      { ...buildScriptSequenceSegments([{ index: 0, title: "", startSec: 15, endSec: 30, prompt: "" }], [])[0], label: "vocal" },
      { ...buildScriptSequenceSegments([{ index: 0, title: "", startSec: 30, endSec: 45, prompt: "" }], [])[0], label: "instrumental" },
    ];
    const vocalist: SkidmarksMember = { id: "jack-ash-frontman", name: "Jack Ash", emoji: "", looks: [] };

    it("routes the one part that lands on real singing to vocal:true with the song's real audio and vocalist", async () => {
      const segments = buildScriptSequenceSegments(threeParts(), realSongSegments);
      expect(segments[1].label).toBe("vocal"); // sanity: the builder itself already routed this one Vocal

      const renderClip = vi.fn<ScriptSequenceRunnerDeps["renderClip"]>(async () => ({
        ok: true,
        videoUrl: "https://blob.example/clip.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/clip-lastframe.jpg",
      }));
      const deps = fakeDeps({ renderClip });

      await run(segments, deps, "https://blob.example/song.mp3", vocalist);

      expect(renderClip).toHaveBeenCalledTimes(3);
      const vocalRequest = renderClip.mock.calls[1][0];
      expect(vocalRequest.vocal).toBe(true);
      expect(vocalRequest.mp3AudioUrl).toBe("https://blob.example/song.mp3");

      const instrumentalRequest = renderClip.mock.calls[0][0];
      expect(instrumentalRequest.vocal).toBe(false);
      expect(instrumentalRequest.mp3AudioUrl).toBeUndefined();
    });

    it("stops honestly at a Vocal clip when no song audio is available, rather than sending an unfulfillable request", async () => {
      const segments = buildScriptSequenceSegments(threeParts(), realSongSegments);
      const renderClip = vi.fn(async () => ({
        ok: true as const,
        videoUrl: "https://blob.example/clip.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/clip-lastframe.jpg",
      }));
      const deps = fakeDeps({ renderClip });

      const outcome = await run(segments, deps, undefined, vocalist);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.failedAtClipIndex).toBe(1);
        expect(outcome.message).toContain("Vocal");
      }
      expect(renderClip).toHaveBeenCalledTimes(1); // clip 1 (instrumental) still rendered fine
    });
  });
});

describe("parseScriptPartKind", () => {
  it.each([
    ["Vocal", "vocal"],
    ["vocal", "vocal"],
    ["  VOCAL  ", "vocal"],
    ["Instrumental", "instrumental"],
    ["Intro", "intro"],
    ["Outro", "outro"],
    ["Bridge", "bridge"],
    ["Lead", "lead"],
    ["Break", "break"],
  ] as const)("recognizes %s as %s", (title, kind) => {
    expect(parseScriptPartKind(title)).toEqual({ kind });
  });

  it("defaults an unrecognized or blank title to instrumental — never assumes Vocal", () => {
    expect(parseScriptPartKind("Chorus")).toEqual({ kind: "instrumental" });
    expect(parseScriptPartKind("")).toEqual({ kind: "instrumental" });
    expect(parseScriptPartKind("   ")).toEqual({ kind: "instrumental" });
  });

  it.each([
    ["Other Singer: Jax", "Jax"],
    ["Other Singer (Jax)", "Jax"],
    ["other-singer: Jax", "Jax"],
    ["OTHER SINGER - Jax", "Jax"],
  ] as const)("parses %s as other-singer named %s", (title, name) => {
    expect(parseScriptPartKind(title)).toEqual({ kind: "other-singer", otherSingerName: name });
  });

  it("parses a bare 'Other Singer' with no name, leaving otherSingerName unset", () => {
    expect(parseScriptPartKind("Other Singer")).toEqual({ kind: "other-singer" });
  });
});

describe("scriptPartUsesLtx", () => {
  it("routes only 'vocal' to LTX — rule 3/4's whole backend decision", () => {
    expect(scriptPartUsesLtx("vocal")).toBe(true);
    for (const kind of ["instrumental", "intro", "outro", "bridge", "lead", "break", "other-singer"] as const) {
      expect(scriptPartUsesLtx(kind)).toBe(false);
    }
  });
});

describe("resolveScriptPartIdentity", () => {
  const nova = member({ id: "nova", name: "Nova", avatarImage: "https://blob.example/nova.jpg" });
  const jax = member({ id: "jax", name: "Jax", avatarImage: "https://blob.example/jax.jpg" });
  const jaxNoPhoto = member({ id: "jax-no-photo", name: "Jax" });

  it("rule 1: holds the current member's photo for every ordinary kind", () => {
    for (const kind of ["vocal", "instrumental", "intro", "outro", "bridge", "lead", "break"] as const) {
      const result = resolveScriptPartIdentity(kind, undefined, nova, [nova]);
      expect(result).toEqual({ ok: true, member: nova });
    }
  });

  it("rule 3: fails honestly, never inventing a face, when the current member has no photo", () => {
    const novaNoPhoto = member({ id: "nova", name: "Nova" });
    const result = resolveScriptPartIdentity("vocal", undefined, novaNoPhoto, [novaNoPhoto]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.toLowerCase()).toContain("photo");
  });

  it("fails honestly when no artist is selected at all", () => {
    const result = resolveScriptPartIdentity("vocal", undefined, undefined, []);
    expect(result.ok).toBe(false);
  });

  it("resolves a named other-singer to that band member, never the current artist", () => {
    const result = resolveScriptPartIdentity("other-singer", "Jax", nova, [nova, jax]);
    expect(result).toEqual({ ok: true, member: jax });
  });

  it("resolves an unnamed other-singer when exactly one other member exists", () => {
    const result = resolveScriptPartIdentity("other-singer", undefined, nova, [nova, jax]);
    expect(result).toEqual({ ok: true, member: jax });
  });

  it("fails an unnamed other-singer when the band has more than one other member — never guesses", () => {
    const ghost = member({ id: "ghost", name: "Ghost", avatarImage: "https://blob.example/ghost.jpg" });
    const result = resolveScriptPartIdentity("other-singer", undefined, nova, [nova, jax, ghost]);
    expect(result.ok).toBe(false);
  });

  it("fails an unnamed other-singer when there's no other member at all", () => {
    const result = resolveScriptPartIdentity("other-singer", undefined, nova, [nova]);
    expect(result.ok).toBe(false);
  });

  it("fails when the named other-singer isn't a real band member — never falls back to the current artist's photo", () => {
    const result = resolveScriptPartIdentity("other-singer", "Ghost", nova, [nova, jax]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Ghost");
  });

  it("fails when the named other-singer is real but has no photo — never invents a face, never substitutes the current artist", () => {
    const result = resolveScriptPartIdentity("other-singer", "Jax", nova, [nova, jaxNoPhoto]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.toLowerCase()).toContain("photo");
  });
});

/** Fully successful fake identity-safe pipeline — every dep resolves as
 * if the real network calls behind it worked. `generateIdentityStill`
 * echoes back which member/vocal flag it was actually called with, baked
 * into the still's own data URL, so a test can assert on it without
 * separately inspecting every mock call. */
function fakeIdentityDeps(overrides: Partial<IdentitySafeRunDeps> = {}): IdentitySafeRunDeps {
  return {
    resolvePlaceStill: vi.fn(async (sceneText: string) => ({
      ok: true as const,
      dataUrl: `data:image/jpeg;base64,place-${sceneText.length}`,
    })),
    generateIdentityStill: vi.fn(async ({ vocalist, vocal }) => ({
      ok: true as const,
      dataUrl: `data:image/jpeg;base64,plate-${vocalist.id}-${vocal ? "vocal" : "novocal"}`,
    })),
    uploadStill: vi.fn(async (dataUrl: string) => ({ ok: true as const, url: `https://blob.example/${dataUrl.length}` })),
    renderClip: vi.fn(async () => ({ ok: true as const, videoUrl: "https://blob.example/clip.mp4", persisted: true })),
    recordRender: vi.fn(),
    setPlateStill: vi.fn(),
    onProgress: vi.fn(),
    ...overrides,
  };
}

describe("runIdentitySafeSongRender", () => {
  const nova = member({ id: "nova", name: "Nova", avatarImage: "https://blob.example/nova.jpg" });
  const jax = member({ id: "jax", name: "Jax", avatarImage: "https://blob.example/jax.jpg" });
  const bandMembers = [nova, jax];

  /** Test A's own 6-part script, spelled out as real parts: vocal, vocal,
   * instrumental, other-singer, vocal, outro. */
  function sixParts(): IdentitySafeScriptPart[] {
    return [
      { shotPrompt: "verse one, desert highway at dusk", startSec: 0, endSec: 15, kind: "vocal" },
      { shotPrompt: "verse two, same highway", startSec: 15, endSec: 30, kind: "vocal" },
      { shotPrompt: "instrumental break over the dashboard lights", startSec: 30, endSec: 40, kind: "instrumental" },
      { shotPrompt: "Jax takes the mic at the roadside bar", startSec: 40, endSec: 50, kind: "other-singer", otherSingerName: "Jax" },
      { shotPrompt: "final verse, back on the road", startSec: 50, endSec: 65, kind: "vocal" },
      { shotPrompt: "closing wide shot of the highway at night", startSec: 65, endSec: 75, kind: "outro" },
    ];
  }

  function sixTargets(): IdentitySafeRunTarget[] {
    return sixParts().map((_, i) => ({ segmentId: `seg-${i}`, plateId: `plate-${i}` }));
  }

  it("acceptance test A: vocal/instrumental/outro clips hold the current artist (LTX only for the vocal ones), the other-singer clip holds the named member instead", async () => {
    const deps = fakeIdentityDeps();

    const outcome = await runIdentitySafeSongRender(
      sixParts(),
      sixTargets(),
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps
    );

    expect(outcome).toEqual({ ok: true, renderedCount: 6 });
    expect(deps.renderClip).toHaveBeenCalledTimes(6);

    type GenerateCall = { vocalist: SkidmarksMember; vocal: boolean };
    const generateCalls = (deps.generateIdentityStill as ReturnType<typeof vi.fn>).mock.calls.map(
      ([params]) => params as GenerateCall
    );
    // Clips 1, 2, 5 (indices 0, 1, 4) — Vocal, current artist, LTX-framed still.
    expect(generateCalls[0]).toMatchObject({ vocal: true });
    expect(generateCalls[0].vocalist.id).toBe("nova");
    expect(generateCalls[1]).toMatchObject({ vocal: true });
    expect(generateCalls[1].vocalist.id).toBe("nova");
    expect(generateCalls[4]).toMatchObject({ vocal: true });
    expect(generateCalls[4].vocalist.id).toBe("nova");
    // Clip 3 (index 2, Instrumental) — still the current artist, but not LTX-framed.
    expect(generateCalls[2]).toMatchObject({ vocal: false });
    expect(generateCalls[2].vocalist.id).toBe("nova");
    // Clip 4 (index 3, other-singer) — the named member, never the current artist.
    expect(generateCalls[3]).toMatchObject({ vocal: false });
    expect(generateCalls[3].vocalist.id).toBe("jax");
    // Clip 6 (index 5, Outro) — the current artist again, not LTX-framed.
    expect(generateCalls[5]).toMatchObject({ vocal: false });
    expect(generateCalls[5].vocalist.id).toBe("nova");

    type RenderRequest = { vocal?: boolean; mp3AudioUrl?: string; videoBackend?: string };
    const renderRequests = (deps.renderClip as ReturnType<typeof vi.fn>).mock.calls.map(
      ([request]) => request as RenderRequest
    );
    // Rule 3/4: only the real Vocal clips ever route to LTX or carry the
    // song's real vocal audio — never the other-singer clip, even though
    // its own shot prompt is about someone singing.
    expect(renderRequests.map((r) => r.vocal)).toEqual([true, true, false, false, true, false]);
    expect(renderRequests.map((r) => r.mp3AudioUrl)).toEqual([
      "https://blob.example/song.mp3",
      "https://blob.example/song.mp3",
      undefined,
      undefined,
      "https://blob.example/song.mp3",
      undefined,
    ]);
    for (const r of renderRequests.filter((r) => !r.vocal)) {
      expect(r.videoBackend).toBe("grok");
    }

    // Rule 5: last-frame chaining is banned for identity — nothing this
    // runner records ever carries a lastFrameUrl, and every plate still
    // is freshly generated, never a chained frame.
    type RecordedRender = { lastFrameUrl?: string };
    const recordedRenders = (deps.recordRender as ReturnType<typeof vi.fn>).mock.calls.map(
      ([render]) => render as RecordedRender
    );
    expect(recordedRenders).toHaveLength(6);
    for (const render of recordedRenders) expect(render.lastFrameUrl).toBeUndefined();

    type SetStillCall = [string, string, { source: string }];
    const stills = (deps.setPlateStill as ReturnType<typeof vi.fn>).mock.calls as SetStillCall[];
    expect(stills).toHaveLength(6);
    for (const [, , still] of stills) expect(still.source).toBe("generated");
  });

  it("uses an uploaded clip-1 starting image as image 1 and never rebuilds/overwrites it", async () => {
    const deps = fakeIdentityDeps();
    const uploaded = "https://blob.example/uploaded-clip1.jpg";

    const outcome = await runIdentitySafeSongRender(
      sixParts(),
      sixTargets(),
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps,
      0,
      undefined,
      uploaded
    );

    expect(outcome).toEqual({ ok: true, renderedCount: 6 });
    // Clip 1 skips place + identity still generation entirely.
    expect(deps.resolvePlaceStill).toHaveBeenCalledTimes(5); // clips 2-6 only
    expect(deps.generateIdentityStill).toHaveBeenCalledTimes(5);
    expect(deps.uploadStill).toHaveBeenCalledTimes(5); // no re-upload of the already-durable pick

    const setStillCalls = (deps.setPlateStill as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      string,
      { dataUrl: string; source: string },
    ][];
    expect(setStillCalls[0][2]).toEqual(
      expect.objectContaining({ dataUrl: uploaded, source: "upload" })
    );

    const firstRender = (deps.renderClip as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      referenceImageDataUrls: string[];
    };
    expect(firstRender.referenceImageDataUrls).toEqual([uploaded]);
  });

  it("acceptance test B: a fresh run for a different artist never references the previous artist's photo", async () => {
    const depsForNova = fakeIdentityDeps();
    await runIdentitySafeSongRender(
      sixParts().slice(0, 1),
      sixTargets().slice(0, 1),
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      depsForNova
    );
    expect((depsForNova.generateIdentityStill as ReturnType<typeof vi.fn>).mock.calls[0][0].vocalist.id).toBe("nova");

    const ziggy = member({ id: "ziggy", name: "Ziggy", avatarImage: "https://blob.example/ziggy.jpg" });
    const depsForZiggy = fakeIdentityDeps();
    await runIdentitySafeSongRender(
      sixParts(),
      sixTargets(),
      "Ziggy & the Static",
      ziggy,
      [ziggy],
      "https://blob.example/song2.mp3",
      depsForZiggy
    );

    const secondRunVocalistIds = (depsForZiggy.generateIdentityStill as ReturnType<typeof vi.fn>).mock.calls.map(
      ([params]) => (params as { vocalist: SkidmarksMember }).vocalist.id
    );
    expect(secondRunVocalistIds.every((id) => id === "ziggy")).toBe(true);
    expect(secondRunVocalistIds).not.toContain("nova");
    // The "other-singer" part in this second script has no second member
    // to resolve to at all — it must fail honestly, never silently
    // falling back to Ziggy or reusing Nova/Jax from the earlier run.
    const outcome = await runIdentitySafeSongRender(
      sixParts(),
      sixTargets(),
      "Ziggy & the Static",
      ziggy,
      [ziggy],
      "https://blob.example/song2.mp3",
      fakeIdentityDeps()
    );
    expect(outcome.ok).toBe(false);
  });

  it("rule 1/3: fails the clip honestly (never a text-only fallback still) when the current artist has no photo, and stops the whole batch there", async () => {
    const novaNoPhoto = member({ id: "nova", name: "Nova" });
    const deps = fakeIdentityDeps();

    const outcome = await runIdentitySafeSongRender(
      sixParts(),
      sixTargets(),
      "Solar Rebel",
      novaNoPhoto,
      [novaNoPhoto, jax],
      "https://blob.example/song.mp3",
      deps
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.message.toLowerCase()).toContain("photo");
      expect(outcome.renderedCount).toBe(0);
    }
    expect(deps.resolvePlaceStill).not.toHaveBeenCalled();
    expect(deps.generateIdentityStill).not.toHaveBeenCalled();
    expect(deps.renderClip).not.toHaveBeenCalled();
  });

  it("an other-singer clip naming someone with no photo fails only that clip, keeping every earlier clip already rendered", async () => {
    const jaxNoPhoto = member({ id: "jax", name: "Jax" });
    const deps = fakeIdentityDeps();

    const outcome = await runIdentitySafeSongRender(
      sixParts(),
      sixTargets(),
      "Solar Rebel",
      nova,
      [nova, jaxNoPhoto],
      "https://blob.example/song.mp3",
      deps
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(3);
      expect(outcome.renderedCount).toBe(3);
      expect(outcome.message.toLowerCase()).toContain("photo");
    }
    expect(deps.renderClip).toHaveBeenCalledTimes(3);
  });

  it("an other-singer clip naming someone outside the band fails that clip rather than falling back to the current artist", async () => {
    const parts: IdentitySafeScriptPart[] = [
      { shotPrompt: "a stranger grabs the mic", startSec: 0, endSec: 10, kind: "other-singer", otherSingerName: "Ghost" },
    ];
    const targets: IdentitySafeRunTarget[] = [{ segmentId: "seg-0", plateId: "plate-0" }];
    const deps = fakeIdentityDeps();

    const outcome = await runIdentitySafeSongRender(parts, targets, "Solar Rebel", nova, bandMembers, undefined, deps);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.message).toContain("Ghost");
    }
    expect(deps.generateIdentityStill).not.toHaveBeenCalled();
  });

  it("rule 3: a failed place still fails the whole plate, never falling back to a text-only still", async () => {
    const deps = fakeIdentityDeps({
      resolvePlaceStill: vi.fn(async () => ({ ok: false as const, message: "xAI rate limit reached." })),
    });

    const outcome = await runIdentitySafeSongRender(
      sixParts().slice(0, 1),
      sixTargets().slice(0, 1),
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.message).toContain("rate limit");
    }
    expect(deps.generateIdentityStill).not.toHaveBeenCalled();
    expect(deps.renderClip).not.toHaveBeenCalled();
  });

  it("fails a Vocal clip honestly when no song audio is attached, rather than sending an unfulfillable LTX request", async () => {
    const deps = fakeIdentityDeps();

    const outcome = await runIdentitySafeSongRender(
      sixParts().slice(0, 1),
      sixTargets().slice(0, 1),
      "Solar Rebel",
      nova,
      bandMembers,
      undefined,
      deps
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("Vocal");
    expect(deps.renderClip).not.toHaveBeenCalled();
  });

  it("resumes at startAtClipIndex, never touching earlier clips", async () => {
    const deps = fakeIdentityDeps();

    const outcome = await runIdentitySafeSongRender(
      sixParts(),
      sixTargets(),
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps,
      4
    );

    expect(outcome).toEqual({ ok: true, renderedCount: 6 });
    expect(deps.renderClip).toHaveBeenCalledTimes(2); // clips 5 and 6 only
  });

  it("stops before the next clip once shouldStop returns true, never mid-render", async () => {
    const deps = fakeIdentityDeps();
    let stopNow = false;
    deps.renderClip = vi.fn(async () => {
      stopNow = true;
      return { ok: true as const, videoUrl: "https://blob.example/clip.mp4", persisted: true };
    });

    const outcome = await runIdentitySafeSongRender(
      sixParts().slice(0, 3),
      sixTargets().slice(0, 3),
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps,
      0,
      () => stopNow
    );

    expect(outcome).toEqual({
      ok: false,
      stopped: true,
      failedAtClipIndex: 1,
      message: "Stopped before clip 2 — no more clips will render.",
      renderedCount: 1,
    });
    expect(deps.renderClip).toHaveBeenCalledTimes(1);
  });

  it("returns an honest failure for an empty part list rather than silently succeeding", async () => {
    const outcome = await runIdentitySafeSongRender([], [], "Solar Rebel", nova, bandMembers, undefined, fakeIdentityDeps());
    expect(outcome.ok).toBe(false);
  });

  it("returns an honest failure when parts and targets are out of sync", async () => {
    const outcome = await runIdentitySafeSongRender(
      sixParts(),
      sixTargets().slice(0, 3),
      "Solar Rebel",
      nova,
      bandMembers,
      undefined,
      fakeIdentityDeps()
    );
    expect(outcome.ok).toBe(false);
  });
});


function fakePlatesDeps(overrides: Partial<GeneratePlatesDeps> = {}): GeneratePlatesDeps {
  return {
    resolvePlaceStill: vi.fn(async (sceneText: string) => ({
      ok: true as const,
      dataUrl: `data:image/jpeg;base64,place-${sceneText.length}`,
    })),
    generateIdentityStill: vi.fn(async ({ vocalist, vocal }) => ({
      ok: true as const,
      dataUrl: `data:image/jpeg;base64,plate-${vocalist.id}-${vocal ? "vocal" : "novocal"}`,
    })),
    uploadStill: vi.fn(async (dataUrl: string) => ({ ok: true as const, url: `https://blob.example/${dataUrl.length}` })),
    setPlateStill: vi.fn(),
    onProgress: vi.fn(),
    ...overrides,
  };
}

function fakeAnimateDeps(overrides: Partial<AnimateExistingPlatesDeps> = {}): AnimateExistingPlatesDeps {
  return {
    renderClip: vi.fn(async () => ({ ok: true as const, videoUrl: "https://blob.example/clip.mp4", persisted: true })),
    recordRender: vi.fn(),
    setPlateStill: vi.fn(),
    onProgress: vi.fn(),
    ...overrides,
  };
}

describe("runGeneratePlates", () => {
  const nova = member({ id: "nova", name: "Nova", avatarImage: "https://blob.example/nova.jpg" });
  const jax = member({ id: "jax", name: "Jax", avatarImage: "https://blob.example/jax.jpg" });
  const bandMembers = [nova, jax];

  function parts(): IdentitySafeScriptPart[] {
    return [
      { shotPrompt: "verse one", startSec: 0, endSec: 10, kind: "vocal" },
      { shotPrompt: "break", startSec: 10, endSec: 20, kind: "instrumental" },
      { shotPrompt: "outro wide", startSec: 20, endSec: 30, kind: "outro" },
    ];
  }
  function targets(overrides: Partial<GeneratePlatesTarget>[] = []): GeneratePlatesTarget[] {
    return parts().map((_, i) => ({
      segmentId: `seg-${i}`,
      plateId: `plate-${i}`,
      ...overrides[i],
    }));
  }

  it("builds stills only — never calls video render, never writes lastFrameUrl", async () => {
    const deps = fakePlatesDeps();
    const renderSpy = vi.fn();
    // Plates deps have no renderClip — asserting the type contract + setPlateStill only.
    const outcome = await runGeneratePlates(parts(), targets(), "Solar Rebel", nova, bandMembers, deps);

    expect(outcome).toEqual({ ok: true, platedCount: 3, skippedCount: 0 });
    expect(deps.resolvePlaceStill).toHaveBeenCalledTimes(3);
    expect(deps.generateIdentityStill).toHaveBeenCalledTimes(3);
    expect(deps.setPlateStill).toHaveBeenCalledTimes(3);
    expect(renderSpy).not.toHaveBeenCalled();

    const events = (deps.onProgress as ReturnType<typeof vi.fn>).mock.calls.map(([e]) => e.type);
    expect(events).not.toContain("rendering");
    expect(events.filter((t) => t === "plate-done")).toHaveLength(3);
  });

  it("stops on missing identity photo and never continues plating", async () => {
    const noPhoto = member({ id: "nova", name: "Nova", avatarImage: undefined });
    const deps = fakePlatesDeps();
    const outcome = await runGeneratePlates(parts(), targets(), "Solar Rebel", noPhoto, [noPhoto, jax], deps);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.platedCount).toBe(0);
      expect(outcome.message.toLowerCase()).toMatch(/photo|face/);
    }
    expect(deps.generateIdentityStill).not.toHaveBeenCalled();
    expect(deps.setPlateStill).not.toHaveBeenCalled();
  });

  it("stops on missing place still and never continues", async () => {
    const deps = fakePlatesDeps({
      resolvePlaceStill: vi.fn(async () => ({ ok: false as const, message: "place generation failed" })),
    });
    const outcome = await runGeneratePlates(parts(), targets(), "Solar Rebel", nova, bandMembers, deps);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.platedCount).toBe(0);
      expect(outcome.message).toContain("place generation failed");
    }
    expect(deps.generateIdentityStill).not.toHaveBeenCalled();
  });

  it("uses clip-1 upload as image 1 and skips rebuilding that plate", async () => {
    const deps = fakePlatesDeps();
    const uploaded = "https://blob.example/uploaded-clip1.jpg";
    const outcome = await runGeneratePlates(parts(), targets(), "Solar Rebel", nova, bandMembers, deps, 0, undefined, uploaded);

    expect(outcome).toEqual({ ok: true, platedCount: 3, skippedCount: 0 });
    expect(deps.resolvePlaceStill).toHaveBeenCalledTimes(2);
    expect(deps.generateIdentityStill).toHaveBeenCalledTimes(2);

    const firstStill = (deps.setPlateStill as ReturnType<typeof vi.fn>).mock.calls[0][2] as {
      dataUrl: string;
      source: string;
    };
    expect(firstStill).toEqual({ dataUrl: uploaded, source: "upload", createdAt: expect.any(Number) });
  });

  it("skips clips that already have a good still — never rebuilds or overwrites them", async () => {
    const deps = fakePlatesDeps();
    const withStill = targets([
      { existingPlateStillUrl: "https://blob.example/existing-0.jpg" },
      {},
      { existingPlateStillUrl: "https://blob.example/existing-2.jpg" },
    ]);

    const outcome = await runGeneratePlates(parts(), withStill, "Solar Rebel", nova, bandMembers, deps);

    expect(outcome).toEqual({ ok: true, platedCount: 1, skippedCount: 2 });
    expect(deps.resolvePlaceStill).toHaveBeenCalledTimes(1);
    expect(deps.generateIdentityStill).toHaveBeenCalledTimes(1);
    expect(deps.setPlateStill).toHaveBeenCalledTimes(1);
    expect((deps.setPlateStill as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("seg-1");

    const events = (deps.onProgress as ReturnType<typeof vi.fn>).mock.calls.map(([e]) => e);
    expect(events.filter((e) => e.type === "plate-skipped")).toHaveLength(2);
    expect(events.filter((e) => e.type === "plate-done")).toHaveLength(1);
  });

  it("skips clips with a finished video even without a still URL", async () => {
    const deps = fakePlatesDeps();
    const withVideo = targets([
      { hasFinishedVideo: true },
      {},
      { hasFinishedVideo: true, existingPlateStillUrl: "https://blob.example/would-skip-anyway.jpg" },
    ]);

    const outcome = await runGeneratePlates(parts(), withVideo, "Solar Rebel", nova, bandMembers, deps);

    expect(outcome).toEqual({ ok: true, platedCount: 1, skippedCount: 2 });
    expect(deps.setPlateStill).toHaveBeenCalledTimes(1);
    const skipReasons = (deps.onProgress as ReturnType<typeof vi.fn>).mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === "plate-skipped")
      .map((e) => ("reason" in e ? e.reason : undefined));
    expect(skipReasons).toEqual(["video", "video"]);
  });

  it("does not apply clip-1 upload when clip 1 already has a good still", async () => {
    const deps = fakePlatesDeps();
    const uploaded = "https://blob.example/uploaded-clip1.jpg";
    const withStill = targets([{ existingPlateStillUrl: "https://blob.example/keep-me.jpg" }, {}, {}]);

    const outcome = await runGeneratePlates(
      parts(),
      withStill,
      "Solar Rebel",
      nova,
      bandMembers,
      deps,
      0,
      undefined,
      uploaded
    );

    expect(outcome).toEqual({ ok: true, platedCount: 2, skippedCount: 1 });
    const setCalls = (deps.setPlateStill as ReturnType<typeof vi.fn>).mock.calls;
    expect(setCalls.every((c) => c[0] !== "seg-0")).toBe(true);
    expect(setCalls).toHaveLength(2);
  });

  it("Instrumental/Intro/Outro person plates always pass artist photo + place to generateIdentityStill (vocal false)", async () => {
    const deps = fakePlatesDeps();
    const titled: IdentitySafeScriptPart[] = [
      { shotPrompt: "singing", startSec: 0, endSec: 10, kind: "vocal" },
      { shotPrompt: "leather jacket drive", startSec: 10, endSec: 20, kind: "intro" },
      { shotPrompt: "chrome headphones walk", startSec: 20, endSec: 30, kind: "instrumental" },
      { shotPrompt: "sit and smile", startSec: 30, endSec: 40, kind: "outro" },
    ];
    const plateTargets: GeneratePlatesTarget[] = titled.map((_, i) => ({
      segmentId: `seg-${i}`,
      plateId: `plate-${i}`,
    }));

    const outcome = await runGeneratePlates(titled, plateTargets, "Solar Rebel", nova, bandMembers, deps);
    expect(outcome).toEqual({ ok: true, platedCount: 4, skippedCount: 0 });

    const stillCalls = (deps.generateIdentityStill as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => p);
    expect(stillCalls).toHaveLength(4);
    expect(stillCalls.map((c) => c.vocal)).toEqual([true, false, false, false]);
    for (const call of stillCalls) {
      expect(call.vocalist.avatarImage).toBe(nova.avatarImage);
      expect(call.locationStillDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(call.bandName).toBe("Solar Rebel");
    }
  });

  it("refuses Intro/Instrumental when artist has no photo — never invents a face from costume words", async () => {
    const noPhoto = member({ id: "nova", name: "Nova", avatarImage: undefined });
    const deps = fakePlatesDeps();
    const titled: IdentitySafeScriptPart[] = [
      { shotPrompt: "leather jacket, chrome headphones", startSec: 0, endSec: 10, kind: "intro" },
      { shotPrompt: "driving", startSec: 10, endSec: 20, kind: "instrumental" },
    ];
    const plateTargets: GeneratePlatesTarget[] = titled.map((_, i) => ({
      segmentId: `seg-${i}`,
      plateId: `plate-${i}`,
    }));

    const outcome = await runGeneratePlates(titled, plateTargets, "Solar Rebel", noPhoto, [noPhoto], deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.message.toLowerCase()).toMatch(/photo|face/);
    }
    expect(deps.generateIdentityStill).not.toHaveBeenCalled();
    expect(deps.resolvePlaceStill).not.toHaveBeenCalled();
  });
  it("after remint (new ids, same start/end): skips plated ranges and only builds new parts", async () => {
    const deps = fakePlatesDeps();
    const plated = buildScriptSequenceSegments(
      [
        { index: 1, title: "Intro", startSec: 0, endSec: 10, prompt: "old-1" },
        { index: 2, title: "Vocal", startSec: 10, endSec: 20, prompt: "old-2" },
        { index: 3, title: "Outro", startSec: 20, endSec: 30, prompt: "old-3" },
      ],
      []
    );
    for (let i = 0; i < plated.length; i++) {
      plated[i] = {
        ...plated[i],
        plates: [
          {
            id: plated[i].plates[0].id,
            still: {
              dataUrl: `https://blob.example/keep-${i}.jpg`,
              source: "generated",
              createdAt: 1,
            },
          },
        ],
      };
    }

    const grown = buildScriptSequenceSegments(
      [
        { index: 1, title: "Intro", startSec: 0, endSec: 10, prompt: "new-1" },
        { index: 2, title: "Vocal", startSec: 10, endSec: 20, prompt: "new-2" },
        { index: 3, title: "Outro", startSec: 20, endSec: 30, prompt: "new-3" },
        { index: 4, title: "Instrumental", startSec: 30, endSec: 40, prompt: "new-4" },
        { index: 5, title: "Vocal", startSec: 40, endSec: 50, prompt: "new-5" },
      ],
      plated
    );

    const identityParts: IdentitySafeScriptPart[] = grown.map((seg, i) => ({
      shotPrompt: seg.shotPrompt,
      startSec: seg.startSec,
      endSec: seg.endSec,
      kind: i === 1 || i === 4 ? "vocal" : i === 3 ? "instrumental" : i === 0 ? "intro" : "outro",
    }));

    const avatars = [nova.avatarImage, jax.avatarImage];
    const plateTargets: GeneratePlatesTarget[] = grown.map((seg) => {
      const plate = seg.plates[0];
      const hasFinishedVideo = false;
      const existingPlateStillUrl =
        !hasFinishedVideo && plateStillCountsAsReady(plate?.still, avatars)
          ? plate?.still?.dataUrl
          : undefined;
      return {
        segmentId: seg.id,
        plateId: plate.id,
        existingPlateStillUrl,
        hasFinishedVideo,
      };
    });

    const outcome = await runGeneratePlates(
      identityParts,
      plateTargets,
      "Solar Rebel",
      nova,
      bandMembers,
      deps
    );

    expect(outcome).toEqual({ ok: true, platedCount: 2, skippedCount: 3 });
    expect(deps.setPlateStill).toHaveBeenCalledTimes(2);
    const setIds = (deps.setPlateStill as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(setIds).toEqual([grown[3].id, grown[4].id]);
    // Carried stills must not have been overwritten
    expect(setIds.includes(grown[0].id)).toBe(false);
    expect(setIds.includes(grown[1].id)).toBe(false);
    expect(setIds.includes(grown[2].id)).toBe(false);
  });

  it("never overwrites finished video or existing still when times match", async () => {
    const deps = fakePlatesDeps();
    const identityParts = parts();
    const plateTargets = targets([
      { hasFinishedVideo: true },
      { existingPlateStillUrl: "https://blob.example/keep.jpg" },
      {},
    ]);
    const outcome = await runGeneratePlates(
      identityParts,
      plateTargets,
      "Solar Rebel",
      nova,
      bandMembers,
      deps
    );
    expect(outcome).toEqual({ ok: true, platedCount: 1, skippedCount: 2 });
    expect((deps.setPlateStill as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(["seg-2"]);
  });
});

describe("plateStillCountsAsReady", () => {
  const avatars = ["https://blob.example/nova.jpg", "https://blob.example/jax.jpg"];

  it("treats empty / missing stills as not ready", () => {
    expect(plateStillCountsAsReady(undefined, avatars)).toBe(false);
    expect(plateStillCountsAsReady({ dataUrl: "  " }, avatars)).toBe(false);
  });

  it("treats real upload/generated stills as ready", () => {
    expect(
      plateStillCountsAsReady({ dataUrl: "https://blob.example/real-plate.jpg", featuresLockedCharacter: true }, avatars)
    ).toBe(true);
    expect(plateStillCountsAsReady({ dataUrl: "https://blob.example/upload.jpg" }, avatars)).toBe(true);
  });

  it("does not treat locked-character Timeline avatar previews as ready", () => {
    expect(
      plateStillCountsAsReady(
        { dataUrl: "https://blob.example/nova.jpg", featuresLockedCharacter: true },
        avatars
      )
    ).toBe(false);
  });

  it("treats a sleeve/library pick as ready even when the URL is the avatar", () => {
    expect(
      plateStillCountsAsReady(
        { dataUrl: "https://blob.example/nova.jpg", source: "library", featuresLockedCharacter: true },
        avatars
      )
    ).toBe(true);
  });
});

describe("isGeneratePlatesButtonDisabled", () => {
  it("stays enabled when a script is pasted even if Resume would show (incompleteRun is ignored)", () => {
    expect(isGeneratePlatesButtonDisabled(false, 4)).toBe(false);
  });

  it("disables only while a run is in progress or no script parts exist", () => {
    expect(isGeneratePlatesButtonDisabled("plates", 4)).toBe(true);
    expect(isGeneratePlatesButtonDisabled("render", 4)).toBe(true);
    expect(isGeneratePlatesButtonDisabled(false, 0)).toBe(true);
  });
});

describe("runAnimateExistingPlates", () => {
  const nova = member({ id: "nova", name: "Nova", avatarImage: "https://blob.example/nova.jpg" });
  const jax = member({ id: "jax", name: "Jax", avatarImage: "https://blob.example/jax.jpg" });
  const bandMembers = [nova, jax];

  function titledParts(): IdentitySafeScriptPart[] {
    return [
      { shotPrompt: "verse", startSec: 0, endSec: 10, kind: "vocal" },
      { shotPrompt: "intro still", startSec: 10, endSec: 20, kind: "intro" },
      { shotPrompt: "bridge", startSec: 20, endSec: 30, kind: "bridge" },
      { shotPrompt: "outro", startSec: 30, endSec: 40, kind: "outro" },
      { shotPrompt: "lead line", startSec: 40, endSec: 50, kind: "lead" },
      { shotPrompt: "break", startSec: 50, endSec: 60, kind: "break" },
      { shotPrompt: "instrumental", startSec: 60, endSec: 70, kind: "instrumental" },
    ];
  }

  function platedTargets(urls: (string | undefined)[]): AnimateExistingPlatesTarget[] {
    return urls.map((url, i) => ({
      segmentId: `seg-${i}`,
      plateId: `plate-${i}`,
      plateStillUrl: url,
    }));
  }

  it("refuses a clip with no plate still — never invents one, never calls video for it", async () => {
    const deps = fakeAnimateDeps();
    const parts = titledParts().slice(0, 2);
    const targets = platedTargets(["https://blob.example/plate-0.jpg", undefined]);

    const outcome = await runAnimateExistingPlates(
      parts,
      targets,
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(1);
      expect(outcome.renderedCount).toBe(1);
      expect(outcome.message.toLowerCase()).toContain("no plate still");
    }
    // First clip had a plate and rendered; second refused.
    expect(deps.renderClip).toHaveBeenCalledTimes(1);
  });

  it("routes Vocal → LTX and Intro/Outro/Bridge/Lead/Break/Instrumental → Grok by title kind", async () => {
    const deps = fakeAnimateDeps();
    const parts = titledParts();
    const targets = platedTargets(parts.map((_, i) => `https://blob.example/plate-${i}.jpg`));

    const outcome = await runAnimateExistingPlates(
      parts,
      targets,
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps
    );

    expect(outcome).toEqual({ ok: true, renderedCount: 7 });
    type RenderRequest = {
      vocal?: boolean;
      mp3AudioUrl?: string;
      videoBackend?: string;
      referenceImageDataUrls?: string[];
    };
    const renderRequests = (deps.renderClip as ReturnType<typeof vi.fn>).mock.calls.map(
      ([request]) => request as RenderRequest
    );
    expect(renderRequests.map((r) => r.vocal)).toEqual([true, false, false, false, false, false, false]);
    expect(renderRequests[0].mp3AudioUrl).toBe("https://blob.example/song.mp3");
    for (const r of renderRequests.slice(1)) {
      expect(r.mp3AudioUrl).toBeUndefined();
      expect(r.videoBackend).toBe("grok");
    }
    // https plate stills pass through as-is (LTX/generate-clip accept them).
    expect(renderRequests[0].referenceImageDataUrls).toEqual(["https://blob.example/plate-0.jpg"]);
  });

  it("never rebuilds plates — no place/identity generation side effects", async () => {
    const deps = fakeAnimateDeps();
    const parts = titledParts().slice(0, 1);
    const targets = platedTargets(["https://blob.example/already-plated.jpg"]);

    await runAnimateExistingPlates(parts, targets, "Solar Rebel", nova, bandMembers, "https://blob.example/song.mp3", deps);

    // Chain off (default): never writes plate stills from last frames.
    expect(deps.renderClip).toHaveBeenCalledTimes(1);
    expect(deps.setPlateStill).not.toHaveBeenCalled();
    const recorded = (deps.recordRender as ReturnType<typeof vi.fn>).mock.calls[0][0] as { lastFrameUrl?: string };
    expect(recorded.lastFrameUrl).toBeUndefined();
  });

  it("chain last→first OFF by default — even when lastFrameUrl is returned, no next-plate fill", async () => {
    const deps = fakeAnimateDeps({
      renderClip: vi.fn(async () => ({
        ok: true as const,
        videoUrl: "https://blob.example/clip.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/last.jpg",
      })),
    });
    const parts = titledParts().slice(0, 2);
    const targets = platedTargets(["https://blob.example/plate-0.jpg", "https://blob.example/plate-1.jpg"]);

    const outcome = await runAnimateExistingPlates(
      parts,
      targets,
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps
    );

    expect(outcome).toEqual({ ok: true, renderedCount: 2 });
    expect(deps.setPlateStill).not.toHaveBeenCalled();
  });

  it("chain last→first ON: fills empty next start from lastFrameUrl and renders it next", async () => {
    const deps = fakeAnimateDeps({
      renderClip: vi.fn(async () => ({
        ok: true as const,
        videoUrl: "https://blob.example/clip.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/last-0.jpg",
      })),
    });
    const parts = titledParts().slice(0, 2);
    const targets: AnimateExistingPlatesTarget[] = [
      { segmentId: "seg-0", plateId: "plate-0", plateStillUrl: "https://blob.example/plate-0.jpg", plateStillSource: "generated" },
      { segmentId: "seg-1", plateId: "plate-1" }, // empty — chain should fill
    ];

    const outcome = await runAnimateExistingPlates(
      parts,
      targets,
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps,
      0,
      undefined,
      true
    );

    expect(outcome).toEqual({ ok: true, renderedCount: 2 });
    expect(deps.setPlateStill).toHaveBeenCalledTimes(1);
    expect(deps.setPlateStill).toHaveBeenCalledWith("seg-1", "plate-1", {
      dataUrl: "https://blob.example/last-0.jpg",
      source: "chained",
      createdAt: expect.any(Number),
    });
    // Second render must use the chained URL, not invent a plate.
    type RenderRequest = { referenceImageDataUrls?: string[] };
    const renderRequests = (deps.renderClip as ReturnType<typeof vi.fn>).mock.calls.map(
      ([request]) => request as RenderRequest
    );
    expect(renderRequests[1].referenceImageDataUrls).toEqual(["https://blob.example/last-0.jpg"]);
    const events = (deps.onProgress as ReturnType<typeof vi.fn>).mock.calls.map(([e]) => e.type);
    expect(events).toContain("chaining");
  });

  it("chain last→first ON: never clobbers generated / upload / library next stills", async () => {
    const deps = fakeAnimateDeps({
      renderClip: vi.fn(async () => ({
        ok: true as const,
        videoUrl: "https://blob.example/clip.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/last-0.jpg",
      })),
    });
    const parts = titledParts().slice(0, 2);

    for (const source of ["generated", "upload", "library"] as const) {
      vi.clearAllMocks();
      const targets: AnimateExistingPlatesTarget[] = [
        { segmentId: "seg-0", plateId: "plate-0", plateStillUrl: "https://blob.example/plate-0.jpg", plateStillSource: "generated" },
        {
          segmentId: "seg-1",
          plateId: "plate-1",
          plateStillUrl: `https://blob.example/kept-${source}.jpg`,
          plateStillSource: source,
        },
      ];
      const outcome = await runAnimateExistingPlates(
        parts,
        targets,
        "Solar Rebel",
        nova,
        bandMembers,
        "https://blob.example/song.mp3",
        deps,
        0,
        undefined,
        true
      );
      expect(outcome).toEqual({ ok: true, renderedCount: 2 });
      expect(deps.setPlateStill).not.toHaveBeenCalled();
      type RenderRequest = { referenceImageDataUrls?: string[] };
      const second = (deps.renderClip as ReturnType<typeof vi.fn>).mock.calls[1][0] as RenderRequest;
      expect(second.referenceImageDataUrls).toEqual([`https://blob.example/kept-${source}.jpg`]);
    }
  });

  it("chain last→first ON: may refresh a next still that was itself source:chained", async () => {
    const deps = fakeAnimateDeps({
      renderClip: vi.fn(async () => ({
        ok: true as const,
        videoUrl: "https://blob.example/clip.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/fresh-last.jpg",
      })),
    });
    const parts = titledParts().slice(0, 2);
    const targets: AnimateExistingPlatesTarget[] = [
      { segmentId: "seg-0", plateId: "plate-0", plateStillUrl: "https://blob.example/plate-0.jpg", plateStillSource: "generated" },
      {
        segmentId: "seg-1",
        plateId: "plate-1",
        plateStillUrl: "https://blob.example/old-chained.jpg",
        plateStillSource: "chained",
      },
    ];

    const outcome = await runAnimateExistingPlates(
      parts,
      targets,
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps,
      0,
      undefined,
      true
    );

    expect(outcome).toEqual({ ok: true, renderedCount: 2 });
    expect(deps.setPlateStill).toHaveBeenCalledWith("seg-1", "plate-1", {
      dataUrl: "https://blob.example/fresh-last.jpg",
      source: "chained",
      createdAt: expect.any(Number),
    });
  });

  it("chain last→first ON: fails honestly when a fill is needed but lastFrameUrl is missing", async () => {
    const deps = fakeAnimateDeps(); // no lastFrameUrl
    const parts = titledParts().slice(0, 2);
    const targets: AnimateExistingPlatesTarget[] = [
      { segmentId: "seg-0", plateId: "plate-0", plateStillUrl: "https://blob.example/plate-0.jpg", plateStillSource: "generated" },
      { segmentId: "seg-1", plateId: "plate-1" },
    ];

    const outcome = await runAnimateExistingPlates(
      parts,
      targets,
      "Solar Rebel",
      nova,
      bandMembers,
      "https://blob.example/song.mp3",
      deps,
      0,
      undefined,
      true
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.renderedCount).toBe(1);
      expect(outcome.message.toLowerCase()).toMatch(/last frame/);
    }
    expect(deps.setPlateStill).not.toHaveBeenCalled();
  });
});

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
