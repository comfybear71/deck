/**
 * Client-side half of Skidmarks' clip *video* render — the first
 * un-stubbed slice of the actual clip video pass every other doc comment
 * in this feature (`lib/skidmarks.ts`, `SkidmarksClipTimeline`) says stays
 * a stub. Mirrors `lib/plateGeneration.ts`'s shape deliberately (same
 * "build a pure request object, then a separate `fetch` wrapper that
 * normalizes into an honest outcome" split) so this doesn't invent a new
 * pattern for one feature. See `app/api/skidmarks/generate-clip/route.ts`'s
 * module doc comment for the full server-side contract — same
 * `XAI_API_KEY`, xAI's real (and, for the image-to-video path, live-
 * verified in this sandbox) video-generation API, no new provider
 * invented.
 *
 * **Per-plate select rework**: a clip's Render control used to animate
 * *every* plate in its strip at once (multi-reference continuity, one
 * render per clip). It now animates **one plate at a time** — whichever
 * plate is currently selected (radio-style, see `lib/skidmarks.ts`'s
 * `resolveSelectedPlateId`) — using just that plate's own still as the
 * single image-to-video source, plus that plate's own stored motion
 * text. Continuity across a clip's several plates (door → keyhole →
 * Jack) now comes from rendering each plate separately with its own
 * motion, then editing them together in Resolve — not from sending every
 * plate as multi-reference continuity in one xAI call. This keeps each
 * render small/cheap/predictable and lets Stuart re-render just the one
 * plate that needs another take without re-spending on the others.
 *
 * **Why this exists as its own module instead of folding into
 * `lib/plateGeneration.ts`**: a still and a clip render are genuinely
 * different backends (xAI's `/images/...` vs `/videos/...` endpoints,
 * different request shapes, a synchronous call vs a deferred
 * start+poll job) that happen to share one env var and one general
 * "build a prompt, then call it" shape — keeping them separate
 * modules means neither doc comment has to caveat the other's very
 * different cost/latency/persistence story.
 *
 * **Not persisted in `lib/skidmarks.ts`'s `localStorage`-backed store
 * — but a successful render itself now lands in durable Vercel Blob
 * storage**, not just ephemeral React state. `generateSkidmarksClip`
 * returns `persisted: true` plus a durable Blob URL once
 * `app/api/skidmarks/generate-clip/route.ts` finishes re-uploading the
 * finished render server-side; `app/api/skidmarks/clip-renders/
 * route.ts` is the read side `SkidmarksClipTimeline`/
 * `SkidmarksRenderedClipsShelf` use so a saved render still shows up
 * after a refresh. See that route's module doc comment for the full
 * story (this used to be genuinely ephemeral in #42 — Stuart rejected
 * that) and `lib/clipRenderBlob.ts` for why Blob, not `localStorage` (a
 * clip render is roughly a megabyte, nowhere near that store's small
 * shared quota).
 */

/** Per-plate render duration range — Grok's documented ceiling is 15s;
 * 5s is the floor this feature has always used. Real per-plate duration
 * (see `computePlateDurationSec` below) is clamped into this range, then
 * sent to xAI as its own `duration` value — this is now a genuinely
 * variable parameter, not the flat hardcoded 5s this shipped with
 * originally (see `app/api/skidmarks/generate-clip/route.ts`'s module
 * doc comment for exactly how much of this is live-verified vs. inferred
 * from xAI's documented `duration` parameter). */
export const MIN_CLIP_DURATION_SEC = 5;
export const MAX_CLIP_DURATION_SEC = 15;

/** Mirrors `app/api/skidmarks/generate-clip/route.ts`'s hardcoded
 * `CLIP_RESOLUTION` ("480p", $0.08/sec per xAI's published Grok Imagine
 * Video pricing) plus its $0.01-per-input-image charge — duplicated
 * here (rather than fetched from the server) purely so
 * `components/SkidmarksClipRender.tsx` can show Stuart a real cost
 * estimate in the confirm step *before* he taps Render, without a round
 * trip. If either of those server-side constants ever changes, update
 * this to match — nothing enforces the two staying in sync
 * automatically. */
const CLIP_SECOND_RATE_USD = 0.08;
const PER_REFERENCE_IMAGE_USD = 0.01;

/** Estimated USD cost of one plate's render at a given duration — always
 * exactly one reference image now (the selected plate's still — see this
 * module's doc comment), so `referenceImageCount` is really just `1`,
 * kept as a parameter rather than hardcoded so a test/future caller
 * doesn't have to special-case it. */
export function estimateClipRenderCostUsd(durationSec: number, referenceImageCount: number = 1): number {
  return durationSec * CLIP_SECOND_RATE_USD + referenceImageCount * PER_REFERENCE_IMAGE_USD;
}

/**
 * Auto-splits a clip's real time span evenly across however many plates
 * are on its strip, clamped into `[MIN_CLIP_DURATION_SEC,
 * MAX_CLIP_DURATION_SEC]` per plate — Stuart's own "segment length ÷
 * plate count" ask, e.g. a 40s clip with 3 plates gets 13s + 13s + 14s
 * (the one extra second lands on the *last* plate(s), not the first),
 * each already inside Grok's 5–15s window. A clip whose span is much
 * shorter or much longer than `plateCount * [5,15]` still gets a sane
 * answer — the clamp is what does the real work there, not this
 * function silently refusing to answer. `plateIndex` is 0-based (this
 * plate's position within its own clip's strip); `plateCount` is that
 * strip's total slot count (including any still-empty ones, so a
 * duration doesn't visibly jump around as Stuart fills slots in).
 */
export function computePlateDurationSec(
  segmentLengthSec: number,
  plateCount: number,
  plateIndex: number
): number {
  if (!Number.isFinite(plateCount) || plateCount <= 0) return MIN_CLIP_DURATION_SEC;
  const totalWholeSec = Math.max(0, Math.round(segmentLengthSec || 0));
  const base = Math.floor(totalWholeSec / plateCount);
  const remainder = totalWholeSec - base * plateCount;
  // The `remainder` leftover seconds land one-each on the *last*
  // `remainder` plates (0-based `plateIndex >= plateCount - remainder`)
  // — matches the task's own "40s / 3 ≈ 13 + 13 + 14" example exactly.
  const extraSec = plateIndex >= plateCount - remainder ? 1 : 0;
  return Math.min(MAX_CLIP_DURATION_SEC, Math.max(MIN_CLIP_DURATION_SEC, base + extraSec));
}

/** Longest a typed camera-motion override can be — still short by
 * design (a couple of lines like "slow zoom into keyhole, mild pulse on
 * door cracks", not a paragraph); enforced both as the `<textarea>`'s
 * own `maxLength` in `components/SkidmarksClipRender.tsx` and here, so
 * a request built without going through that field (a test, a future
 * caller) can't quietly bypass the same cap. */
export const MAX_MOTION_PROMPT_LENGTH = 220;

/**
 * Motion language for a single-plate render when Stuart hasn't typed
 * his own motion direction — the video-render equivalent of
 * `lib/plateGeneration.ts`'s `routingFramingHint`, but for camera
 * *motion* rather than framing. Always the single-image push-in phrasing
 * now (image-to-video mode) — the multi-plate continuity phrasing this
 * used to emit for 2–3 references no longer applies, since a render is
 * always exactly one plate's still now (see this module's doc comment).
 */
function automaticMotionHint(): string {
  return (
    "Slow cinematic push-in zoom, subtle camera movement, keep the scene, subject, and lighting consistent " +
    "with the reference image."
  );
}

export interface ClipGenerationRequest {
  /** The full prompt sent to xAI — Stuart's own clip `shotPrompt`
   * (shared across the whole plate strip, same field the still-generation
   * flow already reads) plus either his own typed `motionPrompt` (when
   * given, stored per-plate) or this module's automatic motion routing
   * hint, plus a band/no-text/no-watermark footer. */
  prompt: string;
  /** The selected plate's still, and nothing else — always exactly one
   * entry; kept as an array on the wire (unchanged shape from before
   * this rework) since `app/api/skidmarks/generate-clip/route.ts` still
   * generically accepts 1–3 (a capability the route keeps for any other
   * caller), even though this feature's own UI never sends more than
   * one anymore. */
  referenceImageDataUrls: string[];
  /** The clip's own, unmodified shot-prompt text — sent separately so
   * `app/api/skidmarks/generate-clip/route.ts` can length-validate only
   * what Stuart actually typed, not this module's auto-injected motion
   * routing hint or band/no-text/no-watermark footer — same "validate
   * the user-authored text only" fix as
   * `lib/plateGeneration.ts`'s `PlateGenerationRequest.shotPrompt`. */
  shotPrompt: string;
  /** This plate's real, auto-computed render length (see
   * `computePlateDurationSec`), already clamped into
   * `[MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC]` — always present
   * (never left for the server to guess) so what Stuart sees in the
   * confirm step is exactly what gets billed/sent. */
  durationSec: number;
  /** The fields `app/api/skidmarks/generate-clip/route.ts` needs to
   * persist a successful render to durable Vercel Blob storage under a
   * stable, per-*plate* pathname (`lib/clipRenderBlob.ts`) instead of
   * only returning xAI's temporary URL — see that route's module doc
   * comment. Optional so any existing/hypothetical caller that builds a
   * request without them still gets the exact same wire shape as
   * before this feature existed; the real UI
   * (`components/SkidmarksClipRender.tsx`) always sends all of them. */
  segmentId?: string;
  plateId?: string;
  /** This plate's 0-based position within its own clip's strip, and
   * that strip's total slot count — used only to letter the download
   * filename (`01a_...`, `01b_...`) once a clip has more than one
   * plate; a single-plate clip's filename is unaffected. */
  plateIndex?: number;
  plateCount?: number;
  clipIndex?: number;
  startSec?: number;
  endSec?: number;
}

export interface BuildClipGenerationRequestParams {
  /** The clip's shared shot-prompt text — always leads the built
   * prompt, never rewritten. */
  shotPrompt: string;
  bandName: string;
  /** The *selected* plate's still — this render's one and only image
   * source. See this module's doc comment for why this is singular now,
   * not an array of every plate on the clip. */
  plateStillDataUrl: string;
  /** This plate's own stored camera-motion direction (e.g. "slow zoom
   * into keyhole, mild pulse on door cracks") — the *primary* motion
   * instruction sent to xAI when given (non-blank); `shotPrompt`/the
   * plate still remain the visual description and reference image,
   * unchanged. Replaces `automaticMotionHint`'s push-in/zoom phrasing
   * outright rather than being appended alongside it, so Stuart's own
   * explicit direction is never diluted or contradicted by the default.
   * Trimmed and capped at `MAX_MOTION_PROMPT_LENGTH`; blank/omitted
   * keeps the automatic push-in/zoom behavior. */
  motionPrompt?: string;
  /** This plate's real, auto-computed render length — see
   * `computePlateDurationSec`. Callers should always pass a clamped
   * value; this function clamps again defensively rather than trusting
   * every caller got the math right. */
  durationSec: number;
  /** Passed straight through to the built `ClipGenerationRequest` — see
   * that interface's doc comment. */
  segmentId?: string;
  plateId?: string;
  plateIndex?: number;
  plateCount?: number;
  clipIndex?: number;
  startSec?: number;
  endSec?: number;
}

/**
 * Builds the one real clip-render request this feature ever sends —
 * pure and synchronous, same "fully unit-testable independent of a real
 * `XAI_API_KEY`" shape as `lib/plateGeneration.ts`'s
 * `buildPlateGenerationRequest`.
 */
export function buildClipGenerationRequest(params: BuildClipGenerationRequestParams): ClipGenerationRequest {
  const trimmedMotionPrompt = params.motionPrompt?.trim().slice(0, MAX_MOTION_PROMPT_LENGTH) || "";
  const durationSec = Math.min(
    MAX_CLIP_DURATION_SEC,
    Math.max(MIN_CLIP_DURATION_SEC, Math.round(params.durationSec))
  );
  const parts = [
    params.shotPrompt.trim(),
    trimmedMotionPrompt || automaticMotionHint(),
    `Music video for ${params.bandName}. Cinematic motion, no on-screen text, no watermark.`,
  ];
  return {
    prompt: parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(" "),
    shotPrompt: params.shotPrompt.trim(),
    referenceImageDataUrls: [params.plateStillDataUrl],
    durationSec,
    segmentId: params.segmentId,
    plateId: params.plateId,
    plateIndex: params.plateIndex,
    plateCount: params.plateCount,
    clipIndex: params.clipIndex,
    startSec: params.startSec,
    endSec: params.endSec,
  };
}

export type ClipGenerationOutcome =
  | {
      ok: true;
      videoUrl: string;
      durationSec: number;
      /** Whether `videoUrl` is a durable Vercel Blob URL that will still
       * work after a refresh, vs. xAI's own temporary URL (persistence
       * skipped or failed — see `persistError`). Always present on a
       * success outcome so the UI never has to guess. */
      persisted: boolean;
      /** Set only when `persisted` is `false` *and* persistence was
       * actually attempted (a real Blob failure) — not set when the
       * caller never asked for persistence in the first place. Plain-
       * language, shown verbatim to Stuart rather than swallowed. */
      persistError?: string;
    }
  | { ok: false; unconfigured: boolean; message: string };

const GENERATE_CLIP_ENDPOINT = "/api/skidmarks/generate-clip";

interface GenerateClipRouteErrorBody {
  error?: string;
  code?: string;
}
interface GenerateClipRouteSuccessBody {
  videoUrl?: unknown;
  durationSec?: unknown;
  persisted?: unknown;
  persistError?: unknown;
}

/**
 * POSTs a built `ClipGenerationRequest` to `/api/skidmarks/generate-clip`
 * and normalizes the response into the two honest outcomes above —
 * same shape as `lib/plateGeneration.ts`'s `generatePlateStill`. Never
 * throws. This single `fetch` can legitimately take up to
 * `app/api/skidmarks/generate-clip/route.ts`'s `POLL_DEADLINE_MS` (the
 * server route polls xAI internally before responding), so callers
 * should show real "this can take a while" progress UI, not a
 * short-timeout spinner.
 */
export async function generateSkidmarksClip(
  request: ClipGenerationRequest
): Promise<ClipGenerationOutcome> {
  let res: Response;
  try {
    res = await fetch(GENERATE_CLIP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (err) {
    return {
      ok: false,
      unconfigured: false,
      message: err instanceof Error ? err.message : "Network error reaching the clip-render API.",
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. a platform-level error page) — the
    // status-code fallback below still gives Stuart a real message.
  }

  if (!res.ok) {
    const errBody = (body ?? {}) as GenerateClipRouteErrorBody;
    return {
      ok: false,
      unconfigured: errBody.code === "missing_api_key",
      message: errBody.error ?? `Clip render failed (HTTP ${res.status}).`,
    };
  }

  const okBody = (body ?? {}) as GenerateClipRouteSuccessBody;
  const videoUrl = typeof okBody.videoUrl === "string" ? okBody.videoUrl : "";
  if (!videoUrl) {
    return { ok: false, unconfigured: false, message: "Clip render succeeded but returned no video." };
  }
  const durationSec = typeof okBody.durationSec === "number" ? okBody.durationSec : 0;
  const persisted = okBody.persisted === true;
  const persistError = typeof okBody.persistError === "string" ? okBody.persistError : undefined;
  return persistError ? { ok: true, videoUrl, durationSec, persisted, persistError } : { ok: true, videoUrl, durationSec, persisted };
}

/** Kept for backward compatibility with any caller that still imports
 * this — always `MIN_CLIP_DURATION_SEC` now that duration is real and
 * per-plate rather than a single flat constant. */
export const CLIP_DURATION_SEC = MIN_CLIP_DURATION_SEC;
export const MAX_CLIP_REFERENCE_IMAGES = 3;
