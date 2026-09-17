/**
 * Server-only: muxes a driving MP3 onto an LTX MP4 so the finished
 * clip actually has an audio track.
 *
 * Live QA (2026-09-17): Speak lips moved but no sound played. PR #123
 * padded a short TTS MP3 so Comfy LoadAudio (node `276`) met LTX's 2s
 * floor, and that padded file *is* what the graph is driven with —
 * but the graph's SaveVideo node (`341`) writes a video-only (or
 * unused-audio) MP4. `generate-speak-beat` used to `put()` those raw
 * bytes, so the padded MP3 never reached the media container the
 * phone plays.
 *
 * Same ffmpeg binary path as `lib/serverVideoFrame.ts` — never import
 * `@ffmpeg-installer/ffmpeg`'s JS (Turbopack cannot trace its
 * runtime `require(...)` and hard-fails the production build). A
 * mux failure never throws: the caller still has the LTX video
 * Stuart already paid for, and must return that honestly rather
 * than discard a successful render over a silent track.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function resolveFfmpegBinaryPath(): string | undefined {
  if (os.platform() !== "linux" || os.arch() !== "x64") return undefined;
  return path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "linux-x64", "ffmpeg");
}

const FFMPEG_TIMEOUT_MS = 30_000;

export type MuxClipAudioOutcome =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; message: string };

/**
 * Takes LTX's downloaded MP4 (`videoBytes`) and the same driving MP3
 * already uploaded to LoadAudio (`audioBytes` — Speak TTS, including
 * any silent pad from `padMp3ToMinimumDurationSec`, or Hold silence)
 * and returns an MP4 with that audio baked in (`-map 0:v:0 -map 1:a:0`,
 * video copy, AAC audio, `-shortest` so a pad tail cannot outrun the
 * picture). Never throws.
 */
export async function muxClipAudio(
  videoBytes: Uint8Array,
  audioBytes: Uint8Array
): Promise<MuxClipAudioOutcome> {
  const ffmpegBinaryPath = resolveFfmpegBinaryPath();
  if (!ffmpegBinaryPath) {
    return {
      ok: false,
      message: `No bundled ffmpeg binary available for this platform (${os.platform()}-${os.arch()}).`,
    };
  }
  if (videoBytes.length === 0) {
    return { ok: false, message: "Cannot mux audio onto an empty video." };
  }
  if (audioBytes.length === 0) {
    return { ok: false, message: "Cannot mux an empty audio file onto the clip." };
  }

  const id = randomUUID();
  const videoPath = path.join(os.tmpdir(), `skidmarks-mux-${id}.mp4`);
  const audioPath = path.join(os.tmpdir(), `skidmarks-mux-${id}.mp3`);
  const outputPath = path.join(os.tmpdir(), `skidmarks-mux-${id}-out.mp4`);
  try {
    await fs.writeFile(videoPath, videoBytes);
    await fs.writeFile(audioPath, audioBytes);
    await execFileAsync(
      ffmpegBinaryPath,
      [
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { timeout: FFMPEG_TIMEOUT_MS }
    );
    const muxedBytes = await fs.readFile(outputPath);
    if (muxedBytes.length === 0) {
      return { ok: false, message: "ffmpeg produced an empty muxed clip." };
    }
    return { ok: true, bytes: new Uint8Array(muxedBytes) };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `ffmpeg could not mux the driving audio onto the clip: ${err.message}`
          : "ffmpeg could not mux the driving audio onto the clip.",
    };
  } finally {
    await fs.rm(videoPath, { force: true }).catch(() => {});
    await fs.rm(audioPath, { force: true }).catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}
