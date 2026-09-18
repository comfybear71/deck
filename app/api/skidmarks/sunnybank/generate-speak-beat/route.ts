import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { decodeDataUrl } from "@/lib/dataUrl";
import { synthesizeSunnyBanksLine } from "@/lib/elevenLabsSpeech";
import { estimateMp3DurationSec } from "@/lib/mp3Slice";
import { encodeSilentMp3, padMp3ToMinimumDurationSec, prependSilenceToMp3 } from "@/lib/silentMp3";
import {
  buildSunnyBanksHoldBeatPathname,
  buildSunnyBanksHoldPrompt,
  buildSunnyBanksSpeakBeatPathname,
  buildSunnyBanksSpeakingPrompt,
  getSunnyBanksCharacterLock,
  SUNNY_BANKS_HOLD_DURATION_SEC,
  SUNNY_BANKS_SETTLE_LEAD_SEC,
} from "@/lib/sunnyBanks";
import { compositeSunnyBanksCharacterOntoLocation } from "@/lib/sunnyBanksComposite";
import {
  buildLtx23Ia2vWorkflow,
  downloadComfyCloudOutput,
  letterboxImageForLtxIa2v,
  pollComfyCloudJob,
  resolveComfyCloudCredentials,
  submitComfyCloudWorkflow,
  uploadComfyCloudInput,
} from "@/lib/comfyCloud";
import { muxClipAudio } from "@/lib/muxClipAudio";

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
 * **Plate overlay (2026-09-17)** — copied from original Studio, not a
 * new Comfy node. Studio `plateCastIntoGen` draws the character onto
 * the location with xAI edits (Image 1 = empty place, Image 2 = hero
 * card). `src/lib/ltxCloudIa2v.ts` then patches that composed
 * `plateFile` onto node `269` only. This route now does both steps:
 * `startImageDataUrl` is the location canvas, `characterName` loads
 * the hero overlay, the composed still is what Comfy LoadImage gets.
 * Gold Hold/Speak strings unchanged. The LTX JSON is not edited.
 *
 * **Location cutaway Hold (2026-09-17)** — empty `Crowd:` (any non-CAST
 * `Name:`) is a Hold of the locked park plate with no hero overlay.
 * Gold Hold assumes one plated person, so this path skips compositor /
 * `buildSunnyBanksHoldPrompt` and uses the `[Action:]` motion text on
 * the location still. Not a new CAST record. Speak still rejects an
 * unknown name.
 *
 * **Audio mux (2026-09-17)** — PR #123 padded a short TTS MP3 so
 * LoadAudio (276) met LTX's 2s floor. That padded file *is* the
 * driving audio. SaveVideo (341) still writes a video-only (or
 * unused-audio) MP4, so lips moved and the phone played silence.
 * After download, `muxClipAudio` bakes the same `audioBytes` (padded
 * Speak TTS, or Hold silence) into the container (`-map 0:v:0
 * -map 1:a:0`). A mux failure never discards the paid LTX video —
 * `audioMuxed: false` is the honest flag, same "never throw away a
 * render Stuart already paid for" rule as a Blob miss.
 *
 * **Appearance changes reach the picture, not just the motion prompt
 * (2026-09-18)** — a real reported bug: telling LTX a character is
 * "holding two bottles" via the motion prompt alone (the only thing
 * `appearanceModifier` fed before this) morphed/duplicated the bottles
 * mid-clip, because the starting frame was already composed *without*
 * them — LTX had to invent the prop from nothing. `appearanceModifier`
 * (from `[Character Name: description]`) is now also passed into
 * `compositeSunnyBanksCharacterOntoLocation`'s xAI edit prompt, so the
 * composed starting frame already shows it; LTX's job becomes "hold it
 * steady," not "invent it." Still also appended to the motion prompt
 * as before (via the client's own `action` merge), for consistency
 * across the clip.
 *
 * **Automatic, invisible settle lead-in (2026-09-18, Stuart's explicit
 * "implied... built in... I don't need to see it" ask)** — a Speak
 * beat carrying an `appearanceModifier` gets `SUNNY_BANKS_SETTLE_LEAD_SEC`
 * (1.5s) of silence prepended to its own driving audio, plus one
 * appended prompt sentence telling LTX to hold the newly-staged pose
 * before speaking. Folded into this SAME paid render — no second Hold
 * clip, no new UI, no extra cost beyond the small duration increase
 * already absorbed by `MAX_LTX_CLIP_DURATION_SEC`'s existing clamp.
 * Speak-only for now (not Hold) — a Hold's whole point is already
 * "holds pose, no dialogue," so a Hold beat's existing gold prompt
 * already covers the "settle" case for it.
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
 * specific to a sliced song. A single short line ("You right?") can
 * plausibly synthesize under this; Speak pads a silent MP3 tail
 * (`padMp3ToMinimumDurationSec`) so LoadAudio still gets ≥2s instead of
 * rejecting a real line. Holds already encode 5s of silence. */
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
  /** Optional park-plate id from `SUNNY_BANKS_LOCATIONS` — used only
   * to name the place in the compositor prompt. The location *canvas*
   * is `startImageDataUrl` (Image 1). The character hero from
   * `characterName` is Image 2. LTX still has one LoadImage. */
  locationId?: unknown;
  locationImage?: unknown;
  /** Extra LTX prompt context from `[Action: text]`. Appended after
   * gold Hold/Speak strings. Never sent to ElevenLabs. */
  action?: unknown;
  /** Prop/outfit text from `[Character Name: description]` — the
   * client already sends this as its own field (folded into `action`
   * too, for the motion prompt), but until 2026-09-18 nothing here
   * read it. Now: (1) fed into the xAI compositing prompt itself so
   * the STARTING FRAME already shows it, not just LTX's later motion
   * text — see `compositeSunnyBanksCharacterOntoLocation`'s doc
   * comment for why that's the actual fix for the class of bug where a
   * described prop morphed/duplicated mid-clip; (2) on a Speak beat,
   * triggers an automatic, invisible settle lead-in
   * (`SUNNY_BANKS_SETTLE_LEAD_SEC`) — Stuart's explicit "implied...
   * built in... I don't need to see it" ask, so a character stepping
   * into a described prop/look gets a beat to visibly settle before
   * talking, folded into this SAME render rather than a second,
   * separately-billed silent Hold clip. */
  appearanceModifier?: unknown;
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
  const locationId = typeof body.locationId === "string" ? body.locationId.trim() : "";
  const action = typeof body.action === "string" ? body.action.replace(/\s+/g, " ").trim() : "";
  const appearanceModifier =
    typeof body.appearanceModifier === "string" ? body.appearanceModifier.replace(/\s+/g, " ").trim() : "";

  if (!startImageDataUrl || (kind === "speak" && (!characterName || !line))) {
    return NextResponse.json(
      {
        error:
          kind === "hold"
            ? "startImageDataUrl is required for a Hold."
            : "characterName, line, and startImageDataUrl are all required.",
        code: "invalid_request",
      },
      { status: 400 }
    );
  }

  const character = characterName ? getSunnyBanksCharacterLock(characterName) : undefined;
  const isLocationCutaway = kind === "hold" && !character;
  const cutawayLabel = characterName || "Crowd";
  if (kind === "speak" && !character) {
    return NextResponse.json(
      { error: `"${characterName}" isn't a locked Sunny Banks character.`, code: "unknown_character" },
      { status: 400 }
    );
  }
  const voiceId = character?.voiceId;
  if (kind === "speak" && !voiceId) {
    return NextResponse.json(
      { error: `${character!.name} doesn't have a locked ElevenLabs voice yet.`, code: "missing_voice" },
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
    prompt = isLocationCutaway
      ? buildLocationCutawayPrompt(action)
      : buildSunnyBanksHoldPrompt(character!);
  } else {
    if (!voiceId) {
      return NextResponse.json(
        { error: `${character!.name} doesn't have a locked ElevenLabs voice yet.`, code: "missing_voice" },
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
    audioContentType = speechOutcome.contentType;
    const rawDurationSec = estimateMp3DurationSec(speechOutcome.bytes);
    if (rawDurationSec <= 0) {
      return NextResponse.json(
        {
          error: `Could not parse ${character!.name}'s synthesized line as audio — ElevenLabs returned an empty or unreadable MP3.`,
          code: "upstream_error",
        },
        { status: 502 }
      );
    }
    // Live QA (2026-09-17): "You right?" synthesized to 0.8s and this
    // route 422'd. Pad a silent tail so LTX LoadAudio (276) sees ≥2s.
    // Node 340:331 gets that same padded duration — not a fake duration
    // on short bytes, which would still crash LoadAudio. Gold Speak
    // string unchanged; the extra time is silence after the line.
    audioBytes =
      rawDurationSec < MIN_LTX_AUDIO_INPUT_SEC
        ? padMp3ToMinimumDurationSec(speechOutcome.bytes, MIN_LTX_AUDIO_INPUT_SEC)
        : speechOutcome.bytes;
    const paddedDurationSec = estimateMp3DurationSec(audioBytes);
    if (paddedDurationSec < MIN_LTX_AUDIO_INPUT_SEC) {
      return NextResponse.json(
        {
          error:
            `${character!.name}'s line only synthesized to ${rawDurationSec.toFixed(1)}s and silent padding ` +
            `could not bring it to LTX's ${MIN_LTX_AUDIO_INPUT_SEC}s audio floor.`,
          code: "invalid_request",
        },
        { status: 422 }
      );
    }
    // Automatic, invisible settle lead-in (2026-09-18, Stuart's explicit
    // "implied... built in... I don't need to see it" ask) — folded
    // into this SAME render's own audio + prompt, not a second,
    // separately-billed silent Hold clip. Only fires when this beat
    // actually carries an appearance change; a plain conversational
    // line with no wardrobe/prop change needs no settle time. Applied
    // after the audio-floor pad above (that pad is about meeting LTX's
    // hard minimum; this is a deliberate, always-additional lead-in).
    if (appearanceModifier) {
      audioBytes = prependSilenceToMp3(audioBytes, SUNNY_BANKS_SETTLE_LEAD_SEC);
    }
    const finalDurationSec = estimateMp3DurationSec(audioBytes);
    durationSec = Math.min(MAX_LTX_CLIP_DURATION_SEC, finalDurationSec);
    prompt = buildSunnyBanksSpeakingPrompt(character!, line);
    if (appearanceModifier) {
      prompt =
        `${prompt} For the first ~${SUNNY_BANKS_SETTLE_LEAD_SEC}s, ${character!.name} holds the newly-staged ` +
        `pose from the start image without speaking, then begins speaking naturally in sync with the audio.`;
    }
  }

  // `[Action:]` and the appearance modifier are extra LTX context after
  // gold, never a rewrite of the locked Hold/Speak strings and never
  // part of the TTS `line`. The server (not the client) is the single
  // place these get merged into the motion prompt now (2026-09-18) —
  // previously the client pre-merged `appearanceModifier` into `action`
  // itself, which this route had no way to also route into the
  // compositing prompt above without double-counting it here.
  // Location cutaways already baked action into the motion prompt.
  const motionExtras = [action, appearanceModifier].filter(Boolean).join(" ");
  if (motionExtras && !isLocationCutaway) {
    prompt = `${prompt} ${motionExtras}`;
  }

  let plateDataUrl = startImageDataUrl;
  if (!isLocationCutaway) {
    const plated = await compositeSunnyBanksCharacterOntoLocation({
      locationDataUrl: startImageDataUrl,
      character: character!,
      locationId,
      appearanceOverride: appearanceModifier || undefined,
    });
    if (!plated.ok) {
      return NextResponse.json({ error: plated.error, code: plated.code }, { status: plated.status });
    }
    plateDataUrl = plated.dataUrl;
  }

  return runLtxAndPersist({
    characterName: character?.name ?? cutawayLabel,
    kind,
    prompt,
    durationSec,
    audioBytes,
    audioContentType,
    startImageDataUrl: plateDataUrl,
    creds,
  });
}

function buildLocationCutawayPrompt(action: string): string {
  const motion = action.replace(/\s+/g, " ").trim() || "Subtle ambient motion. Camera holds, no cuts.";
  return `Use the provided start image as the first frame. ${motion} No dialogue.`;
}

async function runLtxAndPersist(args: {
  characterName: string;
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

  // Bake the same MP3 LoadAudio already used (padded TTS or Hold
  // silence) into the MP4. LTX SaveVideo does not reliably keep that
  // track — live QA: lips moved, no sound. A failed mux still returns
  // the paid picture.
  const muxed = await muxClipAudio(downloadResult.bytes, args.audioBytes);
  const videoBytes = muxed.ok ? muxed.bytes : downloadResult.bytes;
  const audioMuxed = muxed.ok;

  const pathname =
    args.kind === "hold"
      ? buildSunnyBanksHoldBeatPathname(args.characterName, Date.now())
      : buildSunnyBanksSpeakBeatPathname(args.characterName, Date.now());
  try {
    const blob = await put(pathname, Buffer.from(videoBytes), {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
    });
    return NextResponse.json({
      videoUrl: blob.url,
      durationSec: args.durationSec,
      character: args.characterName,
      kind: args.kind,
      persisted: true,
      audioMuxed,
      ...(muxed.ok ? {} : { audioMuxError: muxed.message }),
    });
  } catch (err) {
    // Same "never throw away a render Stuart already paid for" rule as
    // every other backend in this app — a Blob failure still returns
    // the real bytes as a data: URL, honestly flagged as not saved.
    return NextResponse.json({
      videoUrl: `data:video/mp4;base64,${Buffer.from(videoBytes).toString("base64")}`,
      durationSec: args.durationSec,
      character: args.characterName,
      kind: args.kind,
      persisted: false,
      persistError: err instanceof Error ? err.message : "Vercel Blob upload failed for an unknown reason.",
      audioMuxed,
      ...(muxed.ok ? {} : { audioMuxError: muxed.message }),
    });
  }
}
