import { NextResponse } from "next/server";
import { deckMediaStem, parseDeckMediaTarget, type DeckMediaExtension, type DeckMediaTarget } from "@/lib/deckMediaPaths";
import { putDeckMediaOrLegacy } from "@/lib/deckMediaPut";
import { decodeDataUrl } from "@/lib/dataUrl";
import { extractLastVideoFrameServer } from "@/lib/serverVideoFrame";
import {
  clampSirayI2vDurationSec,
  resolveSirayCredentials,
  sirayDownloadVideo,
  sirayPollVideoAsync,
  siraySubmitVideoAsync,
} from "@/lib/sirayClient";
import { padFrameTo16x9 } from "@/lib/videoFrame16x9";
import { ADULT_SHORTS_MAX_SHOT_SEC } from "@/lib/adultShorts";

/**
 * POST /api/skidmarks/adult-shorts/render-clip — Adult shorts' one clip
 * render. Siray Wan 3.0 i2v spicy from one start image (the shot's plate
 * or the previous clip's last frame). Deliberately its own small route
 * rather than another branch of `generate-clip` (which is built around a
 * song's segments/plates): submit, poll, download, save MP4 + last frame
 * to Blob.
 *
 * **Two short calls, never one long one (2026-09-28 live fix).** The
 * first version held one request open for up to ~4.5 min while Siray
 * rendered; on live the browser connection dropped ("Failed to fetch")
 * and the client never learned the task id of a job Siray had already
 * started. Now a call without `sirayTaskId` only submits and returns
 * `202 { pending, sirayTaskId }` straight away, so the client can save
 * the id before waiting. Each call with `sirayTaskId` polls for at most
 * `POLL_DEADLINE_MS` and returns 202 again if Siray is still going.
 *
 * The prompt arrives already carrying the adult/content locks from
 * `lib/adultShorts.ts`; this route re-checks the adult lock is present so
 * a hand-built request can't skip it.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const POLL_DEADLINE_MS = 40_000;
const MAX_PROMPT_LENGTH = 2000;
const FETCH_TIMEOUT_MS = 30_000;

interface Body {
  prompt?: unknown;
  startImageUrl?: unknown;
  durationSec?: unknown;
  sirayTaskId?: unknown;
  /** Optional `{ folder, name }` for the clip in the readable `deck/`
   * tree (`lib/deckMediaPaths.ts`); its last frame is saved next to it
   * as `<name>-last-frame.jpg`. Missing → the old flat path. */
  mediaTarget?: unknown;
}

async function resolveStartImage(url: string): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  let bytes: Uint8Array;
  let mimeType: string;
  if (url.startsWith("data:")) {
    const decoded = decodeDataUrl(url);
    if (!decoded) return { ok: false, error: "Could not decode the start image." };
    bytes = decoded.bytes;
    mimeType = decoded.mimeType;
  } else {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return { ok: false, error: `Fetching the start image returned HTTP ${res.status}.` };
      mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim() || "image/jpeg";
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      return { ok: false, error: `Could not fetch the start image: ${err instanceof Error ? err.message : "network error"}.` };
    }
  }
  const framed = await padFrameTo16x9(bytes, mimeType);
  return { ok: true, dataUrl: `data:${framed.mimeType};base64,${Buffer.from(framed.bytes).toString("base64")}` };
}

async function saveToBlob(
  bytes: Uint8Array,
  legacyPathname: string,
  contentType: string,
  target: DeckMediaTarget | null,
  ext: DeckMediaExtension,
): Promise<{ url: string; pathname: string } | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const blob = await putDeckMediaOrLegacy(Buffer.from(bytes), { target, ext, contentType, legacyPathname });
    return { url: blob.url, pathname: blob.pathname };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const creds = resolveSirayCredentials();
  if (!creds) {
    return NextResponse.json(
      {
        error: "SIRAY_API_KEY is not set on the server, so Siray clips can't render here. Set it on Vercel and redeploy.",
        code: "missing_api_key",
      },
      { status: 501 }
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body.", code: "invalid_request" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const startImageUrl = typeof body.startImageUrl === "string" ? body.startImageUrl.trim() : "";
  const requested = typeof body.durationSec === "number" ? body.durationSec : 5;
  const durationSec = Math.min(ADULT_SHORTS_MAX_SHOT_SEC, clampSirayI2vDurationSec(requested));
  const resumeTaskId = typeof body.sirayTaskId === "string" ? body.sirayTaskId.trim() : "";

  if (!prompt) return NextResponse.json({ error: "Missing `prompt`.", code: "invalid_request" }, { status: 400 });
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: "Prompt is too long.", code: "invalid_request" }, { status: 400 });
  }
  if (!/adult woman, clearly over 25/i.test(prompt)) {
    return NextResponse.json(
      { error: "Shorts prompts must carry the adult character lock.", code: "invalid_request" },
      { status: 400 }
    );
  }
  if (!resumeTaskId && !/^(https:\/\/|data:image\/)/.test(startImageUrl)) {
    return NextResponse.json(
      { error: "Make the plate first. The clip needs a start image.", code: "invalid_request" },
      { status: 400 }
    );
  }

  const taskId = resumeTaskId;
  if (!taskId) {
    const start = await resolveStartImage(startImageUrl);
    if (!start.ok) return NextResponse.json({ error: start.error, code: "start_image" }, { status: 400 });
    const submit = await siraySubmitVideoAsync({ prompt, image: start.dataUrl, durationSec }, creds);
    if (!submit.ok) return NextResponse.json({ error: submit.error, code: submit.code }, { status: submit.status });
    // Hand the id back before any waiting — see the doc comment above.
    return NextResponse.json({ pending: true, sirayTaskId: submit.taskId, code: "siray_submitted" }, { status: 202 });
  }

  const poll = await sirayPollVideoAsync(taskId, creds, POLL_DEADLINE_MS);
  if (!poll.ok && poll.code === "timeout") {
    return NextResponse.json({ pending: true, sirayTaskId: taskId, code: "siray_pending" }, { status: 202 });
  }
  if (!poll.ok) return NextResponse.json({ error: poll.error, code: poll.code }, { status: poll.status });

  const download = await sirayDownloadVideo(poll.outputUrl);
  if (!download.ok) return NextResponse.json({ error: download.error, code: download.code }, { status: download.status });

  const stem = `skidmarks/adult-shorts/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const clipTarget = parseDeckMediaTarget(body.mediaTarget);
  const savedClip = await saveToBlob(download.bytes, `${stem}.mp4`, "video/mp4", clipTarget, "mp4");
  const videoUrl = savedClip?.url ?? null;
  // The last frame sits next to the clip it came from, under the same
  // (possibly `-v2`) name, so the two always read as a pair.
  const frameTarget: DeckMediaTarget | null =
    clipTarget && savedClip?.pathname.startsWith(`${clipTarget.folder}/`)
      ? { folder: clipTarget.folder, name: `${deckMediaStem(savedClip.pathname)}-last-frame` }
      : null;
  let lastFrameUrl: string | null = null;
  const frame = await extractLastVideoFrameServer(download.bytes);
  if (frame.ok) {
    lastFrameUrl =
      (await saveToBlob(frame.bytes, `${stem}-last.jpg`, "image/jpeg", frameTarget, "jpg"))?.url ??
      `data:image/jpeg;base64,${Buffer.from(frame.bytes).toString("base64")}`;
  }

  return NextResponse.json({
    videoUrl: videoUrl ?? `data:video/mp4;base64,${Buffer.from(download.bytes).toString("base64")}`,
    persisted: Boolean(videoUrl),
    lastFrameUrl,
    durationSec,
  });
}
