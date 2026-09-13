import { beforeEach, describe, expect, it } from "vitest";
import {
  addSkidmarksClipPlate,
  applySkidmarksAnalysisResult,
  applySkidmarksTranscriptionResult,
  attachSkidmarksMp3,
  createMp3Attachment,
  defaultSegmentModel,
  getSkidmarksSessionSyncSnapshot,
  getSkidmarksSnapshot,
  markSkidmarksAnalysisFailed,
  markSkidmarksMp3AudioFailed,
  markSkidmarksMp3AudioUnconfigured,
  MAX_PLATES_PER_CLIP,
  normalizeSkidmarksSegment,
  removeSkidmarksClipPlate,
  resetSkidmarksSessionAfterArchive,
  resolveInstrumentalVideoModel,
  resolveSelectedPlateId,
  restoreSkidmarksArchivedSession,
  shouldApplyHydratedSkidmarksSession,
  SKIDMARKS_MODELS,
  selectSkidmarksBand,
  setSkidmarksClipPlateMotionPrompt,
  setSkidmarksClipPlateStill,
  setSkidmarksMp3AudioUrl,
  setSkidmarksMp3Duration,
  setSkidmarksSegmentInstrumentalVideoModel,
  setSkidmarksSegmentModel,
  setSkidmarksSegmentSelectedPlate,
  setSkidmarksSegmentShotPrompt,
  skidmarksChecklistState,
  subscribeSkidmarksSessionSync,
  type SkidmarksBand,
  type SkidmarksClipPlateSlot,
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

/** The live mp3's own `attachId` — every `apply*Result`/`mark*Failed`
 * resolve callback needs this now (see `SkidmarksMp3Attachment
 * .attachId`'s doc comment), so tests grab it fresh off the store the
 * same way `useSkidmarksStudio.attachMp3` does. */
function currentAttachId(): string {
  return getSkidmarksSnapshot().session.mp3!.attachId;
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

    applySkidmarksTranscriptionResult(currentAttachId(), scattered, null, "elevenlabs");

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
    markSkidmarksAnalysisFailed(currentAttachId(), "Analysis took too long and was cancelled.");
    mp3 = getSkidmarksSnapshot().session.mp3;
    expect(skidmarksChecklistState(mp3 ?? null).lyrics).toBe("stub");
  });

  it("does not downgrade an already-landed real heuristic result when transcription turns out sparse", () => {
    applySkidmarksAnalysisResult(currentAttachId(), {
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
    applySkidmarksTranscriptionResult(currentAttachId(), scattered, null, "elevenlabs");

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

    applySkidmarksTranscriptionResult(currentAttachId(), words, null, "elevenlabs");

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
    applySkidmarksAnalysisResult(currentAttachId(), {
      segments: [{ startSec: 0, endSec: TRACK_DURATION_SEC, vocal: false }],
      durationSec: TRACK_DURATION_SEC,
    });
    expect(getSkidmarksSnapshot().session.mp3?.segmentsSource).toBe("analysis");

    applySkidmarksTranscriptionResult(currentAttachId(), [word("verse", 32, 200)], null, "elevenlabs");

    expect(getSkidmarksSnapshot().session.mp3?.segmentsSource).toBe("transcription");
  });

  it("keeps the seed fallback honestly labeled if the heuristic later fails after a sparse transcription result", () => {
    const scattered: SkidmarksTranscribedWord[] = [];
    for (let t = 32; t < TRACK_DURATION_SEC; t += 4) {
      scattered.push(word(`w${t}`, t, t + 0.3));
    }
    applySkidmarksTranscriptionResult(currentAttachId(), scattered, null, "elevenlabs");
    markSkidmarksAnalysisFailed(currentAttachId(), "Analysis took too long and was cancelled.");

    const mp3 = getSkidmarksSnapshot().session.mp3;
    expect(mp3?.segmentsSource).toBe("seed-fallback");
    expect(mp3?.transcriptionStatus).toBe("sparse");
    expect(mp3?.analysisStatus).toBe("failed");

    const checklist = skidmarksChecklistState(mp3 ?? null);
    expect(checklist.lyrics).toBe("stub");
    expect(checklist.ready).not.toBe("done");
  });

  it("no-ops entirely for a stale attachId \u2014 a slow real transcription call for a since-replaced attach must never land on whatever's live now", () => {
    const staleAttachId = currentAttachId();
    // A brand-new attach (a different song, or the sheet was closed and
    // reopened after re-picking the same file) replaces the live mp3
    // before the slow real STT round-trip for the *previous* attach
    // resolves \u2014 see `SkidmarksMp3Attachment.attachId`'s doc comment.
    attachSkidmarksMp3(createMp3Attachment("a-different-song.mp3", 90));

    applySkidmarksTranscriptionResult(staleAttachId, [word("verse", 32, 200)], null, "elevenlabs");

    const mp3 = getSkidmarksSnapshot().session.mp3!;
    expect(mp3.fileName).toBe("a-different-song.mp3");
    // Still the fresh seed-fallback timeline for the *new* attach \u2014
    // never overwritten by the stale attach's real result.
    expect(mp3.segmentsSource).toBe("seed-fallback");
    expect(mp3.transcriptionStatus).toBe("checking");
  });

  it("never discards plates/prompts Stuart already tagged on the current timeline, even once a slower real transcription result finally lands (the actual '#49 Vocal plates disappeared' / 'clip 1 reverted' bug)", () => {
    // The fast heuristic lands first (real-world: client-side FFT vs. a
    // real network round-trip), giving Stuart a real timeline to tag.
    applySkidmarksAnalysisResult(currentAttachId(), {
      segments: [
        { startSec: 0, endSec: 31, vocal: false },
        { startSec: 31, endSec: 200, vocal: true },
        { startSec: 200, endSec: TRACK_DURATION_SEC, vocal: false },
      ],
      durationSec: TRACK_DURATION_SEC,
    });
    const vocalSegment = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.label === "vocal")!;

    // Stuart tags a door \u2192 keyhole \u2192 Jack strip on that Vocal
    // clip before the slower, "more correct" transcription result lands.
    addSkidmarksClipPlate(vocalSegment.id);
    addSkidmarksClipPlate(vocalSegment.id);
    const tagged = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === vocalSegment.id)!;
    const [door, keyhole, jack] = tagged.plates;
    setSkidmarksClipPlateStill(vocalSegment.id, door.id, {
      dataUrl: "data:image/jpeg;base64,DOOR",
      source: "generated",
      createdAt: 1,
    });
    setSkidmarksClipPlateStill(vocalSegment.id, keyhole.id, {
      dataUrl: "data:image/jpeg;base64,KEYHOLE",
      source: "generated",
      createdAt: 2,
    });
    setSkidmarksClipPlateStill(vocalSegment.id, jack.id, {
      dataUrl: "data:image/jpeg;base64,JACK",
      source: "generated",
      createdAt: 3,
    });
    setSkidmarksSegmentShotPrompt(vocalSegment.id, "door creaks open, then a keyhole, then Jack");

    // Now the slower real transcription finally resolves, with a
    // *different* segmentation (word-level timing rarely matches the
    // heuristic's ranges exactly).
    applySkidmarksTranscriptionResult(
      currentAttachId(),
      [word("verse", 40, 195)],
      null,
      "elevenlabs"
    );

    const mp3 = getSkidmarksSnapshot().session.mp3!;
    // The checklist/caption still honestly reflects that real
    // transcription actually landed and was useful\u2026
    expect(mp3.transcriptionStatus).toBe("done");
    // \u2026but the timeline itself, and every plate on it, survives
    // untouched \u2014 never silently replaced by a fresh, blank
    // re-segmentation.
    expect(mp3.segmentsSource).toBe("analysis");
    expect(mp3.segments).toHaveLength(3);
    const stillThere = mp3.segments.find((s) => s.id === vocalSegment.id)!;
    expect(stillThere.plates).toHaveLength(3);
    expect(stillThere.plates.map((p) => p.still?.dataUrl)).toEqual([
      "data:image/jpeg;base64,DOOR",
      "data:image/jpeg;base64,KEYHOLE",
      "data:image/jpeg;base64,JACK",
    ]);
    expect(stillThere.shotPrompt).toBe("door creaks open, then a keyhole, then Jack");
  });
});

describe("applySkidmarksAnalysisResult (already-tagged guard)", () => {
  it("never discards a plate Stuart already tagged on the seed-fallback timeline once the heuristic finally resolves", () => {
    // Attach fires with seed-fallback segments immediately; Stuart is
    // fast enough to tag the very first clip before the client-side
    // heuristic (normally quick, but never instant) has actually run.
    const seedSegment = getSkidmarksSnapshot().session.mp3!.segments[0];
    setSkidmarksClipPlateStill(seedSegment.id, seedSegment.plates[0].id, {
      dataUrl: "data:image/jpeg;base64,SEEDTAG",
      source: "upload",
      createdAt: 1,
    });

    applySkidmarksAnalysisResult(currentAttachId(), {
      segments: [{ startSec: 0, endSec: TRACK_DURATION_SEC, vocal: true }],
      durationSec: TRACK_DURATION_SEC,
    });

    const mp3 = getSkidmarksSnapshot().session.mp3!;
    // Still honestly marked as having run\u2026
    expect(mp3.analysisStatus).toBe("done");
    // \u2026but the seed timeline (and Stuart's tagged plate on it)
    // survives untouched rather than being replaced by a fresh
    // single-segment rebuild.
    expect(mp3.segmentsSource).toBe("seed-fallback");
    const stillThere = mp3.segments.find((s) => s.id === seedSegment.id)!;
    expect(stillThere.plates[0].still?.dataUrl).toBe("data:image/jpeg;base64,SEEDTAG");
  });
});

/**
 * `setSkidmarksMp3Duration` regression tests — the one remaining
 * silent-rebuild path #51 missed. #51 gated
 * `applySkidmarksAnalysisResult`/`applySkidmarksTranscriptionResult`
 * with `hasSkidmarksUserContent` + `attachId`, but this third
 * post-attach resolve callback (the `<audio>` element's own
 * `loadedmetadata` probe) had neither guard, so it could still
 * unconditionally rebuild `segments` via `buildDemoSegments(durationSec)`
 * whenever `durationSec` was still `null` and `segmentsSource` was still
 * `"seed-fallback"` — exactly the live-QA'd "clip 1 lost again, gone
 * back to another version" report filed after #51+#53 had already
 * landed. These tests attach with `durationSec: null` (real-world:
 * attach always starts this way — see `createMp3Attachment`) to
 * actually exercise the pre-fix rebuild window, which the file's other
 * `beforeEach` (real `TRACK_DURATION_SEC` passed at attach) never did.
 */
describe("setSkidmarksMp3Duration", () => {
  it("still rebuilds the seed-fallback timeline off the real duration the very first time it resolves, when nothing is tagged yet", () => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("talking-to-concrete.mp3", null));
    const attachId = currentAttachId();

    setSkidmarksMp3Duration(attachId, TRACK_DURATION_SEC);

    const mp3 = getSkidmarksSnapshot().session.mp3!;
    expect(mp3.durationSec).toBe(TRACK_DURATION_SEC);
    expect(mp3.segmentsSource).toBe("seed-fallback");
    // Rebuilt off the real total \u2014 the last segment's end now
    // matches the real duration, not the demo fallback's.
    expect(mp3.segments.at(-1)!.endSec).toBe(TRACK_DURATION_SEC);
  });

  it("never discards a plate/prompt Stuart already tagged on the seed-fallback timeline once a deferred duration probe finally resolves (the actual 'clip 1 lost again' regression)", () => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("talking-to-concrete.mp3", null));
    const attachId = currentAttachId();

    // Real-world: iOS Safari can defer an `<audio>` element's
    // `loadedmetadata` well past attach (power-saving media policy —
    // it may not fire until Stuart actually taps Play). Plenty of time
    // to have already tagged clip 1 on the still-null-duration
    // seed-fallback timeline before this ever resolves.
    const clip1 = getSkidmarksSnapshot().session.mp3!.segments[0];
    setSkidmarksClipPlateStill(clip1.id, clip1.plates[0].id, {
      dataUrl: "data:image/jpeg;base64,CLIP1DOOR",
      source: "generated",
      createdAt: 1,
    });
    setSkidmarksSegmentShotPrompt(clip1.id, "door creaks open");
    const taggedSegmentCount = getSkidmarksSnapshot().session.mp3!.segments.length;

    setSkidmarksMp3Duration(attachId, TRACK_DURATION_SEC);

    const mp3 = getSkidmarksSnapshot().session.mp3!;
    // The real duration is still recorded honestly\u2026
    expect(mp3.durationSec).toBe(TRACK_DURATION_SEC);
    // \u2026but `segments` — clip 1 and its tagged plate/prompt —
    // survive untouched instead of being silently replaced by a fresh
    // re-segmentation off the real total.
    expect(mp3.segments).toHaveLength(taggedSegmentCount);
    const stillThere = mp3.segments.find((s) => s.id === clip1.id)!;
    expect(stillThere.plates[0].still?.dataUrl).toBe("data:image/jpeg;base64,CLIP1DOOR");
    expect(stillThere.shotPrompt).toBe("door creaks open");
  });

  it("no-ops entirely for a stale attachId \u2014 a deferred metadata probe for a since-replaced attach must never land on whatever's live now", () => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("talking-to-concrete.mp3", null));
    const staleAttachId = currentAttachId();

    // A new attach (a different song, or the sheet was closed/reopened
    // after re-picking the same file) replaces the live mp3 before the
    // previous attach's deferred `loadedmetadata` fires.
    attachSkidmarksMp3(createMp3Attachment("a-different-song.mp3", null));
    const freshSegmentCount = getSkidmarksSnapshot().session.mp3!.segments.length;

    setSkidmarksMp3Duration(staleAttachId, TRACK_DURATION_SEC);

    const mp3 = getSkidmarksSnapshot().session.mp3!;
    expect(mp3.fileName).toBe("a-different-song.mp3");
    // Still null \u2014 the stale attach's late duration never lands on
    // the new one.
    expect(mp3.durationSec).toBeNull();
    expect(mp3.segments).toHaveLength(freshSegmentCount);
  });

  it("does not rebuild once real analysis/transcription has already replaced the seed timeline", () => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("talking-to-concrete.mp3", null));
    const attachId = currentAttachId();

    applySkidmarksAnalysisResult(attachId, {
      segments: [
        { startSec: 0, endSec: 31, vocal: false },
        { startSec: 31, endSec: 200, vocal: true },
        { startSec: 200, endSec: TRACK_DURATION_SEC, vocal: false },
      ],
      durationSec: TRACK_DURATION_SEC,
    });
    expect(getSkidmarksSnapshot().session.mp3?.segmentsSource).toBe("analysis");
    const analysisSegments = getSkidmarksSnapshot().session.mp3!.segments;

    // A late `loadedmetadata` resolve after real analysis already won.
    setSkidmarksMp3Duration(attachId, TRACK_DURATION_SEC);

    const mp3 = getSkidmarksSnapshot().session.mp3!;
    expect(mp3.segmentsSource).toBe("analysis");
    expect(mp3.segments).toEqual(analysisSegments);
  });
});

/* The four describe blocks that used to sit here —
 * `describeSkidmarksPersistFailure`, `getSkidmarksPersistFailure`,
 * `exceedsSkidmarksStorageWarningThreshold` and
 * `getSkidmarksStorageWarning` — are gone along with the code they
 * covered. All four tested the `localStorage` quota reporting, and
 * `persist()` no longer writes to `localStorage`: the session's
 * durable copy is one Neon row (see `lib/skidmarks.ts`). The
 * session-sync snapshot below is what reports a storage problem now. */

describe("getSkidmarksSessionSyncSnapshot", () => {
  it("starts out reporting a real status rather than pretending a save already succeeded", () => {
    const snapshot = getSkidmarksSessionSyncSnapshot();
    expect(snapshot).toBeTruthy();
    expect(typeof snapshot.status).toBe("string");
    // Whatever the status is, it must be one this app actually handles
    // \u2014 the banner in `SkidmarksDetailSheet` keys off exactly these.
    expect(["loading", "synced", "saving", "unconfigured", "error"]).toContain(snapshot.status);
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

describe("setSkidmarksClipPlateStill", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("track.mp3", 120));
  });

  it("starts every fresh segment with exactly one blank plate slot", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    expect(segment.plates).toHaveLength(1);
    expect(segment.plates[0].still).toBeUndefined();
  });

  it("sets a still (upload or generated) on a plate slot and clears it back to empty with null", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    const plateId = segment.plates[0].id;

    setSkidmarksClipPlateStill(segment.id, plateId, {
      dataUrl: "data:image/jpeg;base64,AAAA",
      source: "upload",
      createdAt: 1000,
    });
    let updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates[0].still).toEqual({
      dataUrl: "data:image/jpeg;base64,AAAA",
      source: "upload",
      createdAt: 1000,
    });

    setSkidmarksClipPlateStill(segment.id, plateId, {
      dataUrl: "data:image/jpeg;base64,BBBB",
      source: "generated",
      createdAt: 2000,
    });
    updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates[0].still).toEqual({
      dataUrl: "data:image/jpeg;base64,BBBB",
      source: "generated",
      createdAt: 2000,
    });

    setSkidmarksClipPlateStill(segment.id, plateId, null);
    updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates[0].still).toBeUndefined();
    // Cleared outright, not just set to `undefined` — matches every
    // other optional field's "unset" shape on this type. The slot itself
    // still exists (this only clears the still, not the slot).
    expect(updated.plates[0]).not.toHaveProperty("still");
    expect(updated.plates).toHaveLength(1);
  });

  it("never touches shotPrompt or model when setting/clearing a plate's still", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    setSkidmarksSegmentShotPrompt(segment.id, "a door creaks open");

    setSkidmarksClipPlateStill(segment.id, segment.plates[0].id, {
      dataUrl: "data:image/jpeg;base64,AAAA",
      source: "upload",
      createdAt: 1000,
    });

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    // Shared per-clip prompt, untouched by a plate-level change.
    expect(updated.shotPrompt).toBe("a door creaks open");
    expect(updated.model).toBe(segment.model);
  });

  it("only ever updates the matching plate id, leaving sibling plates untouched", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    addSkidmarksClipPlate(segment.id);
    const withTwo = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    const [first, second] = withTwo.plates;

    setSkidmarksClipPlateStill(segment.id, second.id, {
      dataUrl: "data:image/jpeg;base64,KEYHOLE",
      source: "generated",
      createdAt: 3000,
    });

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates.find((p) => p.id === first.id)?.still).toBeUndefined();
    expect(updated.plates.find((p) => p.id === second.id)?.still?.dataUrl).toBe(
      "data:image/jpeg;base64,KEYHOLE"
    );
  });
});

describe("addSkidmarksClipPlate / removeSkidmarksClipPlate", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("track.mp3", 120));
  });

  it("appends an empty plate slot per tap, for the door \u2192 keyhole \u2192 Jack case", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];

    addSkidmarksClipPlate(segment.id);
    addSkidmarksClipPlate(segment.id);

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates).toHaveLength(3);
    expect(updated.plates.every((p) => p.still === undefined)).toBe(true);
    // Every slot has its own stable id, even though all three start blank.
    expect(new Set(updated.plates.map((p) => p.id)).size).toBe(3);
  });

  it("caps the strip at MAX_PLATES_PER_CLIP \u2014 further taps no-op", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];

    for (let i = 0; i < MAX_PLATES_PER_CLIP + 3; i++) {
      addSkidmarksClipPlate(segment.id);
    }

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates).toHaveLength(MAX_PLATES_PER_CLIP);
  });

  it("removes an empty plate slot outright", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    addSkidmarksClipPlate(segment.id);
    const withTwo = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    const secondPlateId = withTwo.plates[1].id;

    removeSkidmarksClipPlate(segment.id, secondPlateId);

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates).toHaveLength(1);
    expect(updated.plates.some((p) => p.id === secondPlateId)).toBe(false);
  });

  it("never removes the last remaining plate slot", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    const onlyPlateId = segment.plates[0].id;

    removeSkidmarksClipPlate(segment.id, onlyPlateId);

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates).toHaveLength(1);
    expect(updated.plates[0].id).toBe(onlyPlateId);
  });

  it("never removes a plate slot that already holds a real still", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    addSkidmarksClipPlate(segment.id);
    const withTwo = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    const [first, second] = withTwo.plates;

    setSkidmarksClipPlateStill(segment.id, first.id, {
      dataUrl: "data:image/jpeg;base64,DOOR",
      source: "generated",
      createdAt: 4000,
    });

    removeSkidmarksClipPlate(segment.id, first.id);

    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.plates).toHaveLength(2);
    expect(updated.plates.map((p) => p.id)).toEqual([first.id, second.id]);
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

  it("preserves a valid stored instrumentalVideoModel across a reload, and drops an invalid one", () => {
    const withGrok = {
      id: "seg-h3-1",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
      instrumentalVideoModel: "grok",
    } as unknown as SkidmarksClipSegment;
    expect(normalizeSkidmarksSegment(withGrok).instrumentalVideoModel).toBe("grok");

    const withStale = {
      id: "seg-h3-2",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
      instrumentalVideoModel: "seedance", // never a valid value for this field
    } as unknown as SkidmarksClipSegment;
    expect(normalizeSkidmarksSegment(withStale).instrumentalVideoModel).toBeUndefined();

    const withNone = {
      id: "seg-h3-3",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
    } as unknown as SkidmarksClipSegment;
    expect(normalizeSkidmarksSegment(withNone).instrumentalVideoModel).toBeUndefined();
  });

  it("backfills exactly one blank plate slot for a pre-plate-stills session with no still at all", () => {
    const legacy = {
      id: "seg-5",
      startSec: 0,
      endSec: 30,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(legacy);
    expect(normalized.plates).toHaveLength(1);
    expect(normalized.plates[0].still).toBeUndefined();
    expect(normalized).not.toHaveProperty("still"); // legacy top-level field is gone, not just empty
  });

  it("migrates a pre-multi-plate session's single top-level `still` into the new plates array", () => {
    const withLegacyStill = {
      id: "seg-6",
      startSec: 0,
      endSec: 30,
      label: "vocal",
      model: "ltx-lipsync",
      shotPrompt: "Jack sings under a neon sign",
      still: { dataUrl: "data:image/jpeg;base64,AAAA", source: "generated", createdAt: 12345 },
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(withLegacyStill);
    expect(normalized).not.toHaveProperty("still");
    expect(normalized.plates).toHaveLength(1);
    expect(normalized.plates[0].still).toEqual({
      dataUrl: "data:image/jpeg;base64,AAAA",
      source: "generated",
      createdAt: 12345,
    });
  });

  it("drops a corrupt/malformed legacy top-level `still` rather than trusting it as-is, backfilling one blank slot instead", () => {
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
      } as unknown as SkidmarksClipSegment).plates[0].still
    ).toBeUndefined();

    // Unrecognized `source`.
    expect(
      normalizeSkidmarksSegment({
        ...base,
        still: { dataUrl: "data:image/jpeg;base64,AAAA", source: "ai", createdAt: 1 },
      } as unknown as SkidmarksClipSegment).plates[0].still
    ).toBeUndefined();

    // Missing `createdAt`.
    expect(
      normalizeSkidmarksSegment({
        ...base,
        still: { dataUrl: "data:image/jpeg;base64,AAAA", source: "upload" },
      } as unknown as SkidmarksClipSegment).plates[0].still
    ).toBeUndefined();

    // Not an object at all.
    expect(
      normalizeSkidmarksSegment({ ...base, still: "data:image/jpeg;base64,AAAA" } as unknown as SkidmarksClipSegment)
        .plates[0].still
    ).toBeUndefined();
  });

  it("re-validates a real post-multi-plate session's plates array, keeping valid stills and stable ids", () => {
    const withPlates = {
      id: "seg-8",
      startSec: 0,
      endSec: 40,
      label: "instrumental",
      model: "grok",
      shotPrompt: "door, then keyhole",
      plates: [
        { id: "plate-door", still: { dataUrl: "data:image/jpeg;base64,DOOR", source: "generated", createdAt: 1 } },
        { id: "plate-keyhole" },
      ],
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(withPlates);
    expect(normalized.plates).toHaveLength(2);
    expect(normalized.plates[0]).toEqual({
      id: "plate-door",
      still: { dataUrl: "data:image/jpeg;base64,DOOR", source: "generated", createdAt: 1 },
    });
    expect(normalized.plates[1]).toEqual({ id: "plate-keyhole" });
  });

  it("drops a corrupt still inside a real plates array without dropping the slot itself", () => {
    const withCorruptPlate = {
      id: "seg-9",
      startSec: 0,
      endSec: 40,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
      plates: [{ id: "plate-1", still: { dataUrl: "https://example.com/stale.jpg", source: "upload", createdAt: 1 } }],
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(withCorruptPlate);
    expect(normalized.plates).toHaveLength(1);
    expect(normalized.plates[0]).toEqual({ id: "plate-1" });
  });

  it("backfills one blank slot if a real session's `plates` array is somehow empty", () => {
    const emptyPlates = {
      id: "seg-10",
      startSec: 0,
      endSec: 40,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
      plates: [],
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(emptyPlates);
    expect(normalized.plates).toHaveLength(1);
  });
});

describe("resolveSelectedPlateId", () => {
  function plate(id: string, hasStill: boolean): SkidmarksClipPlateSlot {
    return hasStill
      ? { id, still: { dataUrl: "data:image/jpeg;base64,X", source: "generated", createdAt: 1 } }
      : { id };
  }

  it("returns null when no plate is filled yet", () => {
    expect(resolveSelectedPlateId([plate("a", false), plate("b", false)], null, new Set())).toBeNull();
  });

  it("honors an explicit selection that still points at a filled plate", () => {
    const plates = [plate("a", true), plate("b", true)];
    expect(resolveSelectedPlateId(plates, "b", new Set())).toBe("b");
  });

  it("falls back to the first unrendered filled plate when nothing is explicitly selected", () => {
    const plates = [plate("a", true), plate("b", true)];
    expect(resolveSelectedPlateId(plates, null, new Set(["a"]))).toBe("b");
  });

  it("falls back to the first filled plate when every filled plate already has a render", () => {
    const plates = [plate("a", true), plate("b", true)];
    expect(resolveSelectedPlateId(plates, null, new Set(["a", "b"]))).toBe("a");
  });

  it("ignores a stale selection that no longer points at a currently-filled plate", () => {
    const plates = [plate("a", false), plate("b", true)];
    expect(resolveSelectedPlateId(plates, "a", new Set())).toBe("b");
  });
});

describe("setSkidmarksSegmentSelectedPlate / setSkidmarksClipPlateMotionPrompt", () => {
  it("sets selectedPlateId on the segment", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    const plateId = segment.plates[0].id;
    setSkidmarksSegmentSelectedPlate(segment.id, plateId);
    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.selectedPlateId).toBe(plateId);
  });

  it("sets one specific plate's own motionPrompt without touching any other plate on the same clip", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    addSkidmarksClipPlate(segment.id);
    const refreshed = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    const [first, second] = refreshed.plates;

    setSkidmarksClipPlateMotionPrompt(segment.id, first.id, "slow zoom into keyhole");

    const after = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(after.plates.find((p) => p.id === first.id)?.motionPrompt).toBe("slow zoom into keyhole");
    expect(after.plates.find((p) => p.id === second.id)?.motionPrompt).toBeUndefined();
  });
});

describe("resolveInstrumentalVideoModel", () => {
  it("defaults to h3 \u2014 Stuart's 2026-09-13 lock", () => {
    expect(resolveInstrumentalVideoModel(undefined)).toBe("h3");
    expect(resolveInstrumentalVideoModel(null)).toBe("h3");
    expect(resolveInstrumentalVideoModel("")).toBe("h3");
  });

  it("returns grok only for the literal stored value 'grok'", () => {
    expect(resolveInstrumentalVideoModel("grok")).toBe("grok");
  });

  it("falls back to h3 for any other stored value, including a stale/invalid one", () => {
    expect(resolveInstrumentalVideoModel("h3")).toBe("h3");
    expect(resolveInstrumentalVideoModel("seedance")).toBe("h3");
    expect(resolveInstrumentalVideoModel("ltx-lipsync")).toBe("h3");
  });
});

describe("setSkidmarksSegmentInstrumentalVideoModel", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("track.mp3", 120));
  });

  it("sets instrumentalVideoModel on the segment, and doesn't touch the still-image model field", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    setSkidmarksSegmentInstrumentalVideoModel(segment.id, "grok");
    const updated = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === segment.id)!;
    expect(updated.instrumentalVideoModel).toBe("grok");
    expect(updated.model).toBe(segment.model);
  });

  it("is the only way this field ever changes \u2014 unset until explicitly set", () => {
    const segment = getSkidmarksSnapshot().session.mp3!.segments[0];
    expect(segment.instrumentalVideoModel).toBeUndefined();
  });
});

describe("setSkidmarksMp3AudioUrl / markSkidmarksMp3AudioUnconfigured / markSkidmarksMp3AudioFailed", () => {
  it("records a successful audio upload as a distinct, durable outcome", () => {
    setSkidmarksMp3AudioUrl(currentAttachId(), "https://x.public.blob.vercel-storage.com/a.mp3");
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    expect(mp3.audioUrl).toBe("https://x.public.blob.vercel-storage.com/a.mp3");
    expect(mp3.audioPersistStatus).toBe("done");
    expect(mp3.audioPersistError).toBeUndefined();
  });

  it("records the honest unconfigured outcome distinctly from a real failure", () => {
    markSkidmarksMp3AudioUnconfigured(currentAttachId(), "No Blob store connected here.");
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    expect(mp3.audioPersistStatus).toBe("unconfigured");
    expect(mp3.audioPersistError).toBe("No Blob store connected here.");
    expect(mp3.audioUrl).toBeUndefined();
  });

  it("records a genuine upload failure", () => {
    markSkidmarksMp3AudioFailed(currentAttachId(), "Network error uploading the audio.");
    const mp3 = getSkidmarksSnapshot().session.mp3!;
    expect(mp3.audioPersistStatus).toBe("failed");
    expect(mp3.audioPersistError).toBe("Network error uploading the audio.");
  });

  it("no-ops for a stale attachId that no longer matches the live mp3 (a slow upload for a since-replaced attach)", () => {
    const staleAttachId = currentAttachId();
    // A brand-new attach replaces the live mp3 before the slow upload
    // for the *previous* one resolves.
    attachSkidmarksMp3(createMp3Attachment("newer-track.mp3", 90));

    setSkidmarksMp3AudioUrl(staleAttachId, "https://x.public.blob.vercel-storage.com/stale.mp3");

    const mp3 = getSkidmarksSnapshot().session.mp3!;
    expect(mp3.fileName).toBe("newer-track.mp3");
    expect(mp3.audioUrl).toBeUndefined();
  });
});

describe("restoreSkidmarksArchivedSession / resetSkidmarksSessionAfterArchive", () => {
  it("restores a band + mp3 snapshot into the live session, adding the band back if it's since been removed", () => {
    const band: SkidmarksBand = {
      id: "restored-band",
      name: "Restored Band",
      tagline: "",
      coverSeed: 1,
      editIcon: "pencil",
      members: [],
    };
    const mp3 = createMp3Attachment("restored-song.mp3", 120);

    restoreSkidmarksArchivedSession(band, mp3);

    const state = getSkidmarksSnapshot();
    expect(state.session.projectKind).toBe("music-video");
    expect(state.session.bandId).toBe("restored-band");
    expect(state.session.mp3?.fileName).toBe("restored-song.mp3");
    expect(state.bands.some((b) => b.id === "restored-band")).toBe(true);
  });

  it("replaces an already-present band with the archived snapshot's own copy rather than duplicating it", () => {
    const band: SkidmarksBand = {
      id: "jack-ash",
      name: "Jack Ash (archived copy)",
      tagline: "from the archive",
      coverSeed: 1,
      editIcon: "pencil",
      members: [],
    };
    restoreSkidmarksArchivedSession(band, createMp3Attachment("archived.mp3", 60));

    const state = getSkidmarksSnapshot();
    expect(state.bands.filter((b) => b.id === "jack-ash")).toHaveLength(1);
    expect(state.bands.find((b) => b.id === "jack-ash")?.name).toBe("Jack Ash (archived copy)");
  });

  it("clears the session back to no band/mp3 after archiving, without touching the bands list", () => {
    const bandsBefore = getSkidmarksSnapshot().bands.length;
    resetSkidmarksSessionAfterArchive();
    const state = getSkidmarksSnapshot();
    expect(state.session.bandId).toBeNull();
    expect(state.session.mp3).toBeNull();
    expect(state.bands.length).toBe(bandsBefore);
  });
});

/**
 * `shouldApplyHydratedSkidmarksSession` is the server-backed successor
 * to the same "a slow real result can't clobber real work already in
 * progress" principle `SkidmarksMp3Attachment.attachId`/
 * `hasSkidmarksUserContent` already enforce one layer down — see this
 * module's "Neon-backed session persistence" doc comment. Under
 * Vitest's `node` environment `isBrowser()` is always false, so the
 * actual `fetch`-driven hydrate/push functions never run in this test
 * file; these tests exercise the one pure decision function directly.
 */
describe("shouldApplyHydratedSkidmarksSession", () => {
  it("applies the fetched session when no local edit happened while it was in flight", () => {
    expect(shouldApplyHydratedSkidmarksSession(5, 5)).toBe(true);
  });

  it("discards the fetched session once any local edit landed while it was in flight", () => {
    expect(shouldApplyHydratedSkidmarksSession(5, 6)).toBe(false);
    expect(shouldApplyHydratedSkidmarksSession(0, 3)).toBe(false);
  });
});

describe("Skidmarks session sync status store", () => {
  it("exposes a live snapshot and lets a listener subscribe/unsubscribe without throwing", () => {
    const snapshot = getSkidmarksSessionSyncSnapshot();
    expect(snapshot.status).toBeDefined();
    const unsubscribe = subscribeSkidmarksSessionSync(() => {});
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});
