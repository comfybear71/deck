/**
 * Client-side half of Skidmarks' clip *video* render \u2014 the first
 * un-stubbed slice of the actual clip video pass every other doc comment
 * in this feature (`lib/skidmarks.ts`, `SkidmarksClipTimeline`) says stays
 * a stub. Mirrors `lib/plateGeneration.ts`'s shape deliberately (same
 * "build a pure request object, then a separate `fetch` wrapper that
 * normalizes into an honest outcome" split) so this doesn't invent a new
 * pattern for one feature. See `app/api/skidmarks/generate-clip/route.ts`'s
 * module doc comment for the full server-side contract \u2014 same
 * `XAI_API_KEY`, xAI's real (and, for the image-to-video path, live-
 * verified in this sandbox) video-generation API, fixed 5s/480p output,
 * no new provider invented.
 *
 * **Why this exists as its own module instead of folding into
 * `lib/plateGeneration.ts`**: a still and a clip render are genuinely
 * different backends (xAI's `/images/...` vs `/videos/...` endpoints,
 * different request shapes, a synchronous call vs a deferred
 * start+poll job) that happen to share one env var and one general
 * "build a prompt, then call it" shape \u2014 keeping them separate
 * modules means neither doc comment has to caveat the other's very
 * different cost/latency/persistence story.
 *
 * **Not persisted in `lib/skidmarks.ts`'s `localStorage`-backed store
 * \u2014 but a successful render itself now lands in durable Vercel Blob
 * storage**, not just ephemeral React state. `generateSkidmarksClip`
 * returns `persisted: true` plus a durable Blob URL once
 * `app/api/skidmarks/generate-clip/route.ts` finishes re-uploading the
 * finished render server-side; `app/api/skidmarks/clip-renders/
 * route.ts` is the read side `SkidmarksClipTimeline` uses so a saved
 * render still shows up after a refresh. See that route's module doc
 * comment for the full story (this used to be genuinely ephemeral in
 * #42 \u2014 Stuart rejected that) and `lib/clipRenderBlob.ts` for why
 * Blob, not `localStorage` (a 5s/480p clip is roughly a megabyte,
 * nowhere near that store's small shared quota).
 */

const MAX_CLIP_REFERENCE_IMAGES = 3;

/**
 * Mirrors `app/api/skidmarks/generate-clip/route.ts`'s hardcoded
 * `CLIP_DURATION_SEC` (5s) and `CLIP_RESOLUTION` ("480p", $0.08/sec per
 * xAI's published Grok Imagine Video pricing) plus its $0.01-per-input-
 * image charge \u2014 duplicated here (rather than fetched from the
 * server) purely so `components/SkidmarksClipRender.tsx` can show Stuart
 * a real cost estimate in the confirm step *before* he taps Render,
 * without a round trip. If either of those server-side constants ever
 * changes, update this to match \u2014 nothing enforces the two staying in
 * sync automatically.
 */
const CLIP_DURATION_SEC = 5;
const CLIP_SECOND_RATE_USD = 0.08;
const PER_REFERENCE_IMAGE_USD = 0.01;

/** Estimated USD cost of one render with this many reference images \u2014
 * shown in `SkidmarksClipRender`'s confirm step. Always the same fixed
 * duration/resolution (see this module's constants above), so this is a
 * simple linear estimate, not a real xAI pricing call. */
export function estimateClipRenderCostUsd(referenceImageCount: number): number {
  return CLIP_DURATION_SEC * CLIP_SECOND_RATE_USD + referenceImageCount * PER_REFERENCE_IMAGE_USD;
}

/** Longest a typed camera-motion override can be \u2014 still short by
 * design (a couple of lines like "slow zoom into keyhole, mild pulse on
 * door cracks", not a paragraph); enforced both as the `<textarea>`'s
 * own `maxLength` in `components/SkidmarksClipRender.tsx` and here, so
 * a request built without going through that field (a test, a future
 * caller) can't quietly bypass the same cap. */
export const MAX_MOTION_PROMPT_LENGTH = 220;

/**
 * Motion language keyed off how many plate stills are feeding this
 * render \u2014 the video-render equivalent of `lib/plateGeneration.ts`'s
 * `routingFramingHint`, but for camera *motion* rather than framing.
 * Stuart's creative lock for the opener is a **continuous zoom** across
 * the door \u2192 keyhole \u2192 Jack plate sequence, under one Instrumental
 * clip \u2014 so that's the one default this function encodes when Stuart
 * hasn't typed his own motion direction. **No longer the only option**:
 * `buildClipGenerationRequest` below lets an explicit `motionPrompt`
 * become the *primary* motion instruction sent to xAI outright \u2014
 * `shotPrompt` and the plate stills stay the visual description/
 * reference images, this is specifically the camera direction, added
 * on Stuart's own explicit ask ("no motion instruction at all" was
 * irrational enough that he wouldn't press Render \u2014 the per-clip
 * Render control shipped in #42 with no way to ask for anything other
 * than a push-in/zoom; a pan, a held static shot, a whip-pan, etc. had
 * no way to reach xAI). Still the smallest control this could be: one
 * short optional multi-line text field, not a style picker/menu \u2014
 * leaving it blank keeps the exact same automatic behavior this
 * shipped with.
 * Two-or-more references get the multi-plate continuity phrasing
 * (xAI's reference-to-video mode, guided by the whole sequence in
 * order); exactly one gets a single-image push-in instead (xAI's
 * image-to-video mode, which locks that one still as the first frame).
 */
function routingMotionHint(referenceCount: number): string {
  if (referenceCount > 1) {
    return (
      "Continuous, unbroken slow cinematic push-in zoom moving through the sequence from the first reference " +
      "image to the last, in order \u2014 one single camera move, no cuts, holding the same setting, subject, " +
      "and lighting continuity throughout."
    );
  }
  return (
    "Slow cinematic push-in zoom, subtle camera movement, keep the scene, subject, and lighting consistent " +
    "with the reference image."
  );
}

export interface ClipGenerationRequest {
  /** The full prompt sent to xAI \u2014 Stuart's own clip `shotPrompt`
   * (shared across the whole plate strip, same field the still-generation
   * flow already reads) plus either his own typed `motionPrompt` (when
   * given) or this module's automatic motion routing hint, plus a
   * band/no-text/no-watermark footer. */
  prompt: string;
  /** The plate stills feeding this render, in the clip's own strip
   * order (continuity direction matters \u2014 door, then keyhole, then
   * Jack, not a random order) \u2014 always 1\u20133 entries; see
   * `MAX_CLIP_REFERENCE_IMAGES`. */
  referenceImageDataUrls: string[];
  /** The clip's own, unmodified shot-prompt text \u2014 sent separately so
   * `app/api/skidmarks/generate-clip/route.ts` can length-validate only
   * what Stuart actually typed, not this module's auto-injected motion
   * routing hint or band/no-text/no-watermark footer \u2014 same "validate
   * the user-authored text only" fix as
   * `lib/plateGeneration.ts`'s `PlateGenerationRequest.shotPrompt`. */
  shotPrompt: string;
  /** The four fields `app/api/skidmarks/generate-clip/route.ts` needs to
   * persist a successful render to durable Vercel Blob storage under a
   * stable pathname (`lib/clipRenderBlob.ts`) instead of only returning
   * xAI's temporary URL \u2014 see that route's module doc comment.
   * Optional so any existing/hypothetical caller that builds a request
   * without them still gets the exact same wire shape as before this
   * feature existed; the real UI (`components/SkidmarksClipRender.tsx`)
   * always sends all four. */
  segmentId?: string;
  clipIndex?: number;
  startSec?: number;
  endSec?: number;
}

export interface BuildClipGenerationRequestParams {
  /** The clip's shared shot-prompt text \u2014 always leads the built
   * prompt, never rewritten. */
  shotPrompt: string;
  bandName: string;
  /** The clip's plate stills, in strip order. Only the first
   * `MAX_CLIP_REFERENCE_IMAGES` are actually sent \u2014 callers that want
   * to warn Stuart a later plate got dropped should check
   * `plateStillDataUrls.length > MAX_CLIP_REFERENCE_IMAGES` themselves
   * (see `components/SkidmarksClipRender.tsx`). */
  plateStillDataUrls: string[];
  /** An optional, short (multi-line OK) camera-motion direction Stuart
   * typed himself (e.g. "slow zoom into keyhole, mild pulse on door
   * cracks") \u2014 the *primary* motion instruction sent to xAI when
   * given (non-blank); `shotPrompt`/the plate stills remain the visual
   * description and reference images, unchanged. Replaces
   * `routingMotionHint`'s automatic push-in/zoom phrasing outright
   * rather than being appended alongside it, so Stuart's own explicit
   * direction is never diluted or contradicted by the default. Trimmed
   * and capped at `MAX_MOTION_PROMPT_LENGTH`; blank/omitted keeps the
   * exact same automatic behavior this shipped with in #42. */
  motionPrompt?: string;
  /** Passed straight through to the built `ClipGenerationRequest` \u2014
   * see that interface's doc comment. */
  segmentId?: string;
  clipIndex?: number;
  startSec?: number;
  endSec?: number;
}

/**
 * Builds the one real clip-render request this feature ever sends \u2014
 * pure and synchronous, same "fully unit-testable independent of a real
 * `XAI_API_KEY`" shape as `lib/plateGeneration.ts`'s
 * `buildPlateGenerationRequest`.
 */
export function buildClipGenerationRequest(params: BuildClipGenerationRequestParams): ClipGenerationRequest {
  const referenceImageDataUrls = params.plateStillDataUrls.slice(0, MAX_CLIP_REFERENCE_IMAGES);
  const trimmedMotionPrompt = params.motionPrompt?.trim().slice(0, MAX_MOTION_PROMPT_LENGTH) || "";
  const parts = [
    params.shotPrompt.trim(),
    trimmedMotionPrompt || routingMotionHint(referenceImageDataUrls.length),
    `Music video for ${params.bandName}. Cinematic motion, no on-screen text, no watermark.`,
  ];
  return {
    prompt: parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join(" "),
    shotPrompt: params.shotPrompt.trim(),
    referenceImageDataUrls,
    segmentId: params.segmentId,
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
       * skipped or failed \u2014 see `persistError`). Always present on a
       * success outcome so the UI never has to guess. */
      persisted: boolean;
      /** Set only when `persisted` is `false` *and* persistence was
       * actually attempted (a real Blob failure) \u2014 not set when the
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
 * and normalizes the response into the two honest outcomes above \u2014
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
    // Non-JSON response (e.g. a platform-level error page) \u2014 the
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

export { CLIP_DURATION_SEC, MAX_CLIP_REFERENCE_IMAGES };
