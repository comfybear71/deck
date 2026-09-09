"use client";

import type { GraphData, Meter } from "@/lib/types";
import type { LastSync } from "@/lib/overrides";
import graphData from "@/data/graph.json";
import { useTabView } from "@/hooks/useTabView";
import { TabChip } from "./TabChip";
import { TabCard } from "./TabCard";
import { GraphView } from "./GraphView";

const graph = graphData as GraphData;

interface TabWidgetProps {
  meters: Meter[];
  lastMailSync: LastSync;
}

/**
 * Switches between the three Tab surfaces — the collapsed chip (default),
 * the full expanded TabCard, and the v0 project graph — persisting the
 * choice via useTabView.
 */
export function TabWidget({ meters, lastMailSync }: TabWidgetProps) {
  const { mode, expand, collapse, openGraph } = useTabView();

  if (mode === "expanded") {
    return (
      <TabCard
        meters={meters}
        lastMailSync={lastMailSync}
        onCollapse={collapse}
        onOpenGraph={openGraph}
      />
    );
  }

  if (mode === "graph") {
    return <GraphView graph={graph} onBack={collapse} onOpenTab={expand} />;
  }

  return <TabChip meters={meters} onExpand={expand} onOpenGraph={openGraph} />;
}
