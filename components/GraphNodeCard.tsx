"use client";

import type { GraphNode } from "@/lib/types";
import { SUIT_META } from "@/lib/constants";

interface GraphNodeCardProps {
  node: GraphNode;
  onOpen: () => void;
}

const KIND_LABEL: Record<GraphNode["kind"], string> = {
  project: "Project",
  hub: "This app",
  placeholder: "Coming later",
};

/**
 * One big tappable node in the v0 project graph. Deliberately large hit
 * target (the whole card, min ~64px tall) — this is a phone screen, not a
 * desktop node editor.
 */
export function GraphNodeCard({ node, onOpen }: GraphNodeCardProps) {
  const meta = node.suit ? SUIT_META[node.suit] : null;
  const isHub = node.kind === "hub";
  const isPlaceholder = node.kind === "placeholder";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${node.label} — ${node.subtitle ?? KIND_LABEL[node.kind]}. Open details.`}
      className={[
        "group flex w-full min-h-16 items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-colors active:scale-[0.99]",
        isHub
          ? "border-white/15 bg-gradient-to-br from-sky-500/10 via-white/[0.04] to-transparent shadow-[0_0_40px_-12px_rgba(96,165,250,0.35)] hover:bg-white/[0.07]"
          : isPlaceholder
            ? "border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.04]"
            : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-semibold",
          isHub
            ? "bg-sky-400/15 text-sky-200"
            : isPlaceholder
              ? "border border-dashed border-white/20 text-white/40"
              : meta
                ? `bg-white/10 ${meta.color}`
                : "bg-white/10 text-white/60",
        ].join(" ")}
      >
        {isPlaceholder ? "+" : meta ? meta.glyph : node.label.slice(0, 1)}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={[
            "block truncate text-base font-semibold",
            isPlaceholder ? "text-white/50" : "text-white",
          ].join(" ")}
        >
          {node.label}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
          {node.subtitle ? (
            <span>{node.subtitle}</span>
          ) : (
            <>
              {KIND_LABEL[node.kind]}
              {meta && (
                <>
                  <span aria-hidden>·</span>
                  <span className={meta.color}>{meta.label} lane</span>
                </>
              )}
            </>
          )}
        </span>
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
