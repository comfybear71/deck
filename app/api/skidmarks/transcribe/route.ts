import { NextResponse } from "next/server";

/**
 * POST /api/skidmarks/transcribe — the server half of Skidmarks' real
 * speech-to-text pass (see `lib/transcription.ts`'s module doc comment
 * for the full client-side contract).
 *
 * **Provider pivot (this build)**: this route now calls **ElevenLabs
 * Scribe** (`scribe_v2`, `POST https://api.elevenlabs.io/v1/speech-to-text`)
 * as the *primary* transcription backend, not OpenAI Whisper. Root
 * cause of the switch: a real live run against Jack Ash's "TALKING TO
 * CONCRETE.mp3" (~4:16, real singing starting ~0:32) came back from
 * Whisper as green Lyrics + a single **Instrumental 0:00–4:16** segment
 * — Whisper (a speech-first model) returned real, non-empty `words`,
 * but too sparse/scattered across a *sung* track for
 * `segmentsFromWords`'s gap-based merge to find any vocal run worth
 * keeping, and the old code trusted "transcription produced *any*
 * words" as "transcription produced a *useful* map" — it didn't check.
 * ElevenLabs markets Scribe explicitly for song lyrics (unlike Whisper,
 * which is speech-oriented), so it's the better first call for a music
 * track; see `lib/transcription.ts`'s `hasUsefulVocalCoverage` for the
 * *other* half of this fix — a real, load-bearing check that no
 * provider's word list actually mapped to enough singing to trust,
 * independent of which backend answered.
 *
 * **Confirmed against this exact track**: Stuart ran the same file
 * through ElevenLabs' own hosted transcribe tool and got back real sung
 * lyrics ("I drew the blueprint straight in the dust. Spelled it out
 * clear, no room for mistrust…") with per-line timing, where Whisper had
 * returned words too sparse to build any usable vocal map from — direct
 * evidence this pivot addresses the actual reported failure on the
 * actual reported track, not just a theoretical "should be better at
 * lyrics" argument.
 *
 * **Key wiring**: Stuart confirmed he already has an ElevenLabs API key
 * set on Vercel Production (he uses it there for voice generation in
 * other productions) — this build does **not** ask him to create or add
 * a new one. `resolveElevenLabsApiKey` below checks, in order,
 * `ELEVENLABS_API_KEY` (the standard name the official ElevenLabs SDKs/
 * docs use, and the one this repo's own docs assume he set) and
 * `ELEVEN_LABS_API_KEY` (a plausible manual-naming variant with the
 * extra underscore) — nothing in this repo or its sibling "Skidmarks"/
 * "AIG!itch" project docs revealed an actual different existing name to
 * reuse instead, so this is the closest honest guess, not a discovered
 * fact. If his real Vercel var is named something else entirely, this
 * route still degrades honestly to the `missing_api_key` outcome below
 * rather than silently guessing further — see that response's message,
 * which lists exactly which names it checked, so fixing it (an alias
 * env var in Vercel pointing at the same value, or updating the name
 * list below) is a one-line change, not a mystery.
 *
 * **OpenAI Whisper stays wired as an optional fallback**, not removed:
 * if no ElevenLabs key is found, or an ElevenLabs *request* itself
 * fails (network error, timeout, upstream error, or a genuinely empty
 * transcript — not a sparse-coverage outcome, which is a client-side
 * judgment `lib/skidmarks.ts` makes off this route's real word list) and
 * `OPENAI_API_KEY` *is* set, this route retries the same upload against
 * Whisper before giving up. Whichever provider actually answers is
 * reported back as `provider` in the success body so the UI can name it
 * honestly (`SkidmarksClipTimeline`'s caption) instead of hardcoding
 * "ElevenLabs" or "OpenAI" regardless of which one ran.
 *
 * **Never claims to be live without a key.** If no ElevenLabs key under
 * any checked name is found *and* `OPENAI_API_KEY` also isn't set, this
 * returns `501` with `code: "missing_api_key"` — a distinct, expected
 * shape `lib/transcription.ts` reads as "transcription isn't configured
 * here" rather than "the request failed", so the client can fall back
 * to `lib/audioAnalysis.ts`'s energy heuristic honestly instead of
 * implying a real attempt errored out.
 *
 * This route only ever proxies a request Stuart already initiated by
 * attaching an MP3 in the UI — it doesn't store the audio, doesn't log
 * its contents, and holds nothing in memory beyond the single request/
 * response round-trip (through however many provider attempts it
 * takes).
 */

export const runtime = "nodejs";
// Transcription of a full song can run past the platform's default
// function timeout on some plans, and this route may make two sequential
// upstream calls (ElevenLabs, then a Whisper retry) on a bad day — this
// only raises the ceiling this route asks for; the platform's own plan
// limit still applies.
export const maxDuration = 120;

/** Candidate env var names for Stuart's existing ElevenLabs API key, in
 * priority order — see the module doc comment's "Key wiring" note for
 * why there are two and why we didn't just invent more: `ELEVENLABS_API_KEY`
 * is the standard name ElevenLabs' own SDKs/docs use (and what this repo's
 * README tells him to expect); `ELEVEN_LABS_API_KEY` is the one plausible
 * manual-naming variant worth checking for free. Not an open-ended guess
 * list — if neither is set, `resolveElevenLabsApiKey` says so honestly
 * (naming both) rather than silently trying more names. */
const ELEVENLABS_API_KEY_ENV_CANDIDATES = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY"] as const;
const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

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

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTION_MODEL = "whisper-1";

/** Conservative shared upload ceiling. ElevenLabs' own limit is far
 * higher (5GB), but this route can fall back to Whisper — which caps at
 * 25MB — for the *same* uploaded file, so there's no benefit to a
 * larger limit here; a request that clears this already comfortably
 * clears both providers. In practice `lib/transcription.ts` compresses
 * anything close to Vercel's own 4.5MB request-body cap well below
 * this anyway (see `lib/audioCompression.ts`). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Hard ceiling on how long we'll wait on a single upstream call — a
 * real network outage or an unreachable host would otherwise hang until
 * the platform kills the function, leaving Stuart staring at a spinner
 * with no honest error to show. Comfortably under `maxDuration`, with
 * room for a second (fallback) attempt within the same request. */
const UPSTREAM_TIMEOUT_MS = 45_000;

interface NormalizedWord {
  word: string;
  startSec: number;
  endSec: number;
}

type TranscriptionProvider = "elevenlabs" | "openai";

type ProviderSuccess = { ok: true; words: NormalizedWord[]; durationSec: number | null };
type ProviderFailure = { ok: false; status: number; code: string; error: string };
type ProviderResult = ProviderSuccess | ProviderFailure;

const PROVIDER_LABEL: Record<TranscriptionProvider, string> = {
  elevenlabs: "ElevenLabs Scribe",
  openai: "OpenAI Whisper",
};

/** ElevenLabs error bodies are `{ detail: string }` or
 * `{ detail: { message, code, status, ... } }` (see
 * https://elevenlabs.io/docs/eleven-api/resources/errors) — pull out a
 * human-readable message from either shape without assuming which one
 * a given failure used. */
function extractElevenLabsErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
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
    const detail = extractElevenLabsErrorMessage(payload);
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: `ElevenLabs Scribe returned ${res.status}${detail ? `: ${detail}` : "."}`,
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

async function transcribeWithOpenAi(audio: File, apiKey: string): Promise<ProviderResult> {
  const form = new FormData();
  form.set("file", audio, audio.name || "audio.mp3");
  form.set("model", OPENAI_TRANSCRIPTION_MODEL);
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  let res: Response;
  try {
    res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
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
        ? `OpenAI Whisper did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s.`
        : `Could not reach OpenAI Whisper: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      detail = errBody?.error?.message ?? "";
    } catch {
      // Upstream didn't return JSON (rare, but don't let that crash the route).
    }
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: `OpenAI Whisper returned ${res.status}${detail ? `: ${detail}` : "."}`,
    };
  }

  let payload: { duration?: unknown; words?: unknown };
  try {
    payload = (await res.json()) as { duration?: unknown; words?: unknown };
  } catch {
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: "OpenAI Whisper returned an unparseable response.",
    };
  }

  const rawWords = Array.isArray(payload.words) ? (payload.words as Record<string, unknown>[]) : [];
  const words = rawWords
    .filter(
      (w): w is { word: string; start: number; end: number } =>
        typeof w.word === "string" && typeof w.start === "number" && typeof w.end === "number"
    )
    .map((w) => ({ word: w.word, startSec: w.start, endSec: w.end }));

  if (words.length === 0) {
    return {
      ok: false,
      status: 502,
      code: "no_words",
      error: "OpenAI Whisper succeeded but returned no word-level timestamps.",
    };
  }

  return {
    ok: true,
    words,
    durationSec: typeof payload.duration === "number" ? payload.duration : null,
  };
}

export async function POST(request: Request) {
  const elevenLabs = resolveElevenLabsApiKey();
  const openAiKey = process.env[OPENAI_API_KEY_ENV];

  if (!elevenLabs && !openAiKey) {
    return NextResponse.json(
      {
        error:
          `None of ${ELEVENLABS_API_KEY_ENV_CANDIDATES.join(", ")} or ${OPENAI_API_KEY_ENV} ` +
          "is set on the server \u2014 word-level transcription is unavailable here. " +
          "Falling back to the client-side energy heuristic. (Stuart's ElevenLabs key " +
          "is expected to already be on Vercel Production under one of those first " +
          "names \u2014 if it's there under a different name, add a one-line alias env " +
          "var rather than a new key.)",
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

  // ElevenLabs Scribe first (this build's primary path for music — see
  // the module doc comment for why); OpenAI Whisper only gets a turn if
  // ElevenLabs isn't configured, or its *request* itself failed (not a
  // sparse-but-real transcript, which `lib/skidmarks.ts` judges after
  // the fact using the actual word list either provider returns).
  const attempts: { provider: TranscriptionProvider; result: ProviderResult }[] = [];

  if (elevenLabs) {
    attempts.push({
      provider: "elevenlabs",
      result: await transcribeWithElevenLabs(audio, elevenLabs.key),
    });
  }

  const elevenLabsFailed = attempts.length > 0 && !attempts[0].result.ok;
  if ((elevenLabsFailed || attempts.length === 0) && openAiKey) {
    attempts.push({ provider: "openai", result: await transcribeWithOpenAi(audio, openAiKey) });
  }

  const success = attempts.find(
    (a): a is { provider: TranscriptionProvider; result: ProviderSuccess } => a.result.ok
  );
  if (success) {
    return NextResponse.json({
      words: success.result.words,
      durationSec: success.result.durationSec,
      provider: success.provider,
    });
  }

  // Every configured provider failed outright (network/upstream/timeout/
  // no_words) — report the most useful combination of reasons rather than
  // just the last one, so a real ElevenLabs outage that silently fell
  // through to a Whisper failure doesn't hide what actually happened.
  const failures = attempts.filter(
    (a): a is { provider: TranscriptionProvider; result: ProviderFailure } => !a.result.ok
  );
  const last = failures[failures.length - 1];
  if (!last) {
    // Unreachable given the guard above (at least one provider is
    // configured), but stay honest rather than throwing if it ever is.
    return NextResponse.json(
      { error: "No transcription provider is configured.", code: "missing_api_key" },
      { status: 501 }
    );
  }
  const message =
    failures.length > 1
      ? failures.map((f) => `${PROVIDER_LABEL[f.provider]}: ${f.result.error}`).join(" ")
      : last.result.error;

  return NextResponse.json({ error: message, code: last.result.code }, { status: last.result.status });
}
