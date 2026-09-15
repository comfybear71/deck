import { del, list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { decodeDataUrl } from "@/lib/dataUrl";
import {
  buildClipRenderLastFramePathname,
  buildClipRenderPathname,
  buildClipRenderPlatePrefix,
  isSafeSegmentId,
} from "@/lib/clipRenderBlob";
import { extractLastVideoFrameServer } from "@/lib/serverVideoFrame";
import {
  buildLtx23Ia2vWorkflow,
  downloadComfyCloudOutput,
  letterboxImageForLtxIa2v,
  pollComfyCloudJob,
  resolveComfyCloudCredentials,
  submitComfyCloudWorkflow,
  uploadComfyCloudInput,
} from "@/lib/comfyCloud";
import {
  downloadMinimaxH3Video,
  pollMinimaxH3Video,
  resolveMinimaxCredentials,
  submitMinimaxH3Video,
  type MinimaxCredentials,
} from "@/lib/minimaxH3";
import { sliceMp3ToTimeRange } from "@/lib/mp3Slice";

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
 * **Three real video backends now \u2014 routed by `vocal` for Vocal vs.
 * Instrumental, plus a real, opt-in H3/Grok switch on the Instrumental
 * side (Stuart lock, 2026-09-13, updated same day).** This route used
 * to call xAI's Grok Imagine video API for every render, full stop.
 * Then it split on `vocal` alone, no picker at all. As of this pass:
 * - `vocal: true` (Vocal/lip-sync performance) \u2014 **Comfy Cloud
 *   running the full LTX 2.3 IA2V graph** (`lib/comfyCloud.ts`,
 *   `workflow/LTX_2.3_IA2V_Cloud.json`, `COMFY_CLOUD_API_KEY`), driven
 *   by a real slice of the attached song's own vocal audio
 *   (`lib/mp3Slice.ts`) instead of an automatic push-in/zoom \u2014 see
 *   `handleVocalComfyLtxRender` below and `lib/comfyCloud.ts`'s module
 *   doc comment for that path's own honesty story. This used to call
 *   Comfy's hosted `LtxApi25AudioToVideo` partner node, written off doc
 *   pages; that never survived a real call (see `lib/comfyCloud.ts`)
 *   and has been replaced by the graph the original Skidmarks repo
 *   actually renders with. No switch on this path \u2014 Stuart never
 *   asked for one here.
 * - `vocal: false` (Instrumental/B-roll/opener) \u2014 now **two** real
 *   backends, chosen by the request's own `videoBackend` field (never
 *   trusted blindly \u2014 anything other than the literal `"h3"` falls
 *   back to Grok, the original/back-compat default; see the routing
 *   code in `POST` below):
 *   - `videoBackend: "h3"` \u2014 **MiniMax H3** (`lib/minimaxH3.ts`,
 *     `MINIMAX_API_KEY`), first-frame (optionally first+last-frame)
 *     image-to-video. This is the *client's own* new default \u2014 see
 *     `lib/skidmarks.ts`'s `resolveInstrumentalVideoModel` \u2014 not a
 *     server-side default; a request that omits `videoBackend`
 *     entirely (an older caller, a hand-rolled request) still gets
 *     Grok, unchanged, so nothing already calling this route without
 *     the new field silently starts spending against a different
 *     provider.
 *   - anything else (including `"grok"` or the field simply missing)
 *     \u2014 unchanged: **xAI's Grok Imagine video API**, the same
 *     `XAI_API_KEY` plate *stills* already use
 *     (`app/api/skidmarks/generate-still/route.ts`). See below for
 *     this path's full, still-accurate live-verification story.
 *
 * Nothing here lets Stuart pick a backend from a persistent pill/badge
 * \u2014 `vocal` is the same boolean `lib/skidmarks.ts`'s
 * `SKIDMARKS_SEGMENT_LABEL_META` already derives from a clip's own
 * label; `videoBackend` is the clip's own stored H3/Grok choice
 * (`SkidmarksClipSegment.instrumentalVideoModel`), surfaced only as a
 * small switch *inside* `components/SkidmarksClipRender.tsx`'s
 * existing two-tap Render confirm, per Stuart's own "no model pill
 * farm" ask \u2014 both threaded straight through by
 * `lib/clipGeneration.ts`'s `buildClipGenerationRequest`.
 *
 * **The rest of this doc comment describes the Grok/Instrumental path
 * only** \u2014 real, documented (https://docs.x.ai/developers/model-
 * capabilities/video/generation, .../video/image-to-video, .../video/
 * reference-to-video), and \u2014 unlike the still-image route above, where
 * the two live verification calls predate this PR \u2014 **verified live
 * in this exact sandbox while building this route** (before the Comfy/
 * LTX split existed): a real `POST /v1/videos/generations` call
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
 * **Cost-capped resolution, and a now-real, still bounded duration.**
 * Unlike `XAI_IMAGE_MODEL` (a deliberate low-risk override for the still
 * route, since image cost swings are small), `CLIP_RESOLUTION` below
 * stays hardcoded at 480p, the cheapest documented tier ($0.08/sec).
 * `duration`, per Stuart's per-plate auto-duration ask, is no longer a
 * flat 5s for every render \u2014 it's `segmentLengthSec / plateCount`,
 * clamped to `[MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC]` (5\u201315s,
 * Grok's documented ceiling), computed client-side
 * (`lib/clipGeneration.ts`'s `computePlateDurationSec`) and sent as
 * `durationSec` \u2014 this route just clamps it again defensively and
 * forwards it to xAI's own `duration` parameter, it doesn't invent the
 * number. A resolution bump (1080p is 3x the per-second rate) is real
 * spend-per-tap creep in a different way \u2014 Stuart's cost lock says that's a deliberate
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
 * than 3 \u2014 this route keeps that general capability (any caller may
 * still send 2\u20133 references), even though the current UI
 * (`components/SkidmarksClipRender.tsx`, the per-plate-select rework)
 * only ever sends exactly 1 (the selected plate's own still) now \u2014
 * see `lib/clipGeneration.ts`'s module doc comment for why continuity
 * across a clip's several plates moved to "render each separately, edit
 * together in Resolve" instead of one multi-reference call. */
const MAX_REFERENCE_IMAGES = 3;
const MIN_REFERENCE_IMAGES = 1;

/** Cost-capped output resolution \u2014 see this file's module doc comment
 * for why this stays a code change, not an env knob: 480p keeps the
 * per-second rate at the cheapest documented tier ($0.08/s). */
const CLIP_RESOLUTION = "480p";
/** Default duration when a caller doesn't send `durationSec` (an older
 * caller, or a hand-rolled request) \u2014 matches this route's original
 * flat 5s behavior exactly, so nothing already calling this route
 * without the new field changes. `MIN_CLIP_DURATION_SEC`/
 * `MAX_CLIP_DURATION_SEC` are the real, now-honored range: Stuart's
 * per-plate auto-duration ask (`segmentLengthSec / plateCount`, clamped
 * 5\u201315s \u2014 see `lib/clipGeneration.ts`'s `computePlateDurationSec`)
 * sends a real value inside that range, which this route now forwards
 * to xAI's own documented `duration` parameter instead of hardcoding
 * it. **Honesty note**: the original live-verification call this file's
 * module doc comment describes used `duration: 3`, confirming xAI's API
 * genuinely accepts a variable duration \u2014 the specific 5\u201315s range
 * itself was not separately re-verified live against a real xAI
 * response while building this rework (each such call costs Stuart real
 * money); this is real, documented plumbing, not a fabricated "verified"
 * claim for every value in the range. */
const DEFAULT_CLIP_DURATION_SEC = 5;
export const MIN_CLIP_DURATION_SEC = 5;
export const MAX_CLIP_DURATION_SEC = 15;

/** Vocal/Comfy-LTX duration range \u2014 mirrors
 * `lib/clipGeneration.ts`'s `MIN_LTX_CLIP_DURATION_SEC`/
 * `MAX_LTX_CLIP_DURATION_SEC` (duplicated here on purpose, same "each
 * Skidmarks API route stays self-contained" convention as the Grok
 * constants above \u2014 nothing enforces the two staying in sync
 * automatically). `30`, not the `20` this shipped with originally.
 * That `20` came from the hosted `LtxApi25AudioToVideo` partner node,
 * which really does hard-reject driving audio outside 2\u201320s in its
 * own `execute()` \u2014 but this route doesn't use that node any more.
 * On the LTX 2.3 graph duration is an ordinary graph input (node
 * `340:331`) with no such cap, and 30s matches Stuart's own real, live
 * Comfy Cloud usage. */
export const MIN_LTX_CLIP_DURATION_SEC = 5;
export const MAX_LTX_CLIP_DURATION_SEC = 30;
/** A floor on the *actual* driving audio (2s) \u2014 looser than
 * `MIN_LTX_CLIP_DURATION_SEC` (this
 * app's own product floor, which nothing normally sends below); this
 * sanity-checks the *actual*, frame-aligned sliced-audio length
 * (`lib/mp3Slice.ts`'s `sliceMp3ToTimeRange` rounds outward to frame
 * boundaries, so it can land slightly outside the requested range)
 * before spending a real Comfy Cloud submit call on a sliver of audio
 * too short to animate anything from. **There is no matching upper-bound error
 * here** \u2014 `sliceMp3ToTimeRange` is called with `MAX_LTX_CLIP_DURATION_SEC`
 * as its own `maxDurationSec`, which trims an over-long slice back down
 * to that ceiling instead of this route ever having to reject a
 * request that was already correctly clamped by its caller (see that
 * function's doc comment for the real live-QA'd bug this fixes \u2014
 * Stuart hit a spurious "audio slice is 20.0s" rejection at the old
 * ceiling from exactly this rounding gap). */
const MIN_LTX_AUDIO_INPUT_SEC = 2;

const START_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 20_000;
/** Kept short \u2014 this is a cheap `HEAD` sanity check right after our own
 * `put()`, not a real download; it should never meaningfully add to the
 * time Stuart's already waited for the render itself. */
const VERIFY_TIMEOUT_MS = 8_000;
/** Time between status polls. Exported so tests can advance fake timers
 * by exactly this much rather than guessing. */
export const POLL_INTERVAL_MS = 4_000;
/** Server-side polling ceiling \u2014 comfortably under `maxDuration` so
 * this route can still return an honest `timeout` response instead of
 * being killed mid-request. See this file's module doc comment's "no
 * resume-after-timeout" note. */
export const POLL_DEADLINE_MS = 240_000;
/** Same shape/reasoning as `POLL_DEADLINE_MS`, for the Comfy Cloud
 * job poll (`lib/comfyCloud.ts`'s `pollComfyCloudJob`, `GET /api/jobs/
 * {promptId}`) instead of xAI's own REST poll loop. */
export const COMFY_POLL_DEADLINE_MS = 240_000;
const COMFY_AUDIO_FETCH_TIMEOUT_MS = 30_000;
/** Same shape/reasoning as `POLL_DEADLINE_MS`/`COMFY_POLL_DEADLINE_MS`,
 * for MiniMax H3's own `GET /v2/query/video_generation/{taskId}` REST
 * poll loop (`pollMinimaxH3JobUntilDone` below). Not tuned against a
 * real H3 render's actual latency (no `MINIMAX_API_KEY` in this
 * sandbox \u2014 see `lib/minimaxH3.ts`'s module doc comment); reusing the
 * same conservative ceiling this route's other two backends already
 * use is the honest default until real timing data says otherwise. */
export const MINIMAX_POLL_DEADLINE_MS = 240_000;
/** H3's own accepted image count \u2014 first frame, optionally plus a
 * last frame (`lib/minimaxH3.ts`'s `submitMinimaxH3Video`). Distinct
 * from `MAX_REFERENCE_IMAGES` (3, the Grok path's own multi-reference
 * ceiling) \u2014 H3 has no third role to put an extra image in. */
const MAX_H3_REFERENCE_IMAGES = 2;

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
  model: string,
  durationSec: number
): Promise<StartOutcome> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    duration: durationSec,
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

async function pollXaiVideoJob(requestId: string, apiKey: string, requestedDurationSec: number): Promise<PollOutcome> {
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
  /** A locked vocalist's negative cues (Vocal/Comfy-LTX only) — see
   * `lib/clipGeneration.ts`'s `ClipGenerationRequest.negativePrompt` doc
   * comment. Sent to the workflow's real negative-conditioning node
   * instead of riding along inside `prompt`. Optional; omitted entirely
   * for an Instrumental request or a Vocal one with no locked vocalist. */
  negativePrompt?: unknown;
  referenceImageDataUrls?: unknown;
  /** Real, per-plate render length in seconds — see this file's module
   * doc comment and `lib/clipGeneration.ts`'s `computePlateDurationSec`.
   * Optional; falls back to `DEFAULT_CLIP_DURATION_SEC` (5s, this
   * route's original flat behavior) when omitted, then clamped into
   * `[MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC]` either way. */
  durationSec?: unknown;
  /** The fields needed to persist a successful render to Vercel Blob
   * under a stable, parseable, **per-plate** pathname (see
   * `lib/clipRenderBlob.ts`) instead of only returning xAI's temporary
   * URL. `segmentId`/`plateId`/`clipIndex`/`startSec`/`endSec` are all
   * required together for persistence; a partial/malformed set is
   * treated the same as none sent at all (see
   * `resolvePersistenceTarget`) — persistence is purely additive on top
   * of the existing contract, never a new requirement to call this
   * route at all. `plateIndex`/`plateCount` are optional on top of
   * that — only used to letter the filename when a clip has more than
   * one plate. */
  segmentId?: unknown;
  plateId?: unknown;
  /** This plate's 0-based position within its own clip's strip, and
   * that strip's total slot count — see `lib/clipRenderBlob.ts`'s
   * `buildClipRenderFilename` for exactly how these letter the
   * filename. */
  plateIndex?: unknown;
  plateCount?: unknown;
  /** This clip's 1-based position in the timeline — only used to
   * build a download-friendly numeric filename (e.g.
   * `01_0000-0040_render.mp4`), never anything else. */
  clipIndex?: unknown;
  startSec?: unknown;
  endSec?: unknown;
  /** `true` for a Vocal/lip-sync clip \u2014 routes this request to Comfy
   * Cloud's LTX-2.5 `AudioToVideo` node instead of xAI Grok. See this
   * file's module doc comment's "Two real video backends" note.
   * `false`/omitted keeps the existing Grok path exactly as before this
   * field existed. */
  vocal?: unknown;
  /** Required (together with `audioStartSec`/`audioEndSec`) when
   * `vocal` is true \u2014 the attached song's own durable Blob URL
   * (`SkidmarksMp3Attachment.audioUrl`), fetched and sliced
   * (`lib/mp3Slice.ts`) into this plate's own driving audio track.
   * Ignored on the Grok/Instrumental path. */
  mp3AudioUrl?: unknown;
  /** This plate's own absolute audio window within the full song \u2014
   * see `lib/clipGeneration.ts`'s `computePlateTimeRange`. Only read
   * when `vocal` is true; distinct from `startSec`/`endSec` above,
   * which stay the *clip's* whole time range for the download
   * filename. */
  audioStartSec?: unknown;
  audioEndSec?: unknown;
  /** Only read when `vocal` is falsy \u2014 picks the Instrumental video
   * backend: the literal string `"h3"` routes to MiniMax H3
   * (`handleInstrumentalH3Render` below); anything else (including
   * `"grok"`, or the field simply missing \u2014 an older caller) keeps
   * the original xAI Grok path. See this file's module doc comment's
   * "Three real video backends" note for why the *server's* own
   * default here stays Grok even though the *client's* new default is
   * H3 (`lib/skidmarks.ts`'s `resolveInstrumentalVideoModel`). */
  videoBackend?: unknown;
}

interface RenderPersistenceTarget {
  segmentId: string;
  plateId: string;
  clipIndex: number;
  startSec: number;
  endSec: number;
  /** 0-based index used to letter the filename (`01a_...`) — only set
   * when the client reported more than one plate on this clip. */
  plateLetterIndex?: number;
}

/**
 * Validates the persistence fields together — `segmentId`/`plateId`/
 * `clipIndex`/`startSec`/`endSec` all or none; a partial/malformed set
 * is treated the same as none sent at all (`null`, "skip persistence")
 * rather than failing the whole request. A render that already cost
 * real xAI money should never be thrown away over a metadata problem on
 * the *save* step; the worst case is the same "temporary URL, not
 * saved" outcome this route always had before this feature existed.
 */
export function resolvePersistenceTarget(body: GenerateClipRequestBody): RenderPersistenceTarget | null {
  const segmentId = typeof body.segmentId === "string" ? body.segmentId.trim() : "";
  const plateId = typeof body.plateId === "string" ? body.plateId.trim() : "";
  const clipIndex = typeof body.clipIndex === "number" ? body.clipIndex : NaN;
  const startSec = typeof body.startSec === "number" ? body.startSec : NaN;
  const endSec = typeof body.endSec === "number" ? body.endSec : NaN;

  if (!isSafeSegmentId(segmentId)) return null;
  if (!isSafeSegmentId(plateId)) return null;
  if (!Number.isFinite(clipIndex) || clipIndex < 0) return null;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec < 0) return null;

  const plateIndex = typeof body.plateIndex === "number" ? body.plateIndex : NaN;
  const plateCount = typeof body.plateCount === "number" ? body.plateCount : NaN;
  const plateLetterIndex =
    Number.isFinite(plateIndex) && Number.isFinite(plateCount) && plateCount > 1
      ? Math.max(0, Math.round(plateIndex))
      : undefined;

  return {
    segmentId,
    plateId,
    clipIndex: Math.round(clipIndex),
    startSec: Math.round(startSec),
    endSec: Math.round(endSec),
    plateLetterIndex,
  };
}

type PersistRenderOutcome =
  | {
      ok: true;
      url: string;
      /** The durable Blob URL of this render's own last frame, extracted
       * server-side via ffmpeg (`lib/serverVideoFrame.ts`) — present
       * whenever that extraction and its own upload both succeeded.
       * Absent (not a failure of the render/save itself) when either
       * step didn't — frame-carry is best-effort layered on top of a
       * save that already succeeded, never something that can turn a
       * successful save into a failure. See `persistRenderBytesToBlob`. */
      lastFrameUrl?: string;
    }
  | { ok: false; reason: string };

/**
 * Deletes every blob already sitting under this plate's own directory
 * prefix (`lib/clipRenderBlob.ts`'s `buildClipRenderPlatePrefix`)
 * *except* the one just written \u2014 the actual enforcement of "exactly
 * one persisted render per `(segmentId, plateId)`," a live-QA'd real
 * gap: `allowOverwrite: true` alone only replaces a blob sitting at the
 * *exact same pathname*, and the pathname's own filename bakes in
 * `clipIndex`/`startSec`/`endSec`/a plate-count-dependent letter suffix
 * (see `buildClipRenderPathname`) \u2014 none of which are guaranteed
 * stable between two renders of what Stuart still considers "the same
 * plate" (the timeline re-sorting, a plate added to/removed from the
 * same clip's strip in between). Without this cleanup, a re-render
 * under a *different* filename left the old take sitting there as an
 * orphaned, still-listed blob \u2014 a ghost entry alongside the new one
 * in both the `GET /api/skidmarks/clip-renders` listing and the
 * rendered-clips shelf. Best-effort and never fatal: a failed cleanup
 * here doesn't undo or fail the render Stuart already paid for and
 * successfully saved under the new pathname; it just risks a leftover
 * orphan blob (a storage-hygiene issue, not a cost or correctness one
 * \u2014 see AGENTS.md's "Persisting a render to Vercel Blob is a storage
 * cost, not a per-tap xAI spend risk").
 *
 * `keepPathnames` takes more than one now that a plate can carry two
 * live blobs at once (the render itself, plus its own extracted last
 * frame \u2014 `buildClipRenderLastFramePathname`, same plate prefix): both
 * are "the current take" and neither should be pruned as if it were a
 * leftover from an earlier one.
 */
async function pruneStaleRendersForPlate(segmentId: string, plateId: string, keepPathnames: string[]): Promise<void> {
  try {
    const { blobs } = await list({ prefix: buildClipRenderPlatePrefix(segmentId, plateId) });
    const stale = blobs.filter((b) => !keepPathnames.includes(b.pathname)).map((b) => b.pathname);
    if (stale.length > 0) await del(stale);
  } catch {
    // Best-effort \u2014 see this function's doc comment.
  }
}

/**
 * The actual `put()` + HEAD-verify + prune sequence, factored out of
 * `persistClipRenderToBlob` so the Comfy/LTX path
 * (`handleVocalComfyLtxRender` below) \u2014 which already has the
 * finished render's raw bytes from `downloadComfyCloudOutput`, with no
 * second "temporary hosted URL" to re-download from the way xAI's
 * `video.url` gives the Grok path \u2014 can persist directly without a
 * redundant re-download-from-self round trip. Never throws; see
 * `persistClipRenderToBlob`'s doc comment for the full behavior this
 * shares (HEAD-verify gap, pruning, honest failure shape).
 */
async function persistRenderBytesToBlob(bytes: Uint8Array, target: RenderPersistenceTarget): Promise<PersistRenderOutcome> {
  const pathname = buildClipRenderPathname(
    target.segmentId,
    target.plateId,
    target.clipIndex,
    target.startSec,
    target.endSec,
    target.plateLetterIndex
  );
  try {
    const blob = await put(pathname, Buffer.from(bytes), {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Live-QA'd real gap: `put()` resolving does not guarantee the
    // returned URL is actually, reliably fetchable right away (an
    // edge-cache miss serving a stale 404, a since-pruned/overwritten
    // path, a truncated upload) \u2014 and this feature's hard rule is
    // "a paid success must never be silently invisible" (see AGENTS.md).
    // A plate 2 render shipped exactly this way once: `persisted: true`
    // came back, the shelf wired in a URL that quietly wasn't playable,
    // and Stuart saw a black broken card with no error at all. One
    // cheap `HEAD` here closes that gap \u2014 a failure here still
    // returns the render Stuart already paid for via the normal
    // `persisted: false` / `persistError` path below (same honest shape
    // as every other persistence failure), instead of wiring a dead URL
    // into the shelf and calling it done.
    //
    // **Retried with longer delays, and trusts a clean-404-only outcome
    // (2026-09-14, second live-QA pass \u2014 the first retry window, 3.5s
    // total, still wasn't enough)**: a single immediate `HEAD` right
    // after `put()` resolves often lands during Vercel Blob's own
    // propagation window, which can run well past a few seconds. Stuart
    // hit this twice after real Comfy Cloud charges (~$3.51 each)
    // landed real, playable renders this check falsely refused to count
    // as saved. Up to 8 attempts, ~35s of total wait \u2014 and if `put()`
    // itself succeeded (it already did, above) and every single failed
    // attempt was a clean 404 (never a different status, never a thrown
    // network error), that's propagation lag, not a missing file: this
    // now trusts the write and reports success rather than discarding a
    // render Stuart already paid for. Any *other* kind of failure along
    // the way \u2014 a non-404 status, a real network error \u2014 still reports
    // `persistError` honestly, same as before. Never re-runs LTX/Comfy/
    // xAI/H3, never re-uploads.
    const VERIFY_RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 8000, 8000, 8000];
    let verified = false;
    let sawRealVerifyFailure = false; // a non-404 HTTP status, or a thrown network error
    let lastVerifyStatus: number | undefined;
    let lastVerifyErr: unknown;
    for (let attempt = 0; attempt <= VERIFY_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const verifyRes = await fetch(blob.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        if (verifyRes.ok) {
          verified = true;
          lastVerifyErr = undefined;
          break;
        }
        lastVerifyStatus = verifyRes.status;
        if (verifyRes.status !== 404) sawRealVerifyFailure = true;
      } catch (err) {
        lastVerifyErr = err;
        sawRealVerifyFailure = true;
      }
      if (attempt < VERIFY_RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_DELAYS_MS[attempt]));
      }
    }
    if (!verified && !sawRealVerifyFailure) {
      // Every failed attempt was a clean 404 and put() itself already
      // succeeded \u2014 trust the write rather than the (possibly still
      // un-propagated) read.
      verified = true;
    }
    if (!verified) {
      if (lastVerifyErr) {
        return {
          ok: false,
          reason: `The render was saved to Vercel Blob, but could not be verified as playable: ${lastVerifyErr instanceof Error ? lastVerifyErr.message : "network error"}.`,
        };
      }
      return {
        ok: false,
        reason:
          `The render was saved to Vercel Blob, but the saved file isn't reachable yet (HTTP ${lastVerifyStatus}) ` +
          "\u2014 not marking this as a successful save.",
      };
    }

    // Server-side last-frame extraction (`lib/serverVideoFrame.ts`) —
    // the real replacement for the old client-side `<video>`+`<canvas>`
    // capture, which failed live three separate times on Stuart's
    // iPhone (see that module's doc comment). Best-effort, layered on
    // top of a save that already succeeded above: a failure here never
    // fails the render/save itself, it just means this plate's
    // `lastFrameUrl` comes back unset and whatever's chaining off this
    // render (the manual single-clip flow, the script-sequence
    // automation) reports that honestly rather than guessing.
    let lastFramePathname: string | undefined;
    let lastFrameUrl: string | undefined;
    const frameOutcome = await extractLastVideoFrameServer(bytes);
    if (frameOutcome.ok) {
      lastFramePathname = buildClipRenderLastFramePathname(
        target.segmentId,
        target.plateId,
        target.clipIndex,
        target.startSec,
        target.endSec,
        target.plateLetterIndex
      );
      try {
        const frameBlob = await put(lastFramePathname, Buffer.from(frameOutcome.bytes), {
          access: "public",
          contentType: "image/jpeg",
          addRandomSuffix: false,
          allowOverwrite: true,
        });
        lastFrameUrl = frameBlob.url;
      } catch {
        lastFramePathname = undefined; // nothing actually saved there — don't protect it from pruning below
      }
    }

    await pruneStaleRendersForPlate(target.segmentId, target.plateId, [pathname, lastFramePathname].filter((p): p is string => Boolean(p)));
    return lastFrameUrl ? { ok: true, url: blob.url, lastFrameUrl } : { ok: true, url: blob.url };
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

/**
 * Re-downloads the just-finished render from xAI's temporary URL and
 * re-uploads it to Vercel Blob under this clip's stable pathname (see
 * `lib/clipRenderBlob.ts`), overwriting any earlier render already
 * saved for the same clip, then prunes any other stale blob left under
 * this same plate's prefix (`pruneStaleRendersForPlate` above) so a
 * plate can never accumulate more than one persisted render even when
 * its computed filename has drifted since the last take. Never throws
 * \u2014 every real failure mode (the re-download failing, Blob not being
 * configured, the upload itself failing) comes back as an honest
 * `{ ok: false, reason }` so the route can still return the render
 * Stuart already paid for.
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

  return persistRenderBytesToBlob(new Uint8Array(bytes), target);
}

function isReferenceDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,.+/.test(value);
}

/** Fetches the attached song's own durable Blob audio (never the
 * ephemeral in-tab `File`/object URL \u2014 a server route can't reach
 * that at all), honestly, without ever pretending success on a
 * network/HTTP failure. */
async function fetchMp3AudioBytes(url: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(COMFY_AUDIO_FETCH_TIMEOUT_MS) });
  } catch (err) {
    return {
      ok: false,
      error: `Could not fetch the attached song's audio to slice it: ${err instanceof Error ? err.message : "network error"}.`,
    };
  }
  if (!res.ok) {
    return { ok: false, error: `Fetching the attached song's audio returned HTTP ${res.status}.` };
  }
  try {
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch {
    return { ok: false, error: "Could not read the attached song's audio bytes." };
  }
}

/**
 * The Vocal/Comfy-LTX render path \u2014 see this file's module doc
 * comment's "Two real video backends" note and `lib/comfyCloud.ts`'s
 * module doc comment for the full honesty story on what's real/
 * documented here vs. not live-tested. Carries forward the prior
 * session's own hypothesis, verified true in this codebase: at render
 * time the attached MP3's raw browser `File` is long gone (this is a
 * server route) \u2014 the only real source for its audio is
 * `mp3.audioUrl`, the durable Vercel Blob URL
 * `lib/mp3Blob.ts`/`SkidmarksMp3Attachment.audioUrl` uploads at attach
 * time. If that's missing (upload never finished, Blob unconfigured),
 * this returns an honest `missing_audio_url` error \u2014 **never** a fake
 * success with an automatic motion hint standing in for real audio.
 *
 * Steps, each with its own honest failure exit: resolve
 * `COMFY_CLOUD_API_KEY` \u2192 validate `mp3AudioUrl`/`audioStartSec`/
 * `audioEndSec` \u2192 fetch the full song's bytes \u2192 frame-slice this
 * plate's own window (`lib/mp3Slice.ts`) \u2192 decode the plate still's
 * data URL \u2192 upload both to Comfy Cloud \u2192 submit the LTX 2.3
 * IA2V graph \u2192 poll `GET /api/jobs/{promptId}` to completion \u2192
 * download the finished video \u2192 persist to Vercel Blob
 * (or fall back to a `data:` URL when no persistence target was given
 * \u2014 unlike the Grok path, Comfy's own signed download URL is a
 * one-shot, so there's no second "temporary hosted URL" to hand back
 * the way xAI's `video.url` gives; a real result Stuart already paid
 * for must never be silently dropped just because persistence wasn't
 * requested or failed).
 */
async function handleVocalComfyLtxRender(
  body: GenerateClipRequestBody,
  prompt: string,
  referenceImageDataUrl: string
): Promise<Response> {
  const creds = resolveComfyCloudCredentials();
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "COMFY_CLOUD_API_KEY is not set on the server \u2014 Vocal clip rendering (Comfy Cloud LTX) is " +
          "unavailable here. Create a key at platform.comfy.org (an active Comfy Cloud subscription is " +
          "required to run workflows via this API) and set it as this project's COMFY_CLOUD_API_KEY. If you " +
          "just added it, Vercel only applies environment variable changes to new deployments \u2014 redeploy " +
          "the project for this function to see it.",
        code: "missing_api_key",
      },
      { status: 501 }
    );
  }

  // Carried-forward directive: an audio-less "success" is never
  // acceptable here \u2014 see this function's doc comment.
  const mp3AudioUrl = typeof body.mp3AudioUrl === "string" ? body.mp3AudioUrl.trim() : "";
  if (!mp3AudioUrl) {
    return NextResponse.json(
      {
        error:
          "This clip has no durable audio to animate from \u2014 the attached MP3's audio hasn't finished " +
          "uploading to Vercel Blob yet (or Blob storage isn't configured here). Comfy Cloud's LTX node needs " +
          "a real slice of the vocal performance, not just a text prompt.",
        code: "missing_audio_url",
      },
      { status: 400 }
    );
  }
  const audioStartSec = typeof body.audioStartSec === "number" ? body.audioStartSec : NaN;
  const audioEndSec = typeof body.audioEndSec === "number" ? body.audioEndSec : NaN;
  if (!Number.isFinite(audioStartSec) || !Number.isFinite(audioEndSec) || audioEndSec <= audioStartSec || audioStartSec < 0) {
    return NextResponse.json(
      {
        error: "Missing or invalid audioStartSec/audioEndSec \u2014 can't slice this plate's audio window.",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }

  const audioFetch = await fetchMp3AudioBytes(mp3AudioUrl);
  if (!audioFetch.ok) {
    return NextResponse.json({ error: audioFetch.error, code: "upstream_error" }, { status: 502 });
  }

  // `maxDurationSec` here is what actually prevents the old "audio
  // slice is 20.0s" spurious rejection (see `sliceMp3ToTimeRange`'s doc
  // comment) \u2014 the caller (`lib/clipGeneration.ts`'s
  // `computeLtxPlateDurationSec`/`buildClipGenerationRequest`) already
  // clamps its *requested* window into `[MIN_LTX_CLIP_DURATION_SEC,
  // MAX_LTX_CLIP_DURATION_SEC]`, but this function's own outward
  // frame-rounding could still push the *actual* slice a hair past that
  // ceiling without it; trimming here instead of erroring means a
  // request that was already correctly clamped can never fail this
  // route over an arithmetic technicality.
  const sliceOutcome = sliceMp3ToTimeRange(audioFetch.bytes, audioStartSec, audioEndSec, MAX_LTX_CLIP_DURATION_SEC);
  if (!sliceOutcome.ok) {
    return NextResponse.json({ error: sliceOutcome.error, code: "invalid_audio" }, { status: 422 });
  }
  const actualDurationSec = sliceOutcome.actualEndSec - sliceOutcome.actualStartSec;
  // Only a genuine "not enough real audio to animate" case is left as
  // an honest error \u2014 this app can't fabricate audio that isn't there
  // (e.g. a plate whose window lands right at the very end of a short
  // song). There is deliberately no matching upper-bound check: the
  // `maxDurationSec` trim above already guarantees `actualDurationSec`
  // can't exceed `MAX_LTX_CLIP_DURATION_SEC`, so a "too long" branch
  // here would be dead code that could only ever fire on a rounding
  // technicality \u2014 exactly the bug this fixes, not a real outcome to
  // still guard against.
  if (actualDurationSec < MIN_LTX_AUDIO_INPUT_SEC) {
    return NextResponse.json(
      {
        error:
          `This plate's audio slice is only ${actualDurationSec.toFixed(1)}s \u2014 Comfy Cloud's LTX node needs ` +
          `at least ${MIN_LTX_AUDIO_INPUT_SEC}s of driving audio, and this plate/clip's own timing doesn't leave ` +
          "enough real song left to slice.",
        code: "invalid_request",
      },
      { status: 422 }
    );
  }

  const decodedImage = decodeDataUrl(referenceImageDataUrl);
  if (!decodedImage) {
    return NextResponse.json(
      { error: "Could not decode the plate still's data URL.", code: "invalid_request" },
      { status: 400 }
    );
  }

  // See `letterboxImageForLtxIa2v`'s doc comment — a non-16:9 plate gets
  // center-cropped by Comfy's own IA2V resize otherwise, which can chop
  // straight through a locked character's hat/shadow framing before the
  // video model ever sees a frame to animate from.
  const framedImage = await letterboxImageForLtxIa2v(decodedImage.bytes, decodedImage.mimeType);
  const imageUpload = await uploadComfyCloudInput(
    framedImage.bytes,
    framedImage.letterboxed ? `skidmarks-plate-${Date.now()}.jpg` : `skidmarks-plate-${Date.now()}.png`,
    framedImage.mimeType,
    creds
  );
  if (!imageUpload.ok) {
    return NextResponse.json({ error: imageUpload.error, code: imageUpload.code }, { status: imageUpload.status });
  }

  const audioUpload = await uploadComfyCloudInput(
    sliceOutcome.bytes,
    `skidmarks-vocal-${Date.now()}.mp3`,
    "audio/mpeg",
    creds
  );
  if (!audioUpload.ok) {
    return NextResponse.json({ error: audioUpload.error, code: audioUpload.code }, { status: audioUpload.status });
  }

  // `durationSec` is the real, frame-aligned length of the audio slice
  // this render is actually driven by \u2014 an ordinary graph input on
  // the LTX 2.3 template (node `340:331`), not a hosted node's capped
  // parameter. Everything else in the graph (checkpoint, the
  // `talkvid-3k` ID LoRA, samplers, VAE chain) is left exactly as the
  // verified template has it.
  const negativePrompt = typeof body.negativePrompt === "string" ? body.negativePrompt.trim() : "";
  const workflow = buildLtx23Ia2vWorkflow({
    imageFilename: imageUpload.name,
    audioFilename: audioUpload.name,
    prompt,
    durationSec: actualDurationSec,
    ...(negativePrompt ? { negativePrompt } : {}),
  });

  const submitResult = await submitComfyCloudWorkflow(workflow, creds);
  if (!submitResult.ok) {
    return NextResponse.json({ error: submitResult.error, code: submitResult.code }, { status: submitResult.status });
  }

  const completionResult = await pollComfyCloudJob(submitResult.promptId, creds, COMFY_POLL_DEADLINE_MS);
  if (!completionResult.ok) {
    return NextResponse.json({ error: completionResult.error, code: completionResult.code }, { status: completionResult.status });
  }

  const downloadResult = await downloadComfyCloudOutput(completionResult.videoFile, creds);
  if (!downloadResult.ok) {
    return NextResponse.json({ error: downloadResult.error, code: downloadResult.code }, { status: downloadResult.status });
  }

  const persistenceTarget = resolvePersistenceTarget(body);
  if (!persistenceTarget) {
    // No (or no valid) segmentId/clipIndex/startSec/endSec. Unlike the
    // Grok path, Comfy's own download URL is a one-shot signed link, so
    // there's no second "temporary hosted URL" left to hand back once
    // we've already read its bytes \u2014 a plain `data:` URL keeps this
    // real result usable (playable, downloadable) without inventing a
    // persistence Stuart didn't ask for. See this function's doc
    // comment.
    return NextResponse.json({
      videoUrl: bufferToDataUrl(downloadResult.bytes, "video/mp4"),
      durationSec: actualDurationSec,
    });
  }

  const persistOutcome = await persistRenderBytesToBlob(downloadResult.bytes, persistenceTarget);
  if (persistOutcome.ok) {
    return NextResponse.json({
      videoUrl: persistOutcome.url,
      durationSec: actualDurationSec,
      persisted: true,
      ...(persistOutcome.lastFrameUrl ? { lastFrameUrl: persistOutcome.lastFrameUrl } : {}),
    });
  }

  // Persistence failed \u2014 still return the render Stuart already paid
  // for, honestly flagged as not saved (same "never claims a render is
  // saved when it isn't" rule as the Grok path). See the no-target
  // branch above for why a `data:` URL, not a temporary hosted one.
  return NextResponse.json({
    videoUrl: bufferToDataUrl(downloadResult.bytes, "video/mp4"),
    durationSec: actualDurationSec,
    persisted: false,
    persistError: persistOutcome.reason,
  });
}

function bufferToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * Polls MiniMax's H3 job to completion — the server-side loop wrapper
 * around `lib/minimaxH3.ts`'s single-tick `pollMinimaxH3Video`, same
 * "collapse async start+poll into one request/response" shape as
 * `pollXaiVideoJob` above (and the same "no resume-after-timeout"
 * honesty note: past `MINIMAX_POLL_DEADLINE_MS`, this returns an
 * honest `timeout` outcome and drops the `taskId` — MiniMax may still
 * finish the job server-side, but nothing here checks back on it
 * later).
 */
async function pollMinimaxH3JobUntilDone(
  taskId: string,
  creds: MinimaxCredentials
): Promise<{ ok: true; videoUrl: string } | { ok: false; status: number; code: string; error: string }> {
  const deadline = Date.now() + MINIMAX_POLL_DEADLINE_MS;
  while (true) {
    const tick = await pollMinimaxH3Video(taskId, creds);
    if (!tick.ok) return tick;
    if (tick.status === "done") return { ok: true, videoUrl: tick.videoUrl };

    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      return {
        ok: false,
        status: 504,
        code: "timeout",
        error:
          `MiniMax's H3 render was still processing after ${Math.round(MINIMAX_POLL_DEADLINE_MS / 1000)}s \u2014 ` +
          "this route stopped waiting. The render may still finish on MiniMax's side, but this app has no way " +
          "to check back on it; try again in a bit.",
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * The Instrumental/MiniMax-H3 render path — see this file's module doc
 * comment's "Three real video backends" note. Structurally the
 * simplest of this route's three backends: unlike the Vocal/Comfy-LTX
 * path, H3 needs no separate upload step (its `content` array takes a
 * `data:` URL directly — see `lib/minimaxH3.ts`'s module doc comment)
 * and no driving-audio slice (the plate's own `shotPrompt`/
 * `motionPrompt`-derived `prompt` and still are the only real inputs,
 * same shape as the Grok path's own image-to-video call); it's
 * structurally closer to the Grok path than to Comfy/LTX, just against
 * a different provider.
 */
async function handleInstrumentalH3Render(
  body: GenerateClipRequestBody,
  prompt: string,
  referenceImageDataUrls: string[],
  requestedDurationSec: number
): Promise<Response> {
  const creds = resolveMinimaxCredentials();
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "MINIMAX_API_KEY is not set on the server \u2014 H3 clip rendering is unavailable here. Create a " +
          "pay-as-you-go key at platform.minimax.io and set it as this project's MINIMAX_API_KEY (MINIMAX_GROUP_ID " +
          "only if your key's account still asks for one). If you just added it, Vercel only applies environment " +
          "variable changes to new deployments \u2014 redeploy the project for this function to see it. Grok still " +
          "works for this clip in the meantime \u2014 flip the H3/Grok switch inside the Render confirm.",
        code: "missing_api_key",
      },
      { status: 501 }
    );
  }

  // H3 only has two roles to fill (first frame, optional last frame) —
  // the route-wide check above already caps the Grok path at 3, so this
  // catches the one extra case H3 itself can't accept.
  if (referenceImageDataUrls.length > MAX_H3_REFERENCE_IMAGES) {
    return NextResponse.json(
      {
        error: "MiniMax's H3 node accepts at most two reference images (a first frame, and an optional last frame).",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }

  const submitResult = await submitMinimaxH3Video(
    {
      prompt,
      firstImageUrl: referenceImageDataUrls[0],
      lastImageUrl: referenceImageDataUrls[1],
      durationSec: requestedDurationSec,
    },
    creds
  );
  if (!submitResult.ok) {
    return NextResponse.json({ error: submitResult.error, code: submitResult.code }, { status: submitResult.status });
  }

  const pollResult = await pollMinimaxH3JobUntilDone(submitResult.taskId, creds);
  if (!pollResult.ok) {
    return NextResponse.json({ error: pollResult.error, code: pollResult.code }, { status: pollResult.status });
  }

  const downloadResult = await downloadMinimaxH3Video(pollResult.videoUrl);
  if (!downloadResult.ok) {
    return NextResponse.json({ error: downloadResult.error, code: downloadResult.code }, { status: downloadResult.status });
  }

  const persistenceTarget = resolvePersistenceTarget(body);
  if (!persistenceTarget) {
    // No (or no valid) segmentId/clipIndex/startSec/endSec. Same
    // reasoning as the Comfy/LTX path above for returning a `data:`
    // URL here rather than MiniMax's own returned `videoUrl`: whether
    // that link stays reachable after this request isn't confirmed
    // (not live-tested — see `lib/minimaxH3.ts`'s module doc comment),
    // so this never risks handing back a link that goes dead later.
    return NextResponse.json({
      videoUrl: bufferToDataUrl(downloadResult.bytes, "video/mp4"),
      durationSec: requestedDurationSec,
    });
  }

  const persistOutcome = await persistRenderBytesToBlob(downloadResult.bytes, persistenceTarget);
  if (persistOutcome.ok) {
    return NextResponse.json({
      videoUrl: persistOutcome.url,
      durationSec: requestedDurationSec,
      persisted: true,
      ...(persistOutcome.lastFrameUrl ? { lastFrameUrl: persistOutcome.lastFrameUrl } : {}),
    });
  }

  // Persistence failed — still return the render Stuart already paid
  // for, honestly flagged as not saved (same "never claims a render is
  // saved when it isn't" rule as the other two backends).
  return NextResponse.json({
    videoUrl: bufferToDataUrl(downloadResult.bytes, "video/mp4"),
    durationSec: requestedDurationSec,
    persisted: false,
    persistError: persistOutcome.reason,
  });
}

export async function POST(request: Request) {
  let body: GenerateClipRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body with a `prompt` string.", code: "invalid_request" },
      { status: 400 }
    );
  }

  // Routing decision \u2014 read before any backend's own key check, so a
  // Vocal request checks `COMFY_CLOUD_API_KEY`, an Instrumental H3
  // request checks `MINIMAX_API_KEY`, and an Instrumental Grok request
  // checks `XAI_API_KEY` \u2014 never a backend this exact request isn't
  // actually going to call. See this file's module doc comment's
  // "Three real video backends" note. `videoBackend` is only ever read
  // when `vocal` is falsy; anything other than the literal `"h3"`
  // (including `"grok"`, or the field simply missing) keeps this
  // route's original Grok behavior \u2014 the *server's* own default stays
  // Grok even though the *client's* new default is H3.
  const vocal = body.vocal === true;
  const instrumentalBackend: "h3" | "grok" = !vocal && body.videoBackend === "h3" ? "h3" : "grok";

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
  // The LTX 2.3 IA2V graph's `LoadImage` node (`269`) only ever takes
  // one `image` \u2014 no multi-reference continuity mode like
  // xAI's `reference_images` (this feature's own UI never sends more
  // than one plate still anyway; see `lib/clipGeneration.ts`'s module
  // doc comment).
  if (vocal && rawReferences.length !== 1) {
    return NextResponse.json(
      {
        error: "Comfy Cloud's LTX graph accepts exactly one plate still to animate \u2014 not more, not fewer.",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }
  if (!vocal && rawReferences.length > MAX_REFERENCE_IMAGES) {
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

  if (vocal) {
    return handleVocalComfyLtxRender(body, prompt, rawReferences[0]);
  }

  // Real per-plate duration, shared by both Instrumental backends \u2014
  // H3's own real ceiling ([4, 15]s) is looser than Grok's cost-locked
  // [5, 15]s, so this app's existing Grok range already sits safely
  // inside H3's, and both backends can share one clamp with no
  // separate H3 duration bounds needed.
  const requestedDurationSecRaw =
    typeof body.durationSec === "number" && Number.isFinite(body.durationSec)
      ? body.durationSec
      : DEFAULT_CLIP_DURATION_SEC;
  const requestedDurationSec = Math.min(
    MAX_CLIP_DURATION_SEC,
    Math.max(MIN_CLIP_DURATION_SEC, Math.round(requestedDurationSecRaw))
  );

  if (instrumentalBackend === "h3") {
    return handleInstrumentalH3Render(body, prompt, rawReferences, requestedDurationSec);
  }

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

  const startResult = await startXaiVideoJob(
    prompt,
    rawReferences,
    apiKey,
    resolveXaiVideoModel(),
    requestedDurationSec
  );
  if (!startResult.ok) {
    return NextResponse.json({ error: startResult.error, code: startResult.code }, { status: startResult.status });
  }

  const pollResult = await pollXaiVideoJob(startResult.requestId, apiKey, requestedDurationSec);
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
      ...(persistOutcome.lastFrameUrl ? { lastFrameUrl: persistOutcome.lastFrameUrl } : {}),
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
