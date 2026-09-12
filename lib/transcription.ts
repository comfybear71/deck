/**
 * Client-side half of Skidmarks' real speech-to-text pass — the "phone
 * dictation" word-timing signal Stuart asked for after the energy
 * heuristic (`lib/audioAnalysis.ts`) glued Jack Ash's "Talking To
 * Concrete" intro + flute into one giant Vocal segment. **This is genuine
 * transcription, not another heuristic**: it POSTs the attached MP3
 * `File` to `app/api/skidmarks/transcribe/route.ts`, which forwards it to
 * OpenAI's Whisper transcription API (`whisper-1`, `verbose_json` +
 * `timestamp_granularities: ["word"]`) using the server-side
 * `OPENAI_API_KEY` environment variable and returns real per-word
 * start/end times.
 *
 * **Honesty contract**: `transcribeAudio` never pretends to have
 * transcribed anything it didn't. If the server has no key configured it
 * returns `{ ok: false, unconfigured: true }` — a distinct, expected
 * "not wired up here" outcome, not an error — so `useSkidmarksStudio` can
 * label the fallback (`lib/audioAnalysis.ts`'s heuristic, or the seed
 * cadence) honestly instead of implying transcription was attempted and
 * failed. A genuine request failure (network error, bad audio, upstream
 * API error) instead returns `{ ok: false, unconfigured: false }` with a
 * real reason string, surfaced verbatim by `SkidmarksClipTimeline`'s
 * caption.
 *
 * **Priority order once results land** (`lib/skidmarks.ts`): real
 * transcription > the energy heuristic > the seed cadence. Both real
 * signals run in parallel from the moment a file's attached (see
 * `useSkidmarksStudio.attachMp3`) since transcription needs a network
 * round-trip and the energy heuristic doesn't; whichever finishes first
 * shows immediately, and a later-arriving transcription result still
 * wins over an already-displayed heuristic one. The energy heuristic
 * never gets turned off by this — it's the answer whenever a key isn't
 * configured or the request fails, per the product ask to keep it as a
 * real fallback, not a maybe-it-works stub.
 */

import { mergeTinySegments, type VocalAnalysisSegment } from "./audioAnalysis";

export interface SkidmarksTranscribedWord {
  word: string;
  startSec: number;
  endSec: number;
}

export interface TranscriptionSuccess {
  words: SkidmarksTranscribedWord[];
  /** Whisper's own reported duration, if the response included one —
   * only used as a last-resort fallback; `lib/skidmarks.ts` prefers the
   * browser's own probed `durationSec` when it's already known. */
  durationSec: number | null;
}

export type TranscriptionOutcome =
  | { ok: true; result: TranscriptionSuccess }
  | { ok: false; unconfigured: true; message: string }
  | { ok: false; unconfigured: false; message: string };

const TRANSCRIBE_ENDPOINT = "/api/skidmarks/transcribe";

interface TranscribeRouteErrorBody {
  error?: string;
  code?: string;
}

interface TranscribeRouteSuccessBody {
  words?: unknown;
  durationSec?: unknown;
}

function isPlausibleWord(value: unknown): value is SkidmarksTranscribedWord {
  if (!value || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  return (
    typeof w.word === "string" &&
    typeof w.startSec === "number" &&
    Number.isFinite(w.startSec) &&
    typeof w.endSec === "number" &&
    Number.isFinite(w.endSec)
  );
}

/**
 * POSTs the attached file to the transcription route and normalizes its
 * response into one of the three honest outcomes above. Never throws —
 * a thrown `fetch` (offline, CORS, etc.) is caught and reported the same
 * way as any other real failure.
 */
export async function transcribeAudio(file: File): Promise<TranscriptionOutcome> {
  const form = new FormData();
  form.set("audio", file, file.name || "audio.mp3");

  let res: Response;
  try {
    res = await fetch(TRANSCRIBE_ENDPOINT, { method: "POST", body: form });
  } catch (err) {
    return {
      ok: false,
      unconfigured: false,
      message:
        err instanceof Error ? err.message : "Network error reaching the transcription API.",
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. a platform-level error page) — the generic
    // status-code message below still gives Stuart something real to see.
  }

  if (!res.ok) {
    const errBody = (body ?? {}) as TranscribeRouteErrorBody;
    return {
      ok: false,
      unconfigured: errBody.code === "missing_api_key",
      message: errBody.error ?? `Transcription request failed (HTTP ${res.status}).`,
    };
  }

  const okBody = (body ?? {}) as TranscribeRouteSuccessBody;
  const words = Array.isArray(okBody.words) ? okBody.words.filter(isPlausibleWord) : [];
  return {
    ok: true,
    result: {
      words,
      durationSec: typeof okBody.durationSec === "number" ? okBody.durationSec : null,
    },
  };
}

/** Gap between the end of one transcribed word and the start of the next
 * that we treat as an instrumental break rather than a pause inside a
 * phrase. Real word timestamps make this a much sharper cut than the
 * energy heuristic's hysteresis hold times (`ENTER_VOCAL_HOLD_SEC`/
 * `EXIT_VOCAL_HOLD_SEC` in `lib/audioAnalysis.ts`) — there's no per-frame
 * flicker to guard against here, just an actual measured silence-of-
 * lyrics duration. A breath or a short pause between lines sits well
 * under this; a real instrumental bridge/intro/outro sits well over it.
 * Not yet verified against Stuart's actual "Talking To Concrete" word
 * timestamps (no API key configured in this environment to run it) —
 * tuned by the same "by ear, revisit if reported wrong" spirit as the
 * energy heuristic's constants, not a dataset-derived number. */
const WORD_GAP_INSTRUMENTAL_SEC = 2.0;

/**
 * Turns a flat list of transcribed words into vocal/instrumental runs:
 * consecutive words closer together than `gapThresholdSec` merge into
 * the same vocal run; a bigger gap (or the silence before the first word
 * / after the last) becomes an instrumental segment. This is what lets
 * word-level timestamps directly answer "when do vocals actually start"
 * — Stuart's ask — instead of only knowing "is this frame sung", which
 * is all the energy heuristic can see.
 *
 * Reuses `mergeTinySegments` (the same `MIN_SEGMENT_SEC` fold
 * `lib/audioAnalysis.ts`'s energy heuristic applies) so a real STT-
 * derived timeline reads at the same "handful of sections" granularity
 * instead of one row per line/phrase.
 */
export function segmentsFromWords(
  words: SkidmarksTranscribedWord[],
  totalDurationSec: number,
  gapThresholdSec: number = WORD_GAP_INSTRUMENTAL_SEC
): VocalAnalysisSegment[] {
  const sorted = [...words]
    .filter((w) => w.endSec >= w.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  if (sorted.length === 0) {
    return [{ startSec: 0, endSec: Math.max(0, totalDurationSec), vocal: false }];
  }

  const raw: VocalAnalysisSegment[] = [];
  if (sorted[0].startSec > 0) {
    raw.push({ startSec: 0, endSec: sorted[0].startSec, vocal: false });
  }

  let runStart = sorted[0].startSec;
  let runEnd = sorted[0].endSec;
  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    if (word.startSec - runEnd > gapThresholdSec) {
      raw.push({ startSec: runStart, endSec: runEnd, vocal: true });
      raw.push({ startSec: runEnd, endSec: word.startSec, vocal: false });
      runStart = word.startSec;
    }
    runEnd = Math.max(runEnd, word.endSec);
  }
  raw.push({ startSec: runStart, endSec: runEnd, vocal: true });

  // The probed/reported total can occasionally land a hair before the
  // last word's own end time (VBR duration quirks) — stretch to fit
  // rather than emit a segment with a negative length.
  const effectiveTotal = Math.max(totalDurationSec, runEnd);
  const last = raw[raw.length - 1];
  if (last.endSec < effectiveTotal) {
    raw.push({ startSec: last.endSec, endSec: effectiveTotal, vocal: false });
  } else if (last.endSec > effectiveTotal) {
    last.endSec = effectiveTotal;
  }

  return mergeTinySegments(raw);
}
