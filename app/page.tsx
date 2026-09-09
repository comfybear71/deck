import { TabWidget } from "@/components/TabWidget";
import type { Meter } from "@/lib/types";
import metersData from "@/data/meters.json";

const meters = metersData as Meter[];

export default function Home() {
  return <TabWidget meters={meters} />;
}
