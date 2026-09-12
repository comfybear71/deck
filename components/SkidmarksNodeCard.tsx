"use client";

import type { SkidmarksState } from "@/lib/skidmarks";
import { skidmarksGlance } from "@/lib/skidmarks";

interface SkidmarksNodeCardProps {
  /** Current studio state, if the Music-video flow has ever been touched on this browser. */
  state: SkidmarksState;
  onOpen: () => void;
}

/**
 * Skidmarks' node face — a "vibe director" glance, not a dump of what's
 * running behind it. Shows the node name, a warm rose/pink identity
 * treatment (tied to the ♥ Make lane), and a terse one-line status via
 * `skidmarksGlance` (idle / choosing a band / directing a named band /
 * ready once the MP3 checklist clears). Tapping opens
 * `SkidmarksDetailSheet` for the actual locked Music-video flow.
 */
export function SkidmarksNodeCard({ state, onOpen }: SkidmarksNodeCardProps) {
  const glance = skidmarksGlance(state);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Skidmarks — vibe director. ${glance.label}. Open details.`}
      className="group relative flex w-full min-h-16 items-center gap-3 rounded-2xl border border-rose-400/25 bg-gradient-to-br from-rose-500/[0.14] via-pink-500/[0.05] to-transparent px-4 py-4 text-left shadow-[0_0_40px_-14px_rgba(251,113,133,0.55)] transition-colors active:scale-[0.99] hover:from-rose-500/[0.18] hover:via-pink-500/[0.08]"
    >
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-400/15 text-lg font-semibold text-rose-300"
      >
        {"\u2665"}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-white">
          Skidmarks
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
          Project
          <span aria-hidden>{"\u00b7"}</span>
          <span className="text-rose-300">Vibe director</span>
        </span>

        {glance.status === "idle" ? (
          <span className="mt-1.5 block text-xs text-white/40">
            No project yet — tap to start directing.
          </span>
        ) : (
          <span
            className={[
              "mt-1.5 inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              glance.status === "ready"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-rose-400/30 bg-rose-400/10 text-rose-200",
            ].join(" ")}
          >
            {glance.label}
          </span>
        )}
      </span>

      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="h-4 w-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5"
      >
        <path
          d="M7.5 4l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
