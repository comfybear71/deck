import { describe, expect, it, vi } from "vitest";
import { runScriptSequence, type ScriptSequenceRunnerDeps } from "./scriptSequenceRunner";
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
