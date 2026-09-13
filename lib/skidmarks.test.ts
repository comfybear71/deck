import { beforeEach, describe, expect, it } from "vitest";
import {
  applySkidmarksAnalysisResult,
  applySkidmarksTranscriptionResult,
  attachSkidmarksMp3,
  createMp3Attachment,
  defaultSegmentModel,
  getSkidmarksSnapshot,
  markSkidmarksAnalysisFailed,
  normalizeSkidmarksSegment,
  SKIDMARKS_LOCATION_PLATES,
  SKIDMARKS_MODELS,
  selectSkidmarksBand,
  setSkidmarksSegmentPlate,
  setSkidmarksSegmentShotPrompt,
  shotPromptSuggestsComplexPlacement,
  skidmarksChecklistState,
  type SkidmarksClipSegment,
} from "./skidmarks";
import type { SkidmarksTranscribedWord } from "./transcription";

/**
 * These tests exercise `applySkidmarksTranscriptionResult` — the actual
 * fix for the live bug report (Jack Ash's "Talking To Concrete", ~4:16,
 * real singing from ~0:32) coming back as green Lyrics + a single
 * Instrumental 0:00–4:16 segment. A real STT provider (Whisper, before
 * this PR's ElevenLabs Scribe pivot) returned real, non-empty `words`
 * for that track; the pre-fix code trusted "transcription returned
 * words" as "transcription produced a useful map" and set
 * `segmentsSource: "transcription"`/`transcriptionStatus: "done"`
 * unconditionally — which is exactly how a useless all-Instrumental
 * result got shown as genuinely real. These tests assert the fixed
 * behavior directly against the store, independent of which provider
 * answered.
 *
 * `lib/skidmarks.ts` is a `localStorage`-backed singleton
 * (`cachedState`), but under Vitest's `node` test environment
 * (`vitest.config.ts`) `isBrowser()` is always false, so `persist` only
 * ever touches the in-memory `cachedState` — no real `localStorage`
 * needed, but state *does* persist across tests in this file unless
 * reset. `beforeEach` below re-selects a band and re-attaches a fresh
 * MP3 so each test starts from a known, isolated state.
 */

function word(w: string, startSec: number, endSec: number): SkidmarksTranscribedWord {
  return { word: w, startSec, endSec };
}

const TRACK_DURATION_SEC = 256; // 4:16, matching the confirmed "Talking To Concrete" report

beforeEach(() => {
  selectSkidmarksBand("jack-ash"); // resets session.mp3 to null too
  attachSkidmarksMp3(createMp3Attachment("talking-to-concrete.mp3", TRACK_DURATION_SEC));
});

describe("applySkidmarksTranscriptionResult", () => {
  it("never trusts a real-but-sparse word list as a useful map (the literal reported bug)", () => {
    // Real, non-empty words — but each one sits on its own island past
    // the default 2s gap threshold, so the merged map collapses to a
    // single Instrumental segment covering the whole track, same shape
    // as the live Whisper report against this exact song.
    const scattered: SkidmarksTranscribedWord[] = [];
    for (let t = 32; t < TRACK_DURATION_SEC; t += 4) {
      scattered.push(word(`w${t}`, t, t + 0.3));
    }

    applySkidmarksTranscriptionResult(scattered, null, "elevenlabs");

    let mp3 = getSkidmarksSnapshot().session.mp3;
    expect(mp3?.transcriptionStatus).toBe("sparse");
    // Never labeled as the real transcription source, even though a
    // provider really did respond with real words.
    expect(mp3?.segmentsSource).not.toBe("transcription");
    // The seed-fallback timeline is still whatever was showing before —
    // not silently replaced/downgraded by the sparse result.
    expect(mp3?.segmentsSource).toBe("seed-fallback");
    // The raw words are still kept (for a later per-word pass), and the
    // reason is honest, non-empty, plain language.
    expect(mp3?.words).toHaveLength(scattered.length);
    expect(mp3?.transcriptionError).toBeTruthy();
    expect(mp3?.transcriptionProvider).toBe("elevenlabs");
    // Names the actual provider that ran \u2014 the live bug report's
    // caption ("Transcription returned 28 words...") named no provider
    // at all, so Stuart couldn't tell which backend produced the sparse
    // result from the UI. See lib/transcription.ts's
    // `transcriptionProviderLabel`.
    expect(mp3?.transcriptionError).toContain("ElevenLabs Scribe");

    // Never fake-green: Lyrics reads "analyzing", not "done", while the
    // heuristic is still in flight (`analysisStatus === "analyzing"`) —
    // there's still real work pending, even though transcription itself
    // has already settled as sparse.
    expect(skidmarksChecklistState(mp3 ?? null).lyrics).not.toBe("done");

    // Once the heuristic also settles, Lyrics reads "stub" — never
    // green, and no longer stuck on "analyzing" forever.
    markSkidmarksAnalysisFailed("Analysis took too long and was cancelled.");
    mp3 = getSkidmarksSnapshot().session.mp3;
    expect(skidmarksChecklistState(mp3 ?? null).lyrics).toBe("stub");
  });

  it("does not downgrade an already-landed real heuristic result when transcription turns out sparse", () => {
    applySkidmarksAnalysisResult({
      segments: [
        { startSec: 0, endSec: 31, vocal: false },
        { startSec: 31, endSec: 200, vocal: true },
        { startSec: 200, endSec: TRACK_DURATION_SEC, vocal: false },
      ],
      durationSec: TRACK_DURATION_SEC,
    });
    expect(getSkidmarksSnapshot().session.mp3?.segmentsSource).toBe("analysis");

    const scattered: SkidmarksTranscribedWord[] = [];
    for (let t = 32; t < TRACK_DURATION_SEC; t += 4) {
      scattered.push(word(`w${t}`, t, t + 0.3));
    }
    applySkidmarksTranscriptionResult(scattered, null, "elevenlabs");

    const mp3 = getSkidmarksSnapshot().session.mp3;
    // Still showing the real heuristic output, untouched.
    expect(mp3?.segmentsSource).toBe("analysis");
    expect(mp3?.transcriptionStatus).toBe("sparse");
    expect(mp3?.transcriptionError).toContain("ElevenLabs Scribe");
  });

  it("trusts and promotes a real transcription result with substantial vocal coverage", () => {
    // Confirmed ground truth: real singing from 0:32 through most of
    // the track.
    const words = [word("verse", 32, 200)];

    applySkidmarksTranscriptionResult(words, null, "elevenlabs");

    const mp3 = getSkidmarksSnapshot().session.mp3;
    expect(mp3?.transcriptionStatus).toBe("done");
    expect(mp3?.segmentsSource).toBe("transcription");
    expect(mp3?.transcriptionProvider).toBe("elevenlabs");
    expect(mp3?.transcriptionError).toBeUndefined();
    expect(mp3?.segments.some((s) => s.label === "vocal")).toBe(true);

    const checklist = skidmarksChecklistState(mp3 ?? null);
    expect(checklist.lyrics).toBe("done");
  });

  it("still wins over a real heuristic result once transcription clears the usefulness bar, regardless of arrival order", () => {
    applySkidmarksAnalysisResult({
      segments: [{ startSec: 0, endSec: TRACK_DURATION_SEC, vocal: false }],
      durationSec: TRACK_DURATION_SEC,
    });
    expect(getSkidmarksSnapshot().session.mp3?.segmentsSource).toBe("analysis");

    applySkidmarksTranscriptionResult([word("verse", 32, 200)], null, "elevenlabs");

    expect(getSkidmarksSnapshot().session.mp3?.segmentsSource).toBe("transcription");
  });

  it("keeps the seed fallback honestly labeled if the heuristic later fails after a sparse transcription result", () => {
    const scattered: SkidmarksTranscribedWord[] = [];
    for (let t = 32; t < TRACK_DURATION_SEC; t += 4) {
      scattered.push(word(`w${t}`, t, t + 0.3));
    }
    applySkidmarksTranscriptionResult(scattered, null, "elevenlabs");
    markSkidmarksAnalysisFailed("Analysis took too long and was cancelled.");

    const mp3 = getSkidmarksSnapshot().session.mp3;
    expect(mp3?.segmentsSource).toBe("seed-fallback");
    expect(mp3?.transcriptionStatus).toBe("sparse");
    expect(mp3?.analysisStatus).toBe("failed");

    const checklist = skidmarksChecklistState(mp3 ?? null);
    expect(checklist.lyrics).toBe("stub");
    expect(checklist.ready).not.toBe("done");
  });
});

/**
 * Model-allowlist + automatic-model-assignment tests — Stuart's final
 * chrome lock: LTX/Grok/H3 only (no SIRAY/Kling/Seedance pill), and
 * `model` is derived entirely from a segment's label + `shotPrompt`,
 * never a manual pick.
 */
describe("Stuart's locked model allowlist", () => {
  it("only ever exposes LTX Lip-sync, Grok, and H3 — no SIRAY, Kling, or Seedance", () => {
    expect(SKIDMARKS_MODELS.map((m) => m.id).sort()).toEqual(["grok", "h3", "ltx-lipsync"]);
  });
});

describe("defaultSegmentModel", () => {
  it("always assigns LTX to a vocal segment, regardless of shot prompt content", () => {
    expect(defaultSegmentModel("vocal", "")).toBe("ltx-lipsync");
    expect(defaultSegmentModel("verse", "the artist standing centre stage, posing")).toBe("ltx-lipsync");
    expect(defaultSegmentModel("bridge", "walking through a dancing crowd")).toBe("ltx-lipsync");
  });

  it("defaults an instrumental segment to H3 while the shot prompt is blank or a simple B-roll still", () => {
    expect(defaultSegmentModel("instrumental", "")).toBe("h3");
    expect(defaultSegmentModel("lead", "a red door in an empty hallway")).toBe("h3");
  });

  it("assigns Grok to an instrumental segment once the shot prompt reads as complex artist placement", () => {
    expect(defaultSegmentModel("instrumental", "the singer standing centre stage")).toBe("grok");
    expect(defaultSegmentModel("lead", "the band walking through the crowd")).toBe("grok");
  });
});

describe("shotPromptSuggestsComplexPlacement", () => {
  it("is a case-insensitive substring match against a short keyword list", () => {
    expect(shotPromptSuggestsComplexPlacement("Artist SITTING on an amp")).toBe(true);
    expect(shotPromptSuggestsComplexPlacement("a rusty door swings open in the wind")).toBe(false);
  });
});

describe("setSkidmarksSegmentShotPrompt", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("track.mp3", 120));
  });

  it("keeps a vocal segment on LTX no matter what the shot prompt says", () => {
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    const vocalSegment = mp3.segments.find((s) => s.label === "verse" || s.label === "bridge")!;

    setSkidmarksSegmentShotPrompt(vocalSegment.id, "walking through a crowd, dancing");

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === vocalSegment.id)!;
    expect(updated.model).toBe("ltx-lipsync");
    expect(updated.shotPrompt).toBe("walking through a crowd, dancing");
  });

  it("flips an instrumental segment between H3 and Grok live as the prompt gets more or less complicated", () => {
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    const instrumentalSegment = mp3.segments.find((s) => s.label === "instrumental" || s.label === "lead")!;
    expect(instrumentalSegment.model).toBe("h3"); // blank shot prompt at creation

    setSkidmarksSegmentShotPrompt(instrumentalSegment.id, "the artist standing alone under a spotlight");
    let updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === instrumentalSegment.id)!;
    expect(updated.model).toBe("grok");

    setSkidmarksSegmentShotPrompt(instrumentalSegment.id, "an empty street at dawn");
    updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === instrumentalSegment.id)!;
    expect(updated.model).toBe("h3");
  });
});

describe("setSkidmarksSegmentPlate", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("track.mp3", 120));
  });

  it("is a plain single-select — tapping the same plate again no longer clears it", () => {
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    const segment = mp3.segments[0];

    setSkidmarksSegmentPlate(segment.id, "crowd-pit");
    let updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plateId).toBe("crowd-pit");

    setSkidmarksSegmentPlate(segment.id, "crowd-pit");
    updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plateId).toBe("crowd-pit");
  });
});

describe("normalizeSkidmarksSegment", () => {
  it("never trusts a stored model — recomputes it, so a legacy SIRAY/Kling id can't leak back in", () => {
    const legacy = {
      id: "seg-1",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "kling", // pre-lock id, no longer valid
      plateId: "crowd-pit",
      cameraAngle: "wide", // field removed entirely in this pass
      cameraAngleAuto: false, // field removed entirely in this pass
      plateSubject: "cast", // field removed entirely in this pass
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(legacy);

    expect(normalized.model).toBe("h3"); // instrumental, blank shot prompt → H3
    expect(normalized.plateId).toBe("crowd-pit"); // still a valid plate, passes through
    expect(normalized.shotPrompt).toBe("");
    expect(normalized.uncensoredPlateStills).toBe(false);
    expect(normalized).not.toHaveProperty("cameraAngle");
    expect(normalized).not.toHaveProperty("cameraAngleAuto");
    expect(normalized).not.toHaveProperty("plateSubject");
  });

  it("falls back to the vocal/instrumental default plate when a stored plate id no longer exists", () => {
    const legacy = {
      id: "seg-2",
      startSec: 0,
      endSec: 30,
      label: "vocal",
      model: "siray-uncensored",
      plateId: "some-removed-plate-id",
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(legacy);

    expect(normalized.model).toBe("ltx-lipsync");
    expect(normalized.plateId).toBe("neon-stage");
    expect(SKIDMARKS_LOCATION_PLATES.some((p) => p.id === normalized.plateId)).toBe(true);
  });

  it("preserves a real shot prompt and re-derives model off it rather than trusting the stored model", () => {
    const legacy = {
      id: "seg-3",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "h3",
      plateId: "warehouse",
      shotPrompt: "the band standing together, posing",
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(legacy);

    expect(normalized.shotPrompt).toBe("the band standing together, posing");
    expect(normalized.model).toBe("grok");
  });
});
