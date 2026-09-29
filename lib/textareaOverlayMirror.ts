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

/**
 * Every computed style that changes where a glyph lands, copied from
 * the textarea onto the overlay (2026-09-30). The first fix copied only
 * font family/size, line height and letter/word spacing, which left the
 * rest to whatever each element happened to get: weight, kerning,
 * ligatures, tab width and the wrapping rules can all differ between a
 * form control and a div, and any one of them walks the words off the
 * caret. Copying them all makes the two identical by construction.
 */
export const MIRRORED_TEXT_STYLE_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-variant",
  "font-variant-ligatures",
  "font-kerning",
  "font-feature-settings",
  "font-variation-settings",
  "font-optical-sizing",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "text-transform",
  "text-rendering",
  "tab-size",
  "white-space",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "direction",
  "unicode-bidi",
  "box-sizing",
] as const;

/**
 * Height a self-growing script box needs: its text's own height
 * (`scrollHeight` with the box collapsed, which includes padding), never
 * less than `minRows` lines, plus the border. Rounded up so the last
 * line is never clipped by a fraction of a pixel.
 */
export function autoGrowMinHeightPx(m: {
  scrollHeight: number;
  lineHeight: number;
  paddingTop: number;
  paddingBottom: number;
  borderTop: number;
  borderBottom: number;
  minRows: number;
}): number {
  const minimum = m.minRows * m.lineHeight + m.paddingTop + m.paddingBottom;
  return Math.ceil(Math.max(m.scrollHeight, minimum) + m.borderTop + m.borderBottom);
}
