import { NextResponse } from "next/server";
import { fetchLiveBudjuData } from "@/lib/budju-live";

/**
 * GET /api/budju/live — live pull from budju.xyz's own public API: the
 * same portfolio + prices + auto-trader endpoints Budju's own `/trade`
 * page calls unauthenticated (see `lib/budju-live.ts`). Returns a full
 * `BudjuData` payload with `updatedAt` set to now on success.
 *
 * Always dynamic — this is a live proxy call, never something Next should
 * cache. On failure (budju.xyz unreachable, unexpected response shape)
 * returns a 502; the caller (`GraphView`) falls back to the seed snapshot
 * in `data/budju.json` rather than showing an error where a glance used
 * to be.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await fetchLiveBudjuData();
  if (!data) {
    return NextResponse.json(
      { error: "Could not reach budju.xyz's public API." },
      { status: 502 }
    );
  }
  return NextResponse.json(data);
}
