import type { Metadata } from "next";
import { StageLabMock } from "@/components/StageLabMock";

export const metadata: Metadata = {
  title: "Stage lab — Deck (sandbox)",
  description: "Standalone director-board sandbox. Not connected to Sunny Banks, Skidmarks, Music video, or Shorts episodes.",
  robots: { index: false, follow: false },
};

/**
 * Development/test page only. Not linked from the graph or any genre
 * screen. Mock UI — no session writes, no paid renders.
 */
export default function StageLabPage() {
  return <StageLabMock />;
}
