/**
 * Skidmarks "vibe director" — Music-video flow, through the MP3 step and
 * its clip/segment timeline (see the README's "Skidmarks node (vibe
 * director)" section).
 *
 * This is a deliberate rewrite of the earlier free-text "type a vibe
 * brief, get a scripted director-chat thread" build (PR #17/#18): the
 * locked mockups replace that with a concrete, appended-step wizard —
 * pick a project type, choose a band, cast its members, attach an MP3,
 * assign each clip a location plate and a plain-language shot prompt —
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
 * either is real. What's still mock: generated "looks" (`buildMockLook`
 * — a color swatch, not an image model call), and the seed fallback
 * cadence itself when it's showing (a deterministic
 * verse/bridge/lead/instrumental scaffold).
 *
 * Persistence mirrors `lib/control-plane.ts` / `lib/graphLayout.ts`: an
 * in-memory cache is the synchronous source of truth the UI reads via
 * `useSyncExternalStore` (`hooks/useSkidmarksStudio.ts`), mirrored to
 * `localStorage` (key: `the-tab:skidmarks-studio`) so progress through
 * the wizard survives a refresh. **This is a placeholder store, not the
 * intended long-term one** — `localStorage` is per-browser (nothing here
 * is shared across devices) and has a small quota; Stuart wants Skidmarks
 * data (bands/members/looks/session/clip timeline) moved to real Neon
 * Postgres persistence so it survives across devices/browsers. That
 * migration is explicitly out of scope for this PR (see the README's
 * Skidmarks section, "Follow-up" note) — this file's `localStorage`
 * read/write/`useSyncExternalStore` shape is what a Neon-backed version
 * would replace. Note the attached audio `File` itself never persists
 * (see `SkidmarksMp3Card`), so a completed analysis result persists fine
 * across a reload, but an *in-progress* one can't resume — `normalizeState`
 * below turns a stale `"analyzing"` status into an honest `"failed"` one
 * on load rather than hanging forever. Also explicitly out of scope for
 * this build: voice, animate, and stitch, and any actual clip rendering
 * ("Generate Clips" is a stub button — see `SkidmarksClipTimeline`) — the
 * flow stops dead after the clip timeline's plate/shot-prompt tags.
 * Camera angle is **not** a manual pill anymore — that whole picker was
 * deleted outright. Model still is (LTX/Grok/H3/Seedance — see
 * `SKIDMARKS_MODELS`), but per Stuart's cost lock auto-assignment only
 * ever picks LTX or Grok (`defaultSegmentModel`); H3 and Seedance are
 * real, selectable pills that are never auto-assigned or rotated into
 * automatically, so nothing here can quietly start spending against a
 * pricier model on its own.
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

const STORAGE_KEY = "the-tab:skidmarks-studio";

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
  { kind: "sunnybank", label: "Sunnybank", icon: "sun", enabled: false },
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
 * auto-assigns. **H3** and **Seedance** are real, selectable pills —
 * Stuart still wants them reachable — but are **never** auto-assigned
 * and never rotated into automatically; picking either is always a
 * deliberate one-tap choice (`setSkidmarksSegmentModel`), specifically
 * so nothing here can silently start burning credits against a pricier
 * model once a real backend lands. `note` on H3/Seedance's meta below
 * exists to say exactly that in the UI. Kling is gone outright (no
 * subscription); Seedance is still a real pill (multi-angle "17
 * camera" style) but explicitly optional, never a default. SIRAY is
 * *not* in this list — see `SKIDMARKS_UNCENSORED_STILLS_LABEL` below
 * for why it still exists in the data layer, just nowhere near this
 * one.
 *
 * **Where the actual cost lives, per Stuart**: a real plate *still*
 * (one static frame) is cheap — this lock isn't about stills. A real
 * *video render/animate* pass is the expensive part — Seedance's
 * multi-angle clip generation specifically, and the stub "Generate
 * Clips" button generally (see `SkidmarksClipTimeline`'s doc comment).
 * Both stay stubbed in this build regardless of whether plate stills
 * themselves ever get a real generator; nothing here calls a real
 * model of any kind yet. */
export type SkidmarksModelId = "ltx-lipsync" | "grok" | "h3" | "seedance";

export interface SkidmarksModelMeta {
  id: SkidmarksModelId;
  label: string;
  badge: string;
  /** Short caption shown under this pill — only set for a model that's
   * selectable but never auto-assigned, so tapping it always reads as a
   * deliberate, cost-aware choice rather than something the app might
   * do on its own. */
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
 * wired into the main plating UI at all in this pass ("only if somehow
 * needed... not in main UI") — the data layer keeps the capability so
 * it's one setter call away from being surfaced later, not a main-row
 * pill today. Kling has no equivalent carve-out — it's removed outright
 * (no subscription). */
export const SKIDMARKS_UNCENSORED_STILLS_LABEL = "SIRAY \u2014 Uncensored plate stills";

export function skidmarksModelLabel(id: SkidmarksModelId): string {
  return SKIDMARKS_MODELS.find((m) => m.id === id)?.label ?? id;
}

export function skidmarksModelBadge(id: SkidmarksModelId): string {
  return SKIDMARKS_MODELS.find((m) => m.id === id)?.badge ?? id;
}

/** LTX is the only model in this lineup that actually does lip-sync —
 * drives the plate card overlay's 🎤 glyph (see
 * `SkidmarksPlatesAndCamera`). A vocal segment one-tap-switched to a
 * different model loses that badge, since the badge reflects the
 * *current* pick, not the segment's label. */
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

/** Location plate options for a clip's expanded plate-card row — matches
 * the locked plates mockup's five seed plates exactly. There are no real
 * plate photos in this build; `gradient` is a deterministic swatch
 * stand-in, same trick as `coverGradientClass`/`lookGradientClass`. */
export type SkidmarksPlateId =
  | "neon-stage"
  | "rainy-alley"
  | "desert-highway"
  | "warehouse"
  | "crowd-pit";

export interface SkidmarksPlateMeta {
  id: SkidmarksPlateId;
  label: string;
  gradient: string;
}

export const SKIDMARKS_LOCATION_PLATES: SkidmarksPlateMeta[] = [
  { id: "neon-stage", label: "Neon Stage", gradient: "from-fuchsia-500/70 via-purple-900/80 to-black" },
  { id: "rainy-alley", label: "Rainy Alley", gradient: "from-slate-400/60 via-slate-900/85 to-black" },
  { id: "desert-highway", label: "Desert Highway", gradient: "from-orange-400/60 via-amber-900/80 to-black" },
  { id: "warehouse", label: "Warehouse", gradient: "from-zinc-400/50 via-zinc-800/85 to-black" },
  { id: "crowd-pit", label: "Crowd Pit", gradient: "from-rose-500/70 via-red-900/80 to-black" },
];

/** Location-plate default, per the locked Plate Study rule: a clean
 * stage location either way — **Neon Stage** for vocal clips,
 * **Warehouse** for instrumental — and **never** Crowd Pit
 * (`SKIDMARKS_LOCATION_PLATES`' one crowded/chaotic option) as an
 * auto-pick. Stuart can still tap Crowd Pit himself on the plate-card
 * row; this only governs what a clip starts on. */
export function defaultSegmentPlateId(vocal: boolean): SkidmarksPlateId {
  return vocal ? "neon-stage" : "warehouse";
}

/**
 * One clip/segment on the timeline: a time range, a label, a plain-
 * language `shotPrompt` ("what happens in this shot"), a location
 * `plateId`, and a `model` (see `defaultSegmentModel`), plus the narrow
 * `uncensoredPlateStills` opt-in (see `SKIDMARKS_UNCENSORED_STILLS_LABEL`).
 * `model` and `plateId` both start **auto-assigned** (via
 * `defaultSegmentModel`/`defaultSegmentPlateId`) — the whole point of
 * the default rules is that Stuart never *has* to think about either
 * before typing a shot prompt or tapping a different plate/model pill.
 * Per Stuart's cost lock, `defaultSegmentModel` only ever auto-assigns
 * LTX or Grok — H3 and Seedance only ever land on a segment via an
 * explicit tap (`setSkidmarksSegmentModel`), never automatically and
 * never by editing `shotPrompt` (that only ever updates the prompt text
 * — see `setSkidmarksSegmentShotPrompt`).
 */
export interface SkidmarksClipSegment {
  id: string;
  startSec: number;
  endSec: number;
  label: SkidmarksSegmentLabel;
  model: SkidmarksModelId;
  plateId: SkidmarksPlateId;
  /** Plain-language "what happens in this shot" — one of the two
   * control surfaces on the expanded panel (the other is the plate-card
   * row), deliberately short (no lyric dumps, no long captions).
   * Defaults to `""`; the only thing the plate card's preview caption
   * ever reflects — never a hardcoded scene description. Does **not**
   * drive `model` — see `setSkidmarksSegmentShotPrompt`. */
  shotPrompt: string;
  /** SIRAY's narrow carve-out: **uncensored plate stills only** — never
   * read by anything animation-related (the stub "Generate Clips"
   * button only ever looks at `model`, which can't be SIRAY — see
   * `SKIDMARKS_UNCENSORED_STILLS_LABEL`) and never auto-assigned.
   * Defaults `false`; toggled via
   * `setSkidmarksSegmentUncensoredPlateStills`. Not wired into the main
   * plating UI in this pass — see that constant's doc comment. */
  uncensoredPlateStills: boolean;
}

/** Fallback total (3:30) used to seed segments before the browser's real
 * `<audio>` duration probe resolves — attach fires with `durationSec:
 * null`, and the probe usually resolves within a beat, so this is only
 * ever visible for a moment. See `setSkidmarksMp3Duration` below, which
 * rebuilds off the real duration the first time it resolves. */
const DEMO_SEGMENT_FALLBACK_DURATION_SEC = 210;

/** Shared segment builder — mints a fresh `SkidmarksClipSegment` with
 * every default field (`model`/`plateId`/`shotPrompt`/
 * `uncensoredPlateStills`) set per the locked Plate Study rules, off
 * just a time range + label. Used by both `buildDemoSegments` (the seed
 * cadence) and `buildSegmentsFromVocalRanges` (real transcription/
 * heuristic output) so neither path can drift from the other's
 * defaults. */
function buildDefaultSegment(
  startSec: number,
  endSec: number,
  label: SkidmarksSegmentLabel
): SkidmarksClipSegment {
  const vocal = SKIDMARKS_SEGMENT_LABEL_META[label].vocal;
  return {
    id: generateId("segment"),
    startSec,
    endSec,
    label,
    model: defaultSegmentModel(label),
    plateId: defaultSegmentPlateId(vocal),
    shotPrompt: "",
    uncensoredPlateStills: false,
  };
}

/**
 * Deterministic verse/bridge/lead/instrumental cadence, scaled to
 * whatever total duration is passed in. **This is seed/demo structure,
 * not real lyrics timing or singing detection** — see the module doc
 * comment and the honesty note the timeline UI renders alongside it.
 * It exists so Stuart has an editable clip list to assign a plate/shot
 * prompt to *today*, in the same shape a future real STT + singing-
 * detect pass can populate once that lands (see the README's
 * "Skidmarks node" section).
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
}

/** The Music-video wizard's progress — which project type, which band,
 * and (once chosen) the attached MP3. `null` fields mean "not reached
 * that step yet", so the UI knows exactly how much to append. */
export interface SkidmarksSession {
  projectKind: SkidmarksProjectKind | null;
  bandId: string | null;
  mp3: SkidmarksMp3Attachment | null;
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
      { id: "jack-ash-frontman", name: "Jack Ash", role: "Frontman", emoji: "\u{1F3B8}", looks: [] },
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
    session: { projectKind: null, bandId: null, mp3: null },
    removedSeedBandIds: [],
  };
}

/**
 * Deterministic "New" band mock — matches the locked mockup's example
 * exactly (Grok Bot & the destroyers, Rock Grok already looked, Stew
 * Balls waiting on a first generate). Tapping "New" more than once in a
 * session just re-mints another copy of this same roster with a fresh
 * id, same spirit as `buildProjectFromBrief` always producing the same
 * stub output for the same input.
 */
export function buildNewMockBand(): SkidmarksBand {
  const bandId = generateId("band");
  return {
    id: bandId,
    name: "Grok Bot & the destroyers",
    tagline: "New band",
    coverSeed: Date.now(),
    editIcon: "pencil",
    members: [
      {
        id: generateId("member"),
        name: "Rock Grok",
        role: "Solo",
        emoji: "\u{1F916}",
        looks: [
          {
            id: generateId("look"),
            seed: 7,
            prompt: "chrome headphones, stage lights, leather jacket",
            photoreal: 80,
            createdAt: Date.now(),
          },
        ],
      },
      {
        id: generateId("member"),
        name: "Stew Balls",
        emoji: "\u{1F3B3}",
        looks: [],
      },
    ],
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

/** Pure builder: a prompt + photoreal % → a new mock "look". No image
 * generation happens here — see the module doc comment. */
export function buildMockLook(prompt: string, photoreal: number): SkidmarksLook {
  return {
    id: generateId("look"),
    seed: Math.floor(Math.random() * 1_000_000),
    prompt: prompt.trim(),
    photoreal,
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
 * - `plateId` — used to start `null` ("not picked yet"); now it's
 *   always auto-assigned, so a stored `null` (or a missing field
 *   entirely) backfills via `defaultSegmentPlateId`, and any id no
 *   longer in `SKIDMARKS_LOCATION_PLATES` falls back the same way.
 * - `shotPrompt` — missing/non-string backfills to `""`.
 * - `uncensoredPlateStills` — missing/non-boolean backfills to `false`.
 *
 * Older stored fields this segment shape no longer has (a legacy
 * `cameraAngle`/`cameraAngleAuto`/`plateSubject` from an earlier pass)
 * are simply dropped — this function builds a fresh object rather than
 * spreading `raw`, so they don't linger in the next `persist()` write.
 */
export function normalizeSkidmarksSegment(raw: SkidmarksClipSegment): SkidmarksClipSegment {
  const r = raw as Partial<SkidmarksClipSegment> & Record<string, unknown>;
  const vocal = SKIDMARKS_SEGMENT_LABEL_META[raw.label]?.vocal ?? false;
  const shotPrompt = typeof r.shotPrompt === "string" ? r.shotPrompt : "";
  const validPlate =
    typeof r.plateId === "string" && SKIDMARKS_LOCATION_PLATES.some((p) => p.id === r.plateId);
  const plateId: SkidmarksPlateId = validPlate
    ? (r.plateId as SkidmarksPlateId)
    : defaultSegmentPlateId(vocal);
  const uncensoredPlateStills = typeof r.uncensoredPlateStills === "boolean" ? r.uncensoredPlateStills : false;
  return {
    id: raw.id,
    startSec: raw.startSec,
    endSec: raw.endSec,
    label: raw.label,
    model: remapLegacySkidmarksModel(String(raw.model), vocal),
    plateId,
    shotPrompt,
    uncensoredPlateStills,
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
  const bands = [
    ...SEED_BANDS.filter((seed) => !removedSeedSet.has(seed.id)).map(
      (seed) => storedBands.find((b) => b?.id === seed.id) ?? seed
    ),
    ...extraBands,
  ];
  const session: Partial<SkidmarksSession> = p.session ?? {};
  const bandId = typeof session.bandId === "string" ? session.bandId : null;
  const stillHasBand = bandId !== null && bands.some((b) => b.id === bandId);

  const storedMp3 = (session.mp3 as SkidmarksMp3Attachment | null | undefined) ?? null;
  // Sessions saved before the clip-timeline feature shipped won't have
  // `segments` yet — backfill once, off whatever duration is already known.
  const hasSegments = !!storedMp3 && Array.isArray(storedMp3.segments);
  // Every rehydrated segment also runs through `normalizeSkidmarksSegment`
  // — cleans up a legacy `model` (a removed Kling/former-SIRAY id remaps
  // to the vocal/instrumental default; a still-valid LTX/Grok/H3/Seedance
  // pick survives untouched) and backfills any field that didn't exist
  // yet when this session was saved (`shotPrompt`, `uncensoredPlateStills`,
  // or a still-`null` `plateId` from before it became always-assigned).
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

  const mp3: SkidmarksMp3Attachment | null = storedMp3
    ? {
        ...storedMp3,
        segments,
        segmentsSource,
        analysisStatus,
        analysisError,
        transcriptionStatus,
        transcriptionError,
        transcriptionProvider,
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
    },
  };
}

function loadFromStorage(): SkidmarksState {
  if (!isBrowser()) return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

let cachedState: SkidmarksState | null = null;

export function getSkidmarksSnapshot(): SkidmarksState {
  if (!cachedState) cachedState = loadFromStorage();
  return cachedState;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function onStorageEvent(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return;
  cachedState = null;
  notify();
}

export function subscribeSkidmarks(listener: () => void): () => void {
  listeners.add(listener);
  if (isBrowser() && listeners.size === 1) {
    window.addEventListener("storage", onStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (isBrowser() && listeners.size === 0) {
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}

function persist(next: SkidmarksState) {
  cachedState = next;
  if (isBrowser()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (e.g. private mode) — in-memory only for this session.
    }
  }
  notify();
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
    session: { ...current.session, bandId, mp3: null },
  });
}

/** "New" tile tap — mints a fresh mock band, adds it to the roster, and
 * selects it. Capped at `BAND_HISTORY_LIMIT` (oldest non-seed band drops
 * first) so tapping "New" repeatedly doesn't grow the picker forever. */
export function createSkidmarksBand(): SkidmarksBand {
  const band = buildNewMockBand();
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
    session: { ...current.session, bandId: band.id, mp3: null },
  });
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
    bands,
    removedSeedBandIds,
    session: wasActive
      ? { ...current.session, bandId: null, mp3: null }
      : current.session,
  });
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

export function attachSkidmarksMp3(mp3: SkidmarksMp3Attachment): void {
  const current = getSkidmarksSnapshot();
  persist({ ...current, session: { ...current.session, mp3 } });
}

/** Fills in the real duration once the browser's `<audio>` metadata probe
 * resolves — attach happens immediately with `durationSec: null` so the
 * card can render right away instead of waiting on the probe. Also
 * drives the `timing` chip (`skidmarksChecklistState`) straight off
 * `durationSec !== null` — no separate timer/flag needed. */
export function setSkidmarksMp3Duration(durationSec: number): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3) return;
  // The very first time a real duration resolves (attach always starts
  // with `durationSec: null`) *and* nothing real has replaced the seed
  // segments yet, rebuild them off the real total instead of the
  // fallback one they were seeded with. If real analysis has already
  // finished (a fast decode can beat the `<audio>` element's own probe),
  // leave its segments alone — don't clobber real output with seed data.
  const shouldRebuildSeed = mp3.durationSec === null && mp3.segmentsSource === "seed-fallback";
  const segments = shouldRebuildSeed ? buildDemoSegments(durationSec) : mp3.segments;
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: { ...mp3, durationSec, segments },
    },
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
 * No-ops if the mp3 was removed/replaced before analysis finished —
 * callers should additionally guard against a stale/superseded result
 * themselves (see `useSkidmarksStudio`'s generation-token check) since
 * this function can't tell "still the same file" from "a same-shaped
 * new one".
 */
export function applySkidmarksAnalysisResult(result: VocalAnalysisResult): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3) return;
  const hasRealTranscription = mp3.segmentsSource === "transcription";
  const segments = hasRealTranscription
    ? mp3.segments
    : buildSegmentsFromVocalRanges(result.segments);
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: {
        ...mp3,
        durationSec: mp3.durationSec ?? result.durationSec,
        segments,
        segmentsSource: hasRealTranscription ? mp3.segmentsSource : "analysis",
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
 * never downgrades an already-real transcription result.
 */
export function markSkidmarksAnalysisFailed(reason: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3) return;
  const hasRealTranscription = mp3.segmentsSource === "transcription";
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: {
        ...mp3,
        segmentsSource: hasRealTranscription ? mp3.segmentsSource : "seed-fallback",
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
 * before or after the heuristic).
 */
export function applySkidmarksTranscriptionResult(
  words: SkidmarksTranscribedWord[],
  reportedDurationSec: number | null,
  provider?: SkidmarksTranscriptionProvider
): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3) return;
  const totalSec = mp3.durationSec ?? reportedDurationSec ?? DEMO_SEGMENT_FALLBACK_DURATION_SEC;
  const wordSegments = segmentsFromWords(words, totalSec);

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

  const segments = buildSegmentsFromVocalRanges(wordSegments);
  persist({
    ...current,
    session: {
      ...current.session,
      mp3: {
        ...mp3,
        durationSec: mp3.durationSec ?? reportedDurationSec,
        words,
        segments,
        segmentsSource: "transcription",
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
 * verbatim in the timeline's caption.
 */
export function markSkidmarksTranscriptionUnconfigured(reason: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3) return;
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
 * caption.
 */
export function markSkidmarksTranscriptionFailed(reason: string): void {
  const current = getSkidmarksSnapshot();
  const mp3 = current.session.mp3;
  if (!mp3) return;
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

/** Location plate pick — the one tap-to-select control on the expanded
 * panel's plate-card row. Plates are always-assigned (never `null`,
 * since a card is always showing *something*), so this is a plain
 * single-select with no "tap again to clear" off state. */
export function setSkidmarksSegmentPlate(segmentId: string, plateId: SkidmarksPlateId): void {
  updateSkidmarksSegment(segmentId, (s) => ({ ...s, plateId }));
}

/** One-tap model switch — per Stuart's cost lock, this is the *only*
 * way a segment's `model` ever becomes H3 or Seedance (or LTX/Grok
 * against Stuart's own wishes on a clip): `defaultSegmentModel` will
 * never pick either automatically, and nothing else in this file calls
 * this function on the app's own initiative. No confirmation, no picker
 * modal — same "one tap, no heavy thinking" rule as everything else
 * here, just never an automatic one. */
export function setSkidmarksSegmentModel(segmentId: string, model: SkidmarksModelId): void {
  updateSkidmarksSegment(segmentId, (s) => ({ ...s, model }));
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
 * this keeps `localStorage` (a few MB quota, shared with everything
 * else this app persists) from filling up after a handful of picks. */
const MAX_PICKED_IMAGE_DIMENSION = 640;
const PICKED_IMAGE_QUALITY = 0.85;

/**
 * Reads a picked image file (jpg/png/webp), downscales it to fit within
 * `MAX_PICKED_IMAGE_DIMENSION` on its longest edge, and re-encodes it as
 * a JPEG data URL — a data URL (unlike a blob URL) round-trips through
 * `localStorage` just fine, so a real picked cover/avatar survives a
 * page reload. Used by both the band cover picker and the member avatar
 * picker. Rejects if the browser can't decode the file (not an image,
 * or a format it doesn't support).
 */
export function readImageFileAsDataUrl(
  file: File,
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
        const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          // No canvas 2D context available — fall back to the untouched
          // original data URL rather than failing the pick outright.
          resolve(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
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

/** "0:15–0:45" — a clip segment's time range for the timeline row. */
export function formatSegmentRange(startSec: number, endSec: number): string {
  return `${formatDuration(startSec)}\u2013${formatDuration(endSec)}`;
}

/** Whole seconds between a segment's start/end — the plate card's
 * "30s"-style duration readout. */
export function segmentDurationSec(startSec: number, endSec: number): number {
  return Math.max(0, Math.round(endSec - startSec));
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
