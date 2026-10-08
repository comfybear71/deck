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
 * The clipping shell's own height (2026-10-08 — see
 * `useTextareaOverlayMirror`'s own doc comment for the full "overlay
 * bled past its own box" writeup this is one half of the fix for).
 * Always the textarea's own real (border-box) height, full stop —
 * never derived from CSS `inset-0`/`height:100%` alone, and never
 * anything the shell's own padding could inflate (the shell is never
 * given any padding of its own precisely so this can stay simple).
 * Trivial on purpose: the one thing worth pinning down is that nothing
 * about the inner child's content or padding ever feeds into this
 * number — see `innerScrollRoomPaddingBottomPx` for where that lives
 * instead.
 */
export function resolveOverlayShellHeightPx(textareaOffsetHeightPx: number): number {
  return textareaOffsetHeightPx;
}

/**
 * The *inner*, unclipped child's own bottom padding — its ordinary
 * mirrored text padding (`basePaddingBottomPx`, from `overlayPadding`),
 * plus enough extra room that the shell above it can scroll exactly as
 * far down as the real textarea can (without this, the inner child's
 * own clipped content can be a line short and the shell's `scrollTop`
 * gets capped, leaving the words above the caret).
 *
 * This number must only ever land on the inner child, never on the
 * shell doing the clipping — `basePaddingBottomPx + textareaClientHeightPx`
 * is already, by construction, taller than the shell's own intended
 * height (the `clientHeight` term alone matches it), and a CSS box can
 * never be rendered shorter than its own padding (padding is part of
 * the box itself, not clippable overflow content). Putting this on the
 * shell forces the shell's own rendered height past its container —
 * the exact, reproduced bug this file's components were rewritten to
 * fix (colour text bleeding past a long script's visible bottom edge,
 * into/behind the full-screen editor's own toolbar).
 */
export function innerScrollRoomPaddingBottomPx(basePaddingBottomPx: number, textareaClientHeightPx: number): number {
  return basePaddingBottomPx + textareaClientHeightPx;
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
