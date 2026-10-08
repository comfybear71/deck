/**
 * Colour-highlight script boxes (Music video Script Sequence, Sunnybank
 * God Script) draw the text in a div *behind* a transparent textarea
 * **only while the box is not being edited**. A real iPhone Safari
 * live QA (2026-10-08, after PR #259): the overlay's caret never lined
 * up with the coloured words — wrapping, keyboard, autocorrect bar and
 * text-size-adjust all differ from Playwright WebKit. While the box is
 * focused (inline) or the full-screen editor is open, the overlay is
 * unmounted and the textarea draws its own plain white text, which is
 * the only thing that can stay under the caret. Colours come back on
 * blur / Done.
 *
 * The padding math below is still load-bearing for the idle (coloured)
 * view. Two things made the textarea's text box narrower than the div's:
 *  1. iOS Safari/WebKit indents textarea text by 3px on each side, and
 *     that inset can't be styled away.
 *  2. When the textarea scrolls, desktop browsers give it a scrollbar
 *     that eats text width; the overflow-hidden div has none.
 *
 * `overlayPadding` works out the padding the div needs so its text box
 * is exactly as wide as the textarea's.
 */

/**
 * Spread onto every script-box `<textarea>` (inline + full-screen,
 * every genre). A God Script is tags + spoken lines, not a sentence to
 * auto-correct — iOS Safari's autocorrect bar is also what sat on top
 * of leaked colour text in the 2026-10-08 live screenshots.
 */
export const SCRIPT_BOX_IOS_TEXTAREA_PROPS = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;

/**
 * Class on every script-box textarea: `script-box` is the
 * `-webkit-text-size-adjust: 100%` lock in `app/globals.css`;
 * `text-base` is 16px so iOS will not auto-zoom on focus.
 */
export const SCRIPT_BOX_TEXTAREA_CLASS = "script-box text-base";

/** Idle (coloured overlay showing through) vs editing (textarea draws). */
export const SCRIPT_BOX_IDLE_TEXT_CLASS = "text-transparent";
export const SCRIPT_BOX_EDITING_TEXT_CLASS = "text-white";

export function scriptBoxTextClass(editing: boolean): string {
  return editing ? SCRIPT_BOX_EDITING_TEXT_CLASS : SCRIPT_BOX_IDLE_TEXT_CLASS;
}

/**
 * Where the caret and the script box were scrolled to. Restored after
 * save / re-parse / overlay remount so Done/Apply doesn't dump Stuart
 * at the bottom of a long God Script (2026-10-08 live iPhone QA).
 */
export interface ScriptBoxPlace {
  scrollTop: number;
  scrollLeft: number;
  selectionStart: number;
  selectionEnd: number;
}

export function readScriptBoxPlace(el: HTMLTextAreaElement): ScriptBoxPlace {
  return {
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
    selectionStart: el.selectionStart ?? 0,
    selectionEnd: el.selectionEnd ?? 0,
  };
}

function clampIndex(n: number, max: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > max ? max : Math.round(n);
}

/**
 * Put the caret and scroll back. If the textarea was not focused,
 * blur it again afterwards — `setSelectionRange` can steal focus on
 * iOS, which would pop the keyboard after Done.
 */
export function writeScriptBoxPlace(el: HTMLTextAreaElement, place: ScriptBoxPlace): void {
  const max = el.value.length;
  const start = clampIndex(place.selectionStart, max);
  const end = clampIndex(place.selectionEnd, max);
  const wasFocused = typeof document !== "undefined" && document.activeElement === el;
  try {
    el.setSelectionRange(start, end);
  } catch {
    // Hidden / not yet in the document.
  }
  el.scrollTop = Math.max(0, place.scrollTop);
  el.scrollLeft = Math.max(0, place.scrollLeft);
  if (!wasFocused && typeof document !== "undefined" && document.activeElement === el) {
    el.blur();
  }
}

/** Line-height based scroll so a given character index is in view. */
export function scrollTextareaToIndex(el: HTMLTextAreaElement, index: number): void {
  const place: ScriptBoxPlace = {
    scrollTop: 0,
    scrollLeft: 0,
    selectionStart: index,
    selectionEnd: index,
  };
  const max = el.value.length;
  const clamped = clampIndex(index, max);
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  const lineHeight = cs ? parseFloat(cs.lineHeight) || 24 : 24;
  const paddingTop = cs ? parseFloat(cs.paddingTop) || 0 : 0;
  const line = el.value.slice(0, clamped).split("\n").length;
  place.scrollTop = Math.max(0, paddingTop + (line - 2) * lineHeight);
  writeScriptBoxPlace(el, { ...place, selectionStart: clamped, selectionEnd: clamped });
}

function nearestScrollParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent) {
    const oy = getComputedStyle(parent).overflowY;
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && parent.scrollHeight > parent.clientHeight + 1) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Restore caret/scroll on the textarea *and* scroll the sheet so that
 * line stays on screen. Auto-grow makes a long script as tall as its
 * text, so `scrollTop` alone is 0 — the place you were is a position
 * in the parent scroller.
 */
export function revealScriptBoxPlace(el: HTMLTextAreaElement, place: ScriptBoxPlace): void {
  writeScriptBoxPlace(el, place);
  const cs = getComputedStyle(el);
  const lineHeight = parseFloat(cs.lineHeight) || 24;
  const paddingTop = parseFloat(cs.paddingTop) || 0;
  const line = el.value.slice(0, clampIndex(place.selectionStart, el.value.length)).split("\n").length - 1;
  const yInBox = paddingTop + line * lineHeight - el.scrollTop;
  const caretY = el.getBoundingClientRect().top + yInBox;
  const scroller = nearestScrollParent(el);
  if (!scroller) return;
  const srect = scroller.getBoundingClientRect();
  const margin = 72;
  if (caretY < srect.top + margin || caretY > srect.bottom - margin) {
    scroller.scrollTop += caretY - (srect.top + srect.height * 0.35);
  }
}

/**
 * Split highlight segments on newlines without dropping the newline
 * (so concatenating every piece still equals the original). Used to
 * wrap scene / Part heading lines with a divider in the idle overlay.
 */
export function groupHighlightSegmentsByLine<T extends { text: string }>(
  segments: readonly T[]
): Array<{ segments: T[]; text: string }> {
  const lines: Array<{ segments: T[]; text: string }> = [];
  let currentSegs: T[] = [];
  let currentText = "";
  const flush = () => {
    if (currentSegs.length === 0 && currentText === "") return;
    lines.push({ segments: currentSegs, text: currentText });
    currentSegs = [];
    currentText = "";
  };
  for (const segment of segments) {
    let buf = "";
    for (const ch of segment.text) {
      buf += ch;
      if (ch === "\n") {
        currentSegs.push({ ...segment, text: buf });
        currentText += buf;
        flush();
        buf = "";
      }
    }
    if (buf) {
      currentSegs.push({ ...segment, text: buf });
      currentText += buf;
    }
  }
  flush();
  return lines;
}

/** Idle overlay: full-width rule above a scene / Part heading, bold. */
export const SCRIPT_SCENE_HEADING_CLASS =
  "box-border mt-1.5 block w-full border-t border-white/40 pt-2 font-semibold text-white";

/** Idle-only `#13` badge on the left of a shot's Action / speaker line. */
export const SCRIPT_SHOT_BADGE_CLASS =
  "absolute z-20 min-h-[18px] rounded-sm bg-zinc-950/90 px-1 text-left text-[9px] font-bold leading-[18px] text-amber-200";

/** Extra left padding so `#13` sits in a gutter, not on the first letters.
 * Same idle and editing so the caret doesn't jump when the overlay remounts. */
export const SCRIPT_BOX_GUTTER_CLASS = "pl-9 pr-3";

export function scriptLineCharIndex(text: string, lineIndex: number): number {
  const lines = text.split("\n");
  const last = Math.max(0, Math.min(Math.max(0, lineIndex), lines.length));
  let index = 0;
  for (let i = 0; i < last; i += 1) index += (lines[i]?.length ?? 0) + 1;
  return index;
}

/** Top of a 0-based source line inside a script box (`leading-6` + padding). */
export function scriptLineTopPx(lineIndex: number, lineHeightPx: number, paddingTopPx: number): number {
  return Math.max(0, paddingTopPx) + Math.max(0, lineIndex) * Math.max(1, lineHeightPx);
}

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
