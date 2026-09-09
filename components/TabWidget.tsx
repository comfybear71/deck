"use client";

import type { Meter } from "@/lib/types";
import type { LastSync } from "@/lib/overrides";
import { useTabView } from "@/hooks/useTabView";
import { TabChip } from "./TabChip";
import { TabCard } from "./TabCard";

interface TabWidgetProps {
  meters: Meter[];
  lastMailSync: LastSync;
}

/**
 * Switches between the collapsed chip (default) and the full expanded
 * TabCard, persisting the choice via useTabView.
 */
export function TabWidget({ meters, lastMailSync }: TabWidgetProps) {
  const { mode, expand, collapse } = useTabView();

  if (mode === "expanded") {
    return (
      <TabCard
        meters={meters}
        lastMailSync={lastMailSync}
        onCollapse={collapse}
      />
    );
  }

  return <TabChip meters={meters} onExpand={expand} />;
}
