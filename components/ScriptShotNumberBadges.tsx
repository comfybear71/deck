"use client";

import { SCRIPT_SHOT_BADGE_CLASS, scriptLineTopPx } from "@/lib/textareaOverlayMirror";

export type ScriptShotBadgeMark = { shotNumber: number; lineIndex: number };

/**
 * Idle-only `#13` badges in the script-box left gutter. Absolutely
 * positioned so they never enter the overlay's text flow (that would
 * wrap differently from the textarea and send tap-back to the wrong
 * place). Display only — not parsing, not billing.
 */
export function ScriptShotNumberBadges({
  marks,
  paddingTopPx,
  lineHeightPx,
  onJumpToRow,
}: {
  marks: readonly ScriptShotBadgeMark[];
  paddingTopPx: number;
  lineHeightPx: number;
  onJumpToRow?: (shotNumber: number) => void;
}) {
  if (marks.length === 0) return null;
  const seenLine = new Map<number, number>();
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden={onJumpToRow ? undefined : true}>
      {marks.map((mark) => {
        const stack = seenLine.get(mark.lineIndex) ?? 0;
        seenLine.set(mark.lineIndex, stack + 1);
        const top = scriptLineTopPx(mark.lineIndex, lineHeightPx, paddingTopPx);
        return (
          <button
            key={`${mark.shotNumber}:${mark.lineIndex}`}
            type="button"
            className={`${SCRIPT_SHOT_BADGE_CLASS} pointer-events-auto`}
            style={{ top, left: 2 + stack * 22 }}
            onClick={() => onJumpToRow?.(mark.shotNumber)}
            aria-label={`Scroll to shot ${mark.shotNumber} in the list`}
          >
            #{mark.shotNumber}
          </button>
        );
      })}
    </div>
  );
}
