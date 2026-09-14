/**
 * Server-only: pulls the last visible frame out of a rendered clip's raw
 * video bytes via a real ffmpeg subprocess — the direct replacement for
 * `lib/videoFrame.ts`'s client-side `<video>`+`<canvas>` capture,
 * removed 2026-09-14 after three separate live failures on Stuart's
 * iPhone (PRs #87/#90/#91, each a different Safari `<video>`
 * load/seek-timeout variant).
 *
 * **Why this is the right fix, not another client-side patch** (Stuart,
 * relaying Grok's diagnosis, 2026-09-14): every real clip render already
 * happens in the cloud (Grok Imagine / MiniMax H3 / Comfy Cloud LTX) —
 * the phone only ever downloads the finished MP4. Frame carry has no
 * reason to depend on a phone successfully decoding and seeking a video
 * it just finished downloading; the server already holds the exact same
 * bytes right after generation (`app/api/skidmarks/generate-clip/
 * route.ts`'s `persistRenderBytesToBlob`), so extracting the last frame
 * there removes the flaky step entirely instead of giving it a longer
 * timeout.
 *
 * **`@ffmpeg-installer/ffmpeg`** bundles a real static ffmpeg binary per
 * platform (`node_modules/@ffmpeg-installer/<platform>`) — verified in
 * this sandbox (linux-x64, a real static build, `ffmpeg -version` runs)
 * against a real synthetic test video end-to-end. Vercel's Node.js
 * serverless functions run linux-x64, matching this package's own
 * `optionalDependencies` selection at install time (`os.platform() +
 * '-' + os.arch()`), so the binary this installs locally is the same one
 * that ships to production.
 *
 * **This module deliberately never imports `@ffmpeg-installer/ffmpeg`'s
 * own JS entry point** (`resolveFfmpegBinaryPath` below builds the
 * binary's path itself instead) — a real build failure, not a
 * hypothetical one: that package's `index.js` resolves its binary with
 * runtime string-built `require(...)` calls (`require(npm3Package)`,
 * where the specifier is a variable, not a literal), which Next's
 * Turbopack bundler cannot statically trace and hard-fails the whole
 * production build over ("Module not found... server relative imports
 * are not implemented yet") the moment anything imports it — this
 * surfaced immediately on the first real `npm run build` after wiring
 * this feature up. `@ffmpeg-installer/ffmpeg` stays a real dependency in
 * `package.json` purely so `npm install` actually fetches the platform
 * binary (one of its own `optionalDependencies`, `@ffmpeg-installer/
 * linux-x64`) — this module then finds that already-installed binary by
 * its own known, static path, with nothing left for Turbopack to (or
 * need to) resolve. **`next.config.ts`'s `outputFileTracingIncludes`
 * force-includes the whole `@ffmpeg-installer` tree for the API routes
 * that need it** — since nothing here imports that package's JS at all
 * anymore, Next's build-time file tracer (`@vercel/nft`) has no import
 * graph edge to discover the binary through on its own; without that
 * explicit include the function would deploy without the binary and
 * fail only in production.
 *
 * **`-sseof -0.5`, not seeking to the reported `duration`**: same
 * reasoning `lib/videoFrame.ts` used to document (now removed) — ffmpeg
 * seeking to a video's exact end can land one tick past the last
 * decodable frame on some encodes. Backing off half a second and
 * grabbing whatever frame is current there is the same "close enough to
 * read as the very end, but never risk a blank/corrupt capture" trade,
 * and half a second reads as invisible in a still frame.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Builds the bundled ffmpeg binary's real filesystem path without ever
 * importing `@ffmpeg-installer/ffmpeg`'s own JS — see this module's doc
 * comment for the real Turbopack build failure that caused this. Only
 * supports linux-x64 (Vercel's Node.js serverless runtime, and what a
 * linux-x64 `npm install` — this sandbox included — actually installs
 * of `@ffmpeg-installer/ffmpeg`'s platform-specific
 * `optionalDependencies`); any other platform returns `undefined` and
 * `extractLastVideoFrameServer` reports that honestly rather than
 * guessing at a binary that was never installed. */
function resolveFfmpegBinaryPath(): string | undefined {
  if (os.platform() !== "linux" || os.arch() !== "x64") return undefined;
  return path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "linux-x64", "ffmpeg");
}

/** How far back from the reported end of the file to seek before
 * capturing — see this module's doc comment. */
const END_SEEK_BACKOFF_SEC = 0.5;

/** Generous but bounded — this runs inside the same request that already
 * waited on the real render job, and a real extraction (verified in this
 * sandbox) takes a small fraction of a second even for a 15–30s clip;
 * this is a safety ceiling against a genuinely corrupt/unreadable
 * download, not a budget this is expected to need in the normal case. */
const FFMPEG_TIMEOUT_MS = 30_000;

export type ExtractLastFrameOutcome = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

/**
 * Extracts the closing frame of `videoBytes` (a full, already-downloaded
 * MP4) as JPEG bytes. Never throws — every failure (a corrupt file, a
 * missing/broken ffmpeg binary, a timeout) comes back as an honest
 * `{ ok: false, message }` so the caller can treat this as best-effort
 * (the video itself is still real and already saved) rather than have a
 * frame-capture problem take down the whole persisted render.
 */
export async function extractLastVideoFrameServer(videoBytes: Uint8Array): Promise<ExtractLastFrameOutcome> {
  const ffmpegBinaryPath = resolveFfmpegBinaryPath();
  if (!ffmpegBinaryPath) {
    return { ok: false, message: `No bundled ffmpeg binary available for this platform (${os.platform()}-${os.arch()}).` };
  }

  const id = randomUUID();
  const inputPath = path.join(os.tmpdir(), `skidmarks-lastframe-${id}.mp4`);
  const outputPath = path.join(os.tmpdir(), `skidmarks-lastframe-${id}.jpg`);
  try {
    await fs.writeFile(inputPath, videoBytes);
    await execFileAsync(
      ffmpegBinaryPath,
      ["-y", "-sseof", `-${END_SEEK_BACKOFF_SEC}`, "-i", inputPath, "-update", "1", "-q:v", "2", outputPath],
      { timeout: FFMPEG_TIMEOUT_MS }
    );
    const jpegBytes = await fs.readFile(outputPath);
    if (jpegBytes.length === 0) {
      return { ok: false, message: "ffmpeg produced an empty last-frame image." };
    }
    return { ok: true, bytes: new Uint8Array(jpegBytes) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? `ffmpeg could not extract the last frame: ${err.message}` : "ffmpeg could not extract the last frame.",
    };
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}
