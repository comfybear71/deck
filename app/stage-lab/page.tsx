import type { Metadata } from "next";
import { StageLab } from "@/components/StageLab";

export const metadata: Metadata = {
  title: "Stage lab — Deck (sandbox)",
  description: "Standalone director-board sandbox. Not connected to Sunny Banks, Skidmarks, Music video, or Shorts episodes.",
  robots: { index: false, follow: false },
};

/**
 * Development/test page only. Not linked from the graph or any genre
 * screen. Own storage. Read-only Cast/Locations. No session writes.
 */
export default function StageLabPage() {
  return <StageLab />;
}
