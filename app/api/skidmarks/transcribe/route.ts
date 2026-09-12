import { NextResponse } from "next/server";

/**
 * POST /api/skidmarks/transcribe — the server half of Skidmarks' real
 * speech-to-text pass (see `lib/transcription.ts`'s module doc comment
 * for the full client-side contract and why this exists: Stuart's report
 * that the energy heuristic glued Jack Ash's "Talking To Concrete" intro
 * + flute into one giant Vocal segment, and his ask for phone-dictation-
 * style word start times instead of mid-band energy guessing).
 *
 * Accepts one `multipart/form-data` field, `audio` (the attached MP3
 * `File`, forwarded as-is from the browser — nothing is transcoded or
 * re-encoded here), and forwards it to OpenAI's audio transcription API
 * (`whisper-1`, `response_format: "verbose_json"`,
 * `timestamp_granularities: ["word"]`) using the server-side
 * `OPENAI_API_KEY` environment variable. Returns real per-word
 * `startSec`/`endSec` timestamps straight off that API's response — no
 * synthesized/interpolated timing here.
 *
 * **Never claims to be live without a key.** If `OPENAI_API_KEY` isn't
 * set, this returns `501` with `code: "missing_api_key"` — a distinct,
 * expected shape `lib/transcription.ts` reads as "transcription isn't
 * configured here" rather than "the request failed", so the client can
 * fall back to `lib/audioAnalysis.ts`'s energy heuristic honestly
 * instead of implying a real attempt errored out.
 *
 * This route only ever proxies a request Stuart already initiated by
 * attaching an MP3 in the UI — it doesn't store the audio, doesn't log
 * its contents, and holds nothing in memory beyond the single request/
 * response round-trip.
 */

export const runtime = "nodejs";
// Whisper transcription of a full song can run past the platform's
// default function timeout on some plans — this only raises the ceiling
// this route asks for; the platform's own plan limit still applies.
export const maxDuration = 120;

const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTION_MODEL = "whisper-1";
/** OpenAI's own hard cap for this endpoint — rejecting past it here gives
 * a clear message instead of a confusing upstream 4xx. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Hard ceiling on how long we'll wait on the upstream call — a real
 * network outage or an unreachable host would otherwise hang until the
 * platform kills the function, leaving Stuart staring at a spinner with
 * no honest error to show. Comfortably under `maxDuration`. */
const UPSTREAM_TIMEOUT_MS = 90_000;

interface OpenAiWord {
  word?: unknown;
  start?: unknown;
  end?: unknown;
}

interface OpenAiVerboseTranscription {
  duration?: unknown;
  words?: unknown;
}

export async function POST(request: Request) {
  const apiKey = process.env[OPENAI_API_KEY_ENV];
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          `${OPENAI_API_KEY_ENV} is not set on the server \u2014 word-level ` +
          "transcription is unavailable here. Falling back to the client-side " +
          "energy heuristic.",
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
        error: `Audio file is ${mb}MB \u2014 over the 25MB limit the transcription API accepts.`,
        code: "too_large",
      },
      { status: 413 }
    );
  }

  const upstreamForm = new FormData();
  upstreamForm.set("file", audio, audio.name || "audio.mp3");
  upstreamForm.set("model", OPENAI_TRANSCRIPTION_MODEL);
  upstreamForm.set("response_format", "verbose_json");
  upstreamForm.append("timestamp_granularities[]", "word");

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timedOut
          ? `Transcription API did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s.`
          : `Could not reach the transcription API: ${err instanceof Error ? err.message : "network error"}.`,
        code: timedOut ? "timeout" : "network_error",
      },
      { status: 502 }
    );
  }

  if (!upstreamRes.ok) {
    let detail = "";
    try {
      const errBody = (await upstreamRes.json()) as { error?: { message?: string } };
      detail = errBody?.error?.message ?? "";
    } catch {
      // Upstream didn't return JSON (rare, but don't let that crash the route).
    }
    return NextResponse.json(
      {
        error: `Transcription API returned ${upstreamRes.status}${detail ? `: ${detail}` : "."}`,
        code: "upstream_error",
      },
      { status: 502 }
    );
  }

  let payload: OpenAiVerboseTranscription;
  try {
    payload = (await upstreamRes.json()) as OpenAiVerboseTranscription;
  } catch {
    return NextResponse.json(
      { error: "Transcription API returned an unparseable response.", code: "upstream_error" },
      { status: 502 }
    );
  }

  const rawWords = Array.isArray(payload.words) ? (payload.words as OpenAiWord[]) : [];
  const words = rawWords
    .filter(
      (w): w is { word: string; start: number; end: number } =>
        typeof w.word === "string" && typeof w.start === "number" && typeof w.end === "number"
    )
    .map((w) => ({ word: w.word, startSec: w.start, endSec: w.end }));

  if (words.length === 0) {
    return NextResponse.json(
      {
        error: "Transcription succeeded but returned no word-level timestamps.",
        code: "no_words",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    words,
    durationSec: typeof payload.duration === "number" ? payload.duration : null,
  });
}
