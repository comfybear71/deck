import { describe, expect, it, vi } from "vitest";
import { runScriptSequence, type ScriptSequenceRunnerDeps } from "./scriptSequenceRunner";
import { buildScriptSequenceSegments } from "./skidmarks";
import type { SkidmarksClipSegment, SkidmarksMember } from "./skidmarks";

function threeParts() {
  return [
    { index: 1, title: "A", startSec: 0, endSec: 15, prompt: "part one" },
    { index: 2, title: "B", startSec: 15, endSec: 30, prompt: "part two" },
    { index: 3, title: "C", startSec: 30, endSec: 45, prompt: "part three" },
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
    renderClip: vi.fn(async () => ({ ok: true as const, videoUrl: "https://blob.example/clip.mp4", persisted: true })),
    recordRender: vi.fn(),
    extractLastFrame: vi.fn(async () => "data:image/jpeg;base64,lastframe"),
    setPlateStill: vi.fn(),
    onProgress: vi.fn(),
    ...overrides,
  };
}

/** Runs with no real song audio/vocalist — every clip in `threeParts()`
 * comes out Instrumental (an empty `realSegments` list means
 * `resolveScriptPartVocal` never finds anything to route Vocal), so
 * these two are never actually read by most tests below. */
function run(segments: SkidmarksClipSegment[], deps: ScriptSequenceRunnerDeps, mp3AudioUrl?: string, vocalist?: SkidmarksMember) {
  return runScriptSequence(segments, "Stu Balls", deps, mp3AudioUrl, vocalist);
}

describe("runScriptSequence", () => {
  it("real reported ask: renders all clips in order, chaining each into the next, and reports full success", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const deps = fakeDeps();

    const outcome = await run(segments, deps);

    expect(outcome).toEqual({ ok: true, renderedCount: 3 });
    expect(deps.renderClip).toHaveBeenCalledTimes(3);
    expect(deps.recordRender).toHaveBeenCalledTimes(3);
    // Chains after clip 1 and clip 2, never after the last clip (nothing to chain into).
    expect(deps.extractLastFrame).toHaveBeenCalledTimes(2);
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
      .mockResolvedValueOnce({ ok: true, videoUrl: "https://blob.example/1.mp4", persisted: true })
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

  it("real reported bug (2026-09-14): a chain-extraction failure stops the run rather than rendering the next clip from nothing", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    const extractLastFrame = vi
      .fn()
      .mockRejectedValueOnce(new Error("Load failed"))
      .mockResolvedValue("data:image/jpeg;base64,lastframe");
    const deps = fakeDeps({ extractLastFrame });

    const outcome = await run(segments, deps);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAtClipIndex).toBe(0);
      expect(outcome.message).toContain("Load failed");
      expect(outcome.renderedCount).toBe(1); // clip 1 itself did render successfully
    }
    expect(deps.renderClip).toHaveBeenCalledTimes(1); // never reaches clip 2 — no starting frame for it
  });

  it("never overwrites a plate that somehow already has a still mid-run", async () => {
    const segments = buildScriptSequenceSegments(threeParts(), []);
    segments[1].plates[0].still = { dataUrl: "data:image/jpeg;base64,preset", source: "upload", createdAt: 1 };
    const deps = fakeDeps();

    await run(segments, deps);

    // Only one chain-fill (clip 2 -> clip 3); clip 1 -> clip 2 is skipped since clip 2 already has a still.
    expect(deps.extractLastFrame).toHaveBeenCalledTimes(1);
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
      const renderClip = vi.fn(async () => ({ ok: true as const, videoUrl: "https://blob.example/clip.mp4", persisted: true }));
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
