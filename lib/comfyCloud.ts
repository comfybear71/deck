/**
 * Server-only thin client for Comfy Cloud's own documented HTTP/
 * WebSocket API (https://cloud.comfy.org, docs.comfy.org/development/
 * cloud/api-reference) — the backend `app/api/skidmarks/generate-clip/
 * route.ts` calls for a **Vocal** plate's real video render (see this
 * repo's AGENTS.md, "Stuart lock (2026-09-13): LTX runs on Comfy
 * Cloud — not Fal, Replicate, or SIRAY for Vocal animation").
 *
 * **Endpoint shapes below are pulled directly from Comfy's own current
 * published docs, not guessed at** — `POST /api/prompt` (submit a
 * workflow graph, get back a `prompt_id`), `POST /api/upload/image`
 * (generic multipart upload into the `input` directory — despite the
 * path name, this is also how Comfy's own frontend uploads *audio* for
 * a `LoadAudio` node; see `src/extensions/core/uploadAudio.ts` in
 * Comfy-Org/ComfyUI_frontend, which POSTs to this exact same endpoint
 * under the `image` form field for an audio file), `GET /api/view`
 * (download a named output, 302-redirecting to a signed storage URL),
 * and the WebSocket (`wss://.../ws?clientId=...&token=<API key>`,
 * `executed`/`execution_success`/`execution_error` messages) used here
 * to learn a finished job's output filenames — the REST `GET /api/job/
 * {promptId}/status` endpoint Comfy also documents only reports a bare
 * `{status}` string, with no output filenames in it, so the WebSocket
 * is the one *documented* path on this reference to actually learn
 * what a finished job produced.
 *
 * **Honesty note — this plumbing is real, but not live-verified in this
 * sandbox.** Unlike this repo's xAI Grok routes (`app/api/skidmarks/
 * generate-still/route.ts`, `generate-clip/route.ts`'s existing
 * Instrumental path), which were exercised against a real, working key
 * while being built, there is no `COMFY_CLOUD_API_KEY` available in
 * this environment to make a real call against. Every endpoint path,
 * header name, and request/response shape below is copied from Comfy's
 * own current documentation (cited above) rather than invented, and the
 * `LtxApi25AudioToVideo`/`LoadImage`/`LoadAudio` node schemas in
 * `buildLtxAudioToVideoWorkflow` come from Comfy's own per-node
 * reference pages (docs.comfy.org/built-in-nodes/LtxApi25AudioToVideo)
 * — but the *whole graph*, wired together and submitted as one request,
 * has not been run against a real account. If the real API rejects a
 * specific field name or graph shape this file assumes, that surfaces
 * as this module's own honest `upstream_error`/`invalid_request`
 * outcome (never a fake success) — see this file's module doc comment
 * in `app/api/skidmarks/generate-clip/route.ts` for how that's
 * surfaced to Stuart.
 *
 * **No "workflow id"/deployment id needed, no model-override env var
 * either.** Unlike ComfyDeploy's `deployment_id`-based `POST /run/
 * deployment/queue` API (a different third-party product, not used
 * here per Stuart's explicit "Comfy Cloud" lock), Comfy Cloud's own
 * `/api/prompt` endpoint takes the *entire* workflow graph in the
 * request body — this app builds that graph itself
 * (`buildLtxAudioToVideoWorkflow`) rather than referencing a pre-saved
 * one by id. Only two env vars are real here, confirmed against the
 * original Skidmarks repo's own `.env.example`: `COMFY_CLOUD_API_KEY`
 * and `COMFY_URL` (blank = Comfy Cloud) — nothing else is invented.
 *
 * **LTX-2.5 is a Comfy "Partner Node"** (it calls out to Lightricks'
 * own hosted API, not a model Comfy itself runs) — Comfy's docs say a
 * request using one must carry the same API key a second time, in
 * `extra_data.api_key_comfy_org`, alongside the `X-API-Key` header used
 * for the Cloud API call itself. `submitComfyCloudWorkflow` below sends
 * both.
 */

/** Confirmed against the original Skidmarks repo's own `.env.example`
 * — these are the two real env var names, and the *only* two; nothing
 * here invents a third (a model override, a workflow/deployment id,
 * etc.) that repo doesn't already establish. */
const API_KEY_ENV_VAR = "COMFY_CLOUD_API_KEY";
/** Leave unset/blank to use Comfy Cloud's own hosted endpoint (the
 * common case); set it to point at a self-hosted/serverless ComfyUI
 * instance instead — same "blank means Cloud" convention the original
 * `.env.example` documents. */
const URL_ENV_VAR = "COMFY_URL";

const DEFAULT_BASE_URL = "https://cloud.comfy.org";
/** LTX-2.5 (Fast) is the cheaper of Comfy's two documented LTX-2.5
 * partner-node tiers ($0.09-0.13/s vs. Pro's $0.12-0.17/s per
 * Lightricks' own published API pricing, docs.ltx.io/pricing) — same
 * "cheapest documented tier by default" cost lock as
 * `app/api/skidmarks/generate-clip/route.ts`'s existing `CLIP_RESOLUTION
 * = "480p"` for the Grok path. Hardcoded, not an env override — unlike
 * `XAI_VIDEO_MODEL`, the confirmed `.env.example` doesn't establish a
 * model-override var for Comfy, and this repo's lock is "don't invent
 * other Comfy key names." */
export const DEFAULT_LTX_MODEL = "LTX-2.5 (Fast)";

export interface ComfyCloudCredentials {
  apiKey: string;
  baseUrl: string;
}

/** Reads `COMFY_CLOUD_API_KEY` (required — no key means this feature
 * isn't wired here, the honest `missing_api_key` outcome, never a fake
 * attempt) and `COMFY_URL` (optional; blank/unset means Comfy Cloud's
 * own hosted endpoint). Returns `null`, never throws, when the key is
 * unset. */
export function resolveComfyCloudCredentials(): ComfyCloudCredentials | null {
  const apiKey = process.env[API_KEY_ENV_VAR];
  if (!apiKey) return null;
  const baseUrl = (process.env[URL_ENV_VAR] || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

function wsUrlFor(baseUrl: string, apiKey: string, clientId: string): string {
  const wsBase = baseUrl.replace(/^http/, "ws");
  return `${wsBase}/ws?clientId=${encodeURIComponent(clientId)}&token=${encodeURIComponent(apiKey)}`;
}

function generateClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const UPLOAD_TIMEOUT_MS = 30_000;
const SUBMIT_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export type ComfyCloudFailure = { ok: false; status: number; code: string; error: string };

function networkFailure(prefix: string, err: unknown, timedOutCode = "timeout"): ComfyCloudFailure {
  const timedOut = err instanceof Error && err.name === "TimeoutError";
  return {
    ok: false,
    status: 502,
    code: timedOut ? timedOutCode : "network_error",
    error: timedOut
      ? `${prefix} did not respond in time.`
      : `Could not reach Comfy Cloud (${prefix}): ${err instanceof Error ? err.message : "network error"}.`,
  };
}

/** Comfy's documented HTTP failure codes (docs.comfy.org/development/
 * cloud/api-reference, "Error Handling"): 400 invalid workflow/fields,
 * 401 bad/missing key, 402 insufficient credits, 429 subscription
 * inactive, 500 internal error. */
function classifyComfyHttpFailure(status: number): { code: string } {
  if (status === 401) return { code: "auth_error" };
  if (status === 402) return { code: "payment_required" };
  if (status === 429) return { code: "rate_limited" };
  if (status === 400) return { code: "invalid_request" };
  return { code: "upstream_error" };
}

export type UploadInputOutcome =
  | { ok: true; name: string; subfolder: string }
  | ComfyCloudFailure;

/**
 * `POST /api/upload/image` — uploads raw bytes into Comfy Cloud's
 * `input` directory so a `LoadImage`/`LoadAudio` node in the submitted
 * workflow can reference it by filename. Works for audio despite the
 * path's name (see this module's doc comment) — the field is always
 * called `image` regardless of the actual file's real content type.
 */
export async function uploadComfyCloudInput(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
  creds: ComfyCloudCredentials
): Promise<UploadInputOutcome> {
  const form = new FormData();
  // `new Uint8Array(bytes)` (rather than `bytes` directly) guarantees a
  // plain `ArrayBuffer`-backed copy \u2014 `Blob`'s `BlobPart` type doesn't
  // accept the wider `ArrayBufferLike` a `Uint8Array` can otherwise be
  // backed by (e.g. a `SharedArrayBuffer`), even though every real
  // caller here only ever passes a plain-`ArrayBuffer`-backed one.
  form.set("image", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  form.set("type", "input");
  form.set("overwrite", "true");

  let res: Response;
  try {
    res = await fetch(`${creds.baseUrl}/api/upload/image`, {
      method: "POST",
      headers: { "X-API-Key": creds.apiKey },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    return networkFailure(`uploading ${filename}`, err);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled by the !res.ok check below.
  }

  if (!res.ok) {
    const { code } = classifyComfyHttpFailure(res.status);
    return {
      ok: false,
      status: res.status,
      code,
      error: `Comfy Cloud rejected uploading ${filename} with HTTP ${res.status}.`,
    };
  }

  const body = (payload ?? {}) as { name?: unknown; subfolder?: unknown };
  const name = typeof body.name === "string" && body.name ? body.name : filename;
  const subfolder = typeof body.subfolder === "string" ? body.subfolder : "";
  return { ok: true, name, subfolder };
}

export type SubmitWorkflowOutcome = { ok: true; promptId: string } | ComfyCloudFailure;

/**
 * `POST /api/prompt` — submits a full workflow graph (API format: `{
 * [nodeId]: { class_type, inputs } }`) and returns the `prompt_id` used
 * to track it. Always includes `extra_data.api_key_comfy_org` (see this
 * module's doc comment's Partner Node note) since every workflow this
 * app submits uses the `LtxApi25AudioToVideo` partner node.
 */
export async function submitComfyCloudWorkflow(
  workflow: Record<string, unknown>,
  creds: ComfyCloudCredentials
): Promise<SubmitWorkflowOutcome> {
  let res: Response;
  try {
    res = await fetch(`${creds.baseUrl}/api/prompt`, {
      method: "POST",
      headers: { "X-API-Key": creds.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, extra_data: { api_key_comfy_org: creds.apiKey } }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (err) {
    return networkFailure("submitting the workflow", err);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled below either way.
  }

  if (!res.ok) {
    const { code } = classifyComfyHttpFailure(res.status);
    const message = typeof (payload as { error?: unknown })?.error === "string" ? (payload as { error: string }).error : "";
    return {
      ok: false,
      status: res.status,
      code,
      error: `Comfy Cloud returned HTTP ${res.status} submitting the workflow${message ? `: ${message}` : "."}`,
    };
  }

  const body = (payload ?? {}) as { prompt_id?: unknown; error?: unknown };
  if (typeof body.error === "string" && body.error) {
    return { ok: false, status: 422, code: "invalid_request", error: `Comfy Cloud rejected the workflow: ${body.error}` };
  }
  if (typeof body.prompt_id !== "string" || !body.prompt_id) {
    return {
      ok: false,
      status: 502,
      code: "no_prompt_id",
      error: "Comfy Cloud accepted the workflow but returned no prompt_id to track it.",
    };
  }
  return { ok: true, promptId: body.prompt_id };
}

export interface ComfyCloudOutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

export type WaitForCompletionOutcome =
  | { ok: true; videoFile: ComfyCloudOutputFile }
  | ComfyCloudFailure;

/** Minimal shape of the WebSocket implementation this module needs —
 * matches both the browser/Node global `WebSocket` and a fake test
 * double (`lib/comfyCloud.test.ts`) without depending on either's full
 * interface. Accepting this as an injectable param (rather than always
 * reaching for the global) is what makes `waitForComfyCloudCompletion`
 * unit-testable without a real socket. */
export interface MinimalWebSocket {
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
}
export type WebSocketCtor = new (url: string) => MinimalWebSocket;

function resolveDefaultWebSocketCtor(): WebSocketCtor | null {
  return typeof WebSocket !== "undefined" ? (WebSocket as unknown as WebSocketCtor) : null;
}

interface ComfyWsMessage {
  type?: string;
  data?: {
    prompt_id?: string;
    node?: string;
    output?: { video?: ComfyCloudOutputFile[] };
    exception_message?: string;
  };
}

/**
 * Opens Comfy Cloud's documented WebSocket, waits for this specific
 * `promptId`'s `execution_success` (collecting any `executed` node's
 * `output.video` along the way — the `SaveVideo` node in
 * `buildLtxAudioToVideoWorkflow`) or `execution_error`, and resolves
 * honestly either way. Never hangs forever — `deadlineMs` closes the
 * socket and reports a real `timeout` outcome, mirroring
 * `app/api/skidmarks/generate-clip/route.ts`'s existing xAI
 * `POLL_DEADLINE_MS`/"no resume after timeout" shape.
 */
export function waitForComfyCloudCompletion(
  promptId: string,
  creds: ComfyCloudCredentials,
  deadlineMs: number,
  webSocketCtor: WebSocketCtor | null = resolveDefaultWebSocketCtor()
): Promise<WaitForCompletionOutcome> {
  return new Promise((resolve) => {
    if (!webSocketCtor) {
      resolve({
        ok: false,
        status: 500,
        code: "no_websocket",
        error: "This server runtime has no WebSocket implementation available to watch the Comfy Cloud job.",
      });
      return;
    }

    let settled = false;
    let videoFile: ComfyCloudOutputFile | undefined;
    let ws: MinimalWebSocket;

    const settle = (outcome: WaitForCompletionOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Best-effort close — the outcome above already reflects reality.
      }
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      settle({
        ok: false,
        status: 504,
        code: "timeout",
        error:
          `Comfy Cloud's job was still running after ${Math.round(deadlineMs / 1000)}s \u2014 this route stopped ` +
          "waiting. The render may still finish on Comfy's side, but this app has no way to check back on it; " +
          "try again in a bit.",
      });
    }, deadlineMs);

    try {
      ws = new webSocketCtor(wsUrlFor(creds.baseUrl, creds.apiKey, generateClientId()));
    } catch (err) {
      clearTimeout(timer);
      resolve({
        ok: false,
        status: 502,
        code: "network_error",
        error: `Could not open a WebSocket to Comfy Cloud: ${err instanceof Error ? err.message : "unknown error"}.`,
      });
      return;
    }

    ws.onerror = (event) => {
      settle({
        ok: false,
        status: 502,
        code: "network_error",
        error: `Comfy Cloud's WebSocket reported an error: ${event instanceof Error ? event.message : "connection error"}.`,
      });
    };

    ws.onmessage = (event) => {
      let parsed: ComfyWsMessage;
      try {
        parsed = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as ComfyWsMessage;
      } catch {
        return; // A binary preview frame or malformed text — not this job's completion signal.
      }
      if (parsed.data?.prompt_id !== promptId) return;

      if (parsed.type === "executed" && parsed.data.output?.video?.length) {
        videoFile = parsed.data.output.video[0];
        return;
      }
      if (parsed.type === "execution_success") {
        if (videoFile) {
          settle({ ok: true, videoFile });
        } else {
          settle({
            ok: false,
            status: 502,
            code: "no_video_output",
            error: "Comfy Cloud's job finished successfully but reported no video output to download.",
          });
        }
        return;
      }
      if (parsed.type === "execution_error") {
        settle({
          ok: false,
          status: 502,
          code: "upstream_error",
          error: `Comfy Cloud's job failed: ${parsed.data.exception_message ?? "unknown error"}.`,
        });
      }
    };
  });
}

export type DownloadOutputOutcome = { ok: true; bytes: Uint8Array } | ComfyCloudFailure;

/**
 * `GET /api/view` — Comfy's documented download path 302-redirects to
 * a signed storage URL; per Comfy's own example code, the *redirect*
 * request needs `X-API-Key`, but the final signed-URL fetch must not
 * carry it (an unrelated storage host that our own key means nothing
 * to). `redirect: "manual"` + a second, header-free fetch reproduces
 * that exactly rather than letting `fetch` auto-follow (which could
 * silently replay our header at a third-party host).
 */
export async function downloadComfyCloudOutput(
  file: ComfyCloudOutputFile,
  creds: ComfyCloudCredentials
): Promise<DownloadOutputOutcome> {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder ?? "",
    type: file.type ?? "output",
  });

  let redirectRes: Response;
  try {
    redirectRes = await fetch(`${creds.baseUrl}/api/view?${params.toString()}`, {
      headers: { "X-API-Key": creds.apiKey },
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    return networkFailure(`downloading ${file.filename}`, err);
  }

  // A same-origin (non-redirecting) deployment could plausibly serve
  // the bytes directly on a 200 instead of a 302 — accept either rather
  // than assuming Comfy Cloud's documented example's exact redirect
  // behavior is the *only* valid response shape.
  let finalRes: Response;
  if (redirectRes.status === 302 || redirectRes.status === 301 || redirectRes.status === 307) {
    const location = redirectRes.headers.get("location");
    if (!location) {
      return {
        ok: false,
        status: 502,
        code: "upstream_error",
        error: `Comfy Cloud's download redirect for ${file.filename} had no location header.`,
      };
    }
    try {
      finalRes = await fetch(location, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (err) {
      return networkFailure(`downloading ${file.filename} from its signed URL`, err);
    }
  } else {
    finalRes = redirectRes;
  }

  if (!finalRes.ok) {
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: `Downloading ${file.filename} from Comfy Cloud returned HTTP ${finalRes.status}.`,
    };
  }

  try {
    const buf = await finalRes.arrayBuffer();
    return { ok: true, bytes: new Uint8Array(buf) };
  } catch {
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: `Could not read ${file.filename}'s bytes after downloading it from Comfy Cloud.`,
    };
  }
}

export interface LtxAudioToVideoWorkflowInputs {
  imageFilename: string;
  audioFilename: string;
  prompt: string;
  model: string;
  seed?: number;
}

/**
 * Builds the one workflow graph this feature ever submits — API-format
 * JSON (`{ [nodeId]: { class_type, inputs } }`, edges as `[sourceNodeId,
 * outputIndex]` — ComfyUI's own universal graph-export shape, not
 * specific to this node), wiring together:
 * - `LoadImage` (node `"1"`) — the selected plate's own still, already
 *   uploaded via `uploadComfyCloudInput`.
 * - `LoadAudio` (node `"2"`) — this plate's own sliced vocal-performance
 *   audio (`lib/mp3Slice.ts`), also already uploaded.
 * - `LtxApi25AudioToVideo` (node `"3"`) — the actual partner-node call;
 *   inputs match that node's own documented schema exactly (`audio`,
 *   `model`, `prompt`, `seed`, optional `image` — docs.comfy.org/
 *   built-in-nodes/LtxApi25AudioToVideo). Its own documented behavior:
 *   the **audio's length sets the output video's duration** (2-20s,
 *   raises an error outside that range) — this is why the plate's
 *   sliced audio window, not a separate duration field, is what
 *   actually controls how long the rendered clip runs.
 * - `SaveVideo` (node `"4"`) — writes the node's `video` output so it
 *   shows up in the `executed` WebSocket message
 *   `waitForComfyCloudCompletion` reads. `SaveVideo`'s own exact input
 *   names (`video`, `filename_prefix`) follow ComfyUI's general
 *   save-node convention (matching `SaveImage`'s `images`/
 *   `filename_prefix` shape) rather than a `SaveVideo`-specific doc
 *   page fetched for this build — flagged per this module's "not
 *   live-verified" honesty note.
 */
export function buildLtxAudioToVideoWorkflow(inputs: LtxAudioToVideoWorkflowInputs): Record<string, unknown> {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: { image: inputs.imageFilename },
    },
    "2": {
      class_type: "LoadAudio",
      inputs: { audio: inputs.audioFilename },
    },
    "3": {
      class_type: "LtxApi25AudioToVideo",
      inputs: {
        audio: ["2", 0],
        image: ["1", 0],
        model: inputs.model,
        prompt: inputs.prompt,
        seed: inputs.seed ?? 42,
      },
    },
    "4": {
      class_type: "SaveVideo",
      inputs: {
        video: ["3", 0],
        filename_prefix: "skidmarks_ltx",
      },
    },
  };
}
