import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { encodeSilentMp3 } from "./silentMp3";
import { muxClipAudio } from "./muxClipAudio";

const execFileAsync = promisify(execFile);

const TEST_FFMPEG_PATH = path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "linux-x64", "ffmpeg");

async function buildSilentTestVideo(durationSec = 1): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `muxClipAudio-test-${randomUUID()}.mp4`);
  await execFileAsync(TEST_FFMPEG_PATH, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=duration=${durationSec}:size=64x64:rate=8`,
    "-pix_fmt",
    "yuv420p",
    "-an",
    outputPath,
  ]);
  return outputPath;
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((p) => fs.rm(p, { force: true })));
});

describe("muxClipAudio", () => {
  it("real end-to-end: bakes a silent MP3 onto a video-only MP4 so the container has an audio stream", async () => {
    const videoPath = await buildSilentTestVideo(1);
    cleanupPaths.push(videoPath);
    const videoBytes = await fs.readFile(videoPath);
    const audioBytes = encodeSilentMp3(1.2);

    const outcome = await muxClipAudio(new Uint8Array(videoBytes), audioBytes);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.bytes.length).toBeGreaterThan(videoBytes.length);

    const muxedPath = path.join(os.tmpdir(), `muxClipAudio-out-${randomUUID()}.mp4`);
    cleanupPaths.push(muxedPath);
    await fs.writeFile(muxedPath, outcome.bytes);

    let stderr = "";
    try {
      await execFileAsync(TEST_FFMPEG_PATH, ["-i", muxedPath], { timeout: 10_000 });
    } catch (err) {
      // ffmpeg -i on a valid file exits 1 and prints stream info on stderr.
      stderr = err instanceof Error && "stderr" in err ? String((err as { stderr?: unknown }).stderr) : "";
    }
    expect(stderr).toMatch(/Audio:/);
    expect(stderr).toMatch(/Video:/);
  });

  it("cleans up its own temp files, win or lose", async () => {
    const videoPath = await buildSilentTestVideo(1);
    cleanupPaths.push(videoPath);
    const videoBytes = await fs.readFile(videoPath);
    const before = (await fs.readdir(os.tmpdir())).filter((f) => f.startsWith("skidmarks-mux-"));

    await muxClipAudio(new Uint8Array(videoBytes), encodeSilentMp3(1));

    const after = (await fs.readdir(os.tmpdir())).filter((f) => f.startsWith("skidmarks-mux-"));
    expect(after.length).toBe(before.length);
  });

  it("reports an honest failure for bytes that aren't a real video, rather than throwing", async () => {
    const outcome = await muxClipAudio(
      new TextEncoder().encode("not a real video file"),
      encodeSilentMp3(1)
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });
});
