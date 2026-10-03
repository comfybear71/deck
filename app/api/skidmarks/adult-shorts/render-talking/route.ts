import { NextResponse } from "next/server";
import { staleDeckPageResponse } from "@/lib/deckBuildServer";
import { ADULT_SHORTS_LINE_MAX } from "@/lib/adultShorts";
import { normalizeElevenLabsVoiceId } from "@/lib/characterLoras";
import {
  buildLtx23Ia2vWorkflow,
  downloadComfyCloudOutput,
  letterboxImageForLtxIa2v,
  pollComfyCloudJob,
  resolveComfyCloudCredentials,
  submitComfyCloudWorkflow,
  uploadComfyCloudInput,
} from "@/lib/comfyCloud";
import { decodeDataUrl } from "@/lib/dataUrl";
import { deckMediaStem, parseDeckMediaTarget, type DeckMediaExtension, type DeckMediaTarget } from "@/lib/deckMediaPaths";
import { putDeckMediaOrLegacy } from "@/lib/deckMediaPut";
import { synthesizeSunnyBanksLine } from "@/lib/elevenLabsSpeech";
import { talkingPromptWithLine } from "@/lib/adultShortsTalking";
import { estimateMp3DurationSec } from "@/lib/mp3Slice";
import { muxClipAudio } from "@/lib/muxClipAudio";
import { extractLastVideoFrameServer } from "@/lib/serverVideoFrame";
import { padMp3ToMinimumDurationSec } from "@/lib/silentMp3";

/**
 * POST /api/skidmarks/adult-shorts/render-talking — a Shorts shot with a
 * Line (2026-09-30): the speaker's Cast card ElevenLabs voice says the
 * line, then Comfy Cloud LTX 2.3 lip-syncs the shot's plate (or the
 * previous clip's last frame) to it. The same pipeline as Sunnybank's
 * talking lines (`app/api/skidmarks/sunnybank/generate-speak-beat`),
 * reusing its library code (`synthesizeSunnyBanksLine`, the LTX IA2V
 * graph, the 2s audio floor, the audio mux). It does not touch that
 * route: Sunnybank composites a cartoon regular onto a park location
 * first, while a Shorts plate already shows the people.
 *
 * - ElevenLabs gets the Line with its square-bracket tags (`[whispers]`,
 *   `[laughs]`) intact; the picture prompt quotes only the words.
 * - The prompt arrives carrying the Shorts adult lock and the episode's
 *   content rule (`buildAdultShortsTalkingPrompt`); this route re-checks
 *   the adult lock, like `render-clip`.
 * - Files: the clip, its last frame and the spoken line's MP3, all in
 *   the episode's readable folder (`deck/shorts/episodes/<ep>/`).
 * - One call, like Sunnybank's (no resumable task id on Comfy Cloud here).
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const ADULT_SHORTS_LOCK_RE = /\badult\b[a-z ]{0,12}, clearly over 25/i;
const MAX_PROMPT_LENGTH = 2000;
/** LTX's LoadAudio needs at least 2s (same floor as Sunnybank). */
const MIN_LTX_AUDIO_INPUT_SEC = 2;
/** Same LTX ceiling as Sunnybank's talking lines. */
const MAX_LTX_CLIP_DURATION_SEC = 15;
const POLL_DEADLINE_MS = 240_000;
const FETCH_TIMEOUT_MS = 30_000;
/** Plates and last frames live on Deck's own Vercel Blob store. */
const START_IMAGE_HOST_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

interface Body {
  prompt?: unknown;
  line?: unknown;
  speakerName?: unknown;
  voiceId?: unknown;
  startImageUrl?: unknown;
  /** `{ folder, name }` for the clip; its last frame sits next to it. */
  mediaTarget?: unknown;
  /** `{ folder, name }` for the spoken line's MP3. */
  voiceTarget?: unknown;
}

async function loadStartImage(url: string): Promise<{ ok: true; bytes: Uint8Array; mimeType: string } | { ok: false; error: string }> {
  if (url.startsWith("data:image/")) {
    const decoded = decodeDataUrl(url);
    return decoded ? { ok: true, bytes: decoded.bytes, mimeType: decoded.mimeType } : { ok: false, error: "Could not decode the start image." };
  }
  if (!START_IMAGE_HOST_RE.test(url)) return { ok: false, error: "The start image has to be one of Deck's own plates." };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, error: `Fetching the start image returned HTTP ${res.status}.` };
    const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim() || "image/jpeg";
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()), mimeType };
  } catch (err) {
    return { ok: false, error: `Could not fetch the start image: ${err instanceof Error ? err.message : "network error"}.` };
  }
}

async function saveToBlob(
  bytes: Uint8Array,
  legacyPathname: string,
  contentType: string,
  target: DeckMediaTarget | null,
  ext: DeckMediaExtension,
): Promise<{ url: string; pathname: string } | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const blob = await putDeckMediaOrLegacy(Buffer.from(bytes), { target, ext, contentType, legacyPathname });
    return { url: blob.url, pathname: blob.pathname };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const stalePage = staleDeckPageResponse(request);
  if (stalePage) return stalePage;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body.", code: "invalid_request" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const line = typeof body.line === "string" ? body.line.replace(/\s+/g, " ").trim() : "";
  const speakerName = typeof body.speakerName === "string" ? body.speakerName.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const voiceId = normalizeElevenLabsVoiceId(body.voiceId);
  const startImageUrl = typeof body.startImageUrl === "string" ? body.startImageUrl.trim() : "";

  if (!line) return NextResponse.json({ error: "Write the Line first.", code: "invalid_request" }, { status: 400 });
  if (line.length > ADULT_SHORTS_LINE_MAX) {
    return NextResponse.json({ error: "The Line is too long.", code: "invalid_request" }, { status: 400 });
  }
  if (!speakerName) return NextResponse.json({ error: "Missing the speaker.", code: "invalid_request" }, { status: 400 });
  if (!voiceId) {
    return NextResponse.json(
      { error: `${speakerName} has no voice yet. Add their ElevenLabs voice ID on their Cast card.`, code: "missing_voice" },
      { status: 400 }
    );
  }
  if (!prompt) return NextResponse.json({ error: "Missing `prompt`.", code: "invalid_request" }, { status: 400 });
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: "Prompt is too long.", code: "invalid_request" }, { status: 400 });
  }
  if (!ADULT_SHORTS_LOCK_RE.test(prompt)) {
    return NextResponse.json({ error: "Shorts prompts must carry the adult character lock.", code: "invalid_request" }, { status: 400 });
  }
  if (!/^(https:\/\/|data:image\/)/.test(startImageUrl)) {
    return NextResponse.json({ error: "Make the plate first. The clip needs a start image.", code: "invalid_request" }, { status: 400 });
  }

  const creds = resolveComfyCloudCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: "COMFY_CLOUD_API_KEY is not set on the server, so talking shots (LTX) can't render here.", code: "missing_api_key" },
      { status: 501 }
    );
  }

  const start = await loadStartImage(startImageUrl);
  if (!start.ok) return NextResponse.json({ error: start.error, code: "start_image" }, { status: 400 });

  // 1. The voice: ElevenLabs, tags and all.
  const speech = await synthesizeSunnyBanksLine(voiceId, line);
  if (!speech.ok) {
    return NextResponse.json(
      { error: speech.message, code: speech.unconfigured ? "missing_api_key" : "upstream_error" },
      { status: speech.unconfigured ? 501 : 502 }
    );
  }
  const rawSec = estimateMp3DurationSec(speech.bytes);
  if (rawSec <= 0) {
    return NextResponse.json({ error: "ElevenLabs returned an empty or unreadable MP3.", code: "upstream_error" }, { status: 502 });
  }
  const audioBytes = rawSec < MIN_LTX_AUDIO_INPUT_SEC ? padMp3ToMinimumDurationSec(speech.bytes, MIN_LTX_AUDIO_INPUT_SEC) : speech.bytes;
  const audioSec = estimateMp3DurationSec(audioBytes);
  if (audioSec < MIN_LTX_AUDIO_INPUT_SEC) {
    return NextResponse.json(
      { error: `The line only came to ${rawSec.toFixed(1)}s and couldn't be padded to LTX's ${MIN_LTX_AUDIO_INPUT_SEC}s floor.`, code: "invalid_request" },
      { status: 422 }
    );
  }
  const durationSec = Math.min(MAX_LTX_CLIP_DURATION_SEC, audioSec);

  // 2. LTX lip-sync from the plate.
  const framed = await letterboxImageForLtxIa2v(start.bytes, start.mimeType);
  const stamp = Date.now();
  const imageUpload = await uploadComfyCloudInput(
    framed.bytes,
    framed.letterboxed ? `shorts-start-${stamp}.jpg` : `shorts-start-${stamp}.png`,
    framed.mimeType,
    creds
  );
  if (!imageUpload.ok) return NextResponse.json({ error: imageUpload.error, code: imageUpload.code }, { status: imageUpload.status });
  const audioUpload = await uploadComfyCloudInput(audioBytes, `shorts-line-${stamp}.mp3`, speech.contentType, creds);
  if (!audioUpload.ok) return NextResponse.json({ error: audioUpload.error, code: audioUpload.code }, { status: audioUpload.status });

  const workflow = buildLtx23Ia2vWorkflow({
    imageFilename: imageUpload.name,
    audioFilename: audioUpload.name,
    prompt: talkingPromptWithLine(prompt, speakerName, line),
    durationSec,
  });
  const submit = await submitComfyCloudWorkflow(workflow, creds);
  if (!submit.ok) return NextResponse.json({ error: submit.error, code: submit.code }, { status: submit.status });
  const done = await pollComfyCloudJob(submit.promptId, creds, POLL_DEADLINE_MS);
  if (!done.ok) return NextResponse.json({ error: done.error, code: done.code }, { status: done.status });
  const download = await downloadComfyCloudOutput(done.videoFile, creds);
  if (!download.ok) return NextResponse.json({ error: download.error, code: download.code }, { status: download.status });

  // LTX doesn't reliably keep the sound; bake the same MP3 in. A failed mux still returns the paid picture.
  const muxed = await muxClipAudio(download.bytes, audioBytes);
  const videoBytes = muxed.ok ? muxed.bytes : download.bytes;

  // 3. Save: clip, last frame next to it, and the spoken line.
  const stem = `skidmarks/adult-shorts/${stamp}-${Math.random().toString(36).slice(2, 10)}`;
  const clipTarget = parseDeckMediaTarget(body.mediaTarget);
  const savedClip = await saveToBlob(videoBytes, `${stem}.mp4`, "video/mp4", clipTarget, "mp4");
  const frameTarget: DeckMediaTarget | null =
    clipTarget && savedClip?.pathname.startsWith(`${clipTarget.folder}/`)
      ? { folder: clipTarget.folder, name: `${deckMediaStem(savedClip.pathname)}-last-frame` }
      : null;
  let lastFrameUrl: string | null = null;
  const frame = await extractLastVideoFrameServer(videoBytes);
  if (frame.ok) {
    lastFrameUrl =
      (await saveToBlob(frame.bytes, `${stem}-last.jpg`, "image/jpeg", frameTarget, "jpg"))?.url ??
      `data:image/jpeg;base64,${Buffer.from(frame.bytes).toString("base64")}`;
  }
  const savedVoice = await saveToBlob(speech.bytes, `${stem}-voice.mp3`, "audio/mpeg", parseDeckMediaTarget(body.voiceTarget), "mp3");

  return NextResponse.json({
    videoUrl: savedClip?.url ?? `data:video/mp4;base64,${Buffer.from(videoBytes).toString("base64")}`,
    persisted: Boolean(savedClip),
    lastFrameUrl,
    voiceUrl: savedVoice?.url ?? null,
    durationSec,
    videoBackend: "ltx",
    audioMuxed: muxed.ok,
    ttsModel: speech.modelId,
  });
}
