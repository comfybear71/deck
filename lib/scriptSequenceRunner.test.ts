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
  startAtClipIndex?: number
) {
  return runScriptSequence(segments, "Stu Balls", deps, mp3AudioUrl, vocalist, startAtClipIndex);
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

  it("real follow-up ask (2026-09-15): a locked vocalist chains within a batch of clips, then resets to his reference photo at the batch boundary", async () => {
    // 5 parts crosses one LOCKED_CHARACTER_CHAIN_BATCH_SIZE (3) boundary
    // and into the start of the next batch: clip1->2, clip2->3 stay
    // chained (real continuity for up to 3 clips in a row); clip3->4
    // resets to the reference photo (a fresh batch, max 3 strung
    // together); clip4->5 chains again, starting the next batch's own
    // continuity — a full reset-every-clip would never chain at all, a
    // full never-reset would never reset; this is the middle ground
    // Stuart asked for after "nobody wants to watch a boring video."
    const segments = buildScriptSequenceSegments(fiveParts(), []);
    const jackAsh = member({
      id: "jack-ash-frontman",
      name: "Jack Ash",
      avatarImage: "https://blob.example/jack-ash-reference.jpg",
    });
    const deps = fakeDeps();

    await run(segments, deps, undefined, jackAsh);

    const chainFills = chainFillCalls(deps, segments[0].id);
    expect(chainFills).toHaveLength(4); // clip1->2, 2->3, 3->4, 4->5

    const [toClip2, toClip3, toClip4, toClip5] = chainFills;
    for (const still of [toClip2, toClip3]) {
      expect(still.dataUrl).toBe("https://blob.example/clip-lastframe.jpg");
      expect(still.source).toBe("chained");
      expect(still.featuresLockedCharacter).toBeUndefined();
    }
    expect(toClip4.dataUrl).toBe("https://blob.example/jack-ash-reference.jpg");
    expect(toClip4.source).toBe("generated");
    expect(toClip4.featuresLockedCharacter).toBe(true);
    expect(toClip5.dataUrl).toBe("https://blob.example/clip-lastframe.jpg");
    expect(toClip5.source).toBe("chained");
  });

  it("falls back to the locked reference photo mid-batch when the server couldn't capture a last frame, instead of failing the run", async () => {
    const segments = buildScriptSequenceSegments(fiveParts(), []);
    const jackAsh = member({
      id: "jack-ash-frontman",
      name: "Jack Ash",
      avatarImage: "https://blob.example/jack-ash-reference.jpg",
    });
    const renderClip = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, videoUrl: "https://blob.example/1.mp4", persisted: true }) // no lastFrameUrl
      .mockResolvedValue({
        ok: true,
        videoUrl: "https://blob.example/clip.mp4",
        persisted: true,
        lastFrameUrl: "https://blob.example/clip-lastframe.jpg",
      });
    const deps = fakeDeps({ renderClip });

    const outcome = await run(segments, deps, undefined, jackAsh);

    expect(outcome.ok).toBe(true);
    const chainFills = chainFillCalls(deps, segments[0].id);
    expect(chainFills[0].dataUrl).toBe("https://blob.example/jack-ash-reference.jpg");
    expect(chainFills[0].source).toBe("generated");
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

    it("resuming from a clip with no starting image fails honestly rather than guessing", async () => {
      const segments = buildScriptSequenceSegments(threeParts(), []);
      // Clip 2's plate has no still — never happens in the real chained
      // flow, but this function shouldn't assume its caller got that
      // right either.
      const deps = fakeDeps();

      const outcome = await run(segments, deps, undefined, undefined, 1);

      expect(outcome).toEqual({
        ok: false,
        failedAtClipIndex: 1,
        message: "Clip 2 has no starting image to render from.",
        renderedCount: 1,
      });
      expect(deps.renderClip).not.toHaveBeenCalled();
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
