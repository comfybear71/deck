"use client";

import { type SkidmarksClipSegment } from "@/lib/skidmarks";

interface SkidmarksClipStubProps {
  segment: SkidmarksClipSegment;
  onSetShotPrompt: (shotPrompt: string) => void;
}

const SHOT_PROMPT_MAX_LENGTH = 160;

function EmptyStillIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-6 w-6">
      <path
        d="M4 14.5 8 9l2.5 3L14 8l2 3v3.5H4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="6.5" r="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * A clip's expanded body — Stuart's live-QA chrome lock, ruthlessly
 * minimal: **one** empty-still placeholder (dashed border, same visual
 * language as the other empty stubs already in Skidmarks — see
 * `SkidmarksGeneratePopup`'s `EmptySlot` and `SkidmarksMembersModule`'s
 * dashed avatar ring) and **one** shot-prompt field for this clip.
 * Nothing else: an earlier pass here (`SkidmarksPlatesAndCamera`, since
 * deleted) rendered a horizontal row of five named location-plate cards
 * (Neon Stage/Rainy Alley/Desert Highway/Warehouse/Crowd Pit) plus a
 * Model pill row (LTX/Grok/H3/Seedance) plus helper paragraphs under
 * each. Stuart's live QA after that shipped rejected all of it outright
 * — a location picker he never asked for, model chrome he doesn't want
 * to operate, and (because every plate card shared this clip's one
 * `shotPrompt` as its caption) a prompt that visually "duplicated" into
 * every box as he typed, even though it was really only ever one value.
 * This component replaces all of that: exactly one placeholder, exactly
 * one prompt field, one single `SkidmarksClipSegment.shotPrompt` value
 * — never mirrored across multiple cards because there's only one card.
 *
 * There's no real plate/still image in this build — the placeholder
 * always renders as an empty dashed stub. When a real still exists
 * later, this is the slot that would show it instead (not implemented
 * yet — no still field exists on `SkidmarksClipSegment`). No duration
 * label on the stub either: Stuart doesn't know a clip's actual
 * rendered length until it's actually generated, so a number on an
 * empty placeholder would just be invented.
 *
 * Model choice (`segment.model`) stays real and automatic in code —
 * `defaultSegmentModel` (`lib/skidmarks.ts`) still auto-assigns LTX
 * (vocal) or Grok (instrumental) per Stuart's cost lock — it's just not
 * rendered here as a badge or a pill row. The plan (not implemented) is
 * a single tiny badge once a real still exists; with only an empty stub
 * today, a badge would just be more chrome around nothing.
 */
export function SkidmarksClipStub({ segment, onSetShotPrompt }: SkidmarksClipStubProps) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-3">
      <div
        aria-hidden
        className="flex h-28 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-white/20"
      >
        <EmptyStillIcon />
      </div>

      <input
        type="text"
        value={segment.shotPrompt}
        onChange={(e) => onSetShotPrompt(e.target.value)}
        placeholder="What happens in this shot?"
        maxLength={SHOT_PROMPT_MAX_LENGTH}
        aria-label="Shot prompt"
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
      />
    </div>
  );
}
