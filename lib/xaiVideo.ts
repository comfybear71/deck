/**
 * Server-only xAI Grok Imagine video client, moved out of
 * `app/api/skidmarks/generate-clip/route.ts` (2026-09-30) so the
 * Sunnybank silent-row path can use the exact same start / poll code
 * instead of a second copy. Behaviour and error text are unchanged; the
 * generate-clip route still decides the request body (its 1080p lock,
 * reference images, 16:9 padding) and passes its own poll deadline.
 *
 * API: https://docs.x.ai/developers/rest-api-reference/inference/videos
 * (`POST /v1/videos/generations` → `request_id`; `GET /v1/videos/{id}`
 * until `status: "done"`). The API has no switch to turn off the
 * generated soundtrack, so a silent row replaces it afterwards
 * (`muxClipAudio` with a silent track).
 */

const XAI_VIDEO_MODEL_ENV_VAR = "XAI_VIDEO_MODEL";
export const XAI_VIDEO_GENERATIONS_URL = "https://api.x.ai/v1/videos/generations";
export const xaiVideoStatusUrl = (requestId: string) => `https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`;
/** The current xAI video model as of this build. */
export const DEFAULT_XAI_VIDEO_MODEL = "grok-imagine-video-1.5";

const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export function resolveXaiVideoModel(): string {
  return process.env[XAI_VIDEO_MODEL_ENV_VAR] || DEFAULT_XAI_VIDEO_MODEL;
}

/** Same OpenAI-compatible error shape as `app/api/skidmarks/generate-still/
 * route.ts`'s `extractXaiErrorMessage` — xAI's synchronous "the request
 * itself was rejected" errors (bad key, malformed body) use this shape;
 * a job that started fine but failed *during* generation instead reports
 * through `classifyXaiVideoJobError` below. */
export function extractXaiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const err = (payload as { error?: unknown }).error;
  if (typeof err === "string") return err || null;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    return typeof message === "string" && message ? message : null;
  }
  return null;
}

/** Classifies a failed *synchronous* HTTP response — either the
 * initial `POST /v1/videos/generations` start call being rejected (bad
 * key, bad body, rate limit) or a later `GET /v1/videos/{request_id}`
 * poll itself returning a non-2xx (as opposed to a 200 whose *body*
 * reports `status: "failed"` — see `classifyXaiVideoJobError` for
 * that, separate, case). */
export function classifyXaiVideoHttpFailure(upstreamStatus: number): { httpStatus: number; code: string } {
  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return { httpStatus: upstreamStatus, code: "auth_error" };
  }
  if (upstreamStatus === 429) return { httpStatus: 429, code: "rate_limited" };
  if (upstreamStatus === 402) return { httpStatus: 402, code: "payment_required" };
  if (upstreamStatus === 400 || upstreamStatus === 422) {
    return { httpStatus: 422, code: "invalid_request" };
  }
  return { httpStatus: 502, code: "upstream_error" };
}

/** Classifies a *deferred job* failure — the start call succeeded (a
 * real `request_id` came back) but polling `GET /v1/videos/{request_id}`
 * eventually reported `status: "failed"` with this documented
 * `error.code`. */
export function classifyXaiVideoJobError(code: string | undefined): { httpStatus: number; code: string } {
  switch (code) {
    case "invalid_argument":
      return { httpStatus: 422, code: "invalid_request" };
    case "permission_denied":
      return { httpStatus: 403, code: "permission_denied" };
    case "failed_precondition":
      return { httpStatus: 422, code: "unsupported_request" };
    case "service_unavailable":
      return { httpStatus: 503, code: "upstream_unavailable" };
    default:
      return { httpStatus: 502, code: "upstream_error" };
  }
}

export type XaiVideoFailure = { ok: false; status: number; code: string; error: string };
export type XaiVideoStartOutcome = { ok: true; requestId: string } | XaiVideoFailure;

/** `POST /v1/videos/generations` with a body the caller already built
 * (model, prompt, duration, resolution, aspect ratio, image). */
export async function postXaiVideoGeneration(
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number = DEFAULT_START_TIMEOUT_MS
): Promise<XaiVideoStartOutcome> {
  let res: Response;
  try {
    res = await fetch(XAI_VIDEO_GENERATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      code: timedOut ? "timeout" : "network_error",
      error: timedOut
        ? `xAI's video API did not respond within ${timeoutMs / 1000}s.`
        : `Could not reach xAI's video API: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled by the !res.ok / no-request_id checks below either way.
  }

  if (!res.ok) {
    const message = extractXaiErrorMessage(payload);
    const { httpStatus, code } = classifyXaiVideoHttpFailure(res.status);
    return {
      ok: false,
      status: httpStatus,
      code,
      error: `xAI's video API returned ${res.status}${message ? `: ${message}` : "."}`,
    };
  }

  const requestId = (payload as { request_id?: unknown } | null)?.request_id;
  if (typeof requestId !== "string" || !requestId) {
    return {
      ok: false,
      status: 502,
      code: "no_request_id",
      error: "xAI's video API accepted the request but returned no request_id to poll.",
    };
  }
  return { ok: true, requestId };
}

export type XaiVideoPollOutcome = { ok: true; videoUrl: string; durationSec: number } | XaiVideoFailure;

interface XaiVideoStatusBody {
  status?: unknown;
  video?: { url?: unknown; duration?: unknown; respect_moderation?: unknown };
  error?: { code?: unknown; message?: unknown };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `GET /v1/videos/{request_id}` every `intervalMs` until done,
 * failed, expired, or `deadlineMs` runs out (an honest `timeout`). */
export async function pollXaiVideoJob(
  requestId: string,
  apiKey: string,
  requestedDurationSec: number,
  options: { deadlineMs: number; intervalMs: number; pollTimeoutMs?: number }
): Promise<XaiVideoPollOutcome> {
  const deadline = Date.now() + options.deadlineMs;
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;

  while (true) {
    let res: Response;
    try {
      res = await fetch(xaiVideoStatusUrl(requestId), {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(pollTimeoutMs),
      });
    } catch (err) {
      return {
        ok: false,
        status: 502,
        code: "network_error",
        error: `Could not reach xAI's video API while polling: ${err instanceof Error ? err.message : "network error"}.`,
      };
    }

    let payload: XaiVideoStatusBody | null = null;
    try {
      payload = (await res.json()) as XaiVideoStatusBody;
    } catch {
      // Handled by the !res.ok check below.
    }

    if (!res.ok) {
      const message = extractXaiErrorMessage(payload);
      const { httpStatus, code } = classifyXaiVideoHttpFailure(res.status);
      return {
        ok: false,
        status: httpStatus,
        code,
        error: `xAI's video API returned ${res.status} while polling${message ? `: ${message}` : "."}`,
      };
    }

    const status = payload?.status;

    if (status === "done") {
      const videoUrl = typeof payload?.video?.url === "string" ? payload.video.url : "";
      const respectsModeration = payload?.video?.respect_moderation !== false;
      if (!respectsModeration || !videoUrl) {
        return {
          ok: false,
          status: 502,
          code: "moderated",
          error: "xAI's video render was blocked by moderation and returned no playable video.",
        };
      }
      const durationSec =
        typeof payload?.video?.duration === "number" ? payload.video.duration : requestedDurationSec;
      return { ok: true, videoUrl, durationSec };
    }

    if (status === "failed") {
      const code = typeof payload?.error?.code === "string" ? payload.error.code : undefined;
      const message = typeof payload?.error?.message === "string" ? payload.error.message : undefined;
      const { httpStatus, code: mappedCode } = classifyXaiVideoJobError(code);
      return {
        ok: false,
        status: httpStatus,
        code: mappedCode,
        error: `xAI's video render failed${message ? `: ${message}` : "."}`,
      };
    }

    if (status === "expired") {
      return {
        ok: false,
        status: 504,
        code: "expired",
        error: "xAI's video render request expired before finishing.",
      };
    }

    // "pending" (or any other in-flight value) — keep polling until the
    // deadline. Past it the render may still finish on xAI's side, but
    // nothing here checks back on it.
    if (Date.now() + options.intervalMs > deadline) {
      return {
        ok: false,
        status: 504,
        code: "timeout",
        error:
          `xAI's video render was still processing after ${Math.round(options.deadlineMs / 1000)}s \u2014 this ` +
          "route stopped waiting. The render may still finish on xAI's side, but this app has no way to check " +
          "back on it; try again in a bit.",
      };
    }
    await sleep(options.intervalMs);
  }
}

export type XaiVideoDownloadOutcome = { ok: true; bytes: Uint8Array } | XaiVideoFailure;

/** Downloads a finished Grok video (xAI's own temporary URL). */
export async function downloadXaiVideo(url: string): Promise<XaiVideoDownloadOutcome> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: "network_error",
      error: `Could not download the finished Grok video: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: `Downloading the finished Grok video returned HTTP ${res.status}.`,
    };
  }
  try {
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch {
    return { ok: false, status: 502, code: "upstream_error", error: "Could not read the finished Grok video's bytes." };
  }
}
