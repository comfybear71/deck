/**
 * Server-only thin client for Siray's Model API (https://api.siray.ai,
 * docs.siray.ai) — the backend for the Seedance/"17 positions" upgrade
 * to Auto-plate (`lib/sirayPositions.ts`, `lib/autoPlate.ts`): given one
 * character's locked master reference still, generates a new angle of
 * that same character via Siray's Seedream 4.5 spicy still models: `bytedance/seedream-4.5-ref2i-spicy`
 * (reference-to-image — one reference + prompt) or `bytedance/seedream-4.5-t2i-spicy`
 * (text-to-image — prompt only, no reference).
 *
 * **Ported from Stuart's own other repo's proven Siray client**
 * (`comfybear71/skidmarks`'s `src/lib/sirayClient.ts`), which has real
 * calls behind it, not written from docs alone — same "port real code,
 * don't invent" rule this app followed for the LTX 2.3 port
 * (`lib/comfyCloud.ts`). This module only carries the still-image half
 * (`siraySubmitImageAsync`/`sirayPollImageTask`) — that reference
 * client's video-generation calls (Seedance/Wan i2v) are now also
 * ported below for the per-clip Instrumental **Siray** Render switch
 * (`alibaba/wan-3.0-i2v-spicy`) — Vocal stays LTX; Instrumental stays
 * H3/Grok/Siray opt-in. Adapted to this app's own honest-
 * outcome-object convention (`{ ok: false, status, code, error }`,
 * never throw) — same shape `lib/comfyCloud.ts`/`lib/minimaxH3.ts`
 * already use — rather than the reference client's own throw-on-failure
 * style.
 *
 * **Honesty note — this plumbing is ported, but not live-verified from
 * this sandbox.** `SIRAY_API_KEY` is set on Stuart's real Vercel
 * project, not here, so nothing in this module has been run against a
 * real Siray account from this environment. The only real proof is
 * Stuart running Auto-plate on a band with a master still set after a
 * deploy and getting back real, on-character stills — not a passing
 * test suite.
 */

const API_KEY_ENV_VAR = "SIRAY_API_KEY";
export const SIRAY_API_BASE = "https://api.siray.ai";

/** Seedream 4.5 ref2i Spicy — the one Siray model this app calls. Flat
 * $0.04/image at any allowed size, per the reference client's own
 * comment (confirmed against Siray's published Spicy 4.5 pricing, not
 * invented). No env override — same "cheapest/only documented tier,
 * hardcoded" cost lock this app's other providers already use
 * (`DEFAULT_LTX_FILENAME_PREFIX` et al. in `lib/comfyCloud.ts`). */
export const SIRAY_SEEDREAM_45_REF2I_SPICY = "bytedance/seedream-4.5-ref2i-spicy";
/**
 * Seedream 4.5 t2i Spicy — text-to-image (no reference). Same flat
 * $0.04/image tier as ref2i. Model id confirmed against Siray docs
 * (`docs.siray.ai` OpenAPI enum `bytedance/seedream-4.5-t2i-spicy`) and
 * Stuart's own `comfybear71/skidmarks` `src/lib/sirayClient.ts`
 * (`SIRAY_SEEDREAM_45_T2I_SPICY`). Used when a per-clip Siray still is
 * requested with no reference image.
 */
export const SIRAY_SEEDREAM_45_T2I_SPICY = "bytedance/seedream-4.5-t2i-spicy";
export const SIRAY_SEEDREAM_45_SIZE = "2048x2048";
export const SIRAY_SEEDREAM_45_COST_USD = 0.04;

/**
 * Wan 3.0 i2v Spicy — Instrumental plate→video for the per-clip Siray
 * Render switch. Model id + request shape from docs.siray.ai OpenAPI
 * (`alibaba/wan-3.0-i2v-spicy`) and Stuart's own
 * `comfybear71/skidmarks` `src/lib/sirayI2v.ts` (`wan-30`). Chosen over
 * Seedance 2.0 Spicy ($0.084/s, max 15s) because Stuart's music-video
 * parts run 6–17s and Wan 3.0 covers up to 30s; list price from Siray's
 * public model-verse API (`api-gateway.siray.ai/api/model-verse/models`,
 * `out_price: "0.045"`, `billing_type: "video"` → $/s).
 */
export const SIRAY_WAN_30_I2V_SPICY = "alibaba/wan-3.0-i2v-spicy";
export const SIRAY_WAN_30_I2V_SIZE = "720p";
export const SIRAY_WAN_30_I2V_ASPECT_RATIO = "adaptive";
/** Evidence: Siray model-verse `out_price` for this model id (USD per second). */
export const SIRAY_WAN_30_I2V_COST_USD_PER_SEC = 0.045;
export const SIRAY_I2V_MIN_DURATION_SEC = 2;
export const SIRAY_I2V_MAX_DURATION_SEC = 30;


export interface SirayCredentials {
  apiKey: string;
}

/** Reads `SIRAY_API_KEY` (required — no key means this path isn't wired
 * here, the honest `missing_api_key` outcome, never a fake attempt).
 * Returns `null`, never throws, when unset. */
export function resolveSirayCredentials(): SirayCredentials | null {
  const apiKey = process.env[API_KEY_ENV_VAR];
  if (!apiKey) return null;
  return { apiKey };
}

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** Gap between polls — the reference client's own default for image
 * tasks. */
export const SIRAY_POLL_INTERVAL_MS = 4_000;

export type SirayFailure = { ok: false; status: number; code: string; error: string };

function networkFailure(prefix: string, err: unknown, timedOutCode = "timeout"): SirayFailure {
  const timedOut = err instanceof Error && err.name === "TimeoutError";
  return {
    ok: false,
    status: 502,
    code: timedOut ? timedOutCode : "network_error",
    error: timedOut
      ? `${prefix} did not respond in time.`
      : `Could not reach Siray (${prefix}): ${err instanceof Error ? err.message : "network error"}.`,
  };
}

/** Siray's own documented HTTP failure codes follow the same rough
 * shape most of these provider APIs do — 401 bad/missing key, 402/429
 * billing/rate issues, 400 invalid request. Unlike Comfy Cloud's docs,
 * Siray's exact per-status meaning isn't independently confirmed here
 * (no `SIRAY_API_KEY` to check against), so this stays a conservative,
 * best-effort classification rather than a verified-per-code table. */
function classifySirayHttpFailure(status: number): { code: string } {
  if (status === 401 || status === 403) return { code: "auth_error" };
  if (status === 402) return { code: "payment_required" };
  if (status === 429) return { code: "rate_limited" };
  if (status === 400) return { code: "invalid_request" };
  return { code: "upstream_error" };
}

/** Siray wraps a rejected request's real reason under `code`/`error`/
 * `message`, sometimes nested under `data` — same defensive, shape-
 * agnostic reading the reference client's own `siraySubmitFailure`
 * uses. */
function extractSirayErrorMessage(payload: unknown): string {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const code = String(raw.code ?? "").trim();
  const rawError = raw.error;
  const msg =
    (typeof rawError === "string" ? rawError : (rawError as { message?: unknown } | undefined)?.message) ||
    String(raw.message ?? "").trim();
  const message = typeof msg === "string" ? msg : "";
  if (code && code.toLowerCase() !== "success") {
    return message && message !== code ? `${code}: ${message}` : code;
  }
  return message;
}

function parseSirayTaskId(payload: unknown): string {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const data = raw.data;
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    const fromNested = String(nested.task_id ?? nested.taskId ?? nested.id ?? "").trim();
    if (fromNested) return fromNested;
  }
  if (typeof data === "string" && data.trim()) return data.trim();
  return String(raw.task_id ?? raw.taskId ?? raw.id ?? "").trim();
}

export type SubmitStillOutcome = { ok: true; taskId: string } | SirayFailure;

/**
 * `POST /v1/images/generations/async` — submits one Seedream 4.5 ref2i
 * still generation (a character's master reference still + a position
 * prompt) and returns the async `task_id` used to poll for the result.
 */
export async function siraySubmitStillImage(
  prompt: string,
  referenceImageDataUrls: string[],
  creds: SirayCredentials
): Promise<SubmitStillOutcome> {
  // 0 refs → t2i spicy (text only). 1+ refs → ref2i spicy. Callers
  // (the route) currently cap at 1 reference; the API allows more.
  const hasRefs = referenceImageDataUrls.length > 0;
  const model = hasRefs ? SIRAY_SEEDREAM_45_REF2I_SPICY : SIRAY_SEEDREAM_45_T2I_SPICY;
  const body: Record<string, unknown> = {
    model,
    prompt,
    size: SIRAY_SEEDREAM_45_SIZE,
  };
  if (hasRefs) body.images = referenceImageDataUrls;

  let res: Response;
  try {
    res = await fetch(`${SIRAY_API_BASE}/v1/images/generations/async`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (err) {
    return networkFailure("submitting the still", err);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled below either way.
  }

  if (!res.ok) {
    const { code } = classifySirayHttpFailure(res.status);
    const message = extractSirayErrorMessage(payload);
    return {
      ok: false,
      status: res.status,
      code,
      error: `Siray returned HTTP ${res.status} submitting the still${message ? `: ${message}` : "."}`,
    };
  }

  const message = extractSirayErrorMessage(payload);
  const taskId = parseSirayTaskId(payload);
  if (!taskId) {
    return {
      ok: false,
      status: 502,
      code: "no_task_id",
      error: `Siray accepted the request but returned no task_id to track it${message ? `: ${message}` : "."}`,
    };
  }
  return { ok: true, taskId };
}

export type PollStillOutcome = { ok: true; outputUrl: string } | SirayFailure;

/**
 * Polls `GET /v1/images/generations/async/{taskId}` to completion.
 * `SUCCESS` with at least one output URL is done; `FAILURE` fails,
 * surfacing Siray's own `fail_reason` verbatim. Never hangs forever —
 * past `deadlineMs` this returns an honest `timeout` outcome, same
 * shape as `lib/comfyCloud.ts`'s `pollComfyCloudJob`.
 */
export async function sirayPollStillImage(
  taskId: string,
  creds: SirayCredentials,
  deadlineMs: number,
  pollIntervalMs: number = SIRAY_POLL_INTERVAL_MS
): Promise<PollStillOutcome> {
  const startedAt = Date.now();

  while (true) {
    let res: Response;
    try {
      res = await fetch(`${SIRAY_API_BASE}/v1/images/generations/async/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });
    } catch (err) {
      return networkFailure(`checking task ${taskId}`, err);
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // A 200 with unreadable JSON falls through as unknown status and
      // polls again below.
    }

    if (!res.ok) {
      const { code } = classifySirayHttpFailure(res.status);
      return { ok: false, status: res.status, code, error: `Siray returned HTTP ${res.status} checking the task.` };
    }

    const raw = (payload ?? {}) as Record<string, unknown>;
    const data = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
    const status = String(data.status ?? raw.status ?? "UNKNOWN").toUpperCase();

    if (status === "FAILURE") {
      const reason = String(data.fail_reason ?? data.failReason ?? data.error ?? raw.message ?? "").trim();
      return {
        ok: false,
        status: 502,
        code: "upstream_error",
        error: `Siray's generation failed${reason ? `: ${reason}` : "."}`,
      };
    }

    if (status === "SUCCESS") {
      const outputUrl = firstOutputUrl(data.outputs ?? data.output ?? data.result);
      if (!outputUrl) {
        return {
          ok: false,
          status: 502,
          code: "no_image",
          error: "Siray reported success but returned no image output to download.",
        };
      }
      return { ok: true, outputUrl };
    }

    if (Date.now() + pollIntervalMs - startedAt >= deadlineMs) {
      return {
        ok: false,
        status: 504,
        code: "timeout",
        error:
          `Siray's still was still ${status.toLowerCase()} after ${Math.round(deadlineMs / 1000)}s — this route ` +
          "stopped waiting. It may still finish on Siray's side, but this app has no way to check back on it; " +
          "try again in a bit.",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function firstOutputUrl(outputsRaw: unknown): string | null {
  if (Array.isArray(outputsRaw)) {
    for (const item of outputsRaw) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const url = String(row.url ?? row.image_url ?? "").trim();
        if (url) return url;
      }
    }
    return null;
  }
  if (typeof outputsRaw === "string" && outputsRaw.trim()) return outputsRaw.trim();
  return null;
}

export type DownloadStillOutcome = { ok: true; bytes: Uint8Array; contentType: string } | SirayFailure;

/** Downloads the finished still's bytes from Siray's own output URL —
 * plain GET, no auth header (an unrelated storage host, same "don't
 * replay our key at a third-party host" reasoning as
 * `lib/comfyCloud.ts`'s `downloadComfyCloudOutput`). */
export async function sirayDownloadStill(url: string): Promise<DownloadStillOutcome> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      return {
        ok: false,
        status: 502,
        code: "upstream_error",
        error: `Downloading the still from Siray returned HTTP ${res.status}.`,
      };
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { ok: true, bytes, contentType };
  } catch (err) {
    return networkFailure("downloading the still", err);
  }
}

/** Snap a clip length into Wan 3.0 Spicy's documented integer-second enum. */
export function clampSirayI2vDurationSec(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 5;
  return Math.max(SIRAY_I2V_MIN_DURATION_SEC, Math.min(SIRAY_I2V_MAX_DURATION_SEC, Math.round(durationSec)));
}

export type SubmitVideoOutcome = { ok: true; taskId: string } | SirayFailure;

/**
 * `POST /v1/video/generations` — async Wan 3.0 i2v Spicy submit.
 * Body shape matches docs.siray.ai OpenAPI + skidmarks' proven client
 * (`siraySubmitVideoAsync`): model, prompt, image (data URL or https),
 * duration (int), size, aspect_ratio.
 */
export async function siraySubmitVideoAsync(
  args: { prompt: string; image: string; durationSec: number },
  creds: SirayCredentials
): Promise<SubmitVideoOutcome> {
  const duration = clampSirayI2vDurationSec(args.durationSec);
  const body = {
    model: SIRAY_WAN_30_I2V_SPICY,
    prompt: args.prompt,
    image: args.image,
    duration,
    size: SIRAY_WAN_30_I2V_SIZE,
    aspect_ratio: SIRAY_WAN_30_I2V_ASPECT_RATIO,
  };
  let res: Response;
  try {
    res = await fetch(`${SIRAY_API_BASE}/v1/video/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (err) {
    return networkFailure("submitting the video", err);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled below.
  }

  if (!res.ok) {
    const { code } = classifySirayHttpFailure(res.status);
    const message = extractSirayErrorMessage(payload);
    return {
      ok: false,
      status: res.status,
      code,
      error: `Siray returned HTTP ${res.status} submitting the video${message ? `: ${message}` : "."}`,
    };
  }

  const message = extractSirayErrorMessage(payload);
  const taskId = parseSirayTaskId(payload);
  if (!taskId) {
    return {
      ok: false,
      status: 502,
      code: "no_task_id",
      error: `Siray accepted the video request but returned no task_id${message ? `: ${message}` : "."}`,
    };
  }
  return { ok: true, taskId };
}

export type PollVideoOutcome = { ok: true; outputUrl: string } | SirayFailure;

function firstVideoOutputUrl(outputsRaw: unknown): string | null {
  if (Array.isArray(outputsRaw)) {
    for (const item of outputsRaw) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const url = String(row.url ?? row.video_url ?? row.video ?? "").trim();
        if (url) return url;
      }
    }
    return null;
  }
  if (typeof outputsRaw === "string" && outputsRaw.trim()) return outputsRaw.trim();
  return null;
}

/**
 * Polls `GET /v1/video/generations/{taskId}` to SUCCESS/FAILURE — same
 * status vocabulary as the still poller, plus skidmarks' defensive
 * outputs shape reading. Surfaces Siray's fail_reason verbatim.
 */
export async function sirayPollVideoAsync(
  taskId: string,
  creds: SirayCredentials,
  deadlineMs: number,
  pollIntervalMs: number = SIRAY_POLL_INTERVAL_MS
): Promise<PollVideoOutcome> {
  const startedAt = Date.now();
  for (;;) {
    let res: Response;
    try {
      res = await fetch(`${SIRAY_API_BASE}/v1/video/generations/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });
    } catch (err) {
      return networkFailure("polling the video", err);
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // Handled below.
    }

    if (!res.ok) {
      const { code } = classifySirayHttpFailure(res.status);
      return {
        ok: false,
        status: res.status,
        code,
        error: `Siray returned HTTP ${res.status} checking the video task.`,
      };
    }

    const raw = (payload ?? {}) as Record<string, unknown>;
    const data = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
    const status = String(data.status ?? raw.status ?? "").toUpperCase();
    const failReason = String(
      data.fail_reason ?? data.failReason ?? data.error ?? raw.message ?? ""
    ).trim();

    if (status === "FAILURE" || status === "FAILED") {
      return {
        ok: false,
        status: 502,
        code: "upstream_error",
        error: `Siray's video generation failed${failReason ? `: ${failReason}` : "."}`,
      };
    }

    if (status === "SUCCESS") {
      const outputUrl = firstVideoOutputUrl(data.outputs ?? data.output ?? data.videos ?? data.result);
      if (!outputUrl) {
        return {
          ok: false,
          status: 502,
          code: "no_video",
          error: "Siray reported success but returned no video output URL to download.",
        };
      }
      return { ok: true, outputUrl };
    }

    if (Date.now() + pollIntervalMs - startedAt >= deadlineMs) {
      return {
        ok: false,
        status: 504,
        code: "timeout",
        error:
          `Siray's video was still ${status.toLowerCase() || "processing"} after ${Math.round(deadlineMs / 1000)}s — this route ` +
          "stopped waiting. Try again in a bit.",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export type DownloadVideoOutcome = { ok: true; bytes: Uint8Array; contentType: string } | SirayFailure;

/** Downloads finished mp4 bytes from Siray's output URL — no auth header. */
export async function sirayDownloadVideo(url: string): Promise<DownloadVideoOutcome> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      return {
        ok: false,
        status: 502,
        code: "upstream_error",
        error: `Downloading the video from Siray returned HTTP ${res.status}.`,
      };
    }
    const contentType = res.headers.get("content-type") || "video/mp4";
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { ok: true, bytes, contentType };
  } catch (err) {
    return networkFailure("downloading the video", err);
  }
}
