/**
 * Client-side half of the **free** "pull a clip's last frame" helper
 * (`app/api/skidmarks/last-frame/route.ts` is the server half) — used
 * by the per-row **Chain from shot N** control in every God Script
 * genre (`SkidmarksSunnyBanksPanel`) and the Music video Script
 * Sequence equivalent (`SkidmarksScriptSequencePanel`).
 *
 * **Why this exists at all**: most clips already carry their own
 * `lastFrameUrl` straight off the render response (`lib/
 * serverVideoFrame.ts`'s extraction has run on every successful render
 * since well before PR #257's Chain UI existed). But a row/clip can
 * genuinely lack one — rendered before that extraction code shipped, or
 * (Sunny Banks' Crash Lab EP02 seed) never rendered through this app's
 * own route at all. Rather than refuse chaining from an otherwise
 * perfectly good finished clip, this re-derives the same last frame
 * from the clip's own already-downloaded bytes via the same server-side
 * ffmpeg extraction every fresh render already uses — **no xAI/Comfy/
 * MiniMax/ElevenLabs call, no cost**, just a local ffmpeg run plus one
 * small Blob write for the resulting JPEG.
 */

export type ExtractLastFrameOutcome = { ok: true; url: string } | { ok: false; message: string };

const EXTRACT_LAST_FRAME_ENDPOINT = "/api/skidmarks/last-frame";

/**
 * Asks the server to pull `videoUrl`'s last frame and hand back a
 * durable Blob URL for it. Never throws — a network error, a refused
 * host, or a real ffmpeg failure all come back as the same honest
 * `{ ok: false, message }` shape so the caller can show it on the row
 * rather than crash the panel.
 */
export async function fetchExtractedLastFrame(videoUrl: string): Promise<ExtractLastFrameOutcome> {
  let res: Response;
  try {
    res = await fetch(EXTRACT_LAST_FRAME_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl }),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error." };
  }
  let body: { ok?: unknown; url?: unknown; message?: unknown };
  try {
    body = await res.json();
  } catch {
    return { ok: false, message: `The server answered with HTTP ${res.status} and no readable body.` };
  }
  if (res.ok && body.ok === true && typeof body.url === "string" && /^https:\/\//i.test(body.url)) {
    return { ok: true, url: body.url };
  }
  return {
    ok: false,
    message: typeof body.message === "string" && body.message.length > 0 ? body.message : `HTTP ${res.status}.`,
  };
}
