import { clipsZipResponse, readZipRequest, zipPlainError } from "@/lib/clipsZipResponse";
import { planSunnyBanksClipsZip } from "@/lib/sunnyBanksClipsZip";

/**
 * POST /api/skidmarks/sunnybank/clips-zip — one zip of an act's Done
 * clips (2026-09-30), for the zip icon beside each act in CLIPS.
 *
 * Takes the episode, the act and its Done clips' saved URLs (a form
 * field `request`, JSON, so iPhone Safari downloads the answer itself),
 * and streams back a zip with readable names in line order
 * (`ep01-act-ii-01-shazza.mp4`). Built here, one clip at a time, so the
 * phone never loads the videos into memory (`lib/clipsZipResponse.ts`,
 * shared with the Shorts episode zip).
 *
 * Only Deck's own clip hosts are ever fetched (`isAllowedSunnyBanksClipUrl`,
 * the same allowlist as the clip proxy). Reads only; nothing is saved.
 * A clip that can't be fetched is left out and listed in `missing.txt`.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const plan = planSunnyBanksClipsZip(await readZipRequest(request));
  if (!plan.ok) return zipPlainError(plan.error, 400);
  return clipsZipResponse(plan.zipName, plan.entries);
}
