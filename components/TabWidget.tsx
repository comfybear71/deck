"use client";

import type { Meter } from "@/lib/types";
import { useTabView } from "@/hooks/useTabView";
import { TabChip } from "./TabChip";
import { TabCard } from "./TabCard";

interface TabWidgetProps {
  meters: Meter[];
}

/**
 * Switches between the collapsed chip (default) and the full expanded
 * TabCard, persisting the choice via useTabView.
 */
export function TabWidget({ meters }: TabWidgetProps) {
  const { mode, expand, collapse } = useTabView();

  if (mode === "expanded") {
    return <TabCard meters={meters} onCollapse={collapse} />;
  }

  return <TabChip meters={meters} onExpand={expand} />;
}
