"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BudjuData, GraphData, Meter, PropfolioData } from "@/lib/types";
import type { LastSync, IngestReceipt } from "@/lib/overrides";
import { edgesFrom, findNode, orderedNodes } from "@/lib/graph";
import { BUDJU_NODE_ID, PROPFOLIO_NODE_ID, SKIDMARKS_NODE_ID } from "@/lib/constants";
import budjuDataRaw from "@/data/budju.json";
import propfolioDataRaw from "@/data/propfolio.json";
import { useIsLargeScreen } from "@/hooks/useIsLargeScreen";
import { useDialModes } from "@/hooks/useDialModes";
import { useSpendWindow } from "@/hooks/useSpendWindow";
import { useSkidmarksStudio } from "@/hooks/useSkidmarksStudio";
import { GraphNodeCard } from "./GraphNodeCard";
import { GraphNodeSheet } from "./GraphNodeSheet";
import { BudjuNodeCard } from "./BudjuNodeCard";
import { BudjuDetailSheet } from "./BudjuDetailSheet";
import { PropfolioNodeCard } from "./PropfolioNodeCard";
import { PropfolioDetailSheet } from "./PropfolioDetailSheet";
import { SkidmarksNodeCard } from "./SkidmarksNodeCard";
import { SkidmarksDetailSheet } from "./SkidmarksDetailSheet";
import { GraphBoard } from "./GraphBoard";
import { CostHeader } from "./CostHeader";
import { CostDetailSheet } from "./CostDetailSheet";

const budjuSeedData = budjuDataRaw as BudjuData;
const propfolioData = propfolioDataRaw as PropfolioData;

interface GraphViewProps {
  graph: GraphData;
  meters: Meter[];
  receipts: IngestReceipt[];
  lastMailSync: LastSync;
  /** ISO timestamp, resolved once server-side (see app/page.tsx) so every
   * windowed figure — SSR and hydrated client alike — agrees on "now"
   * instead of each render calling `new Date()` fresh. */
  referenceDate: string;
}

/**
 * Deck's one continuous home surface: the running-cost header up top,
 * then the mobile-first stacked map of French Deck's sibling projects
 * below it (>=768px switches to the freeform `GraphBoard`). There is no
 * separate "chip" or "expanded Tab" page anymore — tapping the header
 * opens `CostDetailSheet` as an overlay on this same page, the same
 * pattern Budju/Propfolio's own detail sheets already use. See the
 * README's "Running costs (header + deep dive)" section.
 */
export function GraphView({ graph, meters, receipts, lastMailSync, referenceDate }: GraphViewProps) {
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [costSheetOpen, setCostSheetOpen] = useState(false);
  const [budjuData, setBudjuData] = useState<BudjuData>(budjuSeedData);
  const [budjuRefreshing, setBudjuRefreshing] = useState(false);
  const isLargeScreen = useIsLargeScreen();
  const { modes, setMode } = useDialModes();
  const { windowDays, setWindowDays } = useSpendWindow();
  const skidmarksState = useSkidmarksStudio();
  const now = useMemo(() => new Date(referenceDate), [referenceDate]);

  // Hub-kind nodes (just "Deck / The Tab") aren't rendered as a separate
  // tappable card anymore — the cost header above covers that function on
  // this same surface. Edges that target a hub node still resolve their
  // label via `findNode` against the *full* `graph.nodes`, so a connector
  // chip like "→ Deck / The Tab · metering" still reads correctly; it's
  // only the standalone card that's gone.
  const nodes = useMemo(
    () => orderedNodes(graph).filter((n) => n.kind !== "hub"),
    [graph]
  );
  const openNode = openNodeId ? findNode(graph.nodes, openNodeId) : undefined;

  // Mount-time "page load" pull from Budju's own public API (no wallet —
  // see the README's "Budju node" section) — swaps the seed snapshot for
  // a fresh one as soon as it resolves. Uses the `.then()` + `ignore`-flag
  // shape from React's own data-fetching-in-effects docs (rather than an
  // intermediate async helper) so the state update reads as "a callback
  // from an external Promise", not a synchronous effect-body call.
  // Failure (Budju down, network hiccup) just keeps the seed on screen —
  // it's a glance, not something worth an error state.
  useEffect(() => {
    let ignore = false;
    fetch("/api/budju/live", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<BudjuData>) : null))
      .then((data) => {
        if (!ignore && data) setBudjuData(data);
      })
      .catch(() => {
        // Network hiccup / Budju unreachable — keep the seed snapshot.
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Manual re-pull for BudjuDetailSheet's Refresh chip — a click handler,
  // not an effect, so setting state directly here is the normal pattern.
  const refreshBudju = useCallback(async (): Promise<boolean> => {
    setBudjuRefreshing(true);
    try {
      const res = await fetch("/api/budju/live", { cache: "no-store" });
      if (!res.ok) return false;
      const data = (await res.json()) as BudjuData;
      setBudjuData(data);
      return true;
    } catch {
      return false;
    } finally {
      setBudjuRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (openNodeId || !costSheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCostSheetOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openNodeId, costSheetOpen]);

  return (
    <div className="flex min-h-dvh w-full items-start justify-center bg-black px-0 py-0 sm:items-center sm:px-6 sm:py-10">
      <div
        className={[
          "relative w-full rounded-none border-0 bg-zinc-950/80 p-5 sm:rounded-3xl sm:border sm:border-white/10 sm:p-7 sm:shadow-[0_0_60px_-15px_rgba(0,0,0,0.9)]",
          isLargeScreen ? "max-w-6xl" : "max-w-md",
        ].join(" ")}
      >
        <CostHeader
          meters={meters}
          receipts={receipts}
          windowDays={windowDays}
          now={now}
          onOpen={() => setCostSheetOpen(true)}
        />

        <p className="mb-5 text-center text-[11px] uppercase tracking-[0.18em] text-white/30">
          Deck
        </p>

        {isLargeScreen ? (
          <GraphBoard
            graph={graph}
            nodes={nodes}
            budjuData={budjuData}
            propfolioData={propfolioData}
            skidmarksState={skidmarksState}
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
                  ) : node.id === SKIDMARKS_NODE_ID ? (
                    <SkidmarksNodeCard
                      state={{ bands: skidmarksState.bands, session: skidmarksState.session }}
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

      {costSheetOpen && (
        <CostDetailSheet
          meters={meters}
          receipts={receipts}
          lastMailSync={lastMailSync}
          now={now}
          windowDays={windowDays}
          onWindowChange={setWindowDays}
          modes={modes}
          onModeChange={setMode}
          onClose={() => setCostSheetOpen(false)}
        />
      )}

      {openNode && openNode.id === BUDJU_NODE_ID && (
        <BudjuDetailSheet
          data={budjuData}
          onClose={() => setOpenNodeId(null)}
          onRefresh={refreshBudju}
          refreshing={budjuRefreshing}
        />
      )}

      {openNode && openNode.id === PROPFOLIO_NODE_ID && (
        <PropfolioDetailSheet
          data={propfolioData}
          onClose={() => setOpenNodeId(null)}
        />
      )}

      {openNode && openNode.id === SKIDMARKS_NODE_ID && (
        <SkidmarksDetailSheet onClose={() => setOpenNodeId(null)} />
      )}

      {openNode &&
        openNode.id !== BUDJU_NODE_ID &&
        openNode.id !== PROPFOLIO_NODE_ID &&
        openNode.id !== SKIDMARKS_NODE_ID && (
          <GraphNodeSheet
            node={openNode}
            graph={graph}
            onClose={() => setOpenNodeId(null)}
          />
        )}
    </div>
  );
}
