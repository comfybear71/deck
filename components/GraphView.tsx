"use client";

import { useEffect, useState } from "react";
import type { GraphData } from "@/lib/types";
import { edgesFrom, findNode, orderedNodes } from "@/lib/graph";
import { GraphNodeCard } from "./GraphNodeCard";
import { GraphNodeSheet } from "./GraphNodeSheet";

interface GraphViewProps {
  graph: GraphData;
  onBack: () => void;
  onOpenTab: () => void;
}

/**
 * v0 project graph — a mobile-first, glanceable map of French Deck's
 * sibling projects and how they relate. Deliberately not a real
 * ComfyUI-style canvas: nodes render as a single vertical stack of big
 * tappable cards with labeled connectors between them, which reads fine on
 * an iPhone and needs no pan/zoom/drag gestures. See the README's
 * "Graph (v0 map)" section.
 */
export function GraphView({ graph, onBack, onOpenTab }: GraphViewProps) {
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const nodes = orderedNodes(graph);
  const openNode = openNodeId ? findNode(graph.nodes, openNodeId) : undefined;

  useEffect(() => {
    if (openNodeId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openNodeId, onBack]);

  return (
    <div className="flex min-h-dvh w-full items-start justify-center bg-black px-0 py-0 sm:items-center sm:px-6 sm:py-10">
      <div className="relative w-full max-w-md rounded-none border-0 bg-zinc-950/80 p-5 sm:rounded-3xl sm:border sm:border-white/10 sm:p-7 sm:shadow-[0_0_60px_-15px_rgba(0,0,0,0.9)]">
        <div className="mb-1 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Tab chip"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/20 transition-colors hover:bg-white/20 hover:text-white"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M12 5l-5 5 5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
            Deck Graph · v0
          </span>
          <span className="h-9 w-9" aria-hidden />
        </div>

        <p className="mb-5 text-center text-xs text-white/40">
          A glanceable map of how the projects connect. Tap a node for
          details.
        </p>

        <div className="flex flex-col">
          {nodes.map((node, i) => {
            const outgoing = edgesFrom(graph.edges, node.id);
            const isLast = i === nodes.length - 1;

            return (
              <div key={node.id} className="flex flex-col">
                <GraphNodeCard node={node} onOpen={() => setOpenNodeId(node.id)} />

                {outgoing.length > 0 && (
                  <div className="ml-[1.375rem] flex flex-col gap-1 border-l border-dashed border-white/15 py-2 pl-4">
                    {outgoing.map((edge) => {
                      const target = findNode(graph.nodes, edge.to);
                      return (
                        <span
                          key={`${edge.from}-${edge.to}-${edge.label}`}
                          className="flex items-center gap-1.5 text-[11px] text-white/40"
                        >
                          <svg
                            aria-hidden
                            viewBox="0 0 20 20"
                            fill="none"
                            className="h-3 w-3 shrink-0 text-white/25"
                          >
                            <path
                              d="M10 4v10m0 0l-3.5-3.5M10 14l3.5-3.5"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span className="font-medium text-white/60">
                            {target?.label ?? edge.to}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{edge.label}</span>
                        </span>
                      );
                    })}
                  </div>
                )}

                {outgoing.length === 0 && !isLast && <div className="h-3" />}
              </div>
            );
          })}
        </div>

        <p className="mt-5 text-center text-[11px] text-white/30">
          This is a map, not a runtime. Looping/agents and real
          ComfyUI-style execution come later — the suit dials still leash
          live spend.
        </p>
      </div>

      {openNode && (
        <GraphNodeSheet
          node={openNode}
          graph={graph}
          onClose={() => setOpenNodeId(null)}
          onOpenTab={() => {
            setOpenNodeId(null);
            onOpenTab();
          }}
        />
      )}
    </div>
  );
}
