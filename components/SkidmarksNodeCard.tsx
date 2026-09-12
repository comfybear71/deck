"use client";

import type { SkidmarksProject } from "@/lib/skidmarks";
import { SKIDMARKS_STAGE_LABEL } from "@/lib/skidmarks";

interface SkidmarksNodeCardProps {
  /** The active project's thread, if one has ever been started on this browser. */
  project: SkidmarksProject | undefined;
  onOpen: () => void;
}

/**
 * Skidmarks' node face — a "vibe director" glance, not a dump of what's
 * running behind it. Shows: the node name, a warm rose/pink identity
 * treatment (tied to the ♥ Make lane, but distinct from the generic
 * `GraphNodeCard` hearts styling — see the README's "Skidmarks node"
 * section), and either "no project yet" or the current project's brief
 * (truncated) plus a small "Directing · &lt;stage&gt;" chip. Tapping opens
 * `SkidmarksDetailSheet` for the actual director chat.
 */
export function SkidmarksNodeCard({ project, onOpen }: SkidmarksNodeCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Skidmarks — vibe director. ${
        project
          ? `Directing: ${project.brief}. Stage ${SKIDMARKS_STAGE_LABEL[project.stage]}.`
          : "No project yet."
      } Open details.`}
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

        {project ? (
          <span className="mt-1.5 flex flex-col items-start gap-1">
            <span className="block max-w-full truncate text-xs text-white/60">
              {project.brief}
            </span>
            <span className="inline-flex w-fit items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-medium text-rose-200">
              Directing {"\u00b7"} {SKIDMARKS_STAGE_LABEL[project.stage]}
            </span>
          </span>
        ) : (
          <span className="mt-1.5 block text-xs text-white/40">
            No project yet — tap to start directing.
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
