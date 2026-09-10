"use client";

import { useEffect, useState } from "react";
import type { BudjuData, GraphData, PropfolioData } from "@/lib/types";
import { edgesFrom, findNode, orderedNodes } from "@/lib/graph";
import { BUDJU_NODE_ID, PROPFOLIO_NODE_ID } from "@/lib/constants";
import budjuDataRaw from "@/data/budju.json";
import propfolioDataRaw from "@/data/propfolio.json";
import { GraphNodeCard } from "./GraphNodeCard";
import { GraphNodeSheet } from "./GraphNodeSheet";
import { BudjuNodeCard } from "./BudjuNodeCard";
import { BudjuDetailSheet } from "./BudjuDetailSheet";
import { PropfolioNodeCard } from "./PropfolioNodeCard";
import { PropfolioDetailSheet } from "./PropfolioDetailSheet";
import { GraphBoard } from "./GraphBoard";
import { useIsLargeScreen } from "@/hooks/useIsLargeScreen";

const budjuData = budjuDataRaw as BudjuData;
const propfolioData = propfolioDataRaw as PropfolioData;

interface GraphViewProps {
  graph: GraphData;
  onBack: () => void;
  onOpenTab: () => void;
}

/**
 * v0 project graph — a mobile-first, glanceable map of French Deck's
 * sibling projects and how they relate. On a phone it's a single vertical
 * stack of big tappable cards with labeled connectors between them, which
 * needs no pan/zoom/drag gestures. At >=768px ("larger than a phone" —
 * see `useIsLargeScreen`) it switches to `GraphBoard`, a freestyle
 * ComfyUI-flavored canvas where the same nodes are draggable and their
 * positions persist — still not a real node editor: no wires to rewire,
 * no runtime. See the README's "Graph (v0 map)" section.
 */
export function GraphView({ graph, onBack, onOpenTab }: GraphViewProps) {
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const isLargeScreen = useIsLargeScreen();
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
      <div
        className={[
          "relative w-full rounded-none border-0 bg-zinc-950/80 p-5 sm:rounded-3xl sm:border sm:border-white/10 sm:p-7 sm:shadow-[0_0_60px_-15px_rgba(0,0,0,0.9)]",
          isLargeScreen ? "max-w-6xl" : "max-w-md",
        ].join(" ")}
      >
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
          {isLargeScreen
            ? "A glanceable map of how the projects connect."
            : "A glanceable map of how the projects connect. Tap a node for details."}
        </p>

        {isLargeScreen ? (
          <GraphBoard
            graph={graph}
            nodes={nodes}
            budjuData={budjuData}
            propfolioData={propfolioData}
            onOpenNode={setOpenNodeId}
          />
        ) : (
          <div className="flex flex-col">
            {nodes.map((node, i) => {
              const outgoing = edgesFrom(graph.edges, node.id);
              const isLast = i === nodes.length - 1;

              return (
                <div key={node.id} className="flex flex-col">
                  {node.id === BUDJU_NODE_ID ? (
                    <BudjuNodeCard
                      data={budjuData}
                      onOpen={() => setOpenNodeId(node.id)}
                    />
                  ) : node.id === PROPFOLIO_NODE_ID ? (
                    <PropfolioNodeCard
                      data={propfolioData}
                      onOpen={() => setOpenNodeId(node.id)}
                    />
                  ) : (
                    <GraphNodeCard node={node} onOpen={() => setOpenNodeId(node.id)} />
                  )}

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
        )}

        <p className="mt-5 text-center text-[11px] text-white/30">
          This is a map, not a runtime. Looping/agents and real
          ComfyUI-style execution come later — the suit dials still leash
          live spend.
        </p>
      </div>

      {openNode && openNode.id === BUDJU_NODE_ID && (
        <BudjuDetailSheet data={budjuData} onClose={() => setOpenNodeId(null)} />
      )}

      {openNode && openNode.id === PROPFOLIO_NODE_ID && (
        <PropfolioDetailSheet
          data={propfolioData}
          onClose={() => setOpenNodeId(null)}
        />
      )}

      {openNode &&
        openNode.id !== BUDJU_NODE_ID &&
        openNode.id !== PROPFOLIO_NODE_ID && (
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
