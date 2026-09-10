import { NextResponse } from "next/server";
import type { PropfolioData } from "@/lib/types";
import propfolioDataRaw from "@/data/propfolio.json";

const propfolioData = propfolioDataRaw as PropfolioData;

/**
 * GET /api/health/propfolio — health-status stub for the Propfolio graph
 * node. Returns the seed status from data/propfolio.json as-is; there's no
 * live HTTP probe of the real Propfolio app yet (out of scope for v0 — see
 * the README's "Propfolio node" section). A future version of this route
 * can replace the static read below with an actual fetch against
 * Propfolio's live app / API, as long as it keeps returning this same
 * `PropfolioData` shape so PropfolioNodeCard/PropfolioDetailSheet don't
 * need to change.
 */
export async function GET() {
  return NextResponse.json(propfolioData);
}
