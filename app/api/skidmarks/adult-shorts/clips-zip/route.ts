import { clipsZipResponse, readZipRequest, zipPlainError } from "@/lib/clipsZipResponse";
import { planShortsClipsZip } from "@/lib/shortsClipsZip";

/**
 * POST /api/skidmarks/adult-shorts/clips-zip — one zip of a Shorts
 * episode's finished clips (2026-09-30), for the download icon on each
 * card in the Shorts EPISODES row. Same as Sunnybank's zip: a form field
 * `request` (JSON) so iPhone Safari downloads the answer itself, built
 * one clip at a time (`lib/clipsZipResponse.ts`), readable names in shot
 * order. Only Deck's own clip hosts are fetched. Reads only; nothing is
 * saved. A clip that can't be fetched is listed in `missing.txt`.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const plan = planShortsClipsZip(await readZipRequest(request));
  if (!plan.ok) return zipPlainError(plan.error, 400);
  return clipsZipResponse(plan.zipName, plan.entries);
}
