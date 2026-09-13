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
 *
 * **Vocal -> Comfy Cloud LTX, Instrumental -> Grok, automatic, no model
 * picker (Stuart lock, 2026-09-13).** This module used to build exactly
 * one kind of request (always xAI Grok Imagine video). It now builds
 * one of *two*, chosen purely from `vocal` (the same `vocal` boolean
 * `lib/skidmarks.ts`'s `SKIDMARKS_SEGMENT_LABEL_META` already derives
 * from a clip's label, not a new field Stuart has to set) — never a
 * tap surface, per AGENTS.md's "no model picker in the UI" lock:
 * - `vocal: false` (Instrumental/B-roll/opener) — unchanged: xAI Grok
 *   Imagine video, 5-15s, one plate still as the image-to-video
 *   reference. See this module's doc comment above for that path's
 *   full, live-verified story.
 * - `vocal: true` (Vocal/lip-sync performance) — routes to
 *   **Comfy Cloud's LTX-2.5 `AudioToVideo` partner node**
 *   (`lib/comfyCloud.ts`), which drives the generated video's motion
 *   (chiefly mouth movement) off a real **slice of the attached
 *   song's own vocal performance** for this exact plate
 *   (`lib/mp3Slice.ts`, frame-cut from `mp3.audioUrl` — the durable
 *   Blob URL, never the ephemeral in-tab `File`/object URL, since a
 *   server route has no access to a browser `File` at all) instead of
 *   an automatic push-in/zoom. That node's own documented duration
 *   range is 2-20s (its output duration is *set by* the input audio's
 *   length, not a separate parameter) — `MIN_LTX_CLIP_DURATION_SEC`/
 *   `MAX_LTX_CLIP_DURATION_SEC` below use a 5-20s window instead (5s
 *   floor to match this feature's existing floor everywhere else,
 *   20s the node's real ceiling). **Note**: Stuart's own initial ask
 *   was "clamp up to ~30s" — the real `LtxApi25AudioToVideo` node caps
 *   hard at 20s and documents that it errors outside `[2, 20]`, so
 *   this module honors the *real* technical ceiling instead of
 *   quietly sending a request already known to fail past it; flagged
 *   explicitly here and in this PR's description rather than silently
 *   picking one number over the other.
 *
 * **Never claims Comfy/LTX is live-verified** the way the Grok path
 * is — see `lib/comfyCloud.ts`'s own module doc comment for exactly
 * what's real-and-documented vs. not live-tested (no
 * `COMFY_CLOUD_API_KEY` is available in this sandbox).
 */

import { getSkidmarksCharacterLock } from "./plateGeneration";
import type { SkidmarksMember } from "./skidmarks";

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

/** Vocal/Comfy-LTX duration range — see this module's doc comment's
 * "Vocal -> Comfy Cloud LTX" note for why this is `[5, 20]`, not the
 * `[5, 30]` Stuart initially asked for: `LtxApi25AudioToVideo`'s own
 * documented constraint is that its driving audio must be 2-20s long
 * (it raises an error outside that range), and that audio's length is
 * what sets the rendered video's duration — 20s is the real technical
 * ceiling this app can actually request, not a cost-lock choice like
 * Grok's 480p/15s. */
export const MIN_LTX_CLIP_DURATION_SEC = 5;
export const MAX_LTX_CLIP_DURATION_SEC = 20;

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

/** LTX-2.5 (Fast) at 1080p — the only resolution tier
 * `LtxApi25AudioToVideo` offers (`"1920x1080"`/`"1080x1920"`, tied to
 * the chosen model, not a separate picker) — per Lightricks' own
 * published direct-API pricing (docs.ltx.io/pricing,
 * ltx.io/model/api/pricing, checked while building this feature):
 * $0.13/s for Fast at 1080p ($0.17/s for Pro — not used by default,
 * see `lib/comfyCloud.ts`'s `DEFAULT_LTX_MODEL`; no env override for
 * this, per the "don't invent other Comfy key names" lock). **Honesty
 * note**: this is the provider's own published *direct*-API rate, the
 * same basis `app/api/skidmarks/generate-clip/route.ts`'s existing
 * Grok cost estimate uses for xAI — Comfy Cloud's own account-level
 * credit conversion for this partner node isn't independently
 * confirmed here (no `COMFY_CLOUD_API_KEY` to check it against), so
 * this is the most honest real number available, not a verified final
 * bill. No per-reference-image surcharge, unlike Grok — LTX's own
 * pricing page states plainly "no request fees or per-asset charges." */
const LTX_SECOND_RATE_USD = 0.13;

export function estimateLtxClipRenderCostUsd(durationSec: number): number {
  return durationSec * LTX_SECOND_RATE_USD;
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
export interface PlateDurationBounds {
  min: number;
  max: number;
}

const GROK_DURATION_BOUNDS: PlateDurationBounds = { min: MIN_CLIP_DURATION_SEC, max: MAX_CLIP_DURATION_SEC };
/** Passed to `computePlateDurationSec`/`computePlateTimeRange` for a
 * Vocal clip — see this module's doc comment's "Vocal -> Comfy Cloud
 * LTX" note for why this range differs from Grok's. */
export const LTX_DURATION_BOUNDS: PlateDurationBounds = {
  min: MIN_LTX_CLIP_DURATION_SEC,
  max: MAX_LTX_CLIP_DURATION_SEC,
};

export function computePlateDurationSec(
  segmentLengthSec: number,
  plateCount: number,
  plateIndex: number,
  bounds: PlateDurationBounds = GROK_DURATION_BOUNDS
): number {
  if (!Number.isFinite(plateCount) || plateCount <= 0) return bounds.min;
  const totalWholeSec = Math.max(0, Math.round(segmentLengthSec || 0));
  const base = Math.floor(totalWholeSec / plateCount);
  const remainder = totalWholeSec - base * plateCount;
  // The `remainder` leftover seconds land one-each on the *last*
  // `remainder` plates (0-based `plateIndex >= plateCount - remainder`)
  // — matches the task's own "40s / 3 ≈ 13 + 13 + 14" example exactly.
  const extraSec = plateIndex >= plateCount - remainder ? 1 : 0;
  return Math.min(bounds.max, Math.max(bounds.min, base + extraSec));
}

/** Same auto-split as `computePlateDurationSec`, clamped into
 * `LTX_DURATION_BOUNDS` instead of Grok's range — the one this
 * feature's Vocal/Comfy-LTX path actually uses. */
export function computeLtxPlateDurationSec(segmentLengthSec: number, plateCount: number, plateIndex: number): number {
  return computePlateDurationSec(segmentLengthSec, plateCount, plateIndex, LTX_DURATION_BOUNDS);
}

/**
 * This plate's own absolute `[startSec, endSec)` window within its
 * *clip's* own `[clipStartSec, clipEndSec)` range — the real audio
 * slice `lib/mp3Slice.ts` needs to cut out of the attached song for
 * the Vocal/Comfy-LTX path (a Grok/Instrumental render never calls
 * this; it only needs a duration, not an absolute time window). Always
 * derived from the *same* per-plate duration math
 * `computePlateDurationSec` uses (walking every earlier plate's own
 * computed duration to find this plate's start), so `endSec - startSec`
 * here is guaranteed to equal `computePlateDurationSec(...,
 * plateIndex, bounds)` for the same inputs — never a second, drifting
 * source of truth for "how long is this plate's slice."
 */
export function computePlateTimeRange(
  clipStartSec: number,
  clipEndSec: number,
  plateCount: number,
  plateIndex: number,
  bounds: PlateDurationBounds = GROK_DURATION_BOUNDS
): { startSec: number; endSec: number } {
  const segmentLengthSec = clipEndSec - clipStartSec;
  let cursor = clipStartSec;
  for (let i = 0; i < plateIndex; i++) {
    cursor += computePlateDurationSec(segmentLengthSec, plateCount, i, bounds);
  }
  const durationSec = computePlateDurationSec(segmentLengthSec, plateCount, plateIndex, bounds);
  return { startSec: cursor, endSec: cursor + durationSec };
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
  /** `true` for a Vocal/lip-sync clip — tells
   * `app/api/skidmarks/generate-clip/route.ts` to route this request to
   * Comfy Cloud's LTX-2.5 `AudioToVideo` partner node instead of xAI
   * Grok Imagine video (see this module's doc comment's "Vocal -> Comfy
   * Cloud LTX" note). `false`/omitted keeps the existing Grok path —
   * this field is additive, so an older caller that never sends it
   * behaves exactly as before this feature existed. */
  vocal?: boolean;
  /** The attached song's own **durable** Blob URL
   * (`SkidmarksMp3Attachment.audioUrl`, never the ephemeral in-tab
   * `File`/object URL a server route can't reach) — required by the
   * server when `vocal` is true; the Comfy/LTX branch fetches this,
   * slices out `[audioStartSec, audioEndSec)` (`lib/mp3Slice.ts`), and
   * sends that real slice of Stuart's own vocal performance as the
   * driving audio track. Ignored on the Grok/Instrumental path. */
  mp3AudioUrl?: string;
  /** This plate's own absolute audio window within the full song —
   * see `computePlateTimeRange`. Only meaningful (and only sent) when
   * `vocal` is true; distinct from `startSec`/`endSec` above, which
   * stay the *clip's* whole time range (used only for the download
   * filename, unchanged). */
  audioStartSec?: number;
  audioEndSec?: number;
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
   * keeps the automatic push-in/zoom behavior. Still read on the
   * Vocal/Comfy-LTX path too — a typed camera-motion note is just as
   * meaningful for that partner node's own `prompt` field. */
  motionPrompt?: string;
  /** This plate's real, auto-computed render length — see
   * `computePlateDurationSec`/`computeLtxPlateDurationSec`. Callers
   * should always pass a value already clamped into the range that
   * matches `vocal`; this function clamps again defensively rather
   * than trusting every caller got the math right. */
  durationSec: number;
  /** See `ClipGenerationRequest.vocal`'s doc comment — picks the
   * backend and duration range this request builds for. Required
   * (not optional) so every call site has to make this choice
   * explicitly rather than silently defaulting to one backend. */
  vocal: boolean;
  /** Required together with `startSec`/`endSec`/`plateIndex`/
   * `plateCount` when `vocal` is true — see
   * `ClipGenerationRequest.mp3AudioUrl`'s doc comment. Omitted/blank on
   * a Vocal request means "no durable audio to slice," which the
   * caller (`components/SkidmarksClipRender.tsx`) should treat as an
   * honest reason to disable Render rather than let this function
   * silently build a request the server can't fulfill. */
  mp3AudioUrl?: string;
  /** The resolved vocalist for this clip's band
   * (`resolveVocalistForPrompt`, `lib/plateGeneration.ts`), if any —
   * only used on the Vocal/Comfy-LTX path, to carry a **locked**
   * character's (Jack Ash today) hallmarks/negative cues into the
   * video prompt the same way `buildPlateGenerationRequest` already
   * does for stills (see this function's body for the video-specific
   * "neon-blue lips only if his mouth is actually in frame, never a
   * readable stare" addendum). Has no effect when the vocalist has no
   * registered lock, or on an Instrumental/Grok request. */
  vocalist?: SkidmarksMember;
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
 * The one video-specific addendum to a locked character's still-image
 * hallmarks/negative cues (`lib/plateGeneration.ts`'s
 * `SKIDMARKS_CHARACTER_LOCKS`) — added here, not there, because it's
 * about *motion* the still-image prompt has no equivalent of: a
 * lip-synced video can plausibly show the character's mouth moving
 * toward camera in ways a single still never has to reconcile with
 * "face always in shadow." States the two facts explicitly rather than
 * assuming the still-image hallmarks alone cover them: (1) the glowing
 * neon-blue lips only ever appear *while his mouth is actually in
 * frame* — never invented on a shot where his mouth/face turns away or
 * leaves frame entirely; (2) across the whole clip's motion, his face
 * must never become legible/well-lit or read as a normal, watchable
 * stare, even as he sings — the shadow-face lock holds for every frame
 * of the render, not just its first one.
 */
function lockedCharacterVideoNote(): string {
  return (
    "Across this clip's motion, his glowing neon-blue lips are only ever visible while his mouth is actually " +
    "in frame \u2014 never invented on a shot where his face turns away or his mouth leaves frame. His face " +
    "never becomes legible, well-lit, or reads as a normal, watchable stare at any point in the motion, even " +
    "while he's singing \u2014 the shadow-face lock holds for the whole clip, not just its first frame."
  );
}

/**
 * Builds the one real clip-render request this feature ever sends —
 * pure and synchronous, same "fully unit-testable independent of a real
 * `XAI_API_KEY`"/`COMFY_CLOUD_API_KEY` shape as `lib/plateGeneration.ts`'s
 * `buildPlateGenerationRequest`. `params.vocal` picks which backend's
 * duration range this clamps into and whether a locked character's
 * hallmarks get appended (see this module's doc comment and
 * `BuildClipGenerationRequestParams`'s field docs).
 */
export function buildClipGenerationRequest(params: BuildClipGenerationRequestParams): ClipGenerationRequest {
  const bounds = params.vocal ? LTX_DURATION_BOUNDS : GROK_DURATION_BOUNDS;
  const trimmedMotionPrompt = params.motionPrompt?.trim().slice(0, MAX_MOTION_PROMPT_LENGTH) || "";
  const durationSec = Math.min(bounds.max, Math.max(bounds.min, Math.round(params.durationSec)));

  const lock = params.vocalist ? getSkidmarksCharacterLock(params.vocalist.id) : undefined;
  const parts = [
    params.shotPrompt.trim(),
    trimmedMotionPrompt || automaticMotionHint(),
    params.vocal && lock ? lock.promptHallmarks : "",
    params.vocal && lock?.negativeCues ? `Do not show: ${lock.negativeCues}.` : "",
    params.vocal && lock ? lockedCharacterVideoNote() : "",
    `Music video for ${params.bandName}. Cinematic motion, no on-screen text, no watermark.`,
  ];

  const request: ClipGenerationRequest = {
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
    vocal: params.vocal,
  };

  if (params.vocal) {
    request.mp3AudioUrl = params.mp3AudioUrl;
    const hasPlateGeometry =
      typeof params.startSec === "number" &&
      typeof params.endSec === "number" &&
      typeof params.plateIndex === "number" &&
      typeof params.plateCount === "number";
    if (hasPlateGeometry) {
      const range = computePlateTimeRange(
        params.startSec!,
        params.endSec!,
        params.plateCount!,
        params.plateIndex!,
        LTX_DURATION_BOUNDS
      );
      request.audioStartSec = range.startSec;
      request.audioEndSec = range.endSec;
    }
  }

  return request;
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
