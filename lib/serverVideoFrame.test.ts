import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { extractLastVideoFrameServer } from "./serverVideoFrame";

const execFileAsync = promisify(execFile);

/** Same binary-path construction as `serverVideoFrame.ts`'s own
 * `resolveFfmpegBinaryPath` — deliberately not imported from that module
 * (it's not exported) and deliberately not `@ffmpeg-installer/ffmpeg`
 * itself, since importing that package's JS is exactly the real
 * Turbopack build failure this whole module exists to avoid — see
 * `serverVideoFrame.ts`'s doc comment. This test only needs *a* real
 * ffmpeg to build its own fixture video with; it doesn't need to reuse
 * production code to do that. */
const TEST_FFMPEG_PATH = path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "linux-x64", "ffmpeg");

/** Builds a real, tiny synthetic MP4 via ffmpeg's own `testsrc` generator
 * — this test exercises the real subprocess end-to-end (same as the
 * manual verification this module's doc comment describes doing before
 * writing any implementation) rather than mocking `child_process`, since
 * the actual risk here is "does the bundled binary really run and
 * produce a real image," not "did this module call execFile with the
 * right arguments." */
async function buildTestVideo(): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `serverVideoFrame-test-${randomUUID()}.mp4`);
  await execFileAsync(TEST_FFMPEG_PATH, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=1:size=64x64:rate=8",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
  return outputPath;
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((p) => fs.rm(p, { force: true })));
});

describe("extractLastVideoFrameServer", () => {
  it("real end-to-end: extracts a valid JPEG from a real video's bytes", async () => {
    const videoPath = await buildTestVideo();
    cleanupPaths.push(videoPath);
    const videoBytes = await fs.readFile(videoPath);

    const outcome = await extractLastVideoFrameServer(new Uint8Array(videoBytes));

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.bytes.length).toBeGreaterThan(0);
      // JPEG magic bytes (SOI marker) — confirms this is a real, valid
      // image and not just non-empty garbage.
      expect(outcome.bytes[0]).toBe(0xff);
      expect(outcome.bytes[1]).toBe(0xd8);
      expect(outcome.bytes[2]).toBe(0xff);
    }
  });

  it("cleans up its own temp files, win or lose", async () => {
    const videoPath = await buildTestVideo();
    cleanupPaths.push(videoPath);
    const videoBytes = await fs.readFile(videoPath);
    const before = (await fs.readdir(os.tmpdir())).filter((f) => f.startsWith("skidmarks-lastframe-"));

    await extractLastVideoFrameServer(new Uint8Array(videoBytes));

    const after = (await fs.readdir(os.tmpdir())).filter((f) => f.startsWith("skidmarks-lastframe-"));
    expect(after.length).toBe(before.length);
  });

  it("reports an honest failure for bytes that aren't a real video, rather than throwing", async () => {
    const outcome = await extractLastVideoFrameServer(new TextEncoder().encode("not a real video file"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });
});
