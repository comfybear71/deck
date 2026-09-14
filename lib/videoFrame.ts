/**
 * Client-only: pulls the last visible frame out of a rendered clip's
 * video (an `<video>` + `<canvas>` capture, no server involved) — the
 * real mechanism behind Stuart's "last frame of one clip becomes the
 * first frame of the next" ask (2026-09-14): once a Grok/H3/LTX render
 * finishes, this grabs its closing frame so the *next* clip down the
 * timeline can start visually where this one left off, instead of every
 * clip beginning from a plate Stuart has to generate/pick fresh.
 *
 * **Fetch the whole file first, then hand the `<video>` a same-origin
 * `blob:` URL — never point it at the remote Blob URL directly.** The
 * first version of this did set `video.crossOrigin = "anonymous"` and
 * pointed `video.src` straight at the remote render URL, reasoning that
 * Vercel Blob serves plain `fetch()` reads with `Access-Control-Allow-
 * Origin: *` (true — `lib/clipRenders.ts`'s `buildRendersZip` already
 * relies on exactly that fact). But a `<video>` element doesn't do one
 * plain GET the way `fetch()` does — it seeks via HTTP Range requests,
 * and Safari in particular is strict about a cross-origin video's Range/
 * CORS handling being exactly right before it'll seek reliably at all.
 * Real-world report (2026-09-14, Stuart's iPhone): the feature silently
 * did nothing, more than once — consistent with exactly this class of
 * failure. Fetching the full file with a plain `fetch()` (proven to
 * work here already) and handing the video a `blob:` object URL sidesteps
 * the whole Range/cross-origin question — a `blob:` URL is always
 * same-origin, so there is nothing left for Safari's stricter cross-
 * origin video handling to trip over.
 *
 * **iOS Safari note** (Stuart's actual device): a `<video>` element that
 * is *never* attached to the document can fail to decode/seek reliably
 * on iOS Safari specifically, even though it loads fine detached on
 * desktop browsers — this briefly appends the element (visually
 * hidden, zero-size, `pointer-events: none`) to `document.body` for the
 * duration of the capture and always removes it again in a `finally`,
 * rather than risk a silent failure on the one device that matters here.
 */

/** How far back from the very end to seek before capturing — seeking to
 * a video's exact reported `duration` can land one tick past the last
 * decodable frame on some browsers (a black/blank capture) rather than
 * erroring outright, so this backs off by a small, fixed amount instead
 * of trusting `duration` to be a safely seekable timestamp. Small enough
 * to still read as "the very end" even on this feature's shortest
 * (`MIN_CLIP_DURATION_SEC`/`MIN_LTX_CLIP_DURATION_SEC`, both 5s) clips. */
const END_SEEK_BACKOFF_SEC = 0.15;

/** Real network/decode failures shouldn't hang the caller forever —
 * generous enough for a large clip on a slow connection, short enough
 * that a genuinely stuck load doesn't block the next clip's plate strip
 * from being usable in the meantime. */
const LOAD_TIMEOUT_MS = 20_000;

function waitForEvent(target: HTMLVideoElement, event: string, timeoutMs: number, timeoutMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The video could not be decoded for frame capture."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

/**
 * Extracts the closing frame of `videoUrl` as a `data:image/jpeg` URL.
 * Never throws — rejects with a plain-language `Error` on any real
 * failure (network, decode) so a caller that treats this as a
 * best-effort convenience can report the real reason rather than guess.
 */
export async function extractLastVideoFrame(videoUrl: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(videoUrl);
  } catch (err) {
    throw new Error(`Could not download the rendered clip: ${err instanceof Error ? err.message : "network error"}.`);
  }
  if (!res.ok) {
    throw new Error(`Could not download the rendered clip (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  video.src = objectUrl;

  document.body.appendChild(video);
  try {
    await waitForEvent(video, "loadedmetadata", LOAD_TIMEOUT_MS, "The video's metadata did not load in time.");

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("The video reported no usable duration.");
    }
    video.currentTime = Math.max(0, duration - END_SEEK_BACKOFF_SEC);
    await waitForEvent(video, "seeked", LOAD_TIMEOUT_MS, "Seeking to the video's last frame timed out.");

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error("The video reported no usable frame size.");
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2D canvas context.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Always same-origin now (a `blob:` URL), so this should never throw
    // a cross-origin SecurityError the way the remote-URL version could
    // — kept defensive anyway rather than assuming.
    try {
      return canvas.toDataURL("image/jpeg", 0.92);
    } catch {
      throw new Error("Could not read the captured frame.");
    }
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    document.body.removeChild(video);
    URL.revokeObjectURL(objectUrl);
  }
}
