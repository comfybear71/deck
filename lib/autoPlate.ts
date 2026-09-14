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
 * **The one scripted exception**: Stuart's own concrete opener idea for
 * *Talking to Concrete*'s 0:00–0:40 opener — a front-on dark door
 * with a centered keyhole → the same shot, closer, on the keyhole
 * itself → Jack Ash seen through that hole — only fires when the
 * brief (or the attached filename, as a fallback hint) actually
 * mentions it (`door`, `concrete`, or `keyhole`), and only onto the
 * *first* clip's own empty plate slots, in strip order. It's never
 * applied just because the active band happens to be Jack Ash —
 * Stuart has other Jack Ash songs that aren't this one, and this
 * opener is a specific creative choice for a specific brief, not a
 * band-wide default.
 *
 * **All three shots are locked-off ("dead-on the whole way", Stuart's
 * words) — same angle throughout, only the framing tightens.** They
 * are Instrumental/B-roll, not Vocal — the door and keyhole have no
 * one in frame, and even plate 3's Jack is seen through a keyhole, not
 * performing to camera. That's not something this module has to
 * enforce: Auto-plate never renders video at all (see this module's own
 * doc comment above), so "don't LTX these" is already structurally true
 * for every shot it plans, this opener included.
 *
 * **Plate 3's own failure mode, live-QA'd and already fixed one layer
 * down**: an earlier pass generated this exact shot and got back a
 * fully-lit stranger's face, not Jack. `lib/plateGeneration.ts`'s
 * `shotPromptMentionsLockedCharacter` is the fix — it matches "Jack"
 * as a whole word in the shot prompt and attaches his hallmarks/
 * negative cues + his reference photo automatically, on an Instrumental
 * clip same as a Vocal one. `CONCRETE_OPENER_SHOTS[2]` below names him
 * by name specifically so that lock keeps firing; don't reword it to
 * something like "the mysterious figure" that drops his name out of
 * the sentence.
 *
 * **Master-still routing (2026-09-13, Stuart's "17 positions" ask)**:
 * every fill this planner produces *outside* the scripted opener above
 * still defaults to the small generic xAI templates below — unless the
 * caller passes `masterStillDataUrl` (the resolved vocalist's own real
 * `avatarImage`, per `lib/skidmarks.ts`), in which case those same
 * empty slots instead draw a real camera position from
 * `lib/sirayPositions.ts`'s `SIRAY_17_POSITIONS` (Stuart's own pack,
 * pasted verbatim there) and are marked to generate via Siray's
 * Seedream ref2i model (`lib/sirayClient.ts`,
 * `generatePlateStillViaSiray` in `lib/plateGeneration.ts`) instead of
 * xAI — real angle variety off one locked reference photo, instead of
 * a handful of generic sentences. A band with no master still set keeps
 * using the xAI templates, unchanged; this never fails or blocks a fill
 * just because Siray isn't configured for a particular band yet. See
 * `pickSirayPosition`'s own doc comment for exactly which position a
 * given slot gets.
 *
 * **Backdrop variety (2026-09-14, Stuart's ask)**: every non-scripted
 * fill on *either* path (xAI or Siray) also gets a real location prepended
 * from `AUTO_PLATE_LOCATIONS` below — he's using Auto-plate specifically
 * to avoid typing a per-clip prompt himself, and `SIRAY_17_POSITIONS` is
 * camera framing only, so without this every Siray fill shared whatever
 * backdrop the master still itself happened to show. See
 * `AUTO_PLATE_LOCATIONS`'s own doc comment.
 *
 * **Locations from the brief (2026-09-14, same-day follow-up)**: when
 * the typed brief itself lists two or more real places — split on a
 * comma or " / ", e.g. "red hallway door, fence gate in the dirt, night
 * pool shallow end, wet concrete in the rain" — those places cycle as
 * this run's own locations instead of `AUTO_PLATE_LOCATIONS`, on both
 * paths. A brief with fewer than two place phrases (empty, or a plain
 * mood-board line with no commas/slashes) falls straight back to the
 * hand-authored table, unchanged. See `parseBriefLocationPhrases`. The
 * scripted door/concrete/keyhole opener is untouched either way — it
 * keeps its own exact wording regardless of what the brief's other
 * places are.
 */

import {
  SKIDMARKS_SEGMENT_LABEL_META,
  type SkidmarksClipSegment,
} from "./skidmarks";
import { pickSirayPosition } from "./sirayPositions";

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

/** Siray's real, published Seedream 4.5 ref2i-spicy flat rate — see
 * `lib/sirayClient.ts`'s own `SIRAY_SEEDREAM_45_COST_USD` (duplicated
 * here on purpose rather than imported: that module is server-only,
 * this one is bundled into `components/SkidmarksAutoPlate.tsx`'s
 * client code, same "each self-contained module restates its own
 * constant" convention `MIN_LTX_CLIP_DURATION_SEC` etc. already use
 * across this feature). Used only for a master-still target's own
 * share of the confirm step's estimate — see `estimateAutoPlateCostUsd`. */
export const SIRAY_STILL_COST_USD = 0.04;

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
  /** Set only for a master-still-routed target (see this module's doc
   * comment) — `components/SkidmarksAutoPlate.tsx` calls
   * `generatePlateStillViaSiray` instead of the default xAI
   * `generatePlateStill` when this is present, sending exactly this one
   * reference image (the character's master still). Undefined for
   * every xAI-routed target: the scripted concrete opener, and any
   * generic fill for a band with no master still set. */
  siray?: { referenceImageDataUrl: string };
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
  // 1 — door. Front-on, locked-off; only the cracks carry any neon,
  // the hole itself stays unlit — nothing to see through it yet.
  "Front-on dark door, keyhole centered, mild blue neon only in the cracks around the frame, no light from the hole.",
  // 2 — keyhole. Same door, same angle, just closer — the keyhole
  // itself now carries a mild, half-strength blue seep (no beam, no
  // angle change) as the one hint of what's on the other side.
  "Same door, same angle, closer — keyhole centered and large, mild half-strength blue seep inside the hole only, no beam, no angle.",
  // 3 — Jack through the hole. Names him explicitly (keeps
  // `shotPromptMentionsLockedCharacter` firing — see this module's doc
  // comment) and states the fedora/shadow/neon-lips lock hard, since
  // this exact shot has come back as a random, fully-lit stranger
  // before. If that happens again, strengthen this wording further
  // before anything else — the character-lock machinery already
  // attaches Jack's reference photo whenever his name appears here.
  "Same keyhole as the frame. Jack Ash, black brim fedora, sitting in a dim room, legs slightly apart, feet on the floor, hands on knees, face in deep shadow under the brim, neon blue lips only, no other face light. Not a new man, no lit portrait, no bare head.",
];

/** Small, varied, hand-authored templates for a *generic* empty plate —
 * cycled deterministically (not randomly, so this stays testable) by a
 * plate's overall position, so a song with many empty plates doesn't
 * get the exact same line repeated verbatim on every one. */
// Live-QA fix (2026-09-13, "every fucking image is staring straight out
// the camera"): these three used to read as soft front performance
// shots ("Close-up performance shot of {band}'s vocalist mid-lyric…"),
// with nothing steering the framing away from a camera-facing stare.
// Reworded to explicitly off-axis angles (¾ / profile / over-the-
// shoulder, face or gaze turned away from the lens) — this pool only
// ever fires for a band with no master still set (see this module's own
// doc comment's "Master-still routing" section), so it's the one path
// where a locked character's own camera-angle lock (`lib/plateGeneration
// .ts`'s `SKIDMARKS_CHARACTER_LOCKS`) isn't reinforcing this on top —
// the template text itself has to carry the off-axis instruction.
// Dropped the old "stage lighting"/"on stage" wording (2026-09-14,
// Stuart's ask below) \u2014 it assumed a concert setting that fights the
// new location line prepended in front of these by `genericShotPrompt`.
const VOCAL_SHOT_TEMPLATES = [
  "Close, angled \u00be view of {band}'s vocalist mid-lyric, face turned away from the lens, moody lighting, cinematic music-video still.",
  "Medium profile shot of the vocalist mid-performance, gaze off to the side rather than toward camera, cinematic music-video framing.",
  "Wide over-the-shoulder shot of the vocalist, facing away from camera into the scene, atmospheric haze and colored lighting.",
];

const INSTRUMENTAL_SHOT_TEMPLATES = [
  "Wide atmospheric B-roll shot establishing the scene's mood, moody lighting, cinematic music-video still.",
  "Tight, textured close-up of an evocative detail setting the scene's tone \u2014 hands, an instrument, a shadow.",
  "Dynamic wide angle, strong sense of place, cinematic music-video still.",
];

/** Hand-authored backdrop variety (2026-09-14, Stuart's ask: "just the
 * variations... it's just a background and where is location... I don't
 * have any of those prompts") \u2014 he's on Auto-plate to *avoid* having to
 * type a location per clip, so this table exists so he never has to.
 * Matches the seed "Jack Ash" band's own tagline ("Dirt roads & bad
 * decisions") and the desert/neon/shadow look already established
 * elsewhere (his reference photo, the door/keyhole opener) \u2014 same
 * "small, hand-authored, not inferred" spirit as `SKIDMARKS_CHARACTER_
 * LOCKS`/`SIRAY_17_POSITIONS`. Cycled the same deterministic way as
 * everything else here (see `genericShotPrompt`/the Siray branch in
 * `planAutoPlateFill`), so a song with many empty plates gets real
 * variety, not the same backdrop on every fill. Generic enough to still
 * suit a future non-desert band \u2014 nothing here names Jack Ash. */
const AUTO_PLATE_LOCATIONS = [
  "A lonely desert highway at night, red taillights fading into the dark, dust drifting through the headlights.",
  "A rundown roadside motel, its neon sign flickering over an empty parking lot.",
  "A dive bar's back alley, neon spill through a cracked door, empty bottles on the ground.",
  "A gas station forecourt at 3am, one buzzing fluorescent light, not another car in sight.",
  "An abandoned drive-in movie screen, cracked and dark, moonlit desert stretching out behind it.",
  "A concrete underpass, spray-painted walls, a single flickering streetlight overhead.",
  "The open bed of a pickup truck under a wide, starlit desert sky.",
  "A dusty crossroads, a leaning stop sign, storm clouds building on the horizon.",
];

/** Splits a typed brief into individual place phrases on a comma or
 * " / " — e.g. "red hallway door, fence gate in the dirt, night pool
 * shallow end, wet concrete in the rain" becomes four real places.
 * Blank segments (a trailing comma, a doubled separator) are dropped.
 * Pure string splitting, never sent to an LLM — same "heuristic
 * planner, not an invented model call" spirit as the rest of this
 * module. `planAutoPlateFill` only actually uses this run's own places
 * once there are at least two of them — see this module's doc comment's
 * "Locations from the brief" note for why one bare word isn't treated
 * as a real location list. */
function parseBriefLocationPhrases(brief: string): string[] {
  return brief
    .split(/,| \/ /)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);
}

function pickAutoPlateLocation(locations: string[], rotationIndex: number): string {
  const i = ((rotationIndex % locations.length) + locations.length) % locations.length;
  return locations[i];
}

function genericShotPrompt(vocal: boolean, bandName: string, rotationIndex: number, locations: string[]): string {
  const templates = vocal ? VOCAL_SHOT_TEMPLATES : INSTRUMENTAL_SHOT_TEMPLATES;
  const template = templates[((rotationIndex % templates.length) + templates.length) % templates.length];
  return `${pickAutoPlateLocation(locations, rotationIndex)} ${template.replace("{band}", bandName)}`;
}

/**
 * Plans which empty plate slots get which shot prompt — pure, so
 * `components/SkidmarksAutoPlate.tsx` (or a test) can call this without
 * a real xAI/Siray key or network access. Returns an empty array when
 * there's nothing to fill (every plate already has a still) — a
 * genuinely successful "nothing to do" answer, not a failure.
 *
 * `masterStillDataUrl`, when passed, routes every non-scripted-opener
 * fill through Siray's real position pack instead of the generic xAI
 * templates — see this module's doc comment's "Master-still routing"
 * note.
 */
export function planAutoPlateFill(
  segments: SkidmarksClipSegment[],
  brief: string,
  bandName: string,
  songTitleHint: string = "",
  masterStillDataUrl?: string
): AutoPlateTarget[] {
  const trimmedBrief = brief.trim().slice(0, MAX_AUTO_PLATE_BRIEF_LENGTH);
  const applyConcreteOpener =
    mentionsConcreteOpener(trimmedBrief) || mentionsConcreteOpener(songTitleHint);
  // Two or more real places typed in the brief cycle as this run's own
  // locations instead of the hand-authored table — see this module's
  // doc comment's "Locations from the brief" note. Never applies to the
  // scripted opener's own three shots below, which keep their exact
  // wording regardless.
  const briefLocationPhrases = parseBriefLocationPhrases(trimmedBrief);
  const locations = briefLocationPhrases.length >= 2 ? briefLocationPhrases : AUTO_PLATE_LOCATIONS;

  const targets: AutoPlateTarget[] = [];
  let rotation = 0;
  let sirayRotation = 0;

  segments.forEach((segment, segmentIndex) => {
    const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label]?.vocal ?? false;
    const isFirstClip = segmentIndex === 0;
    let emptySlotsSeenInSegment = 0;

    segment.plates.forEach((plate, plateIndex) => {
      if (plate.still) return; // never overwrite a filled plate
      const isFirstEmptySlotInClip = emptySlotsSeenInSegment === 0;
      emptySlotsSeenInSegment += 1;

      if (isFirstClip && applyConcreteOpener && plateIndex < CONCRETE_OPENER_SHOTS.length) {
        targets.push({
          segmentId: segment.id,
          plateId: plate.id,
          shotPrompt: CONCRETE_OPENER_SHOTS[plateIndex],
          continueFromPreviousPlate: plateIndex > 0,
        });
        return;
      }

      if (masterStillDataUrl) {
        const position = pickSirayPosition({
          vocal,
          isFirstClip,
          isFirstEmptySlotInClip,
          rotationIndex: sirayRotation,
        });
        // Same `locations` the xAI path uses below — either the brief's
        // own places (2+ of them typed) or `AUTO_PLATE_LOCATIONS` —
        // `SIRAY_17_POSITIONS` is camera framing only (see that module's
        // own doc comment), so without this every Siray fill shared
        // whatever backdrop happened to be in the master still itself,
        // never a genuinely different place.
        const location = pickAutoPlateLocation(locations, sirayRotation);
        sirayRotation += 1;
        targets.push({
          segmentId: segment.id,
          plateId: plate.id,
          shotPrompt: `${location} ${position.prompt}`,
          continueFromPreviousPlate: false,
          siray: { referenceImageDataUrl: masterStillDataUrl },
        });
        return;
      }

      targets.push({
        segmentId: segment.id,
        plateId: plate.id,
        shotPrompt: genericShotPrompt(vocal, bandName, rotation, locations),
        continueFromPreviousPlate: false,
      });
      rotation += 1;
    });
  });

  return targets;
}

/** Sums the confirm step's real dollar estimate across a mix of xAI-
 * and Siray-routed targets — `ESTIMATED_STILL_COST_USD` per xAI target,
 * `SIRAY_STILL_COST_USD` per Siray one, never a single flat multiply
 * once a fill can span both engines. */
export function estimateAutoPlateCostUsd(targets: AutoPlateTarget[]): number {
  return targets.reduce(
    (sum, target) => sum + (target.siray ? SIRAY_STILL_COST_USD : ESTIMATED_STILL_COST_USD),
    0
  );
}
