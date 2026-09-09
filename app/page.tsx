import { TabWidget } from "@/components/TabWidget";
import type { Meter } from "@/lib/types";
import metersData from "@/data/meters.json";
import { getLastSync, getMergedMeters } from "@/lib/overrides-server";

// Meter overrides can change between requests (an ingest POST can land at
// any time) — force this page to render fresh every time instead of
// getting statically cached, so a mail sync actually shows up.
export const dynamic = "force-dynamic";

const seedMeters = metersData as Meter[];

export default function Home() {
  const meters = getMergedMeters(seedMeters);
  const lastMailSync = getLastSync();

  return <TabWidget meters={meters} lastMailSync={lastMailSync} />;
}
