/**
 * Pure planning logic for "Auto-plate from a short brief" — the one
 * slim brief field + one Auto-plate control on the clip timeline (see
 * `components/SkidmarksAutoPlate.tsx` for the actual execution: this
 * module only ever *decides* which empty plate slots get which shot
 * prompt; it makes no network call itself, so it's fully unit-testable
 * without a real `XAI_API_KEY`, same "pure planner, side-effecting
 * runner" split as `lib/plateGeneration.ts`/`lib/clipGeneration.ts`).
 *
 * **What this does and firmly doesn't do**: it fills *empty* plate
 * slots across the whole clip list with a real, generated still (via
 * the existing xAI still-generation path, `lib/plateGeneration.ts`) —
 * then stops. It never touches a plate that already has a still
 * (Stuart's "prefer filling empties, don't overwrite filled plates
 * unless he explicitly regenerates" ask — regenerating a filled plate
 * is still the existing per-plate Generate/Replace flow, untouched),
 * never adds a new plate slot to a clip's strip, and — per AGENTS.md's
 * hard cost lock — never renders so much as one clip of *video*. This
 * is a heuristic planner, not an LLM call against the brief: every shot
 * prompt it produces comes from a small, hand-authored set of
 * templates keyed off a plate's real position (label, vocal/
 * instrumental, first-clip-or-not), the same "baked heuristics, not an
 * invented model call" spirit as `defaultSegmentModel`/
 * `routingFramingHint` elsewhere in this feature.
 *
 * **The one scripted exception**: Stuart's own concrete opener idea —
 * a weathered door in a cracked concrete wall with neon-blue light
 * bleeding through → a look through its keyhole → Jack Ash seated in
 * shadow beyond it — only fires when the brief (or the attached
 * filename, as a fallback hint) actually mentions it (`door`,
 * `concrete`, or `keyhole`), and only onto the *first* clip's own empty
 * plate slots, in strip order. It's never applied just because the
 * active band happens to be Jack Ash — Stuart has other Jack Ash songs
 * that aren't this one, and this opener is a specific creative choice
 * for a specific brief, not a band-wide default.
 */

import {
  SKIDMARKS_SEGMENT_LABEL_META,
  type SkidmarksClipSegment,
} from "./skidmarks";

/** Short by design — a couple of words to a short sentence ("door,
 * keyhole, Jack, neon-blue"), not a paragraph brief. Enforced both as
 * the `<textarea>`'s own `maxLength` in `components/SkidmarksAutoPlate
 * .tsx` and here, so a request built without going through that field
 * can't quietly bypass the same cap. */
export const MAX_AUTO_PLATE_BRIEF_LENGTH = 240;

/** Rough, deliberately conservative per-still cost used only for the
 * confirm step's estimate — mirrors `lib/plateGeneration.ts`'s module
 * doc comment ("roughly one to a few cents" via xAI Grok Imagine); not
 * a real xAI pricing call, just enough for Stuart to see "this taps N
 * times" before committing. */
export const ESTIMATED_STILL_COST_USD = 0.02;

export interface AutoPlateTarget {
  segmentId: string;
  plateId: string;
  /** The shot description this target's still generation call should
   * use — **not** written back to `SkidmarksClipSegment.shotPrompt`
   * (that field stays one shared value Stuart edits himself; see
   * `lib/skidmarks.ts`'s doc comment for why). Each still still bakes in
   * whatever prompt it was generated with, the same way a manual
   * "type a shot prompt, tap Generate on plate 2, edit it, tap Generate
   * on plate 3" pass already works — this just automates picking what
   * to type each time. */
  shotPrompt: string;
  /** Whether this target should continue from the plate right before it
   * in the same strip (the "Use last plate" checkbox's effect) — only
   * `true` for the scripted concrete-opener's 2nd/3rd plate, so the
   * keyhole/Jack shots visually continue the door shot instead of each
   * reading as an unrelated scene. Every other, non-scripted fill
   * defaults to `false`: two unrelated empty plates on two different
   * clips have no reason to look continuous. */
  continueFromPreviousPlate: boolean;
}

const CONCRETE_OPENER_KEYWORDS = ["door", "concrete", "keyhole"];

function mentionsConcreteOpener(text: string): boolean {
  const lower = text.toLowerCase();
  return CONCRETE_OPENER_KEYWORDS.some((kw) => lower.includes(kw));
}

/** The scripted door → keyhole → Jack sequence, in strip order — only
 * ever applied to the first clip's own plate slots (index 0/1/2 within
 * that one strip), and only into whichever of those are still empty. */
const CONCRETE_OPENER_SHOTS = [
  "A weathered wooden door set into a crumbling concrete wall, a jagged crack across it glowing with neon-blue light bleeding through.",
  "Looking through the door's keyhole into a dim room beyond, neon-blue light spilling around the edges of the frame.",
  "Jack seated in shadow just beyond the keyhole, glowing neon-blue lips the only thing visible in the dark.",
];

/** Small, varied, hand-authored templates for a *generic* empty plate —
 * cycled deterministically (not randomly, so this stays testable) by a
 * plate's overall position, so a song with many empty plates doesn't
 * get the exact same line repeated verbatim on every one. */
const VOCAL_SHOT_TEMPLATES = [
  "Close-up performance shot of {band}'s vocalist mid-lyric, dramatic stage lighting, music-video still.",
  "Medium shot of the vocalist mid-performance, moody colored stage lighting, cinematic music-video framing.",
  "Wide performance shot of {band} on stage, atmospheric haze and colored lighting, strong sense of scale.",
];

const INSTRUMENTAL_SHOT_TEMPLATES = [
  "Wide atmospheric B-roll shot establishing the scene's mood, moody lighting, cinematic music-video still.",
  "Tight, textured close-up of an evocative detail setting the scene's tone \u2014 hands, an instrument, a shadow.",
  "Establishing wide shot, dynamic camera angle, strong sense of place, cinematic music-video still.",
];

function genericShotPrompt(vocal: boolean, bandName: string, rotationIndex: number): string {
  const templates = vocal ? VOCAL_SHOT_TEMPLATES : INSTRUMENTAL_SHOT_TEMPLATES;
  const template = templates[((rotationIndex % templates.length) + templates.length) % templates.length];
  return template.replace("{band}", bandName);
}

/**
 * Plans which empty plate slots get which shot prompt — pure, so
 * `components/SkidmarksAutoPlate.tsx` (or a test) can call this without
 * a real xAI key or network access. Returns an empty array when there's
 * nothing to fill (every plate already has a still) — a genuinely
 * successful "nothing to do" answer, not a failure.
 */
export function planAutoPlateFill(
  segments: SkidmarksClipSegment[],
  brief: string,
  bandName: string,
  songTitleHint: string = ""
): AutoPlateTarget[] {
  const trimmedBrief = brief.trim().slice(0, MAX_AUTO_PLATE_BRIEF_LENGTH);
  const applyConcreteOpener =
    mentionsConcreteOpener(trimmedBrief) || mentionsConcreteOpener(songTitleHint);

  const targets: AutoPlateTarget[] = [];
  let rotation = 0;

  segments.forEach((segment, segmentIndex) => {
    const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label]?.vocal ?? false;
    const isFirstClip = segmentIndex === 0;

    segment.plates.forEach((plate, plateIndex) => {
      if (plate.still) return; // never overwrite a filled plate

      if (isFirstClip && applyConcreteOpener && plateIndex < CONCRETE_OPENER_SHOTS.length) {
        targets.push({
          segmentId: segment.id,
          plateId: plate.id,
          shotPrompt: CONCRETE_OPENER_SHOTS[plateIndex],
          continueFromPreviousPlate: plateIndex > 0,
        });
        return;
      }

      targets.push({
        segmentId: segment.id,
        plateId: plate.id,
        shotPrompt: genericShotPrompt(vocal, bandName, rotation),
        continueFromPreviousPlate: false,
      });
      rotation += 1;
    });
  });

  return targets;
}
