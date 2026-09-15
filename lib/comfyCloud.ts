/**
 * Server-only thin client for Comfy Cloud's own HTTP API
 * (https://cloud.comfy.org) — the backend `app/api/skidmarks/
 * generate-clip/route.ts` calls for a **Vocal** plate's real video
 * render (see this repo's AGENTS.md, "Stuart lock (2026-09-13): LTX
 * runs on Comfy Cloud — not Fal, Replicate, or SIRAY for Vocal
 * animation").
 *
 * **This is a port of the original Skidmarks repo's own real, working
 * Cloud client** (`src/lib/comfyCloudClient.ts` +
 * `src/lib/ltxCloudIa2v.ts` there), not a doc-derived reimplementation.
 * Every endpoint path, field name and job-status string below is what
 * that client actually uses against a live Comfy Cloud account with
 * 100+ real LTX renders behind it:
 * - `POST /api/upload/image` — generic multipart upload into the
 *   `input` directory; the form field is called `image` even for an
 *   mp3 (that's how Comfy's own frontend uploads audio for `LoadAudio`).
 * - `POST /api/prompt` — body is just `{ prompt }` (the full API-format
 *   graph). **No `extra_data.api_key_comfy_org`** — that second key
 *   copy is only needed by Comfy *partner* nodes, and the LTX 2.3 graph
 *   this app submits has none (it runs checkpoints/LoRAs/samplers
 *   inside Comfy itself).
 * - `GET /api/jobs/{promptId}` — **plural `jobs`, not
 *   `/api/history/{id}`.** The original client carries a standing
 *   comment saying exactly this; `/api/history/{id}` is the *local*
 *   ComfyUI shape and is not the Cloud one.
 * - `GET /api/view` — download a named output, 302-redirecting to a
 *   signed storage URL.
 *
 * **Why polling and not a WebSocket.** An earlier pass here watched
 * Comfy's WebSocket for `executed`/`execution_success`. Besides not
 * being what the proven client does, a long-lived socket inside a
 * Vercel serverless function was never going to be reliable. This
 * module polls `GET /api/jobs/{promptId}` on an interval with an
 * honest deadline instead.
 *
 * **Why LTX 2.3 and not the hosted `LtxApi25AudioToVideo` partner
 * node.** A previous pass built a small four-node graph around that
 * partner node, written off doc pages. It failed validation on the
 * first real call (`required_input_missing` for `model.resolution` —
 * its `model` input is a DynamicCombo that flattens to dotted sibling
 * keys in API-format JSON), and had two further faults behind that one
 * (`SaveVideo` also needs `format`/`format.codec`; the node hard-
 * rejects driving audio outside 2–20s in its own `execute()`, while
 * Stuart renders 30s clips routinely). The original Skidmarks repo
 * never used that node at all — it submits the full, self-contained
 * LTX 2.3 graph in `workflow/LTX_2.3_IA2V_Cloud.json`. That is the
 * path with real renders behind it, so that is the path this app
 * takes now. Duration is an ordinary graph input here (node
 * `340:331`), so there is no hosted-node duration ceiling to work
 * around.
 *
 * **The template is a verified artifact, not source code** — a graph
 * export, not something to hand-edit or "tidy." It is imported as a
 * TypeScript JSON module (`resolveJsonModule`) rather than read off
 * disk with `fs`, because an `fs` read of a non-traced file is fragile
 * on Vercel.
 *
 * **Re-synced 2026-09-15 against Stuart's real, live Comfy Cloud
 * workflow** — a direct export from his account, not the earlier
 * byte-for-byte copy from the *original* Skidmarks repo. That earlier
 * copy had drifted from what's actually live: it referenced a
 * `talkvid-3k` ID LoRA node (and an `LTXVReferenceAudio` identity node)
 * that turned out not to exist in Stuart's real workflow at all — this
 * app had been claiming a face-lock LoRA was in play that never really
 * was. The live export confirmed no such thing is
 * there, so it was never a real lever to test. `buildLtx23Ia2vWorkflow`
 * patches specific node inputs, documented in the table below, and
 * touches nothing else.
 *
 * **Honesty note — this plumbing is ported, but not live-verified in
 * this sandbox.** There is no `COMFY_CLOUD_API_KEY` available in this
 * environment to make a real call against, so nothing here has been
 * run end to end from this repo. Passing tests are not proof the
 * render works; the only proof is Stuart tapping Vocal Render on his
 * iPhone after a deploy and a shelf clip playing. Two things the
 * original repo does that were deliberately *not* ported at first, each
 * flagged as cheap to add if the first live render showed it was
 * needed: it letterboxes the plate to 16:9 before upload — **now
 * ported**, see `letterboxImageForLtxIa2v` below, added 2026-09-15 once
 * a real 20+-clip run showed exactly this gap (the model drifting into
 * a visible face on every Vocal clip) — and it builds a specific Cloud
 * IA2V prompt paragraph (`buildCloudIa2vPrompt`) with a lip-sync lead
 * line and a style lock, which stays un-ported: this app's own prompt
 * assembly (`lib/clipGeneration.ts`'s `buildClipGenerationRequest`) is a
 * more developed, iterated-on replacement for that, not a gap.
 *
 * Only two env vars are real here, confirmed against the original
 * Skidmarks repo's own `.env.example`: `COMFY_CLOUD_API_KEY` and
 * `COMFY_URL` (blank = Comfy Cloud) — nothing else is invented.
 */
import sharp from "sharp";
import LTX_23_IA2V_TEMPLATE from "@/workflow/LTX_2.3_IA2V_Cloud.json";

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

/** Default `filename_prefix` patched into the template's `SaveVideo`
 * node (`341`) — the original repo uses the same `video/` subfolder
 * convention, which `pickComfyCloudVideo` also happens to prefer when
 * a job reports several outputs. */
export const DEFAULT_LTX_FILENAME_PREFIX = "video/skidmarks_ltx";

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

const UPLOAD_TIMEOUT_MS = 120_000;
const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
/** Gap between `GET /api/jobs/{id}` polls — the original client's own
 * `pollMs` default. */
export const COMFY_CLOUD_POLL_INTERVAL_MS = 2_500;

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

/** The LTX 2.3 IA2V template's own frame size (nodes `340:330`/`340:324`
 * in `workflow/LTX_2.3_IA2V_Cloud.json`) — must match. */
export const LTX_IA2V_FRAME_WIDTH = 1280;
export const LTX_IA2V_FRAME_HEIGHT = 720;

export interface LetterboxedImage {
  bytes: Uint8Array;
  mimeType: string;
  letterboxed: boolean;
}

/**
 * The LTX 2.3 IA2V template expects a 1280x720 start frame — Comfy's own
 * internal resize step **center-crops** anything else into that box
 * rather than scaling to fit, which silently chops off whatever sits at
 * the top or bottom of a non-16:9 still. A squarer plate (this app's
 * `generate-still`/Sunny Banks reference photos aren't reliably 16:9)
 * can lose real headroom this way, sometimes cropping straight through
 * a locked character's hat/shadow framing before the video model ever
 * sees a frame to animate from — a start-frame problem no amount of
 * prompt wording downstream can fix.
 *
 * Ported from the original Skidmarks repo's `letterboxPlateForCloudIa2v`
 * (`src/lib/ltxCloudPlate.ts`) — this app's own Comfy Cloud LTX pipeline
 * deliberately shipped without it at first (this module's earlier doc
 * comment: "cheap to add if the first live render shows it's needed").
 * Real reported ask (2026-09-15): 20+ Vocal clips in a row drifted into
 * a visible human face — the missing letterbox, not just prompt
 * wording, was the gap this closes.
 *
 * Only ever **pads** (never crops or distorts) to fit inside 1280x720
 * with black bars, and only when the source isn't already close enough
 * to 16:9 to trust Comfy's own crop (same `sourceAspect >= 1.45`
 * threshold the original used — a 3:2 plate was already fine in
 * practice there). Returns the original bytes unchanged,
 * `letterboxed: false`, for anything that doesn't need it, and on any
 * decode/resize failure — a framing nicety must never block a render
 * Stuart's already paying for — including, per a real live-QA finding,
 * on a malformed/truncated image: some invalid byte sequences can make
 * `sharp`'s decoder hang rather than reject quickly, so the whole
 * operation races against `LETTERBOX_TIMEOUT_MS` and falls back to the
 * original bytes the same as any other failure — a framing nicety must
 * never be able to stall a real render indefinitely.
 */
const LETTERBOX_TIMEOUT_MS = 15_000;

async function letterboxImageForLtxIa2vInner(bytes: Uint8Array, mimeType: string): Promise<LetterboxedImage> {
  const meta = await sharp(Buffer.from(bytes)).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return { bytes, mimeType, letterboxed: false };
  if (w === LTX_IA2V_FRAME_WIDTH && h === LTX_IA2V_FRAME_HEIGHT) {
    return { bytes, mimeType, letterboxed: false };
  }
  if (w / h >= 1.45) {
    return { bytes, mimeType, letterboxed: false };
  }
  const padded = await sharp(Buffer.from(bytes))
    .rotate()
    .resize({
      width: LTX_IA2V_FRAME_WIDTH,
      height: LTX_IA2V_FRAME_HEIGHT,
      fit: "contain",
      background: { r: 0, g: 0, b: 0 },
    })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { bytes: new Uint8Array(padded), mimeType: "image/jpeg", letterboxed: true };
}

export async function letterboxImageForLtxIa2v(bytes: Uint8Array, mimeType: string): Promise<LetterboxedImage> {
  try {
    const timedOut = new Promise<LetterboxedImage>((resolve) =>
      setTimeout(() => resolve({ bytes, mimeType, letterboxed: false }), LETTERBOX_TIMEOUT_MS)
    );
    return await Promise.race([letterboxImageForLtxIa2vInner(bytes, mimeType), timedOut]);
  } catch {
    return { bytes, mimeType, letterboxed: false };
  }
}

export type UploadInputOutcome =
  | { ok: true; name: string; subfolder: string }
  | ComfyCloudFailure;

/**
 * `POST /api/upload/image` — uploads raw bytes into Comfy Cloud's
 * `input` directory so the template's `LoadImage` (`269`) / `LoadAudio`
 * (`276`) node can reference it by filename. Works for audio despite
 * the path's name (see this module's doc comment) — the field is always
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
  // plain `ArrayBuffer`-backed copy — `Blob`'s `BlobPart` type doesn't
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
 * to track it.
 *
 * The body is **just `{ prompt }`**, matching the original repo's
 * `cloudQueuePrompt`. There is deliberately no
 * `extra_data.api_key_comfy_org`: that second copy of the key is a
 * Comfy *partner node* requirement, and the LTX 2.3 graph this app
 * submits contains no partner nodes.
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
      body: JSON.stringify({ prompt: workflow }),
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
    const message = extractErrorMessage(payload);
    return {
      ok: false,
      status: res.status,
      code,
      error: `Comfy Cloud returned HTTP ${res.status} submitting the workflow${message ? `: ${message}` : "."}`,
    };
  }

  const body = (payload ?? {}) as { prompt_id?: unknown };
  const message = extractErrorMessage(payload);
  if (message) {
    return { ok: false, status: 422, code: "invalid_request", error: `Comfy Cloud rejected the workflow: ${message}` };
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

/** Comfy Cloud reports a rejected workflow either as a bare `error`
 * string or as `{ error: { message } }` — the original client handles
 * both shapes, so this does too. */
function extractErrorMessage(payload: unknown): string {
  const err = (payload as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "";
}

export interface ComfyCloudOutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

/** One node's entry in a finished job's `outputs` map. `SaveVideo`
 * serialises through `PreviewVideo.as_dict()`, which emits its files
 * under **`images`** — not `video`. All four keys are accepted here
 * because the original repo's own `pickCloudVideo` accepts all four,
 * and a graph change upstream shouldn't silently turn a paid, finished
 * render into a `no_video_output`. */
export interface ComfyCloudNodeOutputs {
  images?: ComfyCloudOutputFile[];
  video?: ComfyCloudOutputFile[];
  videos?: ComfyCloudOutputFile[];
  gifs?: ComfyCloudOutputFile[];
}

export type PollJobOutcome =
  | { ok: true; videoFile: ComfyCloudOutputFile }
  | ComfyCloudFailure;

interface ComfyCloudJobBody {
  status?: unknown;
  outputs?: Record<string, ComfyCloudNodeOutputs> | null;
  execution_error?: { exception_message?: unknown; message?: unknown } | null;
  error?: unknown;
}

/**
 * Picks the finished job's rendered mp4 out of its `outputs` map —
 * ported from the original repo's `pickCloudVideo`.
 *
 * The `images`/`gifs` keys are filtered to `.mp4` entries only (a
 * `SaveVideo` node's files land under `images`, but a graph that also
 * saved a real still would put a `.png` there too); `video`/`videos`
 * are taken as-is. When several candidates exist, one whose path looks
 * like an LTX/IA2V/video output wins, otherwise the first.
 */
export function pickComfyCloudVideo(
  outputs: Record<string, ComfyCloudNodeOutputs> | null | undefined
): ComfyCloudOutputFile | null {
  const vids: ComfyCloudOutputFile[] = [];
  for (const node of Object.values(outputs ?? {})) {
    if (!node) continue;
    for (const v of node.video ?? []) vids.push(v);
    for (const v of node.videos ?? []) vids.push(v);
    for (const g of node.gifs ?? []) {
      if (/\.mp4$/i.test(g?.filename ?? "")) vids.push(g);
    }
    for (const im of node.images ?? []) {
      if (/\.mp4$/i.test(im?.filename ?? "")) vids.push(im);
    }
  }
  if (!vids.length) return null;
  const prefer = vids.find((v) => /ltx|ia2v|video/i.test(`${v.subfolder ?? ""}/${v.filename}`));
  return prefer ?? vids[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `GET /api/jobs/{promptId}` — **plural `jobs`; this is not
 * `/api/history/{id}`**, which is the *local* ComfyUI shape. The
 * original client carries a standing comment saying exactly that, and
 * it is the single easiest thing to get wrong here.
 *
 * `completed`/`success` finish the job (its `outputs` then go through
 * `pickComfyCloudVideo`); `failed`/`error`/`cancelled` fail it,
 * surfacing Comfy's own `execution_error.exception_message` verbatim
 * rather than a summary of it. Anything else is still running.
 *
 * Never hangs forever — past `deadlineMs` this returns an honest
 * `timeout` outcome, mirroring `app/api/skidmarks/generate-clip/
 * route.ts`'s existing xAI/MiniMax "no resume after timeout" shape:
 * the render may still finish on Comfy's side, but nothing here checks
 * back on it later.
 */
export async function pollComfyCloudJob(
  promptId: string,
  creds: ComfyCloudCredentials,
  deadlineMs: number,
  pollIntervalMs: number = COMFY_CLOUD_POLL_INTERVAL_MS
): Promise<PollJobOutcome> {
  const startedAt = Date.now();

  while (true) {
    let res: Response;
    try {
      res = await fetch(`${creds.baseUrl}/api/jobs/${encodeURIComponent(promptId)}`, {
        method: "GET",
        headers: { "X-API-Key": creds.apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });
    } catch (err) {
      return networkFailure(`checking job ${promptId}`, err);
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // Handled by the !res.ok check below; a 200 with unreadable JSON
      // falls through as an unknown status and polls again.
    }

    if (!res.ok) {
      const { code } = classifyComfyHttpFailure(res.status);
      return {
        ok: false,
        status: res.status,
        code,
        error: `Comfy Cloud returned HTTP ${res.status} checking the render's job status.`,
      };
    }

    const job = (payload ?? {}) as ComfyCloudJobBody;
    const status = String(job.status ?? "unknown").toLowerCase();

    if (status === "failed" || status === "error" || status === "cancelled") {
      const detail =
        (typeof job.execution_error?.exception_message === "string" && job.execution_error.exception_message) ||
        (typeof job.execution_error?.message === "string" && job.execution_error.message) ||
        (typeof job.error === "string" && job.error) ||
        `Comfy Cloud's job failed (${status})`;
      return { ok: false, status: 502, code: "upstream_error", error: `Comfy Cloud's job failed: ${detail}` };
    }

    if (status === "completed" || status === "success") {
      const videoFile = pickComfyCloudVideo(job.outputs);
      if (videoFile) return { ok: true, videoFile };
      return {
        ok: false,
        status: 502,
        code: "no_video_output",
        error: "Comfy Cloud's job finished successfully but reported no video output to download.",
      };
    }

    if (Date.now() + pollIntervalMs - startedAt >= deadlineMs) {
      return {
        ok: false,
        status: 504,
        code: "timeout",
        error:
          `Comfy Cloud's job was still ${status} after ${Math.round(deadlineMs / 1000)}s — this route stopped ` +
          "waiting. The render may still finish on Comfy's side, but this app has no way to check back on it; " +
          "try again in a bit.",
      };
    }
    await sleep(pollIntervalMs);
  }
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

export interface Ltx23Ia2vWorkflowInputs {
  /** Filename `uploadComfyCloudInput` stored the plate still under. */
  imageFilename: string;
  /** Filename `uploadComfyCloudInput` stored this plate's sliced vocal
   * audio under. */
  audioFilename: string;
  /** The shot prompt, sent as-is (see this module's doc comment on
   * `buildCloudIa2vPrompt`, deliberately not ported). */
  prompt: string;
  /** Output length in seconds — an ordinary graph input here, with no
   * hosted-node ceiling to work around. */
  durationSec: number;
  filenamePrefix?: string;
  /** Extra negative-conditioning text — appended onto the template's
   * own default negative prompt (`IA2V_DEFAULT_NEGATIVE_PROMPT`), never
   * replacing it, so every render keeps the anti-game/anti-cartoon
   * signal the template shipped with even when it also has a locked
   * character's own negative cues to add. Omitted entirely (node left
   * untouched) when there's nothing extra to add. See node `340:314`'s
   * doc note below — this is a real, separate negative-prompt channel
   * in the graph, distinct from `prompt` above. */
  negativePrompt?: string;
  /** How much freedom the 4-step high-res refinement pass (node
   * `340:296`) gets to redraw detail after the base pass + upscale —
   * `1.0` (the template's shipped default) is fully free. Defaults to
   * `LTX_IA2V_DEFAULT_REFINE_STRENGTH` when omitted; only override for
   * a deliberate experiment. See that constant's doc comment for why
   * this exists. */
  refineStrength?: number;
}

/** The template node ids this app patches. `IA2V_NODE_IMAGE` through
 * `IA2V_NODE_SAVE` are the original five (matching the original repo's
 * `runLtxCloudIa2v`); `IA2V_NODE_NEGATIVE_PROMPT` and
 * `IA2V_NODE_REFINE_STRENGTH` were added 2026-09-15 (see
 * `Ltx23Ia2vWorkflowInputs`'s field docs and `LTX_IA2V_DEFAULT_REFINE_STRENGTH`'s
 * doc comment) once a real, repeated live failure (a locked character's
 * face resolving out of the shadow on every single Vocal clip) pointed
 * at both as real, fixable graph-level gaps — not just a prompt-wording
 * problem. */
const IA2V_NODE_IMAGE = "269";
const IA2V_NODE_AUDIO = "276";
const IA2V_NODE_PROMPT = "340:319";
const IA2V_NODE_DURATION = "340:331";
const IA2V_NODE_SAVE = "341";
/** A real, separate `CLIPTextEncode` negative-conditioning node —
 * wired up 2026-09-15, then found to be **inert at this graph's actual
 * settings**: both `CFGGuider` nodes run `cfg: 1`, and standard
 * classifier-free-guidance math collapses to `output = positive` at
 * cfg=1 — the negative conditioning has no effect on the result
 * regardless of what text lives here, confirmed by reading the live
 * graph (no `NAG`/attention-guidance node exists here either, which is
 * the one thing that *would* make a real difference at cfg=1). Left
 * wired anyway — harmless, and it becomes real the moment cfg is ever
 * raised above 1 — but **this was never the actual fix** for a locked
 * character's face slipping; don't spend more effort tuning this
 * node's text. The real levers turned out to be the prompt enhancer
 * and the refine pass's strength, both below. */
const IA2V_NODE_NEGATIVE_PROMPT = "340:314";
const IA2V_DEFAULT_NEGATIVE_PROMPT = "pc game, console game, video game, cartoon, childish, ugly";
/** Node `340:296`, `LTXVImgToVideoInplace` — the short (4-step),
 * high-resolution refinement pass that runs *after* the low-res base
 * pass and upscale (node `340:325`, a separate `LTXVImgToVideoInplace`
 * left untouched at the template's own `0.7`). The template shipped
 * this refinement pass at `strength: 1` — fully free to redraw detail.
 * Real reported failure (2026-09-15): a locked character's face
 * resolving into a normal, lit human face on every single Vocal clip,
 * 20+ renders in a row. The base pass already settles the frame's real
 * structure (including the shadow); a fully-free refinement pass has
 * enough room to invent new high-frequency detail — like a face — into
 * a region the base pass had correctly left dark. Lowering this keeps
 * the refinement pass closer to what the base pass already established,
 * while still leaving it room to sharpen legitimate detail (hat weave,
 * fabric, lighting). Applied to every Vocal render, not just Jack
 * Ash's — this is a graph-level tuning fix for the shared pipeline, not
 * a character-specific one.
 *
 * **Not proven by a real render in this sandbox** — there's no
 * `COMFY_CLOUD_API_KEY` here to test against (same honesty note as the
 * rest of this module). Stuart's own next live Vocal render is the
 * actual test; if it still drifts, the next lever to try is the base
 * pass's own `0.7` (node `340:325`), left alone here deliberately so a
 * single live test result says which pass actually needed the change. */
export const LTX_IA2V_DEFAULT_REFINE_STRENGTH = 0.6;
const IA2V_NODE_REFINE_STRENGTH = "340:296";
/** Node `340:349`, "Boolean (Enable Prompt Enhance)" — gates whether
 * the positive prompt actually sent to the model is `prompt` verbatim,
 * or a rewrite of it produced by an LLM step (`340:346`,
 * `TextGenerateLTX2Prompt`, running on Gemma at `temperature: 0.7` with
 * its own sampling). Confirmed **on** in Stuart's live graph. That
 * means every Vocal render to date has had its prompt silently
 * rewritten before the video model ever saw it — a locked character's
 * carefully-worded "stays a shadow, never a lit face" instruction could
 * plausibly get reinterpreted into something more generic (e.g. "a man
 * singing") by that rewrite step, with real, uncontrolled randomness on
 * every render (same prompt in, different rewrite out). Always forced
 * off here, unconditionally, for every Vocal render this app makes —
 * the whole point of hand-writing a locked character's prompt is that
 * exact wording reaches the model, not an LLM's paraphrase of it. */
const IA2V_NODE_PROMPT_ENHANCE = "340:349";

type TemplateNode = { class_type?: string; inputs?: Record<string, unknown> };

function patchNodeInputs(graph: Record<string, unknown>, nodeId: string, patch: Record<string, unknown>): void {
  const node = graph[nodeId] as TemplateNode | undefined;
  if (!node?.inputs) {
    // Template and code have drifted — a deploy-time mistake, not a
    // user outcome. Throwing here fails loudly at build/render time
    // rather than silently submitting an unpatched graph that would
    // render someone else's plate.
    throw new Error(`LTX 2.3 IA2V template is missing node ${nodeId} (or its inputs) — template and code have drifted.`);
  }
  Object.assign(node.inputs, patch);
}

/**
 * Builds the one workflow graph this feature submits: a
 * `structuredClone` of `workflow/LTX_2.3_IA2V_Cloud.json` with exactly
 * five node inputs patched. The clone is per call on purpose —
 * concurrent requests on the same warm serverless instance must not be
 * able to patch each other's graph, and the imported template object
 * itself is never mutated.
 *
 * | node | input | value |
 * |---|---|---|
 * | `269` `LoadImage` | `image` | uploaded plate filename |
 * | `276` `LoadAudio` | `audio` | uploaded mp3 filename |
 * | `340:319` `PrimitiveString` | `value` | the prompt |
 * | `340:331` `PrimitiveFloat` | `value` | duration in seconds |
 * | `341` `SaveVideo` | `filename_prefix` | default `video/skidmarks_ltx` |
 * | `340:314` `CLIPTextEncode` | `text` | default negative + `negativePrompt`, only when given (see that node's doc comment — inert at this graph's `cfg: 1`, kept anyway) |
 * | `340:296` `LTXVImgToVideoInplace` | `strength` | `refineStrength` ?? `LTX_IA2V_DEFAULT_REFINE_STRENGTH` |
 * | `340:349` `PrimitiveBoolean` | `value` | always `false` — prompt enhancer forced off |
 *
 * **Everything else in the graph stays exactly as the template has it**
 * — the checkpoint, the samplers, the VAE chain. Don't "improve" any of
 * it: this is Stuart's own real, live workflow, re-synced 2026-09-15
 * (see this module's doc comment). The last three rows above are the
 * deliberate exceptions — real graph-level gaps a live failure pointed
 * at, not "tidying."
 */
export function buildLtx23Ia2vWorkflow(inputs: Ltx23Ia2vWorkflowInputs): Record<string, unknown> {
  const graph = structuredClone(LTX_23_IA2V_TEMPLATE) as unknown as Record<string, unknown>;

  patchNodeInputs(graph, IA2V_NODE_IMAGE, { image: inputs.imageFilename });
  patchNodeInputs(graph, IA2V_NODE_AUDIO, { audio: inputs.audioFilename });
  patchNodeInputs(graph, IA2V_NODE_PROMPT, { value: inputs.prompt });
  patchNodeInputs(graph, IA2V_NODE_DURATION, { value: inputs.durationSec });
  patchNodeInputs(graph, IA2V_NODE_SAVE, {
    filename_prefix: inputs.filenamePrefix ?? DEFAULT_LTX_FILENAME_PREFIX,
  });
  if (inputs.negativePrompt) {
    patchNodeInputs(graph, IA2V_NODE_NEGATIVE_PROMPT, {
      text: `${IA2V_DEFAULT_NEGATIVE_PROMPT}, ${inputs.negativePrompt}`,
    });
  }
  patchNodeInputs(graph, IA2V_NODE_REFINE_STRENGTH, {
    strength: inputs.refineStrength ?? LTX_IA2V_DEFAULT_REFINE_STRENGTH,
  });
  patchNodeInputs(graph, IA2V_NODE_PROMPT_ENHANCE, { value: false });

  return graph;
}
