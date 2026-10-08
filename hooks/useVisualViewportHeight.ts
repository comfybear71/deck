"use client";

import { useEffect, useState } from "react";

/**
 * Tracks `window.visualViewport`'s own height — the space actually
 * visible above the iOS on-screen keyboard. `window.innerHeight` (and
 * the CSS layout viewport that `position: fixed` normally anchors to)
 * does **not** shrink when the keyboard appears; the keyboard just
 * draws on top of whatever a `fixed inset-0` box put there, covering
 * it rather than pushing it up. A full-screen script editor built on
 * `fixed inset-0` alone can therefore end up with its own bottom
 * toolbar — and the last line someone's actually typing — hidden
 * behind the keyboard.
 *
 * Returns `null` before the first measurement and whenever the API
 * isn't available (older Safari, SSR, desktop browsers without a
 * `visualViewport`) — callers should fall back to ordinary `inset-0`
 * sizing in that case, not force a height.
 *
 * Best-effort: not independently verified against a real iPhone in
 * this sandbox (no physical device here) — same honesty caveat this
 * repo already applies to every other hardware-only behaviour. Covered
 * by code review / reasoning from the documented `visualViewport`
 * behaviour, not a live keyboard test.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => setHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return height;
}
