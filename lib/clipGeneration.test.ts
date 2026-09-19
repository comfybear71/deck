import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClipGenerationRequest,
  describeClipPayload,
  LTX_DEFAULT_NEGATIVE_PROMPT,
  motionPromptMovesCamera,
  computeLtxPlateDurationSec,
  computePlateDurationSec,
  computePlateTimeRange,
  estimateClipRenderCostUsd,
  estimateH3ClipRenderCostUsd,
  estimateLtxClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_CLIP_DURATION_SEC,
  MAX_LTX_CLIP_DURATION_SEC,
  MIN_CLIP_DURATION_SEC,
  MIN_LTX_CLIP_DURATION_SEC,
  MAX_MOTION_PROMPT_LENGTH,
} from "./clipGeneration";
import type { SkidmarksMember } from "./skidmarks";

function member(overrides: Partial<SkidmarksMember>): SkidmarksMember {
  return { id: "member-id", name: "", emoji: "", looks: [], ...overrides };
}

describe("computePlateDurationSec", () => {
  it("matches the task's own 40s / 3 plates \u2248 13 + 13 + 14 example exactly", () => {
    expect(computePlateDurationSec(40, 3, 0)).toBe(13);
    expect(computePlateDurationSec(40, 3, 1)).toBe(13);
    expect(computePlateDurationSec(40, 3, 2)).toBe(14);
  });

  it("gives the whole clip's length to a single plate, clamped into range", () => {
    expect(computePlateDurationSec(10, 1, 0)).toBe(10);
  });

  it("clamps a too-short per-plate share up to MIN_CLIP_DURATION_SEC", () => {
    expect(computePlateDurationSec(6, 3, 0)).toBe(MIN_CLIP_DURATION_SEC);
  });

  it("clamps a too-long per-plate share down to MAX_CLIP_DURATION_SEC", () => {
    expect(computePlateDurationSec(60, 1, 0)).toBe(MAX_CLIP_DURATION_SEC);
  });

  it("falls back to MIN_CLIP_DURATION_SEC for a zero/invalid plate count rather than dividing by zero", () => {
    expect(computePlateDurationSec(40, 0, 0)).toBe(MIN_CLIP_DURATION_SEC);
  });
});

describe("computeLtxPlateDurationSec", () => {
  it("clamps into LTX's real [5, 15] range", () => {
    expect(computeLtxPlateDurationSec(60, 1, 0)).toBe(MAX_LTX_CLIP_DURATION_SEC);
    expect(computeLtxPlateDurationSec(2, 1, 0)).toBe(MIN_LTX_CLIP_DURATION_SEC);
  });

  it("gives a 12s share a real, unclamped pass-through", () => {
    expect(computeLtxPlateDurationSec(12, 1, 0)).toBe(12);
  });

  it("clamps a raw segment/plateCount well past the ceiling (Stuart's real 163s / 5 plates live-QA case) down to MAX_LTX_CLIP_DURATION_SEC, never throwing", () => {
    // 163s / 5 plates \u2248 32-33s/plate raw \u2014 must clamp to 15, not error.
    for (let plateIndex = 0; plateIndex < 5; plateIndex++) {
      expect(computeLtxPlateDurationSec(163, 5, plateIndex)).toBe(MAX_LTX_CLIP_DURATION_SEC);
    }
  });

  it("still splits evenly across multiple plates the same way as the Grok range", () => {
    expect(computeLtxPlateDurationSec(40, 3, 0)).toBe(13);
    expect(computeLtxPlateDurationSec(40, 3, 2)).toBe(14);
  });
});

describe("computePlateTimeRange", () => {
  it("gives a single plate the whole clip's own time range, when it already fits the bounds", () => {
    expect(computePlateTimeRange(100, 110, 1, 0)).toEqual({ startSec: 100, endSec: 110 });
  });

  it("walks each earlier plate's own computed duration to find this plate's absolute start", () => {
    // 40s clip, 3 plates -> 13 + 13 + 14 (matches computePlateDurationSec's own example).
    expect(computePlateTimeRange(0, 40, 3, 0)).toEqual({ startSec: 0, endSec: 13 });
    expect(computePlateTimeRange(0, 40, 3, 1)).toEqual({ startSec: 13, endSec: 26 });
    expect(computePlateTimeRange(0, 40, 3, 2)).toEqual({ startSec: 26, endSec: 40 });
  });

  it("offsets correctly when the clip itself doesn't start at 0", () => {
    expect(computePlateTimeRange(100, 140, 2, 0)).toEqual({ startSec: 100, endSec: 115 });
    expect(computePlateTimeRange(100, 140, 2, 1)).toEqual({ startSec: 115, endSec: 130 });
  });

  it("clamps the same way whether LTX bounds are passed explicitly or left at Grok's default — the two ranges are equal now (both [5, 15])", () => {
    const ltxBounds = { min: MIN_LTX_CLIP_DURATION_SEC, max: MAX_LTX_CLIP_DURATION_SEC };
    expect(computePlateTimeRange(100, 140, 2, 0, ltxBounds)).toEqual({ startSec: 100, endSec: 115 });
    expect(computePlateTimeRange(100, 140, 2, 1, ltxBounds)).toEqual({ startSec: 115, endSec: 130 });
  });

  it("every plate's own endSec - startSec matches computePlateDurationSec for the same inputs, under either bounds", () => {
    for (const bounds of [undefined, { min: MIN_LTX_CLIP_DURATION_SEC, max: MAX_LTX_CLIP_DURATION_SEC }] as const) {
      const range = computePlateTimeRange(0, 40, 3, 1, bounds);
      const expectedDuration = bounds
        ? computeLtxPlateDurationSec(40, 3, 1)
        : computePlateDurationSec(40, 3, 1);
      expect(range.endSec - range.startSec).toBe(expectedDuration);
    }
  });
});

describe("estimateLtxClipRenderCostUsd", () => {
  it("scales with real duration at LTX-2.5 (Fast)'s published $0.13/s 1080p rate, no per-image surcharge", () => {
    expect(estimateLtxClipRenderCostUsd(5)).toBeCloseTo(0.65, 5);
    expect(estimateLtxClipRenderCostUsd(20)).toBeCloseTo(2.6, 5);
  });
});

describe("buildClipGenerationRequest", () => {
  it("always leads with the clip's own shot prompt, verbatim", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open in an empty hallway",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(prompt.startsWith("a door creaks open in an empty hallway")).toBe(true);
  });

  it("returns `shotPrompt` as just the clip's own (trimmed) text, distinct from the longer merged `prompt`", () => {
    const { prompt, shotPrompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "  door, then keyhole, then Jack seated  ",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(shotPrompt).toBe("door, then keyhole, then Jack seated");
    expect(prompt.length).toBeGreaterThan(shotPrompt.length);
    expect(prompt).not.toBe(shotPrompt);
  });

  it("always sends exactly the one selected plate's still as the reference image", () => {
    const { referenceImageDataUrls } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(referenceImageDataUrls).toEqual(["data:image/jpeg;base64,door"]);
  });

  it("audit P3: adds no camera line at all when no motionPrompt is given on an Instrumental clip", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(prompt).toBe("a door creaks open Music video for Jack Ash. no on-screen text, no watermark.");
    expect(prompt.toLowerCase()).not.toMatch(/push-in|zoom|orbit|\bpan\b|cinematic motion/);
  });

  it("lets an explicit motionPrompt override the automatic motion hint outright, not append alongside it", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: "slow pan left, then hold on the door",
    });
    expect(prompt).toContain("slow pan left, then hold on the door");
    expect(prompt).not.toContain("Slow cinematic push-in zoom");
  });

  it("preserves a multi-line motionPrompt verbatim (aside from trimming) — this is a multi-line field, not single-line", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: "slow zoom into keyhole,\nmild pulse on door cracks",
    });
    expect(prompt).toContain("slow zoom into keyhole,\nmild pulse on door cracks");
  });

  it("treats a whitespace-only motionPrompt as blank — no camera line, nothing invented", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: "   ",
    });
    expect(prompt).toBe("a door creaks open Music video for Jack Ash. no on-screen text, no watermark.");
  });

  it("caps an overlong motionPrompt at MAX_MOTION_PROMPT_LENGTH rather than sending it verbatim", () => {
    const long = "pan ".repeat(160).trim();
    expect(long.length).toBeGreaterThan(MAX_MOTION_PROMPT_LENGTH);
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
      motionPrompt: long,
    });
    expect(prompt).toContain(long.slice(0, MAX_MOTION_PROMPT_LENGTH));
    expect(prompt).not.toContain(long);
  });

  it("clamps durationSec into [MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC]", () => {
    expect(
      buildClipGenerationRequest({
      vocal: false,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 1,
      }).durationSec
    ).toBe(MIN_CLIP_DURATION_SEC);
    expect(
      buildClipGenerationRequest({
      vocal: false,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 99,
      }).durationSec
    ).toBe(MAX_CLIP_DURATION_SEC);
  });

  it("passes the persistence fields (segmentId/plateId/plateIndex/plateCount/clipIndex/startSec/endSec) straight through when given", () => {
    const request = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 13,
      segmentId: "seg-1",
      plateId: "plate-1",
      plateIndex: 0,
      plateCount: 3,
      clipIndex: 1,
      startSec: 0,
      endSec: 40,
    });
    expect(request.segmentId).toBe("seg-1");
    expect(request.plateId).toBe("plate-1");
    expect(request.plateIndex).toBe(0);
    expect(request.plateCount).toBe(3);
    expect(request.clipIndex).toBe(1);
    expect(request.startSec).toBe(0);
    expect(request.endSec).toBe(40);
  });

  it("leaves the persistence fields unset (not e.g. an explicit null) when the caller doesn't provide them", () => {
    const request = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a door creaks open",
      bandName: "Jack Ash",
      plateStillDataUrl: "data:image/jpeg;base64,door",
      durationSec: 5,
    });
    expect(request.segmentId).toBeUndefined();
    expect(request.plateId).toBeUndefined();
    expect(JSON.stringify(request)).not.toContain("segmentId");
  });

  describe("Instrumental videoBackend (H3/Grok switch)", () => {
    it("defaults to h3 when instrumentalVideoModel is omitted \u2014 Stuart's 2026-09-13 default", () => {
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "a door creaks open",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,door",
        durationSec: 5,
      });
      expect(request.videoBackend).toBe("h3");
    });

    it("honors an explicit grok pick", () => {
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "a door creaks open",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,door",
        durationSec: 5,
        instrumentalVideoModel: "grok",
      });
      expect(request.videoBackend).toBe("grok");
    });

    it("falls back to h3 for any stored value other than the literal grok", () => {
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 5,
        instrumentalVideoModel: "h3",
      });
      expect(request.videoBackend).toBe("h3");
    });

    it("never sets videoBackend on a Vocal (Comfy LTX) request", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,jack",
        durationSec: 10,
      });
      expect(request.videoBackend).toBeUndefined();
    });
  });

  it("always names the band and asks for no on-screen text/watermark", () => {
    const { prompt } = buildClipGenerationRequest({
      vocal: false,
      shotPrompt: "a keyhole, lit from behind",
      bandName: "Solar Rebel",
      plateStillDataUrl: "data:image/jpeg;base64,keyhole",
      durationSec: 5,
    });
    expect(prompt).toContain("Music video for Solar Rebel.");
    expect(prompt).toContain("no on-screen text, no watermark");
  });

  describe("vocal (Comfy Cloud LTX) requests", () => {
    it("sets vocal:true on the built request", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,jack",
        durationSec: 10,
      });
      expect(request.vocal).toBe(true);
    });

    it("clamps durationSec into LTX's [5, 15] range", () => {
      expect(
        buildClipGenerationRequest({
          vocal: true,
          shotPrompt: "x",
          bandName: "Jack Ash",
          plateStillDataUrl: "data:image/jpeg;base64,x",
          durationSec: 12,
        }).durationSec
      ).toBe(12);
      expect(
        buildClipGenerationRequest({
          vocal: true,
          shotPrompt: "x",
          bandName: "Jack Ash",
          plateStillDataUrl: "data:image/jpeg;base64,x",
          durationSec: 99,
        }).durationSec
      ).toBe(MAX_LTX_CLIP_DURATION_SEC);
    });

    it("passes mp3AudioUrl straight through", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 10,
        mp3AudioUrl: "https://blob.vercel-storage.com/skidmarks/mp3-audio/abc.mp3",
      });
      expect(request.mp3AudioUrl).toBe("https://blob.vercel-storage.com/skidmarks/mp3-audio/abc.mp3");
    });

    it("computes this plate's own audioStartSec/audioEndSec from the clip's time range and plate geometry", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 13,
        plateIndex: 1,
        plateCount: 3,
        startSec: 0,
        endSec: 40,
      });
      expect(request.audioStartSec).toBe(13);
      expect(request.audioEndSec).toBe(26);
    });

    it("leaves audioStartSec/audioEndSec unset when the plate geometry isn't fully given", () => {
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 10,
      });
      expect(request.audioStartSec).toBeUndefined();
      expect(request.audioEndSec).toBeUndefined();
    });

    it("never sets mp3AudioUrl/audioStartSec/audioEndSec on a non-vocal (Grok) request", () => {
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "x",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,x",
        durationSec: 10,
        mp3AudioUrl: "https://blob.vercel-storage.com/should-be-ignored.mp3",
        plateIndex: 0,
        plateCount: 1,
        startSec: 0,
        endSec: 10,
      });
      expect(request.mp3AudioUrl).toBeUndefined();
      expect(request.audioStartSec).toBeUndefined();
      expect(request.audioEndSec).toBeUndefined();
    });

    /**
     * Real reported bug (2026-09-19): a second band's singer was given a
     * lock card in the app — the supported way to lock a new artist —
     * and his rendered clips came back in a wide-brim fedora with
     * glowing neon-blue lips. Jack Ash's look, on a completely
     * different person. Three Jack-specific strings were module
     * constants applied to *any* locked character, so writing any lock
     * card silently opted that member into Jack's shadow-face treatment.
     */
    it("does not put Jack Ash's fedora, shadow face or neon lips on a different artist's lock card", () => {
      const soulRebel = member({
        id: "solar-rebel-vocalist",
        name: "Soul Rebel",
        role: "Vocals",
        lock: {
          lookRules: "Long sandy dreadlocks, full beard, round purple sunglasses, beaded necklaces.",
          neverShow: "a woman, a second person",
        },
      });
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing at a vintage microphone",
        bandName: "Solar Rebel",
        plateStillDataUrl: "data:image/jpeg;base64,soul",
        durationSec: 10,
        vocalist: soulRebel,
      });
      const prompt = request.prompt.toLowerCase();

      // The reported symptoms, each pinned.
      expect(prompt).not.toContain("neon");
      expect(prompt).not.toContain("fedora");
      expect(prompt).not.toContain("shadow-face");
      expect(prompt).not.toContain("watchable stare");
      expect(prompt).not.toContain("hat-brim");
      expect(prompt).not.toContain("silhouette");
      expect(request.negativePrompt ?? "").not.toMatch(/neon|fedora/i);

      // He still gets his own lock text and the standard Vocal wrap —
      // this must not fix the leak by dropping his lock entirely.
      expect(prompt).toContain("dreadlocks");
      expect(prompt).toContain("perfect lip sync");
      expect(request.negativePrompt ?? "").toContain("a woman");
    });

    it("still gives an unlocked vocalist the plain Vocal wrap, with no locked-character text at all", () => {
      const plain = member({ id: "nova", name: "Nova", role: "Vocals" });
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing at a vintage microphone",
        bandName: "Solar Rebel",
        plateStillDataUrl: "data:image/jpeg;base64,nova",
        durationSec: 10,
        vocalist: plain,
      });
      expect(request.prompt).toContain("perfect lip sync");
      expect(request.prompt.toLowerCase()).not.toContain("neon");
      expect(request.prompt.toLowerCase()).not.toContain("fedora");
    });

    it("injects Jack Ash's video-specific hallmarks plus the 'mouth in frame' note when he's the vocalist, and sends his negative cues on a real, separate channel instead of inline", () => {
      const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,jack",
        durationSec: 10,
        vocalist: jackAsh,
      });
      expect(request.prompt.toLowerCase()).toContain("neon blue");
      expect(request.prompt.toLowerCase()).toContain("shadow");
      expect(request.prompt.toLowerCase()).toContain("watchable stare");
      expect(request.prompt.toLowerCase()).toContain("mouth is actually");
      // Real reported failure (2026-09-15): naming a concept even to
      // negate it, inside the same positive-conditioning text, doesn't
      // suppress it as reliably as true negative conditioning — the
      // negative cues no longer ride along in `prompt` as a "Do not
      // show: X" sentence at all.
      expect(request.prompt).not.toContain("Do not show:");
      expect(request.negativePrompt?.toLowerCase()).toContain("face lit or visible");
      expect(request.negativePrompt?.toLowerCase()).toContain("normal skin tone");
    });

    it("real bug (2026-09-16 live render): never asks for 'facial expressions' on a locked character — that directly contradicted the shadow-face lock and produced a normal lit face", () => {
      const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
      const { prompt } = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,jack",
        durationSec: 10,
        vocalist: jackAsh,
      });
      expect(prompt.toLowerCase()).not.toContain("facial expressions");
      // The rest of the original lock wording must still be there, unchanged.
      expect(prompt).toContain("perfect lip sync");
      expect(prompt).toContain("hand gestures are lively");
      expect(prompt).toContain("dication is perfect");
    });

    it("still asks for 'facial expressions' for a vocalist with no registered lock — only a locked character drops it", () => {
      const nova = member({ id: "solar-rebel-vocals", name: "Nova", role: "Vocals" });
      const { prompt } = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Solar Rebel",
        plateStillDataUrl: "data:image/jpeg;base64,nova",
        durationSec: 10,
        vocalist: nova,
      });
      expect(prompt.toLowerCase()).toContain("facial expressions");
    });

    it("defaults a locked vocal character's clip to a static Camera holds shot, never the generic push-in zoom", () => {
      const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
      const { prompt } = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,jack",
        durationSec: 10,
        vocalist: jackAsh,
      });
      expect(prompt).toContain("Camera holds");
      expect(prompt).not.toContain("Slow cinematic push-in zoom");
      expect(prompt.toLowerCase()).toContain("foot tap");
    });

    it("adds no camera line for a vocalist with no registered lock when motion is blank", () => {
      const nova = member({ id: "solar-rebel-vocals", name: "Nova", role: "Vocals" });
      const { prompt } = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Solar Rebel",
        plateStillDataUrl: "data:image/jpeg;base64,nova",
        durationSec: 10,
        vocalist: nova,
      });
      expect(prompt.toLowerCase()).not.toMatch(/push-in|zoom|orbit|\bpan\b|camera holds/);
      expect(prompt.startsWith("singing directly to camera")).toBe(true);
    });

    it("never injects a character lock for a vocalist with no registered lock", () => {
      const nova = member({ id: "solar-rebel-vocals", name: "Nova", role: "Vocals" });
      const request = buildClipGenerationRequest({
        vocal: true,
        shotPrompt: "singing directly to camera",
        bandName: "Solar Rebel",
        plateStillDataUrl: "data:image/jpeg;base64,nova",
        durationSec: 10,
        vocalist: nova,
      });
      expect(request.prompt.toLowerCase()).not.toContain("neon blue");
      expect(request.prompt).not.toContain("Do not show:");
      expect(request.negativePrompt).toBeUndefined();
    });

    it("real gap fixed 2026-09-16 (Jack Ghost spec): a locked vocalist's own look text now also lands on a Grok/Instrumental (Mute) request, not just Vocal — only the Vocal-only wrap and lip-sync fields stay Vocal-only", () => {
      const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
      const request = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "a door creaks open",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,door",
        durationSec: 5,
        vocalist: jackAsh,
      });
      // His own hallmarks (neon lips is his own look, not the generic note's).
      expect(request.prompt.toLowerCase()).toContain("neon blue");
      // The generic shadow-face lock now runs on a Mute clip too, in its
      // own non-singing wording — never the Vocal note's "while he's singing".
      expect(request.prompt.toLowerCase()).toContain("shadow-face lock holds");
      expect(request.prompt.toLowerCase()).not.toContain("while he's singing");
      expect(request.prompt.toLowerCase()).toContain("only figure in frame");
      // Still never the Vocal backend's own lip-sync wrap, or any lip-sync fields.
      expect(request.prompt.toLowerCase()).not.toContain("perfect lip sync");
      expect(request.mp3AudioUrl).toBeUndefined();
    });

    it("gives a locked Instrumental clip the same static Camera holds default (with no false 'vocal' claim) when motion is blank", () => {
      const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
      const { prompt } = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "a door creaks open",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,door",
        durationSec: 5,
        vocalist: jackAsh,
      });
      expect(prompt).toContain("Camera holds");
      expect(prompt.toLowerCase()).not.toContain("in time with the vocal");
    });

    it("warns about camera-moving motion/shot text on a locked Instrumental clip too, not just Vocal", () => {
      const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
      const { cameraWarnings } = buildClipGenerationRequest({
        vocal: false,
        shotPrompt: "a door creaks open",
        bandName: "Jack Ash",
        plateStillDataUrl: "data:image/jpeg;base64,door",
        durationSec: 5,
        vocalist: jackAsh,
        motionPrompt: "slow zoom into his hat",
      });
      expect(cameraWarnings).toEqual({ typedMotionMovesCamera: true, shotMovesCamera: false });
    });
  });
});

/**
 * Audit Part 3 — "user text wins, hidden text may only constrain Jack,
 * no secret zoom." P1–P4 verbatim from the brief, plus the warnings.
 */
describe("prompt assembly: Stuart's text on top, no hidden camera moves", () => {
  const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
  const baseParams = {
    shotPrompt: "Jack at the farm, still camera.",
    bandName: "Stu Balls",
    plateStillDataUrl: "data:image/jpeg;base64,abc",
    durationSec: 10,
    vocal: true,
    vocalist: jackAsh,
    mp3AudioUrl: "https://blob.example/song.mp3",
  };
  const cameraVerbs = /push-in|zoom|orbit|\bpan\b|dolly|whip/i;

  it("P1: Jack vocal, motion empty — sent prompt has no push-in, zoom, orbit or pan anywhere", () => {
    const { prompt } = buildClipGenerationRequest({ ...baseParams });
    expect(prompt.startsWith("Jack at the farm, still camera.")).toBe(true);
    expect(prompt).toContain("Camera holds");
    expect(prompt).not.toMatch(cameraVerbs);
  });

  it("P2: typed motion is sent as written, right after the shot, with no factory line after it", () => {
    const { prompt } = buildClipGenerationRequest({ ...baseParams, motionPrompt: "camera holds, small head nod." });
    expect(prompt.startsWith("Jack at the farm, still camera. camera holds, small head nod.")).toBe(true);
    expect(prompt).not.toContain("Camera holds \u2014 a static, locked-off frame");
    expect(prompt).not.toMatch(cameraVerbs);
  });

  it("P3: Instrumental, motion empty — no automatic slow cinematic push-in zoom, no camera line at all", () => {
    const { prompt } = buildClipGenerationRequest({ ...baseParams, vocal: false, vocalist: undefined, shotPrompt: "empty hallway, door ajar" });
    expect(prompt).toBe("empty hallway, door ajar Music video for Stu Balls. no on-screen text, no watermark.");
  });

  it("P4: Jack vocal keeps the lock text (shadow face, neon lips) and camera verbs only if he wrote them", () => {
    const blank = buildClipGenerationRequest({ ...baseParams });
    expect(blank.prompt.toLowerCase()).toContain("neon");
    expect(blank.prompt.toLowerCase()).toContain("shadow");
    expect(blank.prompt).not.toMatch(cameraVerbs);

    const typed = buildClipGenerationRequest({ ...baseParams, motionPrompt: "slow zoom onto his lips" });
    expect(typed.prompt).toContain("slow zoom onto his lips");
    expect(typed.prompt.match(/zoom/gi)).toHaveLength(1); // his one, nothing of the app's
  });

  it("the Vocal LTX lock no longer carries its own \"Camera holds.\" sentence — the hold comes only from the blank-motion default", () => {
    const nova = member({ id: "solar-rebel-vocals", name: "Nova" });
    const { prompt } = buildClipGenerationRequest({ ...baseParams, vocalist: nova, motionPrompt: "slow pan across the stage" });
    expect(prompt).toContain("slow pan across the stage");
    expect(prompt).not.toContain("Camera holds");
  });

  it("the Jack video note never names a camera move, even to forbid one", () => {
    const { prompt } = buildClipGenerationRequest({ ...baseParams });
    expect(prompt.toLowerCase()).not.toContain("pushes in");
    expect(prompt.toLowerCase()).not.toContain("zooms");
    expect(prompt.toLowerCase()).not.toContain("orbit");
  });

  it("the no-motion footer line never leaks onto a non-Jack render", () => {
    const { prompt } = buildClipGenerationRequest({ ...baseParams, vocal: false, vocalist: undefined, shotPrompt: "crowd at the bar" });
    expect(prompt).not.toContain("Cinematic motion");
  });

  it("real bug (2026-09-16 live render): the 'no other people' rule no longer names 'other people'/'extra characters' inside the positive prompt — that's what let a second head sneak in — it goes out as real negative conditioning instead", () => {
    const { prompt, negativePrompt } = buildClipGenerationRequest({ ...baseParams });
    expect(prompt).not.toContain("Solo shot");
    expect(prompt.toLowerCase()).not.toContain("extra characters");
    expect(negativePrompt?.toLowerCase()).toContain("second person");
    expect(negativePrompt?.toLowerCase()).toContain("extra head");
  });

  it("never sends the solo-shot negative cues for a vocalist with no registered lock", () => {
    const nova = member({ id: "solar-rebel-vocals", name: "Nova" });
    const { negativePrompt } = buildClipGenerationRequest({ ...baseParams, vocalist: nova });
    expect(negativePrompt).toBeUndefined();
  });

  it("real ask (2026-09-16): a script-pasted negative prompt reaches the real negativePrompt on a Vocal clip, even with no locked character", () => {
    const nova = member({ id: "solar-rebel-vocals", name: "Nova" });
    const { negativePrompt } = buildClipGenerationRequest({
      ...baseParams,
      vocalist: nova,
      userNegativePrompt: "humans, clear human details, faces, skin",
    });
    expect(negativePrompt).toBe("humans, clear human details, faces, skin");
  });

  it("joins a typed negative prompt onto a locked character's own negative cues, not one replacing the other", () => {
    const { negativePrompt } = buildClipGenerationRequest({
      ...baseParams,
      userNegativePrompt: "sudden camera jumps",
    });
    expect(negativePrompt?.toLowerCase()).toContain("second person");
    expect(negativePrompt?.toLowerCase()).toContain("sudden camera jumps");
  });

  it("trims a typed negative prompt and never sends an empty one", () => {
    const nova = member({ id: "solar-rebel-vocals", name: "Nova" });
    const { negativePrompt } = buildClipGenerationRequest({
      ...baseParams,
      vocalist: nova,
      userNegativePrompt: "   ",
    });
    expect(negativePrompt).toBeUndefined();
  });

  it("never sends a typed negative prompt on an Instrumental request — no real negative-prompt channel exists there", () => {
    const nova = member({ id: "solar-rebel-vocals", name: "Nova" });
    const { negativePrompt } = buildClipGenerationRequest({
      ...baseParams,
      vocal: false,
      vocalist: nova,
      userNegativePrompt: "humans, faces",
    });
    expect(negativePrompt).toBeUndefined();
  });

  it("motionPromptMovesCamera catches zoom/push-in/orbit/pan/tracking/swerve wording", () => {
    for (const text of ["slow zoom into his hat", "push-in on the lips", "orbit around him", "pan left to the door", "tracking shot down the hall", "the camera swerves past"]) {
      expect(motionPromptMovesCamera(text)).toBe(true);
    }
    expect(motionPromptMovesCamera("he nods slowly, taps his foot")).toBe(false);
    expect(motionPromptMovesCamera("")).toBe(false);
    expect(motionPromptMovesCamera(undefined)).toBe(false);
  });

  it("warns (never rewrites) when his typed motion or shot moves the camera on a Jack vocal", () => {
    const typed = buildClipGenerationRequest({ ...baseParams, motionPrompt: "slow push-in onto his face" });
    expect(typed.prompt).toContain("slow push-in onto his face");
    expect(typed.cameraWarnings).toEqual({ typedMotionMovesCamera: true, shotMovesCamera: false });

    const shot = buildClipGenerationRequest({ ...baseParams, shotPrompt: "Tracking shot swerving around Jack as he sings" });
    expect(shot.prompt.startsWith("Tracking shot swerving around Jack as he sings")).toBe(true);
    expect(shot.prompt).not.toContain("Camera override");
    expect(shot.cameraWarnings).toEqual({ typedMotionMovesCamera: false, shotMovesCamera: true });

    // Real gap fixed 2026-09-16 (Jack Ghost spec): a locked character's
    // Instrumental/Mute clip now gets the same warning a Vocal one does —
    // it used to report `undefined` here, silently skipping the warning.
    const instrumental = buildClipGenerationRequest({ ...baseParams, vocal: false, motionPrompt: "slow zoom into the keyhole" });
    expect(instrumental.cameraWarnings).toEqual({ typedMotionMovesCamera: true, shotMovesCamera: false });

    // Still never warns for an Instrumental clip with no locked vocalist at all.
    const unlocked = buildClipGenerationRequest({ ...baseParams, vocal: false, vocalist: undefined, motionPrompt: "slow zoom into the keyhole" });
    expect(unlocked.cameraWarnings).toBeUndefined();
  });
});

/**
 * Audit Part 4 — why fifty-six clips ended on the same frame, and the
 * payload panel that proves what is sent.
 */
describe("Part 4: no stay-on-the-start-image lock, and an honest payload record", () => {
  const jackAsh = member({ id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman" });
  const vocalParams = {
    shotPrompt: "Jack on the porch",
    bandName: "Stu Balls",
    plateStillDataUrl: "data:image/jpeg;base64,abc",
    durationSec: 12,
    vocal: true,
    vocalist: jackAsh,
    mp3AudioUrl: "https://blob.example/song.mp3",
    startSec: 30,
    endSec: 42,
    plateIndex: 0,
    plateCount: 1,
  };

  it("a Vocal render no longer tells LTX to stay on the start image, or to look like a 3D animated feature", () => {
    const { prompt } = buildClipGenerationRequest(vocalParams);
    expect(prompt.toLowerCase()).not.toContain("start image");
    expect(prompt.toLowerCase()).not.toContain("as the first frame");
    expect(prompt.toLowerCase()).not.toContain("for the entire clip");
    expect(prompt.toLowerCase()).not.toContain("3d animated");
    expect(prompt.toLowerCase()).not.toContain("photoreal human");
    expect(prompt).toContain("perfect lip sync"); // the lip-sync lock itself stays
  });

  it("describeClipPayload reports engine, real duration, start image, End image NONE, full prompts and the audio slice", () => {
    const request = buildClipGenerationRequest({ ...vocalParams, motionPrompt: "small nod" });
    const payload = describeClipPayload(request, "https://blob.example/still.jpg", "small nod");
    expect(payload.engine).toBe("LTX");
    expect(payload.durationSec).toBe(12);
    expect(payload.startImageUrl).toBe("https://blob.example/still.jpg");
    expect(payload.endImageUrl).toBeNull();
    expect(payload.prompt).toBe(request.prompt);
    expect(payload.userText).toBe("Jack on the porch small nod");
    expect(payload.prompt.startsWith(payload.userText)).toBe(true);
    expect(payload.negativePrompt.startsWith(LTX_DEFAULT_NEGATIVE_PROMPT)).toBe(true);
    expect(payload.negativePrompt.toLowerCase()).toContain("face lit or visible");
    expect(payload.audioStartSec).toBe(30);
    expect(payload.audioEndSec).toBe(42);
  });

  it("describeClipPayload names Grok/H3 for an Instrumental render and reports no negative prompt", () => {
    const grok = buildClipGenerationRequest({ ...vocalParams, vocal: false, vocalist: undefined, instrumentalVideoModel: "grok" });
    expect(describeClipPayload(grok, "https://blob.example/a.jpg", "").engine).toBe("Grok");
    const h3 = buildClipGenerationRequest({ ...vocalParams, vocal: false, vocalist: undefined, instrumentalVideoModel: "h3" });
    const payload = describeClipPayload(h3, "https://blob.example/a.jpg", undefined);
    expect(payload.engine).toBe("H3");
    expect(payload.negativePrompt).toBe("");
    expect(payload.audioStartSec).toBeUndefined();
  });
});

describe("estimateClipRenderCostUsd", () => {
  it("scales with real duration at 480p's $0.08/s rate, plus $0.01 per reference image", () => {
    expect(estimateClipRenderCostUsd(5, 1)).toBeCloseTo(0.41, 5);
    expect(estimateClipRenderCostUsd(13, 1)).toBeCloseTo(1.05, 5);
    expect(estimateClipRenderCostUsd(15, 1)).toBeCloseTo(1.21, 5);
  });

  it("defaults referenceImageCount to 1 \u2014 a render is always exactly one plate's still now", () => {
    expect(estimateClipRenderCostUsd(5)).toBeCloseTo(estimateClipRenderCostUsd(5, 1), 5);
  });
});

describe("estimateH3ClipRenderCostUsd", () => {
  it("scales with real duration at MiniMax H3's published 768P $0.08/s rate, no per-image surcharge", () => {
    expect(estimateH3ClipRenderCostUsd(5)).toBeCloseTo(0.4, 5);
    expect(estimateH3ClipRenderCostUsd(15)).toBeCloseTo(1.2, 5);
  });

  it("is slightly cheaper than the Grok estimate at the same duration \u2014 no $0.01 reference-image charge", () => {
    expect(estimateH3ClipRenderCostUsd(10)).toBeLessThan(estimateClipRenderCostUsd(10, 1));
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("generateSkidmarksClip", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a real success with the videoUrl/durationSec the route reported", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 13 })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
      durationSec: 13,
    });

    expect(outcome).toEqual({ ok: true, videoUrl: "https://vidgen.x.ai/clip.mp4", durationSec: 13, persisted: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/skidmarks/generate-clip");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
      durationSec: 13,
    });
  });

  it("reports the honest 'unconfigured' outcome for a missing_api_key response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(501, { error: "XAI_API_KEY is not set on the server.", code: "missing_api_key" })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
    });

    expect(outcome).toEqual({ ok: false, unconfigured: true, message: "XAI_API_KEY is not set on the server." });
  });

  it("reports a real failure honestly, distinct from 'unconfigured'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(504, { error: "xAI's video render was still processing after 240s.", code: "timeout" })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
    });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "xAI's video render was still processing after 240s.",
    });
  });

  it("reports a real network error honestly (no fetch success to parse)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
    });

    expect(outcome).toEqual({ ok: false, unconfigured: false, message: "Failed to fetch" });
  });

  it("reports persisted:true and the durable Blob URL when the route says the render was saved", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
        durationSec: 13,
        persisted: true,
      })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "slow push-in zoom",
      shotPrompt: "slow push-in zoom",
      referenceImageDataUrls: ["data:image/jpeg;base64,door"],
      durationSec: 13,
      segmentId: "seg-1",
      plateId: "plate-1",
      clipIndex: 1,
      startSec: 0,
      endSec: 40,
    });

    expect(outcome).toEqual({
      ok: true,
      videoUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/clip-renders/seg-1/plate-1/01_0000-0040_render.mp4",
      durationSec: 13,
      persisted: true,
    });
  });

  it("reports persisted:false plus a plain-language persistError when the route couldn't save the render", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        videoUrl: "https://vidgen.x.ai/clip.mp4",
        durationSec: 5,
        persisted: false,
        persistError: "Vercel Blob: No token found.",
      })
    );

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
      segmentId: "seg-1",
      plateId: "plate-1",
      clipIndex: 1,
      startSec: 0,
      endSec: 40,
    });

    expect(outcome).toEqual({
      ok: true,
      videoUrl: "https://vidgen.x.ai/clip.mp4",
      durationSec: 5,
      persisted: false,
      persistError: "Vercel Blob: No token found.",
    });
  });

  it("reports a real failure if a 200 response is somehow missing videoUrl", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    const outcome = await generateSkidmarksClip({
      prompt: "x",
      shotPrompt: "x",
      referenceImageDataUrls: ["data:image/jpeg;base64,a"],
      durationSec: 5,
    });

    expect(outcome).toEqual({
      ok: false,
      unconfigured: false,
      message: "Clip render succeeded but returned no video.",
    });
  });
});
