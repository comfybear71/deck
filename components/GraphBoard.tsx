"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BudjuData, GraphData, GraphNode, PropfolioData } from "@/lib/types";
import type { SkidmarksProject } from "@/lib/skidmarks";
import { edgesFrom, findNode } from "@/lib/graph";
import { BUDJU_NODE_ID, PROPFOLIO_NODE_ID, SKIDMARKS_NODE_ID } from "@/lib/constants";
import { useGraphBoardPositions } from "@/hooks/useGraphBoardPositions";
import { clamp } from "@/lib/graphLayout";
import { GraphBoardNode } from "./GraphBoardNode";
import { GraphNodeCard } from "./GraphNodeCard";
import { BudjuNodeCard } from "./BudjuNodeCard";
import { PropfolioNodeCard } from "./PropfolioNodeCard";
import { SkidmarksNodeCard } from "./SkidmarksNodeCard";

/** Fixed card width in px — close enough to the mobile stack's content
 * width that BudjuNodeCard/PropfolioNodeCard/GraphNodeCard don't need any
 * board-specific styling of their own, just a narrower box to sit in. */
const NODE_WIDTH = 280;

interface GraphBoardProps {
  graph: GraphData;
  nodes: GraphNode[];
  budjuData: BudjuData;
  propfolioData: PropfolioData;
  skidmarksActiveProject: SkidmarksProject | undefined;
  onOpenNode: (id: string) => void;
}

/**
 * The >=768px "larger than a phone" surface for the v0 project graph — a
 * freestyle, ComfyUI-flavored board where nodes are absolutely positioned
 * and draggable, instead of GraphView's mobile stacked list. Still
 * deliberately not a real node editor: no wires to draw/rewire, no
 * pan/zoom, no runtime — see the README's "Graph (v0 map)" section.
 *
 * Budju and Propfolio are separate entities with no edges in
 * `data/graph.json`, so they naturally render with no connection hints
 * here — that's existing graph data, not board-specific logic. Any node
 * that *does* have outgoing edges (Skidmarks, AIG!itch) gets its existing
 * edge labels rendered as a small non-interactive chip row under the card
 * — a hint, not a wire — instead of the list view's dashed connector.
 */
export function GraphBoard({
  graph,
  nodes,
  budjuData,
  propfolioData,
  skidmarksActiveProject,
  onOpenNode,
}: GraphBoardProps) {
  const { positions, moveNode, dropNode, reset } = useGraphBoardPositions();
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Safety net, not the primary layout mechanism: a saved x% (from a wider
  // window, or a future node with no hand-picked default) could otherwise
  // push a node's fixed-px-width card past the right edge of a narrower
  // canvas — e.g. rotating an iPad, or opening a layout saved on desktop.
  // Re-measured on resize so orientation changes self-correct.
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const maxXPct =
    containerWidth > 0 ? Math.max(0, 100 - (NODE_WIDTH / containerWidth) * 100) : 100;

  // "Bring to front" order — freeform boards let nodes overlap, so
  // whichever node was most recently pressed (tap or drag) should always
  // stack above the others, not get stuck behind a later-rendered sibling.
  const zCounterRef = useRef(10);
  const [zIndices, setZIndices] = useState<Record<string, number>>({});
  const bringToFront = useCallback((id: string) => {
    zCounterRef.current += 1;
    setZIndices((prev) => ({ ...prev, [id]: zCounterRef.current }));
  }, []);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-white/40">
          Drag a node to rearrange the board · tap for details.
        </p>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
        >
          Reset layout
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative h-[560px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] bg-[length:22px_22px] shadow-[inset_0_0_60px_-20px_rgba(0,0,0,0.9)] sm:h-[600px] lg:h-[660px]"
      >
        {nodes.map((node) => {
          const rawPosition = positions[node.id] ?? { x: 4, y: 4 };
          const position = { x: clamp(rawPosition.x, 0, maxXPct), y: rawPosition.y };
          const outgoing = edgesFrom(graph.edges, node.id);

          return (
            <GraphBoardNode
              key={node.id}
              position={position}
              width={NODE_WIDTH}
              zIndex={zIndices[node.id] ?? 10}
              containerRef={containerRef}
              isDragging={draggingId === node.id}
              onActivate={() => bringToFront(node.id)}
              onDragStart={() => setDraggingId(node.id)}
              onDragMove={(pos) => moveNode(node.id, pos)}
              onDragEnd={(pos) => {
                dropNode(node.id, pos);
                setDraggingId(null);
              }}
            >
              {node.id === BUDJU_NODE_ID ? (
                <BudjuNodeCard data={budjuData} onOpen={() => onOpenNode(node.id)} />
              ) : node.id === PROPFOLIO_NODE_ID ? (
                <PropfolioNodeCard
                  data={propfolioData}
                  onOpen={() => onOpenNode(node.id)}
                />
              ) : node.id === SKIDMARKS_NODE_ID ? (
                <SkidmarksNodeCard
                  project={skidmarksActiveProject}
                  onOpen={() => onOpenNode(node.id)}
                />
              ) : (
                <GraphNodeCard node={node} onOpen={() => onOpenNode(node.id)} />
              )}

              {outgoing.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-0.5" aria-hidden>
                  {outgoing.map((edge) => {
                    const target = findNode(graph.nodes, edge.to);
                    return (
                      <span
                        key={`${edge.from}-${edge.to}-${edge.label}`}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/40"
                      >
                        <span aria-hidden>→</span>
                        {target?.label ?? edge.to}
                        <span aria-hidden>·</span>
                        {edge.label}
                      </span>
                    );
                  })}
                </div>
              )}
            </GraphBoardNode>
          );
        })}
      </div>
    </div>
  );
}
