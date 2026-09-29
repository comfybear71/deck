"use client";

import { useLayoutEffect, type RefObject } from "react";
import {
  autoGrowMinHeightPx,
  isIosWebKit,
  MIRRORED_TEXT_STYLE_PROPERTIES,
  overlayPadding,
} from "@/lib/textareaOverlayMirror";

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export interface TextareaOverlayMirrorOptions {
  /** Grow the textarea with its text (never shorter than this many
   * lines), so it never scrolls inside itself. The drag handle still
   * makes it taller. Leave unset for a box that fills a fixed space
   * (the full-screen editors), which scrolls as before. */
  autoGrowMinRows?: number;
}

/**
 * Keeps a highlight overlay's text box lined up with the textarea that
 * sits right after it (its next sibling), so the caret stays on the
 * coloured word it's really on.
 *
 * Copies every style that moves text (font, size, weight, line height,
 * spacing, wrapping, tab size, kerning, ligatures, …) from the textarea
 * onto the overlay, plus padding that makes the two text boxes exactly
 * as wide (`overlayPadding`). Re-measures on every text change and
 * whenever the textarea resizes. Scroll is mirrored from the
 * textarea's own native `scroll` event (and again after every
 * measurement), and the overlay gets enough bottom room that it can
 * always scroll as far as the textarea does.
 */
export function useTextareaOverlayMirror(
  overlayRef: RefObject<HTMLDivElement | null>,
  text: string,
  options: TextareaOverlayMirrorOptions = {}
) {
  const { autoGrowMinRows } = options;
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const textarea = overlay?.nextElementSibling;
    if (!overlay || !(textarea instanceof HTMLTextAreaElement)) return;

    const ios =
      typeof navigator !== "undefined" &&
      isIosWebKit(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0);

    const syncScroll = () => {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    };

    const grow = (cs: CSSStyleDeclaration) => {
      if (!autoGrowMinRows) return;
      // Measure the text's natural height without losing a height the
      // drag handle set: collapse, read, put the height back, and hold
      // the box open with min-height instead.
      const keptHeight = textarea.style.height;
      textarea.style.minHeight = "0px";
      textarea.style.height = "auto";
      const needed = autoGrowMinHeightPx({
        scrollHeight: textarea.scrollHeight,
        lineHeight: px(cs.lineHeight),
        paddingTop: px(cs.paddingTop),
        paddingBottom: px(cs.paddingBottom),
        borderTop: px(cs.borderTopWidth),
        borderBottom: px(cs.borderBottomWidth),
        minRows: autoGrowMinRows,
      });
      textarea.style.height = keptHeight;
      textarea.style.minHeight = `${needed}px`;
    };

    const sync = () => {
      const cs = getComputedStyle(textarea);
      grow(cs);
      const pad = overlayPadding(
        {
          paddingLeft: px(cs.paddingLeft),
          paddingRight: px(cs.paddingRight),
          paddingTop: px(cs.paddingTop),
          paddingBottom: px(cs.paddingBottom),
          borderLeft: px(cs.borderLeftWidth),
          borderRight: px(cs.borderRightWidth),
          offsetWidth: textarea.offsetWidth,
          clientWidth: textarea.clientWidth,
        },
        ios
      );
      overlay.style.paddingLeft = `${pad.paddingLeft}px`;
      overlay.style.paddingRight = `${pad.paddingRight}px`;
      overlay.style.paddingTop = `${pad.paddingTop}px`;
      // Room to scroll as far as the textarea can: without it the
      // overlay's own (clipped) content can be a line short and its
      // scrollTop gets capped, leaving the words above the caret.
      overlay.style.paddingBottom = `${pad.paddingBottom + textarea.clientHeight}px`;
      for (const prop of MIRRORED_TEXT_STYLE_PROPERTIES) {
        overlay.style.setProperty(prop, cs.getPropertyValue(prop));
      }
      syncScroll();
    };

    sync();
    textarea.addEventListener("scroll", syncScroll, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    ro?.observe(textarea);
    return () => {
      textarea.removeEventListener("scroll", syncScroll);
      ro?.disconnect();
    };
  }, [overlayRef, text, autoGrowMinRows]);
}
