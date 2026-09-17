import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { decodeDataUrl } from "@/lib/dataUrl";
import { synthesizeSunnyBanksLine } from "@/lib/elevenLabsSpeech";
import { estimateMp3DurationSec } from "@/lib/mp3Slice";
import { encodeSilentMp3 } from "@/lib/silentMp3";
import {
  buildSunnyBanksHoldBeatPathname,
  buildSunnyBanksHoldPrompt,
  buildSunnyBanksSpeakBeatPathname,
  buildSunnyBanksSpeakingPrompt,
  getSunnyBanksCharacterLock,
  SUNNY_BANKS_HOLD_DURATION_SEC,
  type SunnyBanksCharacterLock,
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
 * POST /api/skidmarks/sunnybank/generate-speak-beat — the first real
 * slice of Sunny Banks (2026-09-15), plus a Hold sibling (2026-09-17).
 * Original scope: "Render **one speak beat** with gold prompt + start
 * image. Stop. Do not auto-render a full 40-beat episode until Stuie
 * says go." Hold is the same one-clip-at-a-time pilot, not an episode
 * model: `kind: "hold"` skips ElevenLabs entirely, feeds a silent MP3
 * of `SUNNY_BANKS_HOLD_DURATION_SEC` (5s) into the same Comfy Cloud
 * LTX 2.3 IA2V graph, and uses `buildSunnyBanksHoldPrompt` instead of
 * the speaking-plate gold. No ShotBlock schema, no batch.
 *
 * **Reuses the exact same Comfy Cloud LTX 2.3 IA2V pipeline Skidmarks'
 * music-video Vocal render already calls** (`lib/comfyCloud.ts`,
 * `workflow/LTX_2.3_IA2V_Cloud.json`) — it takes an already-uploaded
 * image filename, an already-uploaded audio filename, a prompt, and a
 * duration. A Hold still has to send audio: LTX's `LoadAudio` node
 * (`276`) is required. Silence is the honest input for a no-dialogue
 * beat; inventing a dummy spoken line just to satisfy the graph would
 * be a silent ElevenLabs bill on every Hold.
 *
 * **Real per-beat pathname/shelf, resume-on-failure, last-frame
 * chaining between beats — all deliberately out of scope for this
 * route.** Every one of those is real, working infrastructure this app
 * already has (`lib/clipRenderBlob.ts`, `lib/scriptSequenceRunner.ts`,
 * `lib/serverVideoFrame.ts`) and Sunny Banks will reuse once there's a
 * real episode/beat model to hang it off.
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
 * (which are always sent in full, whatever their real length). Lowered
 * to `15` alongside that constant on 2026-09-15 — keep both in sync. */
const MAX_LTX_CLIP_DURATION_SEC = 15;

const SPEAK_BEAT_POLL_DEADLINE_MS = 240_000;

type BeatKind = "speak" | "hold";

interface GenerateSpeakBeatRequestBody {
  characterName?: unknown;
  line?: unknown;
  startImageDataUrl?: unknown;
  /** `"hold"` = silent pause, no TTS. Anything else (including omitted)
   * is a Speak beat — the original contract, so existing callers don't
   * have to learn a new field. */
  kind?: unknown;
}

function parseBeatKind(value: unknown): BeatKind {
  return value === "hold" ? "hold" : "speak";
}

export async function POST(request: Request) {
  let body: GenerateSpeakBeatRequestBody;
  try {
    body = (await request.json()) as GenerateSpeakBeatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body.", code: "invalid_request" }, { status: 400 });
  }

  const kind = parseBeatKind(body.kind);
  const characterName = typeof body.characterName === "string" ? body.characterName.trim() : "";
  const line = typeof body.line === "string" ? body.line.trim() : "";
  const startImageDataUrl = typeof body.startImageDataUrl === "string" ? body.startImageDataUrl : "";

  if (!characterName || !startImageDataUrl || (kind === "speak" && !line)) {
    return NextResponse.json(
      {
        error:
          kind === "hold"
            ? "characterName and startImageDataUrl are required for a Hold."
            : "characterName, line, and startImageDataUrl are all required.",
        code: "invalid_request",
      },
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
  const voiceId = character.voiceId;
  if (kind === "speak" && !voiceId) {
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

  let audioBytes: Uint8Array;
  let audioContentType: string;
  let durationSec: number;
  let prompt: string;

  if (kind === "hold") {
    audioBytes = encodeSilentMp3(SUNNY_BANKS_HOLD_DURATION_SEC);
    audioContentType = "audio/mpeg";
    const silentDurationSec = estimateMp3DurationSec(audioBytes);
    if (silentDurationSec < MIN_LTX_AUDIO_INPUT_SEC) {
      return NextResponse.json(
        {
          error: `Hold audio only encoded to ${silentDurationSec.toFixed(1)}s — Comfy Cloud's LTX node needs at least ${MIN_LTX_AUDIO_INPUT_SEC}s of driving audio.`,
          code: "invalid_request",
        },
        { status: 422 }
      );
    }
    durationSec = Math.min(MAX_LTX_CLIP_DURATION_SEC, silentDurationSec);
    prompt = buildSunnyBanksHoldPrompt(character);
  } else {
    if (!voiceId) {
      return NextResponse.json(
        { error: `${character.name} doesn't have a locked ElevenLabs voice yet.`, code: "missing_voice" },
        { status: 400 }
      );
    }
    const speechOutcome = await synthesizeSunnyBanksLine(voiceId, line);
    if (!speechOutcome.ok) {
      return NextResponse.json(
        { error: speechOutcome.message, code: speechOutcome.unconfigured ? "missing_api_key" : "upstream_error" },
        { status: speechOutcome.unconfigured ? 501 : 502 }
      );
    }
    audioBytes = speechOutcome.bytes;
    audioContentType = speechOutcome.contentType;
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
    durationSec = Math.min(MAX_LTX_CLIP_DURATION_SEC, rawDurationSec);
    prompt = buildSunnyBanksSpeakingPrompt(character, line);
  }

  return runLtxAndPersist({
    character,
    kind,
    prompt,
    durationSec,
    audioBytes,
    audioContentType,
    startImageDataUrl,
    creds,
  });
}

async function runLtxAndPersist(args: {
  character: SunnyBanksCharacterLock;
  kind: BeatKind;
  prompt: string;
  durationSec: number;
  audioBytes: Uint8Array;
  audioContentType: string;
  startImageDataUrl: string;
  creds: NonNullable<ReturnType<typeof resolveComfyCloudCredentials>>;
}) {
  const decodedImage = decodeDataUrl(args.startImageDataUrl);
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
    args.creds
  );
  if (!imageUpload.ok) {
    return NextResponse.json({ error: imageUpload.error, code: imageUpload.code }, { status: imageUpload.status });
  }

  const audioUpload = await uploadComfyCloudInput(
    args.audioBytes,
    args.kind === "hold" ? `sunnybanks-hold-${Date.now()}.mp3` : `sunnybanks-line-${Date.now()}.mp3`,
    args.audioContentType,
    args.creds
  );
  if (!audioUpload.ok) {
    return NextResponse.json({ error: audioUpload.error, code: audioUpload.code }, { status: audioUpload.status });
  }

  const workflow = buildLtx23Ia2vWorkflow({
    imageFilename: imageUpload.name,
    audioFilename: audioUpload.name,
    prompt: args.prompt,
    durationSec: args.durationSec,
  });

  const submitResult = await submitComfyCloudWorkflow(workflow, args.creds);
  if (!submitResult.ok) {
    return NextResponse.json({ error: submitResult.error, code: submitResult.code }, { status: submitResult.status });
  }

  const completionResult = await pollComfyCloudJob(submitResult.promptId, args.creds, SPEAK_BEAT_POLL_DEADLINE_MS);
  if (!completionResult.ok) {
    return NextResponse.json(
      { error: completionResult.error, code: completionResult.code },
      { status: completionResult.status }
    );
  }

  const downloadResult = await downloadComfyCloudOutput(completionResult.videoFile, args.creds);
  if (!downloadResult.ok) {
    return NextResponse.json({ error: downloadResult.error, code: downloadResult.code }, { status: downloadResult.status });
  }

  const pathname =
    args.kind === "hold"
      ? buildSunnyBanksHoldBeatPathname(args.character.name, Date.now())
      : buildSunnyBanksSpeakBeatPathname(args.character.name, Date.now());
  try {
    const blob = await put(pathname, Buffer.from(downloadResult.bytes), {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
    });
    return NextResponse.json({
      videoUrl: blob.url,
      durationSec: args.durationSec,
      character: args.character.name,
      kind: args.kind,
      persisted: true,
    });
  } catch (err) {
    // Same "never throw away a render Stuart already paid for" rule as
    // every other backend in this app — a Blob failure still returns
    // the real bytes as a data: URL, honestly flagged as not saved.
    return NextResponse.json({
      videoUrl: `data:video/mp4;base64,${Buffer.from(downloadResult.bytes).toString("base64")}`,
      durationSec: args.durationSec,
      character: args.character.name,
      kind: args.kind,
      persisted: false,
      persistError: err instanceof Error ? err.message : "Vercel Blob upload failed for an unknown reason.",
    });
  }
}
