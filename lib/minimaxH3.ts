/**
 * Server-only thin client for MiniMax's own documented H3 video-
 * generation API (platform.minimax.io/docs/guides/video-generation,
 * .../api-reference/video-generation-i2v) — the backend
 * `app/api/skidmarks/generate-clip/route.ts` calls for an
 * **Instrumental/B-roll** plate's video render, now the *default* for
 * that path (Stuart's 2026-09-13 "H3 please, for this smoke" lock —
 * see `lib/skidmarks.ts`'s `resolveInstrumentalVideoModel`). xAI Grok
 * Imagine video stays fully wired as the one-tap-away alternative; see
 * `app/api/skidmarks/generate-clip/route.ts`'s module doc comment for
 * how the two are routed.
 *
 * **Request/response shapes below are mirrored from the original
 * Skidmarks repo's own real, working H3 client**
 * (`comfybear71/skidmarks`, `src/lib/minimaxVideo.ts`/
 * `src/lib/minimaxH3.ts`), not invented from MiniMax's docs alone —
 * that repo's `minimaxSubmitVideo`/`minimaxPollVideo`/
 * `minimaxDownloadUrl` are the same shapes reproduced here
 * (`POST /v2/video_generation` → `{ task_id }`; `GET /v2/query/
 * video_generation/{task_id}` → `task.status` + `task.content.url`),
 * ported into this repo's own honest-outcome convention (a typed
 * `{ ok: false, status, code, error }` failure, same shape
 * `lib/comfyCloud.ts` already established for this app's other
 * server-only video-backend client — never throwing) instead of that
 * repo's own throw-on-error one.
 *
 * **Not live-verified in this sandbox** — same honesty caveat as
 * `lib/comfyCloud.ts`'s module doc comment: no `MINIMAX_API_KEY` is
 * available here to make a real call against. The original repo's own
 * client (mirrored above) is real, but porting its request/response
 * shapes into this repo's different failure-handling convention hasn't
 * itself been run against MiniMax's live API.
 *
 * **Two env vars, confirmed against the original repo's own
 * `.env.example`, nothing invented on top**: `MINIMAX_API_KEY`
 * (required) and `MINIMAX_GROUP_ID` (optional — only some MiniMax
 * accounts still need a `Group-Id` header; sent only when set). The
 * original repo's client also falls back to a second env var name,
 * `HAILUO_API_KEY` — deliberately **not** reproduced here, since the
 * task that added this file names only `MINIMAX_API_KEY`; a second
 * accepted name nobody asked for is exactly the kind of unasked-for
 * surface this repo's "don't invent" rule rules out.
 *
 * **Images travel as `data:` URLs, not an upload step** — unlike
 * `lib/comfyCloud.ts` (Comfy Cloud needs a separate `POST /api/upload/
 * image` call before a workflow can reference a file by name),
 * MiniMax's `content` array takes an `image_url.url` directly; the
 * original repo's own client already passes a data URL there
 * (`fileToSirayVideoDataUrl`), so this app's plate stills — already
 * `data:image/...` URLs, per `lib/skidmarks.ts`'s
 * `SkidmarksPlateStill.dataUrl` — need no extra conversion step.
 */

const API_KEY_ENV_VAR = "MINIMAX_API_KEY";
const GROUP_ID_ENV_VAR = "MINIMAX_GROUP_ID";
const MINIMAX_VIDEO_BASE = "https://api.minimax.io";

/** MiniMax-H3's real model id, per the original repo's own
 * `MINIMAX_H3_MODEL` constant (`src/lib/minimaxH3.ts`) — not invented. */
export const MINIMAX_H3_MODEL = "MiniMax-H3";

/** Official H3 output-resolution tiers (`768P`/`2K`) — `768P` is the
 * cheaper of the two ($0.08/s vs. $0.13/s per MiniMax's own published
 * pay-as-you-go pricing, platform.minimax.io/docs/guides/pricing-paygo),
 * same "cheapest documented tier by default, hardcoded not an env
 * override" cost lock this app's other two video backends already use
 * (`CLIP_RESOLUTION` in the Grok path; on the Vocal/LTX path the
 * equivalent lock is the verified `workflow/LTX_2.3_IA2V_Cloud.json`
 * template itself, which `lib/comfyCloud.ts` submits unmodified apart
 * from five patched node inputs). */
export const MINIMAX_H3_RESOLUTION = "768P";

export interface MinimaxCredentials {
  apiKey: string;
  groupId?: string;
}

/** Reads `MINIMAX_API_KEY` (required — no key means this feature isn't
 * wired here, the honest `missing_api_key` outcome, never a fake
 * attempt) and `MINIMAX_GROUP_ID` (optional). Returns `null`, never
 * throws, when the key is unset. */
export function resolveMinimaxCredentials(): MinimaxCredentials | null {
  const apiKey = process.env[API_KEY_ENV_VAR];
  if (!apiKey) return null;
  const groupId = process.env[GROUP_ID_ENV_VAR] || undefined;
  return groupId ? { apiKey, groupId } : { apiKey };
}

function authHeaders(creds: MinimaxCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
  };
  if (creds.groupId) headers["Group-Id"] = creds.groupId;
  return headers;
}

export type MinimaxFailure = { ok: false; status: number; code: string; error: string };

function networkFailure(prefix: string, err: unknown): MinimaxFailure {
  const timedOut = err instanceof Error && err.name === "TimeoutError";
  return {
    ok: false,
    status: 502,
    code: timedOut ? "timeout" : "network_error",
    error: timedOut
      ? `${prefix} did not respond in time.`
      : `Could not reach MiniMax (${prefix}): ${err instanceof Error ? err.message : "network error"}.`,
  };
}

/** MiniMax's own documented failure shapes vary across a bare `error`
 * string, an `{ error: { code, message } }` object, a `base_resp`
 * status envelope, or a nested `task.error` — mirrors the original
 * repo's own `minimaxError` (`src/lib/minimaxVideo.ts`), which already
 * had to account for all four against a real account. */
export function extractMinimaxErrorMessage(data: unknown): string {
  const d = (data ?? {}) as {
    error?: string | { message?: string; code?: string };
    message?: string;
    base_resp?: { status_msg?: string };
    task?: { error?: string | { message?: string } };
  };
  if (typeof d.error === "string" && d.error) return d.error;
  if (d.error && typeof d.error === "object") {
    return [d.error.code, d.error.message].filter(Boolean).join(": ");
  }
  if (d.task?.error) {
    return typeof d.task.error === "string" ? d.task.error : d.task.error.message ?? "";
  }
  if (d.base_resp?.status_msg) return d.base_resp.status_msg;
  if (typeof d.message === "string") return d.message;
  return "";
}

/** MiniMax's documented HTTP failure codes mirror the same general
 * shape this app's other two backends already classify (401/403 auth,
 * 402 payment, 429 rate limit, 400/422 invalid request) — MiniMax's
 * own docs don't spell out a distinct taxonomy beyond that, so this
 * reuses the same buckets rather than inventing new ones. */
function classifyMinimaxHttpFailure(status: number): { code: string } {
  if (status === 401 || status === 403) return { code: "auth_error" };
  if (status === 402) return { code: "payment_required" };
  if (status === 429) return { code: "rate_limited" };
  if (status === 400 || status === 422) return { code: "invalid_request" };
  return { code: "upstream_error" };
}

const SUBMIT_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface SubmitMinimaxH3VideoParams {
  prompt: string;
  /** The plate's own still — always sent (image-to-video mode never
   * omits it; this app never does H3 text-to-video). */
  firstImageUrl: string;
  /** Optional second frame — H3's documented first/last-frame mode.
   * This app's own UI never sends one today (`components/
   * SkidmarksClipRender.tsx` only ever selects one plate's still), but
   * the underlying request shape supports it, same "the route stays
   * generic even if the current UI only sends one" pattern as the
   * Grok path's `reference_images`. */
  lastImageUrl?: string;
  durationSec: number;
  resolution?: string;
}

export type SubmitMinimaxH3VideoOutcome = { ok: true; taskId: string } | MinimaxFailure;

/**
 * `POST /v2/video_generation` — request shape mirrored from the
 * original repo's `minimaxSubmitVideo` (`src/lib/minimaxVideo.ts`): a
 * `content` array carrying one `text` item (the prompt) plus one
 * `image_url` item per attached frame, each tagged `role:
 * "first_frame"`/`"last_frame"` — not a separate top-level `image`/
 * `last_image` field the way this app's Grok/Comfy backends shape
 * their own image inputs.
 */
export async function submitMinimaxH3Video(
  params: SubmitMinimaxH3VideoParams,
  creds: MinimaxCredentials
): Promise<SubmitMinimaxH3VideoOutcome> {
  const content: Record<string, unknown>[] = [
    { type: "text", text: params.prompt },
    { type: "image_url", image_url: { url: params.firstImageUrl }, role: "first_frame" },
  ];
  if (params.lastImageUrl) {
    content.push({ type: "image_url", image_url: { url: params.lastImageUrl }, role: "last_frame" });
  }

  let res: Response;
  try {
    res = await fetch(`${MINIMAX_VIDEO_BASE}/v2/video_generation`, {
      method: "POST",
      headers: authHeaders(creds),
      body: JSON.stringify({
        model: MINIMAX_H3_MODEL,
        content,
        duration: Math.round(params.durationSec),
        resolution: params.resolution || MINIMAX_H3_RESOLUTION,
      }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (err) {
    return networkFailure("submitting the H3 video job", err);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled by the !res.ok / no-task_id checks below either way.
  }

  if (!res.ok) {
    const { code } = classifyMinimaxHttpFailure(res.status);
    const message = extractMinimaxErrorMessage(payload);
    return {
      ok: false,
      status: res.status,
      code,
      error: `MiniMax returned HTTP ${res.status} submitting the H3 job${message ? `: ${message}` : "."}`,
    };
  }

  const body = (payload ?? {}) as { task_id?: unknown; taskId?: unknown; id?: unknown };
  const taskId = String(body.task_id ?? body.taskId ?? body.id ?? "").trim();
  if (!taskId) {
    return {
      ok: false,
      status: 502,
      code: "no_task_id",
      error: "MiniMax accepted the H3 job but returned no task_id to poll.",
    };
  }
  return { ok: true, taskId };
}

export type MinimaxH3PollOutcome =
  | { ok: true; status: "pending" }
  | { ok: true; status: "done"; videoUrl: string }
  | MinimaxFailure;

/**
 * `GET /v2/query/video_generation/{taskId}` — mirrors the original
 * repo's own `minimaxPollVideo` status taxonomy (pending/processing/
 * queued/queueing/preparing/running → still in flight; succeeded/
 * success/done → finished, reading `task.content.url`/`task.url`/a
 * bare `url` as a fallback chain; failed/cancelled/canceled/error →
 * failed) — not invented from MiniMax's docs alone. An unrecognized
 * status string is treated as still in flight rather than a hard
 * failure, same fallback the original repo's own client uses.
 */
export async function pollMinimaxH3Video(taskId: string, creds: MinimaxCredentials): Promise<MinimaxH3PollOutcome> {
  let res: Response;
  try {
    res = await fetch(`${MINIMAX_VIDEO_BASE}/v2/query/video_generation/${encodeURIComponent(taskId)}`, {
      headers: authHeaders(creds),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
  } catch (err) {
    return networkFailure("polling the H3 job", err);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled by the !res.ok check below.
  }

  if (!res.ok) {
    const { code } = classifyMinimaxHttpFailure(res.status);
    const message = extractMinimaxErrorMessage(payload);
    return {
      ok: false,
      status: res.status,
      code,
      error: `MiniMax returned HTTP ${res.status} polling the H3 job${message ? `: ${message}` : "."}`,
    };
  }

  const raw = (payload ?? {}) as Record<string, unknown>;
  const task = (raw.task && typeof raw.task === "object" ? raw.task : raw) as Record<string, unknown>;
  const status = String(task.status ?? raw.status ?? "").toLowerCase();

  if (["pending", "processing", "queued", "queueing", "preparing", "running"].includes(status)) {
    return { ok: true, status: "pending" };
  }
  if (status === "succeeded" || status === "success" || status === "done") {
    const content = (task.content && typeof task.content === "object" ? task.content : task) as { url?: unknown };
    const videoUrl = String(content.url ?? task.url ?? raw.url ?? "").trim();
    if (!videoUrl) {
      return {
        ok: false,
        status: 502,
        code: "no_video_output",
        error: "MiniMax's H3 job finished but returned no video url.",
      };
    }
    return { ok: true, status: "done", videoUrl };
  }
  if (status === "failed" || status === "cancelled" || status === "canceled" || status === "error") {
    const message = extractMinimaxErrorMessage(raw);
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: `MiniMax's H3 job failed${message ? `: ${message}` : "."}`,
    };
  }
  return { ok: true, status: "pending" };
}

export type DownloadMinimaxH3Outcome = { ok: true; bytes: Uint8Array } | MinimaxFailure;

/** MiniMax's returned video URL is a plain, unauthenticated download —
 * no `X-API-Key`/signed-URL redirect dance the way Comfy Cloud's
 * `/api/view` needs (mirrors the original repo's own
 * `minimaxDownloadUrl`, a bare `fetch(url)`). */
export async function downloadMinimaxH3Video(url: string): Promise<DownloadMinimaxH3Outcome> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    return networkFailure("downloading the finished H3 video", err);
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: `Downloading the finished H3 video returned HTTP ${res.status}.`,
    };
  }
  try {
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch {
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: "Could not read the finished H3 video's bytes.",
    };
  }
}
