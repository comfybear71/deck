import { isAllowedSunnyBanksClipUrl } from "@/lib/sunnyBanksClipProxy";

/**
 * GET /api/skidmarks/sunnybank/clip-proxy?url=… — streams one Sunny
 * Banks clip (or its driving MP3) back to the page from this origin.
 *
 * Why: "Download Episode (.zip)" shipped 18 of 64 clips (live QA,
 * 2026-09-18). The 18 were this app's own renders on Vercel Blob; the
 * 46 that failed were the Crash Lab EP02 seed clips on
 * `skidmarks.aiglitch.app`. A browser will play a cross-origin MP4 in
 * a `<video>` but will not let page JavaScript read its bytes without
 * a CORS header, and that other host doesn't send one. Fetching
 * server-side sidesteps the rule entirely, because CORS is a browser
 * policy and never applied to a server-to-server request.
 *
 * **Every URL goes through `isAllowedSunnyBanksClipUrl` before any
 * fetch happens.** A route that fetches whatever a query parameter
 * names is an open proxy — it would let anyone use this deployment to
 * reach hosts they can't, including anything internal. The allowlist
 * and its reasoning live in `lib/sunnyBanksClipProxy.ts`, tested
 * separately from this route.
 *
 * Streams rather than buffering: an episode's MP4s are tens of MB each
 * and there is no reason to hold one in function memory to hand it
 * straight on.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

/** Only what a clip or its driving audio can legitimately be. An
 * upstream that answers with HTML (an error page, a login redirect) is
 * a failure to report, not a body to pass through as if it were video. */
const ALLOWED_CONTENT_TYPE_RE = /^(video|audio)\//i;

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  if (!target) {
    return Response.json({ error: "Missing `url`." }, { status: 400 });
  }
  if (!isAllowedSunnyBanksClipUrl(target)) {
    // Deliberately does not echo the URL back — no reflecting an
    // attacker-supplied string, and no confirming what does or doesn't
    // exist behind a host this refused to touch.
    return Response.json(
      { error: "That URL is not a Sunny Banks clip host this server will fetch." },
      { status: 400 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      // Redirects are followed only because both allowlisted hosts use
      // them for signed storage URLs. The allowlist is two hosts this
      // project owns, so trusting their redirects is the same trust as
      // allowing them at all.
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
      headers: { Accept: "video/*,audio/*;q=0.9,*/*;q=0.1" },
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return Response.json(
      {
        error: timedOut
          ? "The clip host did not respond in time."
          : `Could not reach the clip host: ${err instanceof Error ? err.message : "network error"}.`,
      },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: `The clip host returned ${upstream.status}.` },
      { status: upstream.status === 404 ? 404 : 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!ALLOWED_CONTENT_TYPE_RE.test(contentType)) {
    return Response.json(
      { error: `Expected video or audio from the clip host, got "${contentType || "nothing"}".` },
      { status: 502 }
    );
  }

  const headers = new Headers({
    "Content-Type": contentType,
    // Clip URLs are immutable (a timestamped Blob path, or a Crash Lab
    // file name), so a long cache is safe and keeps a retried download
    // off the upstream host.
    "Cache-Control": "private, max-age=3600",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers });
}
