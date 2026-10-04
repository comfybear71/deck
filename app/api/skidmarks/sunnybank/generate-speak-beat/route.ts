import { NextResponse } from "next/server";
import { staleDeckPageResponse } from "@/lib/deckBuildServer";
import {
  deckMediaSlug,
  extensionForImageContentType,
  parseDeckMediaTarget,
  type DeckMediaTarget,
} from "@/lib/deckMediaPaths";
import { putDeckMediaOrLegacy } from "@/lib/deckMediaPut";
import { decodeDataUrl } from "@/lib/dataUrl";
import { stripElevenLabsAudioTags, synthesizeSunnyBanksLine } from "@/lib/elevenLabsSpeech";
import { estimateMp3DurationSec } from "@/lib/mp3Slice";
import { encodeSilentMp3, padMp3ToMinimumDurationSec } from "@/lib/silentMp3";
import {
  buildSunnyBanksHoldBeatPathname,
  buildSunnyBanksHoldPrompt,
  buildSunnyBanksSpeakBeatPathname,
  buildSunnyBanksSpeakingPrompt,
  missingCastPictureMessage,
  missingVoiceMessage,
  resolveSunnyBanksStartImage,
  SUNNY_BANKS_HOLD_DURATION_SEC,
} from "@/lib/sunnyBanks";
import {
  compositeSunnyBanksCastOntoLocation,
  compositeSunnyBanksCharacterOntoLocation,
  readSunnyBanksBlobPictureDataUrl,
  resolveBeatStartImage,
} from "@/lib/sunnyBanksComposite";
import {
  buildSunnyBanksMultiCastHoldSuffix,
  buildSunnyBanksSpeakerListenerSuffix,
  parseSunnyBanksPlateUrl,
  parseSunnyBanksSceneSpeakers,
  parseSunnyBanksShotCast,
} from "@/lib/sunnyBanksShotCast";
import { normalizeElevenLabsVoiceId } from "@/lib/characterLoras";
import { parseSunnyBanksCharacterCard, resolveSpeakBeatCharacter } from "@/lib/sunnyBanksVoices";
import { parseStudioGenre, studioGenreProfile, studioPlateEngine, type PlateEngine, type StudioGenreProfile } from "@/lib/studioGenre";
import type { SunnyBanksShotCastMember } from "@/lib/sunnyBanksShotCast";
import type { SunnyBanksCharacterLock } from "@/lib/sunnyBanks";
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
import { renderSilentShotVideo, SILENT_SHOT_PROMPT_SUFFIX } from "@/lib/silentShotVideo";
import {
  parseRowVideoBackend,
  pickRowVideoBackend,
  stripVideoBackendTags,
  type RowVideoBackend,
} from "@/lib/videoBackendRouting";

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
 * the location with xAI edits (Image 1 = empty place, Image 2 = the
 * character). `src/lib/ltxCloudIa2v.ts` then patches that composed
 * `plateFile` onto node `269` only. This route now does both steps:
 * `startImageDataUrl` is the location canvas, `characterCard.pictureUrl`
 * (the Cast card main picture, 2026-10-01) is the overlay, the composed
 * still is what Comfy LoadImage gets.
 *
 * **Cast card pictures only (2026-10-01, Stuart)** — the overlay is
 * only ever the character's Cast card main picture, sent by the panel
 * and fetched from Deck's Blob. No built-in or repo picture exists any
 * more (EP02 Act I row 16: the old repo Dazza hero, holding a rocket
 * launcher, went into a Grok hold). A character row with no Cast card
 * picture is refused with `missing_cast_picture` before anything is
 * billed, never rendered on the bare location. A silent hold's
 * `[Action:]` text now also reaches the start still's prompt.
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
 * **No settle lead-in — the clip opens already in the new state
 * (2026-09-18).** PR #142 shipped `SUNNY_BANKS_SETTLE_LEAD_SEC` (1.5s)
 * of silence prepended to a Speak beat carrying an
 * `appearanceModifier`, plus a prompt sentence telling LTX to hold the
 * newly-staged pose before talking. Stuart dropped it on sight the same
 * day: now that the appearance change is baked into the composed plate
 * above, frame 0 is *already* the new action place, so there is nothing
 * to settle into — the beat should go straight there and start talking.
 * A Speak beat's duration and driving audio are exactly what ElevenLabs
 * returned. The `padMp3ToMinimumDurationSec` tail below is a different
 * thing and stays: that is LTX's hard 2s audio-input minimum, not a
 * deliberate pause. Don't reintroduce a lead-in without him asking.
 *
 * **Real per-beat pathname/shelf, resume-on-failure, last-frame
 * chaining between beats — all deliberately out of scope for this
 * route.** Every one of those is real, working infrastructure this app
 * already has (`lib/clipRenderBlob.ts`, `lib/scriptSequenceRunner.ts`,
 * `lib/serverVideoFrame.ts`) and Sunny Banks will reuse once there's a
 * real episode/beat model to hang it off.
 *
 * **Silent rows on Grok or H3 (2026-09-30)** — a Hold (a character
 * hold or a Crowd cutaway) now renders on the engine in `videoBackend`:
 * `"grok"` (Grok Imagine video 1.5 at 720p, the default the panel
 * sends), `"h3"` (MiniMax H3 at 768P) or `"ltx"` (this route's original
 * LTX path). Same start still (the composite, or the location for a
 * cutaway), same 5s, same `mediaTarget` file naming. Grok and H3 make
 * their own soundtrack and xAI has no switch to turn it off, so the 5s
 * silent MP3 is muxed over it and the saved clip is silent. A Speak
 * beat always uses LTX, whatever `videoBackend` says. Omitted means
 * LTX, so an older caller keeps the old behaviour.
 *
 * **Make plate first, and Shorts (2026-10-04)** — `plateOnly: true` makes
 * just the row's start picture (the same plate a render would make, on
 * the same engine), saves it and answers `{ plateUrl }`: no voice, no
 * video. A later render sends it back as `plateUrl` and uses it as it is,
 * so what you looked at is what gets animated. A row that never had a
 * plate made renders exactly as before. Shorts plates on Siray Seedream
 * by default (`plateEngine`, or Grok), and its silent rows may render on
 * Siray: submit answers 202 `{ pending, sirayTaskId }` straight away and
 * the panel checks back with `sirayTaskId` (never one long call).
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

/** Grok and H3 are given whatever is left of Vercel's 300s, less a
 * margin for the download, mux and Blob save, up to the same 240s the
 * LTX poll gets. */
const SILENT_SHOT_BUDGET_MS = 270_000;
const SILENT_SHOT_MIN_DEADLINE_MS = 30_000;

/** A voice test's line is one short sentence ("G'day, it's Hans."). */
const VOICE_TEST_MAX_CHARS = 120;

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
   * is `startImageDataUrl` (Image 1). The Cast card picture in
   * `characterCard` is Image 2. LTX still has one LoadImage. */
  locationId?: unknown;
  /** The location's name (2026-09-30), for a location saved on the
   * Locations row rather than a built-in. Prompt text only. */
  locationLabel?: unknown;
  /** The location's picture: a built-in's repo file or a Deck Blob URL.
   * Only read when `startImageDataUrl` is missing (the panel always
   * sends that); never any other host. */
  locationImage?: unknown;
  /** Extra LTX prompt context from `[Action: text]`. Appended after
   * gold Hold/Speak strings. On a character hold it also goes into the
   * start still's prompt (2026-10-01). Never sent to ElevenLabs. */
  action?: unknown;
  /** Prop/outfit text from `[Character Name: description]` — the
   * client already sends this as its own field (folded into `action`
   * too, for the motion prompt), but until 2026-09-18 nothing here
   * read it. Now: (1) fed into the xAI compositing prompt itself so
   * the STARTING FRAME already shows it, not just LTX's later motion
   * text — see `compositeSunnyBanksCharacterOntoLocation`'s doc
   * comment for why that's the actual fix for the class of bug where a
   * described prop morphed/duplicated mid-clip. It does NOT change this
   * beat's timing: see the no-settle note in this module's doc comment.
   */
  appearanceModifier?: unknown;
  /** Optional `{ folder, name }` in the readable tree, e.g.
   * `deck/sunnybank/episodes/<episode>/act-i` +
   * `<episode>-act-i-beat-03-shazza-speak` (`lib/deckMediaPaths.ts`'s
   * `sunnybankBeatTarget`). Missing → the old `sunnybanks/…-beats/` path. */
  mediaTarget?: unknown;
  /** The character card's ElevenLabs voice id (2026-09-30,
   * `lib/sunnyBanksVoices.ts`). Wins over a built-in's own voice; the
   * only voice a character added on the Sunnybank bar (or Hans) has. */
  voiceId?: unknown;
  /** `{ name, look, pictureUrl }`: the character's Cast card main
   * picture (Deck's own Blob only), for every character (2026-10-01).
   * Name and look matter only for a character added with "+"; a
   * built-in keeps its locked look. */
  characterCard?: unknown;
  /** `"ltx"` | `"grok"` | `"h3"` (2026-09-30). Holds only; a Speak beat
   * always renders on LTX. Missing or unknown → LTX. */
  videoBackend?: unknown;
  /** Multi-cast shots (2026-10-03): `[{ name, look, pictureUrl, position,
   * shotLook }]`, two to four people, the row's character first. Absent
   * (every one-person row) = the request and render are exactly as
   * before. See `lib/sunnyBanksShotCast.ts`. */
  cast?: unknown;
  /** The scene's `[Action: …]` on a later line of a two-hander: shapes
   * the shared picture, never this line's motion text. */
  sceneAction?: unknown;
  /** Everyone who talks in this scene (framing of the shared picture). */
  sceneSpeakers?: unknown;
  /** The scene's shared picture an earlier line made (Deck Blob only):
   * reused as this line's start picture, so the two-hander matches and
   * xAI isn't paid twice. */
  scenePlateUrl?: unknown;
  /** Where a newly made shared picture goes in the Blob tree
   * (`sunnybankPlateTarget`). */
  plateTarget?: unknown;
  /** `true` = the location's picture already has the people in it (the
   * Locations row's tick): used as the start picture as it is. */
  locationHasPeople?: unknown;
  /** Which show (2026-10-04): `"skidmarks"` uses the Skidmarks Cast,
   * look and folders (`lib/studioGenre.ts`). Missing or anything else is
   * Sunny Banks, exactly as before. */
  genre?: unknown;
  /** `true` = make and save only the row's plate (2026-10-04). */
  plateOnly?: unknown;
  /** The row's own plate made earlier (Deck Blob only): used as it is. */
  plateUrl?: unknown;
  /** `"siray"` | `"grok"`: Shorts' plate switch. Other shows: Grok. */
  plateEngine?: unknown;
  /** A Siray silent shot submitted by an earlier call, to check back on. */
  sirayTaskId?: unknown;
}

const SIRAY_TASK_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

/** `kind: "voice-test"` — the ▶ on a character's panel: speak one short
 * line with a voice id and hand back the audio. ElevenLabs only: no
 * picture, no Comfy, no Blob. Same `synthesizeSunnyBanksLine` as a real
 * Speak beat, so the ▶ hears the same model (Eleven v3, v2 fallback). */
async function voiceTest(body: GenerateSpeakBeatRequestBody) {
  const voiceId = normalizeElevenLabsVoiceId(body.voiceId);
  const line = typeof body.line === "string" ? body.line.replace(/\s+/g, " ").trim().slice(0, VOICE_TEST_MAX_CHARS) : "";
  if (!voiceId || !line) {
    return NextResponse.json({ error: "A voice id and a short line are both needed.", code: "invalid_request" }, { status: 400 });
  }
  const speech = await synthesizeSunnyBanksLine(voiceId, line);
  if (!speech.ok) {
    return NextResponse.json(
      { error: speech.message, code: speech.unconfigured ? "missing_api_key" : "upstream_error" },
      { status: speech.unconfigured ? 501 : 502 }
    );
  }
  return NextResponse.json({
    audioDataUrl: `data:${speech.contentType};base64,${Buffer.from(speech.bytes).toString("base64")}`,
    ttsModel: speech.modelId,
  });
}

function parseBeatKind(value: unknown): BeatKind {
  return value === "hold" ? "hold" : "speak";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: GenerateSpeakBeatRequestBody;
  try {
    body = (await request.json()) as GenerateSpeakBeatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body.", code: "invalid_request" }, { status: 400 });
  }

  if (body.kind === "voice-test") return voiceTest(body);
  // A page opened before the last update sends the old request: refuse it
  // before anything is billed (`lib/deckBuild.ts`, EP05 Act V 2026-10-03).
  const stalePage = staleDeckPageResponse(request);
  if (stalePage) return stalePage;

  const kind = parseBeatKind(body.kind);
  const profile = studioGenreProfile(parseStudioGenre(body.genre));
  const characterName = typeof body.characterName === "string" ? body.characterName.trim() : "";
  // A `[GROK]` / `[LTX]` / `[H3]` tag never reaches ElevenLabs. The
  // panel already strips it; this is the belt to that.
  const line = typeof body.line === "string" ? stripVideoBackendTags(body.line).trim() : "";
  const locationId = typeof body.locationId === "string" ? body.locationId.trim() : "";
  const locationLabel = typeof body.locationLabel === "string" ? body.locationLabel.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const startImageDataUrl = await resolveBeatStartImage(body.startImageDataUrl, body.locationImage);
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

  const cardVoiceId = normalizeElevenLabsVoiceId(body.voiceId);
  const character = resolveSpeakBeatCharacter(
    characterName,
    parseSunnyBanksCharacterCard(body.characterCard),
    cardVoiceId,
    profile.genre
  );
  const isLocationCutaway = kind === "hold" && !character;
  // Multi-cast (2026-10-03): only for a character row, never a cutaway.
  const cast = character ? parseSunnyBanksShotCast(body.cast, character.name) : null;
  const locationHasPeople = body.locationHasPeople === true;
  const sceneAction = typeof body.sceneAction === "string" ? body.sceneAction.replace(/\s+/g, " ").trim().slice(0, 1200) : "";
  const sceneSpeakers = parseSunnyBanksSceneSpeakers(body.sceneSpeakers);
  const scenePlateUrl = cast ? parseSunnyBanksPlateUrl(body.scenePlateUrl) : null;
  const plateOnly = body.plateOnly === true;
  /** The row's own plate (2026-10-04); a "Remake plate" makes a new one. */
  const ownPlateUrl = plateOnly ? null : parseSunnyBanksPlateUrl(body.plateUrl);
  const plateEngine = studioPlateEngine(profile.genre, body.plateEngine);
  const sirayTaskId =
    typeof body.sirayTaskId === "string" && SIRAY_TASK_ID_RE.test(body.sirayTaskId.trim()) ? body.sirayTaskId.trim() : "";
  /** Sent back with every answer once a shared picture exists, so the row keeps it even when the video fails. */
  const responseExtras: Record<string, unknown> = cast ? { castNames: cast.map((m) => m.name) } : {};
  const cutawayLabel = characterName || "Crowd";
  if (kind === "speak" && !character) {
    return NextResponse.json(
      { error: `"${characterName}" isn't a locked ${profile.showName} character.`, code: "unknown_character" },
      { status: 400 }
    );
  }
  // The card's voice wins over the built-in one (Hans has only a card voice).
  const voiceId = cardVoiceId ?? character?.voiceId;
  if (kind === "speak" && !voiceId && !plateOnly) {
    return NextResponse.json(
      { error: missingVoiceMessage(character!.name), code: "missing_voice" },
      { status: 400 }
    );
  }
  // Every character shot needs its Cast card picture: refuse before
  // anything is billed, never fall back to the bare location. A location
  // that already has the people in it needs none (2026-10-03). A
  // multi-cast shot needs everyone's, unless it reuses its scene's
  // shared picture.
  if (character && !locationHasPeople && !cast && !ownPlateUrl && !resolveSunnyBanksStartImage(character)) {
    return NextResponse.json(
      { error: missingCastPictureMessage(character.name), code: "missing_cast_picture" },
      { status: 400 }
    );
  }
  const castMissing =
    cast && !locationHasPeople && !scenePlateUrl && !ownPlateUrl ? cast.find((m) => !m.pictureUrl) : undefined;
  if (castMissing) {
    return NextResponse.json(
      { error: missingCastPictureMessage(castMissing.name), code: "missing_cast_picture", ...responseExtras },
      { status: 400 }
    );
  }

  // Make plate first (2026-10-04): the same plate a render would make, saved, nothing else.
  if (plateOnly) {
    if (isLocationCutaway || locationHasPeople) {
      return NextResponse.json(
        {
          error: isLocationCutaway
            ? "Nobody from the Cast is in this shot, so it uses the location's picture: there's no plate to make."
            : "This location's picture already has the people in it, so there's no plate to make.",
          code: "no_plate_needed",
        },
        { status: 400 }
      );
    }
    const plated = await makeRowPlate({
      kind,
      character: character!,
      cast,
      startImageDataUrl,
      locationId,
      locationLabel,
      action,
      appearanceModifier,
      sceneAction,
      sceneSpeakers,
      profile,
      engine: plateEngine,
    });
    if (!plated.ok) {
      // `plateFailed`: the panel says plainly no clip was made or billed (2026-10-04).
      return NextResponse.json({ error: plated.error, code: plated.code, plateFailed: true, ...responseExtras }, { status: plated.status });
    }
    const savedUrl = await saveSharedPlate(
      plated.dataUrl,
      cast ? cast.map((m) => m.name) : [character!.name],
      parseDeckMediaTarget(body.plateTarget),
      profile
    );
    if (!savedUrl) {
      return NextResponse.json(
        { error: "The plate was made but couldn't be saved, so it can't be used yet. Try again.", code: "plate_not_saved", ...responseExtras },
        { status: 502 }
      );
    }
    return NextResponse.json({ plateUrl: savedUrl, plateEngine, ...responseExtras });
  }

  // Talking beats stay on LTX; a hold uses the engine the panel chose.
  // Siray is offered by Shorts only (`profile.silentBackends`).
  const requestedBackend = parseRowVideoBackend(body.videoBackend);
  if (kind === "hold" && requestedBackend === "siray" && !profile.silentBackends.includes("siray")) {
    return NextResponse.json(
      { error: `${profile.showName}'s silent shots render on Grok, H3 or LTX, not Siray.`, code: "invalid_request" },
      { status: 400 }
    );
  }
  const videoBackend: RowVideoBackend =
    kind === "hold"
      ? pickRowVideoBackend({ kind, override: requestedBackend ?? "ltx", silentOffered: profile.silentBackends }).backend
      : "ltx";

  const creds = videoBackend === "ltx" ? resolveComfyCloudCredentials() : null;
  if (videoBackend === "ltx" && !creds) {
    return NextResponse.json(
      {
        error:
          `COMFY_CLOUD_API_KEY is not set on the server — ${profile.showName} rendering (Comfy Cloud LTX) is ` +
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
  /** Which ElevenLabs model spoke (Speak only): `eleven_v3`, or
   * `eleven_multilingual_v2` when v3 refused and the tags were dropped. */
  let ttsModel: string | undefined;

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
      ? buildLocationCutawayPrompt(action, profile)
      : // With an [Action:], the action sets framing and movement (2026-10-01).
        buildSunnyBanksHoldPrompt(character!, action, profile.look);
    // Others in frame (2026-10-03): everyone animates, every mouth closed.
    if (cast) prompt = `${prompt} ${buildSunnyBanksMultiCastHoldSuffix(cast)}`;
  } else {
    if (!voiceId) {
      return NextResponse.json(
        { error: missingVoiceMessage(character!.name), code: "missing_voice" },
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
    ttsModel = speechOutcome.modelId;
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
    // No settle lead-in: the composed plate above already shows the
    // appearance change on frame 0, so the beat goes straight to the
    // new action place and starts talking. Duration is the real audio.
    durationSec = Math.min(MAX_LTX_CLIP_DURATION_SEC, paddedDurationSec);
    // `line` went to ElevenLabs with its audio tags (`[whispers]`,
    // `[pause]`, …) intact — Eleven v3 performs them. The picture prompt
    // quotes only the words: the tag's delivery is already in the audio
    // LTX lip-syncs to, and a quoted "[whispers]" is just noise to it.
    // A tag-only line ("[laughs]") keeps its text so the quote isn't empty.
    prompt = buildSunnyBanksSpeakingPrompt(character!, stripElevenLabsAudioTags(line) || line, profile.look);
    // Others in frame (2026-10-03, Stuart's wording): the speaker is the
    // only one talking, everyone else listens with their mouth closed.
    if (cast) prompt = `${prompt} ${buildSunnyBanksSpeakerListenerSuffix(cast, character!.name)}`;
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

  // Checking back on a Siray silent shot (2026-10-04): it was submitted
  // with its plate already, so nothing is made or billed again.
  if (videoBackend === "siray" && sirayTaskId) {
    return runSilentShotAndPersist({
      responseExtras,
      backend: "siray",
      characterName: character?.name ?? cutawayLabel,
      prompt: "",
      durationSec,
      silentAudioBytes: audioBytes,
      startImageDataUrl: "",
      mediaTarget: parseDeckMediaTarget(body.mediaTarget),
      profile,
      deadlineMs: SILENT_SHOT_MIN_DEADLINE_MS,
      sirayTaskId,
    });
  }

  let plateDataUrl = startImageDataUrl;
  // A plate made earlier (the row's own, 2026-10-04, or the scene's shared one): used as it is.
  const reuseUrl = isLocationCutaway || locationHasPeople ? null : (ownPlateUrl ?? scenePlateUrl);
  const reused = reuseUrl ? await readSunnyBanksBlobPictureDataUrl(reuseUrl) : null;
  if (!isLocationCutaway && locationHasPeople) {
    // The location picture already has the people in it: used as it is.
  } else if (reused) {
    plateDataUrl = reused;
    responseExtras.plateUrl = reuseUrl;
  } else if (!isLocationCutaway) {
    const plated = await makeRowPlate({
      kind,
      character: character!,
      cast,
      startImageDataUrl,
      locationId,
      locationLabel,
      action,
      appearanceModifier,
      sceneAction,
      sceneSpeakers,
      profile,
      engine: plateEngine,
    });
    if (!plated.ok) {
      // `plateFailed`: the panel says plainly no clip was made or billed (2026-10-04).
      return NextResponse.json({ error: plated.error, code: plated.code, plateFailed: true, ...responseExtras }, { status: plated.status });
    }
    plateDataUrl = plated.dataUrl;
    // A multi-cast scene's shared picture is saved so its next line reuses it.
    if (cast) {
      const savedUrl = await saveSharedPlate(
        plated.dataUrl,
        cast.map((m) => m.name),
        parseDeckMediaTarget(body.plateTarget),
        profile
      );
      if (savedUrl) responseExtras.plateUrl = savedUrl;
    }
  }

  if (videoBackend !== "ltx") {
    return runSilentShotAndPersist({
      responseExtras,
      backend: videoBackend,
      characterName: character?.name ?? cutawayLabel,
      prompt: `${prompt} ${SILENT_SHOT_PROMPT_SUFFIX}`,
      durationSec,
      silentAudioBytes: audioBytes,
      startImageDataUrl: plateDataUrl,
      mediaTarget: parseDeckMediaTarget(body.mediaTarget),
      profile,
      deadlineMs: Math.min(
        SPEAK_BEAT_POLL_DEADLINE_MS,
        Math.max(SILENT_SHOT_MIN_DEADLINE_MS, SILENT_SHOT_BUDGET_MS - (Date.now() - startedAt))
      ),
    });
  }

  return runLtxAndPersist({
    responseExtras,
    characterName: character?.name ?? cutawayLabel,
    kind,
    prompt,
    durationSec,
    audioBytes,
    audioContentType,
    startImageDataUrl: plateDataUrl,
    creds: creds!,
    mediaTarget: parseDeckMediaTarget(body.mediaTarget),
    profile,
    ttsModel,
  });
}

/**
 * The row's start picture (one person or a multi-cast scene) on the
 * show's plate engine: the one place both a render and "Make plate"
 * make it, so the two can never differ.
 */
async function makeRowPlate(args: {
  kind: BeatKind;
  character: SunnyBanksCharacterLock;
  cast: SunnyBanksShotCastMember[] | null;
  startImageDataUrl: string;
  locationId: string;
  locationLabel: string;
  action: string;
  appearanceModifier: string;
  sceneAction: string;
  sceneSpeakers: string[];
  profile: StudioGenreProfile;
  engine: PlateEngine;
}): Promise<{ ok: true; dataUrl: string } | { ok: false; status: number; code: string; error: string }> {
  if (args.cast) {
    const lateMissing = args.cast.find((m) => !m.pictureUrl);
    if (lateMissing) return { ok: false, status: 400, code: "missing_cast_picture", error: missingCastPictureMessage(lateMissing.name) };
    return compositeSunnyBanksCastOntoLocation({
      locationDataUrl: args.startImageDataUrl,
      people: args.cast,
      locationId: args.locationId,
      locationLabel: args.locationLabel || undefined,
      speaker: args.kind === "speak" ? args.character.name : null,
      sceneSpeakers: args.sceneSpeakers,
      shotAction: args.action || args.sceneAction || undefined,
      genre: args.profile.genre,
      engine: args.engine,
      talking: args.kind === "speak" || args.sceneSpeakers.length > 0,
    });
  }
  return compositeSunnyBanksCharacterOntoLocation({
    locationDataUrl: args.startImageDataUrl,
    character: args.character,
    locationId: args.locationId,
    locationLabel: args.locationLabel || undefined,
    appearanceOverride: args.appearanceModifier || undefined,
    // A silent hold's [Action:] shapes its start still too (2026-10-01).
    shotAction: args.kind === "hold" ? args.action || undefined : undefined,
    genre: args.profile.genre,
    engine: args.engine,
    talking: args.kind === "speak",
  });
}

/** A hold on Grok, H3 or Siray: render, replace the engine's own sound with the
 * 5s silent track, save under the same name an LTX hold would get. */
async function runSilentShotAndPersist(args: {
  responseExtras: Record<string, unknown>;
  backend: Exclude<RowVideoBackend, "ltx">;
  characterName: string;
  prompt: string;
  durationSec: number;
  silentAudioBytes: Uint8Array;
  startImageDataUrl: string;
  mediaTarget: DeckMediaTarget | null;
  profile: StudioGenreProfile;
  deadlineMs: number;
  /** Siray: the task an earlier call submitted. */
  sirayTaskId?: string;
}) {
  const rendered = await renderSilentShotVideo({
    backend: args.backend,
    prompt: args.prompt,
    startImageDataUrl: args.startImageDataUrl,
    durationSec: args.durationSec,
    deadlineMs: args.deadlineMs,
    sirayTaskId: args.sirayTaskId,
  });
  if (!rendered.ok && rendered.code === "siray_pending" && rendered.sirayTaskId) {
    return NextResponse.json(
      { pending: true, sirayTaskId: rendered.sirayTaskId, code: "siray_pending", videoBackend: "siray", ...args.responseExtras },
      { status: 202 }
    );
  }
  if (!rendered.ok) {
    return NextResponse.json(
      { error: rendered.error, code: rendered.code, videoBackend: args.backend, ...args.responseExtras },
      { status: rendered.status }
    );
  }
  const muxed = await muxClipAudio(rendered.bytes, args.silentAudioBytes);
  return persistBeatVideo({
    videoBytes: muxed.ok ? muxed.bytes : rendered.bytes,
    muxed,
    characterName: args.characterName,
    kind: "hold",
    durationSec: args.durationSec,
    mediaTarget: args.mediaTarget,
    profile: args.profile,
    videoBackend: args.backend,
    responseExtras: args.responseExtras,
  });
}

function buildLocationCutawayPrompt(action: string, profile: StudioGenreProfile): string {
  const motion = action.replace(/\s+/g, " ").trim() || "Subtle ambient motion. Camera holds, no cuts.";
  const base = `Use the provided start image as the first frame. ${motion} No dialogue.`;
  // Shorts (2026-10-04): its adult and content locks reach every clip.
  return profile.look.cutawayCarriesStyleLock ? `${base} ${profile.look.styleLock}` : base;
}

async function runLtxAndPersist(args: {
  responseExtras: Record<string, unknown>;
  characterName: string;
  kind: BeatKind;
  prompt: string;
  durationSec: number;
  audioBytes: Uint8Array;
  audioContentType: string;
  startImageDataUrl: string;
  creds: NonNullable<ReturnType<typeof resolveComfyCloudCredentials>>;
  mediaTarget: DeckMediaTarget | null;
  profile: StudioGenreProfile;
  ttsModel?: string;
}) {
  const decodedImage = decodeDataUrl(args.startImageDataUrl);
  if (!decodedImage) {
    return NextResponse.json(
      { error: "Could not decode startImageDataUrl.", code: "invalid_request", ...args.responseExtras },
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
    return NextResponse.json({ error: imageUpload.error, code: imageUpload.code, ...args.responseExtras }, { status: imageUpload.status });
  }

  const audioUpload = await uploadComfyCloudInput(
    args.audioBytes,
    args.kind === "hold" ? `sunnybanks-hold-${Date.now()}.mp3` : `sunnybanks-line-${Date.now()}.mp3`,
    args.audioContentType,
    args.creds
  );
  if (!audioUpload.ok) {
    return NextResponse.json({ error: audioUpload.error, code: audioUpload.code, ...args.responseExtras }, { status: audioUpload.status });
  }

  const workflow = buildLtx23Ia2vWorkflow({
    imageFilename: imageUpload.name,
    audioFilename: audioUpload.name,
    prompt: args.prompt,
    durationSec: args.durationSec,
  });

  const submitResult = await submitComfyCloudWorkflow(workflow, args.creds);
  if (!submitResult.ok) {
    return NextResponse.json({ error: submitResult.error, code: submitResult.code, ...args.responseExtras }, { status: submitResult.status });
  }

  const completionResult = await pollComfyCloudJob(submitResult.promptId, args.creds, SPEAK_BEAT_POLL_DEADLINE_MS);
  if (!completionResult.ok) {
    return NextResponse.json(
      { error: completionResult.error, code: completionResult.code, ...args.responseExtras },
      { status: completionResult.status }
    );
  }

  const downloadResult = await downloadComfyCloudOutput(completionResult.videoFile, args.creds);
  if (!downloadResult.ok) {
    return NextResponse.json({ error: downloadResult.error, code: downloadResult.code, ...args.responseExtras }, { status: downloadResult.status });
  }

  // Bake the same MP3 LoadAudio already used (padded TTS or Hold
  // silence) into the MP4. LTX SaveVideo does not reliably keep that
  // track — live QA: lips moved, no sound. A failed mux still returns
  // the paid picture.
  const muxed = await muxClipAudio(downloadResult.bytes, args.audioBytes);
  return persistBeatVideo({
    videoBytes: muxed.ok ? muxed.bytes : downloadResult.bytes,
    muxed,
    characterName: args.characterName,
    kind: args.kind,
    durationSec: args.durationSec,
    mediaTarget: args.mediaTarget,
    profile: args.profile,
    ttsModel: args.ttsModel,
    videoBackend: "ltx",
    responseExtras: args.responseExtras,
  });
}

/** Saves a finished beat (`mediaTarget` naming, or the old timestamped
 * path) and answers the panel. Same "never throw away a render Stuart
 * already paid for" rule as every other backend in this app — a Blob
 * failure still returns the real bytes as a data: URL, honestly flagged
 * as not saved. `audioMuxed: false` is the honest flag for a mux miss. */
async function persistBeatVideo(args: {
  videoBytes: Uint8Array;
  muxed: { ok: true } | { ok: false; message: string };
  characterName: string;
  kind: BeatKind;
  durationSec: number;
  mediaTarget: DeckMediaTarget | null;
  /** The show: its old flat folder for a clip with no episode folder yet. */
  profile: StudioGenreProfile;
  ttsModel?: string;
  videoBackend: RowVideoBackend;
  /** `castNames` / `plateUrl` of a multi-cast shot (2026-10-03). */
  responseExtras?: Record<string, unknown>;
}) {
  const { videoBytes, muxed } = args;
  const audioMuxed = muxed.ok;
  const pathname =
    args.kind === "hold"
      ? buildSunnyBanksHoldBeatPathname(args.characterName, Date.now(), args.profile.legacyBlobPrefix)
      : buildSunnyBanksSpeakBeatPathname(args.characterName, Date.now(), args.profile.legacyBlobPrefix);
  const common = {
    durationSec: args.durationSec,
    character: args.characterName,
    kind: args.kind,
    videoBackend: args.videoBackend,
    audioMuxed,
    ...(muxed.ok ? {} : { audioMuxError: muxed.message }),
    ...(args.ttsModel ? { ttsModel: args.ttsModel } : {}),
    ...(args.responseExtras ?? {}),
  };
  try {
    const blob = await putDeckMediaOrLegacy(Buffer.from(videoBytes), {
      target: args.mediaTarget,
      ext: "mp4",
      contentType: "video/mp4",
      legacyPathname: pathname,
    });
    return NextResponse.json({ videoUrl: blob.url, persisted: true, ...common });
  } catch (err) {
    return NextResponse.json({
      videoUrl: `data:video/mp4;base64,${Buffer.from(videoBytes).toString("base64")}`,
      persisted: false,
      persistError: err instanceof Error ? err.message : "Vercel Blob upload failed for an unknown reason.",
      ...common,
    });
  }
}

/**
 * Saves a multi-cast shot's shared picture (2026-10-03) under its
 * readable name (`…-beat-03-stuie-bloom-plate`), or the old flat
 * `sunnybanks/plates/` folder when the episode has no folder name yet.
 * A Blob miss never stops the render: the line still uses the picture,
 * it just can't be reused by the scene's next line.
 */
async function saveSharedPlate(
  dataUrl: string,
  castNames: readonly string[],
  target: DeckMediaTarget | null,
  profile: StudioGenreProfile
): Promise<string | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const ext = extensionForImageContentType(decoded.mimeType);
  const who = castNames.map((n) => deckMediaSlug(n, "")).filter(Boolean).join("-") || "cast";
  try {
    const blob = await putDeckMediaOrLegacy(Buffer.from(decoded.bytes), {
      target,
      ext,
      contentType: decoded.mimeType,
      legacyPathname: `${profile.legacyBlobPrefix}/plates/${who}-plate-${Date.now()}.${ext}`,
    });
    return blob.url;
  } catch {
    return null;
  }
}
