import { describe, expect, it } from "vitest";
import { segmentsFromWords, type SkidmarksTranscribedWord } from "./transcription";

/**
 * `segmentsFromWords` is the pure, network-free half of
 * `lib/transcription.ts` — turning a flat word-timestamp list into
 * vocal/instrumental runs. `transcribeAudio` itself (the actual fetch to
 * `/api/skidmarks/transcribe`) isn't exercised here; that needs a real
 * server + `OPENAI_API_KEY` to mean anything, and is exactly the "we
 * don't have Stuart's real key/track in this repo" caveat called out in
 * the PR description.
 *
 * Most fixtures below use wide word spans (well over the 5s
 * `MIN_SEGMENT_SEC` shared with `lib/audioAnalysis.ts`'s
 * `mergeTinySegments`) so the behavior under test — gap merging/
 * splitting — isn't incidentally erased by that separate "fold away
 * anything too short to trust" pass. The one test that deliberately
 * exercises that interaction says so explicitly.
 */

function word(w: string, startSec: number, endSec: number): SkidmarksTranscribedWord {
  return { word: w, startSec, endSec };
}

describe("segmentsFromWords", () => {
  it("returns one instrumental segment for an empty word list", () => {
    expect(segmentsFromWords([], 60)).toEqual([{ startSec: 0, endSec: 60, vocal: false }]);
  });

  it("treats a leading silence before the first word as instrumental", () => {
    // Models Stuart's actual bug report: vocals start ~0:32 on "Talking
    // To Concrete", not at 0:00 — a real leading gap should read as its
    // own Instrumental section, not get swallowed into the first Vocal
    // run.
    const words = [word("verse", 32, 40)];
    const segments = segmentsFromWords(words, 60);

    expect(segments).toEqual([
      { startSec: 0, endSec: 32, vocal: false },
      { startSec: 32, endSec: 40, vocal: true },
      { startSec: 40, endSec: 60, vocal: false },
    ]);
  });

  it("merges consecutive words with small gaps into one vocal run", () => {
    const words = [
      word("one", 10, 10.3),
      word("two", 10.4, 10.7), // 0.1s gap — well under the 2s default threshold
      word("three", 11.0, 15.5), // 0.3s gap
    ];
    const segments = segmentsFromWords(words, 60);

    expect(segments).toEqual([
      { startSec: 0, endSec: 10, vocal: false },
      { startSec: 10, endSec: 15.5, vocal: true },
      { startSec: 15.5, endSec: 60, vocal: false },
    ]);
  });

  it("splits into separate vocal runs across a gap bigger than the threshold", () => {
    // A ~72s instrumental break (well past Stuart's confirmed ~13s
    // "Talking To Concrete" flute break) should cut the transcript into
    // two runs, not one long one bridging it.
    const words = [word("verse", 32, 40), word("chorus", 112, 120)];
    const segments = segmentsFromWords(words, 200);

    expect(segments).toEqual([
      { startSec: 0, endSec: 32, vocal: false },
      { startSec: 32, endSec: 40, vocal: true },
      { startSec: 40, endSec: 112, vocal: false },
      { startSec: 112, endSec: 120, vocal: true },
      { startSec: 120, endSec: 200, vocal: false },
    ]);
  });

  it("does not split on a short pause well under the gap threshold", () => {
    // A ~1.2s breath between phrases (under the 2s default) should stay
    // one continuous vocal run.
    const words = [word("phrase", 10, 10.5), word("continues", 11.7, 16)];
    const segments = segmentsFromWords(words, 60);

    const vocalSegments = segments.filter((s) => s.vocal);
    expect(vocalSegments).toEqual([{ startSec: 10, endSec: 16, vocal: true }]);
  });

  it("respects a custom, larger gap threshold by bridging a gap the default would split on", () => {
    const words = [word("one", 10, 20), word("two", 26, 36)]; // 6s gap

    // Default (2s) threshold: 6s clears it, so this splits into two runs
    // with a real (>=5s, so it survives the min-segment fold too)
    // instrumental gap between them.
    const defaultSegments = segmentsFromWords(words, 80);
    expect(defaultSegments.filter((s) => s.vocal)).toHaveLength(2);

    // A custom 10s threshold doesn't clear on a 6s gap, so the two runs
    // (and the gap between them) merge into one continuous vocal run.
    const bridgedSegments = segmentsFromWords(words, 80, 10);
    expect(bridgedSegments.filter((s) => s.vocal)).toEqual([{ startSec: 10, endSec: 36, vocal: true }]);
  });

  it("stretches the final segment to fit when the last word ends after the reported total duration", () => {
    const words = [word("late", 58, 61)]; // ends after a reported 60s total
    const segments = segmentsFromWords(words, 60);
    const last = segments[segments.length - 1];
    expect(last.endSec).toBe(61);
  });

  it("sorts out-of-order words before segmenting", () => {
    const words = [word("second", 30, 38), word("first", 10, 18)];
    const segments = segmentsFromWords(words, 60);

    const vocalSegments = segments.filter((s) => s.vocal);
    expect(vocalSegments).toEqual([
      { startSec: 10, endSec: 18, vocal: true },
      { startSec: 30, endSec: 38, vocal: true },
    ]);
  });

  it("suppresses an isolated single-word blip too short to trust as its own section", () => {
    // Mirrors lib/audioAnalysis.test.ts's own "false-ish vocal blip"
    // case: a single ~0.3s transcribed word surrounded by long silence
    // is exactly the kind of sliver `mergeTinySegments`
    // (`MIN_SEGMENT_SEC`, shared with the energy heuristic) exists to
    // fold away rather than surface as its own tiny Vocal row.
    const words = [word("quick", 1, 1.3)];
    const segments = segmentsFromWords(words, 30);
    expect(segments).toEqual([{ startSec: 0, endSec: 30, vocal: false }]);
  });
});
