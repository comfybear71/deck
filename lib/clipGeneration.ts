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
 * **Vocal -> Comfy Cloud LTX (unchanged); Instrumental -> H3 by
 * default, one tap away from Grok (Stuart lock, 2026-09-13, updated).**
 * This module used to build exactly one kind of request (always xAI
 * Grok Imagine video), then two (Vocal vs. Instrumental, `vocal`-routed,
 * no picker at all). It now builds one of *three* real shapes:
 * - `vocal: true` (Vocal/lip-sync performance) — unchanged, routes to
 *   **Comfy Cloud's LTX-2.5 `AudioToVideo` partner node**
 *   (`lib/comfyCloud.ts`). No switch here — Stuart never asked for one
 *   on the Vocal path.
 * - `vocal: false` (Instrumental/B-roll/opener) — now **two** real
 *   backends Stuart can switch between per clip, via the small H3/Grok
 *   toggle inside `components/SkidmarksClipRender.tsx`'s existing
 *   two-tap Render confirm (never a persistent pill/badge — see
 *   AGENTS.md's "no model picker" lock, and
 *   `lib/skidmarks.ts`'s `SkidmarksInstrumentalVideoModel`/
 *   `resolveInstrumentalVideoModel` for where the choice is stored and
 *   defaulted): **MiniMax H3** (`lib/minimaxH3.ts`, `MINIMAX_API_KEY`)
 *   is the new default — Stuart's own explicit "H3 please, for this
 *   smoke" ask — first-frame (and optionally last-frame) image-to-
 *   video, same `[5, 15]`s duration window as Grok (H3's own real
 *   ceiling is `[4, 15]`, so this app's existing 5s floor already sits
 *   inside it — no new duration constant needed). **xAI Grok Imagine
 *   video** stays fully wired underneath — one tap on the toggle
 *   switches back, same duration range, same one-reference-image
 *   shape as before this pass.
 *
 * **The Vocal/Comfy-LTX path's own fuller story** (revised twice now,
 * both times live-QA-driven): drives the generated video's motion
 * (chiefly mouth movement) off a real **slice of the attached song's
 * own vocal performance** for this exact plate (`lib/mp3Slice.ts`,
 * frame-cut from `mp3.audioUrl` — the durable Blob URL, never the
 * ephemeral in-tab `File`/object URL, since a server route has no
 * access to a browser `File` at all) instead of an automatic push-in/
 * zoom. The graph's duration input (node `340:331` of
 * `workflow/LTX_2.3_IA2V_Cloud.json`) is fed that slice's own real,
 * frame-aligned length, so the sliced audio and the rendered clip run
 * the same time — `MIN_LTX_CLIP_DURATION_SEC`/
 * `MAX_LTX_CLIP_DURATION_SEC` below bound how long that sliced audio
 * (and so the rendered clip) is allowed to be.
 *
 * **History of this ceiling**: this shipped first at `[5, 20]`,
 * because the Vocal path then called Comfy's hosted
 * `LtxApi25AudioToVideo` partner node, which really does hard-reject
 * driving audio outside `2-20s` in its own `execute()`. That was a
 * real cap on that node — but it was never the cap on Stuart's actual
 * workflow, which produces ~30s LTX renders routinely on his own Comfy
 * Cloud account, because that workflow never used that node. The Vocal
 * path now submits the full LTX 2.3 IA2V graph
 * (`lib/comfyCloud.ts`, `workflow/LTX_2.3_IA2V_Cloud.json`), where
 * duration is an ordinary graph input with no such ceiling, so this
 * was raised to `30` — matching his demonstrated usage, not a doc
 * page. A second, separate real bug also came out of that first pass:
 * a plate requested at *exactly* the ceiling could still get rejected
 * — the audio must be frame-aligned, and `lib/mp3Slice.ts`'s
 * `sliceMp3ToTimeRange` rounds **outward** to the nearest real MP3
 * frame boundary to fully cover the requested window, so a request for
 * exactly `20.0s` could round out to `~20.02s`, which displayed as
 * `"20.0s"` (one-decimal rounding) in the error text but still failed
 * a strict `> 20` check — a real "the number you see isn't the number
 * that got checked" gap, not a one-off fluke tied to `20` specifically.
 * Fixed in `app/api/skidmarks/generate-clip/route.ts`'s Vocal branch:
 * `sliceMp3ToTimeRange` itself trims whole frames off the *end* of an
 * over-long slice down to the ceiling instead of erroring, so this
 * class of "exact-boundary" rounding overshoot can't resurface at any
 * ceiling. **Lowered back to `15` on 2026-09-15** (Stuart's own real
 * report: real quality/reliability problems on renders past ~20s on
 * this app specifically, not matching what he saw building his earlier
 * apps) — `30` was a real number he'd once produced, but not a safe
 * one to keep defaulting to here. `15` also now matches Instrumental's
 * own ceiling and lines up with the locked-character batch-chain
 * math: 3 clips × 15s = the 45s real limit on how long one chained
 * run is allowed to run before it must reset (see
 * `scriptSequenceRunner.ts`'s `LOCKED_CHARACTER_CHAIN_BATCH_SIZE`).
 * **This
 * app's own product duration floor/ceiling should never throw a hard
 * error just because `segmentLengthSec / plateCount` computes something
 * outside `[MIN_LTX_CLIP_DURATION_SEC, MAX_LTX_CLIP_DURATION_SEC]`** —
 * `computePlateDurationSec`/`computeLtxPlateDurationSec` below always
 * clamp into range instead, and the confirm step
 * (`components/SkidmarksClipRender.tsx`) always shows that clamped
 * number, never the raw pre-clamp one.
 *
 * **Neither Comfy/LTX nor MiniMax H3 is live-verified** the way the
 * Grok path is — see `lib/comfyCloud.ts`'s and `lib/minimaxH3.ts`'s
 * own module doc comments for exactly what's real-and-documented vs.
 * not live-tested (no `COMFY_CLOUD_API_KEY`/`MINIMAX_API_KEY` is
 * available in this sandbox). The H3 request/response shapes below are
 * mirrored from the original Skidmarks repo's own real H3 client
 * (`comfybear71/skidmarks`, `src/lib/minimaxVideo.ts`), not invented —
 * see `lib/minimaxH3.ts`'s module doc comment.
 */

import { getSkidmarksCharacterLock } from "./plateGeneration";
import { resolveInstrumentalVideoModel, type SkidmarksInstrumentalVideoModel, type SkidmarksMember } from "./skidmarks";

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
 * "History of this ceiling" note: raised to `30` once, then lowered
 * back to `15` on 2026-09-15 after real reliability problems on
 * renders past ~20s on this app. `15` now matches Instrumental's own
 * ceiling and the locked-character batch-chain math (3 clips × 15s =
 * the 45s real limit before a chained run must reset). `5` stays the
 * floor, matching this feature's existing floor everywhere else. */
export const MIN_LTX_CLIP_DURATION_SEC = 5;
export const MAX_LTX_CLIP_DURATION_SEC = 15;

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

/** Per-second estimate shown in the Vocal render confirm, on
 * Lightricks' own published LTX direct-API rate ($0.13/s, docs.ltx.io/
 * pricing / ltx.io/model/api/pricing, checked while building this
 * feature). **Honesty note, and it matters more since the 2.3 port**:
 * the Vocal path no longer calls a hosted LTX partner node at all — it
 * runs `workflow/LTX_2.3_IA2V_Cloud.json` on Comfy Cloud's own GPUs,
 * billed as Comfy Cloud compute/credits, not as an LTX API call. This
 * rate is therefore an order-of-magnitude stand-in so the confirm step
 * still shows Stuart a real number instead of nothing, not a verified
 * bill; no `COMFY_CLOUD_API_KEY` is available in this sandbox to check
 * the real credit burn against. If Stuart's actual Comfy Cloud
 * statement after a few real renders says otherwise, this constant is
 * the one place to correct. No per-reference-image surcharge, unlike
 * Grok. */
const LTX_SECOND_RATE_USD = 0.13;

export function estimateLtxClipRenderCostUsd(durationSec: number): number {
  return durationSec * LTX_SECOND_RATE_USD;
}

/** MiniMax-H3 at 768P — the cheaper of its two documented output
 * resolutions ($0.08/s vs. 2K's $0.13/s, per MiniMax's own published
 * pay-as-you-go pricing, platform.minimax.io/docs/guides/pricing-paygo,
 * checked while building this feature) — same "cheapest documented
 * tier by default, hardcoded not a picker" cost lock as Grok's 480p and
 * LTX's Fast tier above. No per-reference-image surcharge in this
 * estimate — MiniMax's own pricing gives the first 5 reference images
 * free ($0.04 each past that), and this feature never sends more than
 * 2 (first frame + optional last frame — see `lib/minimaxH3.ts`'s
 * module doc comment). */
const H3_SECOND_RATE_USD = 0.08;

export function estimateH3ClipRenderCostUsd(durationSec: number): number {
  return durationSec * H3_SECOND_RATE_USD;
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

/** Longest a typed camera-motion override can be — raised from 220 to
 * 600 (2026-09-14, Stuart's direct ask: some of his real motion
 * prompts were getting cut off at 220, over 1.5x too short) so a real,
 * detailed motion description isn't silently truncated. Enforced both
 * as the `<textarea>`'s own `maxLength` in
 * `components/SkidmarksClipRender.tsx` and here, so a request built
 * without going through that field (a test, a future caller) can't
 * quietly bypass the same cap. */
export const MAX_MOTION_PROMPT_LENGTH = 600;

/**
 * The *only* camera line this app ever adds on its own, and only when
 * Stuart left the motion box blank on a locked character's Vocal
 * render: camera holds, he moves. Blank motion on anything else means
 * exactly that — no camera line at all, nothing invented (audit Part 3:
 * "blank motion ≠ the app writes zoom"). The old factory default
 * ("Slow cinematic push-in zoom…") is gone; a push-in only ever reaches
 * a render if he typed it.
 */
function defaultMotionLine(vocalLockedCharacter: boolean): string {
  if (!vocalLockedCharacter) return "";
  return (
    "Camera holds — a static, locked-off frame for the whole clip. All the energy comes from him instead: " +
    "a slight head nod in time with the vocal, tilting his head up and to the side, relaxed hand gestures, " +
    "a light foot tap. Same scene, subject, and lighting as the reference image throughout."
  );
}

/**
 * Any camera-movement language that breaks a locked character's
 * shadow-face lock on a Vocal render — Stuart's own live testing and
 * the audit brief's Rule B: "While he is singing: camera still. No
 * zoom, push-in, orbit, pan." Deliberately broad (a "tracking shot" or
 * "swerving camera" in a script description counts just as much as a
 * typed "slow zoom") — a false positive only ever costs a static frame,
 * a false negative costs a paid render with a human face in it.
 */
const CAMERA_MOVE_RE =
  /\b(zoom|zooms|zooming|push[- ]?in|pushes in|pushing in|pull[- ]?back|dolly|dollies|orbit|orbits|orbiting|circl\w*|pan|pans|panning|whip|tracking shot|tracks (?:with|around|past)|swerv\w*|sweep\w*|crane|handheld|fly[- ]?(?:in|through|over|around)|rotat\w*|spin\w*)\b/i;

/** Whether some motion/shot text asks the camera itself to move. Pure. */
export function motionPromptMovesCamera(text: string | undefined): boolean {
  return !!text && CAMERA_MOVE_RE.test(text);
}

/** Shown to Stuart, before the paid tap, when his own typed motion note
 * asks the camera to move on a locked character's Vocal plate. His text
 * is still sent exactly as written — user text wins (audit Part 3) —
 * this is a warning, never a silent rewrite. */
export const CAMERA_HOLD_REQUIRED_MESSAGE =
  "Camera hold is what keeps his face in the hat while he sings — this motion note asks the camera to move. It will be sent exactly as you wrote it; camera moves around his face are the known way the shadow lock breaks.";

export interface ClipGenerationRequest {
  /** The full prompt sent to xAI — Stuart's own clip `shotPrompt`
   * (shared across the whole plate strip, same field the still-generation
   * flow already reads) plus either his own typed `motionPrompt` (when
   * given, stored per-plate) or this module's automatic motion routing
   * hint, plus a band/no-text/no-watermark footer. */
  prompt: string;
  /** A locked vocalist's `negativeCues` (Jack Ash today), when present —
   * only ever set on the Vocal/Comfy-LTX path. Sent to the workflow's
   * own real negative-conditioning node (`lib/comfyCloud.ts`'s
   * `IA2V_NODE_NEGATIVE_PROMPT`), appended onto its default negative
   * text rather than replacing it. Omitted entirely for an Instrumental
   * request or a Vocal one with no locked vocalist — nothing here
   * invents negative text for a character with no lock. */
  negativePrompt?: string;
  /** Present only on a locked character's Vocal render — see
   * `ClipCameraWarnings`. Ignored by the server. */
  cameraWarnings?: ClipCameraWarnings;
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
  /** Which real backend `app/api/skidmarks/generate-clip/route.ts`
   * calls when `vocal` is `false` — `"h3"` (MiniMax H3, the default —
   * see `lib/skidmarks.ts`'s `resolveInstrumentalVideoModel`) or
   * `"grok"` (xAI Grok Imagine video, unchanged). Never set — and
   * never read by the route — on a Vocal request; that path always
   * means Comfy Cloud LTX regardless of this field. */
  videoBackend?: "h3" | "grok";
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
   * unchanged. Sent exactly as typed — user text wins (audit Part 3).
   * Trimmed and capped at `MAX_MOTION_PROMPT_LENGTH` (the UI shows a
   * live counter against the same cap); blank/omitted adds a static
   * "Camera holds" line for a locked character's Vocal clip and
   * nothing at all otherwise — see `defaultMotionLine`. Still read on
   * the Vocal/Comfy-LTX path
   * too — a typed camera-motion note is just as meaningful for that
   * partner node's own `prompt` field. */
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
  /** Only meaningful when `vocal` is `false` — the clip's own stored
   * H3/Grok choice (`lib/skidmarks.ts`'s `SkidmarksClipSegment
   * .instrumentalVideoModel`, resolved via `resolveInstrumentalVideoModel`
   * before it reaches here — see that function's doc comment for the
   * `"h3"` default). Ignored entirely on a Vocal request; that path
   * always means Comfy Cloud LTX. */
  instrumentalVideoModel?: SkidmarksInstrumentalVideoModel;
}

/** Camera-movement *warnings* for a locked character's Vocal render —
 * nothing here changes the prompt (user text wins, audit Part 3); it
 * only tells the UI what to warn about before any money is spent. */
export interface ClipCameraWarnings {
  /** Stuart's own typed motion note asks the camera to move. Sent as
   * written; see `CAMERA_HOLD_REQUIRED_MESSAGE`. */
  typedMotionMovesCamera: boolean;
  /** The shot description itself describes camera movement. Sent as
   * written. */
  shotMovesCamera: boolean;
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
 * of the render, not just its first one; (3) a close-up push-in/zoom
 * makes the shadow *darker*, not just held steady — the closer the
 * camera gets to his face, the deeper the shadow gets, so the tightest
 * close-up is the most hidden moment of the clip, not the most at-risk
 * one (Stuart's own live-QA report, 2026-09-14: zooming in tight almost
 * revealed a normal human face; his own follow-up ask, same day: the
 * shadow should darken as the camera nears his face, not just hold).
 *
 * Revised 2026-09-15 after a real repro: telling the model the
 * close-up should be its "most completely hidden," darkest moment
 * read as an instruction to go fully, totally black on his face \u2014
 * and LTX does not hold a true black frame cleanly, it resolves the
 * emptiness into an invented normal human face once the shot has
 * nothing left to anchor to. The fix is not "hold less dark," it's
 * "never truly empty": the close-up stays as deep and dark as before,
 * but always keeps one small visible anchor in frame (the hat-brim
 * edge, a whisper of rim light on the shadow's outline, or the glowing
 * neon lips) so the model always has *some* real shape to lock onto,
 * never a flat black frame with nothing in it.
 *
 * Also added 2026-09-15, same round: Stuart's own direct comparison \u2014
 * fast camera movement around his head while singing "always screws
 * it up," while a clip where the camera held steady and he just
 * nodded his head and tapped his foot "worked perfectly." Camera
 * speed around the face, not just darkness, is a second real trigger,
 * so this now steers the energy of the shot onto his own small body
 * movement instead of onto camera motion.
 */
function lockedCharacterVideoNote(): string {
  // Constrains Jack only. Never names a camera move (push-in, zoom,
  // orbit, pan) even to forbid it — naming one in the positive prompt
  // teaches the model to expect it (audit Part 3, rule 4).
  return (
    "Across this clip's motion, his glowing neon-blue lips are only ever visible while his mouth is actually " +
    "in frame \u2014 never invented on a shot where his face turns away or his mouth leaves frame. His face " +
    "never becomes legible, well-lit, or reads as a normal, watchable stare at any point in the motion, even " +
    "while he's singing \u2014 the shadow-face lock holds for the whole clip, not just its first frame. The " +
    "closer his face is to the lens, the darker and deeper the shadow under the brim, never lighter or thinner. " +
    "But the frame must never go fully, totally black or empty \u2014 keep one small real anchor visible at all " +
    "times: the hat-brim edge, a faint rim of light along the shadow's outline, or the glowing neon lips. A " +
    "pure black, featureless frame is wrong here, not the goal \u2014 deep near-black shadow with one visible " +
    "anchor point is. He must never resolve into a normal, visible human face at any point."
  );
}

/** Skidmarks' own original Vocal/LTX prompt lock (2026-09-14, "Vocal LTX
 * prompt wrap only" ask) — kept byte-for-byte, typo included ("dication"),
 * as given: this is the proven wrap this feature's own prompt used
 * before it was lost, not new wording invented here. Prepended ahead of
 * the shot/motion/character-lock text below, Vocal/LTX clips only —
 * never on an Instrumental/Grok/H3 clip, which has no lip-sync and no
 * "start image as first frame" contract to state. */
const VOCAL_LTX_PROMPT_LOCK =
  "perfect lip sync, clear lip movement, citing the dialogue clearly, facial expressions and hand gestures are " +
  "lively, dication is perfect. Use the provided start image as the first frame. Same people as the start image " +
  "for the entire clip. Highly detailed stylised 3D animated feature render, clean simplified forms, believable " +
  "materials, soft overcast lighting, shallow depth of field, cinematic quality, sharp focus. Not photographic, " +
  "not a cartoon, not a photoreal human.";

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
  const lockedVocal = Boolean(params.vocal && lock);
  // User text wins (audit Part 3). His motion note goes out exactly as
  // typed; the only line this app adds on its own is a camera hold
  // when the box is blank on a locked character's Vocal render. Camera
  // moves in his own text are *warned about* (`cameraWarnings`), never
  // rewritten.
  const motionText = trimmedMotionPrompt || defaultMotionLine(lockedVocal);
  const cameraWarnings: ClipCameraWarnings = {
    typedMotionMovesCamera: motionPromptMovesCamera(trimmedMotionPrompt),
    shotMovesCamera: motionPromptMovesCamera(params.shotPrompt),
  };
  // `lock.negativeCues` no longer rides along in this *positive* prompt
  // as a "Do not show: X" sentence — it goes out on the workflow's own
  // real negative-conditioning channel instead (`request.negativePrompt`
  // below, `lib/comfyCloud.ts`'s `IA2V_NODE_NEGATIVE_PROMPT`). Naming a
  // concept even to negate it, inside the same positive-conditioning
  // text, doesn't suppress it as reliably as true negative conditioning
  // does — real reported failure, 2026-09-15: Jack Ash's face resolving
  // into a normal, lit human face on every single Vocal clip.
  // Stuart's own text first, always. Everything after it is either the
  // Vocal backend's lip-sync lock or Jack's own lock — never a camera
  // move he didn't write.
  const parts = [
    params.shotPrompt.trim(),
    motionText,
    params.vocal ? VOCAL_LTX_PROMPT_LOCK : "",
    lockedVocal ? (lock!.videoPromptHallmarks ?? lock!.promptHallmarks) : "",
    lockedVocal ? lockedCharacterVideoNote() : "",
    lockedVocal
      ? "Solo shot: no other people, extra characters, crowd, or background figures appear anywhere in frame at " +
        "any point in the motion, including out-of-focus or partially-visible in the background."
      : "",
    `Music video for ${params.bandName}. no on-screen text, no watermark.`,
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
    ...(params.vocal && lock?.negativeCues ? { negativePrompt: lock.negativeCues } : {}),
    ...(lockedVocal ? { cameraWarnings } : {}),
  };

  if (!params.vocal) {
    // `resolveInstrumentalVideoModel` is also the fallback used here
    // when a caller doesn't resolve it first — see that function's doc
    // comment for why an unset/invalid value means `"h3"`, not `"grok"`.
    request.videoBackend = resolveInstrumentalVideoModel(params.instrumentalVideoModel);
  }

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
      /** The durable Blob URL of this render's own last frame, extracted
       * server-side (`app/api/skidmarks/generate-clip/route.ts`'s
       * `persistRenderBytesToBlob`, `lib/serverVideoFrame.ts`) — the
       * real "last frame becomes the next clip's first plate" mechanism,
       * now fully server-side (see that module's doc comment for why
       * the old client-side `<video>`+`<canvas>` capture was replaced).
       * Absent when `persisted` is `false`, or when extraction itself
       * failed (best-effort layered on top of a successful save — see
       * that route's doc comment). */
      lastFrameUrl?: string;
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
  lastFrameUrl?: unknown;
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
  const lastFrameUrl = typeof okBody.lastFrameUrl === "string" ? okBody.lastFrameUrl : undefined;
  return {
    ok: true,
    videoUrl,
    durationSec,
    persisted,
    ...(persistError ? { persistError } : {}),
    ...(lastFrameUrl ? { lastFrameUrl } : {}),
  };
}

/** Kept for backward compatibility with any caller that still imports
 * this — always `MIN_CLIP_DURATION_SEC` now that duration is real and
 * per-plate rather than a single flat constant. */
export const CLIP_DURATION_SEC = MIN_CLIP_DURATION_SEC;
export const MAX_CLIP_REFERENCE_IMAGES = 3;
