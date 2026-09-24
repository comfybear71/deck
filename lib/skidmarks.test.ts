import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {

  addSkidmarksClipPlate,
  applySkidmarksAnalysisResult,
  applySkidmarksTranscriptionResult,
  attachSkidmarksMp3,
  buildScriptSequenceSegments,
  findMatchingPreviousScriptSegment,
  canNudgeSkidmarksSegmentBoundary,
  createMp3Attachment,
  createSkidmarksBand,
  registerSkidmarksIdentityWipeListener,
  removeSkidmarksBand,
  renameSkidmarksBand,
  resolveChainedPlateTarget,
  setSkidmarksScriptSequence,
  setSkidmarksScriptSequenceDraft,
  defaultSegmentModel,
  getSkidmarksSessionSyncSnapshot,
  getSkidmarksSnapshot,
  markSkidmarksAnalysisFailed,
  markSkidmarksMp3AudioFailed,
  markSkidmarksMp3AudioUnconfigured,
  MAX_PLATES_PER_CLIP,
  MIN_NUDGE_SEGMENT_SEC,
  normalizeSkidmarksSegment,
  nudgeSkidmarksSegmentBoundary,
  nudgeSkidmarksSegmentEnd,
  nudgeSkidmarksSegmentStart,
  parseSkidmarksTimeInput,
  removeSkidmarksClipPlate,
  resetSkidmarksSessionAfterArchive,
  resolveInstrumentalVideoModel,
  sessionHasSubstantiveContent,
  resolveSelectedPlateId,
  restoreSkidmarksArchivedSession,
  SEGMENT_NUDGE_STEP_SEC,
  shouldApplyHydratedSkidmarksSession,
  shouldPushSkidmarksSession,
  isSkidmarksStaleLocalFork,
  resolveSkidmarksHydrationWinner,
  computeSkidmarksArchiveFingerprint,
  isSkidmarksSessionAlreadyArchived,
  markSkidmarksSessionArchived,
  SKIDMARKS_MODELS,
  stripUnsyncableImageBytesForWire,
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
  patchSunnyBanksLive,
  saveSunnyBanksProjectWorkspace,
  deleteSunnyBanksWorkspace,
  type SkidmarksBand,
  type SkidmarksClipPlateSlot,
  type SkidmarksClipSegment,
  type SkidmarksPlateStill,
  type SkidmarksState,
  resolveScriptPartVocal,
  scriptPartTitleKind,
  buildScriptSequenceTextFromSegments,
  resolveScriptSequenceDraftFromArchive
} from "./skidmarks";
import {
  buildDefaultSunnyBanksLive,
  buildSunnyBanksWorkspaceFromLive,
} from "./sunnyBanksWorkspace";
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
 * **The real-world bug this guards against**: #57 switched the durable
 * session copy from `localStorage` to Neon but shipped with no step to
 * carry an existing `localStorage` session into a fresh, empty Neon
 * row \u2014 so on the first real deploy, a phone with six tagged Vocal
 * plates loaded into the pristine seed state, which looked exactly
 * like the plates had been deleted. They hadn't; nothing had ever read
 * them into Neon in the first place. `sessionHasSubstantiveContent` is
 * the pure check `hydrateSkidmarksSessionOnce`'s one-time local-storage
 * recovery path (see `lib/skidmarks.ts`'s `LEGACY_LOCAL_STORAGE_KEY`
 * doc comment) uses to tell "nothing real to protect, safe to recover
 * into" apart from "Stuart already has real content here, don't
 * clobber it."
 */
describe("sessionHasSubstantiveContent", () => {
  const seedBand: SkidmarksBand = {
    id: "jack-ash",
    name: "Jack Ash",
    tagline: "Dirt roads & bad decisions",
    coverSeed: 1,
    editIcon: "pencil",
    members: [],
  };

  function stateWith(overrides: Partial<SkidmarksState>): SkidmarksState {
    return {
      bands: [seedBand],
      session: { projectKind: null, bandId: null, mp3: null, scriptSequenceDraft: null },
      removedSeedBandIds: [],
      sunnyBanks: null,
      ...overrides,
    };
  }

  it("reads false for the pristine seed state \u2014 no real band, no mp3, nothing tagged", () => {
    expect(sessionHasSubstantiveContent(stateWith({}))).toBe(false);
  });

  it("reads true the moment a non-seed band exists, even with nothing else", () => {
    const realBand: SkidmarksBand = { ...seedBand, id: "the-real-band", name: "The Real Band" };
    expect(sessionHasSubstantiveContent(stateWith({ bands: [seedBand, realBand] }))).toBe(true);
  });

  it("reads true once an mp3 is attached, even before any clip is tagged", () => {
    const mp3 = createMp3Attachment("song.mp3", 30);
    expect(
      sessionHasSubstantiveContent(
        stateWith({ session: { projectKind: "music-video", bandId: "jack-ash", mp3, scriptSequenceDraft: null } })
      )
    ).toBe(true);
  });

  it("reads true once a segment carries a real shot prompt \u2014 the actual six-tagged-plates scenario", () => {
    const mp3 = createMp3Attachment("song.mp3", 30);
    mp3.segments = mp3.segments.map((seg, i) => (i === 0 ? { ...seg, shotPrompt: "slow push in, neon lips" } : seg));
    expect(
      sessionHasSubstantiveContent(
        stateWith({ session: { projectKind: "music-video", bandId: "jack-ash", mp3, scriptSequenceDraft: null } })
      )
    ).toBe(true);
  });

  it("removedSeedBandIds alone \u2014 a deleted seed tile \u2014 does not itself count as substantive", () => {
    // Deleting a seed band is a real action, but not one worth
    // recovering *from* localStorage: a fresh Neon row starting with
    // every seed band present is not a loss the way six tagged plates
    // vanishing is. Keeps the recovery path from firing on noise.
    expect(sessionHasSubstantiveContent(stateWith({ removedSeedBandIds: ["jack-ash"] }))).toBe(false);
  });

  it("reads true once a Sunny Banks named workspace card exists", () => {
    const live = buildDefaultSunnyBanksLive();
    expect(
      sessionHasSubstantiveContent(
        stateWith({
          sunnyBanks: {
            live,
            workspaces: [buildSunnyBanksWorkspaceFromLive(live, 1, 1)],
            saveSeq: 1,
          },
        })
      )
    ).toBe(true);
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

    // A `blob:` object URL — only ever valid within the page that
    // created it, never something that should survive a reload.
    expect(
      normalizeSkidmarksSegment({
        ...base,
        still: { dataUrl: "blob:https://deck.aiglitch.app/temp-id", source: "upload", createdAt: 1 },
      } as unknown as SkidmarksClipSegment).plates[0].still
    ).toBeUndefined();

    // Empty dataUrl.
    expect(
      normalizeSkidmarksSegment({
        ...base,
        still: { dataUrl: "", source: "upload", createdAt: 1 },
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
      plates: [{ id: "plate-1", still: { dataUrl: "blob:https://deck.aiglitch.app/stale-id", source: "upload", createdAt: 1 } }],
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(withCorruptPlate);
    expect(normalized.plates).toHaveLength(1);
    expect(normalized.plates[0]).toEqual({ id: "plate-1" });
  });

  it("keeps a real Vercel Blob https:// still — the actual shape lib/plateStillBlob.ts now saves, previously deleted by this exact function on every reload", () => {
    const withBlobStill = {
      id: "seg-11",
      startSec: 0,
      endSec: 40,
      label: "instrumental",
      model: "grok",
      shotPrompt: "",
      plates: [
        {
          id: "plate-1",
          still: {
            dataUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/plate-stills/plate_1.jpg",
            source: "generated",
            createdAt: 1,
            featuresLockedCharacter: true,
          },
        },
      ],
    } as unknown as SkidmarksClipSegment;

    const normalized = normalizeSkidmarksSegment(withBlobStill);
    expect(normalized.plates[0].still).toEqual({
      dataUrl: "https://abc.public.blob.vercel-storage.com/skidmarks/plate-stills/plate_1.jpg",
      source: "generated",
      createdAt: 1,
      featuresLockedCharacter: true,
    });
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

  it("returns siray for the literal stored value 'siray'", () => {
    expect(resolveInstrumentalVideoModel("siray")).toBe("siray");
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

  it("restores the Script Sequence draft from the archive snapshot into the live session", () => {
    const band: SkidmarksBand = {
      id: "draft-band",
      name: "Draft Band",
      tagline: "",
      coverSeed: 1,
      editIcon: "pencil",
      members: [],
    };
    const mp3 = createMp3Attachment("draft-song.mp3", 90);
    const draft = {
      script: "Part 15 (3:00 - 3:15) — Instrumental[Duration: 15s].\nPositive Prompt:\nSTONED\nNegative Prompt:\nblur",
      startingImageUrl: "https://blob.example/p15.jpg",
      chainLastFrameToNext: true,
    };

    restoreSkidmarksArchivedSession(band, mp3, draft);

    const state = getSkidmarksSnapshot();
    expect(state.session.scriptSequenceDraft).toEqual(draft);
    // Fingerprint must include the draft so a Script Sequence-only edit is "changed"
    expect(state.session.mp3?.lastArchivedFingerprint).toBe(
      computeSkidmarksArchiveFingerprint(band, mp3, draft)
    );
  });

  it("rebuilds Script Sequence text from segment prompts when the snapshot has no draft (older archives)", () => {
    const band: SkidmarksBand = {
      id: "legacy-band",
      name: "Legacy Band",
      tagline: "",
      coverSeed: 2,
      editIcon: "pencil",
      members: [],
    };
    const base = createMp3Attachment("legacy.mp3", 30);
    const mp3 = {
      ...base,
      segments: [
        {
          ...base.segments[0],
          id: "seg-legacy-1",
          startSec: 0,
          endSec: 15,
          label: "instrumental" as const,
          shotPrompt: "STONED Part 15 finale glitter rain",
          negativePrompt: "blurry, watermark",
        },
      ],
    };

    restoreSkidmarksArchivedSession(band, mp3, null);

    const draft = getSkidmarksSnapshot().session.scriptSequenceDraft;
    expect(draft).not.toBeNull();
    expect(draft?.script).toContain("STONED Part 15 finale glitter rain");
    expect(draft?.script).toContain("blurry, watermark");
    expect(draft?.script).toContain("Instrumental");
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
 * Stuart's 2026-09-13 hard ask: ElevenLabs Scribe timing is "mostly
 * right but sometimes 3-4 seconds off," so he wants to slip a clip's
 * start/end after transcription without re-running Scribe. These tests
 * exercise `nudgeSkidmarksSegmentBoundary` directly (the pure math, no
 * store) plus the store-level setters, against three contiguous
 * segments spanning a known 30s total — small and hand-checkable
 * rather than reusing `buildDemoSegments`' 7-segment cadence.
 */
function threeContiguousSegments(): SkidmarksClipSegment[] {
  const base = createMp3Attachment("nudge-test.mp3", 30).segments[0];
  return [
    { ...base, id: "seg-a", startSec: 0, endSec: 10 },
    { ...base, id: "seg-b", startSec: 10, endSec: 20 },
    { ...base, id: "seg-c", startSec: 20, endSec: 30 },
  ];
}

/**
 * The header double-tap-to-edit control's own parser
 * (`components/SkidmarksClipTimingHeaderEdit.tsx`) — what Stuart
 * actually types into a time field, turned into whole seconds (or
 * `null`, on which the edit cancels rather than committing anything).
 */
describe("parseSkidmarksTimeInput", () => {
  it("parses m:ss", () => {
    expect(parseSkidmarksTimeInput("1:05")).toBe(65);
    expect(parseSkidmarksTimeInput("0:32")).toBe(32);
  });

  it("doesn't require zero-padded seconds", () => {
    expect(parseSkidmarksTimeInput("1:5")).toBe(65);
  });

  it("accepts multi-digit minutes", () => {
    expect(parseSkidmarksTimeInput("12:34")).toBe(12 * 60 + 34);
  });

  it("accepts a bare seconds value with no colon", () => {
    expect(parseSkidmarksTimeInput("65")).toBe(65);
    expect(parseSkidmarksTimeInput("0")).toBe(0);
  });

  it("rounds a decimal seconds value", () => {
    expect(parseSkidmarksTimeInput("12.6")).toBe(13);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSkidmarksTimeInput("  1:05  ")).toBe(65);
  });

  it("rejects an out-of-range seconds part (e.g. 1:65) rather than guessing", () => {
    expect(parseSkidmarksTimeInput("1:65")).toBeNull();
  });

  it("rejects empty text and garbage without throwing", () => {
    expect(parseSkidmarksTimeInput("")).toBeNull();
    expect(parseSkidmarksTimeInput("   ")).toBeNull();
    expect(parseSkidmarksTimeInput("abc")).toBeNull();
    expect(parseSkidmarksTimeInput("1:2:3")).toBeNull();
    expect(parseSkidmarksTimeInput("-5")).toBeNull();
  });
});

describe("nudgeSkidmarksSegmentBoundary", () => {
  it("moves a middle clip's start earlier and shrinks the previous clip's end by the same amount", () => {
    const segments = threeContiguousSegments();
    const next = nudgeSkidmarksSegmentBoundary(segments, "seg-b", "start", -3, 30);
    expect(next.find((s) => s.id === "seg-b")?.startSec).toBe(7);
    expect(next.find((s) => s.id === "seg-a")?.endSec).toBe(7);
    // The far clip is never touched by a nudge two clips away.
    expect(next.find((s) => s.id === "seg-c")).toEqual(segments[2]);
  });

  it("moves a middle clip's end later and stretches the next clip's start by the same amount", () => {
    const segments = threeContiguousSegments();
    const next = nudgeSkidmarksSegmentBoundary(segments, "seg-b", "end", 4, 30);
    expect(next.find((s) => s.id === "seg-b")?.endSec).toBe(24);
    expect(next.find((s) => s.id === "seg-c")?.startSec).toBe(24);
    expect(next.find((s) => s.id === "seg-a")).toEqual(segments[0]);
  });

  it("never produces a gap or an overlap across the whole timeline after a nudge", () => {
    const segments = threeContiguousSegments();
    const next = nudgeSkidmarksSegmentBoundary(segments, "seg-b", "start", 3, 30);
    for (let i = 0; i < next.length - 1; i++) {
      expect(next[i].endSec).toBe(next[i + 1].startSec);
    }
    expect(next[0].startSec).toBe(0);
    expect(next[next.length - 1].endSec).toBe(30);
  });

  it("clamps the very first clip's start at 0, never going negative", () => {
    const segments = threeContiguousSegments();
    const next = nudgeSkidmarksSegmentBoundary(segments, "seg-a", "start", -5, 30);
    expect(next.find((s) => s.id === "seg-a")?.startSec).toBe(0);
  });

  it("clamps the very last clip's end at the song's own known duration", () => {
    const segments = threeContiguousSegments();
    const next = nudgeSkidmarksSegmentBoundary(segments, "seg-c", "end", 5, 30);
    expect(next.find((s) => s.id === "seg-c")?.endSec).toBe(30);
  });

  it("lets the last clip's end nudge freely later while the song duration is still unknown", () => {
    const segments = threeContiguousSegments();
    const next = nudgeSkidmarksSegmentBoundary(segments, "seg-c", "end", 5, null);
    expect(next.find((s) => s.id === "seg-c")?.endSec).toBe(35);
  });

  it(`never lets a nudge shrink either side of the moved boundary below MIN_NUDGE_SEGMENT_SEC (${MIN_NUDGE_SEGMENT_SEC}s)`, () => {
    const segments = threeContiguousSegments();
    // seg-b is 10s long (10\u201320); pushing its start almost all the
    // way to its own end must stop MIN_NUDGE_SEGMENT_SEC short of it.
    const next = nudgeSkidmarksSegmentBoundary(segments, "seg-b", "start", 9.5, 30);
    const b = next.find((s) => s.id === "seg-b")!;
    expect(b.endSec - b.startSec).toBeGreaterThanOrEqual(MIN_NUDGE_SEGMENT_SEC);

    const shrunkPrev = nudgeSkidmarksSegmentBoundary(segments, "seg-a", "start", 9.5, 30);
    const a = shrunkPrev.find((s) => s.id === "seg-a")!;
    // seg-a starts at 0, nudging its own start later shrinks seg-a
    // itself \u2014 same floor applies to the clip being nudged, not
    // just its neighbor.
    expect(a.endSec - a.startSec).toBeGreaterThanOrEqual(MIN_NUDGE_SEGMENT_SEC);
  });

  it("returns the exact same array reference for an unknown segment id (a true no-op)", () => {
    const segments = threeContiguousSegments();
    expect(nudgeSkidmarksSegmentBoundary(segments, "not-a-real-id", "start", 1, 30)).toBe(segments);
  });

  it("returns the exact same array reference once a boundary is already sitting at its clamp", () => {
    const segments = threeContiguousSegments();
    const atZero = nudgeSkidmarksSegmentBoundary(segments, "seg-a", "start", -1, 30);
    expect(atZero).toBe(segments); // already 0, can't go lower
    expect(nudgeSkidmarksSegmentBoundary(segments, "seg-c", "end", 1, 30)).toBe(segments); // already at total
  });

  it("treats a zero delta as a no-op", () => {
    const segments = threeContiguousSegments();
    expect(nudgeSkidmarksSegmentBoundary(segments, "seg-b", "start", 0, 30)).toBe(segments);
  });
});

describe("canNudgeSkidmarksSegmentBoundary", () => {
  it("mirrors nudgeSkidmarksSegmentBoundary's own no-op detection", () => {
    const segments = threeContiguousSegments();
    expect(canNudgeSkidmarksSegmentBoundary(segments, "seg-a", "start", -SEGMENT_NUDGE_STEP_SEC, 30)).toBe(
      false
    );
    expect(canNudgeSkidmarksSegmentBoundary(segments, "seg-a", "start", SEGMENT_NUDGE_STEP_SEC, 30)).toBe(
      true
    );
    expect(canNudgeSkidmarksSegmentBoundary(segments, "seg-c", "end", SEGMENT_NUDGE_STEP_SEC, 30)).toBe(
      false
    );
    expect(canNudgeSkidmarksSegmentBoundary(segments, "seg-c", "end", -SEGMENT_NUDGE_STEP_SEC, 30)).toBe(
      true
    );
  });
});

describe("nudgeSkidmarksSegmentStart / nudgeSkidmarksSegmentEnd (store-level)", () => {
  beforeEach(() => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("nudge-store-test.mp3", 210));
  });

  it("edits only the nudged clip's start and its immediate predecessor's end, leaving every other segment untouched", () => {
    const before = getSkidmarksSnapshot().session.mp3!.segments;
    const target = before[2]; // a real seed-cadence boundary, not the very first clip
    const untouchedIds = before.filter((s) => s.id !== target.id && s.id !== before[1].id).map((s) => s.id);

    nudgeSkidmarksSegmentStart(target.id, -SEGMENT_NUDGE_STEP_SEC);

    const after = getSkidmarksSnapshot().session.mp3!.segments;
    const updatedTarget = after.find((s) => s.id === target.id)!;
    const updatedPrev = after.find((s) => s.id === before[1].id)!;
    expect(updatedTarget.startSec).toBe(target.startSec - SEGMENT_NUDGE_STEP_SEC);
    expect(updatedPrev.endSec).toBe(before[1].endSec - SEGMENT_NUDGE_STEP_SEC);
    for (const id of untouchedIds) {
      expect(after.find((s) => s.id === id)).toEqual(before.find((s) => s.id === id));
    }
  });

  it("edits only the nudged clip's end and its immediate successor's start", () => {
    const before = getSkidmarksSnapshot().session.mp3!.segments;
    const target = before[2];
    const next = before[3];

    nudgeSkidmarksSegmentEnd(target.id, SEGMENT_NUDGE_STEP_SEC);

    const after = getSkidmarksSnapshot().session.mp3!.segments;
    expect(after.find((s) => s.id === target.id)?.endSec).toBe(target.endSec + SEGMENT_NUDGE_STEP_SEC);
    expect(after.find((s) => s.id === next.id)?.startSec).toBe(next.startSec + SEGMENT_NUDGE_STEP_SEC);
  });

  it("never touches segmentsSource, transcriptionStatus, or analysisStatus \u2014 a nudge is purely local, never a re-run of Scribe/the heuristic", () => {
    const mp3Before = getSkidmarksSnapshot().session.mp3!;
    const target = mp3Before.segments[2];

    nudgeSkidmarksSegmentStart(target.id, -SEGMENT_NUDGE_STEP_SEC);
    nudgeSkidmarksSegmentEnd(target.id, SEGMENT_NUDGE_STEP_SEC);

    const mp3After = getSkidmarksSnapshot().session.mp3!;
    expect(mp3After.segmentsSource).toBe(mp3Before.segmentsSource);
    expect(mp3After.transcriptionStatus).toBe(mp3Before.transcriptionStatus);
    expect(mp3After.analysisStatus).toBe(mp3Before.analysisStatus);
  });

  it("never touches a clip's plates, shotPrompt, or model", () => {
    const before = getSkidmarksSnapshot().session.mp3!.segments;
    const target = before[2];
    setSkidmarksSegmentShotPrompt(target.id, "a door creaks open");

    nudgeSkidmarksSegmentStart(target.id, -SEGMENT_NUDGE_STEP_SEC);

    const after = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === target.id)!;
    expect(after.shotPrompt).toBe("a door creaks open");
    expect(after.model).toBe(target.model);
    expect(after.plates).toEqual(target.plates);
  });

  it("clamps the last clip's end nudge at the mp3's own probed durationSec", () => {
    const before = getSkidmarksSnapshot().session.mp3!.segments;
    const last = before[before.length - 1];
    expect(last.endSec).toBe(210);

    nudgeSkidmarksSegmentEnd(last.id, SEGMENT_NUDGE_STEP_SEC);

    const after = getSkidmarksSnapshot().session.mp3!.segments.find((s) => s.id === last.id)!;
    expect(after.endSec).toBe(210); // no-op, already at the song's own end
  });

  it("no-ops without throwing when there's no attached mp3", () => {
    resetSkidmarksSessionAfterArchive();
    expect(() => nudgeSkidmarksSegmentStart("whatever", 1)).not.toThrow();
    expect(() => nudgeSkidmarksSegmentEnd("whatever", 1)).not.toThrow();
    expect(getSkidmarksSnapshot().session.mp3).toBeNull();
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

/**
 * `shouldPushSkidmarksSession` — real, confirmed data-loss case
 * (2026-09-16): once this page load has ever seen a real session, a
 * push must never be allowed to overwrite Neon with a thin/seed-only
 * state, no matter how `cachedState` ended up that way. See
 * `pushSkidmarksSessionNow`'s use of this guard.
 */
describe("shouldPushSkidmarksSession", () => {
  it("allows the push before this page load has ever seen a real session (the ordinary first-save case)", () => {
    expect(shouldPushSkidmarksSession(false, false)).toBe(true);
    expect(shouldPushSkidmarksSession(false, true)).toBe(true);
  });

  it("allows the push once a real session has been seen, as long as what's being pushed is still substantive", () => {
    expect(shouldPushSkidmarksSession(true, true)).toBe(true);
  });

  it("real reported disaster (2026-09-16): refuses the push once a real session has been seen but the current state has gone thin", () => {
    expect(shouldPushSkidmarksSession(true, false)).toBe(false);
  });
});

/**
 * `stripUnsyncableImageBytesForWire` — the hard "session JSON carries
 * URLs only, never image bytes" backstop (2026-09-16 direct
 * instruction), for whenever `migrateInlineSessionImagesToBlob`'s own
 * upload-and-swap couldn't clear an inline `data:` URL before a push.
 */
describe("stripUnsyncableImageBytesForWire", () => {
  const seedBand: SkidmarksBand = {
    id: "jack-ash",
    name: "Jack Ash",
    tagline: "Dirt roads & bad decisions",
    coverSeed: 1,
    editIcon: "pencil",
    members: [],
  };

  function stateWith(overrides: Partial<SkidmarksState>): SkidmarksState {
    return {
      bands: [seedBand],
      session: { projectKind: null, bandId: null, mp3: null, scriptSequenceDraft: null },
      removedSeedBandIds: [],
      sunnyBanks: null,
      ...overrides,
    };
  }

  it("returns the same state unchanged (same reference) when nothing inline is present", () => {
    const state = stateWith({});
    expect(stripUnsyncableImageBytesForWire(state)).toBe(state);
  });

  it("strips an inline data: URL band cover image, leaving a real URL cover image untouched", () => {
    const withDataCover = stateWith({ bands: [{ ...seedBand, coverImage: "data:image/jpeg;base64,abc123" }] });
    expect(stripUnsyncableImageBytesForWire(withDataCover).bands[0].coverImage).toBeUndefined();

    const withRealCover = stateWith({ bands: [{ ...seedBand, coverImage: "https://blob.example/cover.jpg" }] });
    expect(stripUnsyncableImageBytesForWire(withRealCover).bands[0].coverImage).toBe("https://blob.example/cover.jpg");
  });

  it("strips an inline data: URL member avatar", () => {
    const withDataAvatar = stateWith({
      bands: [
        {
          ...seedBand,
          members: [{ id: "m1", name: "Jack Ash", emoji: "🎤", looks: [], avatarImage: "data:image/jpeg;base64,xyz" }],
        },
      ],
    });
    expect(stripUnsyncableImageBytesForWire(withDataAvatar).bands[0].members[0].avatarImage).toBeUndefined();
  });

  it("strips an inline data: URL plate still, never a real Blob URL one", () => {
    const mp3 = createMp3Attachment("song.mp3", 30);
    mp3.segments[0].plates[0].still = { dataUrl: "data:image/jpeg;base64,plate", source: "upload", createdAt: 1 };
    const withDataStill = stateWith({
      session: { projectKind: "music-video", bandId: "jack-ash", mp3, scriptSequenceDraft: null },
    });
    const stripped = stripUnsyncableImageBytesForWire(withDataStill);
    expect(stripped.session.mp3?.segments[0].plates[0].still).toBeUndefined();

    const mp3Real = createMp3Attachment("song.mp3", 30);
    mp3Real.segments[0].plates[0].still = { dataUrl: "https://blob.example/plate.jpg", source: "upload", createdAt: 1 };
    const withRealStill = stateWith({
      session: { projectKind: "music-video", bandId: "jack-ash", mp3: mp3Real, scriptSequenceDraft: null },
    });
    expect(stripUnsyncableImageBytesForWire(withRealStill).session.mp3?.segments[0].plates[0].still?.dataUrl).toBe(
      "https://blob.example/plate.jpg"
    );
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

describe("createSkidmarksBand / renameSkidmarksBand", () => {
  it("real reported bug: tapping New used to always re-mint the same hand-filled demo band; it must now start genuinely blank", () => {
    const band = createSkidmarksBand();
    expect(band.name).toBe("");
    expect(band.tagline).toBe("");
    expect(band.members).toEqual([]);
  });

  it("mints a fresh id each time, so two taps of New never collide", () => {
    const first = createSkidmarksBand();
    const second = createSkidmarksBand();
    expect(first.id).not.toBe(second.id);
  });

  it("selects the newly created band and clears any attached mp3", () => {
    const band = createSkidmarksBand();
    const snapshot = getSkidmarksSnapshot();
    expect(snapshot.session.bandId).toBe(band.id);
    expect(snapshot.session.mp3).toBeNull();
  });

  it("renameSkidmarksBand sets (and trims) the band's name, leaving other bands untouched", () => {
    const band = createSkidmarksBand();
    renameSkidmarksBand(band.id, "  Grok Bot & the Destroyers  ");
    const renamed = getSkidmarksSnapshot().bands.find((b) => b.id === band.id);
    expect(renamed?.name).toBe("Grok Bot & the Destroyers");
    const jackAsh = getSkidmarksSnapshot().bands.find((b) => b.id === "jack-ash");
    expect(jackAsh?.name).not.toBe("Grok Bot & the Destroyers");
  });
});

/**
 * The pure "which plate, if any, should chain from a just-finished
 * render" decision behind Stuart's real ask (2026-09-14): the last frame
 * of one Grok clip becomes the first frame of the next, all the way
 * through the whole song. `SkidmarksDetailSheet.tsx`'s `handlePersisted`
 * is the only real caller — it does the actual frame extraction/upload
 * once this says where (if anywhere) the result belongs.
 */
function plateStill(overrides: Partial<SkidmarksPlateStill> = {}): SkidmarksPlateStill {
  return { dataUrl: "https://blob.example/still.jpg", source: "generated", createdAt: 1, ...overrides };
}

function chainSegment(overrides: Partial<SkidmarksClipSegment> & { id: string; plates: SkidmarksClipPlateSlot[] }): SkidmarksClipSegment {
  return {
    startSec: 0,
    endSec: 10,
    label: "verse",
    model: "grok",
    shotPrompt: "",
    negativePrompt: "",
    uncensoredPlateStills: false,
    selectedPlateId: null,
    ...overrides,
  };
}

describe("resolveChainedPlateTarget", () => {
  it("real reported ask: chains a rendered clip's next segment onto its still-empty first plate", () => {
    const segments = [
      chainSegment({ id: "seg-a", plates: [{ id: "plate-a1", still: plateStill() }] }),
      chainSegment({ id: "seg-b", plates: [{ id: "plate-b1" }] }),
    ];
    const target = resolveChainedPlateTarget(segments, "seg-a", "plate-a1");
    expect(target).toEqual({ segmentId: "seg-b", plateId: "plate-b1", featuresLockedCharacter: false });
  });

  it("never overwrites a plate that already has a still — automatic or not", () => {
    const segments = [
      chainSegment({ id: "seg-a", plates: [{ id: "plate-a1", still: plateStill() }] }),
      chainSegment({ id: "seg-b", plates: [{ id: "plate-b1", still: plateStill({ source: "upload" }) }] }),
    ];
    expect(resolveChainedPlateTarget(segments, "seg-a", "plate-a1")).toBeUndefined();
  });

  it("does nothing off the last segment in the song — there's nothing to chain into", () => {
    const segments = [chainSegment({ id: "seg-a", plates: [{ id: "plate-a1", still: plateStill() }] })];
    expect(resolveChainedPlateTarget(segments, "seg-a", "plate-a1")).toBeUndefined();
  });

  it("does nothing for a render whose segment isn't found (a stale/mismatched record)", () => {
    const segments = [
      chainSegment({ id: "seg-a", plates: [{ id: "plate-a1", still: plateStill() }] }),
      chainSegment({ id: "seg-b", plates: [{ id: "plate-b1" }] }),
    ];
    expect(resolveChainedPlateTarget(segments, "seg-does-not-exist", "plate-a1")).toBeUndefined();
  });

  it("does nothing when the next segment has no plate slots at all", () => {
    const segments = [
      chainSegment({ id: "seg-a", plates: [{ id: "plate-a1", still: plateStill() }] }),
      chainSegment({ id: "seg-b", plates: [] }),
    ];
    expect(resolveChainedPlateTarget(segments, "seg-a", "plate-a1")).toBeUndefined();
  });

  it("carries a locked character's identity forward when the rendered plate itself already featured them", () => {
    const segments = [
      chainSegment({
        id: "seg-a",
        plates: [{ id: "plate-a1", still: plateStill({ featuresLockedCharacter: true }) }],
      }),
      chainSegment({ id: "seg-b", plates: [{ id: "plate-b1" }] }),
    ];
    const target = resolveChainedPlateTarget(segments, "seg-a", "plate-a1");
    expect(target?.featuresLockedCharacter).toBe(true);
  });

  it("targets only the next segment's *first* plate, even when the rendered clip had several", () => {
    const segments = [
      chainSegment({
        id: "seg-a",
        plates: [
          { id: "plate-a1", still: plateStill() },
          { id: "plate-a2", still: plateStill() },
        ],
      }),
      chainSegment({ id: "seg-b", plates: [{ id: "plate-b1" }, { id: "plate-b2" }] }),
    ];
    const target = resolveChainedPlateTarget(segments, "seg-a", "plate-a2");
    expect(target?.plateId).toBe("plate-b1");
  });
});

describe("buildScriptSequenceSegments / setSkidmarksScriptSequence", () => {
  it("real reported ask: turns each parsed script part into one clip with exactly one blank plate, Instrumental/Grok when nothing in the real song says otherwise", () => {
    const segments = buildScriptSequenceSegments(
      [
        { index: 1, title: "The Liquid Horizon", startSec: 0, endSec: 15, prompt: "Molten glass." },
        { index: 2, title: "The Mercury Vortex", startSec: 15, endSec: 30, prompt: "Swirling vortex." },
      ],
      []
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      startSec: 0,
      endSec: 15,
      label: "instrumental",
      model: "grok",
      instrumentalVideoModel: "grok",
      shotPrompt: "Molten glass.",
    });
    expect(segments[0].plates).toHaveLength(1);
    expect(segments[0].plates[0].still).toBeUndefined();
  });

  it("mints a fresh segment id for each part when there is nothing to re-attach, so two empty builds never collide", () => {
    const parts = [{ index: 1, title: "A", startSec: 0, endSec: 15, prompt: "x" }];
    const first = buildScriptSequenceSegments(parts, []);
    const second = buildScriptSequenceSegments(parts, []);
    expect(first[0].id).not.toBe(second[0].id);
  });

  it("live bug (2026-09-19): remint after script grows re-attaches plated ranges by time — keeps ids/stills, blanks only new parts", () => {
    const plated = buildScriptSequenceSegments(
      [
        { index: 1, title: "Intro", startSec: 0, endSec: 10, prompt: "old-1" },
        { index: 2, title: "Vocal", startSec: 10, endSec: 20, prompt: "old-2" },
        { index: 3, title: "Instrumental", startSec: 20, endSec: 30, prompt: "old-3" },
        { index: 4, title: "Vocal", startSec: 30, endSec: 40, prompt: "old-4" },
        { index: 5, title: "Bridge", startSec: 40, endSec: 50, prompt: "old-5" },
        { index: 6, title: "Outro", startSec: 50, endSec: 60, prompt: "old-6" },
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
              dataUrl: `https://blob.example/plate-${i + 1}.jpg`,
              source: "generated",
              createdAt: i + 1,
            },
          },
        ],
      };
    }

    const grownParts = [
      ...[0, 10, 20, 30, 40, 50].map((start, i) => ({
        index: i + 1,
        title: `Part ${i + 1}`,
        startSec: start,
        endSec: start + 10,
        prompt: `new-${i + 1}`,
      })),
      ...Array.from({ length: 19 }, (_, j) => {
        const start = 60 + j * 10;
        return {
          index: j + 7,
          title: `Part ${j + 7}`,
          startSec: start,
          endSec: start + 10,
          prompt: `new-${j + 7}`,
        };
      }),
    ];

    const reminted = buildScriptSequenceSegments(grownParts, plated);
    expect(reminted).toHaveLength(25);

    for (let i = 0; i < 6; i++) {
      expect(reminted[i].id).toBe(plated[i].id);
      expect(reminted[i].plates[0].id).toBe(plated[i].plates[0].id);
      expect(reminted[i].plates[0].still?.dataUrl).toBe(`https://blob.example/plate-${i + 1}.jpg`);
      expect(reminted[i].shotPrompt).toBe(`new-${i + 1}`);
    }
    for (let i = 6; i < 25; i++) {
      expect(reminted[i].plates[0].still).toBeUndefined();
      expect(plated.every((p) => p.id !== reminted[i].id)).toBe(true);
    }
  });

  it("never reuses the same previous segment twice when two new parts could match it", () => {
    const previous = buildScriptSequenceSegments(
      [{ index: 1, title: "A", startSec: 0, endSec: 10, prompt: "old" }],
      []
    );
    previous[0] = {
      ...previous[0],
      plates: [{ id: previous[0].plates[0].id, still: plateStill({ dataUrl: "https://blob.example/only-once.jpg" }) }],
    };
    // Two parts share startSec 0 — only the first should carry the still.
    const reminted = buildScriptSequenceSegments(
      [
        { index: 1, title: "A", startSec: 0, endSec: 10, prompt: "a" },
        { index: 2, title: "B", startSec: 0, endSec: 5, prompt: "b" },
      ],
      previous
    );
    expect(reminted[0].plates[0].still?.dataUrl).toBe("https://blob.example/only-once.jpg");
    expect(reminted[0].id).toBe(previous[0].id);
    expect(reminted[1].plates[0].still).toBeUndefined();
    expect(reminted[1].id).not.toBe(previous[0].id);
  });

  it("findMatchingPreviousScriptSegment prefers exact start/end over index", () => {
    const previous = [
      chainSegment({ id: "early", startSec: 0, endSec: 10, plates: [{ id: "p0" }] }),
      chainSegment({ id: "mid", startSec: 10, endSec: 20, plates: [{ id: "p1" }] }),
    ];
    const used = new Set<string>();
    const match = findMatchingPreviousScriptSegment(previous, { startSec: 10, endSec: 20 }, 0, used);
    expect(match?.id).toBe("mid");
  });

  it("every built segment spans exactly [startSec, endSec) with one plate — the real 15s enforcement, not just prompt text", () => {
    const segments = buildScriptSequenceSegments(
      [
        { index: 1, title: "A", startSec: 0, endSec: 15, prompt: "x" },
        { index: 2, title: "B", startSec: 15, endSec: 30, prompt: "y" },
      ],
      []
    );
    for (const segment of segments) {
      expect(segment.endSec - segment.startSec).toBe(15);
      expect(segment.plates).toHaveLength(1);
    }
  });

  it("setSkidmarksScriptSequence replaces the attached song's segments wholesale", () => {
    selectSkidmarksBand("jack-ash");
    attachSkidmarksMp3(createMp3Attachment("liquid-horizon.mp3", 240));
    const segments = buildScriptSequenceSegments([{ index: 1, title: "A", startSec: 0, endSec: 15, prompt: "x" }], []);
    setSkidmarksScriptSequence(segments);
    const snapshot = getSkidmarksSnapshot();
    expect(snapshot.session.mp3?.segments).toEqual(segments);
    expect(snapshot.session.mp3?.segmentsSource).toBe("seed-fallback");
  });

  it("is a safe no-op when no mp3 is attached yet, rather than inventing one", () => {
    selectSkidmarksBand("jack-ash"); // resets session.mp3 to null
    const segments = buildScriptSequenceSegments([{ index: 1, title: "A", startSec: 0, endSec: 15, prompt: "x" }], []);
    expect(() => setSkidmarksScriptSequence(segments)).not.toThrow();
    expect(getSkidmarksSnapshot().session.mp3).toBeNull();
  });

  describe("real reported gap (2026-09-14): a part landing on real singing must route Vocal/LTX, not get forced to Grok", () => {
    it("routes a part to Vocal/LTX when its midpoint falls inside a real Vocal segment", () => {
      const realSegments = [
        chainSegment({ id: "real-a", startSec: 0, endSec: 15, label: "instrumental", plates: [] }),
        chainSegment({ id: "real-b", startSec: 15, endSec: 30, label: "vocal", plates: [] }),
      ];
      const segments = buildScriptSequenceSegments(
        [
          { index: 1, title: "A", startSec: 0, endSec: 15, prompt: "x" },
          { index: 2, title: "B", startSec: 15, endSec: 30, prompt: "y" },
        ],
        realSegments
      );
      expect(segments[0]).toMatchObject({ label: "instrumental", model: "grok", instrumentalVideoModel: "grok" });
      expect(segments[1]).toMatchObject({ label: "vocal", model: "ltx-lipsync" });
      expect(segments[1].instrumentalVideoModel).toBeUndefined();
    });

    it("recognizes every real label the song's own analysis can produce, not just the literal 'vocal' one (verse/bridge are vocal too)", () => {
      const realSegments = [chainSegment({ id: "real-a", startSec: 0, endSec: 15, label: "verse", plates: [] })];
      const segments = buildScriptSequenceSegments([{ index: 1, title: "A", startSec: 0, endSec: 15, prompt: "x" }], realSegments);
      expect(segments[0].label).toBe("vocal");
    });

    it("defaults to Instrumental when no real segment covers a part's midpoint, rather than guessing Vocal", () => {
      const realSegments = [chainSegment({ id: "real-a", startSec: 0, endSec: 15, label: "vocal", plates: [] })];
      // This part starts past the end of the one real segment above.
      const segments = buildScriptSequenceSegments([{ index: 1, title: "A", startSec: 100, endSec: 115, prompt: "x" }], realSegments);
      expect(segments[0].label).toBe("instrumental");
    });

    it("defaults to Instrumental for a brand-new project with no real song segments at all", () => {
      const segments = buildScriptSequenceSegments([{ index: 1, title: "A", startSec: 0, endSec: 15, prompt: "x" }], []);
      expect(segments[0].label).toBe("instrumental");
    });
  });
});

describe("buildScriptSequenceTextFromSegments / resolveScriptSequenceDraftFromArchive", () => {
  it("returns empty string when no segment has prompts", () => {
    const mp3 = createMp3Attachment("empty.mp3", 30);
    expect(buildScriptSequenceTextFromSegments(mp3.segments)).toBe("");
  });

  it("prefers the snapshot draft over rebuilding from segments", () => {
    const mp3 = createMp3Attachment("song.mp3", 30);
    const snapshotDraft = { script: "from snapshot", startingImageUrl: "https://x/a.jpg" };
    expect(resolveScriptSequenceDraftFromArchive(snapshotDraft, mp3)).toEqual(snapshotDraft);
  });
});

describe("setSkidmarksScriptSequenceDraft", () => {
  it("real reported ask (2026-09-14): survives what a component unmount/reload would otherwise lose", () => {
    setSkidmarksScriptSequenceDraft({ script: "Part 1 (0:00 - 0:15) — A[Duration: 15s]. x", startingImageUrl: "https://blob.example/clip1.jpg" });
    expect(getSkidmarksSnapshot().session.scriptSequenceDraft).toEqual({
      script: "Part 1 (0:00 - 0:15) — A[Duration: 15s]. x",
      startingImageUrl: "https://blob.example/clip1.jpg",
    });
  });

  it("null clears it outright", () => {
    setSkidmarksScriptSequenceDraft({ script: "something", startingImageUrl: "https://blob.example/x.jpg" });
    setSkidmarksScriptSequenceDraft(null);
    expect(getSkidmarksSnapshot().session.scriptSequenceDraft).toBeNull();
  });

  it("replaces wholesale, not merged — clearing just the image means passing the script back too", () => {
    setSkidmarksScriptSequenceDraft({ script: "kept text", startingImageUrl: "https://blob.example/x.jpg" });
    setSkidmarksScriptSequenceDraft({ script: "kept text", startingImageUrl: undefined });
    expect(getSkidmarksSnapshot().session.scriptSequenceDraft).toEqual({ script: "kept text" });
  });

  it("a band switch clears a stale draft — a different song's leftover script/image must never leak into a newly-selected band", () => {
    setSkidmarksScriptSequenceDraft({ script: "old band's script", startingImageUrl: "https://blob.example/old.jpg" });
    selectSkidmarksBand("solar-rebel");
    expect(getSkidmarksSnapshot().session.scriptSequenceDraft).toBeNull();
  });

  it("creating a brand-new band also clears a stale draft, same reasoning", () => {
    setSkidmarksScriptSequenceDraft({ script: "old band's script" });
    createSkidmarksBand();
    expect(getSkidmarksSnapshot().session.scriptSequenceDraft).toBeNull();
  });
});

/**
 * `resolveSkidmarksHydrationWinner` — the audit's known failure mode #3
 * (app boots, Neon loads, a tap during the load used to discard the
 * real row, then the next push overwrote it with seed state).
 */
describe("resolveSkidmarksHydrationWinner", () => {
  const base = {
    editedDuringLoad: false,
    localIsSubstantive: true,
    localUnsynced: false,
    localSavedAt: 1000,
    remoteIsSubstantive: true,
    remoteUpdatedAt: 2000,
    // No revisions on either side: a mirror written before 2026-09-18,
    // so these cases still exercise the original clock tie-break.
    localRevision: null,
    remoteRevision: null,
  };

  it("audit failure mode #3: a real Neon row always beats a seed-only local state, even after a tap during the load", () => {
    expect(resolveSkidmarksHydrationWinner({ ...base, localIsSubstantive: false, editedDuringLoad: true })).toBe("remote");
    expect(resolveSkidmarksHydrationWinner({ ...base, localIsSubstantive: false })).toBe("remote");
  });

  it("keeps local when a real edit landed while the load was in flight", () => {
    expect(resolveSkidmarksHydrationWinner({ ...base, editedDuringLoad: true })).toBe("local");
  });

  it("keeps local when the mirror still holds work Neon never confirmed, whatever the clocks say", () => {
    expect(resolveSkidmarksHydrationWinner({ ...base, localUnsynced: true, localSavedAt: 1, remoteUpdatedAt: 999999 })).toBe("local");
  });

  it("keeps local when its own timestamp is newer than Neon's, or Neon's is unknown", () => {
    expect(resolveSkidmarksHydrationWinner({ ...base, localSavedAt: 3000 })).toBe("local");
    expect(resolveSkidmarksHydrationWinner({ ...base, remoteUpdatedAt: null })).toBe("local");
  });

  it("takes Neon's copy on an ordinary clean reopen (synced mirror, Neon at least as fresh)", () => {
    expect(resolveSkidmarksHydrationWinner(base)).toBe("remote");
    expect(resolveSkidmarksHydrationWinner({ ...base, localSavedAt: null })).toBe("remote");
  });

  it("with nothing real in Neon, keeps whatever real session this phone has", () => {
    expect(resolveSkidmarksHydrationWinner({ ...base, remoteIsSubstantive: false })).toBe("local");
    expect(resolveSkidmarksHydrationWinner({ ...base, remoteIsSubstantive: false, localIsSubstantive: false })).toBe("remote");
  });

  /** The reported 2026-09-18 failure: episodes are built on the phone,
   * then opened on a PC purely to download them for Resolve — and the
   * PC showed an older copy. Revisions are server-assigned and
   * monotonic, so once both sides know one there is nothing to guess. */
  describe("exact revision comparison (2026-09-18)", () => {
    const withRevisions = { ...base, localRevision: 4, remoteRevision: 9 };

    it("a device built from an older revision takes the server's copy, whatever the clocks say", () => {
      // The clock tie-break kept local here — and a second machine is
      // exactly where two clocks disagree.
      expect(
        resolveSkidmarksHydrationWinner({ ...withRevisions, localSavedAt: 9_999_999, remoteUpdatedAt: 1 })
      ).toBe("remote");
    });

    it("keeps local when it is level with the row it last saw", () => {
      expect(resolveSkidmarksHydrationWinner({ ...withRevisions, localRevision: 9 })).toBe("local");
    });

    it("still keeps local when it holds edits the server never took, even against a newer row", () => {
      // Silently dropping unsent work to show a newer copy would just
      // be a different kind of data loss.
      expect(resolveSkidmarksHydrationWinner({ ...withRevisions, localUnsynced: true })).toBe("local");
    });

    it("falls back to the clock tie-break when either side has no revision", () => {
      expect(resolveSkidmarksHydrationWinner({ ...withRevisions, localRevision: null })).toBe("remote");
      expect(resolveSkidmarksHydrationWinner({ ...withRevisions, remoteRevision: null, localSavedAt: 3000 })).toBe(
        "local"
      );
    });
  });

  describe("isSkidmarksStaleLocalFork", () => {
    it("flags the one case the winner cannot resolve without discarding someone's work", () => {
      expect(isSkidmarksStaleLocalFork({ ...base, localUnsynced: true, localRevision: 4, remoteRevision: 9 })).toBe(
        true
      );
    });

    it("is not a fork when this device is merely behind with nothing unsent", () => {
      expect(isSkidmarksStaleLocalFork({ ...base, localRevision: 4, remoteRevision: 9 })).toBe(false);
    });

    it("is not a fork when this device is level with or ahead of the row", () => {
      expect(isSkidmarksStaleLocalFork({ ...base, localUnsynced: true, localRevision: 9, remoteRevision: 9 })).toBe(
        false
      );
    });

    it("never guesses a fork from clocks when a revision is missing", () => {
      expect(
        isSkidmarksStaleLocalFork({ ...base, localUnsynced: true, localRevision: null, remoteRevision: 9 })
      ).toBe(false);
    });
  });
});

/**
 * Archive fingerprint — "Archive does not mean delete" (audit L3) and
 * no duplicate rows for an unchanged song.
 */
describe("archive fingerprint", () => {
  it("is stable for the same band+mp3 and ignores its own stored value", () => {
    const state = getSkidmarksSnapshot();
    const band = state.bands.find((b) => b.id === state.session.bandId)!;
    const mp3 = state.session.mp3!;
    const fp = computeSkidmarksArchiveFingerprint(band, mp3);
    expect(fp).toBe(computeSkidmarksArchiveFingerprint(band, { ...mp3, lastArchivedFingerprint: fp }));
    expect(fp).not.toBe(computeSkidmarksArchiveFingerprint({ ...band, name: "Renamed" }, mp3));
  });

  it("markSkidmarksSessionArchived records the checkpoint, and any later edit un-marks it", () => {
    const before = getSkidmarksSnapshot();
    const band = before.bands.find((b) => b.id === before.session.bandId)!;
    const mp3 = before.session.mp3!;
    expect(isSkidmarksSessionAlreadyArchived(band, mp3)).toBe(false);

    markSkidmarksSessionArchived(mp3.attachId, computeSkidmarksArchiveFingerprint(band, mp3));
    const marked = getSkidmarksSnapshot().session.mp3!;
    expect(isSkidmarksSessionAlreadyArchived(band, marked)).toBe(true);

    setSkidmarksMp3Duration(marked.attachId, 123);
    const edited = getSkidmarksSnapshot().session.mp3!;
    expect(isSkidmarksSessionAlreadyArchived(band, edited)).toBe(false);
  });

  it("ignores a late mark for an mp3 that is no longer the live one", () => {
    const before = getSkidmarksSnapshot();
    const band = before.bands.find((b) => b.id === before.session.bandId)!;
    const mp3 = before.session.mp3!;
    markSkidmarksSessionArchived("some-other-attach", computeSkidmarksArchiveFingerprint(band, mp3));
    expect(getSkidmarksSnapshot().session.mp3!.lastArchivedFingerprint).toBeUndefined();
  });

  it("restoring an archived song marks it as already on the shelf, so leaving it again never duplicates the row", () => {
    const before = getSkidmarksSnapshot();
    const band = before.bands.find((b) => b.id === before.session.bandId)!;
    const mp3 = before.session.mp3!;
    restoreSkidmarksArchivedSession(band, mp3);
    const restored = getSkidmarksSnapshot();
    expect(isSkidmarksSessionAlreadyArchived(band, restored.session.mp3!)).toBe(true);
  });
});

describe("Sunny Banks Neon workspace persist", () => {
  it("saves every act on one card and keeps the live copy after that card is deleted", () => {
    patchSunnyBanksLive((live) => ({
      ...live,
      activeAct: "III",
      actScripts: { ...live.actScripts, III: `${live.actScripts.III}\nCrowd:` },
    }));
    saveSunnyBanksProjectWorkspace();
    const saved = getSkidmarksSnapshot().sunnyBanks;
    expect(saved?.workspaces).toHaveLength(1);
    expect(saved?.workspaces[0].actIds).toEqual(["I", "II", "III"]);
    expect(saved?.workspaces[0].actScripts.I.length).toBeGreaterThan(0);
    expect(saved?.workspaces[0].actScripts.III).toContain("Crowd:");
    expect(saved?.live.activeAct).toBe("III");

    const id = saved!.workspaces[0].id;
    deleteSunnyBanksWorkspace(id);
    const afterDelete = getSkidmarksSnapshot().sunnyBanks;
    expect(afterDelete?.workspaces).toHaveLength(0);
    expect(afterDelete?.live.actScripts.III).toContain("Crowd:");
    expect(afterDelete?.live.activeAct).toBe("III");
  });

  it("re-saving the same episode name keeps one whole-episode card", () => {
    patchSunnyBanksLive((live) => ({ ...live, activeAct: "II" }));
    saveSunnyBanksProjectWorkspace();
    patchSunnyBanksLive((live) => ({ ...live, activeAct: "I" }));
    saveSunnyBanksProjectWorkspace();
    const cards = getSkidmarksSnapshot().sunnyBanks?.workspaces ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0].actIds).toEqual(["I", "II", "III"]);
    expect(cards[0].actScripts.II.length).toBeGreaterThan(0);
  });
});

/**
 * Identity-safe song-render rule 2: "switching band / member / song must
 * clear chained stills, last-plate flags, and plate cache." Every
 * session-changing entry point already replaces `session.mp3` wholesale
 * (never merges it) — which is where every plate still, continuity flag,
 * and chained frame actually lives — so the real thing left to verify is
 * that each of these entry points also fires the
 * `registerSkidmarksIdentityWipeListener` signal that state living
 * *outside* `SkidmarksState` (`lib/plateLocation.ts`'s in-memory place-
 * still cache) depends on. See `lib/plateLocation.test.ts` for the
 * cross-module integration test that a real band/song switch actually
 * clears that cache.
 *
 * Deliberately never removes a *seed* band here (`jack-ash`/`solar-rebel`)
 * — `removeSkidmarksBand` on a seed band permanently records it in
 * `removedSeedBandIds`, which would silently break this whole file's
 * shared `beforeEach` (`selectSkidmarksBand("jack-ash")`) for every test
 * that runs afterward. `createSkidmarksBand`'s own fresh "New" band is
 * used instead, and every test restores the active band back to a seed
 * before finishing.
 */
describe("identity-context wipe signal (rule 2: band/song switches clear identity-adjacent state)", () => {
  afterEach(() => {
    // Always leave the shared fixture band active for the rest of the file's `beforeEach`.
    selectSkidmarksBand("jack-ash");
  });

  it("selectSkidmarksBand notifies every registered identity-wipe listener", () => {
    let calls = 0;
    registerSkidmarksIdentityWipeListener(() => {
      calls += 1;
    });
    selectSkidmarksBand("solar-rebel");
    expect(calls).toBe(1);
  });

  it("createSkidmarksBand (a fresh artist) notifies every registered identity-wipe listener", () => {
    let calls = 0;
    registerSkidmarksIdentityWipeListener(() => {
      calls += 1;
    });
    createSkidmarksBand();
    expect(calls).toBe(1);
  });

  it("attachSkidmarksMp3 (a new song) notifies every registered identity-wipe listener too", () => {
    selectSkidmarksBand("solar-rebel");
    let calls = 0;
    registerSkidmarksIdentityWipeListener(() => {
      calls += 1;
    });
    attachSkidmarksMp3(createMp3Attachment("a-new-song.mp3", 120));
    expect(calls).toBe(1);
  });

  it("removeSkidmarksBand only notifies when the removed band was the active one", () => {
    const created = createSkidmarksBand(); // becomes active; its own createSkidmarksBand notify already fired
    let calls = 0;
    registerSkidmarksIdentityWipeListener(() => {
      calls += 1;
    });

    selectSkidmarksBand("jack-ash"); // switches away from `created` (+1)
    expect(calls).toBe(1);
    removeSkidmarksBand(created.id); // no longer active — nothing to wipe
    expect(calls).toBe(1);

    const activeOne = createSkidmarksBand(); // active again (+1)
    expect(calls).toBe(2);
    removeSkidmarksBand(activeOne.id); // this IS the active band — wipes (+1)
    expect(calls).toBe(3);
  });

  it("a band switch really does delete every plate still — mp3/segments are replaced wholesale, not merged", () => {
    addSkidmarksClipPlate(getSkidmarksSnapshot().session.mp3!.segments[0].id);
    setSkidmarksClipPlateStill(
      getSkidmarksSnapshot().session.mp3!.segments[0].id,
      getSkidmarksSnapshot().session.mp3!.segments[0].plates[0].id,
      { dataUrl: "data:image/jpeg;base64,someArtist", source: "generated", createdAt: 1 }
    );
    expect(getSkidmarksSnapshot().session.mp3!.segments[0].plates[0].still?.dataUrl).toBe(
      "data:image/jpeg;base64,someArtist"
    );

    selectSkidmarksBand("solar-rebel");

    expect(getSkidmarksSnapshot().session.mp3).toBeNull();
  });
});


describe("scriptPartTitleKind / resolveScriptPartVocal title override", () => {
  // Product rule: pasted part titles own vocal/instrumental routing.
  // Audio midpoint must not flip a titled Vocal/Intro/etc.

  function instrumentalSeg(startSec: number, endSec: number) {
    return {
      id: `seg_${startSec}`,
      startSec,
      endSec,
      label: "instrumental" as const,
      model: "grok" as const,
      shotPrompt: "",
      negativePrompt: "",
      uncensoredPlateStills: false,
      plates: [{ id: "p1" }],
      selectedPlateId: null,
    };
  }
  function vocalSeg(startSec: number, endSec: number) {
    return {
      ...instrumentalSeg(startSec, endSec),
      label: "vocal" as const,
      model: "ltx-lipsync" as const,
    };
  }

  it('title "Vocal" → vocal even when realSegments say instrumental', () => {
    const real = [instrumentalSeg(0, 60)];
    expect(
      resolveScriptPartVocal({ startSec: 10, endSec: 20, title: "Part 3 — Vocal" }, real)
    ).toBe(true);
    expect(scriptPartTitleKind("Part 3 — Vocal")).toBe("vocal");
  });

  it('title "Intro" → instrumental even when realSegments say vocal', () => {
    const real = [vocalSeg(0, 60)];
    expect(
      resolveScriptPartVocal({ startSec: 0, endSec: 15, title: "Part 1 — Intro" }, real)
    ).toBe(false);
    expect(scriptPartTitleKind("Part 1 — Intro")).toBe("instrumental");
  });

  it('title with no type word → audio midpoint fallback', () => {
    const real = [vocalSeg(0, 30), instrumentalSeg(30, 60)];
    expect(
      resolveScriptPartVocal(
        { startSec: 5, endSec: 15, title: "A thought comes to mind" },
        real
      )
    ).toBe(true);
    expect(
      resolveScriptPartVocal(
        { startSec: 35, endSec: 45, title: "A thought comes to mind" },
        real
      )
    ).toBe(false);
    expect(scriptPartTitleKind("A thought comes to mind")).toBeNull();
  });
});
