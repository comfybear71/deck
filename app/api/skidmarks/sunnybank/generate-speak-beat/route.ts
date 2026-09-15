import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { decodeDataUrl } from "@/lib/dataUrl";
import { synthesizeSunnyBanksLine } from "@/lib/elevenLabsSpeech";
import { estimateMp3DurationSec } from "@/lib/mp3Slice";
import {
  buildSunnyBanksSpeakBeatPathname,
  buildSunnyBanksSpeakingPrompt,
  getSunnyBanksCharacterLock,
} from "@/lib/sunnyBanks";
import {
  buildLtx23Ia2vWorkflow,
  downloadComfyCloudOutput,
  letterboxImageForLtxIa2v,
  pollComfyCloudJob,
  resolveComfyCloudCredentials,
  submitComfyCloudWorkflow,
  uploadComfyCloudInput,
} from "@/lib/comfyCloud";

/**
 * POST /api/skidmarks/sunnybank/generate-speak-beat — the very first
 * real slice of Sunny Banks (2026-09-15), scoped exactly to Grok's own
 * relayed pilot instructions: "Render **one speak beat** with gold
 * prompt + start image. Stop. Do not auto-render a full 40-beat episode
 * until Stuie says go." No episode/beat model, no script parser, no
 * cast strip UI yet — just proving the one thing genuinely new here
 * (ElevenLabs text-to-speech feeding a real Comfy Cloud LTX render)
 * actually works end to end, the same "prove the riskiest new
 * integration in isolation before building the wizard around it" order
 * this whole feature area has followed since Skidmarks' own Vocal path.
 *
 * **Reuses the exact same Comfy Cloud LTX 2.3 IA2V pipeline Skidmarks'
 * music-video Vocal render already calls** (`lib/comfyCloud.ts`,
 * `workflow/LTX_2.3_IA2V_Cloud.json`) — confirmed, not assumed, by
 * reading `buildLtx23Ia2vWorkflow` before writing this route: it takes
 * an already-uploaded image filename, an already-uploaded audio
 * filename, a prompt, and a duration — it has no idea (and doesn't
 * care) whether that audio came from a sliced song vocal or a freshly
 * synthesized ElevenLabs line. Same graph, same "talkvid-3k" ID LoRA
 * that holds a face through motion, same poll/download/persist shape —
 * only the *source* of the driving audio and the *prompt text* (Sunny
 * Banks' own gold, `lib/sunnyBanks.ts`, not Skidmarks' 3D-noir prompt)
 * are new.
 *
 * **Real per-beat pathname/shelf, resume-on-failure, last-frame
 * chaining between beats — all deliberately out of scope for this
 * route.** Every one of those is real, working infrastructure this app
 * already has (`lib/clipRenderBlob.ts`, `lib/scriptSequenceRunner.ts`,
 * `lib/serverVideoFrame.ts`) and Sunny Banks will reuse once there's a
 * real episode/beat model to hang it off — building that model before
 * proving the render itself works would be exactly the "storyboard/
 * IMAGE MOTION desk" scope creep Grok's own spec explicitly warned
 * against rebuilding.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** Same generic LTX-node audio-input floor `app/api/skidmarks/
 * generate-clip/route.ts`'s Vocal path already enforces (`MIN_LTX_AUDIO_INPUT_SEC`)
 * — a property of the LTX graph's own audio requirements, not anything
 * specific to a sliced song. A single short line ("G'day") can
 * plausibly synthesize to less than this; reported honestly rather than
 * sent to Comfy Cloud to fail there instead. */
const MIN_LTX_AUDIO_INPUT_SEC = 2;
/** Same product ceiling every other LTX render in this app clamps
 * into (`MAX_LTX_CLIP_DURATION_SEC`, `lib/clipGeneration.ts`) — a real
 * sitcom dialogue line should never approach this, but the clamp stays
 * as a defensive floor/ceiling on the *reported* duration fed to the
 * workflow's graph input, never on the real audio bytes themselves
 * (which are always sent in full, whatever their real length). */
const MAX_LTX_CLIP_DURATION_SEC = 30;

const SPEAK_BEAT_POLL_DEADLINE_MS = 240_000;

interface GenerateSpeakBeatRequestBody {
  characterName?: unknown;
  line?: unknown;
  startImageDataUrl?: unknown;
}

export async function POST(request: Request) {
  let body: GenerateSpeakBeatRequestBody;
  try {
    body = (await request.json()) as GenerateSpeakBeatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body.", code: "invalid_request" }, { status: 400 });
  }

  const characterName = typeof body.characterName === "string" ? body.characterName.trim() : "";
  const line = typeof body.line === "string" ? body.line.trim() : "";
  const startImageDataUrl = typeof body.startImageDataUrl === "string" ? body.startImageDataUrl : "";

  if (!characterName || !line || !startImageDataUrl) {
    return NextResponse.json(
      { error: "characterName, line, and startImageDataUrl are all required.", code: "invalid_request" },
      { status: 400 }
    );
  }

  const character = getSunnyBanksCharacterLock(characterName);
  if (!character) {
    return NextResponse.json(
      { error: `"${characterName}" isn't a locked Sunny Banks character.`, code: "unknown_character" },
      { status: 400 }
    );
  }
  if (!character.voiceId) {
    return NextResponse.json(
      { error: `${character.name} doesn't have a locked ElevenLabs voice yet.`, code: "missing_voice" },
      { status: 400 }
    );
  }

  const creds = resolveComfyCloudCredentials();
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "COMFY_CLOUD_API_KEY is not set on the server — Sunny Banks rendering (Comfy Cloud LTX) is " +
          "unavailable here.",
        code: "missing_api_key",
      },
      { status: 501 }
    );
  }

  const speechOutcome = await synthesizeSunnyBanksLine(character.voiceId, line);
  if (!speechOutcome.ok) {
    return NextResponse.json(
      { error: speechOutcome.message, code: speechOutcome.unconfigured ? "missing_api_key" : "upstream_error" },
      { status: speechOutcome.unconfigured ? 501 : 502 }
    );
  }

  const rawDurationSec = estimateMp3DurationSec(speechOutcome.bytes);
  if (rawDurationSec < MIN_LTX_AUDIO_INPUT_SEC) {
    return NextResponse.json(
      {
        error:
          `${character.name}'s line only synthesized to ${rawDurationSec.toFixed(1)}s — Comfy Cloud's LTX ` +
          `node needs at least ${MIN_LTX_AUDIO_INPUT_SEC}s of driving audio. Try a longer line.`,
        code: "invalid_request",
      },
      { status: 422 }
    );
  }
  const durationSec = Math.min(MAX_LTX_CLIP_DURATION_SEC, rawDurationSec);

  const decodedImage = decodeDataUrl(startImageDataUrl);
  if (!decodedImage) {
    return NextResponse.json(
      { error: "Could not decode startImageDataUrl.", code: "invalid_request" },
      { status: 400 }
    );
  }

  // See `letterboxImageForLtxIa2v`'s doc comment — a cast reference
  // photo isn't reliably 16:9, and Comfy's own IA2V resize center-crops
  // anything else instead of scaling to fit.
  const framedImage = await letterboxImageForLtxIa2v(decodedImage.bytes, decodedImage.mimeType);
  const imageUpload = await uploadComfyCloudInput(
    framedImage.bytes,
    framedImage.letterboxed ? `sunnybanks-start-${Date.now()}.jpg` : `sunnybanks-start-${Date.now()}.png`,
    framedImage.mimeType,
    creds
  );
  if (!imageUpload.ok) {
    return NextResponse.json({ error: imageUpload.error, code: imageUpload.code }, { status: imageUpload.status });
  }

  const audioUpload = await uploadComfyCloudInput(
    speechOutcome.bytes,
    `sunnybanks-line-${Date.now()}.mp3`,
    speechOutcome.contentType,
    creds
  );
  if (!audioUpload.ok) {
    return NextResponse.json({ error: audioUpload.error, code: audioUpload.code }, { status: audioUpload.status });
  }

  const prompt = buildSunnyBanksSpeakingPrompt(character, line);
  const workflow = buildLtx23Ia2vWorkflow({
    imageFilename: imageUpload.name,
    audioFilename: audioUpload.name,
    prompt,
    durationSec,
  });

  const submitResult = await submitComfyCloudWorkflow(workflow, creds);
  if (!submitResult.ok) {
    return NextResponse.json({ error: submitResult.error, code: submitResult.code }, { status: submitResult.status });
  }

  const completionResult = await pollComfyCloudJob(submitResult.promptId, creds, SPEAK_BEAT_POLL_DEADLINE_MS);
  if (!completionResult.ok) {
    return NextResponse.json(
      { error: completionResult.error, code: completionResult.code },
      { status: completionResult.status }
    );
  }

  const downloadResult = await downloadComfyCloudOutput(completionResult.videoFile, creds);
  if (!downloadResult.ok) {
    return NextResponse.json({ error: downloadResult.error, code: downloadResult.code }, { status: downloadResult.status });
  }

  const pathname = buildSunnyBanksSpeakBeatPathname(character.name, Date.now());
  try {
    const blob = await put(pathname, Buffer.from(downloadResult.bytes), {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
    });
    return NextResponse.json({
      videoUrl: blob.url,
      durationSec,
      character: character.name,
      persisted: true,
    });
  } catch (err) {
    // Same "never throw away a render Stuart already paid for" rule as
    // every other backend in this app — a Blob failure still returns
    // the real bytes as a data: URL, honestly flagged as not saved.
    return NextResponse.json({
      videoUrl: `data:video/mp4;base64,${Buffer.from(downloadResult.bytes).toString("base64")}`,
      durationSec,
      character: character.name,
      persisted: false,
      persistError: err instanceof Error ? err.message : "Vercel Blob upload failed for an unknown reason.",
    });
  }
}
