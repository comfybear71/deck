/**
 * The "render all 16, one after another, automatically" orchestrator
 * behind Stuart's script-sequence automation (2026-09-14) — the actual
 * sequencing/stop-on-failure control flow, kept pure of any real
 * network/DOM call so it's fully unit-testable with fakes before ever
 * spending real money. `components/SkidmarksScriptSequencePanel.tsx`
 * supplies the real implementations (`generateSkidmarksClip`,
 * `uploadSkidmarksPlateStill`, `generatePlateStill`,
 * `setSkidmarksClipPlateStill`) as `deps`.
 *
 * **Frame carry is server-side now, not a `deps` function** (2026-09-14
 * — three separate live failures on Stuart's iPhone with the old
 * client-side `<video>`+`<canvas>` capture, `lib/videoFrame.ts`, now
 * removed — see `lib/serverVideoFrame.ts`'s module doc comment for the
 * full story). `renderClip`'s own outcome carries `lastFrameUrl`
 * straight from the server when extraction succeeded; the chaining step
 * below just reads it, rather than calling a separate extraction dep.
 *
 * **Stops on the first real failure — never keeps spending after
 * something's already broken.** Stuart explicitly asked for this to be
 * fully automatic (his own call, after I flagged the risk) — "fully
 * automatic" still doesn't mean "blind": a render that fails, or a
 * frame-chain that fails partway through, halts the whole run right
 * there rather than silently skipping ahead and burning more real money
 * on clips chained from nothing. `onProgress` reports every step either
 * way, live, so a caller can show exactly where it stopped and why.
 */

import { SKIDMARKS_SEGMENT_LABEL_META, type SkidmarksClipSegment, type SkidmarksMember, type SkidmarksPlateStill } from "./skidmarks";
import type { PersistedClipRender } from "./clipRenders";
import { buildClipGenerationRequest, computePlateDurationSec, LTX_DURATION_BOUNDS } from "./clipGeneration";
import { getSkidmarksCharacterLock } from "./plateGeneration";

/**
 * **The identity-safe one-button song render** (2026-09-19) — a second,
 * deliberately independent runner in this file, sitting alongside
 * `runScriptSequence`/`SCENE_BLOCK_CLIP_COUNT` above rather than
 * replacing them.
 *
 * The reason for a second runner instead of changing the first: the
 * real bug this exists to fix is `runScriptSequence`'s own last-frame
 * chaining (`ChainedPlateTarget`/the "chaining" branch at the bottom of
 * that function) — a render's closing frame becomes the *next* clip's
 * starting image, over and over. That is precisely how an artist's
 * likeness drifts across a run: each hop is a small, real re-generation
 * by a video model, not a copy, and small drift compounds. Two real,
 * reported failures came from exactly this shape (see
 * `lib/plateGeneration.ts`'s "Holding one artist" doc comment — a shot
 * described in prose blending with a photo; then, even once the prompt
 * held the identity, a render chained from a drifted frame still wasn't
 * the artist). `runScriptSequence`'s own existing test suite
 * (`lib/scriptSequenceRunner.test.ts`) pins real, wanted behavior for
 * Jack Ash's locked-character scene-block chaining that depends on this
 * exact chaining mechanism working the way it already does — rewriting
 * it in place would either break that suite or require silently
 * deleting coverage for a real, working feature nobody asked to remove.
 *
 * `runIdentitySafeSongRender` below never chains anything. Every clip,
 * every time, builds its own plate fresh from exactly two images — an
 * empty **place** still generated from that clip's own shot prompt
 * (`lib/plateLocation.ts`) and the **identity photo** of whoever this
 * clip is actually about (`resolveScriptPartIdentity` below) — the same
 * two-image composite `lib/plateGeneration.ts`'s `buildPlateGenerationRequest`
 * already builds for a locked character, now used for *any* artist,
 * locked or not ("Photo is the lock" — no new `SKIDMARKS_CHARACTER_LOCKS`
 * entry is invented here for an unlocked artist; `getSkidmarksCharacterLock`
 * simply returns nothing for one, and the composite still holds their
 * identity purely off `avatarImage`). Missing either image — no place
 * still (a real generation failure) or no identity photo — fails that
 * one clip outright and stops the whole batch there, reporting which
 * clip; it never falls back to a text-only, no-identity still, which
 * would be exactly the "quietly drifting" failure mode this exists to
 * close.
 *
 * **Script labels, not audio analysis, decide the backend per clip**
 * (`SkidmarksScriptPartKind`/`parseScriptPartKind`) — a real, deliberate
 * difference from `runScriptSequence`'s own `resolveScriptPartVocal`
 * (which routes off the *song's* real measured singing). This runner's
 * whole point is a script that says, part by part, who's on screen and
 * whether they're singing: `"vocal"` is the one kind that ever reaches
 * LTX/Comfy Cloud with the song's real vocal audio; every other kind
 * (`instrumental`/`intro`/`outro`/`bridge`/`lead`/`break`/`other-singer`)
 * always renders Grok/H3, and never sends vocal audio at all — even when
 * the identity photo it holds is the same artist singing on an adjacent
 * clip. A part naming a different singer (`"other-singer"`) still gets a
 * real held identity — that named member's own `avatarImage` — never the
 * current artist's photo and never a chained frame.
 */
export type SkidmarksScriptPartKind =
  | "vocal"
  | "instrumental"
  | "intro"
  | "outro"
  | "bridge"
  | "lead"
  | "break"
  | "other-singer";

const SKIDMARKS_SCRIPT_PART_KIND_WORDS: SkidmarksScriptPartKind[] = [
  "vocal",
  "instrumental",
  "intro",
  "outro",
  "bridge",
  "lead",
  "break",
];

export interface ParsedScriptPartKind {
  kind: SkidmarksScriptPartKind;
  /** Only set for `kind === "other-singer"` *and* only when the script
   * actually named someone (`"Other Singer: Jax"` / `"Other Singer
   * (Jax)"`) — `undefined` when the script just wrote `"Other Singer"`
   * with no name, which `resolveScriptPartIdentity` below still
   * resolves, but only when the band has exactly one unambiguous other
   * member to mean. */
  otherSingerName?: string;
}

const OTHER_SINGER_RE = /^other[\s-]?singer\s*[:\-]?\s*\(?\s*([^)]*?)\s*\)?$/i;

/**
 * Reads a script part's own label word — `parseScriptSequence`'s
 * existing `title` field (the text between the header's em dash and its
 * `[Duration: ...]` bracket), exactly as Stuart pastes it, e.g.
 * `"Part 4 (0:45 - 0:55) — Other Singer: Jax [Duration: 10s]. ..."`.
 * Case-insensitive, tolerant of surrounding whitespace. An unrecognized
 * or blank title defaults to `"instrumental"` — the same safe default
 * `resolveScriptPartIdentity`/`scriptPartUsesLtx` already give an
 * ordinary B-roll clip: never LTX, never invented vocal audio, identity
 * still held (the current artist), just never assumed to be singing.
 * Pure — no parsing of the shot-prompt body itself, and no touching of
 * `lib/scriptSequence.ts`'s own header/bracket regex.
 */
export function parseScriptPartKind(rawTitle: string): ParsedScriptPartKind {
  const title = rawTitle.trim();
  const otherSingerMatch = title.match(OTHER_SINGER_RE);
  if (otherSingerMatch) {
    const name = otherSingerMatch[1]?.trim();
    return { kind: "other-singer", ...(name ? { otherSingerName: name } : {}) };
  }
  const lower = title.toLowerCase();
  const matched = SKIDMARKS_SCRIPT_PART_KIND_WORDS.find((word) => lower === word);
  return { kind: matched ?? "instrumental" };
}

/** Rule 3/4's whole routing decision, in one place: `"vocal"` is the
 * only kind this runner ever sends to LTX/Comfy Cloud with real vocal
 * audio. Every other kind — including `"other-singer"`, even when the
 * script's own words describe someone singing — renders Grok/H3 with no
 * vocal audio at all. Pure. */
export function scriptPartUsesLtx(kind: SkidmarksScriptPartKind): boolean {
  return kind === "vocal";
}

export type ScriptPartIdentityResolution =
  | { ok: true; member: SkidmarksMember }
  | { ok: false; message: string };

/**
 * Rule 1/"a different singer" resolution, in one place — the only
 * function in this runner that decides *whose* photo a clip holds.
 *
 * - `"other-singer"`: looks up the named band member by name
 *   (case-insensitive, exact match — a real reported-format script
 *   names someone plainly, e.g. `"Other Singer: Jax"`). A script that
 *   just wrote `"Other Singer"` with no name still resolves when the
 *   band has exactly one *other* named member besides `currentMember` —
 *   there's nobody else it could mean — and fails honestly (not a
 *   guess) when that's ambiguous (more than one other member) or
 *   impossible (no other member at all). Never falls back to
 *   `currentMember`'s own photo — that would be exactly the identity
 *   swap rule 1 exists to ban.
 * - Every other kind: `currentMember` — "Photo is the lock," no
 *   character-lock registry consulted here at all.
 *
 * Either branch fails the clip outright (never a generic placeholder,
 * never a text-only still) the moment the resolved member has no
 * `avatarImage` — "missing either image \u2192 fail that clip, stop
 * honest" from rule 3/the plate contract, decided here so the caller
 * never has to remember to check it separately.
 */
export function resolveScriptPartIdentity(
  kind: SkidmarksScriptPartKind,
  otherSingerName: string | undefined,
  currentMember: SkidmarksMember | undefined,
  bandMembers: SkidmarksMember[]
): ScriptPartIdentityResolution {
  if (kind === "other-singer") {
    const named = otherSingerName?.trim().toLowerCase();
    let target: SkidmarksMember | undefined;
    if (named) {
      target = bandMembers.find((m) => m.name.trim().toLowerCase() === named);
      if (!target) {
        return {
          ok: false,
          message: `names a different singer ("${otherSingerName}"), but no band member with that name was found.`,
        };
      }
    } else {
      const others = bandMembers.filter((m) => m.id !== currentMember?.id && m.name.trim().length > 0);
      if (others.length !== 1) {
        return {
          ok: false,
          message:
            others.length === 0
              ? "names a different singer, but this band has no other member to be them."
              : "names a different singer but doesn't say who, and this band has more than one other member — add a name (e.g. \"Other Singer: Jax\").",
        };
      }
      target = others[0];
    }
    if (!target.avatarImage) {
      return { ok: false, message: `names ${target.name || "a different singer"}, who has no photo set — refusing to invent a face.` };
    }
    return { ok: true, member: target };
  }

  if (!currentMember) {
    return { ok: false, message: "needs an artist, but none is selected for this band yet." };
  }
  if (!currentMember.avatarImage) {
    return { ok: false, message: `needs ${currentMember.name || "the selected artist"}'s photo, but none is set — refusing to invent a face.` };
  }
  return { ok: true, member: currentMember };
}

/** One script part, already resolved into a real time range and a
 * shot-prompt — the identity-safe runner's own input shape, deliberately
 * independent of `SkidmarksClipSegment`/`SkidmarksSegmentLabel` (see
 * this section's module doc comment for why: those already mean
 * something else — real audio-derived vocal/instrumental — for
 * `runScriptSequence`, and reusing them here would conflate two
 * different "is this vocal?" questions). */
export interface IdentitySafeScriptPart {
  shotPrompt: string;
  startSec: number;
  endSec: number;
  kind: SkidmarksScriptPartKind;
  otherSingerName?: string;
}

/** Where one part's plate/render actually lands — a `SkidmarksClipSegment`
 * id plus one of its plate slot ids, minted ahead of time by the caller
 * (`lib/skidmarks.ts`'s `buildScriptSequenceSegments` mints exactly this
 * shape) so this runner never has to know how segments/plates are
 * constructed, only where to write. */
export interface IdentitySafeRunTarget {
  segmentId: string;
  plateId: string;
}

export type IdentitySafeRunEvent =
  | { type: "resolving-place"; clipIndex: number; clipCount: number }
  | { type: "generating-plate"; clipIndex: number; clipCount: number }
  | { type: "rendering"; clipIndex: number; clipCount: number }
  | { type: "clip-done"; clipIndex: number; clipCount: number };

export interface IdentitySafeRunDeps {
  /** The empty place still for one clip's own scene — same contract as
   * `lib/plateLocation.ts`'s `resolveLocationStill` (the real
   * implementation the caller injects), including its own cache (a
   * clip's shot prompt repeated across parts never re-bills the place). */
  resolvePlaceStill: (
    sceneText: string,
    bandName: string
  ) => Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>;
  /** Builds and generates the two-image (place + identity) composite
   * still for one clip — same real backend as every other still in this
   * feature (`lib/plateGeneration.ts`'s `buildPlateGenerationRequest` +
   * `generatePlateStill`); `vocal` only steers still-image framing
   * phrasing (see `buildPlateGenerationRequest`'s `routingFramingHint`),
   * it is a *different* flag from this clip's real LTX-vs-Grok/H3
   * backend choice, decided separately by `scriptPartUsesLtx`. */
  generateIdentityStill: (params: {
    shotPrompt: string;
    bandName: string;
    vocal: boolean;
    vocalist: SkidmarksMember;
    locationStillDataUrl: string;
  }) => Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>;
  /** Uploads a still's bytes to durable storage — same contract as
   * `lib/plateStillBlob.ts`'s `uploadSkidmarksPlateStill`. */
  uploadStill: (dataUrl: string) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;
  /** Renders one clip — same contract as `lib/clipGeneration.ts`'s
   * `generateSkidmarksClip`, called with an already-built request.
   * Deliberately has **no** `lastFrameUrl` in its success shape — this
   * runner never reads a render's last frame for anything (rule 5: last-
   * frame chaining is banned for identity), so there is nothing here to
   * accidentally wire back into the next clip's plate. */
  renderClip: (request: ReturnType<typeof buildClipGenerationRequest>) => Promise<
    | { ok: true; videoUrl: string; persisted: boolean; persistError?: string }
    | { ok: false; message: string }
  >;
  recordRender: (render: PersistedClipRender) => void;
  setPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill) => void;
  onProgress?: (event: IdentitySafeRunEvent) => void;
}

export type IdentitySafeRunOutcome =
  | { ok: true; renderedCount: number }
  | { ok: false; failedAtClipIndex: number; message: string; renderedCount: number; stopped?: boolean };

/**
 * Runs a whole identity-safe song render, one clip at a time, stopping
 * dead at the first real failure and reporting exactly which clip
 * (index) it stopped at — same "fully automatic, never blind" contract
 * as `runScriptSequence`, but with no chaining step at all: there is
 * nothing here that reads a render's `lastFrameUrl`, and no code path
 * that ever treats a pre-existing plate still as "already done" — every
 * clip's plate is (re)built fresh, every run, from that clip's own place
 * still + identity photo. `startAtClipIndex` (default `0`) skips
 * already-rendered clips on a resume, exactly like `runScriptSequence`'s
 * own resume, without re-spending on them.
 */
export async function runIdentitySafeSongRender(
  parts: IdentitySafeScriptPart[],
  targets: IdentitySafeRunTarget[],
  bandName: string,
  currentMember: SkidmarksMember | undefined,
  bandMembers: SkidmarksMember[],
  mp3AudioUrl: string | undefined,
  deps: IdentitySafeRunDeps,
  startAtClipIndex: number = 0,
  shouldStop?: () => boolean
): Promise<IdentitySafeRunOutcome> {
  const report = (event: IdentitySafeRunEvent) => deps.onProgress?.(event);

  if (parts.length === 0) {
    return { ok: false, failedAtClipIndex: 0, message: "No clips to render.", renderedCount: 0 };
  }
  if (parts.length !== targets.length) {
    return {
      ok: false,
      failedAtClipIndex: 0,
      message: "Script parts and the clip timeline are out of sync — rebuild the timeline before rendering.",
      renderedCount: 0,
    };
  }

  const startIndex = Math.max(0, Math.min(startAtClipIndex, parts.length));

  for (let i = startIndex; i < parts.length; i++) {
    if (shouldStop?.()) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Stopped before clip ${i + 1} — no more clips will render.`,
        renderedCount: i,
        stopped: true,
      };
    }

    const part = parts[i];
    const target = targets[i];

    const identity = resolveScriptPartIdentity(part.kind, part.otherSingerName, currentMember, bandMembers);
    if (!identity.ok) {
      return { ok: false, failedAtClipIndex: i, message: `Clip ${i + 1} ${identity.message}`, renderedCount: i };
    }

    report({ type: "resolving-place", clipIndex: i, clipCount: parts.length });
    const place = await deps.resolvePlaceStill(part.shotPrompt, bandName);
    if (!place.ok) {
      return { ok: false, failedAtClipIndex: i, message: `Clip ${i + 1}: ${place.message}`, renderedCount: i };
    }

    const vocal = scriptPartUsesLtx(part.kind);

    report({ type: "generating-plate", clipIndex: i, clipCount: parts.length });
    const stillOutcome = await deps.generateIdentityStill({
      shotPrompt: part.shotPrompt,
      bandName,
      vocal,
      vocalist: identity.member,
      locationStillDataUrl: place.dataUrl,
    });
    if (!stillOutcome.ok) {
      return { ok: false, failedAtClipIndex: i, message: `Clip ${i + 1}: ${stillOutcome.message}`, renderedCount: i };
    }

    const uploadOutcome = await deps.uploadStill(stillOutcome.dataUrl);
    const stillUrl = uploadOutcome.ok ? uploadOutcome.url : stillOutcome.dataUrl;
    const still: SkidmarksPlateStill = { dataUrl: stillUrl, source: "generated", createdAt: Date.now() };
    deps.setPlateStill(target.segmentId, target.plateId, still);

    if (vocal && !mp3AudioUrl) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Clip ${i + 1} is Vocal, so it needs the song's real audio to drive lip sync — no attached MP3 audio is available yet.`,
        renderedCount: i,
      };
    }

    report({ type: "rendering", clipIndex: i, clipCount: parts.length });
    const durationSec = computePlateDurationSec(
      part.endSec - part.startSec,
      1,
      0,
      vocal ? LTX_DURATION_BOUNDS : undefined
    );

    const request = buildClipGenerationRequest({
      shotPrompt: part.shotPrompt,
      bandName,
      plateStillDataUrl: stillUrl,
      durationSec,
      vocal,
      instrumentalVideoModel: vocal ? undefined : "grok",
      vocalist: identity.member,
      mp3AudioUrl: vocal ? mp3AudioUrl : undefined,
      segmentId: target.segmentId,
      plateId: target.plateId,
      plateIndex: 0,
      plateCount: 1,
      clipIndex: i,
      startSec: part.startSec,
      endSec: part.endSec,
    });

    const outcome = await deps.renderClip(request);
    if (!outcome.ok) {
      return { ok: false, failedAtClipIndex: i, message: outcome.message, renderedCount: i };
    }
    if (!outcome.persisted) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: outcome.persistError
          ? `Clip ${i + 1} rendered but couldn't be saved: ${outcome.persistError}`
          : `Clip ${i + 1} rendered but couldn't be saved.`,
        renderedCount: i,
      };
    }

    deps.recordRender({
      segmentId: target.segmentId,
      plateId: target.plateId,
      url: outcome.videoUrl,
      filename: `${String(i + 1).padStart(2, "0")}_${part.startSec}-${part.endSec}.mp4`,
      clipIndex: i,
      startSec: part.startSec,
      endSec: part.endSec,
      // Deliberately no `lastFrameUrl` — see `IdentitySafeRunDeps
      // .renderClip`'s doc comment. Rule 5: last-frame chaining is
      // banned for identity, so this runner never asks for one and
      // never has one to write into the next clip's plate.
    });

    report({ type: "clip-done", clipIndex: i, clipCount: parts.length });
  }

  return { ok: true, renderedCount: parts.length };
}


export interface ScriptSequenceRunnerDeps {
  /** Resolves any still's `dataUrl` (already-`data:`, or a real Blob
   * URL) into a guaranteed `data:` URL — same contract as
   * `lib/plateGeneration.ts`'s `resolvePlateReferenceDataUrl`. */
  resolveIdentityDataUrl: (dataUrl: string) => Promise<string>;
  /** Generates the very first clip's starting still from its own shot
   * prompt — nothing to chain from yet at clip 1. `vocal` picks the
   * same still-generation framing a manual Generate would for a
   * clip in that position (see `lib/plateGeneration.ts`'s
   * `buildPlateGenerationRequest`), and `vocalist` carries a locked
   * character's identity reference/hallmarks through when clip 1
   * itself turns out to be Vocal. */
  generateFirstStill: (
    shotPrompt: string,
    bandName: string,
    vocal: boolean,
    vocalist: SkidmarksMember | undefined
  ) => Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>;
  /** Uploads a still's bytes to durable storage — same contract as
   * `lib/plateStillBlob.ts`'s `uploadSkidmarksPlateStill`. */
  uploadStill: (dataUrl: string) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;
  /** Renders one clip — same contract as `lib/clipGeneration.ts`'s
   * `generateSkidmarksClip`, called with an already-built request.
   * `lastFrameUrl`, when present, is the render's own last frame
   * already extracted and saved server-side
   * (`app/api/skidmarks/generate-clip/route.ts`, `lib/
   * serverVideoFrame.ts`) — the chaining step below reads it directly
   * rather than calling out to a separate client-side extraction (see
   * this module's doc comment for why that old approach was removed). */
  renderClip: (request: ReturnType<typeof buildClipGenerationRequest>) => Promise<
    | { ok: true; videoUrl: string; persisted: boolean; persistError?: string; lastFrameUrl?: string }
    | { ok: false; message: string }
  >;
  /** Turns a persisted render's own `PersistedClipRender` shape (what
   * `renderClip` on success implies) — the runner builds this itself,
   * this dep just records it wherever the caller keeps the render shelf
   * (`addRender` in `SkidmarksDetailSheet.tsx`). */
  recordRender: (render: PersistedClipRender) => void;
  /** Writes a still onto a plate slot — same contract as
   * `lib/skidmarks.ts`'s `setSkidmarksClipPlateStill`. */
  setPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill) => void;
  onProgress?: (event: ScriptSequenceRunEvent) => void;
}

export type ScriptSequenceRunEvent =
  | { type: "generating-first-still" }
  | { type: "rendering"; clipIndex: number; clipCount: number; title?: string }
  | { type: "chaining"; clipIndex: number; clipCount: number }
  | { type: "clip-done"; clipIndex: number; clipCount: number };

export type ScriptSequenceRunOutcome =
  | { ok: true; renderedCount: number }
  | { ok: false; failedAtClipIndex: number; message: string; renderedCount: number; stopped?: boolean };

/**
 * How many consecutive clips a locked character (Jack Ash) may chain
 * last-frame → first-frame inside one scene before the next clip has
 * to start from a freshly generated still of *its own* scene (audit
 * Rule B / test J4: "max 3 clips in one place, then a new generated
 * still in a new location"). Chaining carries lighting, framing and
 * any small drift forward; capping the chain is what stops a full
 * song's worth of compounding. Only applies when the vocalist has a
 * registered character lock — an unlocked band chains freely.
 */
export const SCENE_BLOCK_CLIP_COUNT = 3;

/**
 * The real render length for one script part: its own `(start - end)`
 * span, clamped into the Vocal (LTX) window — the same `[5, 15]`s both
 * backends use. Audit test J5/L1: a 10s part renders about 10s, never
 * a hardcoded 15. Pure.
 */
export function scriptClipDurationSec(segment: Pick<SkidmarksClipSegment, "startSec" | "endSec">): number {
  return computePlateDurationSec(segment.endSec - segment.startSec, 1, 0, LTX_DURATION_BOUNDS);
}

/**
 * Generates + uploads a fresh starting still for `segment` through the
 * locked-character still pipeline (full shadow-face lock, reference
 * photo) — used for clip 1, for the first clip of every new scene
 * block, and for a resume that lands on a clip with no still yet.
 */
async function generateSceneStill(
  segment: SkidmarksClipSegment,
  bandName: string,
  vocalist: SkidmarksMember | undefined,
  deps: ScriptSequenceRunnerDeps
): Promise<{ ok: true; still: SkidmarksPlateStill } | { ok: false; message: string }> {
  const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label]?.vocal ?? false;
  const stillOutcome = await deps.generateFirstStill(segment.shotPrompt, bandName, vocal, vocalist);
  if (!stillOutcome.ok) return stillOutcome;
  const uploadOutcome = await deps.uploadStill(stillOutcome.dataUrl);
  const locked = !!vocalist && !!getSkidmarksCharacterLock(vocalist);
  return {
    ok: true,
    still: {
      dataUrl: uploadOutcome.ok ? uploadOutcome.url : stillOutcome.dataUrl,
      source: "generated",
      createdAt: Date.now(),
      ...(locked && vocal ? { featuresLockedCharacter: true } : {}),
    },
  };
}

/**
 * Runs the whole sequence: generates clip 1's starting still if it
 * doesn't have one yet, then renders every segment in order, chaining
 * each render's closing frame into the next segment's plate before
 * moving on. Stops immediately on any real failure (first-still
 * generation, a render, or a chain-fill) — see this module's doc
 * comment. Never throws; every outcome, including a mid-run stop, comes
 * back as this function's own return value.
 *
 * **Vocal clips need the song's real audio** (`lib/skidmarks.ts`'s
 * `buildScriptSequenceSegments`/`resolveScriptPartVocal` already
 * decided which segments those are, off the song's own real
 * transcription — this function just trusts each segment's own
 * `label`). `mp3AudioUrl`/`vocalist` are only read for a segment that's
 * actually Vocal; a Vocal segment with no `mp3AudioUrl` available fails
 * that clip honestly rather than sending a request the server can't
 * fulfill.
 *
 * **`startAtClipIndex`** (default `0`) lets a caller resume an earlier,
 * partially-completed run at a real failure (a real live example,
 * 2026-09-14: xAI's own content-moderation rejecting one generated
 * clip, 12 of 16 already rendered fine) without re-spending on the
 * clips that already rendered — `i` stays each clip's real, absolute
 * position throughout (so progress events, filenames, and Blob
 * pathnames all still read correctly), the loop just starts partway
 * through, and the "generate clip 1's starting still" step is skipped
 * entirely whenever `startAtClipIndex > 0` (clip 1 already has one from
 * the original run). The caller is responsible for passing the *same*
 * `segments` array clips 1..`startAtClipIndex - 1` already rendered
 * into (`components/SkidmarksScriptSequencePanel.tsx`'s `handleResume`
 * reads it straight back off the stored session, not a fresh
 * `buildScriptSequenceSegments` call — a fresh build would mint new
 * segment/plate ids and have no starting stills at all).
 */
export async function runScriptSequence(
  segments: SkidmarksClipSegment[],
  bandName: string,
  deps: ScriptSequenceRunnerDeps,
  mp3AudioUrl: string | undefined,
  vocalist: SkidmarksMember | undefined,
  startAtClipIndex: number = 0,
  /** Checked before every clip starts rendering (never mid-render — a
   * render already in flight has already been paid for, stopping
   * partway through it wastes that spend for nothing and still leaves
   * a plate with no video). Real ask (2026-09-16): a way to interrupt a
   * long "Generate & render all" batch the moment something looks
   * wrong, instead of it burning through every remaining clip's worth
   * of real credits before Stuart can react. `undefined` (the default)
   * never stops early — existing callers/tests are unaffected. */
  shouldStop?: () => boolean
): Promise<ScriptSequenceRunOutcome> {
  const report = (event: ScriptSequenceRunEvent) => deps.onProgress?.(event);

  if (segments.length === 0) {
    return { ok: false, failedAtClipIndex: 0, message: "No clips to render.", renderedCount: 0 };
  }

  const startIndex = Math.max(0, Math.min(startAtClipIndex, segments.length));
  const lockedVocalist = !!vocalist && !!getSkidmarksCharacterLock(vocalist);
  // "Build timeline" pre-fills every plate with the vocalist's own
  // master photo so Stuart can eyeball the timeline before spending.
  // That photo is a placeholder, not a scene still: if the run treated
  // it as "already has a still," every clip would start on the same
  // picture and end near it — the real cause of fifty-six identical
  // last frames (audit Part 4). Only the clip this run starts on may
  // render from it; every later plate still holding it gets chained
  // into or given a fresh scene still exactly as if it were empty.
  const masterPhotoUrl = vocalist?.avatarImage;
  const isPlaceholderStill = (still: SkidmarksPlateStill | undefined) =>
    !!still && !!masterPhotoUrl && still.dataUrl === masterPhotoUrl;

  // The clip this run starts on needs a starting image before anything
  // is spent on a render: clip 1 on a fresh run (nothing to chain from
  // yet), or a resume landing on a clip that was never chained into
  // (a run stopped/failed right after the previous clip, or a scene
  // block whose fresh still failed).
  const startSegment = segments[startIndex];
  if (startSegment && startSegment.plates[0] && !startSegment.plates[0].still) {
    report({ type: "generating-first-still" });
    const stillOutcome = await generateSceneStill(startSegment, bandName, vocalist, deps);
    if (!stillOutcome.ok) {
      return { ok: false, failedAtClipIndex: startIndex, message: stillOutcome.message, renderedCount: startIndex };
    }
    deps.setPlateStill(startSegment.id, startSegment.plates[0].id, stillOutcome.still);
    startSegment.plates[0].still = stillOutcome.still; // so the loop below sees it immediately, without a store re-read
  }

  // How many clips of the current scene block have rendered so far —
  // the clip this run starts on is block clip 1. See `SCENE_BLOCK_CLIP_COUNT`.
  let clipsInBlock = 0;

  for (let i = startIndex; i < segments.length; i++) {
    if (shouldStop?.()) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Stopped before clip ${i + 1} — no more clips will render.`,
        renderedCount: i,
        stopped: true,
      };
    }
    const segment = segments[i];
    const plate = segment.plates[0];
    const still = plate?.still;
    if (!plate || !still) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Clip ${i + 1} has no starting image to render from.`,
        renderedCount: i,
      };
    }

    report({ type: "rendering", clipIndex: i, clipCount: segments.length });

    const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label]?.vocal ?? false;
    if (vocal && !mp3AudioUrl) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Clip ${i + 1} lands on real singing in the song, so it needs to render as Vocal (LTX) — but no attached MP3 audio is available yet.`,
        renderedCount: i,
      };
    }

    const resolvedStillDataUrl = await deps.resolveIdentityDataUrl(still.dataUrl);
    const request = buildClipGenerationRequest({
      shotPrompt: segment.shotPrompt,
      bandName,
      plateStillDataUrl: resolvedStillDataUrl,
      durationSec: scriptClipDurationSec(segment),
      vocal,
      instrumentalVideoModel: vocal ? undefined : "grok",
      vocalist: vocal ? vocalist : undefined,
      mp3AudioUrl: vocal ? mp3AudioUrl : undefined,
      segmentId: segment.id,
      plateId: plate.id,
      plateIndex: 0,
      plateCount: 1,
      clipIndex: i,
      startSec: segment.startSec,
      endSec: segment.endSec,
    });

    const outcome = await deps.renderClip(request);
    if (!outcome.ok) {
      return { ok: false, failedAtClipIndex: i, message: outcome.message, renderedCount: i };
    }
    if (!outcome.persisted) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: outcome.persistError
          ? `Clip ${i + 1} rendered but couldn't be saved: ${outcome.persistError}`
          : `Clip ${i + 1} rendered but couldn't be saved.`,
        renderedCount: i,
      };
    }

    const render: PersistedClipRender = {
      segmentId: segment.id,
      plateId: plate.id,
      url: outcome.videoUrl,
      filename: `${String(i + 1).padStart(2, "0")}_${segment.startSec}-${segment.endSec}.mp4`,
      clipIndex: i,
      startSec: segment.startSec,
      endSec: segment.endSec,
      ...(outcome.lastFrameUrl ? { lastFrameUrl: outcome.lastFrameUrl } : {}),
    };
    deps.recordRender(render);
    clipsInBlock += 1;
    report({ type: "clip-done", clipIndex: i, clipCount: segments.length });

    const nextSegment = segments[i + 1];
    if (!nextSegment) break; // last clip — nothing left to chain into

    const nextPlate = nextSegment.plates[0];
    if (!nextPlate) continue;
    if (nextPlate.still && !isPlaceholderStill(nextPlate.still)) continue; // a real still Stuart accepted — never overwrite it

    if (lockedVocalist && clipsInBlock >= SCENE_BLOCK_CLIP_COUNT) {
      // Scene block complete — the next clip starts from a fresh still
      // of its own scene, never from this clip's last frame and never
      // from the same master photo again (audit test J4). A stop
      // request is honoured here too: a fresh still is a paid call.
      if (shouldStop?.()) {
        return {
          ok: false,
          failedAtClipIndex: i + 1,
          message: `Stopped after clip ${i + 1} — no more clips will render.`,
          renderedCount: i + 1,
          stopped: true,
        };
      }
      report({ type: "generating-first-still" });
      const freshOutcome = await generateSceneStill(nextSegment, bandName, vocalist, deps);
      if (!freshOutcome.ok) {
        return {
          ok: false,
          failedAtClipIndex: i + 1,
          message: `Clip ${i + 1} finished a ${SCENE_BLOCK_CLIP_COUNT}-clip scene block, but generating a fresh still for clip ${i + 2}'s new scene failed: ${freshOutcome.message}`,
          renderedCount: i + 1,
        };
      }
      deps.setPlateStill(nextSegment.id, nextPlate.id, freshOutcome.still);
      nextPlate.still = freshOutcome.still; // so the next loop iteration sees it immediately, without a store re-read
      clipsInBlock = 0;
      continue;
    }

    report({ type: "chaining", clipIndex: i, clipCount: segments.length });

    // Real reported disaster (2026-09-15): chaining every clip's last
    // frame into the next blindly compounds drift when the camera swings
    // around/zooms during the render itself — one clip losing the
    // shadow-face lock a little means the next clip starts from an
    // already-part-human frame and drifts further. Two rounds of fixes
    // since then landed at the actual source: the camera-motion rules
    // (`lib/clipGeneration.ts`'s `lockedCharacterVideoNote`/
    // `automaticMotionHint` — camera holds, no full-black frame, no
    // rapid movement around his head). With those in place, Stuart's
    // own manual testing (screenshotting each render's last frame and
    // re-uploading it as the next clip's start, by hand) chained
    // continuously with no reset and held up fine — proving the
    // resetting-every-few-clips compromise built after the disaster
    // (2026-09-15/16) was solving the wrong layer of the problem.
    // Reverted 2026-09-16 (direct ask, backed by that real evidence):
    // back to continuous chaining for a locked character too, same as
    // an unlocked vocalist always has — no special-cased fallback to
    // his reference photo either, on the same direct instruction, same
    // day: silently swapping in a different photo he didn't choose when
    // a capture genuinely failed is "lazy," not a real fix. If the
    // server can't capture a last frame, this stops honestly and says
    // so — identical to how an unlocked vocalist has always behaved —
    // rather than papering over it with a substitute.
    if (!outcome.lastFrameUrl) {
      return {
        ok: false,
        failedAtClipIndex: i,
        message: `Couldn't carry clip ${i + 1}'s last frame into clip ${i + 2}: the server couldn't capture this render's last frame.`,
        renderedCount: i + 1,
      };
    }

    // Already a durable Blob URL (server-side extraction — see this
    // module's doc comment) — no upload left to do here.
    const chainedStill: SkidmarksPlateStill = {
      dataUrl: outcome.lastFrameUrl,
      source: "chained",
      createdAt: Date.now(),
      ...(lockedVocalist && vocal ? { featuresLockedCharacter: true } : {}),
    };
    deps.setPlateStill(nextSegment.id, nextPlate.id, chainedStill);
    nextPlate.still = chainedStill; // so the next loop iteration sees it immediately, without a store re-read
  }

  return { ok: true, renderedCount: segments.length };
}
