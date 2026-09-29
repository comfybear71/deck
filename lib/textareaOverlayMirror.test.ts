import { describe, expect, it } from "vitest";
import {
  autoGrowMinHeightPx,
  IOS_TEXTAREA_INSET_PX,
  isIosWebKit,
  MIRRORED_TEXT_STYLE_PROPERTIES,
  overlayPadding,
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
