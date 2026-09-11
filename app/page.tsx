import { GraphView } from "@/components/GraphView";
import type { GraphData, Meter } from "@/lib/types";
import metersData from "@/data/meters.json";
import graphData from "@/data/graph.json";
import { getLastSync, getMergedMeters, getOverridesSnapshot } from "@/lib/overrides-server";

// Meter overrides can change between requests (an ingest POST can land at
// any time) — force this page to render fresh every time instead of
// getting statically cached, so a mail sync actually shows up.
export const dynamic = "force-dynamic";

const seedMeters = metersData as Meter[];
const graph = graphData as GraphData;

export default function Home() {
  const meters = getMergedMeters(seedMeters);
  const lastMailSync = getLastSync();
  const { receipts } = getOverridesSnapshot();
  // Resolved once, server-side, at request time — every windowed figure
  // downstream (SSR and the hydrated client alike) reads this same "now"
  // instead of each component calling `new Date()` on its own, which
  // would risk a hydration mismatch. See GraphView's `referenceDate` prop.
  const referenceDate = new Date().toISOString();

  return (
    <GraphView
      graph={graph}
      meters={meters}
      receipts={receipts}
      lastMailSync={lastMailSync}
      referenceDate={referenceDate}
    />
  );
}
