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
 * `blob:` URL — never point it at the remote Blob URL directly.** A
 * `<video>` element doesn't do one plain GET the way `fetch()` does —
 * it seeks via HTTP Range requests, and Safari in particular is strict
 * about a cross-origin video's Range/CORS handling being exactly right
 * before it'll seek reliably at all. Fetching the full file with a
 * plain `fetch()` (proven to work here already — same fact
 * `lib/clipRenders.ts`'s `buildRendersZip` relies on) and handing the
 * video a `blob:` object URL sidesteps the whole Range/cross-origin
 * question — a `blob:` URL is always same-origin.
 *
 * **Real live failures, 2026-09-14, Stuart's actual automated runs on
 * his iPhone — two separate timeouts, at two separate readiness
 * checkpoints, across two consecutive real attempts**: first "Seeking
 * to the video's last frame timed out" (the seek step), then, after
 * that step got a longer timeout + retry, "The video did not load in
 * time" (the *earlier* load step, still on the original tight budget).
 * Same underlying story both times — decoding a video his phone just
 * finished downloading for the first time is genuinely variable in how
 * long it takes on a real device, not something a single fixed
 * timeout guessed right on the first try. `waitReady` below is now the
 * one shared helper both checkpoints use: a generous timeout **and**
 * one retry (a fresh attempt, not just re-waiting on the same one) —
 * same "a transient stall deserves a retry, not an instant failure"
 * rule already applied to Blob's verify-HEAD and the ElevenLabs 429
 * case, now applied uniformly here instead of patched one checkpoint
 * at a time as each one's own failure showed up live.
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

/** Shared budget for both readiness checkpoints (initial load, then the
 * seek) — generous enough that a real device genuinely decoding a
 * freshly-downloaded video has room to finish, per the two live
 * timeouts this module's doc comment describes. Each checkpoint also
 * gets one retry on top of this (see `waitReady`), so the real
 * worst-case budget per checkpoint is roughly double this before
 * giving up for good. */
const READY_TIMEOUT_MS = 30_000;

/** Waits for `event` on `target`, retrying once (a fresh wait, not just
 * re-listening on the same attempt) if the first one times out —
 * shared by both the initial-load and the seek checkpoints below. See
 * this module's doc comment for why a stall here is worth a real retry
 * rather than an instant failure. */
async function waitReady(target: HTMLVideoElement, event: string, timeoutMessage: string, onRetry?: () => void): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) onRetry?.();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(timeoutMessage));
        }, READY_TIMEOUT_MS);
        const onEventFired = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("The video could not be decoded for frame capture."));
        };
        const cleanup = () => {
          clearTimeout(timer);
          target.removeEventListener(event, onEventFired);
          target.removeEventListener("error", onError);
        };
        target.addEventListener(event, onEventFired, { once: true });
        target.addEventListener("error", onError, { once: true });
      });
      return;
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
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
  video.preload = "auto";
  video.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  video.src = objectUrl;

  document.body.appendChild(video);
  try {
    // `loadeddata`, not just `loadedmetadata` — the latter only
    // guarantees duration/dimensions are known, not that any frame has
    // actually been decoded yet. Seeking before the first frame decodes
    // is a heavier ask than seeking an element that's already rendered
    // one — see this module's doc comment.
    await waitReady(video, "loadeddata", "The video did not load in time.");

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("The video reported no usable duration.");
    }
    const seekTargetSec = Math.max(0, duration - END_SEEK_BACKOFF_SEC);
    video.currentTime = seekTargetSec;
    await waitReady(video, "seeked", "Seeking to the video's last frame timed out.", () => {
      video.currentTime = seekTargetSec; // re-issue the seek itself on retry, not just re-wait on the first one
    });

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
