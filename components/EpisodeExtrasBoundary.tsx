"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/** What the row shows instead of itself if it ever throws while drawing. */
export const EPISODE_EXTRAS_BROKEN_TEXT =
  "Extras hit a problem and was switched off so the rest of the page keeps working. " +
  "Saved extras are safe. Tap Try again, or reload the page.";

/**
 * Keeps a fault inside the Extras row from blanking the whole screen
 * (2026-10-04, Stuart: "the whole page went blank" after an upload). With
 * no boundary, React takes down everything on screen when one part of it
 * throws while drawing; this catches it, logs it to the console, and
 * shows one plain line plus Try again in the row's own place.
 */
export class EpisodeExtrasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Extras row failed to draw", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section aria-label="Extras" className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Extras</p>
        <p role="alert" className="mt-1.5 text-[11px] leading-snug text-rose-300/90">
          {EPISODE_EXTRAS_BROKEN_TEXT}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="mt-2 h-9 rounded-md border border-white/20 px-3 text-xs text-white/80 hover:bg-white/10"
        >
          Try again
        </button>
      </section>
    );
  }
}
