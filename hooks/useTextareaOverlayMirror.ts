"use client";

import { useLayoutEffect, type RefObject } from "react";
import {
  autoGrowMinHeightPx,
  innerScrollRoomPaddingBottomPx,
  isIosWebKit,
  MIRRORED_TEXT_STYLE_PROPERTIES,
  overlayPadding,
  resolveOverlayShellHeightPx,
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
 * `overlayRef` is a **clipping shell**, not the styled text box itself
 * (2026-10-08 rewrite — see the "overlay bled past its own box" bug
 * below). It expects exactly one child element (the real styled text
 * lives there) and only ever touches the shell's `scrollTop`/
 * `scrollLeft`; every font/padding mirror lands on that one child.
 *
 * Copies every style that moves text (font, size, weight, line height,
 * spacing, wrapping, tab size, kerning, ligatures, …) from the textarea
 * onto the inner child, plus padding that makes the two text boxes
 * exactly as wide (`overlayPadding`). Re-measures on every text change
 * and whenever the textarea resizes. Scroll is mirrored from the
 * textarea's own native `scroll` event (and again after every
 * measurement), and the inner child gets enough bottom room that it can
 * always scroll as far as the textarea does.
 *
 * **Why a shell at all, instead of one styled `absolute inset-0` div
 * (what this hook did before 2026-10-08):** a real reported bug —
 * "the cursor and type don't match up when trying to edit," worst near
 * the bottom of a long script, coloured text spilling down behind the
 * full-screen editor's own bottom toolbar. Root cause: CSS cannot give
 * a box a border-box height smaller than its own padding — padding is
 * part of the box, not clippable overflow content, so a box can never
 * be shorter than `padding-top + padding-bottom` regardless of what
 * `height`/`inset` say. The single-div version deliberately padded its
 * *own* bottom by a full `textarea.clientHeight` (comment above) so it
 * had room to scroll exactly as far as the real textarea — but that
 * padding alone already exceeds the box's intended height, so the
 * `absolute inset-0` box was always rendered taller than its container
 * by (its own vertical padding), bleeding colour text into whatever sat
 * below. `h-full` on that single div did **not** fix it (verified: the
 * resolved height stayed unchanged) — explicit `height` can't shrink a
 * box below its own mandatory padding either. Splitting clip-shell
 * (no padding of its own, so it can actually hold a definite height)
 * from styled-content (unclipped, ordinary "child taller than its
 * `overflow:hidden` parent" — the standard, working shape for a
 * scrollable box) sidesteps the padding floor entirely: the shell's
 * own box has nothing forcing it taller than its container, and
 * `overflow:hidden` reliably clips the tall inner child the normal way.
 *
 * The shell's height is set here in JS (`textarea.offsetHeight`), not
 * left to the `h-full`/`inset-0` CSS classes alone — measured directly:
 * on the inline (`autoGrowMinRows`) box the shell's containing block is
 * an ordinary auto-height `<div>` (it shrink-wraps the textarea's own
 * JS-driven `min-height`, not a flex/definite-height box like the
 * full-screen editor's), and a percentage `height` against an
 * auto-height ancestor resolves back to `auto` per CSS — so `h-full`
 * alone left a smaller (~6px) version of the exact same bleed on that
 * box. Setting the shell's height explicitly from the textarea's own
 * measured box is correct regardless of what kind of box the shared
 * ancestor turns out to be.
 */
export function useTextareaOverlayMirror(
  overlayRef: RefObject<HTMLDivElement | null>,
  text: string,
  options: TextareaOverlayMirrorOptions = {}
) {
  const { autoGrowMinRows } = options;
  useLayoutEffect(() => {
    const shell = overlayRef.current;
    if (!shell) return;
    const textarea = shell.nextElementSibling;
    const inner = shell.firstElementChild;
    if (!(inner instanceof HTMLElement) || !(textarea instanceof HTMLTextAreaElement)) return;

    const ios =
      typeof navigator !== "undefined" &&
      isIosWebKit(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0);

    const syncScroll = () => {
      shell.scrollTop = textarea.scrollTop;
      shell.scrollLeft = textarea.scrollLeft;
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
      // Belt-and-braces alongside the `h-full` class: whatever the
      // shell's containing block turns out to be, pin its height to the
      // textarea's own real (border-box) height so it can never be
      // taller than the box it's clipping to.
      shell.style.height = `${resolveOverlayShellHeightPx(textarea.offsetHeight)}px`;
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
      inner.style.paddingLeft = `${pad.paddingLeft}px`;
      inner.style.paddingRight = `${pad.paddingRight}px`;
      inner.style.paddingTop = `${pad.paddingTop}px`;
      // Room to scroll as far as the textarea can: without it the
      // shell's clipped content can be a line short and its scrollTop
      // gets capped, leaving the words above the caret. Safe to put on
      // the (unclipped) inner child — seeing this blow the child taller
      // than the shell is the point; the shell's own `overflow-hidden`
      // clips it the ordinary way. Putting this same padding on the
      // *shell* instead (the pre-2026-10-08 shape) is exactly the bug
      // this hook was rewritten to fix — don't move it back.
      inner.style.paddingBottom = `${innerScrollRoomPaddingBottomPx(pad.paddingBottom, textarea.clientHeight)}px`;
      for (const prop of MIRRORED_TEXT_STYLE_PROPERTIES) {
        inner.style.setProperty(prop, cs.getPropertyValue(prop));
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
