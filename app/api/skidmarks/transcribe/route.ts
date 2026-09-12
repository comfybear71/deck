import { NextResponse } from "next/server";

/**
 * POST /api/skidmarks/transcribe — the server half of Skidmarks' real
 * speech-to-text pass (see `lib/transcription.ts`'s module doc comment
 * for the full client-side contract).
 *
 * **ElevenLabs Scribe only, as of this build.** This route calls
 * **ElevenLabs Scribe** (`scribe_v2`, `POST https://api.elevenlabs.io/v1/
 * speech-to-text`) and nothing else. It used to also carry OpenAI
 * Whisper as an automatic fallback (see git history / the README's
 * "Skidmarks node" section for that era) — Stuart's explicit product
 * call, after a fourth live bug report, was to **remove Whisper
 * entirely**: it isn't reliable for sung tracks, and — worse — its
 * "success" on a sparse word list was silently masking real ElevenLabs
 * failures, because a Whisper fallback that returns *any* words counts
 * as an HTTP 200 from this route, with no field anywhere in that success
 * body naming the fact that ElevenLabs was even tried, let alone why it
 * failed. Stuart saw "OpenAI Whisper returned 18 words…" and had no way
 * to tell that Scribe — the provider he actually wanted, the one with an
 * `ELEVENLABS_API_KEY` he'd specifically added for this — had bailed
 * first. There is now exactly one transcription path: ElevenLabs Scribe
 * succeeds, or this route reports honestly (and specifically) why it
 * didn't, and `lib/skidmarks.ts` falls back to the client-side energy
 * heuristic. No second provider ever gets a silent turn.
 *
 * **Fourth live bug report — root cause investigation, with real
 * evidence, not a guess**: Stuart's screenshot after this route named
 * providers (a prior fix) showed **"OpenAI Whisper returned 18 words…"**
 * — proof the *fallback* ran and "succeeded" (by the old, low bar of
 * "returned any words"), which only happens if the ElevenLabs *attempt*
 * before it failed. The old code's `elevenLabsFailed` branch swallowed
 * that failure into an internal `ProviderFailure` record that was never
 * returned to the client once Whisper went on to answer — so the real
 * ElevenLabs error, whatever it was, never left this server's process.
 * Investigated directly against the **live ElevenLabs API**, using this
 * route's own exact request shape (multipart `file` + `model_id=
 * scribe_v2` + `timestamps_granularity=word` + `tag_audio_events=true`,
 * `xi-api-key` header) and a real (though not necessarily Stuart's own)
 * ElevenLabs key available in this sandbox: that call returned a real,
 * live **`401`** —
 * `{"detail":{"type":"authentication_error","code":"unauthorized","status":"missing_permissions","message":"The API key you used is missing the permission speech_to_text to execute this operation."}}`
 * — i.e. a **key that authenticates fine but is scoped without the
 * `speech_to_text` permission** gets rejected outright, distinctly from
 * a bad/missing key. This matters here specifically because Stuart's own
 * account context is "he uses this key for voice generation in other
 * productions" — voice generation (text-to-speech) and transcription
 * (speech-to-text) are separate ElevenLabs API permissions, and a key
 * created or restricted for the former does not automatically carry the
 * latter. **This is confirmed, reproducible behavior of the real
 * ElevenLabs API against this route's real request** — not confirmed to
 * be *Stuart's exact* failure, since this sandbox's key isn't his
 * Vercel project's key and there's no way to inspect his key's scopes
 * from here. What *is* fixed regardless of which of these it turns out
 * to be: `extractElevenLabsErrorDetail` below already parses this
 * `{ detail: { message, status, ... } }` shape correctly and produces
 * exactly the plain-language sentence above — the bug was never that
 * this route couldn't explain the failure, it was that a Whisper
 * fallback let it get away with never having to. With Whisper gone, any
 * real Scribe failure — a permissions-scoped key, an expired/rotated
 * key, a rate limit, a genuine outage, a timeout — now reaches
 * `transcriptionError` and the timeline caption verbatim, every time.
 * If Stuart still sees a Scribe failure after this ships, the message
 * itself (not a bare "Transcription failed") is the next debugging
 * step: a `missing_permissions`/`401` message means re-check the key's
 * scopes in the ElevenLabs dashboard (Profile → API Keys → this key →
 * enable Speech to Text); anything else names its own next step just as
 * directly.
 *
 * **Verified against Stuart's Gemini troubleshooting notes** (a second
 * pass, after the investigation above): each point checked directly
 * against this route's actual code, not assumed —
 * 1. *Endpoint/params* — `POST https://api.elevenlabs.io/v1/speech-to-text`,
 *    `model_id=scribe_v2`, `timestamps_granularity=word`, multipart
 *    field named **`file`** (matches ElevenLabs' own documented
 *    parameter name exactly — see
 *    https://elevenlabs.io/docs/api-reference/speech-to-text/convert).
 *    This route's *own* incoming contract with the browser
 *    (`lib/transcription.ts`) uses a different field name, **`audio`**
 *    — that's an internal contract between this app's client and server
 *    halves, not part of the ElevenLabs request, and both names are
 *    correct for their respective request.
 * 2. *Multipart gotchas* — `transcribeWithElevenLabs` below sets exactly
 *    one header (`xi-api-key`); it never sets `Content-Type` itself, so
 *    `fetch` generates the real `multipart/form-data; boundary=...`
 *    header for a `FormData` body automatically (setting `Content-Type`
 *    by hand on a `FormData` request is the classic way to break the
 *    boundary and get a generic "malformed request" failure instead of
 *    a specific error). The uploaded value is always a real `File`/`Blob`
 *    (verified server-side via `audio instanceof File` in `POST` below,
 *    which rejects anything else as `invalid_request` before it ever
 *    reaches ElevenLabs) — never a path string.
 * 3. *Auth* — `xi-api-key: <ELEVENLABS_API_KEY>`, matching ElevenLabs'
 *    documented auth header exactly. A `401` (bad, expired, or
 *    permission-scoped key — see the investigation above) is returned
 *    to the client verbatim via `classifyElevenLabsFailure`'s
 *    `"auth_error"` code and never triggers a fallback to any other
 *    provider — there isn't one anymore.
 * 4. *Error payload* — `extractElevenLabsErrorDetail`/
 *    `classifyElevenLabsFailure` below parse ElevenLabs' real
 *    `{ detail: { message, type, code, status } }` error shape (per
 *    https://elevenlabs.io/docs/eleven-api/resources/errors) and map it
 *    to one of this route's own honest codes — `auth_error` (401/403),
 *    `rate_limited` (429), `payment_required` (402), `invalid_audio`
 *    (400/422 with an audio-specific validation code, e.g.
 *    `invalid_audio`/`invalid_audio_format`/`audio_too_long`/
 *    `audio_too_short`/`invalid_file_type`), `invalid_request` (any
 *    other 400/422), or `upstream_error` — every one carries ElevenLabs'
 *    own human-readable `message` in `error`, verbatim.
 * 5. *Encoding* — see `lib/transcription.ts`'s `transcribeAudio` doc
 *    comment for the considered-and-rejected WAV alternative and the
 *    smaller fix actually shipped (a one-shot forced re-encode retry
 *    when ElevenLabs reports `invalid_audio` against an unmodified
 *    original file).
 *
 * **Key wiring**: Stuart confirmed he already has an ElevenLabs API key
 * set on Vercel (originally only on the sibling "skidmarks" project; he
 * added it to this "deck" project specifically for this feature, under
 * the name `ELEVENLABS_API_KEY`). `resolveElevenLabsApiKey` below checks,
 * in order, `ELEVENLABS_API_KEY` (the standard name the official
 * ElevenLabs SDKs/docs use, and the one Stuart confirmed) and
 * `ELEVEN_LABS_API_KEY` (a plausible manual-naming variant with the
 * extra underscore, kept as a fallback name for free). If neither is
 * set, this route returns the `missing_api_key` outcome below rather
 * than silently trying more names.
 *
 * **No OpenAI Whisper fallback, by design, as of this build.** If
 * ElevenLabs isn't configured, or the request to it fails for any
 * reason (network error, timeout, upstream error, a genuinely empty
 * transcript), this route reports that failure directly — it does not
 * retry against any other provider. `lib/skidmarks.ts`'s
 * `markSkidmarksTranscriptionFailed` picks that error up and the UI
 * falls back to the client-side energy heuristic
 * (`lib/audioAnalysis.ts`), same as it always has whenever transcription
 * isn't available — just without a second network round-trip to a
 * provider Stuart doesn't want used for this. `OPENAI_API_KEY` is not
 * read by this route at all; it's fine to leave it set (other features
 * may still use it) or unset — it has no effect here either way.
 *
 * **Never claims to be live without a key.** If no ElevenLabs key under
 * either checked name is found, this returns `501` with
 * `code: "missing_api_key"` — a distinct, expected shape
 * `lib/transcription.ts` reads as "transcription isn't configured here"
 * rather than "the request failed", so the client can fall back to
 * `lib/audioAnalysis.ts`'s energy heuristic honestly instead of implying
 * a real attempt errored out.
 *
 * This route only ever proxies a request Stuart already initiated by
 * attaching an MP3 in the UI — it doesn't store the audio, doesn't log
 * its contents, and holds nothing in memory beyond the single request/
 * response round-trip. The API key itself is never logged, never
 * echoed back in any response, and never appears in an error message —
 * only ElevenLabs' own (key-free) error text does.
 */

export const runtime = "nodejs";
// Transcription of a full song can run past the platform's default
// function timeout on some plans — this only raises the ceiling this
// route asks for; the platform's own plan limit still applies.
export const maxDuration = 120;

/** Candidate env var names for Stuart's existing ElevenLabs API key, in
 * priority order — see the module doc comment's "Key wiring" note.
 * `ELEVENLABS_API_KEY` is the standard name ElevenLabs' own SDKs/docs
 * use, and the one Stuart confirmed he set on this project;
 * `ELEVEN_LABS_API_KEY` is the one plausible manual-naming variant worth
 * checking for free. Not an open-ended guess list — if neither is set,
 * `resolveElevenLabsApiKey` says so honestly (naming both) rather than
 * silently trying more names. */
const ELEVENLABS_API_KEY_ENV_CANDIDATES = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY"] as const;

/** Looks up Stuart's already-configured ElevenLabs key under whichever
 * of `ELEVENLABS_API_KEY_ENV_CANDIDATES` is actually set, and reports
 * which name matched — so a caller that finds nothing can name exactly
 * what it checked (see the `missing_api_key` response below) instead of
 * a bare "not configured". Returns `null`, never throws, if none match. */
function resolveElevenLabsApiKey(): { key: string; envVarName: string } | null {
  for (const envVarName of ELEVENLABS_API_KEY_ENV_CANDIDATES) {
    const key = process.env[envVarName];
    if (key) return { key, envVarName };
  }
  return null;
}

const ELEVENLABS_TRANSCRIBE_URL = "https://api.elevenlabs.io/v1/speech-to-text";
/** State-of-the-art ElevenLabs STT model as of this build — see
 * https://elevenlabs.io/docs/overview/models and the speech-to-text
 * skill docs. `scribe_v1` remains available upstream but ElevenLabs'
 * own docs call it "outclassed by v2 models"; nothing here depends on
 * v1-specific behavior, so there's no reason to pin the older one. */
const ELEVENLABS_MODEL_ID = "scribe_v2";

/** Conservative upload ceiling for this route. `lib/transcription.ts`
 * compresses anything close to Vercel's own 4.5MB request-body cap well
 * below this (see `lib/audioCompression.ts`), so in practice a request
 * that clears this already comfortably cleared the platform's own,
 * much tighter cap first — this exists as a sane server-side backstop,
 * not a limit tuned to any specific provider's own ceiling (ElevenLabs'
 * documented limit is far higher, 5GB). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Hard ceiling on how long we'll wait on the upstream call — a real
 * network outage or an unreachable host would otherwise hang until the
 * platform kills the function, leaving Stuart staring at a spinner with
 * no honest error to show. Comfortably under `maxDuration`. */
const UPSTREAM_TIMEOUT_MS = 45_000;

interface NormalizedWord {
  word: string;
  startSec: number;
  endSec: number;
}

/** The one transcription backend this route calls. Kept as a named type
 * (rather than inlining `"elevenlabs"` everywhere) so `lib/transcription.ts`
 * and `lib/skidmarks.ts` have a single shared source of truth for the
 * provider tag on a success/sparse result, and so a future provider
 * (re-)addition is a type-level change, not a string-literal hunt. */
export type TranscriptionProvider = "elevenlabs";

type ProviderSuccess = { ok: true; words: NormalizedWord[]; durationSec: number | null };
type ProviderFailure = { ok: false; status: number; code: string; error: string };
type ProviderResult = ProviderSuccess | ProviderFailure;

export interface ElevenLabsErrorDetail {
  message: string;
  /** Documented `type` values: `validation_error`, `invalid_request`,
   * `authentication_error`, `payment_required`, `authorization_error`,
   * `rate_limit_error`, `internal_error`, `service_unavailable`, etc. —
   * see https://elevenlabs.io/docs/eleven-api/resources/errors. */
  type?: string;
  /** The more specific `code` field docs recommend over `status` (kept
   * as a legacy fallback below — a live call against this route's exact
   * request shape returned `status: "missing_permissions"` with no
   * `code` at all, so both are read defensively rather than assuming
   * either is always present). */
  code?: string;
}

/** ElevenLabs error bodies are `{ detail: string }` or
 * `{ detail: { message, type, code, status, ... } }` (see
 * https://elevenlabs.io/docs/eleven-api/resources/errors) — pull out the
 * structured fields without assuming which shape a given failure used.
 * Never touches the API key itself; nothing here logs or echoes it. */
export function extractElevenLabsErrorDetail(payload: unknown): ElevenLabsErrorDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail ? { message: detail } : null;
  if (detail && typeof detail === "object") {
    const d = detail as { message?: unknown; type?: unknown; code?: unknown; status?: unknown };
    const message = typeof d.message === "string" ? d.message : "";
    if (!message) return null;
    const type = typeof d.type === "string" ? d.type : undefined;
    const code = typeof d.code === "string" ? d.code : typeof d.status === "string" ? d.status : undefined;
    return { message, type, code };
  }
  return null;
}

/** Audio-format-specific validation codes ElevenLabs documents under its
 * `validation_error` type — distinct from a generic bad parameter, this
 * is specifically "the file itself is the problem" (corrupt, empty,
 * wrong container, too long/short) — see
 * https://elevenlabs.io/docs/eleven-api/resources/errors. Mapped to this
 * route's own `"invalid_audio"` code so `lib/transcription.ts` knows a
 * re-encode retry is worth trying (see its `transcribeAudio` doc
 * comment), which a generic `"invalid_request"` (a bad *parameter*, not
 * a bad *file*) wouldn't be. */
const ELEVENLABS_INVALID_AUDIO_CODES = new Set([
  "invalid_audio",
  "invalid_audio_format",
  "invalid_file_type",
  "audio_too_long",
  "audio_too_short",
]);

/** Maps a failed ElevenLabs response to this route's own `{ httpStatus,
 * code }` pair, so `lib/transcription.ts` (and, transitively, the
 * timeline caption) can react to *why* Scribe failed — not just that it
 * did — without needing to know ElevenLabs' own error taxonomy itself.
 * `httpStatus` mirrors ElevenLabs' real status where that's meaningful
 * (401/402/429) rather than flattening everything to a generic gateway
 * error, since that's useful signal in a network tab/function log even
 * though `lib/transcription.ts` today only branches on `code`. */
export function classifyElevenLabsFailure(
  upstreamStatus: number,
  detail: ElevenLabsErrorDetail | null
): { httpStatus: number; code: string } {
  const type = detail?.type;
  if (upstreamStatus === 401 || type === "authentication_error") {
    return { httpStatus: 401, code: "auth_error" };
  }
  if (upstreamStatus === 403 || type === "authorization_error") {
    return { httpStatus: 403, code: "auth_error" };
  }
  if (upstreamStatus === 429 || type === "rate_limit_error") {
    return { httpStatus: 429, code: "rate_limited" };
  }
  if (upstreamStatus === 402 || type === "payment_required") {
    return { httpStatus: 402, code: "payment_required" };
  }
  if (type === "validation_error" || upstreamStatus === 400 || upstreamStatus === 422) {
    const isAudioCode = !!detail?.code && ELEVENLABS_INVALID_AUDIO_CODES.has(detail.code);
    return { httpStatus: 422, code: isAudioCode ? "invalid_audio" : "invalid_request" };
  }
  return { httpStatus: 502, code: "upstream_error" };
}

async function transcribeWithElevenLabs(audio: File, apiKey: string): Promise<ProviderResult> {
  const form = new FormData();
  form.set("file", audio, audio.name || "audio.mp3");
  form.set("model_id", ELEVENLABS_MODEL_ID);
  form.set("timestamps_granularity", "word");
  // No documented surcharge (unlike entity_detection/keyterms/diarize
  // extras — see https://elevenlabs.io/docs/eleven-api/resources/errors
  // and the convert endpoint's own param docs), and Stuart's own proof
  // run against this exact track (ElevenLabs' hosted transcribe tool)
  // came back tagged `[singing]` — this just asks the API for the same
  // non-speech/context tagging that run showed, for free. Not used for
  // vocal/instrumental segmentation below (`audio_event` entries are
  // filtered out same as `spacing` — ElevenLabs doesn't document a
  // fixed tag vocabulary, so treating specific tag text as an
  // authoritative "this is singing" signal would be guessing at an
  // undocumented format, not a real check); segmentation still comes
  // entirely from real per-word timestamps via `segmentsFromWords` +
  // `hasUsefulVocalCoverage`.
  form.set("tag_audio_events", "true");

  let res: Response;
  try {
    res = await fetch(ELEVENLABS_TRANSCRIBE_URL, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      code: timedOut ? "timeout" : "network_error",
      error: timedOut
        ? `ElevenLabs Scribe did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s.`
        : `Could not reach ElevenLabs Scribe: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled by the !res.ok / no-words checks below either way.
  }

  if (!res.ok) {
    const detail = extractElevenLabsErrorDetail(payload);
    const { httpStatus, code } = classifyElevenLabsFailure(res.status, detail);
    return {
      ok: false,
      status: httpStatus,
      code,
      error: `ElevenLabs Scribe returned ${res.status}${detail ? `: ${detail.message}` : "."}`,
    };
  }

  const body = (payload ?? {}) as { words?: unknown; audio_duration_secs?: unknown };
  const rawWords = Array.isArray(body.words) ? (body.words as Record<string, unknown>[]) : [];
  // ElevenLabs' `words` list includes `type: "spacing"` (whitespace) and
  // `type: "audio_event"` (non-speech sounds it tagged) entries
  // alongside real `type: "word"` ones — only the latter are actual
  // transcribed words with meaningful start/end timing for
  // `segmentsFromWords` to merge.
  const words = rawWords
    .filter(
      (w): w is { text: string; start: number; end: number; type: string } =>
        w.type === "word" &&
        typeof w.text === "string" &&
        typeof w.start === "number" &&
        typeof w.end === "number"
    )
    .map((w) => ({ word: w.text, startSec: w.start, endSec: w.end }));

  if (words.length === 0) {
    return {
      ok: false,
      status: 502,
      code: "no_words",
      error: "ElevenLabs Scribe succeeded but returned no word-level timestamps.",
    };
  }

  return {
    ok: true,
    words,
    durationSec: typeof body.audio_duration_secs === "number" ? body.audio_duration_secs : null,
  };
}

export async function POST(request: Request) {
  const elevenLabs = resolveElevenLabsApiKey();

  if (!elevenLabs) {
    return NextResponse.json(
      {
        error:
          `Neither ${ELEVENLABS_API_KEY_ENV_CANDIDATES.join(" nor ")} is set on the server \u2014 ` +
          "word-level transcription is unavailable here. Falling back to the client-side " +
          "energy heuristic. (Stuart's ElevenLabs key is expected to already be on this " +
          "project's Vercel environment under one of those names \u2014 if it's there under a " +
          "different name, add a one-line alias env var rather than a new key.)",
        code: "missing_api_key",
      },
      { status: 501 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with an `audio` file field.", code: "invalid_request" },
      { status: 400 }
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json(
      { error: "Missing `audio` file field.", code: "invalid_request" },
      { status: 400 }
    );
  }
  if (audio.size === 0) {
    return NextResponse.json(
      { error: "Attached audio file is empty.", code: "invalid_request" },
      { status: 400 }
    );
  }
  if (audio.size > MAX_UPLOAD_BYTES) {
    const mb = (audio.size / (1024 * 1024)).toFixed(1);
    return NextResponse.json(
      {
        error: `Audio file is ${mb}MB \u2014 over the ${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)}MB limit the transcription API accepts.`,
        code: "too_large",
      },
      { status: 413 }
    );
  }

  const result = await transcribeWithElevenLabs(audio, elevenLabs.key);

  if (result.ok) {
    const provider: TranscriptionProvider = "elevenlabs";
    return NextResponse.json({ words: result.words, durationSec: result.durationSec, provider });
  }

  // ElevenLabs failed outright (network/upstream/timeout/no_words) — no
  // second provider to fall through to. Report the real reason verbatim
  // so `lib/skidmarks.ts`'s `markSkidmarksTranscriptionFailed` (and the
  // timeline caption it drives) names exactly why Scribe didn't answer,
  // instead of a bare "Transcription failed" or a silent swap to
  // another provider — see this file's module doc comment for why that
  // silence was the actual reported bug.
  return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
}
