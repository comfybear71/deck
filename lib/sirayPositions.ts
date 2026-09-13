/**
 * Stuart's own "17 positions" pack — real camera angles/framings for
 * generating angle variety off one character's locked master still,
 * pasted verbatim (2026-09-13) and only lightly generalized (his two
 * scene-specific lines — "yard + barn" from his "cartoon farmer"
 * example pack — reworded to plain "the whole scene," since a real
 * character's own setting comes from the master still and shot prompt,
 * not from this table). Everything else, including exact wording and
 * numbering, is his.
 *
 * This is the prompt bank `lib/autoPlate.ts` draws from once a band's
 * resolved vocalist has a real master still (`avatarImage`) set — see
 * that module's own doc comment for how a position gets picked for a
 * given empty plate slot. It is not itself a UI, a picker, or a call to
 * anything — pure data, same "hand-authored table, not an inferred
 * one" spirit as `lib/plateGeneration.ts`'s `SKIDMARKS_CHARACTER_LOCKS`.
 *
 * **Groups are Stuart's own, not inferred.** He explicitly grouped
 * 3/4/5/6/7/8/12 as "mouth-on for later LTX," 9–11/14–16 as "off-mouth
 * B-roll," and 1–2 as "wide masters." Positions 13 and 17 are real
 * entries in the table but deliberately ungrouped — he didn't say which
 * bucket they belong in, so `pickSirayPosition` below never auto-picks
 * them; they exist here for a future manual reference, not for
 * automatic selection.
 */

export type SirayPositionGroup = "wide" | "mouth-on" | "off-mouth" | "ungrouped";

export interface SirayPosition {
  /** 1-based, matches Stuart's own numbering in the pack. */
  index: number;
  name: string;
  /** Camera-framing instruction only — the character/scene/wardrobe
   * description lives in the master still + the identity reference it
   * provides, not repeated here. */
  prompt: string;
  group: SirayPositionGroup;
}

export const SIRAY_17_POSITIONS: SirayPosition[] = [
  { index: 1, name: "Front wide", prompt: "Front wide — full body, the whole scene in frame.", group: "wide" },
  { index: 2, name: "Front ¾", prompt: "Front ¾ — knees-up.", group: "wide" },
  { index: 3, name: "Front MCU", prompt: "Front MCU — chest-up, mouth readable.", group: "mouth-on" },
  { index: 4, name: "Front CU", prompt: "Front CU — face + mouth.", group: "mouth-on" },
  { index: 5, name: "¾ front left", prompt: "¾ front left.", group: "mouth-on" },
  { index: 6, name: "¾ front right", prompt: "¾ front right.", group: "mouth-on" },
  { index: 7, name: "Profile left", prompt: "Profile left — lips still readable.", group: "mouth-on" },
  { index: 8, name: "Profile right", prompt: "Profile right — lips still readable.", group: "mouth-on" },
  { index: 9, name: "¾ back left", prompt: "¾ back left.", group: "off-mouth" },
  { index: 10, name: "¾ back right", prompt: "¾ back right.", group: "off-mouth" },
  { index: 11, name: "Straight back", prompt: "Straight back.", group: "off-mouth" },
  { index: 12, name: "Low front", prompt: "Low front — looking up.", group: "mouth-on" },
  { index: 13, name: "Low ¾", prompt: "Low ¾.", group: "ungrouped" },
  {
    index: 14,
    name: "High front",
    prompt: "High front — looking down (hat may hide mouth).",
    group: "off-mouth",
  },
  { index: 15, name: "Overhead", prompt: "Overhead.", group: "off-mouth" },
  {
    index: 16,
    name: "Over-shoulder from behind",
    prompt: "Over-shoulder from behind, looking into the scene.",
    group: "off-mouth",
  },
  { index: 17, name: "Extreme CU mouth/jaw", prompt: "Extreme CU mouth / jaw.", group: "ungrouped" },
];

const WIDE_POSITIONS = SIRAY_17_POSITIONS.filter((p) => p.group === "wide");
const MOUTH_ON_POSITIONS = SIRAY_17_POSITIONS.filter((p) => p.group === "mouth-on");
const OFF_MOUTH_POSITIONS = SIRAY_17_POSITIONS.filter((p) => p.group === "off-mouth");

/**
 * Picks one position for an Auto-plate empty slot — pure, deterministic
 * (cycled by `rotationIndex`, not random, so this stays testable and a
 * song with many empty plates doesn't repeat the exact same angle back
 * to back), mirroring `lib/autoPlate.ts`'s existing `genericShotPrompt`
 * rotation shape.
 *
 * - `isFirstClip && isFirstEmptySlot` → a wide master (1–2) — the same
 *   "open on something establishing" instinct the scripted door/keyhole
 *   opener already encodes for its own specific brief.
 * - `vocal` → a mouth-on position (3/4/5/6/7/8/12) — these are the ones
 *   Stuart said are meant to end up on LTX.
 * - otherwise (Instrumental) → an off-mouth position (9–11/14–16).
 */
export function pickSirayPosition(opts: {
  vocal: boolean;
  isFirstClip: boolean;
  isFirstEmptySlotInClip: boolean;
  rotationIndex: number;
}): SirayPosition {
  const pool =
    opts.isFirstClip && opts.isFirstEmptySlotInClip
      ? WIDE_POSITIONS
      : opts.vocal
        ? MOUTH_ON_POSITIONS
        : OFF_MOUTH_POSITIONS;
  const i = ((opts.rotationIndex % pool.length) + pool.length) % pool.length;
  return pool[i];
}
