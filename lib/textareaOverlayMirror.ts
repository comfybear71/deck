/**
 * Colour-highlight script boxes (Music video Script Sequence, Sunnybank
 * God Script) draw the text in a div *behind* a transparent textarea.
 * The caret and selection belong to the textarea; the coloured words
 * belong to the div. If the two wrap lines at different widths, the
 * caret drifts a word or two away from the word it's really on.
 *
 * Two things made the textarea's text box narrower than the div's:
 *  1. iOS Safari/WebKit indents textarea text by 3px on each side, and
 *     that inset can't be styled away.
 *  2. When the textarea scrolls, desktop browsers give it a scrollbar
 *     that eats text width; the overflow-hidden div has none.
 *
 * `overlayPadding` works out the padding the div needs so its text box
 * is exactly as wide as the textarea's.
 */

/** WebKit's fixed extra inset on each side of textarea text (iOS). */
export const IOS_TEXTAREA_INSET_PX = 3;

export interface TextareaMetrics {
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  borderLeft: number;
  borderRight: number;
  /** element.offsetWidth */
  offsetWidth: number;
  /** element.clientWidth (excludes border and scrollbar) */
  clientWidth: number;
}

export interface OverlayPadding {
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

export function overlayPadding(m: TextareaMetrics, isIos: boolean): OverlayPadding {
  const scrollbar = Math.max(0, m.offsetWidth - m.clientWidth - m.borderLeft - m.borderRight);
  const inset = isIos ? IOS_TEXTAREA_INSET_PX : 0;
  return {
    paddingLeft: m.paddingLeft + m.borderLeft + inset,
    paddingRight: m.paddingRight + m.borderRight + inset + scrollbar,
    paddingTop: m.paddingTop,
    paddingBottom: m.paddingBottom,
  };
}

/** iPhone / iPod / iPad (iPadOS reports as a Mac with touch). */
export function isIosWebKit(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}
