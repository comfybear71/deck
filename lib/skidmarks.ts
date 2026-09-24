/**
 * Skidmarks "vibe director" — Music-video flow, through the MP3 step and
 * its clip/segment timeline (see the README's "Skidmarks node (vibe
 * director)" section).
 *
 * This is a deliberate rewrite of the earlier free-text "type a vibe
 * brief, get a scripted director-chat thread" build (PR #17/#18): the
 * locked mockups replace that with a concrete, appended-step wizard —
 * pick a project type, choose a band, cast its members, attach an MP3,
 * assign each clip a plain-language shot prompt —
 * all on **one continuous scroll**, not a chat thread and not separate
 * screens. Nothing here calls a real backend: no Comfy MCP, no
 * Seedance/LTX/ElevenLabs, no `skidmarks.aiglitch.app` Crash Lab, no
 * actual AI image/video generation.
 *
 * **Mock vs. real, precisely**: band/member *identity* is real —
 * bands and members are hand-seeded or user-created with no invented
 * name/role, a picked cover/avatar photo (`coverImage`/`avatarImage`) is
 * a real photo Stuart chose (via `readImageFileAsDataUrl`), and deleting
 * a band or member (`removeSkidmarksBand`/`removeSkidmarksMember`) is a
 * real, persisted removal. The attached MP3's clip/segment timeline now
 * has **two** real signal sources, tried in parallel the moment a file's
 * attached (`hooks/useSkidmarksStudio.ts`'s `attachMp3`), in this
 * priority order:
 * 1. **Real word-level transcription** (`lib/transcription.ts`,
 *    `transcribeAudio` + `segmentsFromWords`) — a real speech-to-text
 *    call (server route: `app/api/skidmarks/transcribe/route.ts`,
 *    **ElevenLabs Scribe only** via `ELEVENLABS_API_KEY`/
 *    `ELEVEN_LABS_API_KEY` — OpenAI Whisper was removed entirely, see
 *    that route's doc comment for why) that returns
 *    real per-word start/end times; `applySkidmarksTranscriptionResult`
 *    below merges consecutive words into vocal runs (gaps =
 *    instrumental) — this is what lets a segment boundary land at an
 *    actual measured vocal onset (Stuart's original ask, after the
 *    energy heuristic glued "Talking To Concrete"'s intro + flute into
 *    one giant Vocal call) instead of a mid-band-energy guess. **Never
 *    claimed live without a key** — if no ElevenLabs key is set
 *    server-side, or the Scribe request fails, this is
 *    honestly skipped (`transcriptionStatus`), not silently retried
 *    against another provider — there isn't one anymore; the energy
 *    heuristic (step 2 below) is the only fallback. **Also never
 *    claimed useful just because words came back** — a live run
 *    against this exact track once returned real, non-empty words
 *    from an STT provider that still merged into a single
 *    Instrumental segment covering the whole song (too sparse across the
 *    sung sections for `segmentsFromWords`'s gap merge to find any
 *    vocal run worth keeping), so `applySkidmarksTranscriptionResult`
 *    additionally checks `hasUsefulVocalCoverage`
 *    (`lib/transcription.ts`) before trusting a landed result as
 *    `segmentsSource: "transcription"` — see `transcriptionStatus ===
 *    "sparse"` below for the honest "it ran, but not enough of it
 *    mapped to singing" outcome that check can produce.
 * 2. **The energy heuristic** (`analyzeVocalActivity`,
 *    `lib/audioAnalysis.ts`) — a real FFT-based vocal-band-energy
 *    heuristic over the actual decoded audio, entirely client-side, no
 *    API key or network call. Runs unconditionally (not just when
 *    transcription is unavailable) so there's always a real-ish signal
 *    in flight while transcription's network round-trip is pending, and
 *    stays the fallback whenever transcription is unconfigured or
 *    fails — this build never drops it.
 *
 * `applySkidmarksAnalysisResult`/`applySkidmarksTranscriptionResult`
 * turn whichever source resolves into the segments `SkidmarksClipTimeline`
 * renders, with a *useful* transcription result always outranking the
 * heuristic once it lands (see `segmentsSource`) — a later heuristic
 * result can't downgrade an already-real transcription, and a sparse
 * transcription result (real words, near-zero singing coverage — see
 * `applySkidmarksTranscriptionResult`) can't downgrade an
 * already-showing heuristic/seed result either. The Lyrics/Timing/Ready
 * chips (`skidmarksChecklistState` below) are derived straight from
 * that real state, not staged timers, and **Lyrics only turns green for
 * real, useful transcription** — the energy heuristic alone (no key, a
 * failed request, or a transcription result too sparse to trust) keeps
 * it amber/`stub`, since it's a real signal but not actual transcribed
 * lyrics timing. If both sources fail (or transcription's unconfigured/
 * sparse and the heuristic errors too),
 * `markSkidmarksAnalysisFailed`/`markSkidmarksTranscriptionFailed` keep
 * the seed cadence (`buildDemoSegments`) as an **honestly-labeled
 * fallback** — see `segmentsSource` — rather than silently pretending
 * either is real. **Generated "looks" are real too, now** (2026-09-14
 * — `buildGeneratedLook`, was `buildMockLook`): the member-casting
 * "Generate" popup used to always mint a plain color swatch, no image
 * model call at all — genuinely never wired up, not a regression. It
 * now calls the same real xAI Grok Imagine backend the plate-still
 * generator already uses (`lib/plateGeneration.ts`'s
 * `buildMemberLookRequest`/`generatePlateStill`), and the result is
 * uploaded to Blob the same way every other real photo in this feature
 * is. What's still mock: the seed fallback cadence itself when it's
 * showing (a deterministic verse/bridge/lead/instrumental scaffold).
 * **Plate stills are real too** (a later pass than the one this module doc comment
 * otherwise describes): each slot in a clip's plate strip
 * (`SkidmarksClipSegment.plates`, a `SkidmarksClipPlateSlot[]`) holds
 * either a photo Stuart uploaded or a real image
 * `lib/plateGeneration.ts` generated via xAI's Grok Imagine API
 * (`app/api/skidmarks/generate-still/route.ts`) — see that module's doc
 * comment for what's actually wired vs. still a stub. **The clip *video*
 * pass now has one real, opt-in slice too** —
 * `components/SkidmarksClipRender.tsx` (rendered inside
 * `SkidmarksClipStub`) calls a real xAI Grok Imagine *video* endpoint
 * (`app/api/skidmarks/generate-clip/route.ts`) against a clip's already-
 * generated/uploaded plate still(s), one clip at a time, always behind an
 * explicit two-tap confirm — this is deliberately *not* the same thing as
 * the whole-song "Generate Clips" button (`SkidmarksClipTimeline`), which
 * stays a stub (see that component's doc comment for why: "render every
 * clip in the song" is exactly the auto-fire-everything cost risk Stuart
 * ruled out, where the new per-clip control is a small, explicit,
 * opt-in render of one clip Stuart already has a still for). **A clip
 * can hold more than one plate slot** — a
 * "+" control on the expanded panel appends another empty slot to that
 * same clip's horizontal strip (`addSkidmarksClipPlate`), so one long
 * Instrumental clip (the 40s-door problem) can get a door plate, a
 * keyhole plate, and a Jack-seated plate without splitting the timeline
 * row itself into three separate clips.
 *
 * Persistence: an in-memory cache (`cachedState`) is still the
 * synchronous source of truth the UI reads via `useSyncExternalStore`
 * (`hooks/useSkidmarksStudio.ts`) — that hasn't changed, and can't: a
 * real network round trip can never be a synchronous `getSnapshot`.
 * What *has* changed (the actual fix for Stuart's repeated "never
 * localStorage for studio state of record" lock, and the literal cause
 * of the plate/prompt wipes he was hitting): this state's *durable* copy
 * now lives in **Neon Postgres**, one row keyed by a fixed single-tenant
 * owner id (`lib/skidmarksSession-server.ts`'s `SKIDMARKS_STUDIO_OWNER_ID`
 * — this app has no auth system, and there's exactly one real user),
 * read via one `GET /api/skidmarks/session` on first use and written via
 * a debounced, serialized `PUT` after every local mutation — see the
 * "Neon-backed session persistence" section below `normalizeState` for
 * the actual hydrate/push implementation and its race guards.
 * `localStorage` is gone outright as this feature's state of record; the
 * `the-tab:skidmarks-studio` key it used to write is simply never
 * touched by this file anymore. This is what actually survives a hard
 * refresh *and* a device switch now — the old `localStorage` mirror
 * only ever survived the former. Note the attached audio `File` itself
 * still never persists
 * (see `SkidmarksMp3Card`), so a completed analysis result persists fine
 * across a reload, but an *in-progress* one can't resume — `normalizeState`
 * below turns a stale `"analyzing"` status into an honest `"failed"` one
 * on load rather than hanging forever. Also explicitly out of scope for
 * this build: voice and in-app stitch, and any *automatic* or whole-song
 * clip *video* rendering ("Generate Clips" is still a stub button — see
 * `SkidmarksClipTimeline`) — but a clip's own plate strip
 * (`SkidmarksClipStub`; each plate's still is real — upload or
 * generate, see `lib/plateGeneration.ts`) now has a real, explicit,
 * one-clip-at-a-time *animate* path past it too (see
 * `components/SkidmarksClipRender.tsx` and
 * `app/api/skidmarks/generate-clip/route.ts`) — Stuart opts into
 * rendering one clip's still(s) into a real short video, on the same xAI
 * key stills already use; nothing renders on its own. Camera angle and
 * the location-plate picker are both **gone
 * outright** — see the QA fix that removed the multi-card plate
 * carousel — and the model row went with them: `SKIDMARKS_MODELS`
 * (LTX/Grok/H3/Seedance) and the cost-locked `defaultSegmentModel`
 * auto-assignment (LTX or Grok only, never H3/Seedance) both still
 * exist and still run, but as of this pass there is **no model picker
 * in the UI at all** — Stuart didn't ask for one back, and a tiny model
 * badge is only meant to reappear once a clip has a real still (see
 * `SkidmarksClipStub`'s doc comment). Nothing here can quietly start
 * spending against a pricier model on its own either way.
 */

import type { VocalAnalysisResult } from "./audioAnalysis";
import {
  hasUsefulVocalCoverage,
  segmentsFromWords,
  transcriptionProviderLabel,
  vocalCoverageSec,
  type SkidmarksTranscribedWord,
  type SkidmarksTranscriptionProvider,
} from "./transcription";
import { uploadSkidmarksMemberPhoto } from "./memberPhotoBlob";
import {
  appendKeptStillToSleeve,
  buildLibraryPlateStill,
  normalizeMemberStillSleeve,
  type SkidmarksMemberSleeveEntry,
} from "./memberStillSleeve";
export type { SkidmarksMemberSleeveEntry } from "./memberStillSleeve";
import { uploadSkidmarksPlateStill } from "./plateStillBlob";
import type { ScriptSequencePart } from "./scriptSequence";
import {
  buildDefaultSunnyBanksLive,
  buildSunnyBanksWorkspaceFromLive,
  cloneSunnyBanksLive,
  liveFromSunnyBanksWorkspace,
  normalizeSunnyBanksStudio,
  buildEmptySunnyBanksLive,
  sunnyBanksStudioHasUserContent,
  upsertSunnyBanksWorkspace,
  type SkidmarksSunnyBanksState,
  type SunnyBanksLiveState,
  type SunnyBanksWorkspaceSnapshot,
} from "./sunnyBanksWorkspace";

/** Cap on how many bands "New" can pile up before we start dropping the
 * oldest — this is a v0 stub roster, not a real catalog. */
const BAND_HISTORY_LIMIT = 12;

/** Up to 3 members per band per the locked mock — matches the mockups
 * exactly (Rock Grok + Stew Balls + one open slot). */
export const MAX_MEMBERS_PER_BAND = 3;

/**
 * The landing's one horizontal row of three project-type tiles. Only
 * `music-video` is wired up in this build — `skidmarks` and `sunnybank`
 * render (per the locked mockup) but are inert, so the row reads
 * correctly without pretending those flows exist yet.
 */
export type SkidmarksProjectKind = "music-video" | "skidmarks" | "sunnybank";

export interface SkidmarksProjectKindMeta {
  kind: SkidmarksProjectKind;
  label: string;
  icon: "note" | "tire" | "sun";
  enabled: boolean;
}

export const SKIDMARKS_PROJECT_KINDS: SkidmarksProjectKindMeta[] = [
  { kind: "music-video", label: "Music video", icon: "note", enabled: true },
  { kind: "skidmarks", label: "Skidmarks", icon: "tire", enabled: false },
  { kind: "sunnybank", label: "Sunnybank", icon: "sun", enabled: true },
];

/** One generated "look" for a member — a stand-in for a real render.
 * `seed` just drives a deterministic gradient swatch in the UI; nothing
 * here is an actual image. */
export interface SkidmarksLook {
  id: string;
  seed: number;
  prompt: string;
  photoreal: number;
  createdAt: number;
  /** The real generated photo — a Vercel Blob URL (or, on a Blob upload
   * hiccup, a fallback inline `data:` URL) from `lib/plateGeneration.ts`'s
   * `generatePlateStill`. Missing on a look created before this field
   * existed (`buildMockLook`'s old color-swatch-only shape) — such a
   * look still renders fine, just without a real photo (see
   * `MemberAvatar`'s `latestLook` fallback in
   * `SkidmarksMembersModule.tsx`). */
  imageUrl?: string;
}

export interface SkidmarksMember {
  id: string;
  name: string;
  /** Short role/note under the name, e.g. "Solo" — optional, matches the mockup. */
  role?: string;
  /** Placeholder avatar glyph until a look is generated. */
  emoji: string;
  /** A real photo Stuart picked for this member (data URL, resized client-side —
   * see `readImageFileAsDataUrl`). Takes priority over both `emoji` and any
   * generated look in the avatar — it's his actual picture, not a mock. */
  avatarImage?: string;
  looks: SkidmarksLook[];
  /** This member's own editable lock card — see `SkidmarksMemberLockCard`.
   * When `lookRules` is non-blank it *is* the character lock for every
   * render this member appears in (and overrides the built-in Jack Ash
   * lock for that member). Blank/absent means "no lock" for a new
   * artist, or the built-in one for Jack. */
  lock?: SkidmarksMemberLockCard;
  /**
   * Artist still sleeve — plate stills Stuart marked **Keep** for this
   * member (Blob https URLs). Lives on the member, not the song, so
   * switching MP3s never clears it. Avatar is resolved into the visible
   * sleeve at read time (`resolveMemberStillSleeve`) and is not stored
   * twice here. Prefer `keepSkidmarksMemberSleeveStill` /
   * `applySkidmarksMemberSleeveStillToPlate` over writing this field
   * directly.
   */
  stillSleeve?: SkidmarksMemberSleeveEntry[];
}

/**
 * A per-artist lock card Stuart writes in the app (2026-09-16 ask:
 * a second artist must be lockable without a code change). Plain
 * sentences; sent on every render the member is in, same channels as
 * the built-in Jack Ash lock — `lookRules` on the positive prompt,
 * `neverShow` on the negative node.
 */
export interface SkidmarksMemberLockCard {
  /** "What must stay true": fedora, silhouette, neon lips… */
  lookRules: string;
  /** "Never show": a lit face, eyes, a second person… */
  neverShow: string;
}

export interface SkidmarksBand {
  id: string;
  name: string;
  tagline: string;
  /** Drives a deterministic album-cover gradient — see `coverGradientClass`.
   * Only used while `coverImage` is unset. */
  coverSeed: number;
  /** A real cover image Stuart picked for this band (data URL, resized
   * client-side — see `readImageFileAsDataUrl`). Takes priority over the
   * mock gradient in the band tile once set. */
  coverImage?: string;
  /** Which little "edit cover" glyph this band's tile shows — cosmetic variety, matches the mockup. */
  editIcon: "pencil" | "camera";
  members: SkidmarksMember[];
}

export type SkidmarksChecklistKey = "lyrics" | "timing" | "ready";

export const SKIDMARKS_CHECKLIST_ORDER: SkidmarksChecklistKey[] = [
  "lyrics",
  "timing",
  "ready",
];

export const SKIDMARKS_CHECKLIST_LABEL: Record<SkidmarksChecklistKey, string> = {
  lyrics: "Lyrics",
  timing: "Timing",
  ready: "Ready",
};

/**
 * A chip's honest state — deliberately more than a boolean so "still
 * mock/fallback" never has to borrow the same green "done" look as
 * "genuinely finished":
 * - `pending` — nothing to report yet (no MP3 attached).
 * - `analyzing` — real work in flight (probing duration / running
 *   `analyzeVocalActivity`).
 * - `done` — the real signal actually resolved.
 * - `stub` — the real signal failed, so we're showing the honestly-
 *   labeled seed fallback instead. Never rendered as green.
 */
export type SkidmarksChipState = "pending" | "analyzing" | "done" | "stub";

/**
 * Derives the Lyrics/Timing/Ready chip states straight from real
 * session state — no staged timers. `timing` is real once the browser's
 * probed duration resolves.
 *
 * `lyrics` means **real, useful transcription** now, not just "some
 * vocal signal resolved" and not just "a provider responded" — it only
 * turns green once real word-level transcription actually lands *and*
 * covers enough of the track to trust (`segmentsSource ===
 * "transcription"`, which `applySkidmarksTranscriptionResult` only sets
 * after `hasUsefulVocalCoverage` passes). While transcription is still
 * in flight (`transcriptionStatus === "checking"`) or the energy
 * heuristic is still running, it shows `analyzing` — there's real work
 * in progress, even if what eventually lands is only the heuristic.
 * Once both have settled and transcription didn't produce a usable
 * vocal map (no key configured, the request failed, or a provider
 * responded but `transcriptionStatus === "sparse"` — real words, too
 * little real singing coverage), it's `stub` — **never green** —
 * because the energy heuristic alone answers "is this bit sung", not
 * "what are the actual lyrics/word timing", and this chip is about the
 * latter.
 *
 * `ready` only turns fully green once both `timing` and `lyrics` are
 * real, and shows `stub` (not green) if the clip list is only usable via
 * the heuristic or seed fallback.
 */
export function skidmarksChecklistState(
  mp3: SkidmarksMp3Attachment | null
): Record<SkidmarksChecklistKey, SkidmarksChipState> {
  if (!mp3) {
    return { lyrics: "pending", timing: "pending", ready: "pending" };
  }
  const timing: SkidmarksChipState = mp3.durationSec !== null ? "done" : "analyzing";
  const stillResolving =
    mp3.transcriptionStatus === "checking" || mp3.analysisStatus === "analyzing";
  const lyrics: SkidmarksChipState =
    mp3.segmentsSource === "transcription" ? "done" : stillResolving ? "analyzing" : "stub";
  const ready: SkidmarksChipState =
    timing === "done" && lyrics === "done"
      ? "done"
      : timing === "done" && lyrics === "stub"
        ? "stub"
        : "pending";
  return { lyrics, timing, ready };
}

/**
 * The clip-segment labels the timeline UI works with. `verse`/`bridge`/
 * `lead`/`instrumental` are `buildDemoSegments`' seed-cadence labels
 * (song-structure guesses that seed can afford to invent, since it's
 * clearly marked fake). `vocal` is shared by **both** real paths —
 * `analyzeVocalActivity` (`lib/audioAnalysis.ts`, the energy heuristic)
 * and `transcribeAudio`/`segmentsFromWords` (`lib/transcription.ts`,
 * real word timing) — since either way it only knows "singing" vs. not,
 * so it's deliberately **not** called verse/bridge (that would claim
 * song-structure knowledge neither signal has); `segmentsSource` on the
 * attachment (not the segment itself) is what distinguishes which real
 * signal actually produced it, for the timeline's honesty caption;
 * `instrumental` doubles as the real path's non-vocal label too. `vocal`
 * (the boolean on each meta entry) drives the one default-model rule the
 * whole feature hangs off: sung segments default to **LTX Lip-sync**,
 * non-vocal ones default to a plain video model instead — see
 * `defaultSegmentModel` below.
 */
export type SkidmarksSegmentLabel = "verse" | "bridge" | "lead" | "instrumental" | "vocal";

export interface SkidmarksSegmentLabelMeta {
  label: string;
  vocal: boolean;
}

export const SKIDMARKS_SEGMENT_LABEL_META: Record<SkidmarksSegmentLabel, SkidmarksSegmentLabelMeta> = {
  verse: { label: "Verse", vocal: true },
  bridge: { label: "Bridge", vocal: true },
  lead: { label: "Lead", vocal: false },
  instrumental: { label: "Instrumental", vocal: false },
  vocal: { label: "Vocal", vocal: true },
};

/** The four models a clip's `model` field can ever hold — Stuart's
 * locked allowlist, tightened again by his cost lock ("be very wary of
 * spend"): **LTX** (vocal/singing lip-sync) and **Grok** (the
 * instrumental default) are the only two `defaultSegmentModel` ever
 * auto-assigns. **H3** and **Seedance** are valid picks a segment's
 * `model` can hold, reachable only via an explicit
 * `setSkidmarksSegmentModel` call — never auto-assigned and never
 * rotated into automatically — but, per Stuart's live-QA chrome lock,
 * there is **no model picker anywhere in the current UI** to make that
 * call from a tap; see `SkidmarksClipStub`'s doc comment for the
 * "optional tiny badge once a real still exists" plan this is waiting
 * on. Kling is gone outright (no subscription). SIRAY is *not* in this
 * list — see `SKIDMARKS_UNCENSORED_STILLS_LABEL` below for why it still
 * exists in the data layer, just nowhere near this one.
 *
 * **Where the actual cost lives, per Stuart**: a real plate *still*
 * (one static frame) is cheap — this lock isn't about stills. A real
 * *video render/animate* pass is the expensive part. The whole-song
 * stub "Generate Clips" button (see `SkidmarksClipTimeline`'s doc
 * comment) and Seedance's multi-angle clip generation specifically both
 * still stay unwired in this build. **This `model` tag is not what the
 * new one-clip-at-a-time real video render reads, though** — see
 * `components/SkidmarksClipRender.tsx` and
 * `app/api/skidmarks/generate-clip/route.ts` — that path always calls
 * xAI's Grok Imagine *video* API regardless of whether a clip is tagged
 * LTX/Grok/H3/Seedance, the same way `lib/plateGeneration.ts`'s real
 * *still* generation already ignores this tag for which API to call
 * (see `routingFramingHint`) — this field only ever steers prompt
 * phrasing for either real generator, never which backend answers. */
export type SkidmarksModelId = "ltx-lipsync" | "grok" | "h3" | "seedance";

export interface SkidmarksModelMeta {
  id: SkidmarksModelId;
  label: string;
  badge: string;
  /** Short caption — only set for a model that's a valid pick but
   * never auto-assigned. Not rendered anywhere today (no model UI
   * exists), kept for whenever a badge/picker resurfaces. */
  note?: string;
}

export const SKIDMARKS_MODELS: SkidmarksModelMeta[] = [
  { id: "ltx-lipsync", label: "LTX Lip-sync", badge: "LTX" },
  { id: "grok", label: "Grok", badge: "Grok" },
  { id: "h3", label: "H3", badge: "H3", note: "Optional \u2014 never auto-assigned" },
  { id: "seedance", label: "Seedance", badge: "Seedance", note: "Optional \u00b7 multi-angle" },
];

/** SIRAY isn't gone from the app, it's just no longer a general clip
 * `model` — it's a single, narrowly-scoped opt-in per segment
 * (`uncensoredPlateStills` on `SkidmarksClipSegment`, toggled via
 * `setSkidmarksSegmentUncensoredPlateStills`): **uncensored plate stills
 * only**. It's never offered for animation, never used by the stub
 * "Generate Clips" button (that always reads a segment's `model`, which
 * can only ever be LTX/Grok/H3/Seedance — see `SkidmarksModelId`), and
 * never auto-assigned on a normal vocal/instrumental clip
 * (`defaultSegmentModel` doesn't know it exists). This toggle isn't
 * wired into the main clip UI at all in this pass — the data layer
 * keeps the capability so it's one setter call away from being
 * surfaced later, not a control today. Kling has no equivalent
 * carve-out — it's removed outright (no subscription). */
export const SKIDMARKS_UNCENSORED_STILLS_LABEL = "SIRAY \u2014 Uncensored plate stills";

/** The two real backends `app/api/skidmarks/generate-clip/route.ts`
 * calls for an **Instrumental/B-roll** clip's video render — kept as
 * its own narrow type, deliberately separate from `SkidmarksModelId`
 * (LTX/Grok/H3/Seedance): that field only ever steers *still*-
 * generation prompt phrasing (`lib/plateGeneration.ts`'s
 * `routingFramingHint`) and stays locked to auto-assigning LTX/Grok
 * only, never H3/Seedance — reusing it here to *also* mean "which
 * video backend a Render tap calls" would conflate two genuinely
 * different concerns and quietly change every fresh Instrumental
 * clip's still-image framing hint as a side effect of a video-backend
 * default. `undefined` on a segment means "no explicit pick yet" —
 * `resolveInstrumentalVideoModel` below is the one place that resolves
 * that into a real choice. Never read on a Vocal clip — that always
 * routes to Comfy Cloud LTX, unchanged, no switch. */
export type SkidmarksInstrumentalVideoModel = "h3" | "grok";

/** **Stuart lock (2026-09-13)**: MiniMax H3 (`MINIMAX_API_KEY`) is now
 * the *default* Instrumental/B-roll video-render backend — explicitly
 * requested "for this smoke," superseding (for video renders only) the
 * older "H3 is a selectable pill, never auto-assigned" cost lock
 * documented on `SkidmarksModelId` above (that lock is about the
 * *still-image* `model` tag, which stays untouched here — see
 * `SkidmarksInstrumentalVideoModel`'s own doc comment for why the two
 * are separate fields). Grok (`XAI_API_KEY`) stays fully wired and one
 * tap away — see `components/SkidmarksClipRender.tsx`'s H3/Grok
 * switch, added inside the existing two-tap Render confirm per
 * Stuart's own "no model pill farm" ask, never a persistent badge.
 * Falls back to `"h3"` for any stored value other than the literal
 * `"grok"` (covers `undefined`, a stale/invalid value from a hand-
 * edited session, and a fresh segment that's never had this field
 * touched at all). */
export function resolveInstrumentalVideoModel(
  value: SkidmarksInstrumentalVideoModel | string | null | undefined
): SkidmarksInstrumentalVideoModel {
  return value === "grok" ? "grok" : "h3";
}

export function skidmarksModelLabel(id: SkidmarksModelId): string {
  return SKIDMARKS_MODELS.find((m) => m.id === id)?.label ?? id;
}

export function skidmarksModelBadge(id: SkidmarksModelId): string {
  return SKIDMARKS_MODELS.find((m) => m.id === id)?.badge ?? id;
}

/** LTX is the only model in this lineup that actually does lip-sync.
 * Not surfaced anywhere in the UI right now — per Stuart's chrome lock
 * there's no model badge at all until a clip has a real still (see
 * `SkidmarksClipStub`'s doc comment) — but kept here so that badge can
 * reuse this check once it exists instead of re-deriving it. */
export function isLipSyncModel(id: SkidmarksModelId): boolean {
  return id === "ltx-lipsync";
}

/**
 * The one default-model rule this feature encodes — Stuart's cost lock:
 * **auto-assign only ever picks LTX or Grok**, nothing pricier, and
 * never rotates/cycles between models on its own (a rotation that could
 * later spend real credits against a model Stuart didn't explicitly
 * pick). Singing (verse/bridge, or either real path's Vocal) → **LTX
 * Lip-sync**; instrumental/lead/break (any path) → **Grok**, always. H3
 * and Seedance are real pills a segment's `model` can hold, but only
 * ever get there via an explicit tap (`setSkidmarksSegmentModel`) — this
 * function will never return either.
 */
export function defaultSegmentModel(label: SkidmarksSegmentLabel): SkidmarksModelId {
  return SKIDMARKS_SEGMENT_LABEL_META[label].vocal ? "ltx-lipsync" : "grok";
}

/** A studio session saved before this lock (or before Seedance/H3 were
 * ever reachable) may still have a segment's `model` tagged `"kling"`
 * or `"siray-uncensored"` (SIRAY used to be a normal clip model too,
 * before it got narrowed to `uncensoredPlateStills` only — see
 * `SKIDMARKS_UNCENSORED_STILLS_LABEL`), or, defensively, any other id
 * that's since been dropped from `SKIDMARKS_MODELS`. `normalizeState`
 * runs every rehydrated segment's `model` through this so a removed id
 * can't leak back into the UI — but a still-valid manual pick (Grok,
 * H3, Seedance, or LTX) always survives a reload untouched; this never
 * downgrades a deliberate choice back to the auto default. */
export function remapLegacySkidmarksModel(modelId: string, vocal: boolean): SkidmarksModelId {
  if (SKIDMARKS_MODELS.some((m) => m.id === modelId)) {
    return modelId as SkidmarksModelId;
  }
  return vocal ? "ltx-lipsync" : "grok";
}

/**
 * One clip/segment on the timeline: a time range, a label, a plain-
 * language `shotPrompt` ("what happens in this shot"), and a `model`
 * (see `defaultSegmentModel`), plus the narrow `uncensoredPlateStills`
 * opt-in (see `SKIDMARKS_UNCENSORED_STILLS_LABEL`). There is
 * deliberately **no** location/plate field — Stuart's live QA on an
 * earlier pass (a horizontal row of named location cards: Neon Stage,
 * Rainy Alley, Desert Highway...) rejected that outright as a picker he
 * never asked for, so the expanded panel (`SkidmarksClipStub`) shows a
 * plain empty-still placeholder per plate instead, with no location
 * concept behind it at all.
 * `model` starts **auto-assigned** (via `defaultSegmentModel`) — the
 * whole point of the default rule is that Stuart never has to think
 * about it before typing a shot prompt. Per Stuart's cost lock,
 * `defaultSegmentModel` only ever auto-assigns LTX or Grok — H3 and
 * Seedance only ever land on a segment via an explicit call to
 * `setSkidmarksSegmentModel` (there is no model pill in this UI to tap;
 * see `SkidmarksClipStub`'s doc comment), never automatically and never
 * by editing `shotPrompt` (that only ever updates the prompt text — see
 * `setSkidmarksSegmentShotPrompt`).
 *
 * **Multiple plates per clip** (added for the 40s-door problem — a
 * single Instrumental clip that needs a door plate, then a keyhole
 * plate, then a Jack-seated plate, without splitting the timeline row
 * itself into three separate time ranges): `plates` is a **horizontal
 * strip of independent still slots** on this one clip, sharing this one
 * `startSec`/`endSec`/`label`/`shotPrompt`. **Deliberately one shared
 * `shotPrompt` for the whole strip, not one per plate** — Stuart's ask
 * was the smallest control that still lets each plate show different
 * content: editing the shared prompt before tapping Generate on a given
 * plate is enough (each generated still already bakes in whatever the
 * prompt said *at generation time* — the prompt itself doesn't need to
 * be remembered per plate afterward), so a per-plate prompt field would
 * just be a second form control repeating the same idea. **Also the one
 * field `components/SkidmarksClipRender.tsx`'s real, opt-in clip-video
 * render reads for its motion prompt** — one more reason not to split it
 * per plate; the same shared text drives both the still-generation
 * "Generate" flow and the newer per-clip "Render"/"Animate" flow rather
 * than needing its own separate field. Always has at
 * least one slot (`buildBlankPlateSlot`) — a clip is never left with a
 * pate strip; see `addSkidmarksClipPlate`/`removeSkidmarksClipPlate` for
 * how the strip grows/shrinks and `MAX_PLATES_PER_CLIP` for its cap. */
export interface SkidmarksClipSegment {
  id: string;
  startSec: number;
  endSec: number;
  label: SkidmarksSegmentLabel;
  model: SkidmarksModelId;
  /** Plain-language "what happens in this shot" — the one control
   * surface on the expanded panel, alongside the plate strip.
   * Deliberately short (no lyric dumps, no long captions). Defaults to
   * `""`; **one shared value for every plate in `plates`**, never a
   * per-plate field — see this interface's doc comment for why. Does
   * **not** drive `model` — see `setSkidmarksSegmentShotPrompt`. */
  shotPrompt: string;
  /** Plain-language "what to keep out of this shot" — the counterpart
   * to `shotPrompt`, added 2026-09-16 (a pasted script that actually
   * specified negative prompts per part, which this feature had no
   * field to hold before, so they were silently dropped). Same "one
   * shared value for the whole plate strip" shape as `shotPrompt`, for
   * the same reason. Defaults to `""` — an unwritten negative prompt is
   * not an error, just nothing extra to avoid. Only ever reaches a real
   * model on a **Vocal/LTX** render (`lib/clipGeneration.ts`'s
   * `buildClipGenerationRequest`, merged onto the real negative-
   * conditioning channel `lib/comfyCloud.ts` already sends a locked
   * character's own cues on) — an Instrumental clip's Grok/H3 backends
   * have no negative-prompt parameter in this app at all, so this field
   * is stored and shown for an Instrumental clip but nothing sends it
   * anywhere; see that function's doc comment. */
  negativePrompt: string;
  /** SIRAY's narrow carve-out: **uncensored plate stills only** — never
   * read by anything animation-related (the stub "Generate Clips"
   * button only ever looks at `model`, which can't be SIRAY — see
   * `SKIDMARKS_UNCENSORED_STILLS_LABEL`) and never auto-assigned.
   * Defaults `false`; toggled via
   * `setSkidmarksSegmentUncensoredPlateStills`. Not wired into the main
   * clip UI in this pass — see that constant's doc comment. */
  uncensoredPlateStills: boolean;
  /** The horizontal strip of plate slots for this clip — see this
   * interface's doc comment. Always non-empty; a fresh clip starts with
   * exactly one blank slot (the single dashed placeholder Stuart's
   * already used to). */
  plates: SkidmarksClipPlateSlot[];
  /** Which single plate in `plates` the next Render uses (radio-style —
   * exactly one plate "selected" per clip, never all of them). `null`/
   * unset means "no explicit pick yet" — `resolveSelectedPlateId` below
   * is the one place that turns that into an actual plate id (falling
   * back to the first unrendered filled plate, or the first filled
   * plate) so the UI never has to special-case "nothing selected" on
   * its own. Set via `setSkidmarksSegmentSelectedPlate`, normally from
   * tapping a plate's own corner select control
   * (`components/SkidmarksClipStub.tsx`). */
  selectedPlateId?: string | null;
  /** Which real backend this clip's Render control calls when it's
   * Instrumental/B-roll — see `SkidmarksInstrumentalVideoModel`'s doc
   * comment for why this is its own field, separate from `model`.
   * `undefined` until Stuart explicitly taps the H3/Grok switch inside
   * the Render confirm, in which case `resolveInstrumentalVideoModel`
   * resolves the default (`"h3"`, per Stuart's 2026-09-13 lock). Never
   * read on a Vocal clip. Set via
   * `setSkidmarksSegmentInstrumentalVideoModel`. */
  instrumentalVideoModel?: SkidmarksInstrumentalVideoModel;
}

/** One slot in a clip's plate strip — either the empty dashed
 * placeholder (`still` unset) or a real still, once one exists. `id` is
 * stable across an upload/generate/replace/clear on that same slot (so
 * React keys and continuity/removal logic don't depend on array index),
 * but a `null` call to `setSkidmarksClipPlateStill` clears `still` back
 * to unset on the *same* slot rather than removing it — removing the
 * slot outright is the separate `removeSkidmarksClipPlate`. */
/**
 * Exactly what the last render of a plate sent to its engine — recorded
 * on the plate (text and URLs only, never image bytes) so a finished
 * clip can show "What was sent" after a refresh, and so fifty-six
 * renders can be compared: if `startImageUrl` is the same on all of
 * them, that is the bug, not the model (audit Part 4).
 */
export interface SkidmarksClipSentPayload {
  engine: "LTX" | "Grok" | "H3";
  /** The duration the engine was actually asked for, after clamping. */
  durationSec: number;
  /** The plate still's own URL at send time. */
  startImageUrl: string;
  /** Always `null` — this app never sends an end image. Stored so the
   * panel can say NONE from the record, not from an assumption. */
  endImageUrl: null;
  /** The full positive prompt after every app-written block. */
  prompt: string;
  /** Stuart's own text (shot + motion), for the two-colour split. */
  userText: string;
  /** The full negative prompt (engine default + Jack's cues), or "". */
  negativePrompt: string;
  /** Audio slice, Vocal only. */
  audioStartSec?: number;
  audioEndSec?: number;
  sentAt: number;
}

export interface SkidmarksClipPlateSlot {
  id: string;
  /** See `SkidmarksClipSentPayload`. Set right before each real render
   * call for this plate; survives refresh with the session. */
  lastSent?: SkidmarksClipSentPayload;
  /** The real still for this slot, once one exists — either a photo
   * Stuart uploaded or a real image `lib/plateGeneration.ts` generated
   * via xAI's Grok Imagine API (`app/api/skidmarks/generate-still/
   * route.ts`). `undefined` until then — `SkidmarksClipStub` renders
   * the dashed empty placeholder whenever this is unset. */
  still?: SkidmarksPlateStill;
  /** This plate's own stored camera-motion direction (e.g. "slow zoom
   * into keyhole, mild pulse on door cracks") — per-plate now that
   * Render animates one selected plate at a time instead of every plate
   * on the clip at once (see `resolveSelectedPlateId` and
   * `components/SkidmarksClipRender.tsx`'s doc comment). Distinct from
   * `SkidmarksClipSegment.shotPrompt`, which stays one shared field for
   * the whole strip (Stuart's chrome lock — no per-plate prompt field);
   * this is the one exception, added because motion direction, unlike
   * the visual description, genuinely differs plate to plate (a door
   * cracking open vs. a slow reveal through a keyhole). Defaults to
   * `""`/unset; blank keeps `lib/clipGeneration.ts`'s automatic
   * push-in/zoom behavior. */
  motionPrompt?: string;
}

/** One clip's real plate still. `dataUrl` is always a `data:` URL (an
 * uploaded photo goes through `readImageFileAsDataUrl`'s same
 * downscale-to-JPEG pass the band cover/avatar pickers already use; a
 * generated one is already returned as a `data:` URL by
 * `app/api/skidmarks/generate-still/route.ts`) — never a bare/temporary
 * remote URL, so it round-trips through `localStorage` and survives a
 * reload the same way a picked cover/avatar photo already does.
 * `source` is purely informational today (not rendered as a badge
 * anywhere — Stuart's chrome lock keeps this panel to the plate + prompt
 * only) but kept so a future tiny badge/label doesn't need a new field. */
export interface SkidmarksPlateStill {
  /** A real Vercel Blob `https://` URL as of 2026-09-14 (`lib/
   * plateStillBlob.ts`'s `uploadSkidmarksPlateStill`), not a base64
   * `data:` URL — a session with several real stills embedded inline
   * pushed the whole Neon PUT past Vercel's ~4.5MB Function-body cap and
   * stopped saving entirely (a bare `HTTP 413`). Every consumer that
   * needs real bytes (xAI/Siray/Comfy Cloud references, the archive zip)
   * resolves this via `lib/plateGeneration.ts`'s
   * `resolvePlateReferenceDataUrl`, which is a no-op for an
   * already-`data:` value — so a still saved *before* this fix (still a
   * literal `data:` URL sitting in an existing session) keeps working
   * unchanged, it just never gets re-inlined once regenerated/replaced. */
  dataUrl: string;
  /** `"chained"` (2026-09-14): auto-filled from the last frame of the
   * *previous* clip's finished render, extracted server-side
   * (`lib/serverVideoFrame.ts`) rather than something Stuart uploaded or
   * generated himself — Stuart's own ask, so cuts flow clip-to-clip
   * through a whole song instead of every clip starting from an
   * unrelated fresh still. Only ever auto-set onto a plate slot that was
   * still empty; never overwrites a still Stuart already has there. */
  source: "upload" | "generated" | "chained" | "library";
  createdAt: number;
  /** Whether *this* still is already known to feature a locked character
   * (Jack Ash today — `lib/plateGeneration.ts`'s `SKIDMARKS_CHARACTER_LOCKS`)
   * — the exact fact `buildPlateGenerationRequest` resolved as
   * `characterInFrame` when this still was generated. Only ever set on a
   * *generated* still (a fresh upload carries no such signal — nothing
   * here guesses whether an uploaded photo happens to show him); `true`
   * only when the still's own shot prompt actually named him, or the
   * plate it continued from was itself already `true`.
   *
   * **Why this exists**: an Instrumental/B-roll clip's "continue from
   * the plate before it" signal (`buildPlateGenerationRequest`'s
   * `continuityFeaturesLockedCharacter` param) must only carry Jack
   * Ash's identity reference + hallmark lock forward when the plate
   * being continued *from* actually featured him — not from *any*
   * continuity reference regardless of what it shows. A live-QA'd real
   * bug: the door \u2192 keyhole \u2192 Jack sequence's *keyhole* plate
   * (empty of people, prompt never names him) continued from the
   * *door* plate (also empty of people) via "Use last plate," and the
   * old, cruder "any continuity image at all" signal wrongly injected
   * Jack's silhouette/neon lips into that empty keyhole shot. Tracking
   * this per-still fact is what lets the chain tell "continuing a shot
   * that already had him" apart from "continuing a shot that never
   * did." */
  featuresLockedCharacter?: boolean;
}

/** Fallback total (3:30) used to seed segments before the browser's real
 * `<audio>` duration probe resolves — attach fires with `durationSec:
 * null`, and the probe usually resolves within a beat, so this is only
 * ever visible for a moment. See `setSkidmarksMp3Duration` below, which
 * rebuilds off the real duration the first time it resolves. */
const DEMO_SEGMENT_FALLBACK_DURATION_SEC = 210;

/**
 * Stuart's 2026-09-13 hard ask: ElevenLabs Scribe timing lands "mostly
 * right but sometimes 3-4 seconds off," so he wants to slip a clip's
 * start/end after transcription without re-running Scribe — see
 * `nudgeSkidmarksSegmentBoundary`/`nudgeSkidmarksSegmentStart`/
 * `nudgeSkidmarksSegmentEnd` below. Originally the fixed step size for
 * a compact −1s/+1s tap-stepper UI (`components
 * /SkidmarksClipTimingNudge.tsx`); that UI was replaced the same day
 * with `components/SkidmarksClipTimingHeaderEdit.tsx`'s double-tap-to-
 * type-a-time editing on Stuart's own "I hate seeing big buttons"
 * follow-up ask, which can send any delta, not just this one — this
 * constant now only survives as a representative "small nudge" value
 * in `lib/skidmarks.test.ts`. */
export const SEGMENT_NUDGE_STEP_SEC = 1;

/** Floor on how short a nudge is ever allowed to leave a clip — either
 * the one being nudged, or the neighbor whose shared cut point moves
 * with it (see `nudgeSkidmarksSegmentBoundary`'s doc comment). A manual,
 * deliberate tap gets a more conservative floor than
 * `lib/audioAnalysis.ts`'s `MIN_SEGMENT_SEC` (that one folds away
 * automatic-detector noise; this one just stops a real clip from being
 * nudged down to nothing). */
export const MIN_NUDGE_SEGMENT_SEC = 1;

/** Caps a clip's plate strip (`SkidmarksClipSegment.plates`) so "+"
 * can't grow it unbounded — without letting the horizontal scroll grow
 * without limit. Raised from 6 to 12 (2026-09-14, Stuart's own real
 * reason): a clip's real render length is `segment length ÷ plate
 * count` (see `lib/clipGeneration.ts`'s `computePlateDurationSec`/
 * `computeLtxPlateDurationSec`), and a Vocal/LTX render's identity
 * tends to drift after ~20s of continuous motion — more plates per clip
 * is how he keeps each individual render down near ~15s. LTX's own
 * product ceiling (`MAX_LTX_CLIP_DURATION_SEC`) was lowered to 15s on
 * 2026-09-15 for the same reason, so this now enforces itself rather
 * than relying only on plate count. `addSkidmarksClipPlate` no-ops past
 * this. */
export const MAX_PLATES_PER_CLIP = 12;

/** Mints one empty plate slot — the dashed placeholder a fresh clip (or
 * a fresh "+" tap) always starts a slot as. */
function buildBlankPlateSlot(): SkidmarksClipPlateSlot {
  return { id: generateId("plate") };
}

/**
 * Resolves which plate a clip's Render control actually animates —
 * pure, so the UI and any test can call it without touching the store.
 * Per Stuart's ask: "if nothing selected, select the first unrendered
 * filled plate by default (or first filled) — don't fail mysteriously."
 *
 * - An explicit `selectedPlateId` wins, as long as it still points at a
 *   *filled* plate on this clip (a plate that's since been cleared, or a
 *   stale id from a removed slot, doesn't count — falls through to the
 *   default below instead of resolving to nothing).
 * - Otherwise: the first filled plate that doesn't already have a
 *   persisted render (`renderedPlateIds`), so re-opening a clip after
 *   rendering its first plate naturally points Render at the *next*
 *   one to do, not back at something already finished.
 * - Otherwise (every filled plate already has a render, or
 *   `renderedPlateIds` is empty and this is the first pass): the first
 *   filled plate.
 * - `null` only when the clip has no filled plate at all yet — nothing
 *   for Render to animate.
 */
export function resolveSelectedPlateId(
  plates: SkidmarksClipPlateSlot[],
  selectedPlateId: string | null | undefined,
  renderedPlateIds: ReadonlySet<string>
): string | null {
  const filled = plates.filter((p) => !!p.still);
  if (filled.length === 0) return null;
  if (selectedPlateId && filled.some((p) => p.id === selectedPlateId)) return selectedPlateId;
  const firstUnrendered = filled.find((p) => !renderedPlateIds.has(p.id));
  return (firstUnrendered ?? filled[0]).id;
}

/** Shared segment builder — mints a fresh `SkidmarksClipSegment` with
 * every default field (`model`/`shotPrompt`/`uncensoredPlateStills`/a
 * single blank `plates` slot) set per the locked cost-lock rules, off
 * just a time range + label. Used by both `buildDemoSegments` (the seed
 * cadence) and `buildSegmentsFromVocalRanges` (real transcription/
 * heuristic output) so neither path can drift from the other's
 * defaults. */
function buildDefaultSegment(
  startSec: number,
  endSec: number,
  label: SkidmarksSegmentLabel
): SkidmarksClipSegment {
  return {
    id: generateId("segment"),
    startSec,
    endSec,
    label,
    model: defaultSegmentModel(label),
    shotPrompt: "",
    negativePrompt: "",
    uncensoredPlateStills: false,
    plates: [buildBlankPlateSlot()],
    selectedPlateId: null,
  };
}

/**
 * Deterministic verse/bridge/lead/instrumental cadence, scaled to
 * whatever total duration is passed in. **This is seed/demo structure,
 * not real lyrics timing or singing detection** — see the module doc
 * comment and the honesty note the timeline UI renders alongside it.
 * It exists so Stuart has an editable clip list to assign a shot prompt
 * to *today*, in the same shape a future real STT + singing-detect
 * pass can populate once that lands (see the README's "Skidmarks node"
 * section).
 */
export function buildDemoSegments(totalSec: number): SkidmarksClipSegment[] {
  const pattern: { label: SkidmarksSegmentLabel; frac: number }[] = [
    { label: "instrumental", frac: 0.1 },
    { label: "verse", frac: 0.25 },
    { label: "instrumental", frac: 0.1 },
    { label: "verse", frac: 0.2 },
    { label: "bridge", frac: 0.15 },
    { label: "lead", frac: 0.1 },
    { label: "verse", frac: 0.1 },
  ];
  let cursor = 0;
  return pattern.map((step, i) => {
    const startSec = cursor;
    const endSec = i === pattern.length - 1 ? totalSec : cursor + step.frac * totalSec;
    cursor = endSec;
    return buildDefaultSegment(startSec, endSec, step.label);
  });
}

/**
 * Product rule (all songs, all bands): a pasted script part's **title**
 * sets the clip label/engine when it already contains a type word.
 * Audio midpoint / transcription / energy must NOT override a title that
 * already names Vocal, Intro, Outro, Bridge, Lead, Break, Instrumental,
 * or Other Singer — that was why "Part 3 — Vocal" showed Instrumental.
 *
 * `null` means no type word → callers fall back to the song's real
 * segment covering this part's midpoint (`resolveScriptPartVocal`).
 */
export function scriptPartTitleKind(
  title: string
): "vocal" | "instrumental" | "other-singer" | null {
  const t = title.toLowerCase();
  if (/\bother\s+singer\b/.test(t)) return "other-singer";
  if (/\bvocal\b/.test(t)) return "vocal";
  if (/\b(intro|outro|bridge|lead|break|instrumental)\b/.test(t)) return "instrumental";
  return null;
}

/**
 * Title-first vocal resolution for pasted scripts. Title wins when it
 * carries a type word; otherwise the song's real segments at this part's
 * midpoint decide (same canonical `SKIDMARKS_SEGMENT_LABEL_META` fact as
 * before). Other-singer titles are **not** Vocal (Grok/H3) — identity
 * photo for that named member is the runner's job.
 */
export function resolveScriptPartVocal(
  part: { startSec: number; endSec: number; title?: string },
  realSegments: SkidmarksClipSegment[]
): boolean {
  const kind = scriptPartTitleKind(part.title ?? "");
  if (kind === "vocal") return true;
  if (kind === "instrumental" || kind === "other-singer") return false;
  const midpoint = (part.startSec + part.endSec) / 2;
  const covering = realSegments.find((s) => midpoint >= s.startSec && midpoint < s.endSec);
  if (!covering) return false;
  return SKIDMARKS_SEGMENT_LABEL_META[covering.label]?.vocal ?? false;
}

/**
 * Finds a previous script-timeline clip to re-attach onto a newly
 * parsed part when the script is re-pasted / rebuilt (fresh segment ids
 * otherwise orphan plate stills and finished videos).
 *
 * Match order (each previous segment used at most once):
 * 1. Exact `startSec` + `endSec`
 * 2. Exact `startSec` (end may have nudged)
 * 3. Same part index when the ranges overlap
 *
 * Live bug (2026-09-19): paste parts 7–25 after plating 1–6 reminted
 * every id; Generate plates then treated 1–6 as "missing" and overwrote
 * them. Time-range (or index) match is what keeps early plated ranges.
 */
export function findMatchingPreviousScriptSegment(
  previousSegments: SkidmarksClipSegment[],
  part: { startSec: number; endSec: number },
  partIndex: number,
  usedPreviousIds: ReadonlySet<string>
): SkidmarksClipSegment | undefined {
  const available = previousSegments.filter((s) => !usedPreviousIds.has(s.id));
  if (available.length === 0) return undefined;

  const exact = available.find(
    (s) => s.startSec === part.startSec && s.endSec === part.endSec
  );
  if (exact) return exact;

  const sameStart = available.find((s) => s.startSec === part.startSec);
  if (sameStart) return sameStart;

  const byIndex = previousSegments[partIndex];
  if (
    byIndex &&
    !usedPreviousIds.has(byIndex.id) &&
    Math.max(byIndex.startSec, part.startSec) < Math.min(byIndex.endSec, part.endSec)
  ) {
    return byIndex;
  }

  return undefined;
}

/**
 * Stuart's "paste a script, get a real clip timeline" automation
 * (2026-09-14, the "Liquid Horizon" 16-part black-and-white trippy
 * sequence) — turns `lib/scriptSequence.ts`'s parsed parts into real
 * clip segments, one per part, each spanning exactly that part's own
 * `[startSec, endSec)`. **This is the actual duration enforcement
 * Stuart asked for**: with exactly one plate per clip,
 * `lib/clipGeneration.ts`'s `computePlateDurationSec` (segment length
 * ÷ plate count, clamped into whichever backend's real duration range
 * applies) resolves to exactly that part's real span — a 15s-wide part
 * always renders at a real, backend-enforced 15s, never just a number
 * typed into the prompt text and hoped for.
 *
 * **Vocal vs. Instrumental, per part, off the real song** — see
 * `resolveScriptPartVocal`'s doc comment for why `realSegments` (the
 * song's own segments, captured *before* this run replaces them) is
 * what decides this, not a blanket assumption either way. A Vocal part
 * gets `label: "vocal"`/`model: "ltx-lipsync"`, matching every other
 * Vocal clip in this feature (Comfy Cloud LTX, no H3/Grok switch — that
 * field is only ever read on an Instrumental clip). An Instrumental
 * part gets Stuart's explicit "Grok for every instrumental in this
 * run" ask (`instrumentalVideoModel: "grok"`, never the app-wide H3
 * default).
 *
 * **Re-attach on remint (2026-09-19):** when `realSegments` already hold
 * plate stills / plate ids from an earlier script build (script grew,
 * Build timeline tapped again, etc.), match by time range (or overlapping
 * part index) and keep that clip's `id`, `plates` (stills, motion notes,
 * plate ids), and `selectedPlateId` so Generate plates does not treat
 * plated ranges as missing and so finished videos keyed by
 * `(segmentId, plateId)` still resolve. Brand-new parts (no match) still
 * mint fresh ids and a blank plate. Prompt / title-driven vocal routing
 * always come from the new part — never from the carried clip.
 *
 * Pure — builds segment objects only, no store write;
 * `setSkidmarksScriptSequence` below is the one that actually persists
 * the result.
 */
export function buildScriptSequenceSegments(
  parts: ScriptSequencePart[],
  realSegments: SkidmarksClipSegment[]
): SkidmarksClipSegment[] {
  const usedPreviousIds = new Set<string>();
  return parts.map((part, partIndex) => {
    const vocal = resolveScriptPartVocal(part, realSegments);
    const previous = findMatchingPreviousScriptSegment(
      realSegments,
      part,
      partIndex,
      usedPreviousIds
    );
    if (previous) usedPreviousIds.add(previous.id);

    const plates =
      previous && previous.plates.length > 0
        ? previous.plates.map((plate) => ({ ...plate }))
        : [buildBlankPlateSlot()];

    return {
      id: previous?.id ?? generateId("segment"),
      startSec: part.startSec,
      endSec: part.endSec,
      label: vocal ? "vocal" : "instrumental",
      model: vocal ? "ltx-lipsync" : "grok",
      shotPrompt: part.prompt,
      negativePrompt: part.negativePrompt ?? "",
      uncensoredPlateStills: previous?.uncensoredPlateStills ?? false,
      plates,
      selectedPlateId: previous?.selectedPlateId ?? null,
      ...(vocal
        ? {}
        : {
            instrumentalVideoModel:
              previous?.instrumentalVideoModel ?? ("grok" as const),
          }),
    };
  });
}

/**
 * Replaces the active session's whole clip timeline with a script
 * sequence's segments — a deliberate wholesale swap, not a merge, since
 * a pasted script describes a complete, from-scratch timeline (Stuart's
 * "Stu Balls" test band, not tied to any song's real vocal timing). A
 * no-op if no MP3 is attached yet — this only replaces an existing
 * `segments` array, it never invents an `mp3` to hold one; the caller
 * (`components/SkidmarksScriptSequencePanel.tsx`) tells Stuart plainly
 * to attach something first if this returns having done nothing.
 * `segmentsSource: "seed-fallback"` is the closest honest fit among the
 * existing values — a script sequence is neither a real transcription
 * nor the energy heuristic, so it must never claim to be either.
 */
export function setSkidmarksScriptSequence(segments: SkidmarksClipSegment[]): void {
  const current = getSkidmarksSnapshot();
  if (!current.session.mp3) return;
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: { ...current.session.mp3, segments, segmentsSource: "seed-fallback" },
    },
  });
}

/** Writes the script-sequence panel's own draft input (pasted text +
 * clip 1's starting image URL) — see `SkidmarksScriptSequenceDraft`'s
 * doc comment for why this exists at all (a real reported gap,
 * 2026-09-14: backgrounding the phone before tapping Generate used to
 * lose both). `null` clears it (used once a run actually starts, so a
 * later different script never silently inherits a stale starting
 * image — see `SkidmarksScriptSequencePanel.tsx`'s `handleRun`). */
export function setSkidmarksScriptSequenceDraft(draft: SkidmarksScriptSequenceDraft | null): void {
  const current = getSkidmarksSnapshot();
  persist({ ...current, session: { ...current.session, scriptSequenceDraft: draft } });
}

/**
 * Where the current `segments` list actually came from, in priority
 * order (a lower-ranked source can never overwrite a higher one once
 * it's landed — see `applySkidmarksAnalysisResult`):
 * - `transcription` — real output of `transcribeAudio` +
 *   `segmentsFromWords` (`lib/transcription.ts`): actual word timestamps
 *   (ElevenLabs Scribe only — see
 *   `app/api/skidmarks/transcribe/route.ts`) merged into vocal/
 *   instrumental runs, via `applySkidmarksTranscriptionResult` — but
 *   only once that merged map clears `hasUsefulVocalCoverage`. The only
 *   source real enough to turn the Lyrics chip green.
 * - `analysis` — real output of `analyzeVocalActivity`
 *   (`lib/audioAnalysis.ts`'s energy heuristic), mapped through
 *   `applySkidmarksAnalysisResult`. Real signal, but not transcribed
 *   lyrics timing — shown while transcription is unavailable, still
 *   sparse, or after it fails.
 * - `seed-fallback` — `buildDemoSegments`' deterministic cadence, shown
 *   while both real sources are still resolving or after both failed.
 *   Always paired with an honest caption in `SkidmarksClipTimeline` —
 *   never presented as if it were the real thing.
 */
export type SkidmarksSegmentsSource = "transcription" | "analysis" | "seed-fallback";

/**
 * Real transcription lifecycle for the attached file — mirrors
 * `SkidmarksAnalysisStatus` but for `lib/transcription.ts`'s
 * `transcribeAudio` call, which runs in parallel with (not instead of)
 * the energy heuristic:
 * - `checking` — the request to `app/api/skidmarks/transcribe` is in
 *   flight (or, after a page reload with no file to resume, about to be
 *   normalized to `failed`).
 * - `unconfigured` — the server has neither `ELEVENLABS_API_KEY` nor
 *   `ELEVEN_LABS_API_KEY` set. A distinct, expected outcome, not an error —
 *   never surfaced as a failure.
 * - `done` — it finished *and* produced a usable word timing map
 *   (`hasUsefulVocalCoverage` cleared its bar) — `segmentsSource ===
 *   "transcription"`.
 * - `sparse` — it finished, ElevenLabs Scribe returned a real,
 *   non-empty word list, but the resulting vocal/instrumental map came
 *   out with near-zero real singing coverage for this track
 *   (`hasUsefulVocalCoverage` in `lib/transcription.ts` said no) — not
 *   trusted enough to show or to turn the Lyrics chip green.
 *   `transcriptionError` explains why in plain language. This is the
 *   honest outcome for the live bug this status was originally added
 *   for: a real STT provider returning real words for "Talking To
 *   Concrete" that still merged into a single Instrumental segment
 *   covering the whole track — a `"done"` status back then couldn't
 *   distinguish "produced a real map" from "technically responded",
 *   which is exactly how that got shown as green Lyrics.
 * - `failed` — the Scribe request itself errored (network, bad audio,
 *   an ElevenLabs API error, or an outright rejection like an auth/
 *   permission error) after a key *was* configured; `transcriptionError`
 *   names the real reason (never a silent fallback to another
 *   provider — there isn't one).
 */
export type SkidmarksTranscriptionStatus =
  | "checking"
  | "unconfigured"
  | "done"
  | "sparse"
  | "failed";

/**
 * Real analysis lifecycle for the attached file:
 * - `analyzing` — `analyzeVocalActivity` is running (or, after a page
 *   reload with no file to resume, about to be normalized to `failed`).
 * - `done` — it finished; `segments`/`segmentsSource` reflect its output.
 * - `failed` — it errored or timed out; `segments` is the seed fallback
 *   and `analysisError` (if present) says why.
 */
export type SkidmarksAnalysisStatus = "analyzing" | "done" | "failed";

export interface SkidmarksMp3Attachment {
  fileName: string;
  /** Real duration (seconds) once probed from the picked file; null while probing or if probing failed. */
  durationSec: number | null;
  attachedAt: number;
  /** Stable identity for *this* attach, minted once in
   * `createMp3Attachment` and never reused (a re-attach, even of the
   * exact same file, always mints a fresh one via `attachSkidmarksMp3`
   * — see that function's doc comment). Every async "resolve" callback
   * this attach kicks off (`applySkidmarksAnalysisResult`,
   * `applySkidmarksTranscriptionResult`, `setSkidmarksMp3AudioUrl`, the
   * `mark*Failed`/`mark*Unconfigured` siblings) takes this id and
   * no-ops unless it still matches `session.mp3.attachId` — a durable,
   * store-level guard against a slow real API call (a multi-minute
   * song's transcription can take a while) landing on a *different*
   * attach that's since replaced it, which a purely component-`useRef`
   * generation counter (`useSkidmarksStudio`'s old `analysisTokenRef`)
   * can't guarantee: that ref lives on the `SkidmarksDetailSheet`
   * component instance, which fully unmounts whenever the sheet closes
   * (`GraphView`'s `{openNode && ... && <SkidmarksDetailSheet />}`) —
   * a still-in-flight promise from *before* that unmount keeps running
   * and, on resolve, checks itself against its own now-orphaned ref
   * object (never invalidated by the unmount), so it can still land
   * squarely on whatever's live after a reopen. Backfilled by
   * `normalizeState` for a session saved before this field existed. */
  attachId: string;
  /** The clip/segment timeline. Real word-timing-derived vocal/
   * instrumental regions once `segmentsSource === "transcription"`,
   * real energy-heuristic ones once `segmentsSource === "analysis"`, or
   * the honestly-labeled seed cadence (`buildDemoSegments`) otherwise. */
  segments: SkidmarksClipSegment[];
  segmentsSource: SkidmarksSegmentsSource;
  analysisStatus: SkidmarksAnalysisStatus;
  /** Human-readable reason the energy heuristic fell back to the seed
   * cadence — only set when `analysisStatus === "failed"`. Surfaced
   * verbatim in the timeline's honesty caption, not swallowed. */
  analysisError?: string;
  /** Real per-word start/end times from `transcribeAudio`
   * (`lib/transcription.ts`), once a provider responds — kept even for
   * a `"sparse"` result (real words did land, just not enough of them
   * mapped to singing to trust the derived map) so a later lyric-
   * emphasis pass (per-word highlight during playback) can use them
   * without re-transcribing. `undefined` until/unless some provider
   * actually responds. */
  words?: SkidmarksTranscribedWord[];
  transcriptionStatus: SkidmarksTranscriptionStatus;
  /** Which backend produced `words`/`segments` (when `segmentsSource
   * === "transcription"`) or the sparse result (when `transcriptionStatus
   * === "sparse"`) — always `"elevenlabs"` on a real response today
   * (OpenAI Whisper was removed entirely, see
   * `app/api/skidmarks/transcribe/route.ts`'s doc comment). `undefined`
   * while unresolved, unconfigured, or after an outright request
   * failure. Surfaced in the timeline's caption so it names the real
   * backend instead of hardcoding one, and so this field doesn't need
   * to change if a provider is ever reintroduced. */
  transcriptionProvider?: SkidmarksTranscriptionProvider;
  /** Human-readable reason a *configured* transcription request failed
   * (network/upstream error), or — for `transcriptionStatus === "sparse"`
   * — a plain-language explanation of how little vocal coverage the
   * merged map actually had. Not set for the honest `"unconfigured"`
   * case, which isn't a failure. Surfaced verbatim in the timeline's
   * honesty caption. */
  transcriptionError?: string;
  /** A durable Vercel Blob URL for the attached MP3's own audio bytes,
   * once uploaded — the fix for "play survives a refresh": the raw
   * picked `File` never persists (see this module's doc comment and
   * `SkidmarksMp3Card`), so before this field existed, a reload always
   * lost real playback even though every other bit of session state
   * survived. `useSkidmarksStudio.attachMp3` kicks off a real,
   * client-side-direct-to-Blob upload (`lib/mp3Blob.ts`, via
   * `@vercel/blob/client`'s `upload()` — bypasses this app's own
   * serverless function entirely, so there's no risk of hitting
   * Vercel's ~4.5MB function-body cap the way a normal API POST would
   * for a real song-length file) the moment a file's attached; this
   * field fills in once that upload resolves. `undefined` until then,
   * or if it never configures/succeeds — see `audioPersistStatus`. */
  audioUrl?: string;
  /** Real upload lifecycle for `audioUrl`, mirroring
   * `transcriptionStatus`'s honesty shape: `"uploading"` while in
   * flight, `"done"` once `audioUrl` is set, `"unconfigured"` when no
   * Blob store is connected here (expected, not an error), `"failed"`
   * for a genuine upload failure. Never blocks anything — the MP3 card
   * still plays fine from the local, in-tab object URL either way; this
   * only governs whether playback also survives a refresh. */
  audioPersistStatus?: "uploading" | "done" | "unconfigured" | "failed";
  audioPersistError?: string;
  /** `computeSkidmarksArchiveFingerprint(band, mp3)` of the exact
   * band+mp3 pair most recently saved to (or opened from) Finished
   * Songs. While the live pair still hashes to this value, nothing has
   * changed since that checkpoint — so New/switch-band/"Open in
   * editor" can clear the desk without uploading a duplicate row, and
   * a second tap of Archive can say so honestly instead of listing the
   * same song twice. Never blocks anything: a mismatch (or absence)
   * just means "archive it first." Excluded from its own hash. */
  lastArchivedFingerprint?: string;
}

/**
 * The script-sequence panel's own in-progress input — Stuart's real ask
 * (2026-09-14): pasting a long script and picking clip 1's starting
 * image, then backgrounding the phone or closing the tab before tapping
 * Generate, used to lose both outright (plain React `useState` inside
 * `SkidmarksScriptSequencePanel`, gone the moment the component
 * unmounted). Persisted through the same Neon-backed `session` this
 * whole store already uses for everything else durable — never
 * `localStorage` (see AGENTS.md's lock) — so a reload/reopen shows
 * exactly what he left there.
 */
export interface SkidmarksScriptSequenceDraft {
  /** Raw pasted text, exactly as typed — kept as-is even if it doesn't
   * parse cleanly yet, so a half-finished paste/edit survives too. */
  script: string;
  /** Clip 1's optional starting image, already uploaded to durable Blob
   * storage the moment it's picked (`uploadSkidmarksPlateStill`) —
   * never a raw `data:` URL sitting in this state: the same "big base64
   * blobs blow past Vercel's ~4.5MB session PUT body cap" reasoning as
   * every other big-media field in this store (see
   * `SkidmarksPlateStill.dataUrl`'s doc comment). `undefined` means no
   * starting image picked (or it was removed). */
  startingImageUrl?: string;
  /**
   * Script Sequence "Chain last→first" toggle (default off). When true,
   * Generate / Resume writes each render's server last frame onto the
   * next clip's starting plate (`source: "chained"`) if that plate is
   * empty or already chain-sourced — never clobbers upload / generated /
   * library. Persist so a reload keeps Stuart's continuity choice.
   */
  chainLastFrameToNext?: boolean;
}

/** The Music-video wizard's progress — which project type, which band,
 * and (once chosen) the attached MP3. `null` fields mean "not reached
 * that step yet", so the UI knows exactly how much to append. */
export interface SkidmarksSession {
  projectKind: SkidmarksProjectKind | null;
  bandId: string | null;
  mp3: SkidmarksMp3Attachment | null;
  /** See `SkidmarksScriptSequenceDraft`'s doc comment. Reset to `null`
   * whenever the active band/song context changes out from under it
   * (a band switch, a fresh "New" band, restoring/resetting after an
   * Archive) — a stale draft from a *different* song leaking into a
   * newly-selected one would be actively misleading, not just unused. */
  scriptSequenceDraft: SkidmarksScriptSequenceDraft | null;
}

export interface SkidmarksState {
  /** Seed bands + any "New" bands created this session, most-recent-first among the "New" ones. */
  bands: SkidmarksBand[];
  session: SkidmarksSession;
  /** Ids of hand-seeded `SEED_BANDS` entries Stuart has deleted — tracked
   * separately from `bands` (which only ever holds *live* bands) so a
   * seed band stays gone after a delete instead of being re-minted from
   * `SEED_BANDS` on the next `normalizeState` pass. */
  removedSeedBandIds: string[];
  /**
   * Sunny Banks live episode + named workspace cards. Same Neon session
   * row as music-video studio state — not a new episode/beat table, not
   * `localStorage`. Missing on sessions saved before this field existed
   * (`null`); the panel then opens on the EP02 seed. Scripts + clip
   * URLs only, never inline still bytes.
   */
  sunnyBanks: SkidmarksSunnyBanksState | null;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Hand-seeded album-cover bands for the "Choose a band" row — matches
 * the locked mockup's Jack Ash / Solar Rebel tiles exactly. */
const SEED_BANDS: SkidmarksBand[] = [
  {
    id: "jack-ash",
    name: "Jack Ash",
    tagline: "Dirt roads & bad decisions",
    coverSeed: 1,
    editIcon: "pencil",
    members: [
      {
        id: "jack-ash-frontman",
        name: "Jack Ash",
        role: "Frontman",
        emoji: "\u{1F3B8}",
        // Stuart's own reference photo for this locked character (noir
        // silhouette, fedora, glowing neon-blue lips — see
        // `lib/plateGeneration.ts`'s `SKIDMARKS_CHARACTER_LOCKS`) — seeded
        // here so a fresh session already has an identity reference to
        // pass into a generated Vocal still, without Stuart having to
        // upload it first. A real static asset (`public/skidmarks/
        // jack-ash-reference.jpg`), not a data URL, since it ships with
        // the app rather than being picked at runtime; still resolves to a
        // real `data:` URL before ever reaching xAI — see
        // `resolvePlateReferenceDataUrl`. Stuart can still replace it via
        // the existing avatar picker at any time, same as any other
        // member's `avatarImage`.
        avatarImage: "/skidmarks/jack-ash-reference.jpg",
        looks: [],
      },
    ],
  },
  {
    id: "solar-rebel",
    name: "Solar Rebel",
    tagline: "Ignite the static",
    coverSeed: 2,
    editIcon: "camera",
    members: [
      { id: "solar-rebel-vocals", name: "Nova", role: "Vocals", emoji: "\u{1F31F}", looks: [] },
    ],
  },
];

function emptyState(): SkidmarksState {
  return {
    bands: SEED_BANDS,
    session: { projectKind: null, bandId: null, mp3: null, scriptSequenceDraft: null },
    removedSeedBandIds: [],
    sunnyBanks: null,
  };
}

/**
 * A genuinely blank "New" band — no name, no tagline, no members.
 * Real bug (2026-09-14): this used to always mint the exact same
 * hand-filled demo band ("Grok Bot & the destroyers", a member called
 * "Rock Grok" already looked, another waiting) — matched an early
 * mockup, but in real use it meant tapping "New" never actually gave
 * Stuart a blank slate: every new band looked like a pre-filled old
 * project reappearing, because it always was the same one. Now "New"
 * really means new — Stuart types the band's name (via `onRenameBand`
 * in `SkidmarksMembersModule`) and adds members himself.
 */
export function buildBlankBand(): SkidmarksBand {
  const bandId = generateId("band");
  return {
    id: bandId,
    name: "",
    tagline: "",
    coverSeed: Date.now(),
    editIcon: "pencil",
    members: [],
  };
}

/** A freshly cast member — no name, role, or emoji until the user fills
 * them in (via the generate popup's name field) or generates a look.
 * "+ Add member" always mints one of these; nothing here invents a
 * persona (name, role, or icon) on the user's behalf. */
export function buildBlankMember(): SkidmarksMember {
  return {
    id: generateId("member"),
    name: "",
    emoji: "",
    looks: [],
  };
}

/** Pure builder: a prompt + photoreal % + the real generated image's URL
 * → a new "look". Real bug (2026-09-14): this used to be `buildMockLook`
 * and never took an image at all — the whole member-casting "Generate"
 * button just minted a color swatch, no actual xAI call, ever (see the
 * module doc comment). `imageUrl` is the real photo
 * `SkidmarksGeneratePopup`'s own async `handleGenerate` gets back from
 * `lib/plateGeneration.ts`'s `generatePlateStill` (via
 * `buildMemberLookRequest`), same real backend the plate-still generator
 * already uses — uploaded to Blob (`uploadSkidmarksMemberPhoto`) before
 * landing here, same as every other real generated/picked photo in this
 * feature. */
export function buildGeneratedLook(prompt: string, photoreal: number, imageUrl: string): SkidmarksLook {
  return {
    id: generateId("look"),
    seed: Math.floor(Math.random() * 1_000_000),
    prompt: prompt.trim(),
    photoreal,
    imageUrl,
    createdAt: Date.now(),
  };
}

/** Builds the just-attached state: seed-cadence segments as an
 * immediately-visible placeholder while `analyzeVocalActivity` (the
 * energy heuristic) and `transcribeAudio` (real STT) both run in the
 * background in parallel (`useSkidmarksStudio`'s `attachMp3`) — replaced
 * by real segments via `applySkidmarksTranscriptionResult` (preferred)
 * or `applySkidmarksAnalysisResult` once either finishes, or kept (now
 * honestly labeled) via `markSkidmarksTranscriptionUnconfigured`/
 * `markSkidmarksTranscriptionFailed`/`markSkidmarksAnalysisFailed` if
 * they don't produce anything usable. */
export function createMp3Attachment(
  fileName: string,
  durationSec: number | null
): SkidmarksMp3Attachment {
  return {
    fileName,
    durationSec,
    attachedAt: Date.now(),
    attachId: generateId("mp3"),
    segments: buildDemoSegments(durationSec ?? DEMO_SEGMENT_FALLBACK_DURATION_SEC),
    segmentsSource: "seed-fallback",
    analysisStatus: "analyzing",
    transcriptionStatus: "checking",
  };
}

/**
 * Cleans up one rehydrated segment from `localStorage` against the
 * current `SkidmarksClipSegment` shape:
 * - `model` — through `remapLegacySkidmarksModel`: a still-valid manual
 *   pick (LTX/Grok/H3/Seedance) survives a reload untouched; only a
 *   truly removed id (Kling, or SIRAY as a former clip model) falls
 *   back to the vocal/instrumental default. Never re-derives a model
 *   from anything else — a segment's `model` is either what Stuart
 *   picked or the cost-locked default, nothing in between.
 * - `shotPrompt`/`negativePrompt` — missing/non-string backfills to `""`.
 * - `uncensoredPlateStills` — missing/non-boolean backfills to `false`.
 *
 * Older stored fields this segment shape no longer has (a legacy
 * `cameraAngle`/`cameraAngleAuto`/`plateSubject` from an earlier pass,
 * or `plateId` from the deleted location-plate picker) are simply
 * dropped — this function builds a fresh object rather than spreading
 * `raw`, so they don't linger in the next `persist()` write.
 *
 * - `plates` — a session saved **before** the multi-plate strip shipped
 *   only ever had a single top-level `still` (optional). That single
 *   still (if any) migrates into a one-slot `plates` array
 *   (`normalizeLegacyStillToPlates`) rather than being dropped, so an
 *   already-generated/uploaded still survives this shape change. A
 *   session saved **after** the strip shipped has a real `plates` array
 *   already, which just gets each slot's `still` re-validated
 *   (`normalizeSkidmarksPlateSlot`) the same way the old single `still`
 *   always was. Either way this never leaves a clip with zero plates —
 *   an empty/missing `plates` array still backfills to one blank slot.
 */
/** Validates a rehydrated `still` — must be a real `data:` URL with a
 * recognized `source` and a numeric `createdAt`, else it's dropped
 * (`undefined`) rather than trusted as-is; a corrupt/partial value from a
 * future field rename or a hand-edited `localStorage` blob should never
 * render as a broken `<img>`. */
/** Real live bug (2026-09-14): this used to only accept a literal
 * `data:` URL — correct back when a still's `dataUrl` was always
 * embedded base64, but `lib/plateStillBlob.ts` now stores a real Vercel
 * Blob `https://` URL there instead (see `SkidmarksPlateStill.dataUrl`'s
 * own doc comment). Every still that went through that fix got silently
 * deleted right here, on the very next hydrate/normalize pass — this
 * was never a save-reliability problem at all; it was this one
 * validation gate rejecting the exact value the rest of the app had
 * already started writing. Now accepts `data:`, `https://`, `http://`,
 * or a root-relative `/...` asset path (the seeded Jack Ash reference
 * photo's own shape) — anything else (a stray `blob:` object URL, an
 * empty string, a missing field) is still dropped. Also now preserves
 * `featuresLockedCharacter` when it's exactly `true` — silently dropped
 * here before, which broke carrying a locked character's identity
 * forward through "Use last plate" continuity across a reload. */
function normalizeSkidmarksStill(value: unknown): SkidmarksPlateStill | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<SkidmarksPlateStill>;
  if (typeof v.dataUrl !== "string" || v.dataUrl.length === 0) return undefined;
  const hasKnownPrefix =
    v.dataUrl.startsWith("data:") ||
    v.dataUrl.startsWith("https://") ||
    v.dataUrl.startsWith("http://") ||
    v.dataUrl.startsWith("/");
  if (!hasKnownPrefix) return undefined;
  if (v.source !== "upload" && v.source !== "generated" && v.source !== "chained" && v.source !== "library") return undefined;
  if (typeof v.createdAt !== "number") return undefined;
  const still: SkidmarksPlateStill = { dataUrl: v.dataUrl, source: v.source, createdAt: v.createdAt };
  if (v.featuresLockedCharacter === true) still.featuresLockedCharacter = true;
  return still;
}

/** Validates one rehydrated plate slot — keeps its `id` if it's a real
 * non-empty string (so continuity/removal logic keyed off `id` survives
 * a reload), mints a fresh one otherwise, and re-validates `still` the
 * same way a top-level still always was. */
function normalizeSkidmarksPlateSlot(value: unknown): SkidmarksClipPlateSlot {
  const v = (value && typeof value === "object" ? value : {}) as Partial<SkidmarksClipPlateSlot>;
  const id = typeof v.id === "string" && v.id.length > 0 ? v.id : generateId("plate");
  const still = normalizeSkidmarksStill(v.still);
  const motionPrompt = typeof v.motionPrompt === "string" && v.motionPrompt.length > 0 ? v.motionPrompt : undefined;
  const slot: SkidmarksClipPlateSlot = { id };
  if (still) slot.still = still;
  if (motionPrompt) slot.motionPrompt = motionPrompt;
  return slot;
}

/** Migration path for a pre-multi-plate session: its one top-level
 * `still` (if any) becomes the lone slot in a fresh `plates` array,
 * rather than being silently dropped when the shape changed. */
function normalizeLegacyStillToPlates(rawStill: unknown): SkidmarksClipPlateSlot[] {
  const still = normalizeSkidmarksStill(rawStill);
  return [still ? { id: generateId("plate"), still } : buildBlankPlateSlot()];
}

export function normalizeSkidmarksSegment(raw: SkidmarksClipSegment): SkidmarksClipSegment {
  const r = raw as Partial<SkidmarksClipSegment> & Record<string, unknown>;
  const vocal = SKIDMARKS_SEGMENT_LABEL_META[raw.label]?.vocal ?? false;
  const shotPrompt = typeof r.shotPrompt === "string" ? r.shotPrompt : "";
  // Missing on any session saved before 2026-09-16 (the field didn't
  // exist yet) — backfills to "" same as `shotPrompt` always has, not
  // an error state.
  const negativePrompt = typeof r.negativePrompt === "string" ? r.negativePrompt : "";
  const uncensoredPlateStills = typeof r.uncensoredPlateStills === "boolean" ? r.uncensoredPlateStills : false;
  const rawPlates = Array.isArray(r.plates) ? r.plates : undefined;
  const plates =
    rawPlates && rawPlates.length > 0
      ? rawPlates.map(normalizeSkidmarksPlateSlot)
      : normalizeLegacyStillToPlates(r.still);
  // A stale/removed-slot `selectedPlateId` isn't corrected here — that's
  // `resolveSelectedPlateId`'s job at read time (it already falls
  // through to the default whenever the stored id doesn't point at a
  // currently-filled plate) — this just backfills the field's presence/
  // type so a pre-this-feature session (no field at all) and a
  // hand-edited `localStorage` blob (wrong type) both normalize to a
  // clean `null` instead of `undefined` leaking through inconsistently.
  const selectedPlateId = typeof r.selectedPlateId === "string" ? r.selectedPlateId : null;
  // A stored `"h3"`/`"grok"` survives a reload untouched; anything else
  // (never set, a stale/invalid value) is dropped back to `undefined`
  // — `resolveInstrumentalVideoModel` is what turns that into the real
  // `"h3"` default at read time, same "normalize the type/presence
  // here, resolve the honest fallback there" split `selectedPlateId`
  // already uses above.
  const instrumentalVideoModel: SkidmarksInstrumentalVideoModel | undefined =
    r.instrumentalVideoModel === "h3" || r.instrumentalVideoModel === "grok" ? r.instrumentalVideoModel : undefined;
  return {
    id: raw.id,
    startSec: raw.startSec,
    endSec: raw.endSec,
    label: raw.label,
    model: remapLegacySkidmarksModel(String(raw.model), vocal),
    shotPrompt,
    negativePrompt,
    uncensoredPlateStills,
    plates,
    selectedPlateId,
    instrumentalVideoModel,
  };
}

function normalizeState(parsed: unknown): SkidmarksState {
  const p = (parsed ?? {}) as Partial<SkidmarksState>;
  const removedSeedBandIds = Array.isArray(p.removedSeedBandIds)
    ? p.removedSeedBandIds.filter((id): id is string => typeof id === "string")
    : [];
  const removedSeedSet = new Set(removedSeedBandIds);
  const seedIds = new Set(SEED_BANDS.map((b) => b.id));
  const storedBands = Array.isArray(p.bands) ? (p.bands as SkidmarksBand[]) : [];
  const extraBands = storedBands.filter((b) => b && !seedIds.has(b.id));
  const bandsRaw = [
    ...SEED_BANDS.filter((seed) => !removedSeedSet.has(seed.id)).map(
      (seed) => storedBands.find((b) => b?.id === seed.id) ?? seed
    ),
    ...extraBands,
  ];
  const bands = bandsRaw.map((band) => {
    if (!band || !Array.isArray(band.members)) return band;
    const members = band.members.map((member) => {
      if (!member || typeof member !== "object") return member;
      const m = member as SkidmarksMember;
      if (m.stillSleeve === undefined) return m;
      const stillSleeve = normalizeMemberStillSleeve(m.stillSleeve);
      if (!stillSleeve) {
        const { stillSleeve: _drop, ...rest } = m;
        return rest;
      }
      return { ...m, stillSleeve };
    });
    return { ...band, members };
  });
  const session: Partial<SkidmarksSession> = p.session ?? {};
  const bandId = typeof session.bandId === "string" ? session.bandId : null;
  const stillHasBand = bandId !== null && bands.some((b) => b.id === bandId);

  // Sessions saved before this field existed (or a value that doesn't
  // even look like the real shape) just get `null` — no dishonest
  // "recovering" a draft that was never really there.
  const storedDraft = session.scriptSequenceDraft as Partial<SkidmarksScriptSequenceDraft> | null | undefined;
  const scriptSequenceDraft: SkidmarksScriptSequenceDraft | null =
    storedDraft && typeof storedDraft.script === "string"
      ? {
          script: storedDraft.script,
          ...(typeof storedDraft.startingImageUrl === "string" ? { startingImageUrl: storedDraft.startingImageUrl } : {}),
          ...(storedDraft.chainLastFrameToNext === true ? { chainLastFrameToNext: true } : {}),
        }
      : null;

  const storedMp3 = (session.mp3 as SkidmarksMp3Attachment | null | undefined) ?? null;
  // Sessions saved before the clip-timeline feature shipped won't have
  // `segments` yet — backfill once, off whatever duration is already known.
  const hasSegments = !!storedMp3 && Array.isArray(storedMp3.segments);
  // Every rehydrated segment also runs through `normalizeSkidmarksSegment`
  // — cleans up a legacy `model` (a removed Kling/former-SIRAY id remaps
  // to the vocal/instrumental default; a still-valid LTX/Grok/H3/Seedance
  // pick survives untouched), backfills any field that didn't exist yet
  // when this session was saved (`shotPrompt`, `uncensoredPlateStills`),
  // and drops any now-removed field (e.g. a legacy `plateId` from the
  // deleted location-plate picker).
  const segments = storedMp3
    ? (hasSegments
        ? storedMp3.segments
        : buildDemoSegments(storedMp3.durationSec ?? DEMO_SEGMENT_FALLBACK_DURATION_SEC)
      ).map(normalizeSkidmarksSegment)
    : [];
  const segmentsSource: SkidmarksSegmentsSource =
    storedMp3?.segmentsSource === "transcription"
      ? "transcription"
      : storedMp3?.segmentsSource === "analysis"
        ? "analysis"
        : "seed-fallback";
  // A page reload drops the attached `File` (never persisted — see
  // `SkidmarksMp3Card`), so an analysis that was still `"analyzing"` when
  // the page closed can never resume; normalize it to an honest `"failed"`
  // instead of leaving the chip stuck showing "in progress" forever.
  // Sessions from before this feature shipped (no `analysisStatus` at
  // all) get the same honest treatment.
  const wasInterrupted =
    storedMp3?.analysisStatus !== "done" && storedMp3?.analysisStatus !== "failed";
  const analysisStatus: SkidmarksAnalysisStatus = wasInterrupted ? "failed" : storedMp3!.analysisStatus;
  const analysisError = wasInterrupted
    ? "Analysis doesn't survive a page reload (the audio file itself isn't kept) \u2014 re-attach the MP3 to re-run it."
    : storedMp3?.analysisError;

  // Same "can't resume after a reload" logic for the transcription
  // request — `"checking"` (in flight when the tab closed) is the only
  // status that needs normalizing to a real failure; `"done"`,
  // `"unconfigured"`, and `"failed"` are all settled outcomes that
  // survive as-is. Sessions saved before this feature shipped (no
  // `transcriptionStatus` at all) get treated as `"unconfigured"`
  // instead — honest ("we don't know a real attempt happened here"),
  // without fabricating a reload-interruption story that never occurred.
  const wasTranscriptionInterrupted = storedMp3?.transcriptionStatus === "checking";
  const hasTranscriptionStatus =
    !!storedMp3 &&
    (storedMp3.transcriptionStatus === "done" ||
      storedMp3.transcriptionStatus === "sparse" ||
      storedMp3.transcriptionStatus === "unconfigured" ||
      storedMp3.transcriptionStatus === "failed" ||
      storedMp3.transcriptionStatus === "checking");
  const transcriptionStatus: SkidmarksTranscriptionStatus = wasTranscriptionInterrupted
    ? "failed"
    : hasTranscriptionStatus
      ? storedMp3!.transcriptionStatus
      : "unconfigured";
  const transcriptionError = wasTranscriptionInterrupted
    ? "Transcription doesn't survive a page reload (the audio file itself isn't kept) \u2014 re-attach the MP3 to re-run it."
    : hasTranscriptionStatus
      ? storedMp3?.transcriptionError
      : undefined;
  const transcriptionProvider = hasTranscriptionStatus ? storedMp3?.transcriptionProvider : undefined;

  // Same "can't resume after a reload" logic as analysis/transcription:
  // an audio upload that was still `"uploading"` when the tab closed
  // can't be resumed (the raw `File` never persists either), so it
  // normalizes to an honest `"failed"` rather than hanging forever. A
  // session saved before this field existed just has no status at all
  // (`undefined`), which is fine as-is — there's nothing dishonest about
  // "never attempted."
  const audioPersistStatus =
    storedMp3?.audioPersistStatus === "uploading" ? "failed" : storedMp3?.audioPersistStatus;
  const audioPersistError =
    storedMp3?.audioPersistStatus === "uploading"
      ? "Audio upload doesn't survive a page reload (the audio file itself isn't kept) \u2014 re-attach the MP3 to re-try it."
      : storedMp3?.audioPersistError;

  // A session saved before `attachId` existed has no way to tell "this
  // rehydrated mp3" apart from "a slow resolve callback for whatever was
  // live before the reload" — backfill a fresh one on load so every
  // `apply*Result`/`mark*Failed` guard below has something real to check
  // against going forward (a stale pre-reload promise can't survive a
  // full page reload anyway, since its whole JS closure is gone with it).
  const attachId = typeof storedMp3?.attachId === "string" && storedMp3.attachId.length > 0
    ? storedMp3.attachId
    : generateId("mp3");

  const mp3: SkidmarksMp3Attachment | null = storedMp3
    ? {
        ...storedMp3,
        attachId,
        segments,
        segmentsSource,
        analysisStatus,
        analysisError,
        transcriptionStatus,
        transcriptionError,
        transcriptionProvider,
        audioPersistStatus,
        audioPersistError,
      }
    : null;

  return {
    bands,
    removedSeedBandIds,
    session: {
      projectKind:
        typeof session.projectKind === "string"
          ? (session.projectKind as SkidmarksProjectKind)
          : null,
      bandId: stillHasBand ? bandId : null,
      mp3: stillHasBand ? mp3 : null,
      scriptSequenceDraft: stillHasBand ? scriptSequenceDraft : null,
    },
    sunnyBanks: normalizeSunnyBanksStudio(p.sunnyBanks),
  };
}

/* --------------------------------------------------------------------
 * Neon-backed session persistence
 *
 * Replaces the old synchronous `localStorage.setItem`/`getItem` mirror
 * outright (see this module's doc comment and AGENTS.md's "no
 * localStorage for state of record" lock) with a real durable Neon row
 * (`lib/skidmarksSession-server.ts`, via `GET`/`PUT /api/skidmarks/
 * session`), while keeping `cachedState` as the synchronous in-memory
 * value every mutator below still reads/writes through `persist()`/
 * `getSkidmarksSnapshot()` — `useSyncExternalStore` needs a synchronous
 * `getSnapshot`, and a network round trip can never be that, so the
 * *shape* of this store doesn't change, only what backs it durably.
 *
 * Two independent async flows, each with its own non-clobber guard —
 * per AGENTS.md's "strengthen, don't break, the #51 attachId/
 * hasSkidmarksUserContent guards" note, both guards below are the same
 * *kind* of fix at a different layer, not a replacement for either:
 *
 * 1. **Hydrate** (`hydrateSkidmarksSessionOnce`) — one `GET` per page
 *    load, triggered off the store's very first subscriber (mirrors the
 *    old `storage`-event listener's "first real listener wires up the
 *    real side-effect" shape). Guarded by
 *    `shouldApplyHydratedSkidmarksSession`: if Stuart already tapped
 *    something (any `persist()`) while this load was still in flight,
 *    the fetched snapshot is discarded rather than silently overwriting
 *    whatever he just started on top of the honest empty state this
 *    module boots with — the server-backed successor to the same
 *    "a slow real result can't clobber real work already in progress"
 *    principle `SkidmarksMp3Attachment.attachId`/
 *    `hasSkidmarksUserContent` already enforce one layer down, at the
 *    mp3/segment level. This module's version protects the *whole*
 *    session (bands/project kind/band selection, not just mp3/segment
 *    fields) against the one new race this migration itself introduces
 *    — an async load existing at all, where before there was none.
 * 2. **Push** (`schedulePush`/`pushSkidmarksSessionNow`) — every
 *    `persist()` schedules a short debounced `PUT` of the *entire*
 *    current `cachedState`; serialized (never two requests in flight at
 *    once — a second `persist()` mid-request just marks one more push
 *    queued, re-run against `cachedState` fresh once the first
 *    completes) so two overlapping saves can never land out of order
 *    and leave a stale write as Neon's final answer. `flushSkidmarksSessionNow`
 *    (wired to `visibilitychange`/`pagehide`) bypasses the debounce so a
 *    final edit made right before Stuart backgrounds/closes Safari on
 *    his phone still ships — iOS aggressively suspends a backgrounded
 *    tab, so a plain debounce timer alone can't be trusted to ever fire.
 *
 * `getSkidmarksSessionSyncSnapshot`/`subscribeSkidmarksSessionSync`
 * expose the live, *ephemeral* status of this round trip (never
 * persisted, never part of `SkidmarksState` itself) so the UI can show
 * an honest "not saving right now" — `unconfigured` (no `DATABASE_URL`
 * here, an expected outcome, not a bug) reads distinctly from `error`
 * (a real save/load failure), same "distinguishable outcomes, not one
 * flat message" shape `lib/skidmarksSession-server.ts`'s own
 * `SaveSkidmarksSessionOutcome` already uses server-side.
 * -------------------------------------------------------------------- */

const SESSION_ENDPOINT = "/api/skidmarks/session";
/** How long a burst of rapid edits (typing in the shot-prompt textarea,
 * dragging through a few plate taps) waits before actually pushing to
 * Neon — short enough that a genuine pause (switching fields, closing
 * the sheet) always flushes promptly, long enough that a fast typist
 * doesn't fire one request per keystroke. Not the real safety net for
 * "Stuart closes the tab mid-debounce" — `flushSkidmarksSessionNow`
 * (below, wired to `visibilitychange`/`pagehide`) is. */
const SESSION_PUSH_DEBOUNCE_MS = 600;

/** How often to quietly retry a real, still-failed save with nothing
 * else prompting it (no new edit, no `online` event) — see
 * `ensureSessionPersistenceWired`'s "keep retrying" doc comment. Slow
 * enough not to hammer a connection that's genuinely, persistently
 * down; frequent enough that a phone locked overnight with an
 * intermittent connection still ends up saved well before morning. */
const SESSION_UNSYNCED_RETRY_INTERVAL_MS = 60_000;

export type SkidmarksSessionSyncStatus = "loading" | "synced" | "saving" | "unconfigured" | "error" | "conflict";

/** Live, ephemeral status of the Neon round trip — see this section's
 * doc comment. Never persisted, never sent to or read from the server
 * itself; purely for an honest UI indicator. */
export interface SkidmarksSessionSyncState {
  status: SkidmarksSessionSyncStatus;
  /** Set for `"unconfigured"` and `"error"` — the real server-side
   * message either way, shown verbatim rather than paraphrased. */
  error?: string;
  /** Wall-clock time of the most recent successful push, if any —
   * purely informational. */
  lastSavedAt?: number;
  /** `"conflict"` only — when the copy this device is refusing to
   * overwrite was last saved, so the UI can say *which* copy is newer
   * rather than just "something went wrong". */
  remoteSavedAt?: number;
}

let sessionSync: SkidmarksSessionSyncState = { status: "loading" };
const sessionSyncListeners = new Set<() => void>();

function notifySessionSync() {
  for (const listener of sessionSyncListeners) listener();
}

function setSessionSync(next: SkidmarksSessionSyncState) {
  sessionSync = next;
  notifySessionSync();
}

export function getSkidmarksSessionSyncSnapshot(): SkidmarksSessionSyncState {
  return sessionSync;
}

export function subscribeSkidmarksSessionSync(listener: () => void): () => void {
  sessionSyncListeners.add(listener);
  return () => {
    sessionSyncListeners.delete(listener);
  };
}

/** Bumped by every real `persist()` call (a genuine local mutation) —
 * never by hydration applying a fetched snapshot, and never reset. See
 * `shouldApplyHydratedSkidmarksSession`. */
let localEditCount = 0;

/**
 * Pure (so it's directly testable without mocking `fetch`/timers):
 * given the local-edit counter's value right before an async session
 * load started and its value once that load actually resolved, should
 * the fetched snapshot be trusted and applied wholesale?
 *
 * `false` whenever *any* local mutation happened while the load was in
 * flight — Stuart already started using the app (tapping a project
 * tile, picking a band, anything that calls `persist()`) on top of the
 * honest empty state this module starts with before hydration lands.
 * Applying the fetched snapshot in that case would silently discard
 * whatever he just did for a load that's now stale relative to his own
 * actions — exactly the kind of "phone storage race" this migration
 * exists to close, not reopen at a new layer. Skipping the stale apply
 * here never loses anything beyond "this one load was wasted": the very
 * next `persist()` (his own edit) pushes his real state to Neon as the
 * new source of truth regardless.
 */
export function shouldApplyHydratedSkidmarksSession(editsAtFetchStart: number, editsAtFetchEnd: number): boolean {
  return editsAtFetchStart === editsAtFetchEnd;
}

interface SessionGetRouteBody {
  configured?: unknown;
  state?: unknown;
  error?: unknown;
  updatedAt?: unknown;
  revision?: unknown;
}

/**
 * What revision of the Neon row this page load last actually saw —
 * the compare-and-swap token sent with every `PUT` (2026-09-18).
 *
 * `known: false` is the honest "this page load never got a readable
 * answer out of the server" state: the hydrate `GET` threw, or came
 * back unparseable. **A push in that state is refused**, because the
 * one thing worse than not saving is saving a stale copy over a newer
 * one — which is the real, reported failure this whole mechanism
 * exists for (a second device opened the app, showed an older copy,
 * and would have pushed it back over the good one).
 *
 * `configured: false` (no `DATABASE_URL` here at all) counts as known:
 * there is no row to protect, and the push will report `unconfigured`
 * on its own without this getting in the way.
 */
type RemoteRevision = { known: true; revision: number } | { known: false };
let remoteRevision: RemoteRevision = { known: false };

/** Mirrors `SKIDMARKS_SESSION_NO_ROW_REVISION` on the server — 0 means
 * "I read the row and there wasn't one", which is what lets a genuinely
 * first-ever save insert rather than being refused as a conflict. */
const NO_ROW_REVISION = 0;

function readRevision(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

let hydrationStarted = false;

/**
 * **Emergency one-time recovery, added after #57's first real deploy.**
 * #57 switched the durable session copy from `localStorage` to Neon,
 * but never wrote a step to carry an *existing* `localStorage` session
 * over into a fresh, empty Neon row \u2014 so on Stuart's first load after
 * that deploy, Neon genuinely had nothing under his owner id, and this
 * module fell back to its honest empty state (`SEED_BANDS`, no real
 * band/session), which looked to him exactly like his real session \u2014
 * six tagged Vocal plates among them \u2014 had simply vanished.
 *
 * It had not. `persist()` never wrote to `localStorage` under #57 (by
 * design \u2014 Neon is the new state of record), but nothing in that
 * change ever *deletes* the old blob either, so a real prior session is
 * very likely still sitting untouched on Stuart's phone under
 * `LEGACY_LOCAL_STORAGE_KEY`. This reads it back, once, only when
 * there's nothing better to show, and immediately pushes it to Neon so
 * it becomes durable there too \u2014 the migration step #57 should have
 * shipped with in the first place.
 */
const LEGACY_LOCAL_STORAGE_KEY = "the-tab:skidmarks-studio";

/** Session-wide "is there anything real here" check \u2014
 * `hasSkidmarksUserContent` below is segment-scoped; this is the same
 * idea one level up, covering a real (non-seed) band or an attached mp3
 * even before any clip has been tagged, since both are already real
 * signal that this isn't just the pristine demo state. */
export function sessionHasSubstantiveContent(state: SkidmarksState): boolean {
  const seedIds = new Set(SEED_BANDS.map((b) => b.id));
  const hasRealBand = state.bands.some((b) => !seedIds.has(b.id));
  const hasMp3 = state.session.mp3 !== null;
  const hasTaggedSegments = hasSkidmarksUserContent(state.session.mp3?.segments ?? []);
  const hasSunnyBanks = sunnyBanksStudioHasUserContent(state.sunnyBanks);
  return hasRealBand || hasMp3 || hasTaggedSegments || hasSunnyBanks;
}

/**
 * Reads and normalizes the pre-#57 `localStorage` session blob, if any
 * \u2014 never throws (private-mode Safari, corrupt/foreign JSON, a
 * `localStorage` that simply isn't there all read the same as "nothing
 * to recover"). Returns `null` rather than a normalized-but-empty state
 * when there's genuinely nothing usable, so a caller can tell "no
 * legacy data" apart from "legacy data, but it happened to be blank."
 */
function readLegacySkidmarksLocalStorageSession(): SkidmarksState | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = normalizeState(JSON.parse(raw));
    return sessionHasSubstantiveContent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * **Crash/offline mirror — added 2026-09-16 after real, confirmed data
 * loss.** #57 removed `localStorage` as this feature's state of record
 * on purpose (Neon is the one durable copy, see this section's own doc
 * comment) — but that left Neon as the *only* copy of anything not yet
 * successfully `PUT`. A real live failure showed exactly why that's not
 * enough on its own: a save that's been silently failing (a payload
 * that won't go through) followed by a refresh shows whatever Neon last
 * *did* successfully receive — which can be visibly older than what
 * Stuart was just looking at, and reads exactly like his work vanished,
 * because past that point it genuinely hadn't been saved anywhere.
 *
 * This key is deliberately separate from `LEGACY_LOCAL_STORAGE_KEY` (a
 * one-time pre-#57 recovery of a blob nothing writes to anymore) — this
 * one is a live, ongoing mirror, rewritten on every real `persist()`.
 * It is never the primary source of truth and never silently wins over
 * a real, substantive Neon row on an ordinary successful load — see
 * `hydrateSkidmarksSessionOnce`'s use of it, only on a failed/empty
 * load, and `shouldPushSkidmarksSession`'s doc comment for the matching
 * write-side guard this pairs with.
 */
const LOCAL_MIRROR_STORAGE_KEY = "the-tab:skidmarks-studio-mirror";

interface LocalMirrorEnvelope {
  state: SkidmarksState;
  /** `Date.now()` at write time — compared against Neon's own
   * `updatedAt` on hydrate so whichever copy is actually newer wins,
   * never just whichever one happened to load. */
  savedAt: number;
  /** `true` from the moment a real edit lands until the exact same
   * state has been confirmed saved to Neon (`pushSkidmarksSessionNow`
   * rewrites the mirror with `false` once the PUT succeeds and nothing
   * newer has been edited since). This — not the phone's clock — is
   * the honest "this phone holds work the server doesn't" signal
   * `resolveSkidmarksHydrationWinner` trusts first; the timestamp
   * comparison is only the tie-breaker for a mirror that *was* synced. */
  unsynced?: boolean;
  /** The server `revision` this mirrored copy was built from — set on a
   * confirmed save and on a hydrate that adopted the server's copy.
   * Server-assigned and monotonic, so comparing it against the row's
   * current revision on the next hydrate is **exact**: it says which
   * copy is older without guessing from two devices' clocks. Absent on
   * a mirror written before 2026-09-18, which just falls back to the
   * old timestamp tie-break. */
  revision?: number;
}

/** Best-effort, synchronous, never throws — private-mode Safari, a full
 * quota, or `localStorage` simply not existing all just mean the mirror
 * write silently didn't happen this time; the real save still goes to
 * Neon regardless, this is a bonus safety net, not a dependency anything
 * else here blocks on. Only ever mirrors *substantive* state (never the
 * pristine seed) so a mirror read can never come back as "real data"
 * when there wasn't any. */
function writeLocalMirror(state: SkidmarksState, unsynced = true): void {
  if (!isBrowser() || !sessionHasSubstantiveContent(state)) return;
  try {
    const envelope: LocalMirrorEnvelope = {
      state,
      savedAt: Date.now(),
      unsynced,
      ...(remoteRevision.known ? { revision: remoteRevision.revision } : {}),
    };
    window.localStorage.setItem(LOCAL_MIRROR_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Quota exceeded, private mode, or storage disabled — nothing to do.
  }
}

/** Same never-throws contract as `readLegacySkidmarksLocalStorageSession`
 * — corrupt JSON, no storage, or a mirror that never got written all
 * read as `null`, never as a crash. Reads the timestamped envelope
 * (`writeLocalMirror`'s own shape); a raw pre-envelope state (should
 * never happen post-deploy, but a stale write from mid-rollout is cheap
 * to tolerate) reads as `null` rather than crashing normalizeState on
 * an unexpected shape. */
function readLocalMirrorWithTimestamp(): LocalMirrorEnvelope | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_MIRROR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalMirrorEnvelope>;
    if (typeof parsed.savedAt !== "number" || !parsed.state) return null;
    const state = normalizeState(parsed.state);
    return sessionHasSubstantiveContent(state)
      ? {
          state,
          savedAt: parsed.savedAt,
          unsynced: parsed.unsynced === true,
          ...(typeof parsed.revision === "number" && Number.isFinite(parsed.revision)
            ? { revision: parsed.revision }
            : {}),
        }
      : null;
  } catch {
    return null;
  }
}

function readLocalMirror(): SkidmarksState | null {
  return readLocalMirrorWithTimestamp()?.state ?? null;
}

/**
 * Has *this page load* ever seen `cachedState` hold real, substantive
 * content — via a successful hydrate or any real `persist()`? Feeds
 * `shouldPushSkidmarksSession`'s guard: once true, it never resets for
 * the rest of this page load (a real session, once seen, should never
 * later look like it was never there).
 */
let hadSubstantiveContentThisLoad = false;

function noteContentObserved(state: SkidmarksState): void {
  if (sessionHasSubstantiveContent(state)) hadSubstantiveContentThisLoad = true;
}

/**
 * **Pure, directly testable** — the write-side twin of
 * `shouldApplyHydratedSkidmarksSession`. Real, confirmed failure mode
 * this closes: if `cachedState` ever ends up thin/seed-only through any
 * bug or race *after* this page load has already seen a real session
 * (a failed hydrate falling through to empty state, a bad merge, a
 * future regression nobody's found yet), the very next `persist()`
 * would otherwise `PUT` that thin state and overwrite Neon's real row
 * — turning one in-memory glitch into permanent, durable data loss.
 * Once this page load has ever seen substantive content, a push is
 * only ever allowed to go through when what's being pushed is *also*
 * substantive; an empty/seed state is never allowed to overwrite a real
 * session, full stop, no matter how it got that way.
 */
export function shouldPushSkidmarksSession(everHadSubstantiveContent: boolean, currentIsSubstantive: boolean): boolean {
  return !everHadSubstantiveContent || currentIsSubstantive;
}

export interface SkidmarksHydrationCandidates {
  /** Whether any real `persist()` landed while the `GET` was in flight. */
  editedDuringLoad: boolean;
  /** What this page currently holds (booted from the local mirror, plus
   * any edits since) — is it a real session, or still seed-only? */
  localIsSubstantive: boolean;
  /** The local mirror's own `unsynced` flag — `true` means this phone
   * has an edit Neon never confirmed. `false` when there's no mirror. */
  localUnsynced: boolean;
  /** The local mirror's `savedAt`, or `null` when there's no mirror. */
  localSavedAt: number | null;
  /** Whether Neon's row is a real session (not `null`/seed-only). */
  remoteIsSubstantive: boolean;
  /** Neon's own `updated_at`, or `null` when unknown/unparseable. */
  remoteUpdatedAt: number | null;
  /** The server revision this device's mirrored copy was built from, or
   * `null` for a mirror written before revisions existed. */
  localRevision: number | null;
  /** The row's current revision, or `null` if the server didn't say. */
  remoteRevision: number | null;
}

/**
 * **Pure, directly testable** — the one decision that used to be
 * spread across three `if`s in `hydrateSkidmarksSessionOnce`, and the
 * fix for the audit's known failure mode #3 ("app boots empty, then
 * loads Neon; tap too early, or save empty over full, wipes the row"):
 *
 * - A real session in Neon **always** beats a seed-only local state,
 *   even when Stuart tapped a tile while the load was in flight. His
 *   tap on the demo state is worth nothing next to a real song; the
 *   old rule discarded the real song for it, and then the very next
 *   push had nothing substantive-seen to guard against, so the seed
 *   state went up and overwrote the row.
 * - Two real sessions: local wins when it has work Neon hasn't
 *   confirmed (an edit during the load, or a mirror still flagged
 *   `unsynced`), or when its own timestamp is newer than Neon's (the
 *   clock-based tie-breaker, kept for a mirror that was synced but
 *   whose later PUT never got its response). Otherwise Neon wins — the
 *   ordinary reopen after a clean save, and the "another device saved
 *   more recently" case.
 * - Nothing real in Neon: local wins if it's real, otherwise it doesn't
 *   matter (both are seed).
 */
export function resolveSkidmarksHydrationWinner(c: SkidmarksHydrationCandidates): "local" | "remote" {
  if (!c.remoteIsSubstantive) return c.localIsSubstantive ? "local" : "remote";
  if (!c.localIsSubstantive) return "remote";
  if (c.editedDuringLoad) return "local";

  // Revisions are server-assigned and monotonic, so when both sides
  // know one there is nothing to guess: a mirror built from an older
  // revision is definitively behind. This replaces the clock tie-break
  // below for the case that actually bit (2026-09-18) — a second device
  // opened the app and showed an older copy of the project, because the
  // comparison was its own clock against the server's, and a
  // second machine is exactly where two clocks disagree.
  //
  // `unsynced` still wins even against a newer row: that flag means
  // this device holds edits the server never took, and silently
  // throwing those away to show the newer copy would be its own data
  // loss. `hydrateSkidmarksSessionOnce` surfaces that fork instead, so
  // it is a visible choice rather than a silent one.
  if (c.localRevision !== null && c.remoteRevision !== null) {
    if (c.localRevision < c.remoteRevision) return c.localUnsynced ? "local" : "remote";
    return "local";
  }

  if (c.localUnsynced) return "local";
  if (c.localSavedAt !== null && (c.remoteUpdatedAt === null || c.localSavedAt > c.remoteUpdatedAt)) return "local";
  return "remote";
}

/** True when this device kept its own copy only because it holds unsent
 * edits, while the server has a strictly newer one — the one case the
 * winner above cannot resolve without throwing away somebody's work. */
export function isSkidmarksStaleLocalFork(c: SkidmarksHydrationCandidates): boolean {
  return (
    c.localUnsynced &&
    c.localIsSubstantive &&
    c.remoteIsSubstantive &&
    c.localRevision !== null &&
    c.remoteRevision !== null &&
    c.localRevision < c.remoteRevision
  );
}

/** Whether the one-time hydrate has reached a terminal outcome (applied
 * Neon's row, kept local, or failed honestly). **No `PUT` is ever sent
 * before this is `true`** — see `pushSkidmarksSessionNow`. Before the
 * hydrate settles, this page load doesn't yet know what Neon holds, so
 * a push could only ever be a blind overwrite of it. Pushes requested
 * in that window are queued (`pushQueued`) and drained the moment the
 * hydrate settles. Always `true` outside a browser (tests, SSR), where
 * no hydrate ever runs and no push ever leaves the process anyway. */
let hydrationSettled = false;

function settleHydration(): void {
  if (hydrationSettled) return;
  hydrationSettled = true;
  if (pushQueued && !pushInFlight) {
    pushQueued = false;
    void pushSkidmarksSessionNow();
  }
}


/**
 * One-time cleanup for a session hydrated from *before* the 2026-09-14
 * Blob fixes (`lib/plateStillBlob.ts`/`lib/memberPhotoBlob.ts`) existed
 * — a real live bug: Stuart kept hitting the session-save `HTTP 413`
 * even *after* those fixes shipped, because they only stop *new* images
 * from being embedded inline; every plate still/avatar/cover photo
 * already sitting in his session as a base64 `data:` URL from before the
 * fix stayed there, still bloating every single future save on its own.
 * Walks a freshly-hydrated state for any remaining inline `data:` URL in
 * a plate still, a member's `avatarImage`, or a band's `coverImage`,
 * uploads each to Blob, and returns the shrunk state — `changed: false`
 * (the state returned unchanged) when there was nothing to do, so a
 * caller never pushes a no-op write. Every upload runs even if another
 * one in the same pass fails (best-effort, same spirit as this file's
 * other Blob calls) — a still that can't be migrated this pass just
 * stays inline and gets tried again next hydrate.
 */
async function migrateInlineSessionImagesToBlob(
  state: SkidmarksState
): Promise<{ state: SkidmarksState; changed: boolean }> {
  let changed = false;

  const bands = await Promise.all(
    state.bands.map(async (band) => {
      let nextCoverImage = band.coverImage;
      if (nextCoverImage?.startsWith("data:")) {
        const outcome = await uploadSkidmarksMemberPhoto(nextCoverImage);
        if (outcome.ok) {
          nextCoverImage = outcome.url;
          changed = true;
        }
      }
      const members = await Promise.all(
        band.members.map(async (member) => {
          let next = member;
          if (member.avatarImage?.startsWith("data:")) {
            const outcome = await uploadSkidmarksMemberPhoto(member.avatarImage);
            if (outcome.ok) {
              changed = true;
              next = { ...next, avatarImage: outcome.url };
            }
          }
          const sleeve = next.stillSleeve;
          if (sleeve && sleeve.some((e) => e.dataUrl.startsWith("data:"))) {
            const migratedSleeve = [];
            for (const entry of sleeve) {
              if (!entry.dataUrl.startsWith("data:")) {
                migratedSleeve.push(entry);
                continue;
              }
              const outcome = await uploadSkidmarksMemberPhoto(entry.dataUrl);
              if (outcome.ok) {
                changed = true;
                migratedSleeve.push({ ...entry, dataUrl: outcome.url });
              }
              // Drop unsyncable inline bytes rather than re-embedding them.
            }
            next = { ...next, stillSleeve: migratedSleeve.length > 0 ? migratedSleeve : undefined };
          }
          return next;
        })
      );
      return { ...band, coverImage: nextCoverImage, members };
    })
  );

  const mp3 = state.session.mp3;
  const segments = mp3
    ? await Promise.all(
        mp3.segments.map(async (segment) => {
          const plates = await Promise.all(
            segment.plates.map(async (plate) => {
              if (!plate.still?.dataUrl.startsWith("data:")) return plate;
              const outcome = await uploadSkidmarksPlateStill(plate.still.dataUrl);
              if (!outcome.ok) return plate;
              changed = true;
              return { ...plate, still: { ...plate.still, dataUrl: outcome.url } };
            })
          );
          return { ...segment, plates };
        })
      )
    : null;

  if (!changed) return { state, changed: false };
  return {
    state: {
      ...state,
      bands,
      session: mp3 && segments ? { ...state.session, mp3: { ...mp3, segments } } : state.session,
    },
    changed: true,
  };
}

/**
 * Hard backstop for the "session JSON carries URLs only, never image
 * bytes" rule (2026-09-16, direct instruction after real overnight data
 * loss). `migrateInlineSessionImagesToBlob` above is the real fix —
 * upload, then use the real link — and now retries on every push; this
 * is what runs *right before the wire* when that still couldn't clear
 * everything (Blob itself unreachable, not just one picker's own
 * upload failing). Pure and synchronous — no network, no retry, just a
 * last-resort strip: any inline `data:` URL still present gets dropped
 * from what's actually sent, never embedded raw in the request body.
 * The full state (photo included) still lives in `cachedState` and the
 * local mirror untouched — nothing is lost locally, only the Neon copy
 * is briefly missing that one photo's bytes until Blob recovers and a
 * later push migrates it for real.
 */
export function stripUnsyncableImageBytesForWire(state: SkidmarksState): SkidmarksState {
  let changed = false;
  const bands = state.bands.map((band) => {
    const coverChanged = band.coverImage?.startsWith("data:") ?? false;
    const members = band.members.map((member) => {
      let next = member;
      if (member.avatarImage?.startsWith("data:")) {
        changed = true;
        next = { ...next, avatarImage: undefined };
      }
      const sleeve = next.stillSleeve;
      if (sleeve && sleeve.some((e) => e.dataUrl.startsWith("data:"))) {
        changed = true;
        const cleaned = sleeve.filter((e) => !e.dataUrl.startsWith("data:"));
        next = { ...next, stillSleeve: cleaned.length > 0 ? cleaned : undefined };
      }
      return next;
    });
    if (!coverChanged && members === band.members) return band;
    changed = changed || coverChanged;
    return { ...band, coverImage: coverChanged ? undefined : band.coverImage, members };
  });

  const mp3 = state.session.mp3;
  const segments = mp3
    ? mp3.segments.map((segment) => {
        const plates = segment.plates.map((plate) => {
          if (!plate.still?.dataUrl.startsWith("data:")) return plate;
          changed = true;
          return { ...plate, still: undefined };
        });
        return { ...segment, plates };
      })
    : null;

  const draft = state.session.scriptSequenceDraft;
  const draftChanged = draft?.startingImageUrl?.startsWith("data:") ?? false;
  changed = changed || draftChanged;

  if (!changed) return state;
  const session = mp3 && segments ? { ...state.session, mp3: { ...mp3, segments } } : state.session;
  return {
    ...state,
    bands,
    session: draftChanged && draft ? { ...session, scriptSequenceDraft: { ...draft, startingImageUrl: undefined } } : session,
  };
}

/**
 * The one-time (per page load) `GET /api/skidmarks/session` —
 * triggered off `subscribeSkidmarks`'s very first subscriber. Never
 * re-triggered on a later re-subscribe (e.g. reopening the Skidmarks
 * sheet within the same page load): once hydrated, `cachedState` is
 * this page load's own authoritative in-memory copy, kept current in
 * Neon by every `persist()`'s debounced push — re-fetching on every
 * reopen would risk the same "unsaved-but-in-memory edit clobbered by a
 * fetch that started before it and resolved after" race
 * `shouldApplyHydratedSkidmarksSession` exists to prevent, for no real
 * gain a fresh page load (the actual "switch device" moment) doesn't
 * already cover.
 */
async function hydrateSkidmarksSessionOnce(): Promise<void> {
  if (hydrationStarted || !isBrowser()) return;
  hydrationStarted = true;
  const editsAtStart = localEditCount;
  // `getSkidmarksSnapshot` already booted `cachedState` from the local
  // mirror (if any) before the first render, so "local" below is never
  // the bare seed state when this phone holds a real session.
  const mirrorAtStart = readLocalMirrorWithTimestamp();

  const local = (): SkidmarksState => cachedState ?? emptyState();
  const localIsSubstantive = () => sessionHasSubstantiveContent(local());

  // Neon unreachable/unconfigured/thrown: nothing to reconcile against.
  // Keep whatever's on this phone (the mirror boot already did that);
  // only fall back to the one-time pre-#57 legacy blob when there's
  // still nothing real to show.
  const recoverLocallyOnly = () => {
    if (localIsSubstantive()) return;
    const recovered = readLegacySkidmarksLocalStorageSession();
    if (!recovered) return;
    cachedState = recovered;
    noteContentObserved(recovered);
    writeLocalMirror(recovered);
    notify();
  };

  try {
    const res = await fetch(SESSION_ENDPOINT);
    const body = (await res.json().catch(() => null)) as SessionGetRouteBody | null;

    if (!res.ok || !body || body.configured !== true) {
      recoverLocallyOnly();
      // An explicit `configured: false` means there is no database here
      // at all — no row to overwrite, so the push guard below must not
      // treat it as "never read the row". A transport/HTTP failure is
      // the opposite: we genuinely don't know what Neon holds, so leave
      // `remoteRevision` unknown and let the guard refuse to push.
      remoteRevision =
        body && body.configured === false ? { known: true, revision: NO_ROW_REVISION } : { known: false };
      setSessionSync({
        status: "unconfigured",
        error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}`,
      });
      return;
    }

    const fetched = body.state == null ? null : normalizeState(body.state);
    const fetchedUpdatedAt = typeof body.updatedAt === "string" ? Date.parse(body.updatedAt) : NaN;
    // This page load has now genuinely read the row — every push from
    // here on is conditional on this exact revision.
    const fetchedRevision = readRevision(body.revision);
    remoteRevision =
      fetchedRevision !== null
        ? { known: true, revision: fetchedRevision }
        : // An older server build (no `revision` in the response) still
          // has to be saveable, or a mid-deploy tab is stuck read-only.
          // The server treats an omitted `expectedRevision` as the old
          // unconditional write, which is exactly the pre-2026-09-18
          // behaviour rather than a new risk.
          { known: false };
    // The legacy pre-#57 blob only ever matters when neither side has
    // anything real — read it into "local" for the decision below.
    if (!localIsSubstantive()) recoverLocallyOnly();

    const candidates: SkidmarksHydrationCandidates = {
      editedDuringLoad: !shouldApplyHydratedSkidmarksSession(editsAtStart, localEditCount),
      localIsSubstantive: localIsSubstantive(),
      localUnsynced: mirrorAtStart?.unsynced ?? false,
      localSavedAt: mirrorAtStart?.savedAt ?? null,
      remoteIsSubstantive: !!fetched && sessionHasSubstantiveContent(fetched),
      remoteUpdatedAt: Number.isNaN(fetchedUpdatedAt) ? null : fetchedUpdatedAt,
      localRevision: mirrorAtStart?.revision ?? null,
      remoteRevision: fetchedRevision,
    };
    const winner = resolveSkidmarksHydrationWinner(candidates);

    if (isSkidmarksStaleLocalFork(candidates)) {
      // This device holds edits the server never took, AND the server
      // has moved on since. Neither copy can be thrown away silently.
      // Keep this device's (its edits are the ones nothing else has)
      // and say so, with `loadSkidmarksSessionFromServerNow` as the
      // one-tap way to take the newer copy instead.
      noteContentObserved(local());
      settleHydration();
      setSessionSync({
        status: "conflict",
        error:
          "This device has changes that were never saved, and a newer version was saved somewhere else. " +
          "Nothing has been thrown away — choose which one you want.",
        ...(Number.isNaN(fetchedUpdatedAt) ? {} : { remoteSavedAt: fetchedUpdatedAt }),
      });
      return;
    }

    if (winner === "local") {
      // This phone holds the real/newer copy — make Neon match it.
      // Nothing to apply; `cachedState` is already what's on screen.
      if (localIsSubstantive()) {
        noteContentObserved(local());
        settleHydration();
        await pushSkidmarksSessionNow();
      } else {
        setSessionSync({ status: "synced" });
      }
      return;
    }

    if (fetched && sessionHasSubstantiveContent(fetched)) {
      cachedState = fetched;
      noteContentObserved(fetched);
      writeLocalMirror(fetched, false);
      notify();
      setSessionSync({ status: "synced" });
      // Best-effort, non-blocking — never delays showing "synced" for
      // what's usually a no-op. See `migrateInlineSessionImagesToBlob`'s
      // own doc comment for the real 413 this closes for a session
      // that predates the 2026-09-14 Blob fixes.
      const editsAtApply = localEditCount;
      void migrateInlineSessionImagesToBlob(fetched).then(({ state: migrated, changed }) => {
        if (!changed) return;
        if (!shouldApplyHydratedSkidmarksSession(editsAtApply, localEditCount)) return;
        cachedState = migrated;
        writeLocalMirror(migrated);
        notify();
        void pushSkidmarksSessionNow();
      });
      return;
    }

    // Neither side has anything real — a genuinely fresh studio.
    setSessionSync({ status: "synced" });
  } catch (err) {
    // Real confirmed failure mode (2026-09-16): a thrown `fetch` here
    // used to leave `cachedState` at its initial seed value with no
    // recovery at all — looking exactly like a wiped session even
    // though the mirror on this same phone still had the real one.
    recoverLocallyOnly();
    setSessionSync({
      status: "error",
      error: err instanceof Error ? err.message : "Could not load the saved session.",
    });
  } finally {
    settleHydration();
  }
}

interface SessionPutRouteBody {
  ok?: unknown;
  configured?: unknown;
  error?: unknown;
  revision?: unknown;
  conflict?: unknown;
  updatedAt?: unknown;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let pushQueued = false;

/**
 * The actual `PUT` — always sends whatever `cachedState` holds *at the
 * moment this runs* (not whatever it was when scheduled), and never lets
 * two pushes race each other: a push already in flight just marks
 * `pushQueued` and lets that in-flight push's own completion kick off
 * one more (capturing `cachedState` fresh at that later point too),
 * rather than firing a second overlapping request whose response could
 * land out of order and leave a stale write as Neon's final answer.
 * `keepalive` lets a flush fired from `pagehide` finish even after the
 * page has started unloading — iOS Safari otherwise cancels an
 * in-flight `fetch` the instant the tab backgrounds/closes.
 */
/** A thrown `fetch` (no HTTP response at all — Safari/WebKit's own
 * "Load failed" wording for a raw network-level blip, as opposed to a
 * real HTTP error response) gets retried with backoff before
 * `pushSkidmarksSessionNow` gives up and shows the error banner. Real
 * live bug (2026-09-14): Stuart kept hitting "Load failed" on a visibly
 * weak signal — a single 1.5s retry wasn't enough for a connection that
 * stayed bad for several seconds. This schedule (1s, 2s, 4s, 8s, 15s —
 * ~30s total before giving up) gives a real mobile dead spot (a tunnel,
 * an elevator, a genuinely bad patch of signal) a real chance to clear
 * before the save is actually abandoned. Only applies to a normal,
 * non-`keepalive` push — a flush fired from `pagehide`/backgrounding
 * gets exactly one attempt, since the page may already be gone by the
 * time a retry would fire, and there's no user still watching it retry.
 * A real HTTP response (a genuine 413, a real 502) is never retried
 * here — it would only fail the exact same way again immediately. */
const SESSION_PUSH_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

async function pushSkidmarksSessionNow(keepalive = false): Promise<void> {
  if (isBrowser() && !hydrationSettled) {
    // Never a blind overwrite of a Neon row this page load hasn't read
    // yet — see `hydrationSettled`. Drained by `settleHydration`.
    pushQueued = true;
    return;
  }
  if (pushInFlight) {
    pushQueued = true;
    return;
  }
  pushInFlight = true;
  const snapshot = cachedState;
  // Real, confirmed failure mode (2026-09-16) this guard closes: never
  // let a thin/seed-only state overwrite a real session in Neon just
  // because that's what `cachedState` happens to hold right now — see
  // `shouldPushSkidmarksSession`'s doc comment. This is a refusal, not
  // a network failure, so it never enters the retry-with-backoff path
  // below at all; retrying the exact same thin state wouldn't help.
  // Real, reported failure mode (2026-09-18) this guard closes: a
  // second device opened the app, could not read Neon, and would then
  // have pushed its own older copy straight over the good one. If this
  // page load never learned what the row holds, it does not get to
  // replace it. A reload (which re-runs the hydrate) is the fix.
  if (!remoteRevision.known) {
    setSessionSync({
      status: "error",
      error:
        "Not saved — this device could not read your saved session, so it will not write over it. " +
        "Reload the app to try again.",
    });
    pushInFlight = false;
    if (pushQueued) {
      pushQueued = false;
      void pushSkidmarksSessionNow(keepalive);
    }
    return;
  }
  if (!shouldPushSkidmarksSession(hadSubstantiveContentThisLoad, snapshot !== null && sessionHasSubstantiveContent(snapshot))) {
    setSessionSync({
      status: "error",
      error: "Not saved — refusing to overwrite your real project with an empty one. Don't refresh; reload the app in a fresh tab instead.",
    });
    pushInFlight = false;
    if (pushQueued) {
      pushQueued = false;
      void pushSkidmarksSessionNow(keepalive);
    }
    return;
  }
  // Real, confirmed root cause (2026-09-16): a picked band cover/member
  // avatar/plate photo uploads to Blob *first* and only ever falls back
  // to embedding the raw `data:` URL inline when that upload itself
  // fails (see `SkidmarksBandPicker`/`SkidmarksMembersModule`'s own
  // comments) — a real, honest "never just drop the photo" choice, not
  // a bug on its own. But once that fallback fires, the inline image
  // then sits in `cachedState` until the next full page reload, since
  // `migrateInlineSessionImagesToBlob` only ever ran once, at hydrate.
  // Every `persist()` in between pushes that same oversized state again.
  // Retrying the migration here, right before every non-keepalive push,
  // means a Blob hiccup self-heals on the very next save instead of
  // silently bloating every save until the tab happens to reload.
  // Skipped for a `keepalive` flush (pagehide/backgrounding) — that one
  // has to be fast, and blocking it on image re-uploads that might not
  // even finish before the page is gone would defeat its whole purpose.
  if (!keepalive && snapshot) {
    const { state: migrated, changed } = await migrateInlineSessionImagesToBlob(snapshot);
    if (changed) {
      cachedState = migrated;
      writeLocalMirror(migrated);
      notify();
    }
  }
  const preStrip = keepalive ? snapshot : cachedState;
  // Hard rule, no exceptions, including the keepalive path (cheap and
  // synchronous, so there's no cost to running it there too): the
  // request body sent over the wire must never carry raw image bytes,
  // only URLs — see `stripUnsyncableImageBytesForWire`'s doc comment.
  const toSend = preStrip ? stripUnsyncableImageBytesForWire(preStrip) : preStrip;
  setSessionSync({ status: "saving" });
  const maxAttempts = keepalive ? 1 : SESSION_PUSH_RETRY_DELAYS_MS.length + 1;
  // Real live bug (2026-09-14): "Load failed" (a raw network-level fetch
  // failure) kept recurring even on a confirmed-solid connection, after
  // every size-related fix so far — meaning the actual cause is still
  // unknown, not just "weak signal." One real possibility neither of the
  // two error shapes so far rules out: Vercel's own edge can drop a
  // request outright, as a raw connection failure rather than a clean
  // `413` response body, once a body is large enough — which would
  // *look* exactly like this "Load failed" wording from the browser's
  // side, even though the root cause is the same payload-size class of
  // bug already fixed twice. Surfacing the real payload size in the
  // error message turns the next report into a measurement instead of
  // another guess: a small number here rules that theory out entirely;
  // a multi-MB number confirms it and says exactly where to look next.
  const payloadJson = JSON.stringify({
    state: toSend,
    expectedRevision: remoteRevision.known ? remoteRevision.revision : undefined,
  });
  const payloadSizeMb = (new TextEncoder().encode(payloadJson).length / (1024 * 1024)).toFixed(1);
  try {
    let lastNetworkError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const res = await fetch(SESSION_ENDPOINT, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: payloadJson,
          keepalive,
        });
        const body = (await res.json().catch(() => ({}))) as SessionPutRouteBody;
        if (res.status === 409 || body.conflict === true) {
          // Another device (or tab) saved since this page load read the
          // row. Refusing is the point — retrying would be the
          // overwrite. Adopt the server's revision so the next push
          // after a reconcile isn't stuck failing forever, but leave
          // the local state alone: this device's edits are still here,
          // unsent, and a reload will show both sides honestly.
          const conflictRevision = readRevision(body.revision);
          if (conflictRevision !== null) remoteRevision = { known: true, revision: conflictRevision };
          const remoteSavedAt = typeof body.updatedAt === "string" ? Date.parse(body.updatedAt) : NaN;
          setSessionSync({
            status: "conflict",
            error:
              typeof body.error === "string"
                ? body.error
                : "Not saved — a newer version was saved from somewhere else.",
            ...(Number.isNaN(remoteSavedAt) ? {} : { remoteSavedAt }),
          });
        } else if (!res.ok || body.ok !== true) {
          setSessionSync({
            status: body.configured === false ? "unconfigured" : "error",
            error: `${typeof body.error === "string" ? body.error : `HTTP ${res.status}`} (payload ${payloadSizeMb}MB)`,
          });
        } else {
          // Neon now holds exactly `preStrip`. If nothing newer landed
          // while the request was out, the mirror can drop its
          // `unsynced` flag — see `LocalMirrorEnvelope.unsynced`.
          if (preStrip && cachedState === preStrip) writeLocalMirror(preStrip, false);
          const savedRevision = readRevision(body.revision);
          if (savedRevision !== null) remoteRevision = { known: true, revision: savedRevision };
          setSessionSync({ status: "synced", lastSavedAt: Date.now() });
        }
        return;
      } catch (err) {
        lastNetworkError = err;
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, SESSION_PUSH_RETRY_DELAYS_MS[attempt]));
        }
      }
    }
    setSessionSync({
      status: "error",
      error: `${lastNetworkError instanceof Error ? lastNetworkError.message : "Could not save the session."} (payload ${payloadSizeMb}MB)`,
    });
  } finally {
    pushInFlight = false;
    if (pushQueued) {
      pushQueued = false;
      void pushSkidmarksSessionNow(keepalive);
    }
  }
}

function schedulePush(): void {
  if (!isBrowser()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushSkidmarksSessionNow();
  }, SESSION_PUSH_DEBOUNCE_MS);
}

/** Best-effort immediate flush, bypassing the debounce — wired to
 * `visibilitychange`/`pagehide` below so a final edit made right before
 * Stuart backgrounds/closes Safari on his phone doesn't just sit in the
 * debounce queue and never actually ship. See `SESSION_PUSH_DEBOUNCE_MS`'s
 * doc comment.
 *
 * **Exported (2026-09-14) for exactly one more caller**: a plate still
 * finishing generation/upload (`SkidmarksClipStub.tsx`'s `handleGenerate`/
 * `handleFileChange`, `SkidmarksAutoPlate.tsx`'s `handleConfirm`, and
 * (later the same day) `SkidmarksMembersModule.tsx`/`SkidmarksBandPicker
 * .tsx`'s avatar/cover pickers). A real live bug — Stuart generated real
 * plates, then did what he called a "cold restart" shortly after, and
 * they were gone on reload — is consistent with those plates'
 * `onSetClipPlateStill` write still sitting in the 600ms debounce queue
 * (or an even-longer real network round trip to Neon) at the moment his
 * phone/Safari actually died, which `visibilitychange`/`pagehide` can't
 * help with if the process is killed outright rather than genuinely
 * backgrounded first. Flushing right after a still is durably worth
 * saving shrinks that window from "however long until he backgrounds
 * the tab" to "immediately."
 *
 * **`keepalive` defaults to `false` (2026-09-14, same-day fix to the fix
 * above)** — a real bug this introduced and Stuart's own sharp
 * observation caught: "the thumbnail saves, the MP3 saves, why not the
 * plate?" Every one of the callers above wants the opposite of what
 * `pushSkidmarksSessionNow`'s `keepalive: true` path means — a `true`
 * caps a push at exactly one attempt (no retry), which made sense for
 * the *original*, narrower use (a page that's about to disappear, where
 * waiting for a retry is pointless), but every plate-still/avatar/cover
 * flush call happens while Stuart is still actively in the app, so it
 * deserved the same ~30s retry ladder an ordinary debounced save already
 * gets — and, because `keepalive: true` was hard-coded here, never got
 * it. Only `visibilitychange`/`pagehide` below still need the old
 * one-attempt behavior; they pass `true` explicitly. */
export function flushSkidmarksSessionNow(keepalive = false): void {
  if (!isBrowser()) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  void pushSkidmarksSessionNow(keepalive);
}

/**
 * Explicitly replace whatever this device is holding with the copy on
 * the server (2026-09-18, after the real report: episodes are built on
 * the phone, then opened on a PC purely to download them for Resolve —
 * so the PC showing an older copy is the thing that actually blocks the
 * work, and it never has edits of its own worth protecting).
 *
 * The automatic rule above gets this right on its own now that
 * revisions are exact, so this is the escape hatch for the one case it
 * deliberately won't decide — a device with unsent edits *and* a newer
 * row on the server. Always user-initiated, never automatic: it
 * discards this device's unsaved edits by definition, so nothing should
 * fire it without someone asking.
 *
 * Returns `false` (leaving the current state untouched) for every
 * honest failure — no database, nothing saved yet, an unreachable
 * server — rather than blanking the app because a fetch went wrong.
 */
export async function loadSkidmarksSessionFromServerNow(): Promise<boolean> {
  if (!isBrowser()) return false;
  setSessionSync({ status: "loading" });
  try {
    const res = await fetch(SESSION_ENDPOINT, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as SessionGetRouteBody | null;
    if (!res.ok || !body || body.configured !== true) {
      setSessionSync({
        status: body && body.configured === false ? "unconfigured" : "error",
        error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}`,
      });
      return false;
    }
    const fetched = body.state == null ? null : normalizeState(body.state);
    if (!fetched || !sessionHasSubstantiveContent(fetched)) {
      setSessionSync({
        status: "error",
        error: "There is no saved project on the server to load.",
      });
      return false;
    }
    const fetchedRevision = readRevision(body.revision);
    remoteRevision = fetchedRevision !== null ? { known: true, revision: fetchedRevision } : { known: false };
    cachedState = fetched;
    noteContentObserved(fetched);
    writeLocalMirror(fetched, false);
    notify();
    setSessionSync({ status: "synced" });
    return true;
  } catch (err) {
    setSessionSync({
      status: "error",
      error: err instanceof Error ? err.message : "Could not reach the server.",
    });
    return false;
  }
}

let sessionLifecycleWired = false;

/** Wires the one-time hydrate + the visibility/pagehide flush listeners
 * — called once, off the store's first real subscriber (see
 * `subscribeSkidmarks`), the same "first listener wires the real
 * side-effect" shape the old `storage`-event listener used. */
function ensureSessionPersistenceWired(): void {
  if (sessionLifecycleWired || !isBrowser()) return;
  sessionLifecycleWired = true;
  document.addEventListener("visibilitychange", () => {
    // `true`: the page may be about to disappear, so this is the one
    // caller that still wants the old one-attempt-only behavior — see
    // `flushSkidmarksSessionNow`'s own doc comment for why every *other*
    // caller now defaults to the opposite.
    if (document.visibilityState === "hidden") flushSkidmarksSessionNow(true);
  });
  window.addEventListener("pagehide", () => flushSkidmarksSessionNow(true));
  // Real live bug (2026-09-14): Stuart tapped Safari's own reload button
  // — visible right in his own screenshots — while a save had genuinely
  // not landed yet (still "saving," or already showing the error
  // banner), which wiped whatever hadn't made it to Neon. The browser's
  // own native "leave site? changes may not be saved" prompt is the
  // honest, no-storage-of-any-kind way to stop that: it only fires while
  // `sessionSync` is actually unsettled, never once a save has
  // succeeded, and it's the browser asking, not this app inventing its
  // own dialog. **Real limit, stated plainly**: this only catches a
  // reload/close *through the browser's own UI* — it can't fire at all
  // for a force-quit via the app switcher or a phone restart, since the
  // page never gets a chance to run any code in that case. Nothing
  // (this included) can make a save land with zero network at the exact
  // moment it's attempted; see `SESSION_PUSH_RETRY_DELAYS_MS` above for
  // what actually extends how long this app keeps trying before that
  // becomes a real, final failure.
  window.addEventListener("beforeunload", (e) => {
    if (sessionSync.status === "saving" || sessionSync.status === "error") {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  // Real gap (2026-09-16): a save that failed while offline (airplane
  // mode, a dead patch of signal) only ever retried on the *next* edit
  // — if Stuart typed one prompt, lost signal, and didn't type anything
  // else, that prompt just sat failed forever once the retry schedule
  // ran out, even after connectivity came back. The browser's own
  // `online` event is the honest signal that a retry might actually
  // succeed now; only fires a fresh push when the last one is still
  // sitting on a real, substantive error, never as a no-op retry of an
  // already-synced session.
  window.addEventListener("online", () => {
    if (sessionSync.status === "error") void pushSkidmarksSessionNow();
  });
  // "If the UI is not synced, block close and keep retrying" (2026-09-16
  // direct instruction). The browser's own `beforeunload` prompt above
  // is the actual "block close" — a real block is not possible from
  // page script alone, that dialog is the platform's own ceiling. This
  // is the "keep retrying" half: the `online` event and the next edit
  // both already retry a real, substantive error, but neither one fires
  // for a tab just sitting open, unsynced, with nothing else happening —
  // a locked phone overnight is exactly that case. A slow, quiet
  // interval retry while genuinely unsynced means a connection that
  // comes and goes gets picked up eventually even with zero user action,
  // rather than staying stuck on one failed attempt until morning.
  // Never fires on "unconfigured" (no Neon connected here at all —
  // retrying can't fix that) or once "synced" — only on a real "error".
  window.setInterval(() => {
    if (sessionSync.status === "error") void pushSkidmarksSessionNow();
  }, SESSION_UNSYNCED_RETRY_INTERVAL_MS);
  void hydrateSkidmarksSessionOnce();
}

let cachedState: SkidmarksState | null = null;

export function getSkidmarksSnapshot(): SkidmarksState {
  if (!cachedState) {
    // First read of this page load: start from this phone's own last
    // known real session (the local mirror), never from the seed demo
    // state, so the very first paint already shows real work and a
    // tap before Neon answers lands on top of it rather than on a
    // blank studio. `hydrateSkidmarksSessionOnce` then reconciles this
    // against Neon — see `resolveSkidmarksHydrationWinner`.
    const mirrored = readLocalMirror();
    cachedState = mirrored ?? emptyState();
    if (mirrored) noteContentObserved(mirrored);
  }
  return cachedState;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeSkidmarks(listener: () => void): () => void {
  listeners.add(listener);
  if (isBrowser() && listeners.size === 1) {
    ensureSessionPersistenceWired();
  }
  return () => {
    listeners.delete(listener);
  };
}

/* The `localStorage` quota machinery that used to live here —
 * `describeSkidmarksPersistFailure`, `getSkidmarksPersistFailure`,
 * `getSkidmarksStorageWarning`, `exceedsSkidmarksStorageWarningThreshold`,
 * `lastPersistFailure`, `lastPersistWarning`, `STORAGE_SIZE_WARNING_BYTES`
 * and `STORAGE_SIZE_WARNING_MESSAGE` — is gone. It existed to make a
 * failed or near-full `localStorage.setItem` visible instead of
 * silent, and `persist()` no longer writes to `localStorage` at all:
 * the session's durable copy is one Neon row now. With no write to
 * fail on quota, none of that code could ever fire again, and leaving
 * it in would ship UI structurally incapable of showing.
 *
 * The need it served is met by `SkidmarksSessionSyncState` instead:
 * `"error"` carries Neon's own failure reason verbatim, and
 * `"unconfigured"` says plainly that edits won't survive a refresh.
 * Same "a save that didn't happen must never look like a success"
 * principle, just reporting on the store that actually exists. */

function persist(next: SkidmarksState) {
  cachedState = next;
  localEditCount += 1;
  noteContentObserved(next);
  writeLocalMirror(next);
  notify();
  schedulePush();
}

/**
 * A studio-wide "identity context changed" signal — fired whenever the
 * active band/artist or its attached song switches (`selectSkidmarksBand`,
 * `createSkidmarksBand`, `removeSkidmarksBand` when the removed band was
 * active, `attachSkidmarksMp3`). Exists purely so state that legitimately
 * lives *outside* this module's own persisted `SkidmarksState` — today:
 * `lib/plateLocation.ts`'s in-memory empty-place-still cache — still gets
 * cleared the moment a switch could otherwise let its stale output leak
 * into a different artist's render (the identity-safe script-sequence
 * runner's whole reason for existing: never show a new artist a frame
 * that came from the last one).
 *
 * A plain listener registry, not a direct import of `lib/plateLocation.ts`
 * from here — importing it here would create a circular module
 * dependency (`plateLocation.ts` already imports `downscaleDataUrlImage`
 * from this file). `plateLocation.ts` registers its own
 * `clearCachedLocationStills` here instead, once, at module load.
 *
 * Every real plate still and render for the previous artist is already
 * gone the instant this fires — `selectSkidmarksBand`/`createSkidmarksBand`/
 * `attachSkidmarksMp3` all replace `session.mp3` wholesale (never merge),
 * and `session.mp3.segments[].plates[].still` is where every upload/
 * generated/chained still, and every "featuresLockedCharacter"/continuity
 * flag, actually lives — so discarding the old `mp3` object *is* the
 * delete, not just a UI hide. This registry only has to cover the one
 * piece of state that survives a fresh `mp3` because it was never part of
 * it in the first place.
 */
type SkidmarksIdentityWipeListener = () => void;
const identityWipeListeners: SkidmarksIdentityWipeListener[] = [];

export function registerSkidmarksIdentityWipeListener(listener: SkidmarksIdentityWipeListener): void {
  identityWipeListeners.push(listener);
}

function notifySkidmarksIdentityWipe(): void {
  for (const listener of identityWipeListeners) {
    try {
      listener();
    } catch {
      // Best-effort — a broken listener must never block the real band/
      // song switch it's reacting to.
    }
  }
}

function resolvedSunnyBanks(state: SkidmarksState): SkidmarksSunnyBanksState {
  return (
    state.sunnyBanks ?? {
      live: buildDefaultSunnyBanksLive(),
      workspaces: [],
      saveSeq: 0,
    }
  );
}

/** Current Sunny Banks live episode — EP02 seed until the first persist. */
export function getSunnyBanksLiveOrDefault(state: SkidmarksState = getSkidmarksSnapshot()): SunnyBanksLiveState {
  return cloneSunnyBanksLive(resolvedSunnyBanks(state).live);
}

export function patchSunnyBanksLive(updater: (live: SunnyBanksLiveState) => SunnyBanksLiveState): void {
  const current = getSkidmarksSnapshot();
  const studio = resolvedSunnyBanks(current);
  persist({
    ...current,
    sunnyBanks: {
      ...studio,
      live: updater(cloneSunnyBanksLive(studio.live)),
    },
  });
}

/** Named save of the whole live episode (every act). Same episode name
 * replaces that card instead of minting an Act I / Act II pair. */
export function saveSunnyBanksProjectWorkspace(): SunnyBanksWorkspaceSnapshot {
  const current = getSkidmarksSnapshot();
  const studio = resolvedSunnyBanks(current);
  const saveSeq = studio.saveSeq + 1;
  const snapshot = buildSunnyBanksWorkspaceFromLive(studio.live, Date.now(), saveSeq);
  persist({
    ...current,
    sunnyBanks: {
      live: cloneSunnyBanksLive(studio.live),
      workspaces: upsertSunnyBanksWorkspace(studio.workspaces, snapshot),
      saveSeq,
    },
  });
  return snapshot;
}

export function deleteSunnyBanksWorkspace(id: string): void {
  const current = getSkidmarksSnapshot();
  if (!current.sunnyBanks) return;
  persist({
    ...current,
    sunnyBanks: {
      ...current.sunnyBanks,
      workspaces: current.sunnyBanks.workspaces.filter((workspace) => workspace.id !== id),
    },
  });
}

/**
 * **New Episode** — replace the live working copy with a blank one
 * (2026-09-18). Saved cards are untouched by design: Stuart's own
 * wording was "I want to create new and then it clears everything, all
 * the old stuff on the workspace should be saved."
 *
 * Only the live copy is cleared, so anything that was saved is still on
 * the shelf and still on the server. Anything *not* saved is gone —
 * which is why the panel asks first and says so.
 */
export function startNewSunnyBanksEpisode(): void {
  const current = getSkidmarksSnapshot();
  const studio = resolvedSunnyBanks(current);
  persist({
    ...current,
    sunnyBanks: {
      ...studio,
      live: buildEmptySunnyBanksLive(),
    },
  });
}

export function openSunnyBanksWorkspace(id: string): void {
  const current = getSkidmarksSnapshot();
  const workspace = current.sunnyBanks?.workspaces.find((row) => row.id === id);
  if (!workspace) return;
  persist({
    ...current,
    sunnyBanks: {
      live: liveFromSunnyBanksWorkspace(workspace),
      workspaces: current.sunnyBanks?.workspaces ?? [],
      saveSeq: current.sunnyBanks?.saveSeq ?? 0,
    },
  });
}

/** Landing tile tap — only `music-video` actually opens anything further;
 * the other two kinds are inert (see `SKIDMARKS_PROJECT_KINDS`), but we
 * still record the tap so a disabled tile can't silently no-op forever. */
export function selectSkidmarksProjectKind(kind: SkidmarksProjectKind): void {
  const current = getSkidmarksSnapshot();
  persist({ ...current, session: { ...current.session, projectKind: kind } });
}

/** Selects an already-known band (from the picker row) as the active one
 * for this session, resetting anything downstream (MP3) that belonged to
 * a previous band. */
export function selectSkidmarksBand(bandId: string): void {
  const current = getSkidmarksSnapshot();
  if (!current.bands.some((b) => b.id === bandId)) return;
  persist({
    ...current,
    session: { ...current.session, bandId, mp3: null, scriptSequenceDraft: null },
  });
  // A band switch is an artist switch — see `notifySkidmarksIdentityWipe`'s
  // doc comment for why this fires even though `mp3: null` above already
  // deleted every plate still/render this session held.
  notifySkidmarksIdentityWipe();
}

/** "New" tile tap — mints a fresh mock band, adds it to the roster, and
 * selects it. Capped at `BAND_HISTORY_LIMIT` (oldest non-seed band drops
 * first) so tapping "New" repeatedly doesn't grow the picker forever. */
export function createSkidmarksBand(): SkidmarksBand {
  const band = buildBlankBand();
  const current = getSkidmarksSnapshot();
  const seedIds = new Set(SEED_BANDS.map((b) => b.id));
  const nonSeed = current.bands.filter((b) => !seedIds.has(b.id));
  const seed = current.bands.filter((b) => seedIds.has(b.id));
  const bands = [...seed, band, ...nonSeed].slice(
    0,
    seed.length + BAND_HISTORY_LIMIT
  );
  persist({
    ...current,
    bands,
    session: { ...current.session, bandId: band.id, mp3: null, scriptSequenceDraft: null },
  });
  notifySkidmarksIdentityWipe();
  return band;
}

/** Removes a band outright — the trash glyph on each existing band tile
 * (never shown on the "New" tile, which doesn't correspond to a band
 * yet). If the deleted band was hand-seeded (`SEED_BANDS`), its id is
 * recorded in `removedSeedBandIds` so `normalizeState` doesn't re-mint
 * it from the hardcoded seed list on the next load — a deleted seed band
 * stays deleted. If the deleted band was the active session band, the
 * session's `bandId`/`mp3` reset to `null` (same "downstream resets"
 * behavior as switching bands via `selectSkidmarksBand`). */
export function removeSkidmarksBand(bandId: string): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.filter((b) => b.id !== bandId);
  const isSeed = SEED_BANDS.some((b) => b.id === bandId);
  const removedSeedBandIds = isSeed
    ? Array.from(new Set([...current.removedSeedBandIds, bandId]))
    : current.removedSeedBandIds;
  const wasActive = current.session.bandId === bandId;
  persist({
    ...current,
    bands,
    removedSeedBandIds,
    session: wasActive
      ? { ...current.session, bandId: null, mp3: null }
      : current.session,
  });
  if (wasActive) notifySkidmarksIdentityWipe();
}

/** Appends a blank member to a band (capped at `MAX_MEMBERS_PER_BAND`) — the "+ Add member" pill. */
export function addSkidmarksMember(bandId: string): void {
  const current = getSkidmarksSnapshot();
  const band = current.bands.find((b) => b.id === bandId);
  if (!band || band.members.length >= MAX_MEMBERS_PER_BAND) return;
  const member = buildBlankMember();
  const bands = current.bands.map((b) =>
    b.id === bandId ? { ...b, members: [...b.members, member] } : b
  );
  persist({ ...current, bands });
}

/** Removes a member from a band — the per-row trash/× control. No cap
 * bookkeeping needed here; freeing a slot just lets "+ Add member"
 * reappear once the band drops back under `MAX_MEMBERS_PER_BAND`. */
export function removeSkidmarksMember(bandId: string, memberId: string): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) =>
    b.id === bandId
      ? { ...b, members: b.members.filter((m) => m.id !== memberId) }
      : b
  );
  persist({ ...current, bands });
}

/** Sets a member's display name — how a blank "+ Add member" row gets
 * filled in, via the generate popup's name field. */
/** Writes a member's own lock card — see `SkidmarksMemberLockCard`. */
export function setSkidmarksMemberLock(bandId: string, memberId: string, lock: SkidmarksMemberLockCard): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) => {
    if (b.id !== bandId) return b;
    return { ...b, members: b.members.map((m) => (m.id === memberId ? { ...m, lock } : m)) };
  });
  persist({ ...current, bands });
}

export function renameSkidmarksMember(
  bandId: string,
  memberId: string,
  name: string
): void {
  const current = getSkidmarksSnapshot();
  const trimmed = name.trim();
  const bands = current.bands.map((b) => {
    if (b.id !== bandId) return b;
    return {
      ...b,
      members: b.members.map((m) =>
        m.id === memberId ? { ...m, name: trimmed } : m
      ),
    };
  });
  persist({ ...current, bands });
}

/** Renames a band — same "trim, persist" shape as `renameSkidmarksMember`.
 * The only way to name a band created via `buildBlankBand` (see its doc
 * comment); the input this calls from lives on `SkidmarksMembersModule`'s
 * band-name header. */
export function renameSkidmarksBand(bandId: string, name: string): void {
  const current = getSkidmarksSnapshot();
  const trimmed = name.trim();
  const bands = current.bands.map((b) => (b.id === bandId ? { ...b, name: trimmed } : b));
  persist({ ...current, bands });
}

/** Prepends a freshly generated look onto a member — newest look reads
 * first in the horizontal scroll, same "most recent first" spirit as the
 * band/project history elsewhere in this file. */
export function addSkidmarksLook(
  bandId: string,
  memberId: string,
  look: SkidmarksLook
): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) => {
    if (b.id !== bandId) return b;
    return {
      ...b,
      members: b.members.map((m) =>
        m.id === memberId ? { ...m, looks: [look, ...m.looks] } : m
      ),
    };
  });
  persist({ ...current, bands });
}

/** The band tile's pencil/camera "edit cover" glyph — sets a real cover
 * image Stuart picked from his device (already resized to a data URL by
 * `readImageFileAsDataUrl`), replacing the mock gradient on that tile. */
export function setSkidmarksBandCoverImage(bandId: string, dataUrl: string): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) =>
    b.id === bandId ? { ...b, coverImage: dataUrl } : b
  );
  persist({ ...current, bands });
}

/** Sets a member's real avatar photo (already resized to a data URL by
 * `readImageFileAsDataUrl`) — picked directly, not generated. Takes
 * priority over any generated look in `MemberAvatar`. */
export function setSkidmarksMemberAvatarImage(
  bandId: string,
  memberId: string,
  dataUrl: string
): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) => {
    if (b.id !== bandId) return b;
    return {
      ...b,
      members: b.members.map((m) =>
        m.id === memberId ? { ...m, avatarImage: dataUrl } : m
      ),
    };
  });
  persist({ ...current, bands });
}

/**
 * **Keep** — adds a plate still's Blob URL into this member's sleeve.
 * No generate-still call. No-ops when the URL is blank, already the
 * avatar, or already kept. Sleeve survives song switches (lives on the
 * member, not `session.mp3`).
 */
export function keepSkidmarksMemberSleeveStill(
  bandId: string,
  memberId: string,
  dataUrl: string
): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.map((b) => {
    if (b.id !== bandId) return b;
    return {
      ...b,
      members: b.members.map((m) => {
        if (m.id !== memberId) return m;
        const stillSleeve = appendKeptStillToSleeve(m, dataUrl, () => generateId("sleeve"));
        const prevUrls = (m.stillSleeve ?? []).map((e) => e.dataUrl).join("|");
        const nextUrls = stillSleeve.map((e) => e.dataUrl).join("|");
        if (prevUrls === nextUrls) return m;
        return { ...m, stillSleeve };
      }),
    };
  });
  persist({ ...current, bands });
}

/**
 * Pick a sleeve still onto a plate slot — free apply (`source:
 * "library"`), never a generate-still API call. Generate plates then
 * skips that row like an approved still.
 */
export function applySkidmarksMemberSleeveStillToPlate(
  segmentId: string,
  plateId: string,
  dataUrl: string
): void {
  const url = typeof dataUrl === "string" ? dataUrl.trim() : "";
  if (!url) return;
  setSkidmarksClipPlateStill(segmentId, plateId, buildLibraryPlateStill(url));
}

export function attachSkidmarksMp3(mp3: SkidmarksMp3Attachment): void {
  const current = getSkidmarksSnapshot();
  persist({ ...current, session: { ...current.session, mp3 } });
  // A new song is a new identity context too — see
  // `notifySkidmarksIdentityWipe`'s doc comment.
  notifySkidmarksIdentityWipe();
}

/** Fills in the real duration once the browser's `<audio>` metadata probe
 * resolves — attach happens immediately with `durationSec: null` so the
 * card can render right away instead of waiting on the probe. Also
 * drives the `timing` chip (`skidmarksChecklistState`) straight off
 * `durationSec !== null` — no separate timer/flag needed.
 *
 * **This was the one remaining "silently rebuild segments after #51"
 * gap** — real live-QA'd regression: "clip 1 lost again — gone back to
 * another version," same symptom as the bug #51 fixed, after #51+#53
 * had already landed. #51 gated `applySkidmarksAnalysisResult`/
 * `applySkidmarksTranscriptionResult` with `hasSkidmarksUserContent` +
 * `attachId`, but this function — the *third* real signal that can
 * resolve after attach and still rebuild `segments` off
 * `mp3.durationSec === null && segmentsSource === "seed-fallback"` —
 * was never given either guard. On iOS Safari an `<audio>` element's
 * `loadedmetadata` can be deferred well past attach (real quirk, not
 * hypothetical: iOS's power-saving media policy can delay metadata load
 * until Stuart actually taps Play), so there's a real window where he's
 * already tagged a door \u2192 keyhole \u2192 Jack strip on the
 * seed-fallback timeline before this ever fires — and when it finally
 * does, `buildDemoSegments(durationSec)` resegments the *entire* track
 * off the real duration (different boundaries than the fallback one he
 * tagged against) and silently discards every plate/prompt on it. Now
 * gated the same way as the other two: no-ops entirely for a stale
 * `attachId` (a slow/deferred metadata event for a since-replaced
 * attach), and never rebuilds once `hasSkidmarksUserContent` is true —
 * still honestly records the real `durationSec` either way (that alone
 * never loses anything), it just stops replacing `segments` out from
 * under whatever Stuart already built. See the "mp3-scoped resolve/mark
 * functions" note in AGENTS.md/this file's other `apply` and `mark`
 * functions — this one belongs to that same guarded family. */
export function setSkidmarksMp3Duration(attachId: string, durationSec: number): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  // The very first time a real duration resolves (attach always starts
  // with `durationSec: null`) *and* nothing real has replaced the seed
  // segments yet, *and* Stuart hasn't already tagged real content onto
  // the current timeline, rebuild segments off the real total instead
  // of the fallback one they were seeded with. If real analysis has
  // already finished (a fast decode can beat the `<audio>` element's
  // own probe), or Stuart's already plated/prompted a clip, leave
  // `segments` alone — don't clobber real output or real work with a
  // fresh seed rebuild.
  const alreadyTagged = hasSkidmarksUserContent(mp3.segments);
  const shouldRebuildSeed =
    mp3.durationSec === null && mp3.segmentsSource === "seed-fallback" && !alreadyTagged;
  const segments = shouldRebuildSeed ? buildDemoSegments(durationSec) : mp3.segments;
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: { ...mp3, durationSec, segments },
    },
  });
}

/** Records a successful MP3-audio Blob upload — see
 * `SkidmarksMp3Attachment.audioUrl`'s doc comment. No-ops if `attachId`
 * no longer matches the live `session.mp3` (removed, or replaced by a
 * newer attach, before the upload finished) — see
 * `SkidmarksMp3Attachment.attachId`'s doc comment. */
export function setSkidmarksMp3AudioUrl(attachId: string, audioUrl: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: { ...mp3, audioUrl, audioPersistStatus: "done", audioPersistError: undefined },
    },
  });
}

/** Marks the MP3-audio Blob upload as unconfigured (no Blob store
 * connected here) or genuinely failed — distinct outcomes, same honest
 * split as `markSkidmarksTranscriptionUnconfigured`/
 * `markSkidmarksTranscriptionFailed`. Playback from the local, in-tab
 * object URL is completely unaffected either way — this only means
 * playback won't survive a refresh this time. No-ops if `attachId` no
 * longer matches the live `session.mp3` — see
 * `SkidmarksMp3Attachment.attachId`'s doc comment. */
export function markSkidmarksMp3AudioUnconfigured(attachId: string, reason: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  persist({
    ...current,
    session: { ...current.session, mp3: { ...mp3, audioPersistStatus: "unconfigured", audioPersistError: reason } },
  });
}

export function markSkidmarksMp3AudioFailed(attachId: string, reason: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  persist({
    ...current,
    session: { ...current.session, mp3: { ...mp3, audioPersistStatus: "failed", audioPersistError: reason } },
  });
}

/** Builds the segment list shared by `applySkidmarksAnalysisResult` and
 * `applySkidmarksTranscriptionResult` — both turn a plain "is this
 * vocal" time-range list into tagged `SkidmarksClipSegment`s the same
 * way (via `buildDefaultSegment`), they just get that time-range list
 * from different real sources. */
function buildSegmentsFromVocalRanges(
  ranges: { startSec: number; endSec: number; vocal: boolean }[]
): SkidmarksClipSegment[] {
  return ranges.map((seg) =>
    buildDefaultSegment(seg.startSec, seg.endSec, seg.vocal ? "vocal" : "instrumental")
  );
}

/**
 * True once Stuart has actually put real work into the *current*
 * segment list — a filled plate, a shot prompt, a per-plate motion
 * note, an extra "+" plate slot, an explicit plate selection, or a
 * manually-picked model. Purely derived from `segments` themselves
 * (never a separate stored flag) — a fresh seed/analysis timeline
 * nobody has touched yet always reads `false`.
 *
 * **This is the actual fix for "clip 1 resolved back to an older clip"
 * / "all Vocal plates disappeared."** `applySkidmarksAnalysisResult`
 * and `applySkidmarksTranscriptionResult` used to unconditionally
 * rebuild the *entire* `segments` array from scratch (fresh ids, one
 * blank plate each) the moment either resolved — correct the very
 * first time (nothing's tagged yet), but the energy heuristic resolves
 * client-side-fast while real transcription is a genuine network round
 * trip against a whole song; there was nothing stopping Stuart from
 * already tagging several plates on the fast heuristic's timeline
 * before the slower, "more correct" transcription result finally landed
 * and silently discarded all of it, wholesale, with no merge and no
 * warning. Both call sites now check this before rebuilding — once it's
 * `true`, a later resolve still records the real
 * `analysisStatus`/`transcriptionStatus`/`segmentsSource` honestly (so
 * the checklist chips never lie), it just stops replacing `segments`
 * out from under whatever Stuart already built. */
function hasSkidmarksUserContent(segments: SkidmarksClipSegment[]): boolean {
  return segments.some(
    (s) =>
      s.shotPrompt.trim().length > 0 ||
      s.uncensoredPlateStills ||
      (s.selectedPlateId != null && s.selectedPlateId.length > 0) ||
      s.plates.length > 1 ||
      s.plates.some((p) => !!p.still || !!p.motionPrompt) ||
      s.model !== defaultSegmentModel(s.label)
  );
}

/**
 * Applies a finished `analyzeVocalActivity` result: maps its real
 * vocal/instrumental time ranges into `SkidmarksClipSegment`s (each
 * still gets a default model via `defaultSegmentModel`, same rule as
 * the seed cadence), marks `segmentsSource: "analysis"` and
 * `analysisStatus: "done"`, and backfills `durationSec` if the
 * `<audio>` element's own probe hasn't resolved yet (the decoded
 * buffer's duration is just as real, sometimes faster).
 *
 * **Never downgrades a real transcription result.** Real word-level
 * transcription (`segmentsSource === "transcription"`) always outranks
 * this heuristic — if transcription already landed (it can resolve
 * before or after this, since both run in parallel from attach), this
 * still records `analysisStatus: "done"` (the heuristic itself did run
 * and succeed) but leaves `segments`/`segmentsSource` alone rather than
 * replacing real transcribed timing with the heuristic's.
 *
 * **Never clobbers real work Stuart already did**, either —
 * `hasSkidmarksUserContent` (see its own doc comment for the exact live
 * bug this fixes) gates the rebuild the same way the transcription
 * check does: once any current segment has a filled plate, a shot
 * prompt, or any other real tagging on it, this still records
 * `analysisStatus: "done"` honestly but leaves `segments`/
 * `segmentsSource` untouched instead of overwriting them.
 *
 * No-ops entirely if `attachId` no longer matches the live
 * `session.mp3` — the mp3 was removed, or replaced by a newer attach,
 * before this resolved (see `SkidmarksMp3Attachment.attachId`'s doc
 * comment for why this is checked here, durably, rather than trusting
 * only a caller-side generation-token check).
 */
export function applySkidmarksAnalysisResult(attachId: string, result: VocalAnalysisResult): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  const hasRealTranscription = mp3.segmentsSource === "transcription";
  const alreadyTagged = hasSkidmarksUserContent(mp3.segments);
  const segments =
    hasRealTranscription || alreadyTagged ? mp3.segments : buildSegmentsFromVocalRanges(result.segments);
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: {
        ...mp3,
        durationSec: mp3.durationSec ?? result.durationSec,
        segments,
        segmentsSource: hasRealTranscription || alreadyTagged ? mp3.segmentsSource : "analysis",
        analysisStatus: "done",
        analysisError: undefined,
      },
    },
  });
}

/**
 * Marks the energy heuristic as failed, keeping whatever segments are
 * currently set (the seed fallback `createMp3Attachment` seeded, or a
 * real transcription result if that's already landed) but honestly
 * labeling them via `segmentsSource`/`analysisStatus`/`analysisError` —
 * never silently presenting the fallback as real. `reason` is shown
 * verbatim in the timeline's caption, so keep it short and
 * non-technical where possible. Like `applySkidmarksAnalysisResult`,
 * never downgrades an already-real transcription result, and (per
 * `hasSkidmarksUserContent`) never relabels an already-tagged timeline
 * back to `"seed-fallback"` just because the heuristic itself failed.
 * No-ops if `attachId` no longer matches the live `session.mp3` — see
 * `SkidmarksMp3Attachment.attachId`'s doc comment.
 */
export function markSkidmarksAnalysisFailed(attachId: string, reason: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  const hasRealTranscription = mp3.segmentsSource === "transcription";
  const alreadyTagged = hasSkidmarksUserContent(mp3.segments);
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: {
        ...mp3,
        segmentsSource: hasRealTranscription || alreadyTagged ? mp3.segmentsSource : "seed-fallback",
        analysisStatus: "failed",
        analysisError: reason,
      },
    },
  });
}

/**
 * Applies a finished real transcription: turns `transcribeAudio`'s
 * per-word start/end times (`lib/transcription.ts`) into vocal/
 * instrumental time ranges via `segmentsFromWords` (word gaps over
 * ~2s become instrumental breaks), then checks
 * `hasUsefulVocalCoverage` on that real merged map before trusting it.
 *
 * **This coverage check is the actual fix for the reported bug**, not
 * just the ElevenLabs-primary provider pivot: a live run against Jack
 * Ash's "Talking To Concrete" (~4:16, real singing from ~0:32) came back
 * green Lyrics + a single Instrumental 0:00–4:16 segment. The provider
 * that produced that (Whisper, on this *sung* track) returned real,
 * non-empty `words` — this function used to treat "transcription
 * returned words" as "transcription produced a useful map" and set
 * `segmentsSource: "transcription"`/`transcriptionStatus: "done"`
 * unconditionally on any non-empty word list, which is exactly how that
 * got shown as genuinely green. Now it doesn't: `words` and the merged
 * `segments` are only trusted (`segmentsSource: "transcription"`,
 * `transcriptionStatus: "done"` — the only path that turns the Lyrics
 * chip genuinely green) once `hasUsefulVocalCoverage` confirms the real
 * merged map actually covers enough of the track to be worth showing.
 *
 * If it doesn't clear that bar, this still records the attempt
 * honestly as `transcriptionStatus: "sparse"` (a distinct outcome from
 * both `"done"` and `"failed"` — the request itself succeeded, a
 * provider really did respond, it just didn't yield a usable map for
 * *this* track) with a plain-language `transcriptionError` explaining
 * the actual coverage numbers, and — like a failed heuristic keeping
 * an already-real transcription result — leaves `segments`/
 * `segmentsSource` untouched rather than downgrading whatever's already
 * showing (a real heuristic result, or the seed fallback) to something
 * worse. The raw `words` list is still kept either way (unused by the
 * UI today beyond driving segments, but kept so a later per-word
 * lyric-emphasis pass doesn't need to re-transcribe), and so is
 * `provider` (which backend actually answered), so the caption can be
 * accurate either way.
 *
 * A *useful* transcription result always wins over whatever's currently
 * showing — outranking both the energy heuristic and the seed cadence,
 * regardless of which resolved first (both start in parallel from
 * attach; transcription's network round-trip means it can land either
 * before or after the heuristic) — **unless Stuart has already tagged
 * real content onto the current timeline** (`hasSkidmarksUserContent`
 * — see its doc comment for the exact live bug this fixes: a real STT
 * round-trip against a whole song is genuinely slow, plenty of time to
 * have already started plating clips off the fast heuristic's
 * timeline before this lands). In that case this still records
 * `transcriptionStatus`/`transcriptionProvider` honestly, it just
 * leaves `segments`/`segmentsSource` alone instead of discarding
 * Stuart's work for a "more correct" timeline.
 *
 * No-ops entirely if `attachId` no longer matches the live
 * `session.mp3` — see `SkidmarksMp3Attachment.attachId`'s doc comment.
 */
export function applySkidmarksTranscriptionResult(
  attachId: string,
  words: SkidmarksTranscribedWord[],
  reportedDurationSec: number | null,
  provider?: SkidmarksTranscriptionProvider
): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  const totalSec = mp3.durationSec ?? reportedDurationSec ?? DEMO_SEGMENT_FALLBACK_DURATION_SEC;
  const wordSegments = segmentsFromWords(words, totalSec);
  const alreadyTagged = hasSkidmarksUserContent(mp3.segments);

  if (!hasUsefulVocalCoverage(wordSegments, totalSec)) {
    const coveredSec = vocalCoverageSec(wordSegments);
    persist({
      ...current,
      session: {
        ...current.session,
        mp3: {
          ...mp3,
          durationSec: mp3.durationSec ?? reportedDurationSec,
          words,
          transcriptionStatus: "sparse",
          transcriptionProvider: provider,
          // Names the actual provider that answered (see
          // `transcriptionProviderLabel`) \u2014 a live sparse-coverage
          // report against this exact message shape ("Transcription
          // returned 28 words...") showed up with no provider named at
          // all, leaving Stuart unable to tell whether ElevenLabs or
          // Whisper produced the sparse result from the UI alone. See
          // hypothesis 5 in this fix's PR description.
          transcriptionError:
            `${transcriptionProviderLabel(provider)} returned ${words.length} ` +
            `word${words.length === 1 ? "" : "s"}, but only ${coveredSec.toFixed(1)}s of that ` +
            `mapped to singing across a ${totalSec.toFixed(0)}s track \u2014 not enough to ` +
            "trust as a real vocal map. Showing the energy heuristic instead.",
        },
      },
    });
    return;
  }

  const segments = alreadyTagged ? mp3.segments : buildSegmentsFromVocalRanges(wordSegments);
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: {
        ...mp3,
        durationSec: mp3.durationSec ?? reportedDurationSec,
        words,
        segments,
        segmentsSource: alreadyTagged ? mp3.segmentsSource : "transcription",
        transcriptionStatus: "done",
        transcriptionProvider: provider,
        transcriptionError: undefined,
      },
    },
  });
}

/**
 * Marks transcription as unconfigured — the server has neither
 * `ELEVENLABS_API_KEY` nor `ELEVEN_LABS_API_KEY` set. Deliberately **not**
 * treated as a failure (no amber "error" styling implied beyond what
 * the energy-heuristic/seed fallback already honestly shows) since
 * nothing actually went wrong; transcription just isn't wired up in
 * this environment. `reason` is the server's own explanation, shown
 * verbatim in the timeline's caption. No-ops if `attachId` no longer
 * matches the live `session.mp3` — see
 * `SkidmarksMp3Attachment.attachId`'s doc comment.
 */
export function markSkidmarksTranscriptionUnconfigured(attachId: string, reason: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: { ...mp3, transcriptionStatus: "unconfigured", transcriptionError: reason },
    },
  });
}

/**
 * Marks a *configured* transcription request as failed (network error,
 * bad audio, an actual upstream API error) — distinct from
 * `markSkidmarksTranscriptionUnconfigured`, which covers the honest
 * "no key set" case. `reason` is shown verbatim in the timeline's
 * caption. No-ops if `attachId` no longer matches the live
 * `session.mp3` — see `SkidmarksMp3Attachment.attachId`'s doc comment.
 */
export function markSkidmarksTranscriptionFailed(attachId: string, reason: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: { ...mp3, transcriptionStatus: "failed", transcriptionError: reason },
    },
  });
}

export function clearSkidmarksMp3(): void {
  const current = getSkidmarksSnapshot();
  if (!current.session.mp3) return;
  persist({ ...current, session: { ...current.session, mp3: null } });
}

function updateSkidmarksSegment(
  segmentId: string,
  updater: (segment: SkidmarksClipSegment) => SkidmarksClipSegment
): void {
  const current = getSkidmarksSnapshot();
  if (!current.session.mp3) return;
  const segments = current.session.mp3.segments.map((s) =>
    s.id === segmentId ? updater(s) : s
  );
  persist({
    ...current,
    session: { ...current.session, mp3: { ...current.session.mp3, segments } },
  });
}

/**
 * Pure boundary-nudge math — exported mainly so it's directly testable
 * without touching the `localStorage`-backed store; the real setters
 * (`nudgeSkidmarksSegmentStart`/`nudgeSkidmarksSegmentEnd`) just wrap
 * this around `getSkidmarksSnapshot`/`persist`.
 *
 * **Every real segment source this store ever builds is contiguous**
 * (`buildDemoSegments`, `buildSegmentsFromVocalRanges` off either
 * `analyzeVocalActivity`'s heuristic or `segmentsFromWords`'
 * transcription output all walk a `cursor` forward with no gaps) —
 * `segments[i].endSec === segments[i + 1].startSec` always holds before
 * a nudge. That invariant is what makes "clamp only" vs. "gently adjust
 * the adjacent boundary" (the two options this feature's task called
 * out to investigate) an easy pick rather than a coin flip: nudging one
 * clip's `start`/`end` is really nudging the **shared cut point** with
 * its neighbor, so this always moves both sides of that cut together —
 * stretching this clip by however many seconds shrinks the neighbor by
 * the exact same amount, and the timeline stays gap-free/overlap-free
 * automatically, with no separate "did this create a gap?" check
 * needed anywhere else. A plain clamp-only approach (only ever touching
 * the one segment being nudged) would either open a silent gap or let
 * two clips overlap the moment the nudged edge crosses into the
 * neighbor's own span — exactly what "clips don't overlap illegally"
 * rules out.
 *
 * Clamped on both ends of the move so neither this clip nor the
 * neighbor it's borrowing from/lending to ever drops below
 * `MIN_NUDGE_SEGMENT_SEC`, and so the very first clip's `startSec`
 * never goes below `0` or the very last clip's `endSec` never passes
 * `totalDurationSec` once that's known (still unbounded above while
 * `totalDurationSec` is `null` — e.g. the brief window before the
 * `<audio>` duration probe resolves — rather than silently refusing to
 * nudge the last clip at all during that window).
 *
 * Returns the **same** `segments` array reference, unchanged, when
 * `segmentId` isn't found or the requested nudge is already a genuine
 * no-op (already sitting at a bound) — lets callers skip a pointless
 * `persist`/re-render.
 */
export function nudgeSkidmarksSegmentBoundary(
  segments: SkidmarksClipSegment[],
  segmentId: string,
  edge: "start" | "end",
  deltaSec: number,
  totalDurationSec: number | null
): SkidmarksClipSegment[] {
  const index = segments.findIndex((s) => s.id === segmentId);
  if (index === -1 || deltaSec === 0) return segments;
  const segment = segments[index];

  if (edge === "start") {
    const prev = index > 0 ? segments[index - 1] : undefined;
    const lowerBoundRaw = prev ? prev.startSec + MIN_NUDGE_SEGMENT_SEC : 0;
    const upperBound = segment.endSec - MIN_NUDGE_SEGMENT_SEC;
    // If the segment/neighbor were already shorter than
    // `MIN_NUDGE_SEGMENT_SEC` going in (pre-existing data this feature
    // didn't create), keep the clamp order sane rather than letting a
    // too-high lower bound push the result past the upper one.
    const lowerBound = Math.min(lowerBoundRaw, upperBound);
    const newStart = Math.min(upperBound, Math.max(lowerBound, segment.startSec + deltaSec));
    if (newStart === segment.startSec) return segments;
    return segments.map((s, i) => {
      if (i === index) return { ...s, startSec: newStart };
      if (prev && i === index - 1) return { ...s, endSec: newStart };
      return s;
    });
  }

  const next = index < segments.length - 1 ? segments[index + 1] : undefined;
  const lowerBound = segment.startSec + MIN_NUDGE_SEGMENT_SEC;
  const upperBoundRaw = next
    ? next.endSec - MIN_NUDGE_SEGMENT_SEC
    : totalDurationSec !== null
      ? totalDurationSec
      : Infinity;
  const upperBound = Math.max(lowerBound, upperBoundRaw);
  const newEnd = Math.min(upperBound, Math.max(lowerBound, segment.endSec + deltaSec));
  if (newEnd === segment.endSec) return segments;
  return segments.map((s, i) => {
    if (i === index) return { ...s, endSec: newEnd };
    if (next && i === index + 1) return { ...s, startSec: newEnd };
    return s;
  });
}

/**
 * Whether a given nudge would actually move anything. Originally the
 * old stepper's own disabled-state check for each of its four buttons;
 * `components/SkidmarksClipTimingHeaderEdit.tsx`'s double-tap-to-edit
 * replacement doesn't need a precomputed flag per direction (an
 * arbitrary typed value just gets clamped by the setters below), so
 * this is currently unused in this app's own UI — kept as a small,
 * still-correct, still-tested pure helper (reuses the exact same clamp
 * math the real setters commit with) in case a future control needs
 * the same "would this actually move anything" check again.
 */
export function canNudgeSkidmarksSegmentBoundary(
  segments: SkidmarksClipSegment[],
  segmentId: string,
  edge: "start" | "end",
  deltaSec: number,
  totalDurationSec: number | null
): boolean {
  return nudgeSkidmarksSegmentBoundary(segments, segmentId, edge, deltaSec, totalDurationSec) !== segments;
}

/**
 * The clip-row header's double-tap-to-edit store-level setter for a
 * clip's **start** boundary (`components
 * /SkidmarksClipTimingHeaderEdit.tsx`) — Stuart's 2026-09-13 "let me
 * slip a clip's start/end after transcription" ask.
 * Only ever edits the already-resolved `startSec`s already sitting on
 * `session.mp3.segments` — **never** re-runs ElevenLabs Scribe or the
 * energy heuristic, and never touches `segmentsSource`/
 * `transcriptionStatus`/`analysisStatus` (a nudge doesn't change which
 * signal originally produced this timeline, just where its cuts fall).
 * See `nudgeSkidmarksSegmentBoundary`'s doc comment for exactly how the
 * shared neighbor boundary moves along with it. No-ops if there's no
 * attached mp3, the segment doesn't exist, or the nudge is already at
 * a bound.
 */
export function nudgeSkidmarksSegmentStart(segmentId: string, deltaSec: number): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3) return;
  const segments = nudgeSkidmarksSegmentBoundary(mp3.segments, segmentId, "start", deltaSec, mp3.durationSec);
  if (segments === mp3.segments) return;
  persist({ ...current, session: { ...current.session, mp3: { ...mp3, segments } } });
}

/** Same as `nudgeSkidmarksSegmentStart`, for a clip's **end** boundary. */
export function nudgeSkidmarksSegmentEnd(segmentId: string, deltaSec: number): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3) return;
  const segments = nudgeSkidmarksSegmentBoundary(mp3.segments, segmentId, "end", deltaSec, mp3.durationSec);
  if (segments === mp3.segments) return;
  persist({ ...current, session: { ...current.session, mp3: { ...mp3, segments } } });
}

/** One-tap model switch — per Stuart's cost lock, this is the *only*
 * way a segment's `model` ever becomes H3 or Seedance (or LTX/Grok
 * against Stuart's own wishes on a clip): `defaultSegmentModel` will
 * never pick either automatically, and nothing else in this file calls
 * this function on the app's own initiative. Not reachable from the
 * main clip UI right now — there's no model pill to tap (see
 * `SkidmarksClipStub`'s doc comment) — so today this only ever fires
 * via `defaultSegmentModel`'s auto-assignment path; it's kept as a
 * public setter for when a real still lands and a manual override
 * becomes worth surfacing. */
export function setSkidmarksSegmentModel(segmentId: string, model: SkidmarksModelId): void {
  updateSkidmarksSegment(segmentId, (s) => ({ ...s, model }));
}

/** The H3/Grok switch inside the Render confirm
 * (`components/SkidmarksClipRender.tsx`) — the *only* way a clip's
 * Instrumental video-render backend choice ever changes; nothing in
 * this file flips it on its own initiative. Distinct from
 * `setSkidmarksSegmentModel` above — see
 * `SkidmarksInstrumentalVideoModel`'s doc comment for why these stay
 * two separate fields rather than one. No-ops if the segment doesn't
 * exist. */
export function setSkidmarksSegmentInstrumentalVideoModel(
  segmentId: string,
  model: SkidmarksInstrumentalVideoModel
): void {
  updateSkidmarksSegment(segmentId, (s) => ({ ...s, instrumentalVideoModel: model }));
}

/** The plain-language "what happens in this shot" field on the expanded
 * panel — deliberately short (no lyric dumps, no long captions). Per
 * Stuart's cost lock, editing this **no longer touches `model`** (an
 * earlier pass re-derived the model from the prompt's language; that
 * could have quietly rotated a clip onto a pricier pill without an
 * explicit tap, which is exactly what the cost lock rules out) — this
 * only ever updates the prompt text now. */
export function setSkidmarksSegmentShotPrompt(segmentId: string, shotPrompt: string): void {
  updateSkidmarksSegment(segmentId, (s) => ({ ...s, shotPrompt }));
}

/** The counterpart "what to keep out of this shot" field — see
 * `SkidmarksClipSegment.negativePrompt`'s doc comment for what this
 * actually reaches (Vocal/LTX only). */
export function setSkidmarksSegmentNegativePrompt(segmentId: string, negativePrompt: string): void {
  updateSkidmarksSegment(segmentId, (s) => ({ ...s, negativePrompt }));
}

export interface ChainedPlateTarget {
  segmentId: string;
  plateId: string;
  /** Whether the rendered plate this chains *from* already featured a
   * locked character — copied forward onto the new chained still so a
   * later plate that continues from *it* (`buildPlateGenerationRequest`'s
   * `continuityFeaturesLockedCharacter`) still resolves correctly,
   * same "only from the source still's own resolved fact" rule as
   * every other continuity hop in this feature. */
  featuresLockedCharacter: boolean;
}

/**
 * Pure planner for Stuart's "last frame becomes the next clip's first
 * frame" ask (2026-09-14, real-world example: a Grok Instrumental clip he
 * wants chained through the whole song) — decides *whether and where* a
 * just-finished render's closing frame should land, without doing any of
 * the actual work (extracting the frame, uploading it, writing it back)
 * itself. Same "pure planner, side-effecting runner" split
 * `lib/autoPlate.ts`'s `planAutoPlateFill` already uses, for the same
 * reason: the decision (which plate, if any) is fully unit-testable
 * without a real video file or network call, while the actual frame
 * carry — server-side extraction (`lib/serverVideoFrame.ts`) that
 * already happened by the time a render is persisted — stays in
 * `SkidmarksDetailSheet.tsx`'s `handlePersisted`, which actually calls
 * this.
 *
 * Returns `undefined` — meaning "do nothing" — when: the rendered
 * segment isn't found (a stale/mismatched render record), it's already
 * the last segment in the song (nothing to chain into), the next
 * segment has no first plate slot, or that first plate already has a
 * still — **never** overwrites a still Stuart already picked or
 * generated himself, automatic or not.
 */
export function resolveChainedPlateTarget(
  segments: SkidmarksClipSegment[],
  renderedSegmentId: string,
  renderedPlateId: string
): ChainedPlateTarget | undefined {
  const index = segments.findIndex((s) => s.id === renderedSegmentId);
  if (index === -1 || index === segments.length - 1) return undefined;
  const nextSegment = segments[index + 1];
  const nextPlate = nextSegment.plates[0];
  if (!nextPlate || nextPlate.still) return undefined;

  const renderedPlate = segments[index].plates.find((p) => p.id === renderedPlateId);
  return {
    segmentId: nextSegment.id,
    plateId: nextPlate.id,
    featuresLockedCharacter: renderedPlate?.still?.featuresLockedCharacter === true,
  };
}

/** Sets, replaces, or clears one plate slot's still — the multi-plate
 * successor to the old single-still `setSkidmarksSegmentStill`, scoped
 * to one slot in `SkidmarksClipSegment.plates` by `plateId`. Passing
 * `null` clears that slot back to its empty dashed placeholder (Stuart's
 * original "small clear/X on the plate" ask, now per-slot) — it does
 * **not** remove the slot itself (see `removeSkidmarksClipPlate` for
 * that); nothing here auto-clears a still on its own (e.g. editing the
 * shared shot prompt afterward doesn't stale-invalidate any slot —
 * regenerating is an explicit tap, same spirit as
 * `setSkidmarksSegmentShotPrompt` never touching `model`). No-ops if the
 * segment or that specific plate slot doesn't exist. */
export function setSkidmarksClipPlateStill(
  segmentId: string,
  plateId: string,
  still: SkidmarksPlateStill | null
): void {
  updateSkidmarksSegment(segmentId, (s) => ({
    ...s,
    plates: s.plates.map((p) => {
      if (p.id !== plateId) return p;
      return still === null ? { id: p.id } : { id: p.id, still };
    }),
  }));
}

/** The corner select control on a filled plate tile — sets which single
 * plate this clip's Render uses next (radio-style; see
 * `resolveSelectedPlateId`'s doc comment). No-ops if the segment doesn't
 * exist; deliberately does **not** validate that `plateId` is currently
 * filled here — `resolveSelectedPlateId` is what falls back honestly if
 * the picked plate is later cleared, so this setter can stay a plain,
 * unconditional write. */
export function setSkidmarksSegmentSelectedPlate(segmentId: string, plateId: string): void {
  updateSkidmarksSegment(segmentId, (s) => ({ ...s, selectedPlateId: plateId }));
}

/** This plate's own stored camera-motion direction — the one per-plate
 * exception to the "one shared field per clip" plating lock (see
 * `SkidmarksClipPlateSlot.motionPrompt`'s doc comment for why). No-ops
 * if the segment or that specific plate slot doesn't exist. */
/** Records what a plate's render is about to send — see
 * `SkidmarksClipSentPayload`. */
export function setSkidmarksClipPlateLastSent(segmentId: string, plateId: string, sent: SkidmarksClipSentPayload): void {
  updateSkidmarksSegment(segmentId, (segment) => ({
    ...segment,
    plates: segment.plates.map((plate) => (plate.id === plateId ? { ...plate, lastSent: sent } : plate)),
  }));
}

export function setSkidmarksClipPlateMotionPrompt(
  segmentId: string,
  plateId: string,
  motionPrompt: string
): void {
  updateSkidmarksSegment(segmentId, (s) => ({
    ...s,
    plates: s.plates.map((p) => (p.id === plateId ? { ...p, motionPrompt } : p)),
  }));
}

/** The "+" control on a clip's plate strip — appends one more empty
 * slot so Stuart can generate/upload a different still for it (door →
 * keyhole → Jack, all under the same 0:00–0:40 clip). Capped at
 * `MAX_PLATES_PER_CLIP`; no-ops past that cap or if the segment doesn't
 * exist. */
export function addSkidmarksClipPlate(segmentId: string): void {
  updateSkidmarksSegment(segmentId, (s) => {
    if (s.plates.length >= MAX_PLATES_PER_CLIP) return s;
    return { ...s, plates: [...s.plates, buildBlankPlateSlot()] };
  });
}

/** Removes one plate slot outright — undoing an accidental "+" (or a
 * slot Stuart cleared and no longer wants taking up room in the strip).
 * Deliberately narrow: only ever removes a slot that's currently
 * **empty** (clearing a real still is `setSkidmarksClipPlateStill(...,
 * null)`, a separate, non-destructive step — this function never
 * discards a real still as a side effect of removing its slot), and
 * only when the clip has **more than one** slot, so `plates` can never
 * end up empty. No-ops (silently keeps the slot) if either guard fails,
 * or if the segment/slot doesn't exist. */
export function removeSkidmarksClipPlate(segmentId: string, plateId: string): void {
  updateSkidmarksSegment(segmentId, (s) => {
    if (s.plates.length <= 1) return s;
    const plate = s.plates.find((p) => p.id === plateId);
    if (!plate || plate.still) return s;
    return { ...s, plates: s.plates.filter((p) => p.id !== plateId) };
  });
}

/** SIRAY's one narrow toggle — **uncensored plate stills only**, never
 * read by `model`/Generate Clips (see `SKIDMARKS_UNCENSORED_STILLS_LABEL`).
 * Exists so the capability is one call away, but nothing in the main
 * plating UI calls it in this pass — see that constant's doc comment. */
export function setSkidmarksSegmentUncensoredPlateStills(
  segmentId: string,
  uncensoredPlateStills: boolean
): void {
  updateSkidmarksSegment(segmentId, (s) => ({ ...s, uncensoredPlateStills }));
}

/**
 * Restores an archived band + mp3 attachment into the live top
 * workspace — the "Open in editor" action on an archived song row (see
 * `lib/skidmarksArchive.ts`). Per AGENTS.md's "one live edit workspace
 * on top, never stack a second full MP3/plates UI" lock, the caller is
 * responsible for archiving whatever's currently live *first* if
 * anything is — this function itself just replaces `session` outright.
 * Adds the band back to `bands` if it isn't there anymore (deleted,
 * or from a different browser/session originally), or replaces it in
 * place if it is — either way, the restored band matches exactly what
 * was archived, not whatever's since changed under the same id.
 */
/**
 * Rebuilds a pasteable Script Sequence string from persisted clip
 * segments — fallback when an archive snapshot has no
 * `scriptSequenceDraft` (snapshots written before that field shipped)
 * but the segments still carry `shotPrompt` / `negativePrompt` from a
 * prior Generate. Pure; empty string when nothing useful to show.
 */
export function buildScriptSequenceTextFromSegments(segments: SkidmarksClipSegment[]): string {
  const useful = segments.filter(
    (s) => s.shotPrompt.trim().length > 0 || s.negativePrompt.trim().length > 0
  );
  if (useful.length === 0) return "";

  const formatClock = (sec: number): string => {
    const whole = Math.max(0, Math.round(sec));
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return segments
    .map((seg, i) => {
      const title = seg.label === "vocal" ? "Vocal" : "Instrumental";
      const dur = Math.max(0, Math.round(seg.endSec - seg.startSec));
      const lines: string[] = [
        `Part ${i + 1} (${formatClock(seg.startSec)} - ${formatClock(seg.endSec)}) — ${title}[Duration: ${dur}s].`,
      ];
      const pos = seg.shotPrompt.trim();
      const neg = seg.negativePrompt.trim();
      if (pos) {
        lines.push("Positive Prompt:");
        lines.push(pos);
      }
      if (neg) {
        lines.push("Negative Prompt:");
        lines.push(neg);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Picks the Script Sequence draft to restore from an archive snapshot:
 * prefer the snapshot's own draft when present; otherwise rebuild from
 * segment prompts so older archives still show what was generated. */
export function resolveScriptSequenceDraftFromArchive(
  snapshotDraft: SkidmarksScriptSequenceDraft | null | undefined,
  mp3: SkidmarksMp3Attachment
): SkidmarksScriptSequenceDraft | null {
  if (snapshotDraft && typeof snapshotDraft.script === "string") {
    return {
      script: snapshotDraft.script,
      ...(typeof snapshotDraft.startingImageUrl === "string"
        ? { startingImageUrl: snapshotDraft.startingImageUrl }
        : {}),
      ...(snapshotDraft.chainLastFrameToNext === true ? { chainLastFrameToNext: true } : {}),
    };
  }
  const rebuilt = buildScriptSequenceTextFromSegments(mp3.segments ?? []);
  return rebuilt.trim() ? { script: rebuilt } : null;
}

export function restoreSkidmarksArchivedSession(
  band: SkidmarksBand,
  mp3: SkidmarksMp3Attachment,
  scriptSequenceDraft: SkidmarksScriptSequenceDraft | null = null
): void {
  const current = getSkidmarksSnapshot();
  const bands = current.bands.some((b) => b.id === band.id)
    ? current.bands.map((b) => (b.id === band.id ? band : b))
    : [band, ...current.bands];
  const restoredDraft = resolveScriptSequenceDraftFromArchive(scriptSequenceDraft, mp3);
  // What's now live is byte-for-byte what's on the Finished Songs shelf
  // — record that, so leaving this song again doesn't upload a second
  // identical row (see `SkidmarksMp3Attachment.lastArchivedFingerprint`).
  // Fingerprint includes the script draft so a Script Sequence-only edit
  // after Open still counts as "changed" for the next Archive.
  const restoredMp3: SkidmarksMp3Attachment = {
    ...mp3,
    lastArchivedFingerprint: computeSkidmarksArchiveFingerprint(band, mp3, restoredDraft),
  };
  persist({
    ...current,
    bands,
    session: {
      projectKind: "music-video",
      bandId: band.id,
      mp3: restoredMp3,
      scriptSequenceDraft: restoredDraft,
    },
  });
  // Restoring an archived song swaps in a (possibly different) band +
  // mp3 wholesale, same identity-context-change shape as
  // `selectSkidmarksBand`/`attachSkidmarksMp3` — see
  // `notifySkidmarksIdentityWipe`'s doc comment.
  notifySkidmarksIdentityWipe();
}

/**
 * Cheap, deterministic content hash (FNV-1a, 32-bit, hex) of the exact
 * band+mp3 pair an archive snapshot would carry — `lastArchivedFingerprint`
 * itself is excluded so recording the hash doesn't change the hash.
 * Pure; same inputs always give the same string.
 */
export function computeSkidmarksArchiveFingerprint(
  band: SkidmarksBand,
  mp3: SkidmarksMp3Attachment,
  scriptSequenceDraft?: SkidmarksScriptSequenceDraft | null
): string {
  const { lastArchivedFingerprint: _ignored, ...rest } = mp3;
  void _ignored;
  // Omit a null/empty draft from the payload so fingerprints written
  // before Script Sequence drafts were archived still match an open
  // that has no draft. A real draft (script string present) is included
  // so editing only the Script Sequence textarea invalidates "already
  // archived" and a fresh Archive keeps the new prompts.
  const payload =
    scriptSequenceDraft && typeof scriptSequenceDraft.script === "string"
      ? { band, mp3: rest, scriptSequenceDraft }
      : { band, mp3: rest };
  const text = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(16)}-${hash.toString(16).padStart(8, "0")}`;
}

/** Whether the live band+mp3 pair is already on the Finished Songs
 * shelf unchanged — i.e. a fresh Archive would only duplicate a row. */
export function isSkidmarksSessionAlreadyArchived(
  band: SkidmarksBand,
  mp3: SkidmarksMp3Attachment,
  scriptSequenceDraft?: SkidmarksScriptSequenceDraft | null
): boolean {
  return (
    !!mp3.lastArchivedFingerprint &&
    mp3.lastArchivedFingerprint === computeSkidmarksArchiveFingerprint(band, mp3, scriptSequenceDraft)
  );
}

/** Records that the live band+mp3 pair was just saved to Finished
 * Songs — called right after a successful `archiveSkidmarksSession`.
 * No-op if the mp3 has changed identity since (a late result landing
 * on a different attach), same `attachId` guard every async setter
 * here uses. */
export function markSkidmarksSessionArchived(attachId: string, fingerprint: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3 || mp3.attachId !== attachId) return;
  persist({ ...current, session: { ...current.session, mp3: { ...mp3, lastArchivedFingerprint: fingerprint } } });
}

/** Clears the live workspace back to "choose a band" right after a
 * successful Archive — the top workspace is immediately ready for a
 * new/different song, per the "one live workspace, never doubled" lock.
 * Never touches `bands` — archiving snapshots and clears the *session*,
 * it doesn't delete the band itself. */
export function resetSkidmarksSessionAfterArchive(): void {
  const current = getSkidmarksSnapshot();
  persist({ ...current, session: { projectKind: "music-video", bandId: null, mp3: null, scriptSequenceDraft: null } });
  notifySkidmarksIdentityWipe();
}

export function getActiveSkidmarksBand(
  state: SkidmarksState
): SkidmarksBand | undefined {
  return state.bands.find((b) => b.id === state.session.bandId);
}

/** Deterministic album-cover gradient class for a band tile, keyed off
 * `coverSeed` — a small fixed palette so covers stay visually distinct
 * without needing real artwork. */
const COVER_GRADIENTS = [
  "from-rose-600/70 via-red-900/70 to-black",
  "from-indigo-600/70 via-purple-900/70 to-black",
  "from-fuchsia-600/70 via-pink-900/70 to-black",
  "from-amber-600/70 via-orange-900/70 to-black",
  "from-emerald-600/70 via-teal-900/70 to-black",
  "from-sky-600/70 via-blue-900/70 to-black",
];

export function coverGradientClass(coverSeed: number): string {
  const idx = Math.abs(Math.floor(coverSeed)) % COVER_GRADIENTS.length;
  return COVER_GRADIENTS[idx];
}

/** Longest edge a picked cover/avatar image gets downscaled to before
 * being stored — real photos straight off a phone can be several MB;
 * this keeps the Neon session row (`persist()`'s debounced push — see
 * the "Neon-backed session persistence" section below) from ballooning
 * after a handful of picks. */
const MAX_PICKED_IMAGE_DIMENSION = 640;
const PICKED_IMAGE_QUALITY = 0.85;

/** Same idea, sized for a plate *still* rather than a tiny avatar/cover
 * thumbnail — these get shown full-size in the enlarge lightbox and
 * bundled into a project zip export, so they keep a more generous
 * ceiling than `MAX_PICKED_IMAGE_DIMENSION`. Applies to **every** plate
 * still, uploaded or generated (see `downscaleDataUrlImage`'s doc
 * comment for why the generated path in particular needed this). */
const MAX_PLATE_STILL_DIMENSION = 1024;

/** Draws a decoded `<img>` onto a canvas scaled to fit `maxDimension` on
 * its longest edge and re-encodes it as a JPEG data URL — the shared
 * core of `readImageFileAsDataUrl`/`downscaleDataUrlImage`. Falls back
 * to `fallbackDataUrl` untouched if no canvas 2D context is available,
 * rather than failing the pick/generation outright. */
function scaleImageElementToDataUrl(
  img: HTMLImageElement,
  maxDimension: number,
  quality: number,
  fallbackDataUrl: string
): string {
  const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallbackDataUrl;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Reads a picked image file (jpg/png/webp), downscales it to fit within
 * `MAX_PICKED_IMAGE_DIMENSION` on its longest edge, and re-encodes it as
 * a JPEG data URL — a data URL (unlike a blob URL) round-trips through
 * the Neon session row just fine, so a real picked cover/avatar
 * survives a page reload. Used by the band cover picker, the member
 * avatar picker, and (with a larger `maxDimension`) an *uploaded* plate
 * still. Rejects if the browser can't decode the file (not an image, or
 * a format it doesn't support).
 */
export function readImageFileAsDataUrl(
  file: File | Blob,
  maxDimension: number = MAX_PICKED_IMAGE_DIMENSION,
  quality: number = PICKED_IMAGE_QUALITY
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the picked file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the picked image."));
      img.onload = () => {
        resolve(scaleImageElementToDataUrl(img, maxDimension, quality, reader.result as string));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Same downscale-to-JPEG treatment as `readImageFileAsDataUrl`, but for
 * a `data:` URL that's already decoded in memory rather than a picked
 * `File`/`Blob` — no `FileReader` round trip needed. **This is the real
 * fix for a live-QA'd "plates wiped" report**: an *uploaded* plate still
 * already went through `readImageFileAsDataUrl` (capped, downscaled)
 * before this existed, but a *generated* still (`generatePlateStill`,
 * `lib/plateGeneration.ts`) was persisted straight off xAI's own raw
 * response — no size cap at all. A song with several tagged clips'
 * worth of full-resolution generated stills would blow past
 * `localStorage`'s quota (iOS Safari's is notably tight), and
 * `persist()` used to swallow that failure completely silently — the
 * in-memory session still looked tagged, but nothing after the point
 * the quota was hit ever actually reached disk, so a later reload (or
 * iOS backgrounding a tab hard enough to force one) came back showing
 * exactly what Stuart reported: the clip's own boundaries intact (that
 * data was small and had persisted long before), but its plates back to
 * empty dashed placeholders (the stills were the last, largest thing
 * written, and never made it).
 *
 * **The quota itself is history** — the session's durable copy is one
 * Neon row now, not a `localStorage` blob (see `persist()` and the note
 * where that machinery used to live). This downscale stays anyway, and
 * is not vestigial: plate stills still travel as base64 `data:` URLs
 * *inside* that row, so capping them keeps the row, and every `PUT`
 * carrying it, a sane size over a phone connection. Don't remove it on
 * the grounds that the quota is gone.
 * Rejects if the browser can't decode the data URL (should not happen
 * for one this app itself just received from `generate-still`, but
 * mirrors `readImageFileAsDataUrl`'s own defensive handling either way).
 */
export function downscaleDataUrlImage(
  dataUrl: string,
  maxDimension: number = MAX_PLATE_STILL_DIMENSION,
  quality: number = PICKED_IMAGE_QUALITY
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Could not decode the generated image."));
    img.onload = () => {
      resolve(scaleImageElementToDataUrl(img, maxDimension, quality, dataUrl));
    };
    img.src = dataUrl;
  });
}

/** Deterministic look-swatch gradient, keyed off a look's `seed` — same
 * "no real art, just a distinct color" trick as `coverGradientClass`. */
const LOOK_GRADIENTS = [
  "from-rose-400/80 to-purple-700/80",
  "from-amber-400/80 to-rose-700/80",
  "from-sky-400/80 to-indigo-700/80",
  "from-emerald-400/80 to-teal-700/80",
  "from-pink-400/80 to-fuchsia-700/80",
];

export function lookGradientClass(seed: number): string {
  const idx = Math.abs(Math.floor(seed)) % LOOK_GRADIENTS.length;
  return LOOK_GRADIENTS[idx];
}

/**
 * Deterministic decorative waveform bar heights (0..1), seeded off the
 * file name so the same MP3 always draws the same shape — there's no
 * real audio analysis behind this, just a stand-in for "compact
 * waveform" per the locked mockup.
 */
export function waveformBars(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = (h % 1000) / 1000;
    // Bias toward the middle of the range so the row doesn't look like
    // pure noise — a little low/high variety, not a flat line either.
    bars.push(0.25 + base * 0.7);
  }
  return bars;
}

/** mm:ss, floors to whole seconds — used for the MP3 card's duration and
 * (once wired) playhead. */
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) return "--:--";
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * The reverse of `formatDuration` — parses what Stuart actually types
 * into the clip-row header's double-tap-to-edit time fields
 * (`components/SkidmarksClipTimingHeaderEdit.tsx`) into whole seconds.
 * Accepts `"m:ss"`/`"mm:ss"` (seconds 0–59, minutes any length, doesn't
 * require zero-padding — "1:5" is fine, not just "01:05") or a bare
 * integer/decimal seconds string ("65"). Returns `null` for anything it
 * can't confidently parse (empty, garbage text, `"1:65"`) rather than
 * guessing at a number — the caller cancels the edit on `null` instead
 * of committing a nonsense value. Never itself clamps to the song's
 * bounds or a neighbor's own boundary — that's
 * `nudgeSkidmarksSegmentBoundary`'s job, once this hands back a real
 * delta.
 */
export function parseSkidmarksTimeInput(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const colonMatch = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (colonMatch) {
    return Number(colonMatch[1]) * 60 + Number(colonMatch[2]);
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed));
  }
  return null;
}

/** "0:15–0:45" — a clip segment's time range for the timeline row. */
export function formatSegmentRange(startSec: number, endSec: number): string {
  return `${formatDuration(startSec)}\u2013${formatDuration(endSec)}`;
}

/**
 * One-line glance for `SkidmarksNodeCard` — deliberately terse. "idle"
 * when nothing's picked yet, "in-progress" once a band or MP3 exists,
 * "ready" once the clip list has *something* usable (real analysis, or
 * an honestly-labeled fallback) to show — the terse glance can't spell
 * out "stub"/"real" the way the chips do, so it errs toward "ready" once
 * there's anything to look at rather than blocking on real analysis.
 */
export function skidmarksGlance(state: SkidmarksState): {
  status: "idle" | "in-progress" | "ready";
  label: string;
} {
  const band = getActiveSkidmarksBand(state);
  const mp3 = state.session.mp3;
  const ready = skidmarksChecklistState(mp3).ready;
  if (mp3 && (ready === "done" || ready === "stub")) {
    return { status: "ready", label: `${band?.name ?? "Music video"} \u00b7 ready` };
  }
  if (band) {
    return { status: "in-progress", label: `Directing \u00b7 ${band.name}` };
  }
  if (state.session.projectKind) {
    return { status: "in-progress", label: "Choosing a band\u2026" };
  }
  return { status: "idle", label: "No project yet" };
}
