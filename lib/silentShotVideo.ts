/**
 * Server-only: renders one silent shot (a Sunnybank hold or Crowd
 * cutaway) on Grok Imagine video 1.5 at 720p or on MiniMax H3 at 768P
 * (2026-09-30). Uses the same xAI and MiniMax clients as the Music video
 * Instrumental path (`lib/xaiVideo.ts`, `lib/minimaxH3.ts`), with the
 * same 16:9 start-frame padding (`padFrameTo16x9`).
 *
 * Returns the raw video bytes. The caller replaces the soundtrack with
 * silence (`muxClipAudio`): both engines make their own audio, and xAI's
 * API has no switch to turn it off.
 */
import { decodeDataUrl } from "./dataUrl";
import {
  checkMinimaxApiKey,
  downloadMinimaxH3Video,
  MINIMAX_H3_RESOLUTION,
  pollMinimaxH3VideoUntilDone,
  resolveMinimaxCredentials,
  submitMinimaxH3Video,
  type MinimaxKeyCheckOutcome,
} from "./minimaxH3";
import { FORCED_VIDEO_ASPECT_RATIO, padFrameTo16x9 } from "./videoFrame16x9";
import { SILENT_SHOT_GROK_RESOLUTION, type SilentShotBackend } from "./videoBackendRouting";
import { missingXaiApiKeyMessage, resolveXaiApiKey } from "./xaiApiKey";
import { downloadXaiVideo, pollXaiVideoJob, postXaiVideoGeneration, resolveXaiVideoModel } from "./xaiVideo";

/** Time between status checks. MiniMax asks for no faster than ~10s. */
export const SILENT_SHOT_GROK_POLL_INTERVAL_MS = 4_000;
export const SILENT_SHOT_H3_POLL_INTERVAL_MS = 8_000;

/** Appended to the hold / cutaway prompt on Grok and H3 only. Both make
 * their own sound and can start a character talking; LTX is driven by
 * the silent track, so it never needed saying. */
export const SILENT_SHOT_PROMPT_SUFFIX = "Silent shot: nobody talks, mouths stay closed.";

export type SilentShotFailure = { ok: false; status: number; code: string; error: string };
export type SilentShotOutcome = { ok: true; bytes: Uint8Array; durationSec: number } | SilentShotFailure;

async function frame16x9DataUrl(dataUrl: string): Promise<string | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const framed = await padFrameTo16x9(decoded.bytes, decoded.mimeType);
  if (!framed.padded) return dataUrl;
  return `data:${framed.mimeType};base64,${Buffer.from(framed.bytes).toString("base64")}`;
}

export async function renderSilentShotVideo(args: {
  backend: SilentShotBackend;
  prompt: string;
  /** The composed start still (or the location, for a cutaway), as a `data:` URL. */
  startImageDataUrl: string;
  durationSec: number;
  /** How long to wait for the engine before giving up honestly. */
  deadlineMs: number;
}): Promise<SilentShotOutcome> {
  const startImage = await frame16x9DataUrl(args.startImageDataUrl);
  if (!startImage) {
    return { ok: false, status: 400, code: "invalid_request", error: "Could not decode the start image." };
  }
  const durationSec = Math.round(args.durationSec);

  if (args.backend === "h3") {
    const creds = resolveMinimaxCredentials();
    if (!creds) {
      return {
        ok: false,
        status: 501,
        code: "missing_api_key",
        error:
          "MINIMAX_API_KEY is not set on the server, so silent shots can't render on H3 here. Flip the switch " +
          "to Grok, or set the key in Vercel and redeploy.",
      };
    }
    const submitted = await submitMinimaxH3Video(
      { prompt: args.prompt, firstImageUrl: startImage, durationSec, resolution: MINIMAX_H3_RESOLUTION },
      creds
    );
    if (!submitted.ok) return submitted;
    const done = await pollMinimaxH3VideoUntilDone(submitted.taskId, creds, {
      deadlineMs: args.deadlineMs,
      intervalMs: SILENT_SHOT_H3_POLL_INTERVAL_MS,
    });
    if (!done.ok) return done;
    const downloaded = await downloadMinimaxH3Video(done.videoUrl);
    if (!downloaded.ok) return downloaded;
    return { ok: true, bytes: downloaded.bytes, durationSec };
  }

  const key = resolveXaiApiKey();
  if (!key) {
    return { ok: false, status: 501, code: "missing_api_key", error: missingXaiApiKeyMessage("silent shots on Grok") };
  }
  const started = await postXaiVideoGeneration(
    {
      model: resolveXaiVideoModel(),
      prompt: args.prompt,
      duration: durationSec,
      resolution: SILENT_SHOT_GROK_RESOLUTION,
      aspect_ratio: FORCED_VIDEO_ASPECT_RATIO,
      image: { url: startImage },
    },
    key.key
  );
  if (!started.ok) return started;
  const done = await pollXaiVideoJob(started.requestId, key.key, durationSec, {
    deadlineMs: args.deadlineMs,
    intervalMs: SILENT_SHOT_GROK_POLL_INTERVAL_MS,
  });
  if (!done.ok) return done;
  const downloaded = await downloadXaiVideo(done.videoUrl);
  if (!downloaded.ok) return downloaded;
  return { ok: true, bytes: downloaded.bytes, durationSec: done.durationSec };
}

/** The free H3 key check (`checkMinimaxApiKey`), with the server's own key. */
export function checkSilentShotH3Key(): Promise<MinimaxKeyCheckOutcome> {
  return checkMinimaxApiKey(resolveMinimaxCredentials());
}
