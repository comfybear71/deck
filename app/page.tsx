import { TabCard } from "@/components/TabCard";
import type { Meter } from "@/lib/types";
import metersData from "@/data/meters.json";

const meters = metersData as Meter[];

export default function Home() {
  return <TabCard meters={meters} />;
}
