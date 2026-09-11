"use client";

import { useEffect } from "react";
import type { GraphData, GraphNode } from "@/lib/types";
import { SUIT_META } from "@/lib/constants";
import { useDialModes } from "@/hooks/useDialModes";
import { DialControl } from "./DialControl";
import { AskGrokPanel } from "./AskGrokPanel";

interface GraphNodeSheetProps {
  node: GraphNode;
  graph: GraphData;
  onClose: () => void;
}

const KIND_LABEL: Record<GraphNode["kind"], string> = {
  project: "Project",
  hub: "This app",
  placeholder: "Coming later",
};

export function GraphNodeSheet({ node, graph, onClose }: GraphNodeSheetProps) {
  const { modes, setMode } = useDialModes();
  const meta = node.suit ? SUIT_META[node.suit] : null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const feedsInto = graph.edges.filter((e) => e.from === node.id);
  const fedBy = graph.edges.filter((e) => e.to === node.id);
  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div
        className={[
          "relative z-10 max-h-[80vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl",
          "sm:max-w-md sm:rounded-3xl sm:p-6",
          "animate-[sheet-in_0.22s_ease-out]",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={`${node.label} details`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {meta && (
              <span aria-hidden className={`text-xl ${meta.color}`}>
                {meta.glyph}
              </span>
            )}
            <div>
              <h2 className="text-base font-semibold text-white">{node.label}</h2>
              <p className="text-[11px] uppercase tracking-wide text-white/40">
                {node.subtitle ?? KIND_LABEL[node.kind]}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <p className="text-sm leading-relaxed text-white/70">{node.role}</p>

        {(feedsInto.length > 0 || fedBy.length > 0) && (
          <div className="mt-4 flex flex-col gap-1.5 text-xs text-white/50">
            {fedBy.map((e) => (
              <p key={`in-${e.from}`}>
                <span className="text-white/30">{labelOf(e.from)} →</span>{" "}
                {node.label}{" "}
                <span className="text-white/30">({e.label})</span>
              </p>
            ))}
            {feedsInto.map((e) => (
              <p key={`out-${e.to}`}>
                {node.label} <span className="text-white/30">→ {labelOf(e.to)}</span>{" "}
                <span className="text-white/30">({e.label})</span>
              </p>
            ))}
          </div>
        )}

        {meta ? (
          <div className="mt-5 rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-white/70">
                {meta.label} lane dial
              </p>
              <DialControl
                value={modes[node.suit!]}
                onChange={(mode) => setMode(node.suit!, mode)}
                size="md"
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Same control-plane dial as the Tab&rsquo;s {meta.label} lane —
              pausing it here pauses it there too. This node&rsquo;s mapping
              to {meta.label} is a v0 guess, not a confirmed wire-up.
            </p>
          </div>
        ) : node.kind === "placeholder" ? (
          <p className="mt-5 text-[11px] leading-relaxed text-white/40">
            Not mapped to a lane — nothing to pause here yet.
          </p>
        ) : null}

        {node.url && (
          <a
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/20 active:bg-white/25"
          >
            Open
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
              <path
                d="M7.5 4h8.5v8.5M16 4L4 16"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        )}

        {node.askGrok && (
          <AskGrokPanel
            project={node.id}
            projectLabel={node.label}
            placeholder={`ask about ${node.label}…`}
          />
        )}
      </div>
    </div>
  );
}
