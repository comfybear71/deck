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
 * **Real live failure (2026-09-14, Stuart's actual first automated
 * run): even off a local `blob:` URL, the seek-to-last-frame step
 * itself timed out on his iPhone** — the fetch/download and metadata
 * load both worked, but seeking to the tail of a video his device had
 * *just* finished decoding for the first time took longer than this
 * used to allow. Two changes in response: (1) waits for `loadeddata`
 * (the first frame is actually decoded) rather than only
 * `loadedmetadata` (duration/dimensions known, but nothing decoded
 * yet) before ever attempting the seek — seeking into an element with
 * zero decoded frames yet is a much heavier ask than seeking one
 * that's already rendered its first frame; (2) the seek step gets its
 * own longer timeout and **one retry** (a fresh `currentTime` seek,
 * same "a transient stall deserves a retry, not an instant failure"
 * rule already applied to Blob's post-put verify-HEAD and the
 * ElevenLabs 429 case) before giving up for real.
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

/** The initial load (metadata + first decoded frame) shouldn't hang the
 * caller forever — generous enough for a large clip on a slow
 * connection, short enough that a genuinely stuck load doesn't block
 * the next clip's plate strip from being usable in the meantime. */
const LOAD_TIMEOUT_MS = 20_000;

/** Seeking to the tail of a video the device just finished decoding for
 * the first time is a heavier, slower operation than the initial load
 * — the real 2026-09-14 live failure timed out here specifically, at
 * the old shared 20s budget. Longer on its own, plus one retry below,
 * rather than just raising the shared number and hoping. */
const SEEK_TIMEOUT_MS = 45_000;

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

/** Seeks to `targetSec` and waits for `seeked`, retrying once (a fresh
 * seek, not just re-waiting on the same one) if the first attempt times
 * out — see this module's doc comment for why a stall here is worth
 * one real retry rather than an instant failure. */
async function seekAndWait(video: HTMLVideoElement, targetSec: number): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    video.currentTime = targetSec;
    try {
      await waitForEvent(video, "seeked", SEEK_TIMEOUT_MS, "Seeking to the video's last frame timed out.");
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
    await waitForEvent(video, "loadeddata", LOAD_TIMEOUT_MS, "The video did not load in time.");

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("The video reported no usable duration.");
    }
    await seekAndWait(video, Math.max(0, duration - END_SEEK_BACKOFF_SEC));

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
