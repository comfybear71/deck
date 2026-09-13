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
  SKIDMARKS_MODELS,
  selectSkidmarksBand,
  setSkidmarksSegmentModel,
  setSkidmarksSegmentShotPrompt,
  setSkidmarksSegmentStill,
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
 * Model-allowlist + cost-lock tests — Stuart: "be very wary of spend."
 * `SKIDMARKS_MODELS` is LTX/Grok/H3/Seedance (no SIRAY/Kling), but
 * `defaultSegmentModel` — the only auto-assignment path — only ever
 * picks LTX or Grok. H3 and Seedance are real, selectable pills, but
 * only ever land on a segment via an explicit `setSkidmarksSegmentModel`
 * call, never automatically and never by editing the shot prompt.
 */
describe("Stuart's locked model allowlist", () => {
  it("exposes LTX Lip-sync, Grok, H3, and Seedance as selectable pills — no SIRAY or Kling", () => {
    expect(SKIDMARKS_MODELS.map((m) => m.id).sort()).toEqual(["grok", "h3", "ltx-lipsync", "seedance"]);
  });

  it("flags H3 and Seedance as never-auto-assigned/optional, unlike LTX and Grok", () => {
    const byId = Object.fromEntries(SKIDMARKS_MODELS.map((m) => [m.id, m]));
    expect(byId["ltx-lipsync"].note).toBeUndefined();
    expect(byId.grok.note).toBeUndefined();
    expect(byId.h3.note).toBeTruthy();
    expect(byId.seedance.note).toBeTruthy();
  });
});

describe("defaultSegmentModel", () => {
  it("only ever auto-assigns LTX (vocal) or Grok (instrumental) — never H3 or Seedance", () => {
    expect(defaultSegmentModel("vocal")).toBe("ltx-lipsync");
    expect(defaultSegmentModel("verse")).toBe("ltx-lipsync");
    expect(defaultSegmentModel("bridge")).toBe("ltx-lipsync");
    expect(defaultSegmentModel("instrumental")).toBe("grok");
    expect(defaultSegmentModel("lead")).toBe("grok");
  });
});

describe("setSkidmarksSegmentShotPrompt", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("track.mp3", 120));
  });

  it("never touches model, even when the prompt reads like a complicated artist-placement shot", () => {
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    const instrumentalSegment = mp3.segments.find((s) => s.label === "instrumental" || s.label === "lead")!;
    expect(instrumentalSegment.model).toBe("grok"); // auto default, blank prompt

    setSkidmarksSegmentShotPrompt(
      instrumentalSegment.id,
      "the artist standing alone under a spotlight, posing"
    );

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find(
      (s) => s.id === instrumentalSegment.id
    )!;
    // Editing the prompt never silently rotates the clip onto a
    // different (potentially pricier) model — that's the whole point
    // of the cost lock.
    expect(updated.model).toBe("grok");
    expect(updated.shotPrompt).toBe("the artist standing alone under a spotlight, posing");
  });
});

describe("setSkidmarksSegmentModel", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("track.mp3", 120));
  });

  it("is the only way a segment's model ever becomes H3 or Seedance", () => {
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    const segment = mp3.segments.find((s) => s.label === "instrumental" || s.label === "lead")!;
    expect(segment.model).toBe("grok");

    setSkidmarksSegmentModel(segment.id, "seedance");
    let updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.model).toBe("seedance");

    setSkidmarksSegmentModel(segment.id, "h3");
    updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.model).toBe("h3");
  });
});

describe("SEED_BANDS", () => {
  it("seeds Jack Ash's frontman with his locked reference photo, so an identity reference exists from a fresh session", () => {
    const jackAsh = getSkidmarksSnapshot().bands.find((b) => b.id === "jack-ash");
    const frontman = jackAsh?.members.find((m) => m.id === "jack-ash-frontman");
    expect(frontman?.avatarImage).toBe("/skidmarks/jack-ash-reference.jpg");
  });
});

describe("setSkidmarksSegmentStill", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("track.mp3", 120));
  });

  it("sets a still (upload or generated) and clears it back to no still at all with null", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];

    setSkidmarksSegmentStill(segment.id, {
      dataUrl: "data:image/jpeg;base64,AAAA",
      source: "upload",
      createdAt: 1000,
    });
    let updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.still).toEqual({ dataUrl: "data:image/jpeg;base64,AAAA", source: "upload", createdAt: 1000 });

    setSkidmarksSegmentStill(segment.id, {
      dataUrl: "data:image/jpeg;base64,BBBB",
      source: "generated",
      createdAt: 2000,
    });
    updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.still).toEqual({ dataUrl: "data:image/jpeg;base64,BBBB", source: "generated", createdAt: 2000 });

    setSkidmarksSegmentStill(segment.id, null);
    updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.still).toBeUndefined();
    // Cleared outright, not just set to `undefined` — matches every
    // other optional field's "unset" shape on this type.
    expect(updated).not.toHaveProperty("still");
  });

  it("never touches shotPrompt or model when setting/clearing a still", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    setSkidmarksSegmentShotPrompt(segment.id, "a door creaks open");

    setSkidmarksSegmentStill(segment.id, {
      dataUrl: "data:image/jpeg;base64,AAAA",
      source: "upload",
      createdAt: 1000,
    });

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.shotPrompt).toBe("a door creaks open");
    expect(updated.model).toBe(segment.model);
  });
});

describe("normalizeSkidmarksSegment", () => {
  it("remaps a legacy/removed model id (Kling) to the vocal/instrumental default", () => {
    const legacy = {
      id: "seg-1",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "kling", // pre-lock id, no longer valid
      plateId: "crowd-pit", // field removed entirely — the deleted location-plate picker
      cameraAngle: "wide", // field removed entirely in an earlier pass
      cameraAngleAuto: false, // field removed entirely in an earlier pass
      plateSubject: "cast", // field removed entirely in an earlier pass
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(legacy);

    expect(normalized.model).toBe("grok"); // instrumental default — Kling isn't a valid pick anymore
    expect(normalized.shotPrompt).toBe("");
    expect(normalized.uncensoredPlateStills).toBe(false);
    expect(normalized).not.toHaveProperty("plateId");
    expect(normalized).not.toHaveProperty("cameraAngle");
    expect(normalized).not.toHaveProperty("cameraAngleAuto");
    expect(normalized).not.toHaveProperty("plateSubject");
  });

  it("remaps a legacy former-SIRAY model id to the vocal/instrumental default", () => {
    const legacy = {
      id: "seg-2",
      startSec: 0,
      endSec: 30,
      label: "vocal",
      model: "siray-uncensored", // SIRAY used to be a normal clip model; no longer valid
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(legacy);

    expect(normalized.model).toBe("ltx-lipsync");
  });

  it("preserves a still-valid manual model pick (H3/Seedance) across a reload instead of overriding it", () => {
    const h3Legacy = {
      id: "seg-3",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "h3",
      shotPrompt: "the band standing together, posing",
    } as unknown as SkidmarksClipSegment;

    expect(normalizeSkidmarksSegment(h3Legacy).model).toBe("h3");

    const seedanceLegacy = {
      id: "seg-4",
      startSec: 0,
      endSec: 30,
      label: "lead",
      model: "seedance",
      shotPrompt: "",
    } as unknown as SkidmarksClipSegment;

    expect(normalizeSkidmarksSegment(seedanceLegacy).model).toBe("seedance");
  });

  it("has no `still` at all for a pre-plate-stills session, rather than a fabricated placeholder", () => {
    const legacy = {
      id: "seg-5",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
    } as unknown as SkidmarksClipSegment;

    expect(normalizeSkidmarksSegment(legacy).still).toBeUndefined();
    expect(normalizeSkidmarksSegment(legacy)).not.toHaveProperty("still");
  });

  it("preserves a real, valid still across a reload", () => {
    const withStill = {
      id: "seg-6",
      startSec: 0,
      endSec: 30,
      label: "vocal",
      model: "ltx-lipsync",
      shotPrompt: "Jack sings under a neon sign",
      still: { dataUrl: "data:image/jpeg;base64,AAAA", source: "generated", createdAt: 12345 },
    } as unknown as SkidmarksClipSegment;

    expect(normalizeSkidmarksSegment(withStill).still).toEqual({
      dataUrl: "data:image/jpeg;base64,AAAA",
      source: "generated",
      createdAt: 12345,
    });
  });

  it("drops a corrupt/malformed `still` rather than trusting it as-is", () => {
    const base = {
      id: "seg-7",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
    };

    // Not a data: URL (e.g. a stale/expired remote URL that should never
    // have been persisted in the first place).
    expect(
      normalizeSkidmarksSegment({
        ...base,
        still: { dataUrl: "https://example.com/temp.jpg", source: "upload", createdAt: 1 },
      } as unknown as SkidmarksClipSegment).still
    ).toBeUndefined();

    // Unrecognized `source`.
    expect(
      normalizeSkidmarksSegment({
        ...base,
        still: { dataUrl: "data:image/jpeg;base64,AAAA", source: "ai", createdAt: 1 },
      } as unknown as SkidmarksClipSegment).still
    ).toBeUndefined();

    // Missing `createdAt`.
    expect(
      normalizeSkidmarksSegment({
        ...base,
        still: { dataUrl: "data:image/jpeg;base64,AAAA", source: "upload" },
      } as unknown as SkidmarksClipSegment).still
    ).toBeUndefined();

    // Not an object at all.
    expect(
      normalizeSkidmarksSegment({ ...base, still: "data:image/jpeg;base64,AAAA" } as unknown as SkidmarksClipSegment)
        .still
    ).toBeUndefined();
  });
});
