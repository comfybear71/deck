import { NextResponse } from "next/server";
import { checkSilentShotH3Key } from "@/lib/silentShotVideo";

/**
 * GET /api/skidmarks/h3-key-check (2026-09-30) — a free check that
 * MiniMax accepts the server's `MINIMAX_API_KEY`, before the first paid
 * H3 render. Lists at most one H3 task (MiniMax's "List tasks"); starts
 * nothing, costs nothing, writes nothing. Answers `{ status }`:
 * `ok`, `missing` (no key set), `rejected` (MiniMax refused the key) or
 * `error` (couldn't tell), plus a short `message`. Never the key.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const outcome = await checkSilentShotH3Key();
  return NextResponse.json(outcome, { headers: { "Cache-Control": "no-store" } });
}
