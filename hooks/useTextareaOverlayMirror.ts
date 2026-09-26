"use client";

import { useLayoutEffect, type RefObject } from "react";
import { isIosWebKit, overlayPadding } from "@/lib/textareaOverlayMirror";

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Keeps a highlight overlay's text box lined up with the textarea that
 * sits right after it (its next sibling), so the caret stays on the
 * coloured word it's really on. Re-measures on every text change and
 * whenever the textarea resizes (drag handle, rotation, full screen).
 */
export function useTextareaOverlayMirror(overlayRef: RefObject<HTMLDivElement | null>, text: string) {
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const textarea = overlay?.nextElementSibling;
    if (!overlay || !(textarea instanceof HTMLTextAreaElement)) return;

    const ios =
      typeof navigator !== "undefined" &&
      isIosWebKit(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0);

    const sync = () => {
      const cs = getComputedStyle(textarea);
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
      overlay.style.paddingBottom = `${pad.paddingBottom}px`;
      overlay.style.letterSpacing = cs.letterSpacing;
      overlay.style.wordSpacing = cs.wordSpacing;
      overlay.style.fontFamily = cs.fontFamily;
      overlay.style.fontSize = cs.fontSize;
      overlay.style.lineHeight = cs.lineHeight;
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    };

    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(sync);
    ro.observe(textarea);
    return () => ro.disconnect();
  }, [overlayRef, text]);
}
