import { describe, expect, it } from "vitest";
import {
  autoGrowMinHeightPx,
  groupHighlightSegmentsByLine,
  innerScrollRoomPaddingBottomPx,
  IOS_TEXTAREA_INSET_PX,
  isIosWebKit,
  MIRRORED_TEXT_STYLE_PROPERTIES,
  overlayPadding,
  resolveOverlayShellHeightPx,
  SCRIPT_BOX_EDITING_TEXT_CLASS,
  SCRIPT_BOX_GUTTER_CLASS,
  SCRIPT_BOX_IDLE_TEXT_CLASS,
  SCRIPT_BOX_IOS_TEXTAREA_PROPS,
  SCRIPT_BOX_TEXTAREA_CLASS,
  SCRIPT_SCENE_HEADING_CLASS,
  scriptBoxTextClass,
  scriptLineCharIndex,
  scriptLineTopPx,
} from "./textareaOverlayMirror";

const base = {
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 10,
  paddingBottom: 10,
  borderLeft: 0,
  borderRight: 0,
  offsetWidth: 340,
  clientWidth: 340,
};

describe("overlayPadding", () => {
  it("copies the textarea padding when nothing narrows it", () => {
    expect(overlayPadding(base, false)).toEqual({ paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10 });
  });

  it("adds the iOS 3px text inset on both sides", () => {
    const p = overlayPadding(base, true);
    expect(p.paddingLeft).toBe(12 + IOS_TEXTAREA_INSET_PX);
    expect(p.paddingRight).toBe(12 + IOS_TEXTAREA_INSET_PX);
  });

  it("adds a desktop scrollbar's width on the right", () => {
    const p = overlayPadding({ ...base, clientWidth: 325 }, false);
    expect(p.paddingRight).toBe(12 + 15);
    expect(p.paddingLeft).toBe(12);
  });

  it("does not count borders as scrollbar", () => {
    const p = overlayPadding({ ...base, borderLeft: 1, borderRight: 1, clientWidth: 338 }, false);
    expect(p).toMatchObject({ paddingLeft: 13, paddingRight: 13 });
  });
});

describe("isIosWebKit", () => {
  it("spots iPhone and iPadOS", () => {
    expect(isIosWebKit("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5)).toBe(true);
    expect(isIosWebKit("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
  });
  it("ignores desktop Mac and Windows", () => {
    expect(isIosWebKit("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isIosWebKit("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 0)).toBe(false);
  });
});

describe("autoGrowMinHeightPx", () => {
  const box = { lineHeight: 24, paddingTop: 8, paddingBottom: 8, borderTop: 0, borderBottom: 0, minRows: 12 };

  it("never goes below the minimum number of lines", () => {
    expect(autoGrowMinHeightPx({ ...box, scrollHeight: 40 })).toBe(12 * 24 + 16);
  });

  it("grows with the text so the box never scrolls inside itself", () => {
    expect(autoGrowMinHeightPx({ ...box, scrollHeight: 1000.4 })).toBe(1001);
  });

  it("adds the border", () => {
    expect(autoGrowMinHeightPx({ ...box, borderTop: 1, borderBottom: 1, scrollHeight: 500 })).toBe(502);
  });
});

describe("MIRRORED_TEXT_STYLE_PROPERTIES", () => {
  it("covers every style that moves a glyph, not just font and size", () => {
    for (const prop of ["font-weight", "font-kerning", "font-variant-ligatures", "tab-size", "white-space", "overflow-wrap", "word-break"]) {
      expect(MIRRORED_TEXT_STYLE_PROPERTIES).toContain(prop);
    }
  });
});

// Regression coverage for the 2026-10-08 "cursor and type don't match
// up" bug (Shorts' Deliciae God Script, reported on iPhone Safari,
// worst near the bottom of a long script): a real `getBoundingClientRect`
// measurement on a live page showed the single-div overlay always
// rendering exactly `2 * verticalPadding` taller than the textarea it
// was meant to clip to (e.g. 562px vs. a 546px textarea, with 8px of
// ordinary top/bottom padding each) — a CSS box can never be rendered
// shorter than its own padding, and the overlay's own giant
// "scroll room" bottom padding (`paddingBottom + textarea.clientHeight`)
// already exceeds the box's intended height on its own. These two
// functions are the fix: `resolveOverlayShellHeightPx` is the number
// applied to the *clipping* shell (never touched by padding),
// `innerScrollRoomPaddingBottomPx` is the number applied to the
// *unclipped* inner child instead (where overflowing past the shell's
// height is the whole point — `overflow-hidden` on the shell clips it
// normally). This sandbox has no jsdom/real layout engine to assert the
// resulting pixel geometry end-to-end — covered instead by this exact
// scenario in real iPhone-Safari-emulated Playwright QA, see the PR.
describe("resolveOverlayShellHeightPx", () => {
  it("is always exactly the textarea's own height, independent of any padding", () => {
    expect(resolveOverlayShellHeightPx(546)).toBe(546);
    expect(resolveOverlayShellHeightPx(1432)).toBe(1432);
  });
});

describe("innerScrollRoomPaddingBottomPx", () => {
  it("adds the textarea's own visible height on top of the ordinary bottom padding", () => {
    expect(innerScrollRoomPaddingBottomPx(8, 546)).toBe(554);
  });

  it("the result would already force a box taller than the textarea's own height if it ever landed on the shell instead of the inner child — exactly why it never does", () => {
    const basePaddingBottom = 8;
    const basePaddingTop = 8;
    const textareaHeight = 546;
    const scrollRoomBottom = innerScrollRoomPaddingBottomPx(basePaddingBottom, textareaHeight);
    // A box's own padding alone sets a hard floor on its rendered
    // height — if this padding sum ever landed on the shell (the box
    // that's supposed to clip to `textareaHeight`), the shell would be
    // forced taller than its container by exactly `2 * basePadding`,
    // matching the real 16px (2 * 8px) overflow measured live.
    const wouldBeShellHeightIfMisapplied = basePaddingTop + scrollRoomBottom;
    expect(wouldBeShellHeightIfMisapplied).toBeGreaterThan(textareaHeight);
    expect(wouldBeShellHeightIfMisapplied - textareaHeight).toBe(basePaddingTop + basePaddingBottom);
  });
});

describe("scriptBoxTextClass", () => {
  it("shows the textarea's own white text while editing, and goes transparent so the colour overlay can show when idle", () => {
    expect(scriptBoxTextClass(true)).toBe(SCRIPT_BOX_EDITING_TEXT_CLASS);
    expect(scriptBoxTextClass(false)).toBe(SCRIPT_BOX_IDLE_TEXT_CLASS);
    expect(SCRIPT_BOX_EDITING_TEXT_CLASS).toBe("text-white");
    expect(SCRIPT_BOX_IDLE_TEXT_CLASS).toBe("text-transparent");
  });
});

describe("SCRIPT_BOX_IOS_TEXTAREA_PROPS", () => {
  it("turns off autocorrect, autocapitalize and spellcheck — a script is tags, not a sentence", () => {
    expect(SCRIPT_BOX_IOS_TEXTAREA_PROPS).toEqual({
      autoCorrect: "off",
      autoCapitalize: "off",
      spellCheck: false,
    });
  });

  it("locks the typing surface at 16px via text-base + the script-box class", () => {
    expect(SCRIPT_BOX_TEXTAREA_CLASS).toContain("text-base");
    expect(SCRIPT_BOX_TEXTAREA_CLASS).toContain("script-box");
  });
});

describe("idle overlay scene headings and shot-badge gutter", () => {
  it("keeps a left gutter so #N badges don't sit on the first letters", () => {
    expect(SCRIPT_BOX_GUTTER_CLASS).toContain("pl-9");
    expect(SCRIPT_SCENE_HEADING_CLASS).toContain("border-t");
  });

  it("maps a 0-based line to a character index and a pixel top", () => {
    expect(scriptLineCharIndex("a\nbb\nccc", 0)).toBe(0);
    expect(scriptLineCharIndex("a\nbb\nccc", 1)).toBe(2);
    expect(scriptLineCharIndex("a\nbb\nccc", 2)).toBe(5);
    expect(scriptLineTopPx(0, 24, 8)).toBe(8);
    expect(scriptLineTopPx(2, 24, 8)).toBe(56);
  });

  it("splits highlight segments on newlines without dropping the newline", () => {
    const lines = groupHighlightSegmentsByLine([
      { text: "=== ACT I ===\n", kind: "scene" },
      { text: "Shazza: hi", kind: "plain" },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["=== ACT I ===\n", "Shazza: hi"]);
    expect(lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(lines.map((l) => l.text));
  });
});
