import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { buildClipRenderPathname, isSafeSegmentId } from "@/lib/clipRenderBlob";

/**
 * POST /api/skidmarks/generate-clip — the first real (non-stub) slice of
 * Skidmarks' clip *video* render pass. Every other doc comment in this
 * feature (`lib/skidmarks.ts`, `SkidmarksClipTimeline`, the README's
 * "Skidmarks node" section) says the actual clip video stays a stub
 * "everywhere in this build" — this route is the one exception, added
 * so Stuart can opt in to animating his multi-plate opener (door \u2192
 * keyhole \u2192 Jack push-in continuity) instead of staring at plate
 * stills forever. The big pink "Generate Clips" button
 * (`SkidmarksClipTimeline`) is **still** a stub \u2014 it means "render
 * every clip in the song," which stays intentionally unwired (cost). This
 * route backs a much smaller, explicit, one-clip-at-a-time control
 * (`components/SkidmarksClipRender.tsx`) instead.
 *
 * **xAI's Grok Imagine *video* API, and nothing else.** Reuses the exact
 * same `XAI_API_KEY` this app already has wired for plate *stills*
 * (`app/api/skidmarks/generate-still/route.ts`) \u2014 no new key, no new
 * provider, no new "lane" (see the README's "The four lanes": xAI is
 * already one of Stuart's real paid accounts). This is deliberately the
 * *only* real video backend considered: the README's "Skidmarks node"
 * section names Comfy MCP / Seedance / LTX as the aspirational
 * long-term backend, but none of those have a wired API call, request
 * shape, or confirmed key name anywhere in this codebase \u2014 inventing
 * one here would be exactly the "fake success" this task explicitly
 * rules out. xAI's video endpoint, by contrast, is real, documented
 * (https://docs.x.ai/developers/model-capabilities/video/generation,
 * .../video/image-to-video, .../video/reference-to-video), and \u2014
 * unlike the still-image route above, where the two live verification
 * calls predate this PR \u2014 **verified live in this exact sandbox while
 * building this route**: a real `POST /v1/videos/generations` call
 * (`grok-imagine-video-1.5`, a single `image` reference, `duration: 3`,
 * `resolution: "480p"`) returned a real `request_id`; polling
 * `GET /v1/videos/{request_id}` every ~6s reached `status: "done"` after
 * ~24s with a real, playable `video.url` and `usage.cost_in_usd_ticks:
 * 2500000000` (exactly the documented $0.25 for a 3s/480p clip + one
 * input image: 3 \u00d7 $0.08 + $0.01). That confirms the request/response
 * shapes below are real, not just read from docs \u2014 it does **not**
 * confirm every prompt/reference-image combination renders well (a
 * generative model, not a deterministic renderer), and the
 * multi-reference (`reference_images`, 2\u20133 plates) path specifically
 * was **not** separately live-tested (each real call costs Stuart real
 * money \u2014 one wired single-image proof was judged enough to ship the
 * *code path* for the documented multi-image shape, same call this
 * feature's still-generation route already made for its own
 * `images`/`<IMAGE_0>` array).
 *
 * **Fixed, cost-capped settings \u2014 not exposed to the client, not an
 * env-var knob.** Unlike `XAI_IMAGE_MODEL` (a deliberate low-risk
 * override for the still route, since image cost swings are small),
 * `CLIP_DURATION_SEC` and `CLIP_RESOLUTION` below are hardcoded: 5
 * seconds at 480p, the cheapest documented tier
 * ($0.08/sec \u2014 5s \u2248 $0.40, plus $0.01 per input image, so a
 * 3-plate door\u2192keyhole\u2192Jack render costs \u2248 $0.43 total). A
 * duration/resolution bump is real spend-per-tap creep (a 10s/1080p clip
 * is $2.50 \u2014 6x) \u2014 Stuart's cost lock says that's a deliberate
 * code change with review, not something a stray env var should be able
 * to quietly dial up. `XAI_VIDEO_MODEL` *is* a safe env override (model
 * name only, same low-risk shape as `XAI_IMAGE_MODEL`), in case xAI
 * renames/retires `grok-imagine-video-1.5`.
 *
 * **At least one reference still is required \u2014 this route never does
 * plain text-to-video.** The whole point of this feature is animating a
 * plate Stuart already generated/uploaded, not spending money on video
 * from a bare text prompt; `referenceImageDataUrls` must have 1\u20133
 * entries (see `MAX_REFERENCE_IMAGES` \u2014 xAI's own docs examples never
 * show more than 3, and `components/SkidmarksClipRender.tsx` caps a
 * clip's plate strip to the first 3 stills for the same reason the still
 * route caps at 3). One reference \u2192 xAI's image-to-video mode (`image`
 * field, locks the first frame). Two or three \u2192 reference-to-video
 * mode (`reference_images` array, guided continuity across the sequence
 * \u2014 exactly Stuart's "continuous zoom across 3 plates" case).
 *
 * **Async start+poll, collapsed into one request/response.** xAI's video
 * endpoint is a deferred job (`POST` returns a `request_id`; the caller
 * polls `GET /v1/videos/{request_id}` until `status` settles) \u2014 unlike
 * the still route's single synchronous call. Rather than exposing that
 * two-step shape to the client (a second endpoint, client-side polling
 * state, a `request_id` to persist somewhere), this route does the
 * polling itself, server-side, inside one HTTP call \u2014 the smallest
 * real wired shape, at the cost of holding one Vercel function open for
 * up to `POLL_DEADLINE_MS`. `maxDuration` below raises the ceiling this
 * route asks for; the platform's own plan limit still applies (same
 * caveat as `app/api/skidmarks/transcribe/route.ts`'s `maxDuration`).
 * **No resume-after-timeout in this first slice**: if `POLL_DEADLINE_MS`
 * elapses before xAI reports `done`/`failed`/`expired`, this route
 * returns an honest `timeout` outcome and drops the `request_id` \u2014 xAI
 * may still finish the job server-side, but nothing here checks back on
 * it later, and the next tap starts a brand-new (separately billed)
 * render. A live 3s/480p render finished in ~24s in this sandbox, so a
 * 5s/480p one should comfortably clear the deadline in the common case;
 * this is a real limitation to fix in a follow-up if renders start
 * timing out in practice, not a corner assumed away.
 *
 * **Never claims to be live without a key**, same honest shape as the
 * still route and the transcribe route: no `XAI_API_KEY` \u2192 `501`/
 * `missing_api_key`. A still-based plate strip that's 100% uploaded
 * photos (no `XAI_API_KEY` ever needed for stills) can still hit this
 * route \u2014 Stuart may have plates but no video key configured, and this
 * says so plainly rather than pretending stills and video share a
 * "wired" bit.
 *
 * **Persisted to Vercel Blob, not `localStorage`, and no longer
 * ephemeral React state.** This is a deliberate change from how this
 * route originally shipped in #42: Stuart rejected a render that only
 * lived in `SkidmarksClipRender`'s own React state (gone on refresh) —
 * "never localStorage for clips/plates/studio state; Vercel Blob for
 * media now" is the hard lock (see AGENTS.md). `localStorage` was never
 * actually an option here anyway (a 5s/480p clip is roughly a
 * megabyte — an order of magnitude past what that store's small shared
 * quota can absorb even once, let alone per render), so a *real*
 * durable store was always the only fix, not a corner that got cut.
 * Once xAI's poll finishes successfully, this route re-downloads the
 * finished video from xAI's temporary URL and re-uploads it to Vercel
 * Blob (`@vercel/blob`'s `put()`) under a stable, parseable pathname
 * (`lib/clipRenderBlob.ts`) — `access: "public"` (so the returned URL
 * works directly in a `<video src>`/download link with no extra auth
 * hop, the same access level xAI's own temporary URL already had) and
 * `allowOverwrite: true` (each clip keeps exactly **one** persisted
 * render, replaced by its latest — see that module's doc comment for
 * why). The response's `videoUrl` becomes that durable Blob URL on
 * success — a refresh, or even a different browser tab, can still
 * reach it, unlike xAI's own temporary link. `app/api/skidmarks/clip-
 * renders/route.ts` is the read side: it lists what's currently
 * persisted so `components/SkidmarksClipTimeline.tsx` can show a saved
 * render again after a reload without this route being called again.
 *
 * **Persistence is additive, and optional-by-request-shape, on
 * purpose.** A caller that doesn't send `segmentId`/`clipIndex`/
 * `startSec`/`endSec` (all four are needed to build a stable pathname)
 * gets the exact same response shape this route always returned
 * (`{ videoUrl, durationSec }`, xAI's own temporary URL) — this keeps
 * the route usable by anything that doesn't care about persistence
 * without a breaking change to its contract. The real UI
 * (`components/SkidmarksClipRender.tsx`) always sends all four now,
 * since every real clip render happens against a real clip with a real
 * `segmentId` and time range.
 *
 * **Never claims a render is saved when it isn't.** If Vercel Blob
 * isn't configured (no store connected / no `BLOB_READ_WRITE_TOKEN`),
 * or the re-download/re-upload step itself fails for any reason, this
 * route still returns the render Stuart just paid for — xAI's own
 * temporary `videoUrl`, exactly as before this feature existed — but
 * with `persisted: false` and a plain-language `persistError`, so the
 * UI can say so honestly (see `SkidmarksClipRender`'s "not saved" note)
 * instead of implying durability that didn't happen. A storage hiccup
 * should never waste the real money a render just cost by discarding
 * the one result Stuart already paid for.
 */

export const runtime = "nodejs";
// Raises the ceiling this route asks for \u2014 the actual platform/plan
// limit still applies (see this file's module doc comment). Sized to
// comfortably clear `POLL_DEADLINE_MS` plus the initial start call and
// response overhead.
export const maxDuration = 300;

const XAI_API_KEY_ENV_VAR = "XAI_API_KEY";
const XAI_VIDEO_MODEL_ENV_VAR = "XAI_VIDEO_MODEL";
const XAI_VIDEO_GENERATIONS_URL = "https://api.x.ai/v1/videos/generations";
const xaiVideoStatusUrl = (requestId: string) =>
  `https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`;
/** Verified live in this sandbox against the image-to-video path (see
 * this file's module doc comment) \u2014 the current xAI video model as
 * of this build. */
const DEFAULT_XAI_VIDEO_MODEL = "grok-imagine-video-1.5";

const MAX_PROMPT_LENGTH = 2000;
/** xAI's own documented examples for `reference_images` never show more
 * than 3 \u2014 `components/SkidmarksClipRender.tsx` caps a clip's plate
 * strip to its first 3 real stills for the same reason
 * `app/api/skidmarks/generate-still/route.ts` caps identity/continuity
 * references at 3. */
const MAX_REFERENCE_IMAGES = 3;
const MIN_REFERENCE_IMAGES = 1;

/** Fixed, cost-capped output settings \u2014 see this file's module doc
 * comment for why these are a code change, not an env knob. 5s \u00d7
 * $0.08/s (480p) \u2248 $0.40 per render, plus $0.01 per reference image. */
const CLIP_DURATION_SEC = 5;
const CLIP_RESOLUTION = "480p";

const START_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 20_000;
/** Time between status polls. Exported so tests can advance fake timers
 * by exactly this much rather than guessing. */
export const POLL_INTERVAL_MS = 4_000;
/** Server-side polling ceiling \u2014 comfortably under `maxDuration` so
 * this route can still return an honest `timeout` response instead of
 * being killed mid-request. See this file's module doc comment's "no
 * resume-after-timeout" note. */
export const POLL_DEADLINE_MS = 240_000;

function resolveXaiApiKey(): string | null {
  return process.env[XAI_API_KEY_ENV_VAR] || null;
}

function resolveXaiVideoModel(): string {
  return process.env[XAI_VIDEO_MODEL_ENV_VAR] || DEFAULT_XAI_VIDEO_MODEL;
}

/** Same OpenAI-compatible error shape as `app/api/skidmarks/generate-still/
 * route.ts`'s `extractXaiErrorMessage` \u2014 xAI's synchronous "the request
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

/** Classifies a failed *synchronous* HTTP response \u2014 either the
 * initial `POST /v1/videos/generations` start call being rejected (bad
 * key, bad body, rate limit) or a later `GET /v1/videos/{request_id}`
 * poll itself returning a non-2xx (as opposed to a 200 whose *body*
 * reports `status: "failed"` \u2014 see `classifyXaiVideoJobError` for
 * that, separate, case). Same taxonomy as the still route's
 * `classifyXaiFailure`, kept as its own copy here since each Skidmarks
 * API route is self-contained (no shared `lib/xai.ts` today). */
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

/** Classifies a *deferred job* failure \u2014 the start call succeeded (a
 * real `request_id` came back) but polling `GET /v1/videos/{request_id}`
 * eventually reported `status: "failed"` with this documented
 * `error.code` (see
 * https://docs.x.ai/developers/rest-api-reference/inference/videos).
 * Distinct from `classifyXaiVideoHttpFailure` \u2014 this is xAI's own
 * async-generation error taxonomy, not a synchronous HTTP status. */
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

type StartOutcome =
  | { ok: true; requestId: string }
  | { ok: false; status: number; code: string; error: string };

async function startXaiVideoJob(
  prompt: string,
  referenceImageDataUrls: string[],
  apiKey: string,
  model: string
): Promise<StartOutcome> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    duration: CLIP_DURATION_SEC,
    resolution: CLIP_RESOLUTION,
  };
  // Exactly one of `image` (locks the first frame \u2014 xAI's
  // image-to-video mode) or `reference_images` (guided continuity across
  // 2\u20133 plates \u2014 reference-to-video) per xAI's own "mutually
  // exclusive" rule; never both, and never neither (`MIN_REFERENCE_IMAGES`
  // guards that in `POST` below before this is ever called).
  if (referenceImageDataUrls.length === 1) {
    body.image = { url: referenceImageDataUrls[0] };
  } else {
    body.reference_images = referenceImageDataUrls.map((url) => ({ url }));
  }

  let res: Response;
  try {
    res = await fetch(XAI_VIDEO_GENERATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      status: 502,
      code: timedOut ? "timeout" : "network_error",
      error: timedOut
        ? `xAI's video API did not respond within ${START_TIMEOUT_MS / 1000}s.`
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

type PollOutcome =
  | { ok: true; videoUrl: string; durationSec: number }
  | { ok: false; status: number; code: string; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface XaiVideoStatusBody {
  status?: unknown;
  video?: { url?: unknown; duration?: unknown; respect_moderation?: unknown };
  error?: { code?: unknown; message?: unknown };
}

async function pollXaiVideoJob(requestId: string, apiKey: string): Promise<PollOutcome> {
  const deadline = Date.now() + POLL_DEADLINE_MS;

  while (true) {
    let res: Response;
    try {
      res = await fetch(xaiVideoStatusUrl(requestId), {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
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
        typeof payload?.video?.duration === "number" ? payload.video.duration : CLIP_DURATION_SEC;
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

    // "pending" (or any other in-flight value) \u2014 keep polling until
    // the deadline. See this file's module doc comment's "no
    // resume-after-timeout" note for what happens past this point.
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      return {
        ok: false,
        status: 504,
        code: "timeout",
        error:
          `xAI's video render was still processing after ${Math.round(POLL_DEADLINE_MS / 1000)}s \u2014 this ` +
          "route stopped waiting. The render may still finish on xAI's side, but this app has no way to check " +
          "back on it; try again in a bit.",
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

interface GenerateClipRequestBody {
  prompt?: unknown;
  /** Stuart's own, unmodified shot-prompt text \u2014 see
   * `lib/clipGeneration.ts`'s `ClipGenerationRequest.shotPrompt` doc
   * comment. Validated against `MAX_PROMPT_LENGTH` instead of `prompt`
   * (which also carries this route's auto-injected motion-routing hint
   * and band/no-text/no-watermark footer) for the same reason
   * `app/api/skidmarks/generate-still/route.ts` splits the two. Optional
   * so a caller that only sends `prompt` still works (falls back to
   * checking that instead). */
  shotPrompt?: unknown;
  referenceImageDataUrls?: unknown;
  /** The four fields needed to persist a successful render to Vercel
   * Blob under a stable, parseable pathname (see `lib/clipRenderBlob
   * .ts`) instead of only returning xAI's temporary URL. All optional —
   * a caller that omits any of them (or sends one that fails
   * `resolvePersistenceTarget`'s validation) still gets the exact same
   * response shape this route always returned; persistence is purely
   * additive on top of the existing contract, never a new requirement
   * to call this route at all. */
  segmentId?: unknown;
  /** This clip's 1-based position in the timeline \u2014 only used to
   * build a download-friendly numeric filename (e.g.
   * `01_0000-0040_render.mp4`), never anything else. */
  clipIndex?: unknown;
  startSec?: unknown;
  endSec?: unknown;
}

interface RenderPersistenceTarget {
  segmentId: string;
  clipIndex: number;
  startSec: number;
  endSec: number;
}

/**
 * Validates the four optional persistence fields together \u2014 all four
 * or none; a partial/malformed set is treated the same as none sent at
 * all (`null`, "skip persistence") rather than failing the whole
 * request. A render that already cost real xAI money should never be
 * thrown away over a metadata problem on the *save* step; the worst
 * case is the same "temporary URL, not saved" outcome this route always
 * had before this feature existed.
 */
export function resolvePersistenceTarget(body: GenerateClipRequestBody): RenderPersistenceTarget | null {
  const segmentId = typeof body.segmentId === "string" ? body.segmentId.trim() : "";
  const clipIndex = typeof body.clipIndex === "number" ? body.clipIndex : NaN;
  const startSec = typeof body.startSec === "number" ? body.startSec : NaN;
  const endSec = typeof body.endSec === "number" ? body.endSec : NaN;

  if (!isSafeSegmentId(segmentId)) return null;
  if (!Number.isFinite(clipIndex) || clipIndex < 0) return null;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec < 0) return null;

  return {
    segmentId,
    clipIndex: Math.round(clipIndex),
    startSec: Math.round(startSec),
    endSec: Math.round(endSec),
  };
}

type PersistRenderOutcome = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Re-downloads the just-finished render from xAI's temporary URL and
 * re-uploads it to Vercel Blob under this clip's stable pathname (see
 * `lib/clipRenderBlob.ts`), overwriting any earlier render already
 * saved for the same clip. Never throws \u2014 every real failure mode
 * (the re-download failing, Blob not being configured, the upload
 * itself failing) comes back as an honest `{ ok: false, reason }` so
 * the route can still return the render Stuart already paid for.
 */
export async function persistClipRenderToBlob(
  sourceVideoUrl: string,
  target: RenderPersistenceTarget
): Promise<PersistRenderOutcome> {
  let videoRes: Response;
  try {
    videoRes = await fetch(sourceVideoUrl, { signal: AbortSignal.timeout(START_TIMEOUT_MS) });
  } catch (err) {
    return {
      ok: false,
      reason: `Could not download the finished render to save it: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }
  if (!videoRes.ok) {
    return { ok: false, reason: `Downloading the finished render to save it returned HTTP ${videoRes.status}.` };
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await videoRes.arrayBuffer();
  } catch {
    return { ok: false, reason: "Could not read the finished render's bytes to save it." };
  }

  const pathname = buildClipRenderPathname(target.segmentId, target.clipIndex, target.startSec, target.endSec);
  try {
    const blob = await put(pathname, Buffer.from(bytes), {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { ok: true, url: blob.url };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? `Vercel Blob upload failed: ${err.message}`
          : "Vercel Blob upload failed for an unknown reason.",
    };
  }
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
          `${XAI_API_KEY_ENV_VAR} is not set on the server \u2014 clip video rendering is unavailable here. ` +
          "This is the same xAI Grok Imagine key plate-still generation already uses (from console.x.ai). If " +
          "you just added it, Vercel only applies environment variable changes to new deployments \u2014 " +
          "redeploy the project for this function to see it.",
        code: "missing_api_key",
      },
      { status: 501 }
    );
  }

  let body: GenerateClipRequestBody;
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
  // Only the user-authored shot prompt counts against
  // `MAX_PROMPT_LENGTH` \u2014 not the auto-injected motion-routing hint or
  // band/no-text/no-watermark footer `lib/clipGeneration.ts`'s
  // `buildClipGenerationRequest` appends on top of it. See
  // `app/api/skidmarks/generate-still/route.ts`'s matching check for the
  // full reasoning (same fix, same shape, applied here for consistency
  // even though this route's own auto-injected text is short today).
  const shotPromptForLengthCheck = typeof body.shotPrompt === "string" ? body.shotPrompt.trim() : prompt;
  if (shotPromptForLengthCheck.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Shot prompt is too long \u2014 over ${MAX_PROMPT_LENGTH} characters.`, code: "invalid_request" },
      { status: 400 }
    );
  }

  const rawReferences = Array.isArray(body.referenceImageDataUrls) ? body.referenceImageDataUrls : [];
  if (rawReferences.length < MIN_REFERENCE_IMAGES) {
    return NextResponse.json(
      {
        error: "This route needs at least one plate still to animate \u2014 generate or upload one first.",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }
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

  const startResult = await startXaiVideoJob(prompt, rawReferences, apiKey, resolveXaiVideoModel());
  if (!startResult.ok) {
    return NextResponse.json({ error: startResult.error, code: startResult.code }, { status: startResult.status });
  }

  const pollResult = await pollXaiVideoJob(startResult.requestId, apiKey);
  if (!pollResult.ok) {
    return NextResponse.json({ error: pollResult.error, code: pollResult.code }, { status: pollResult.status });
  }

  const persistenceTarget = resolvePersistenceTarget(body);
  if (!persistenceTarget) {
    // No (or no valid) segmentId/clipIndex/startSec/endSec \u2014 same
    // response shape this route always returned, before persistence
    // existed. See `resolvePersistenceTarget`'s doc comment.
    return NextResponse.json({ videoUrl: pollResult.videoUrl, durationSec: pollResult.durationSec });
  }

  const persistOutcome = await persistClipRenderToBlob(pollResult.videoUrl, persistenceTarget);
  if (persistOutcome.ok) {
    return NextResponse.json({
      videoUrl: persistOutcome.url,
      durationSec: pollResult.durationSec,
      persisted: true,
    });
  }

  // Persistence failed \u2014 still return the render Stuart already paid
  // for (xAI's own temporary URL), honestly flagged as not saved. See
  // this file's module doc comment's "never claims a render is saved
  // when it isn't" note.
  return NextResponse.json({
    videoUrl: pollResult.videoUrl,
    durationSec: pollResult.durationSec,
    persisted: false,
    persistError: persistOutcome.reason,
  });
}
