/**
 * Client-side half of Skidmarks' real speech-to-text pass — the "phone
 * dictation" word-timing signal Stuart asked for after the energy
 * heuristic (`lib/audioAnalysis.ts`) glued Jack Ash's "Talking To
 * Concrete" intro + flute into one giant Vocal segment. **This is genuine
 * transcription, not another heuristic**: it POSTs the attached MP3
 * `File` to `app/api/skidmarks/transcribe/route.ts`, which forwards it to
 * a real speech-to-text API using a server-side API key and returns real
 * per-word start/end times.
 *
 * **ElevenLabs Scribe only — no OpenAI Whisper fallback.** The server
 * route (`app/api/skidmarks/transcribe/route.ts`) calls **ElevenLabs
 * Scribe** (`scribe_v2`, keyed via `ELEVENLABS_API_KEY`/
 * `ELEVEN_LABS_API_KEY`) and nothing else — ElevenLabs markets Scribe
 * explicitly for transcribing song lyrics, unlike Whisper, which is
 * speech-oriented and was removed from this route entirely (Stuart's
 * explicit product call, after a live bug report where a "successful"
 * Whisper fallback — real words, but too sparse to be useful — silently
 * hid a real ElevenLabs failure from him; see the route's doc comment
 * for the investigation and evidence). If Scribe isn't configured, or
 * its request fails for any reason (network/upstream/timeout/
 * empty-transcript), this module reports that failure honestly and
 * `lib/skidmarks.ts` falls back to the client-side energy heuristic —
 * there is no second STT provider to silently swap in. `transcribeAudio`
 * still reads back `{ words, durationSec, provider }` from the route
 * (`provider` is always `"elevenlabs"` on a real success today), kept as
 * a named field rather than hardcoded in the UI so a caption never has
 * to guess which backend answered, and so this shape doesn't need to
 * change if a provider is ever reintroduced.
 *
 * **This provider swap alone doesn't fully fix the bug** — a "the STT
 * vendor markets song support" claim isn't a guarantee, and any
 * provider can in principle return a real, non-empty word list that
 * still maps to near-zero usable singing for a given track. The other,
 * load-bearing half of the fix is `hasUsefulVocalCoverage` below: a
 * real check, independent of which provider answered, on whether the
 * resulting vocal/instrumental map actually covers enough of the track
 * to trust — see `lib/skidmarks.ts`'s `applySkidmarksTranscriptionResult`
 * for where that gates `segmentsSource`/the Lyrics chip, instead of
 * "transcription returned *any* words" alone being treated as "produced
 * a *useful* map" (the literal bug: it wasn't).
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
 * **Priority order once results land** (`lib/skidmarks.ts`): real,
 * *useful* transcription > the energy heuristic > the seed cadence. Both
 * real signals run in parallel from the moment a file's attached (see
 * `useSkidmarksStudio.attachMp3`) since transcription needs a network
 * round-trip and the energy heuristic doesn't; whichever finishes first
 * shows immediately, and a later-arriving transcription result still
 * wins over an already-displayed heuristic one — provided it clears
 * `hasUsefulVocalCoverage`; a sparse one never downgrades an
 * already-showing heuristic/seed result. The energy heuristic never
 * gets turned off by this — it's the answer whenever no key is
 * configured, the request fails, or transcription lands but doesn't
 * clear that usefulness bar, per the product ask to keep it as a real
 * fallback, not a maybe-it-works stub.
 *
 * **A real full-length song 413'd here** (Stuart re-attached "Talking To
 * Concrete" at ~4:16 and got a bare `HTTP 413`, even though the tiny
 * test tone he'd tried earlier worked fine) — that's Vercel's own
 * platform-level 4.5MB request body cap rejecting the multipart upload
 * before `app/api/skidmarks/transcribe/route.ts` ever runs, not an API
 * key problem (see `lib/audioCompression.ts`'s doc comment for the
 * confirmed root cause, with sources). `transcribeAudio` now runs
 * `compressAudioForTranscription` first on anything close to that limit,
 * so a normal song-length MP3 gets downmixed/resampled/re-encoded small
 * enough to clear it before it's ever POSTed.
 */

import { mergeTinySegments, type VocalAnalysisSegment } from "./audioAnalysis";
import { compressAudioForTranscription, VERCEL_BODY_LIMIT_BYTES } from "./audioCompression";

export interface SkidmarksTranscribedWord {
  word: string;
  startSec: number;
  endSec: number;
}

/** Which backend answered a given transcription request. As of this
 * build there is exactly one — ElevenLabs Scribe — since OpenAI Whisper
 * was removed entirely (see this module's doc comment and
 * `app/api/skidmarks/transcribe/route.ts`'s for why). Kept as a named
 * type (rather than inlining the string literal at every call site) so
 * `SkidmarksClipTimeline`'s caption still names the provider explicitly
 * instead of hardcoding prose, and so reintroducing a second provider
 * later is a type-level change, not a string-literal hunt. A legacy
 * persisted session from before this change may still have `"openai"`
 * on disk (`lib/skidmarks.ts`'s `normalizeState` treats that the same as
 * `undefined` — see `transcriptionProviderLabel` below). */
export type SkidmarksTranscriptionProvider = "elevenlabs";

export interface TranscriptionSuccess {
  words: SkidmarksTranscribedWord[];
  /** The provider's own reported duration, if the response included one
   * — only used as a last-resort fallback; `lib/skidmarks.ts` prefers
   * the browser's own probed `durationSec` when it's already known. */
  durationSec: number | null;
  /** Which backend produced `words` — `undefined` only if an older/
   * unexpected server response omitted it; callers should treat that
   * the same as `"elevenlabs"` (this build's primary path) rather than
   * failing to render a caption. */
  provider?: SkidmarksTranscriptionProvider;
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
  provider?: unknown;
}

function isTranscriptionProvider(value: unknown): value is SkidmarksTranscriptionProvider {
  return value === "elevenlabs";
}

/** Human-readable name for whichever backend answered. With Whisper
 * removed, this always resolves to `"ElevenLabs Scribe"` today —
 * `provider` stays an explicit parameter (rather than a hardcoded
 * string in the caller) so a legacy/unexpected value (`undefined` from
 * an older response, or a stale persisted `"openai"` from before this
 * change — see `SkidmarksTranscriptionProvider`'s doc comment) still
 * resolves to something honest instead of the caller having to guess.
 * Shared by `lib/skidmarks.ts` (the `"sparse"` outcome's
 * `transcriptionError` text — see that module's
 * `applySkidmarksTranscriptionResult` doc comment for why naming the
 * provider there specifically matters) and `SkidmarksClipTimeline` (the
 * top-line "Real transcription…" caption). */
export function transcriptionProviderLabel(
  provider: SkidmarksTranscriptionProvider | undefined
): string {
  // Both branches resolve to the same label today (there's only one
  // provider), but `provider` stays a real parameter rather than being
  // dropped, so a second provider added later is a one-line change here
  // instead of a signature change at every call site.
  return provider === "elevenlabs" || provider === undefined ? "ElevenLabs Scribe" : "ElevenLabs Scribe";
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

/** Plain-language stand-in for a bare `413` with no JSON body — exactly
 * what Vercel's platform returns when a request body clears its own
 * 4.5MB cap (see `lib/audioCompression.ts`'s doc comment), which is why
 * `res.json()` below has nothing to read a real message from: the
 * request never reached `app/api/skidmarks/transcribe/route.ts` at all.
 * `compressAudioForTranscription` should keep most real songs well under
 * that limit now, so seeing this at all means compression itself didn't
 * happen (e.g. an already-small file that still somehow doesn't fit, or
 * a `"failed"`/skipped compression outcome) — the message still needs to
 * read as "file too large", not a bare status code either way. */
function describeUpstream413(attemptedBytes: number): string {
  const attemptedMb = (attemptedBytes / (1024 * 1024)).toFixed(1);
  const limitMb = (VERCEL_BODY_LIMIT_BYTES / (1024 * 1024)).toFixed(1);
  return (
    `This audio file (${attemptedMb}MB) is too large to upload for transcription \u2014 ` +
    `the server only accepts uploads up to ${limitMb}MB. Try a shorter clip or a ` +
    `lower-bitrate MP3.`
  );
}

/** One upload attempt's outcome, plus whether the server-reported
 * failure looks like the specific "the audio file itself is the
 * problem" case (`code: "invalid_audio"` from `app/api/skidmarks/
 * transcribe/route.ts`'s `classifyElevenLabsFailure`) worth a one-shot
 * retry with a freshly re-encoded file — see `transcribeAudio` below. */
interface UploadAttempt {
  outcome: TranscriptionOutcome;
  invalidAudio: boolean;
}

async function uploadForTranscription(uploadFile: File): Promise<UploadAttempt> {
  const form = new FormData();
  form.set("audio", uploadFile, uploadFile.name || "audio.mp3");

  let res: Response;
  try {
    res = await fetch(TRANSCRIBE_ENDPOINT, { method: "POST", body: form });
  } catch (err) {
    return {
      outcome: {
        ok: false,
        unconfigured: false,
        message:
          err instanceof Error ? err.message : "Network error reaching the transcription API.",
      },
      invalidAudio: false,
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. a platform-level error page, like the
    // 413 this whole fix is about) — the status-code-aware fallback
    // below still gives Stuart a real, plain-language message.
  }

  if (!res.ok) {
    const errBody = (body ?? {}) as TranscribeRouteErrorBody;
    const fallbackMessage =
      res.status === 413
        ? describeUpstream413(uploadFile.size)
        : `Transcription request failed (HTTP ${res.status}).`;
    return {
      outcome: {
        ok: false,
        unconfigured: errBody.code === "missing_api_key",
        message: errBody.error ?? fallbackMessage,
      },
      invalidAudio: errBody.code === "invalid_audio",
    };
  }

  const okBody = (body ?? {}) as TranscribeRouteSuccessBody;
  const words = Array.isArray(okBody.words) ? okBody.words.filter(isPlausibleWord) : [];
  return {
    outcome: {
      ok: true,
      result: {
        words,
        durationSec: typeof okBody.durationSec === "number" ? okBody.durationSec : null,
        provider: isTranscriptionProvider(okBody.provider) ? okBody.provider : undefined,
      },
    },
    invalidAudio: false,
  };
}

/**
 * POSTs the attached file to the transcription route and normalizes its
 * response into one of the three honest outcomes above. Never throws —
 * a thrown `fetch` (offline, CORS, etc.) is caught and reported the same
 * way as any other real failure.
 *
 * Runs `compressAudioForTranscription` first so a normal full-length
 * song clears Vercel's request body cap (see this module's doc comment
 * for the 413 root cause) instead of being rejected before the server
 * route even runs. Compression is best-effort: if it fails outright (an
 * unsupported browser, a corrupt file) this still tries the original
 * file, matching the pre-fix behavior, rather than giving up without
 * ever attempting a real transcription.
 *
 * **One-shot re-encode retry on `invalid_audio`** (per Stuart's Gemini
 * troubleshooting notes' encoding-risk point): if ElevenLabs Scribe
 * rejects the upload specifically because the *audio itself* looked
 * invalid/corrupt/an unsupported format
 * (`app/api/skidmarks/transcribe/route.ts`'s `"invalid_audio"` code —
 * distinct from a generic request/parameter problem), and the file that
 * was actually uploaded was still the **unmodified original** (i.e.
 * `compressAudioForTranscription` skipped re-encoding because the file
 * was already small enough), this retries exactly once against a
 * *forced* re-encode of that same original
 * (`compressAudioForTranscription(file, { force: true })`). Rationale
 * for this specific, minimal fix rather than a bigger pipeline change:
 * `compressAudioForTranscription` doesn't patch or reinterpret the
 * original file's bytes — it fully decodes them via the browser's own
 * `AudioContext` (which already has to cope with real-world MP3 header/
 * VBR quirks to play the file at all) and hands the *raw decoded PCM* to
 * a fresh `lamejs` CBR encode, so the retried upload is a clean,
 * from-scratch MP3 with none of the original container's own header
 * quirks — a plausible fix for exactly the class of "corrupt/unusual
 * MP3 headers" issue Stuart's notes called out, using code this module
 * already ships rather than a new encoder or format.
 *
 * **A WAV (`pcm_s16le`) upload path was considered and rejected** as the
 * "smallest fix" here specifically because it isn't one: uncompressed
 * 16-bit PCM is roughly 60–90x larger per second than this module's MP3
 * tiers (even mono, even at a reduced sample rate) — a WAV encode of a
 * real ~4 minute song would land far past Vercel's 4.5MB request body
 * cap (`VERCEL_BODY_LIMIT_BYTES`) at any sample rate worth using for
 * *singing*, making it infeasible as a general fallback for this app's
 * actual use case (full song-length uploads), not just a quality
 * trade-off. If a re-encoded MP3 still fails, this reports the real
 * ElevenLabs error rather than trying a third format.
 *
 * Only retries when the first attempt genuinely sent the original,
 * un-re-encoded bytes — if `compressAudioForTranscription` already ran
 * a real re-encode (a large file), retrying with `{ force: true }`
 * would re-decode+re-encode the exact same source into byte-identical
 * output and repeat the same failing request for nothing.
 */
export async function transcribeAudio(file: File): Promise<TranscriptionOutcome> {
  const compression = await compressAudioForTranscription(file);
  if (compression.kind === "too_long") {
    return { ok: false, unconfigured: false, message: compression.message };
  }
  const uploadFile = compression.kind === "compressed" ? compression.file : file;

  const first = await uploadForTranscription(uploadFile);
  if (!first.invalidAudio || compression.kind === "compressed") {
    return first.outcome;
  }

  const reencoded = await compressAudioForTranscription(file, { force: true });
  if (reencoded.kind !== "compressed") {
    // Couldn't force a real re-encode either (e.g. an unsupported
    // browser) — report the original, real failure rather than a
    // confusing second one about the retry itself.
    return first.outcome;
  }
  const retry = await uploadForTranscription(reencoded.file);
  return retry.outcome;
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

/** Total real time `segments` calls "vocal" — the raw ingredient
 * `hasUsefulVocalCoverage` below judges against a threshold. Exported on
 * its own since `lib/skidmarks.ts` also wants the raw number (not just
 * the pass/fail) for its honest "sparse" caption text. */
export function vocalCoverageSec(segments: VocalAnalysisSegment[]): number {
  return segments
    .filter((s) => s.vocal)
    .reduce((sum, s) => sum + Math.max(0, s.endSec - s.startSec), 0);
}

/** How much real vocal coverage a track needs before its word-timing-
 * derived map is trusted enough to show as `segmentsSource:
 * "transcription"` and turn the Lyrics chip green — see
 * `lib/skidmarks.ts`'s `applySkidmarksTranscriptionResult`.
 *
 * **This is the actual fix for the reported bug**, not the provider
 * swap alone: a live run against Jack Ash's "Talking To Concrete"
 * (~4:16, real singing from ~0:32) came back green Lyrics + a single
 * **Instrumental 0:00–4:16** segment. The STT backend that produced that
 * (Whisper, a speech-first model, on a *sung* track) returned real,
 * non-empty `words` — the old code never checked whether those words
 * actually mapped to any usable singing, it just trusted "transcription
 * returned words" as "transcription produced a useful map". Switching
 * the primary backend to a provider marketed for song lyrics
 * (`app/api/skidmarks/transcribe/route.ts`'s ElevenLabs Scribe pivot)
 * makes this specific failure less likely, but it's still just one
 * provider's word list — any STT vendor can in principle return a real
 * transcript for a track that still maps to near-zero singing once
 * merged (a heavily instrumental track, a language/accent it mishears,
 * an unusually quiet mix). This check is the load-bearing, provider-
 * independent backstop: it looks at the *actual* merged vocal/
 * instrumental map (`segmentsFromWords`'s real output) rather than
 * trusting whichever provider's marketing claims to be a better fit.
 *
 * A capped **fraction of the track**, not a flat floor — `totalDurationSec
 * * requiredCoverageRatio` — so a short clip isn't held to a full song's
 * bar, but never more than `minRequiredSec` even on a very long track
 * (there's no reason a real vocal run needs to individually outgrow
 * that just because the song is long). Both defaults are "tuned by ear,
 * revisit if reported wrong" numbers, same spirit as
 * `lib/audioAnalysis.ts`'s heuristic constants, not dataset-derived:
 * `minRequiredSec` sits just above `MIN_SEGMENT_SEC` (5s) so a single
 * `mergeTinySegments`-surviving vocal run — which is itself already
 * >=5s on anything but a very short clip — clears it; `requiredCoverageRatio`
 * exists mainly so a short clip (a 10s stinger, not a song) isn't held
 * to the same absolute floor as a full-length track. */
export function hasUsefulVocalCoverage(
  segments: VocalAnalysisSegment[],
  totalDurationSec: number,
  minRequiredSec: number = 8,
  requiredCoverageRatio: number = 0.5
): boolean {
  const requiredSec = Math.min(minRequiredSec, Math.max(0, totalDurationSec) * requiredCoverageRatio);
  return vocalCoverageSec(segments) >= requiredSec;
}
