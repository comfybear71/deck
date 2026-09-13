import { NextResponse } from "next/server";

/**
 * POST /api/skidmarks/generate-still — the server half of Skidmarks'
 * plate-still generation (see `lib/plateGeneration.ts`'s module doc
 * comment for the full client-side contract, including the two real
 * calls against the live xAI API this route's exact request/response
 * shapes were verified against).
 *
 * **xAI's Grok Imagine API, and nothing else.** This route calls
 * `POST https://api.x.ai/v1/images/generations` (no reference images) or
 * `POST https://api.x.ai/v1/images/edits` (one or more reference images —
 * xAI's `image`/`images` fields are mutually exclusive, so this route
 * picks whichever one fits the request it received) with model
 * `grok-imagine-image-2.0` by default. There's exactly one image backend
 * wired in this build — the clip timeline's LTX/Grok/H3/Seedance tags
 * (`lib/skidmarks.ts`'s `SkidmarksModelId`) never select a different real
 * API here; they only steer this same call's prompt phrasing (see
 * `lib/plateGeneration.ts`'s `routingFramingHint`) and, separately, still
 * govern the (stubbed) *video* render pass everywhere else in this build.
 *
 * **Response format**: always requests `response_format: "b64_json"` and
 * returns a single `data:` URL to the client (`{ dataUrl }`) — never a
 * bare temporary xAI URL. This matters because xAI's own docs say
 * generation URLs are temporary ("download or process promptly"), and
 * this app persists a still straight into `localStorage`
 * (`SkidmarksClipSegment.still`, `lib/skidmarks.ts`) — a URL that can
 * expire would silently rot into a broken `<img>` on a later reload. As a
 * defensive fallback (in case a future response ever omits `b64_json` in
 * favor of `url` despite the requested format), this route immediately
 * downloads any bare `url` it does get and re-encodes it as a `data:` URL
 * itself before responding, rather than ever handing the client something
 * that can expire.
 *
 * **Never claims to be live without a key.** If no `XAI_API_KEY` is
 * configured, this returns `501`/`missing_api_key` — the same honest
 * "unconfigured" shape `app/api/skidmarks/transcribe/route.ts` uses for
 * its own missing-key case — so `lib/plateGeneration.ts`'s
 * `generatePlateStill` can say so plainly instead of implying a real
 * attempt failed. A genuine request failure (network, timeout, a real
 * xAI error) is reported with xAI's own message, verbatim, via
 * `classifyXaiFailure` below.
 *
 * **Model override**: `XAI_IMAGE_MODEL`, if set, overrides
 * `DEFAULT_XAI_IMAGE_MODEL` — a config knob for tuning cost/quality
 * without a code change, not a picker; there is still no per-request model
 * choice anywhere in the UI, matching Stuart's "no picker UI" lock.
 *
 * The API key itself is never logged, never echoed back in any response,
 * and never appears in an error message — only xAI's own (key-free) error
 * text does, same discipline as `app/api/skidmarks/transcribe/route.ts`.
 */

export const runtime = "nodejs";
// A still generation call is a single synchronous request/response (no
// polling, unlike xAI's async video endpoint, which this app never calls)
// — comfortably under a minute in the two live calls this route's
// contract was verified against, but this raises the ceiling this route
// asks for in case a slower model/resolution combination runs longer.
export const maxDuration = 60;

const XAI_API_KEY_ENV_VAR = "XAI_API_KEY";
const XAI_IMAGE_MODEL_ENV_VAR = "XAI_IMAGE_MODEL";
const XAI_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";
const XAI_EDITS_URL = "https://api.x.ai/v1/images/edits";
/** Verified live in this sandbox (see `lib/plateGeneration.ts`'s module
 * doc comment) against both `/images/generations` and `/images/edits`. */
const DEFAULT_XAI_IMAGE_MODEL = "grok-imagine-image-2.0";

/** `lib/plateGeneration.ts`'s built prompt already includes Stuart's own
 * shot prompt plus this app's own framing/continuity/character-lock text
 * — generous, but still a real backstop against an unbounded body. */
const MAX_PROMPT_LENGTH = 2000;
/** xAI's own docs give two different ceilings for its `images` array
 * across different doc pages (three on one page, five on another) — this
 * app only ever sends up to two (a continuity plate + one vocalist
 * identity reference, see `lib/plateGeneration.ts`), so this is a sane,
 * conservative backstop rather than a number tuned to either documented
 * ceiling specifically. */
const MAX_REFERENCE_IMAGES = 3;
const UPSTREAM_TIMEOUT_MS = 55_000;

function resolveXaiApiKey(): string | null {
  return process.env[XAI_API_KEY_ENV_VAR] || null;
}

function resolveXaiImageModel(): string {
  return process.env[XAI_IMAGE_MODEL_ENV_VAR] || DEFAULT_XAI_IMAGE_MODEL;
}

interface XaiReferenceImage {
  url: string;
  type: "image_url";
}

/** xAI's API is OpenAI-compatible, so a failed request's body is expected
 * to follow that same `{ error: { message, type, code } }` (or, on some
 * gateways, a bare `{ error: "..." }` string) shape — read defensively
 * either way rather than assuming one. */
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

export function classifyXaiFailure(upstreamStatus: number): { httpStatus: number; code: string } {
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

type XaiImageOutcome =
  | { ok: true; dataUrl: string }
  | { ok: false; status: number; code: string; error: string };

/** Downloads a bare image URL and re-encodes it as a `data:` URL — the
 * defensive fallback path described in this file's module doc comment,
 * for the case where a response ever carries `url` instead of the
 * requested `b64_json`. Never reached in either of this route's two live
 * test calls (both returned `b64_json` directly), but kept so a still
 * this app is about to persist to `localStorage` is never left pointing
 * at a URL xAI's own docs say is temporary. */
async function downloadAsDataUrl(url: string): Promise<XaiImageOutcome> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) {
      return {
        ok: false,
        status: 502,
        code: "upstream_error",
        error: `xAI Grok Imagine returned an image URL that could not be downloaded (HTTP ${res.status}).`,
      };
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: true, dataUrl: `data:${contentType};base64,${buffer.toString("base64")}` };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: "upstream_error",
      error: `xAI Grok Imagine returned an image URL that could not be downloaded: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }
}

async function callXaiImageApi(
  prompt: string,
  references: XaiReferenceImage[],
  apiKey: string,
  model: string
): Promise<XaiImageOutcome> {
  const usingEdits = references.length > 0;
  const url = usingEdits ? XAI_EDITS_URL : XAI_GENERATIONS_URL;

  const body: Record<string, unknown> = { model, prompt, response_format: "b64_json" };
  if (references.length === 1) {
    body.image = references[0];
  } else if (references.length > 1) {
    body.images = references;
  } else {
    body.n = 1;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      code: timedOut ? "timeout" : "network_error",
      error: timedOut
        ? `xAI's Grok Imagine API did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s.`
        : `Could not reach xAI's Grok Imagine API: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Handled by the !res.ok / no-image checks below either way.
  }

  if (!res.ok) {
    const message = extractXaiErrorMessage(payload);
    const { httpStatus, code } = classifyXaiFailure(res.status);
    return {
      ok: false,
      status: httpStatus,
      code,
      error: `xAI Grok Imagine returned ${res.status}${message ? `: ${message}` : "."}`,
    };
  }

  const successBody = (payload ?? {}) as { data?: unknown };
  const first = Array.isArray(successBody.data)
    ? (successBody.data[0] as Record<string, unknown> | undefined)
    : undefined;

  const b64 = first && typeof first.b64_json === "string" ? first.b64_json : null;
  if (b64) {
    const mimeType = first && typeof first.mime_type === "string" ? first.mime_type : "image/jpeg";
    return { ok: true, dataUrl: `data:${mimeType};base64,${b64}` };
  }

  const remoteUrl = first && typeof first.url === "string" ? first.url : null;
  if (remoteUrl) {
    return downloadAsDataUrl(remoteUrl);
  }

  return {
    ok: false,
    status: 502,
    code: "no_image",
    error: "xAI Grok Imagine succeeded but returned no image data.",
  };
}

interface GenerateStillRequestBody {
  prompt?: unknown;
  referenceImageDataUrls?: unknown;
}

function isReferenceDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,.+/.test(value);
}

export async function POST(request: Request) {
  const apiKey = resolveXaiApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          `${XAI_API_KEY_ENV_VAR} is not set on the server \u2014 plate-still generation is unavailable here. ` +
          "This is xAI's own Grok Imagine API key (from console.x.ai), not an ElevenLabs or OpenAI key. If you " +
          "just added it, Vercel only applies environment variable changes to new deployments \u2014 redeploy the " +
          "project for this function to see it.",
        code: "missing_api_key",
      },
      { status: 501 }
    );
  }

  let body: GenerateStillRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body with a `prompt` string.", code: "invalid_request" },
      { status: 400 }
    );
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "Missing `prompt`.", code: "invalid_request" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt is too long \u2014 over ${MAX_PROMPT_LENGTH} characters.`, code: "invalid_request" },
      { status: 400 }
    );
  }

  const rawReferences = Array.isArray(body.referenceImageDataUrls) ? body.referenceImageDataUrls : [];
  if (rawReferences.length > MAX_REFERENCE_IMAGES) {
    return NextResponse.json(
      {
        error: `Too many reference images \u2014 this route accepts at most ${MAX_REFERENCE_IMAGES}.`,
        code: "invalid_request",
      },
      { status: 400 }
    );
  }
  if (!rawReferences.every(isReferenceDataUrl)) {
    return NextResponse.json(
      {
        error: "Each reference image must be a `data:image/...;base64,...` URL.",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }
  const references: XaiReferenceImage[] = rawReferences.map((url) => ({ url, type: "image_url" as const }));

  const result = await callXaiImageApi(prompt, references, apiKey, resolveXaiImageModel());

  if (result.ok) {
    return NextResponse.json({ dataUrl: result.dataUrl });
  }
  return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
}
