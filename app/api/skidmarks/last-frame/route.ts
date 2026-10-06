import { put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isAllowedSunnyBanksClipUrl } from "@/lib/sunnyBanksClipProxy";
import { extractLastVideoFrameServer } from "@/lib/serverVideoFrame";

/**
 * POST /api/skidmarks/last-frame — the server half of the **free**
 * "Chain from shot N" preview in every God Script genre
 * (`SkidmarksSunnyBanksPanel`) and the Music video Script Sequence
 * equivalent. Given a finished clip's own `videoUrl`, re-derives that
 * clip's closing frame via the same server-side ffmpeg extraction every
 * fresh render already runs (`lib/serverVideoFrame.ts`) and saves it to
 * Vercel Blob, so a row rendered before that extraction existed (or a
 * Sunny Banks seed clip hosted outside this app entirely) can still
 * chain from it.
 *
 * **No paid API call of any kind** — this never touches xAI, Comfy
 * Cloud, MiniMax, ElevenLabs, or Siray. The only costs are one outbound
 * fetch of a clip this app (or an already-allowlisted sibling host)
 * already made, a local ffmpeg run, and one small JPEG write to Blob.
 *
 * **The allowlist is the security boundary, same as the Sunny Banks
 * clip proxy this reuses it from** (`lib/sunnyBanksClipProxy.ts`) — a
 * route that fetches whatever a request body names is an open proxy
 * into anything this deployment can reach. `isAllowedSunnyBanksClipUrl`
 * covers exactly the two real hosts a clip's own `videoUrl` can be
 * (this project's Vercel Blob store, or the Crash Lab EP02 seed host),
 * checked **before** any fetch happens.
 *
 * **Idempotent, content-addressed pathname** — `skidmarks/chain-last-
 * frame/<sha256(videoUrl)>.jpg`. A second row chaining off the same
 * clip (or the same row's toggle flipped off and back on) reuses the
 * exact same Blob object instead of writing a new orphan each time.
 * Deliberately not the same deterministic `(segmentId, plateId, …)`
 * pathname `lib/clipRenderBlob.ts` uses for a *fresh* render's own last
 * frame — this route has no clip-timeline identity to key off, only
 * the raw clip URL any genre's panel already has in hand.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/** One quick verify, not the 8-retry dance `generate-clip` runs for a
 * render Stuart already paid for — this is a free preview aid, and a
 * genuinely still-propagating URL just means the panel's next attempt
 * (re-toggling Chain) tries again. */
const VERIFY_TIMEOUT_MS = 10_000;
const CHAIN_LAST_FRAME_PREFIX = "skidmarks/chain-last-frame/";

function chainLastFramePathnameFor(videoUrl: string): string {
  const hash = createHash("sha256").update(videoUrl).digest("hex").slice(0, 40);
  return `${CHAIN_LAST_FRAME_PREFIX}${hash}.jpg`;
}

export async function POST(request: Request) {
  let body: { videoUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
  if (!videoUrl) {
    return NextResponse.json({ ok: false, message: "Missing `videoUrl`." }, { status: 400 });
  }
  if (!isAllowedSunnyBanksClipUrl(videoUrl)) {
    // Deliberately does not echo the URL back — same discipline as the
    // clip proxy this allowlist check is shared with.
    return NextResponse.json(
      { ok: false, message: "That URL is not a clip host this server will fetch." },
      { status: 400 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(videoUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
      headers: { Accept: "video/*;q=0.9,*/*;q=0.1" },
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      {
        ok: false,
        message: timedOut
          ? "The clip host did not respond in time."
          : `Could not reach the clip host: ${err instanceof Error ? err.message : "network error"}.`,
      },
      { status: 502 }
    );
  }
  if (!upstream.ok) {
    return NextResponse.json({ ok: false, message: `The clip host returned HTTP ${upstream.status}.` }, { status: 502 });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await upstream.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: `Couldn't read the clip's bytes: ${err instanceof Error ? err.message : "unknown error"}.` },
      { status: 502 }
    );
  }
  if (bytes.length === 0) {
    return NextResponse.json({ ok: false, message: "The clip host returned an empty file." }, { status: 502 });
  }

  const frame = await extractLastVideoFrameServer(bytes);
  if (!frame.ok) {
    return NextResponse.json({ ok: false, message: frame.message }, { status: 502 });
  }

  try {
    const blob = await put(chainLastFramePathnameFor(videoUrl), Buffer.from(frame.bytes), {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    let verified = false;
    try {
      const verify = await fetch(blob.url, { method: "HEAD", signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
      verified = verify.ok;
    } catch {
      // Best-effort — still hand back the URL below; `put()` itself
      // already succeeded.
    }
    if (!verified) {
      // One short re-check for the common "just-written, not yet
      // propagated" case before giving up on verification entirely.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const verify = await fetch(blob.url, { method: "HEAD", signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
        verified = verify.ok;
      } catch {
        // Fall through — still return the URL; the row's own retry
        // (re-toggling Chain) covers a URL that truly never propagates.
      }
    }
    return NextResponse.json({ ok: true, url: blob.url });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        message: err instanceof Error ? `Couldn't save the extracted frame: ${err.message}` : "Couldn't save the extracted frame.",
      },
      { status: 502 }
    );
  }
}
