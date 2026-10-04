"use client";

import { useScriptFormatFeedback } from "@/hooks/useScriptFormatFeedback";
import { useTextareaOverlayMirror } from "@/hooks/useTextareaOverlayMirror";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ESTIMATED_STILL_COST_USD, SIRAY_STILL_COST_USD } from "@/lib/autoPlate";
import { preSendBlocks, preSendChecks, type PreSendIssue } from "@/lib/preSendChecks";
import { triggerBlobDownload } from "@/lib/clipRenders";
import { SkidmarksConfirmDialog } from "@/components/SkidmarksConfirmDialog";
import { TrashIcon } from "@/components/SkidmarksRenderedClipsShelf";
import { EpisodeExtrasRow } from "@/components/EpisodeExtrasRow";
import { episodeExtrasZipEntries, type EpisodeExtra } from "@/lib/episodeExtras";
import { ShotGrid, type ShotTileView } from "@/components/ShotGrid";
import { estimateRowVideoCostUsd } from "@/lib/clipGeneration";
import {
  extractVideoBackendOverride,
  ignoredVideoBackendWarning,
  pickRowVideoBackend,
  rowVideoBackendChip,
  VIDEO_BACKEND_OVERRIDE_TAG_SOURCE,
  videoBackendName,
  videoBackendTagLabel,
  type RowVideoBackend,
} from "@/lib/videoBackendRouting";
import { resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import {
  buildSunnyBanksHoldPrompt,
  buildSunnyBanksSpeakingPrompt,
  missingCastPictureMessage,
  missingVoiceMessage,
  resolveSunnyBanksStartImage,
  SUNNY_BANKS_CAST,
  SUNNY_BANKS_DEFAULT_LOCATION_ID,
  SUNNY_BANKS_HOLD_DURATION_SEC,
  type SunnyBanksLocationId,
  type SunnyBanksLocationLock,
} from "@/lib/sunnyBanks";
import { deckLocationKeyFromName } from "@/lib/deckLocations";
import { findSunnyBanksLocation, studioLocationList, sunnyBanksLocationProblem } from "@/lib/sunnyBanksLocations";
import { runSunnyBanksRenderQueue, sunnyBanksStoppedText } from "@/lib/sunnyBanksRenderQueue";
import { downloadSunnyBanksActZip } from "@/lib/sunnyBanksClipsZip";
import { buildSunnyBanksEpisodeBundle } from "@/lib/sunnyBanksEpisodeBundle";
import { parseCastTagNames, sameShotCastName } from "@/lib/shotCast";
import {
  resolveSunnyBanksSpeaker,
  sunnyBanksCastCards,
  sunnyBanksSpeakerList,
  sunnyBanksSpeakerNames,
  sunnyBanksSpeakerRequestExtras,
} from "@/lib/sunnyBanksVoices";
import { sunnybankBeatTarget, sunnybankPlateTarget, type DeckMediaTarget } from "@/lib/deckMediaPaths";
import { resolveSunnyBanksRowCast, sunnyBanksMultiCastRequest, type SunnyBanksRowCast } from "@/lib/sunnyBanksShotCast";
import { CastChips } from "@/components/CastChips";
import { setSunnyBanksBusy } from "@/lib/sunnyBanksBusy";
import { studioGenreProfile, studioPlateEngine, studioSilentBackend, type PlateEngine, type StudioGenre } from "@/lib/studioGenre";
import {
  buildSunnyBanksGodScriptPrompt,
  listSunnyBanksLocationIds,
  listSunnyBanksNonSpeakingCast,
  listSunnyBanksSpeakingCast,
  SHORTS_GOD_SCRIPT_NOTE,
  SKIDMARKS_GOD_SCRIPT_NOTE,
  SUNNY_BANKS_GOD_SCRIPT_EXAMPLE,
  SUNNY_BANKS_GOD_SCRIPT_RULES,
} from "@/lib/sunnyBanksGodScriptGuide";
import {
  adoptShortsShotCardLive,
  ensureSunnyBanksEpisodeMediaSlug,
  getSkidmarksSnapshot,
  getStudioState,
  getSunnyBanksLiveOrDefault,
  patchSunnyBanksLive,
  setStudioPlateEngine,
  setSunnyBanksSilentShotBackend,
  subscribeSkidmarks,
} from "@/lib/skidmarks";
import {
  cloneActRecord,
  fingerprintWorkspace,
  mintWorkspaceId,
  SUNNY_BANKS_INITIAL_ACTS,
  type SunnyBanksActKeyed,
  type SunnyBanksLiveState,
  type SunnyBanksRowRuntime,
} from "@/lib/sunnyBanksWorkspace";
import { deckBuildHeaders } from "@/lib/deckBuild";
import { shortsShotCardStudioLive } from "@/lib/shortsShotCardStudio";

/**
 * Sunny Banks' own first real screen (2026-09-15) — the thing that
 * actually sits behind the landing tile once it's enabled. Deliberately
 * not the full episode wizard (no Neon episode/beat rows, no last-frame
 * chaining, no `lib/scriptSequenceRunner`). Cast strip + a Script card
 * that stays local React state.
 *
 * **A character only renders once it has a Cast card picture** (and a
 * Speak line also needs a voice id). A row whose character has no Cast
 * card picture shows a red note and Render waits; it is never rendered
 * with a stand-in or on the bare location. A Hold only needs the
 * picture (no TTS).
 *
 * **Cast card pictures only (2026-10-01, Stuart)** — the picture laid
 * onto the location is the character's Cast card main picture
 * (`resolveSunnyBanksSpeaker` → `castPicture`), never a built-in or repo
 * file: those old `*-hero.jpg` / `*-reference.jpg` stills are deleted
 * (EP02 Act I row 16 rendered the old Dazza hero's rocket launcher).
 *
 * **Location canvas as compositor Image 1 (2026-09-17)** — Speak/Hold
 * POST that still as `startImageDataUrl` (empty location, Image 1)
 * plus `locationId` / `locationImage` alongside `characterName`. The
 * speak-beat **route** overlays the Cast card picture as Image 2, then the engine sees
 * only the composed still. This panel does **not** call generate-still
 * itself. Gold Hold/Speak prompt strings are never built here — the
 * route loads the full `SUNNY_BANKS_CAST` record by name and passes
 * that object into `buildSunnyBanksSpeakingPrompt` /
 * `buildSunnyBanksHoldPrompt`.
 *
 * **Script block → sequential queue (2026-09-17)** — the old single
 * "Try one line" textarea is a spacious script block. Newlines become
 * queue rows (parser lives in this file, not a persisted schema).
 * One primary Render control walks the queue with the existing
 * `runningKind` lock: one POST at a time, stop on first failure.
 * Explicit product ask for this panel; not music-video whole-song
 * auto-render, not parallel fan-out.
 *
 * **Dense queue + Act pills + in-memory workspace shelf (2026-09-17)** —
 * queue rows are one spreadsheet-style line (not stacked cards) so a
 * phone isn't a tall scroll of identical containers. Act I/II/III
 * pills sit at the top of the Script card in one horizontal
 * `touch-pan-x touch-pan-y` strip. The strip opens on Act I/II/III (EP02 seed)
 * and **+ Add Act** appends the next roman bucket (IV, V, …) with an
 * empty script buffer — still not a Neon act table. Save and the episode zip walk `actIds` in order so
 * a typed Act IV is not dropped. The textarea and
 * queued rows collapse behind "Show Script Text & Queued Lines"
 * (default closed) so a 46-line EP02 paste doesn't bury the Clips
 * strip. `# EPISODE:`, `=== ACT`, `[Location: id]`, `[Action: text]`,
 * and `[Character Name: look]` in a pasted God Script update the
 * episode name, act buffers, park plate (`startImageDataUrl` at
 * render), prompt suffix, and per-row `appearanceModifier`. The bottom
 * shelf snapshots those buffers + location ids + finished clip URLs as
 * a named workspace card on the existing Neon session row (one card per
 * episode name covering every act). A red ✕ drops that named card only
 * — not the live working copy. **Download Episode Bundle** zips `data/script.txt`, the gold
 * Speak/Hold prompt array, clip URL records, and best-effort MP4/MP3
 * bytes under `video/` and `audio/` (`lib/sunnyBanksEpisodeBundle.ts`).
 * No `localStorage`, no new episode/beat table — the existing Neon
 * session row holds live + named cards. Sunny Banks has no
 * song MP3; driving audio is TTS at render time.
 *
 * **iPhone Safari vertical scroll (2026-09-17)** — the script wrapper
 * uses `touch-pan-y overscroll-y-contain` so a thumb on the textarea
 * or a queue row pans the page instead of freezing inside a nested
 * scroller. Queue rows do **not** scroll horizontally. `touch-action:
 * pan-y` so a thumb still pages the sheet.
 *
 * **Done rows are static (2026-09-17, live QA)** — once a line is
 * `status === "done"`, character and location `<select>`s go away
 * (the clip is already billed; swapping Shazza or the park plate
 * would lie). Spoken text sits under the name in a native
 * `<details>` disclosure. The empty 40px black preview cube is gone
 * — finished MP4s live in the Clips shelf, not in the spreadsheet.
 * Idle/failed rows still have the character + location picks.
 *
 * **Done clips survive a re-parse (2026-09-17, live QA)** —
 * `preserveRenderedRuntimes` rebinds an in-memory `status === "done"`
 * row onto the freshly parsed queue when speaker + dialogue still
 * match, instead of idling it because the index or `lineKey` moved
 * (a `[Location:]` prepend, a pasted God Script). **↩ Undo** beside
 * the Act pills restores the previous script buffers so the queue
 * recompiles to the last clean arrangement. Tag-only
 * `[Character Name: override]` / `[Location:]` / `[Action:]` lines
 * never mint their own Idle rows — they only stamp the next speaker.
 * Empty `Crowd:` is a location Hold cutaway (park plate + `[Action:]`,
 * no CAST overlay), so it can sit Idle while seed Speaks stay Done and
 * Render reads "Render 1 line" instead of "Clips already loaded".
 * **+ on a queue row inserts a silent Hold under that clip** (same
 * speaker, same plate) so a shot can land between two already-Done
 * rows without re-pasting the God Script. Idle rows can type the
 * spoken line in place. Undo restores the previous buffers. − on an
 * Idle/failed row drops that shot (accidental +) without touching Done
 * clips.
 *
 * **Clips live in one Act-grouped strip (2026-09-17, live QA)** —
 * finished MP4s sit in one `overflow-x-auto` row at the base of the
 * working panel (after the script, before the Episode workspace,
 * same reading order as music-video rendered clips then archive),
 * same card size and `touch-pan-x touch-pan-y` as `SkidmarksRenderedClipsShelf`
 * (`w-44` / `h-28`, inline controls), sectioned Act I / II / III.
 * Workspace save writes the whole live episode (every act, not the
 * open Act pill) onto the existing Neon session row. Same episode
 * name replaces that card. Live working copy persists beside the
 * shelf so a refresh or a closed sheet does not reseed EP02. ✕
 * drops that named card only.
 *
 * **EP02 Drop Bears seed (2026-09-17)** — the panel opens on Crash Lab
 * job `mgen_20260827092841004_ea9` (46 already-rendered Speak clips)
 * so the Clips strip can be judged with real MP4s unless Neon already
 * has a live Sunny Banks copy. No re-render, no Crash Lab chrome, no
 * new Neon table. Playback hits skidmarks.aiglitch.app while that host
 * stays ungated.
 *
 * **EPISODES cards replace the bottom shelf (2026-09-30, Stuart)** —
 * the "+ New Episode" button, Episode name field, Save Episode,
 * Download Episode (.zip) and the "Episode workspace" list that used to
 * sit under the Clips strip are gone. Each episode is a card in the
 * EPISODES row at the top (`SunnyBanksEpisodeRow`), with a pencil
 * (open in the editor), a download icon (the same zip,
 * `downloadSunnyBanksEpisodeZip`) and a bin (delete, tap twice). The
 * dotted + card starts a new episode. There is no Save button any more:
 * every change is saved onto the open episode's card as it happens
 * (`patchSunnyBanksLive` in `lib/skidmarks.ts`). The episode's name
 * comes from a `# EPISODE:` header in the script, else its first line.
 * Some of the notes above still mention the old shelf; they are kept
 * as history.
 */

const CAST_LIST = Object.values(SUNNY_BANKS_CAST);

/**
 * Which show the script helpers below read (2026-10-04: Skidmarks has
 * exactly this structure). The script parser, the tag colours and the
 * formatter need the show's cast and locations, and they are called
 * from many places, so they read the show that is open on screen (the
 * session's project, which is also what picks this panel) and
 * `inStudioGenre` can name one for code that runs on its own (a save,
 * an episode zip, a test). Sunny Banks unless it is Skidmarks: every
 * Sunny Banks call reads exactly what it always did.
 */
let genreOverride: StudioGenre | null = null;

function helperGenre(): StudioGenre {
  if (genreOverride) return genreOverride;
  const kind = getSkidmarksSnapshot().session?.projectKind;
  // Shorts' script studio (2026-10-04) is on the Shorts project.
  return kind === "skidmarks" ? "skidmarks" : kind === "adult-shorts" ? "shorts" : "sunnybank";
}

/** Runs `fn` with the script helpers reading `genre`'s cast and locations. */
export function inStudioGenre<T>(genre: StudioGenre, fn: () => T): T {
  const previous = genreOverride;
  genreOverride = genre;
  try {
    return fn();
  } finally {
    genreOverride = previous;
  }
}

/** The character a `Name:` line means, with the voice from their card
 * when one is saved (`lib/sunnyBanksVoices.ts`, 2026-09-30). */
function speakerLock(name: string) {
  return resolveSunnyBanksSpeaker(name, getSkidmarksSnapshot(), helperGenre());
}

/** Longest name first so "Ranger Bazza" / "Unit 4S" win over a
 * shorter prefix. Keys of `SUNNY_BANKS_CAST`, not a parallel array. */
function speakerNames(): string[] {
  // Built-in cast plus characters added with "+" (Skidmarks: the
  // Skidmarks Cast). Since 2026-10-04 a card with no voice counts too:
  // its `Name:` row with nothing after the colon is its silent shot.
  return sunnyBanksSpeakerNames(getSkidmarksSnapshot(), helperGenre());
}

type BeatKind = "speak" | "hold";
export type SunnyBanksChunkKind = BeatKind | "scene";

type RowStatus = SunnyBanksRowRuntime["status"];

/** Seed default — EP02 opens on these three. Extra acts are roman
 * IDs appended in memory (`nextSunnyBanksActId`), not a schema. */
export { SUNNY_BANKS_INITIAL_ACTS, fingerprintWorkspace, mintWorkspaceId };
export const SUNNY_BANKS_ACTS = SUNNY_BANKS_INITIAL_ACTS;
export type SunnyBanksActId = string;

/** Phone-row ceiling so a mashed + cannot spawn an unbounded pill
 * strip. 20 is XX; past that the button disables. */
export const MAX_SUNNY_BANKS_ACTS = 20;

const ROMAN_VALUES: ReadonlyArray<readonly [number, string]> = [
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function toSunnyBanksActId(indexFromOne: number): SunnyBanksActId {
  if (indexFromOne <= 0) return String(indexFromOne);
  let remaining = indexFromOne;
  let out = "";
  for (const [value, numeral] of ROMAN_VALUES) {
    while (remaining >= value) {
      out += numeral;
      remaining -= value;
    }
  }
  return out;
}

/** Next roman after the current ordered list (I, II, III → IV). */
export function nextSunnyBanksActId(existing: readonly string[]): SunnyBanksActId {
  return toSunnyBanksActId(existing.length + 1);
}

export interface SunnyBanksScriptChunk {
  raw: string;
  characterName: string;
  line: string;
  kind: SunnyBanksChunkKind;
  /** 0-based index in the act script's split lines — insert/rewrite land here. */
  sourceLineIndex: number;
  /** Locked park plate for this row and later rows, from `[Location: id]`. */
  locationId?: SunnyBanksLocationId;
  /** Set only when a `[Location: …]` tag at or above this row (in this
   * act's script) decided `locationId`; unset means `locationId` is the
   * built-in default. See `resolveSunnyBanksRowLocationId`. */
  locationTag?: SunnyBanksLocationId;
  /** Extra LTX prompt context from `[Action: text]` — not spoken TTS. */
  action?: string;
  /** Extra look text from `[Character Name: description]` — not gold. */
  appearanceModifier?: string;
  /** `[GROK]` / `[LTX]` / `[H3]` typed on this line or the tag-only line
   * above it (2026-09-30): overrides which engine renders the row. Never
   * part of `raw`, `line` or TTS. */
  videoBackend?: RowVideoBackend;
  /** `[Cast: A, B]` above this row or its scene (2026-10-03): exactly
   * who is in the shot. Names as typed; matched to Cast cards later. */
  castNames?: string[];
  /** `[Character Other: …]` looks for Cast cards other than this row's
   * own character (2026-10-03). Each look stays with its own person:
   * it never lands on the speaker any more. */
  castLooks?: Array<{ name: string; look: string }>;
  /** Set only on the lines of a multi-line scene (2026-10-03): two or
   * more talking lines in a row under one `[Action:]` or `[Cast:]`
   * block, with no tag between them. They share one picture. */
  sceneKey?: string;
  /** The scene block's `[Action: …]`, for who's in it and the shared
   * picture (the first line still uses it as its motion text). */
  sceneAction?: string;
  /** Everyone who has a line in the scene, in order. */
  sceneSpeakers?: string[];
}

/** Speak/Hold rows only — scene headers stay in the parse array but
 * never become spreadsheet queue rows. */
export function isSunnyBanksQueueChunk(
  chunk: SunnyBanksScriptChunk
): chunk is SunnyBanksScriptChunk & { kind: BeatKind } {
  return chunk.kind === "speak" || chunk.kind === "hold";
}

export function sunnyBanksQueueChunks(chunks: readonly SunnyBanksScriptChunk[]): Array<
  SunnyBanksScriptChunk & { kind: BeatKind }
> {
  return chunks.filter(isSunnyBanksQueueChunk);
}

/** What one Render row sends to the speak-beat route. */
export interface SunnyBanksBeatArgs {
  kind: BeatKind;
  characterName: string;
  line: string;
  locationId: string;
  /** The location's name, for the compositing prompt. */
  locationLabel?: string;
  locationImage: string;
  startImageDataUrl: string;
  action?: string;
  appearanceModifier?: string;
  /** Where the finished clip goes in the Blob tree; `null` = old path. */
  mediaTarget?: DeckMediaTarget | null;
  /** The card's voice (and, for an added character, look and picture). */
  speaker?: ReturnType<typeof sunnyBanksSpeakerRequestExtras>;
  /** The engine for a hold (a Speak beat is always LTX). */
  videoBackend?: RowVideoBackend;
  /** Multi-cast fields (2026-10-03). Empty for a one-person row, so its
   * request is exactly what it was before. */
  multiCast?: Record<string, unknown>;
  /** Which show (2026-10-04). Only Skidmarks says so; a Sunny Banks
   * request is exactly what it was before. */
  genre?: StudioGenre;
  /** Make plate first (2026-10-04): `plateOnly`, the row's own `plateUrl`,
   * `plateEngine`, a Siray `sirayTaskId`. Empty for a plain one-click
   * render, so its request is exactly what it was before. */
  ownPlate?: Record<string, unknown>;
}

/**
 * The JSON body for one row (2026-10-03: pulled out of the component so
 * the tests send byte for byte what the page sends; EP05 Act V).
 */
export function sunnyBanksBeatRequestBody(args: SunnyBanksBeatArgs): Record<string, unknown> {
  const action = args.action?.trim() ?? "";
  const appearanceModifier = args.appearanceModifier?.trim() ?? "";
  const mediaTarget = args.mediaTarget ? { mediaTarget: args.mediaTarget } : {};
  const speaker = args.speaker ?? {};
  const genre = args.genre && args.genre !== "sunnybank" ? { genre: args.genre } : {};
  // `action` and `appearanceModifier` travel as two separate fields —
  // the route itself merges them into the motion prompt (2026-09-18).
  return (
    args.kind === "hold"
      ? {
          kind: "hold",
          characterName: args.characterName,
          ...(args.videoBackend ? { videoBackend: args.videoBackend } : {}),
          ...(appearanceModifier ? { appearanceModifier } : {}),
          locationId: args.locationId,
          ...(args.locationLabel ? { locationLabel: args.locationLabel } : {}),
          locationImage: args.locationImage,
          startImageDataUrl: args.startImageDataUrl,
          ...(action ? { action } : {}),
          ...mediaTarget,
          ...speaker,
          ...(args.multiCast ?? {}),
          ...genre,
          ...(args.ownPlate ?? {}),
        }
      : {
          characterName: args.characterName,
          ...(appearanceModifier ? { appearanceModifier } : {}),
          line: args.line,
          locationId: args.locationId,
          ...(args.locationLabel ? { locationLabel: args.locationLabel } : {}),
          locationImage: args.locationImage,
          startImageDataUrl: args.startImageDataUrl,
          ...(action ? { action } : {}),
          ...mediaTarget,
          ...speaker,
          ...(args.multiCast ?? {}),
          ...genre,
          ...(args.ownPlate ?? {}),
        }
  );
}

/**
 * Everything one queue row sends (2026-10-03): its own fields plus who's
 * in the shot, the scene's shared picture (if one is already made) and
 * where a new shared picture is saved. Shared by Render and the tests.
 */
export function sunnyBanksRowBeatArgs(args: {
  chunk: SunnyBanksScriptChunk & { kind: BeatKind };
  characterName: string;
  speaker: ReturnType<typeof sunnyBanksSpeakerRequestExtras>;
  location: SunnyBanksLocationLock;
  startImageDataUrl: string;
  rowCast: SunnyBanksRowCast;
  videoBackend: RowVideoBackend;
  act: string;
  episodeSlug: string | null;
  rowNumber: number;
  /** The scene's first row number (names the shared picture). */
  sceneFirstRowNumber: number;
  scenePlateUrl?: string;
  /** Which show (Sunny Banks when left out): its clip folders and look. */
  genre?: StudioGenre;
  /** A one-person row's own plate, made with "Make plate" (2026-10-04). */
  rowPlateUrl?: string;
  /** Make and save only the plate (2026-10-04). */
  plateOnly?: boolean;
  /** The plate switch, for a show that has one (Shorts). Left out: Grok. */
  plateEngine?: PlateEngine;
  /** A Siray silent shot to check back on. */
  sirayTaskId?: string;
}): SunnyBanksBeatArgs {
  const { chunk, rowCast } = args;
  const genre = args.genre ?? "sunnybank";
  // Only Skidmarks names its show on the paths and the request.
  const genreField = genre !== "sunnybank" ? { genre } : {};
  const ownPlate: Record<string, unknown> = {};
  if (args.plateOnly) {
    ownPlate.plateOnly = true;
    // A one-person plate is named like a shared one (`…-beat-03-dap-plate`).
    if (!rowCast.cast.isMulti) {
      const target = sunnybankPlateTarget({
        episodeSlug: args.episodeSlug,
        actId: args.act,
        beatNumber: args.rowNumber,
        castNames: [args.characterName],
        ...genreField,
      });
      if (target) ownPlate.plateTarget = target;
    }
  }
  if (args.rowPlateUrl && !rowCast.cast.isMulti && !args.plateOnly) ownPlate.plateUrl = args.rowPlateUrl;
  if (args.plateEngine) ownPlate.plateEngine = args.plateEngine;
  if (args.sirayTaskId) ownPlate.sirayTaskId = args.sirayTaskId;
  return {
    kind: chunk.kind,
    characterName: args.characterName,
    line: chunk.line,
    locationId: args.location.id,
    locationLabel: args.location.label,
    locationImage: args.location.image,
    startImageDataUrl: args.startImageDataUrl,
    action: chunk.action,
    appearanceModifier: chunk.appearanceModifier,
    speaker: args.speaker,
    videoBackend: chunk.kind === "hold" ? args.videoBackend : undefined,
    multiCast: sunnyBanksMultiCastRequest({
      people: rowCast.people ?? [],
      sceneAction: chunk.action ? undefined : chunk.sceneAction,
      sceneSpeakers: rowCast.sceneSpeakers,
      scenePlateUrl: rowCast.cast.isMulti ? args.scenePlateUrl : undefined,
      plateTarget: rowCast.cast.isMulti
        ? sunnybankPlateTarget({
            episodeSlug: args.episodeSlug,
            actId: args.act,
            beatNumber: args.sceneFirstRowNumber,
            castNames: rowCast.cast.names,
            ...genreField,
          })
        : null,
      locationHasPeople: args.location.peopleInPicture === true,
    }),
    // Filed under this episode's pinned folder (set once from its name,
    // so a rename never moves it) when it has one.
    mediaTarget: sunnybankBeatTarget({
      episodeSlug: args.episodeSlug,
      actId: args.act,
      beatNumber: args.rowNumber,
      characterName: args.characterName,
      kind: chunk.kind,
      ...genreField,
    }),
    ...genreField,
    ...(Object.keys(ownPlate).length > 0 ? { ownPlate } : {}),
  };
}

/** A refused or failed plate, said plainly (2026-10-04): no clip is made from it. */
export function plateFailedMessage(reason: string): string {
  const why = reason.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  return `Plate not made${why ? `: ${why}` : ""}. No clip was rendered or billed. Change the shot and make the plate again.`;
}

export interface SunnyBanksGodDocument {
  episodeTitle: string | null;
  hasActHeaders: boolean;
  actIds: SunnyBanksActId[];
  actScripts: Record<string, string>;
}

interface GenerateBeatResponseBody {
  videoUrl?: unknown;
  durationSec?: unknown;
  error?: unknown;
  kind?: unknown;
  audioMuxed?: unknown;
  audioMuxError?: unknown;
  videoBackend?: unknown;
  /** Multi-cast shots (2026-10-03): the shared picture and who's in it. */
  plateUrl?: unknown;
  castNames?: unknown;
  /** Siray silent shots (2026-10-04): 202 while it renders. */
  pending?: unknown;
  sirayTaskId?: unknown;
  /** The plate step failed or was refused: nothing past it ran. */
  plateFailed?: unknown;
}

type RowRuntime = SunnyBanksRowRuntime;

type ActKeyed<T> = SunnyBanksActKeyed<T>;

/** One-level undo of the Script card — previous textarea / act
 * buffers + the runtime map they were compiled against. In-memory
 * only; never `localStorage`. */
interface ScriptUndoSnapshot {
  actIds: SunnyBanksActId[];
  activeAct: SunnyBanksActId;
  actScripts: ActKeyed<string>;
  characterOverrides: ActKeyed<Record<number, string>>;
  locationOverrides: ActKeyed<Record<number, SunnyBanksLocationId>>;
  locationPickTags: ActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: ActKeyed<Record<number, RowRuntime>>;
  workspaceTitle: string;
}

export interface SunnyBanksRenderedClip {
  act: SunnyBanksActId;
  index: number;
  characterName: string;
  lineLabel: string;
  videoUrl: string;
  durationSec?: number;
  /** The engine that made it (clips from before 2026-09-30 were all LTX). */
  videoBackend?: RowVideoBackend;
  /** Who was in a multi-cast shot (2026-10-03), for the tile's chips. */
  castNames?: string[];
}

/** Who an unnamed line belongs to when nobody spoke before it: Sunny
 * Banks' first built-in; Skidmarks' first voiced character, else nobody. */
function fallbackCharacterName(): string {
  if (helperGenre() === "sunnybank") return CAST_LIST[0]?.name ?? "";
  // Voiced only: a Cast card with no voice (silent shots only) is never guessed for a line.
  return sunnyBanksSpeakerList(getSkidmarksSnapshot(), helperGenre()).find((c) => c.voiceId)?.name ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchSpeakerPrefix(raw: string): { name: string; rest: string } | null {
  for (const name of speakerNames()) {
    const re = new RegExp(`^${escapeRegExp(name)}\\s*(?:says\\s*)?:\\s*(.*)$`, "i");
    const match = raw.match(re);
    if (match) {
      return { name, rest: (match[1] ?? "").trim() };
    }
  }
  return null;
}

/** `# EPISODE: title` — trailing text is the workspace name. */
export function parseSunnyBanksEpisodeHeader(raw: string): { title: string } | null {
  const match = raw.match(/^#\s*EPISODE:\s*(.*)$/i);
  if (!match) return null;
  return { title: (match[1] ?? "").trim() };
}

/** A bare `=== ACT I ===` / `=== ACT 2` names that act buffer.
 *  A titled beat (`=== ACT III — CROWD CUTAWAY ===`) is a scene, not
 *  a new act — see `parseSunnyBanksTitledActHeader`.
 *  `# Act I` / `# ACT II: The Con` (a markdown heading, 2026-09-30) is
 *  an act header too: EP01's `# Act I` was read as a spoken line and
 *  billed as a Shazza clip. */
export function parseSunnyBanksActHeader(raw: string): SunnyBanksActId | null {
  const trimmed = raw.trim();
  const match =
    trimmed.match(/^===\s*ACT\s+([IVXLCDM]+|\d+)\s*(?:===)?\s*$/i) ??
    trimmed.match(/^#+\s*ACT\s+([IVXLCDM]+|\d+)\b(?:\s*[:.\-\u2013\u2014].*|\s+.*)?$/i);
  if (!match) return null;
  return actTokenToId(match[1]);
}

/** Any other `# heading` (not `# EPISODE:`, not `# Act …`): a note for
 *  the reader, never a spoken or billed row. */
export function isSunnyBanksMarkdownHeading(raw: string): boolean {
  return /^#+\s/.test(raw.trim()) && !parseSunnyBanksEpisodeHeader(raw.trim());
}

function actTokenToId(token: string): SunnyBanksActId | null {
  if (/^\d+$/.test(token)) {
    const indexFromOne = Number(token);
    if (indexFromOne < 1 || indexFromOne > MAX_SUNNY_BANKS_ACTS) return null;
    return toSunnyBanksActId(indexFromOne);
  }
  return token.toUpperCase();
}

/** `=== ACT III — CROWD CUTAWAY ===` / `=== ACT III — THE CON ===`.
 *  Switches the God-document buffer to that act and stays a scene
 *  chunk — not a queue row, not a second Act III pill. */
export function parseSunnyBanksTitledActHeader(
  raw: string
): { actId: SunnyBanksActId; label: string } | null {
  if (parseSunnyBanksActHeader(raw)) return null;
  const scene = parseSunnyBanksSceneHeader(raw);
  if (!scene) return null;
  const match = scene.match(/^ACT\s+([IVXLCDM]+|\d+)\b/i);
  if (!match) return null;
  const actId = actTokenToId(match[1]);
  if (!actId) return null;
  return { actId, label: scene };
}

/** `=== THE EPISODE TAG ===` (or any `=== LABEL ===` that is not an
 * Act header). Stored as a sequence chunk; not a queue row. */
export function parseSunnyBanksSceneHeader(raw: string): string | null {
  if (parseSunnyBanksActHeader(raw)) return null;
  const match = raw.match(/^===\s*(.+?)\s*===\s*$/);
  if (!match) return null;
  const label = match[1].replace(/\s+/g, " ").trim();
  return label.length > 0 ? label : null;
}

/** The saved characters for the God-script guide: the built-in cast with
 *  any voice saved on their card (Hans), plus characters added with "+". */
function guideCast() {
  return sunnyBanksSpeakerList(getSkidmarksSnapshot(), helperGenre());
}

/** Sunnybank's locations: the Locations row's saved list, or the
 *  built-ins until it has one (`lib/sunnyBanksLocations.ts`). */
function locationList(): SunnyBanksLocationLock[] {
  return studioLocationList(getSkidmarksSnapshot(), helperGenre());
}

/** Where a script starts before its first `[Location: …]`: Sunny Banks'
 * storefront; Skidmarks' first place on its Locations row, else none. */
function defaultScriptLocationId(): SunnyBanksLocationId {
  if (helperGenre() === "sunnybank") return SUNNY_BANKS_DEFAULT_LOCATION_ID;
  return locationList()[0]?.id ?? "";
}

/** Map `[Location: id]` onto a location on the Locations row (its key,
 *  its key spelled loosely, or its name). */
export function resolveSunnyBanksScriptLocationId(token: string): SunnyBanksLocationId | undefined {
  return findSunnyBanksLocation(locationList(), token)?.id;
}

/** What an unknown `[Location: …]` is kept as: its key form, so the row
 *  shows a warning (and resolves by itself once that location is added)
 *  instead of quietly rendering on the storefront. */
function unknownLocationKey(token: string): SunnyBanksLocationId | undefined {
  const t = token.replace(/\s+/g, " ").trim();
  return t ? deckLocationKeyFromName(t) : undefined;
}

/** Every Sunnybank Cast card (voice or not), for `[Character Name: …]`
 *  and `[Cast: …]` names (2026-10-03). */
function castCards() {
  return sunnyBanksCastCards(getSkidmarksSnapshot(), helperGenre());
}

/**
 * `[Character Bloom: long blond man-bun…]` → `{ name: "Bloom", look: "long
 * blond man-bun…" }`. Before 2026-10-03 the name was thrown away, so
 * another character's look landed on the row's speaker (Bloom's man-bun
 * on Ranger Bazza). `name` is the name as typed (`null` when the tag has
 * none); the block parser decides whose look it is.
 */
export function parseCharacterLookTag(inner: string): { name: string | null; look: string } {
  const trimmed = inner.replace(/\s+/g, " ").trim();
  if (!trimmed) return { name: null, look: "" };
  const colon = trimmed.match(/^([^:]+):\s*(.*)$/);
  if (colon) {
    const name = colon[1].replace(/\s+/g, " ").trim();
    return { name: name || null, look: (colon[2] ?? "").replace(/\s+/g, " ").trim() };
  }
  const names = [...new Set([...speakerNames(), ...castCards().map((c) => c.name)])].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(`^${escapeRegExp(name)}\\s+(.*)$`, "i");
    const match = trimmed.match(re);
    if (match) return { name, look: (match[1] ?? "").replace(/\s+/g, " ").trim() };
  }
  return { name: null, look: trimmed };
}

/** The Cast card a typed name means (any case), or `null`. */
function castCardName(typed: string | null): string | null {
  if (!typed) return null;
  return castCards().find((c) => sameShotCastName(c.name, typed))?.name ?? null;
}

/** `Crowd:` (or any empty `Name:` that is not a CAST key) is a
 *  location Hold cutaway — not a CAST speaker and not a continuation. */
export function parseSunnyBanksGhostTargetName(rest: string): string | null {
  const match = rest.trim().match(/^(.+?)\s*:\s*$/);
  if (!match) return null;
  const name = match[1].replace(/\s+/g, " ").trim();
  if (!name) return "Crowd";
  if (speakerNames().some((speaker) => speaker.toLowerCase() === name.toLowerCase())) return null;
  return name;
}

export function isSunnyBanksGhostTargetLine(rest: string): boolean {
  return parseSunnyBanksGhostTargetName(rest) !== null;
}

/** Hold of a locked park plate with no CAST overlay. Gold Hold/Speak
 *  strings stay unused — they assume one plated person. */
export function isSunnyBanksLocationCutaway(
  chunk: Pick<SunnyBanksScriptChunk, "kind" | "characterName">
): boolean {
  return chunk.kind === "hold" && !speakerLock(chunk.characterName);
}

/** Motion text for a Crowd/location Hold. Not gold — `lib/sunnyBanks.ts`
 *  Hold/Speak templates are character-locked and stay verbatim. */
export function buildSunnyBanksLocationCutawayPrompt(action: string | undefined): string {
  const motion = action?.replace(/\s+/g, " ").trim() || "Subtle ambient motion. Camera holds, no cuts.";
  return `Use the provided start image as the first frame. ${motion} No dialogue.`;
}

function extractGodScriptTags(raw: string): {
  rest: string;
  locationId?: SunnyBanksLocationId;
  actions: string[];
  /** Every `[Character …]` look, each with the name it was typed with. */
  looks: Array<{ name: string | null; look: string }>;
  /** `[Cast: A, B]` names (2026-10-03). */
  castNames: string[];
  videoBackend?: RowVideoBackend;
} {
  let locationId: SunnyBanksLocationId | undefined;
  const actions: string[] = [];
  const looks: Array<{ name: string | null; look: string }> = [];
  const castNames: string[] = [];
  const backend = extractVideoBackendOverride(raw);
  const rest = backend.rest
    .replace(/\[Location:\s*([^\]]*)\]/gi, (_, token: string) => {
      const resolved = resolveSunnyBanksScriptLocationId(token) ?? unknownLocationKey(token);
      if (resolved) locationId = resolved;
      return " ";
    })
    .replace(/\[Action:\s*([^\]]*)\]/gi, (_, token: string) => {
      const action = token.replace(/\s+/g, " ").trim();
      if (action) actions.push(action);
      return " ";
    })
    .replace(/\[Character\s+([^\]]*)\]/gi, (_, inner: string) => {
      const look = parseCharacterLookTag(inner);
      if (look.look) looks.push(look);
      return " ";
    })
    .replace(/\[Cast:\s*([^\]]*)\]/gi, (_, inner: string) => {
      castNames.push(...parseCastTagNames(inner));
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return backend.override
    ? { rest, locationId, actions, looks, castNames, videoBackend: backend.override }
    : { rest, locationId, actions, looks, castNames };
}

/**
 * Splits a block's `[Character …]` looks for one row (2026-10-03): the
 * row's own look (no name, its own name, or a name that isn't a Cast
 * card: exactly what `appearanceModifier` got before) and looks for other
 * Cast cards, which stay with their own person.
 */
function splitLooksForRow(
  looks: ReadonlyArray<{ name: string | null; look: string }>,
  characterName: string
): { own: string[]; others: Array<{ name: string; look: string }> } {
  const own: string[] = [];
  const others: Array<{ name: string; look: string }> = [];
  for (const entry of looks) {
    const card = castCardName(entry.name);
    if (!card || sameShotCastName(card, characterName)) {
      own.push(entry.look);
      continue;
    }
    const existing = others.find((o) => sameShotCastName(o.name, card));
    if (existing) existing.look = `${existing.look} ${entry.look}`.trim();
    else others.push({ name: card, look: entry.look });
  }
  return { own, others };
}

/** Highlight category for one bracket tag in the raw God Script text —
 * display-only. This never changes parsing: `extractGodScriptTags`
 * above is still the only thing that decides what a tag *does*. A
 * bracket that isn't one of these three literal shapes (e.g. a plain
 * parenthetical, or `[silent]`/`[silence]` used as if it silenced a
 * line) is intentionally left uncolored ("plain") — coloring it here
 * would visually imply the parser treats it specially, which it
 * currently does not; see this module's own doc comment above
 * `extractGodScriptTags` for the real silent-beat mechanism (empty
 * dialogue after the speaker's name). */
export type SunnyBanksHighlightTagKind = "location" | "character" | "action" | "backend";
export type SunnyBanksHighlightSegment =
  | { kind: "plain"; text: string }
  | { kind: SunnyBanksHighlightTagKind; text: string }
  /** A `Name:` / `Name says:` speaker prefix at the start of a line —
   * overlay colour only (`buildSunnyBanksOverlaySegments`), never a tag
   * for `formatSunnyBanksGodScript`. */
  | { kind: "speaker"; text: string };

/** Same three literal shapes `extractGodScriptTags` recognizes, plus a
 * literal `[silence]` grouped into the same "action" color per Stuart's
 * explicit ask — `[silence]` is not a real parsed tag (see doc comment
 * above), only a display-only alias colored the same as `[Action: ]`. */
const GOD_SCRIPT_HIGHLIGHT_TAG_RE = new RegExp(
  String.raw`\[Location:[^\]]*\]|\[Character\b[^\]]*\]|\[Cast:[^\]]*\]|\[Action:[^\]]*\]|\[silence\]|` + VIDEO_BACKEND_OVERRIDE_TAG_SOURCE,
  "gi"
);
const VIDEO_BACKEND_TAG_EXACT_RE = new RegExp(`^${VIDEO_BACKEND_OVERRIDE_TAG_SOURCE}$`, "i");

function classifySunnyBanksHighlightTag(matchedText: string): SunnyBanksHighlightTagKind {
  if (VIDEO_BACKEND_TAG_EXACT_RE.test(matchedText)) return "backend";
  const lower = matchedText.toLowerCase();
  if (lower.startsWith("[location:")) return "location";
  // `[Cast: A, B]` (2026-10-03) is about people, so it's the character colour.
  if (lower.startsWith("[character") || lower.startsWith("[cast:")) return "character";
  return "action";
}

/** Splits raw God Script text into plain/tag segments for the textarea
 * highlight overlay below. Concatenating every segment's `text` in
 * order always reconstructs `raw` exactly — the overlay depends on
 * that to stay pixel-aligned with the real (invisible) textarea text
 * it sits behind. */
export function buildSunnyBanksHighlightSegments(raw: string): SunnyBanksHighlightSegment[] {
  const segments: SunnyBanksHighlightSegment[] = [];
  const re = new RegExp(GOD_SCRIPT_HIGHLIGHT_TAG_RE);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "plain", text: raw.slice(lastIndex, match.index) });
    }
    segments.push({ kind: classifySunnyBanksHighlightTag(match[0]), text: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    segments.push({ kind: "plain", text: raw.slice(lastIndex) });
  }
  return segments;
}

/**
 * What the script box's overlay actually draws (2026-09-30): the tag
 * segments above, plus each line's speaker prefix (`Shazza:`, `Ranger
 * Bazza says:`) in the same colour as `[Character ]`, so a plain
 * dialogue script (no tags at all, like EP02 Act I) is coloured too
 * instead of reading as one block of white. A prefix counts at the
 * start of a line or straight after a tag on that line, the same places
 * `parseSunnyBanksScriptBlock` reads a speaker. Display-only; the
 * segments still join back into `raw` exactly.
 */
export function buildSunnyBanksOverlaySegments(raw: string): SunnyBanksHighlightSegment[] {
  const out: SunnyBanksHighlightSegment[] = [];
  const speakerRe =
    speakerNames().length > 0
      ? new RegExp(`^([ \\t]*)((?:${speakerNames().map(escapeRegExp).join("|")})\\s*(?:says\\s*)?:)`, "i")
      : null;
  let atLineStart = true;
  for (const segment of buildSunnyBanksHighlightSegments(raw)) {
    if (segment.kind !== "plain" || !speakerRe) {
      out.push(segment);
      if (segment.kind !== "plain") atLineStart = true;
      continue;
    }
    const lines = segment.text.split("\n");
    lines.forEach((line, i) => {
      const text = i < lines.length - 1 ? `${line}\n` : line;
      if (!text) return;
      const match = atLineStart || i > 0 ? line.match(speakerRe) : null;
      if (match) {
        if (match[1]) out.push({ kind: "plain", text: match[1] });
        out.push({ kind: "speaker", text: match[2] });
        const rest = text.slice(match[1].length + match[2].length);
        if (rest) out.push({ kind: "plain", text: rest });
      } else {
        out.push({ kind: "plain", text });
      }
    });
    atLineStart = segment.text.endsWith("\n");
  }
  return out;
}

/**
 * Text color for every segment the overlay draws — tags *and* plain
 * text.
 *
 * `plain` is not decoration: the overlay is the **only** thing that
 * draws this textarea's text at all (the real `<textarea>` is
 * `text-transparent` so the colored tags can show through it), so plain
 * text needs a real, opaque color here or it renders as nothing. Live
 * QA (2026-09-18, real iPhone): the overlay shipped with a base of
 * `text-white/0` and every non-tag line was invisible — black text on
 * the black card, with only the bracket tags showing. Keep every value
 * in this table opaque.
 */
export const SUNNY_BANKS_HIGHLIGHT_CLASSES: Record<SunnyBanksHighlightSegment["kind"], string> = {
  plain: "text-white",
  location: "text-yellow-300",
  character: "text-cyan-300",
  action: "text-green-300",
  backend: "text-red-400",
  speaker: "text-cyan-300",
};

/** Placeholder marker used only inside `formatSunnyBanksGodScript`'s own
 * working copy of the text — never appears in real output. Null bytes
 * can't come from a pasted script, so this can't collide with anything
 * a real God Script would contain. */
const FORMAT_TAG_PLACEHOLDER_RE = /\u0000TAG(\d+)\u0000/g;

/**
 * One-tap "Format" — reflows a pasted/typed God Script onto the
 * "one tag or one speaker per line" shape the parser actually expects,
 * without touching a single character of real content (no tag is
 * rewritten, no dialogue word is added or removed — only whitespace/
 * newlines move). Built for the exact complaint that prompted it: text
 * pasted in from elsewhere with no line breaks at all, where every
 * tag and every `Name:` run together on one line.
 *
 * Never needed for *color* — `buildSunnyBanksHighlightSegments` above
 * colors bracket tags wherever they sit, line breaks or not. This is
 * strictly about restoring the parser's own line-per-beat shape so
 * `parseSunnyBanksScriptBlock` reads back the right number of rows
 * instead of merging several beats into one giant line.
 *
 * How: protect every real bracket tag (the same shapes
 * `buildSunnyBanksHighlightSegments` finds) behind a placeholder token
 * first, so the speaker-prefix pass below can never match text sitting
 * *inside* a tag (e.g. the "Dazza:" inside `[Character Dazza: ...]`)
 * and split a tag in half. Then: force a newline before every tag and
 * every recognized `Name:`/`Name says:` prefix that isn't already at
 * the start of a line, drop blank lines, put exactly one blank line
 * after each speech line, and restore the real tag text.
 *
 * Known, accepted limitation: a cast member's name followed by a colon
 * *inside* real dialogue (e.g. `Shazza: ask Dazza: he'd know`) reads as
 * a second speaker line, same ambiguity `matchSpeakerPrefix` already
 * has for text at the start of a real line — this formatter can't
 * disambiguate that any better than the parser it's formatting for.
 * Idempotent: running it again on its own output is a no-op.
 */
export function formatSunnyBanksGodScript(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  const segments = buildSunnyBanksHighlightSegments(normalized);
  const tagTexts: string[] = [];
  let working = "";
  for (const segment of segments) {
    // `[GROK]` / `[LTX]` / `[H3]` stay where they were typed (2026-09-30):
    // moved onto a line of its own, one typed after `Bazza:` would switch
    // the engine of the next row instead of this one.
    if (segment.kind === "plain" || segment.kind === "backend") {
      working += segment.text;
    } else {
      const index = tagTexts.push(segment.text) - 1;
      working += `\u0000TAG${index}\u0000`;
    }
  }

  // Force a newline before every tag placeholder not already at a line start,
  // trimming any inline spacing that used to sit between it and prior text.
  working = working.replace(/[ \t]*(\u0000TAG\d+\u0000)/g, (match, placeholder: string, offset: number, full: string) => {
    const before = full.slice(0, offset);
    return before.length === 0 || before.endsWith("\n") ? placeholder : `\n${placeholder}`;
  });

  // Same for a recognized speaker prefix (`Name:` / `Name says:`).
  if (speakerNames().length > 0) {
    const speakerAlternation = speakerNames().map(escapeRegExp).join("|");
    const speakerRe = new RegExp(`[ \\t]*\\b(?:${speakerAlternation})\\s*(?:says\\s*)?:`, "gi");
    working = working.replace(speakerRe, (match, offset: number, full: string) => {
      const before = full.slice(0, offset);
      const trimmed = match.replace(/^[ \t]+/, "");
      return before.length === 0 || before.endsWith("\n") ? trimmed : `\n${trimmed}`;
    });
  }

  const lines = working
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line) => line.trim().length > 0);

  // One blank line after every speech line (2026-09-30, Stuart's ask),
  // so each spoken beat stands on its own. Tag-only lines stay glued to
  // the line they belong to (a tag is used up by the next row), and so
  // do `# EPISODE:` / `=== … ===` headers. The parser skips blank lines,
  // so rows, row numbers and every clip's `lineKey` are unchanged.
  const out: string[] = [];
  lines.forEach((line, i) => {
    out.push(line);
    const isLast = i === lines.length - 1;
    if (!isLast && isSunnyBanksSpeechFormatLine(line)) out.push("");
  });

  return out.join("\n").replace(FORMAT_TAG_PLACEHOLDER_RE, (_, index: string) => tagTexts[Number(index)]);
}

/** A formatter working line that is spoken (or a silent `Name:` hold),
 * not a tag-only line and not a header. Tags are still placeholders
 * here, so a tag-only line is placeholders and whitespace only. */
function isSunnyBanksSpeechFormatLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.replace(/\u0000TAG\d+\u0000/g, "").trim().length === 0) return false;
  if (parseSunnyBanksEpisodeHeader(trimmed) || parseSunnyBanksActHeader(trimmed)) return false;
  if (parseSunnyBanksSceneHeader(trimmed)) return false;
  return true;
}

/** Positioned behind the real `<textarea>` (which has its own text made
 * transparent so this shows through) — never in front, and never
 * `pointer-events`-capturing, so typing/selection/scrolling all still
 * hit the real textarea untouched. Must mirror the textarea's font
 * size, line height, padding, and white-space wrapping exactly, or the
 * colored text drifts out from under the real caret/characters. Because
 * the textarea's own text is transparent, this overlay draws **all** of
 * it — plain segments included — so every segment gets a color from
 * `SUNNY_BANKS_HIGHLIGHT_CLASSES`, never a transparent base. Scroll
 * position is synced imperatively (`onScroll` on the textarea sets this
 * element's `scrollTop`) rather than through React state, so it can't
 * lag a frame behind a fast scroll/paste. */
function SunnyBanksScriptHighlightOverlay({
  text,
  overlayRef,
  autoGrowMinRows,
}: {
  text: string;
  overlayRef: RefObject<HTMLDivElement | null>;
  /** Inline box: grow with the text, at least this many lines. */
  autoGrowMinRows?: number;
}) {
  const segments = buildSunnyBanksOverlaySegments(text);
  useTextareaOverlayMirror(overlayRef, text, { autoGrowMinRows });
  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-base leading-6"
    >
      {segments.map((segment, index) => (
        <span key={index} className={SUNNY_BANKS_HIGHLIGHT_CLASSES[segment.kind]}>
          {segment.text}
        </span>
      ))}
      {/* Trailing newline: a native textarea always reserves room for one more
       * line after a final "\n" (where the caret sits); without this, the
       * overlay's own wrapped-line count falls one short and drifts up
       * relative to the real textarea once the script ends in a blank line. */}
      {text.endsWith("\n") ? <span>{"\u200b"}</span> : null}
    </div>
  );
}

/** iPhone paste of a URL-encoded script lands as literal `%20` / `%0A`
 * (Stuart live QA: the textarea filled with percent signs instead of
 * spaces and line breaks). Decode that blob before the parser runs.
 * Leaves a normal typed script alone — including a lone `%` in dialogue. */
export function decodeSunnyBanksPastedScript(text: string): string {
  if (!/%(?:20|0[AaDd])/i.test(text)) return text;
  const encodedNewlines = (text.match(/%0[AaDd]/gi) ?? []).length;
  const realNewlines = (text.match(/\r|\n/g) ?? []).length;
  const encodedSpaces = (text.match(/%20/g) ?? []).length;
  const looksEncoded =
    (encodedNewlines > 0 && encodedNewlines >= realNewlines) || encodedSpaces >= 3;
  if (!looksEncoded) return text;
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text
      .replace(/%0D%0A/gi, "\n")
      .replace(/%0A/gi, "\n")
      .replace(/%0D/gi, "\n")
      .replace(/%20/g, " ");
  }
}

/** Append `[Action:]` text after a gold prompt. Does not rewrite gold. */
export function appendSunnyBanksActionToPrompt(prompt: string, action: string | undefined): string {
  const extra = action?.trim() ?? "";
  if (!extra) return prompt;
  return `${prompt} ${extra}`;
}

export function mergeSunnyBanksActIds(
  existing: readonly string[],
  incoming: readonly string[]
): SunnyBanksActId[] {
  const next: SunnyBanksActId[] = [...existing];
  for (const id of incoming) {
    if (!next.includes(id) && next.length < MAX_SUNNY_BANKS_ACTS) next.push(id);
  }
  return next;
}

/**
 * Split a God Script document into per-act buffers. `# EPISODE:` and
 * `=== ACT` lines are not stored in those buffers. In-memory only.
 */
export function parseSunnyBanksGodDocument(text: string, fallbackActId: string = "I"): SunnyBanksGodDocument {
  let episodeTitle: string | null = null;
  let hasActHeaders = false;
  let currentAct: SunnyBanksActId = fallbackActId;
  const order: SunnyBanksActId[] = [];
  const linesByAct: Record<string, string[]> = {};

  const touch = (act: SunnyBanksActId) => {
    if (!linesByAct[act]) {
      linesByAct[act] = [];
      order.push(act);
    }
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    const episode = parseSunnyBanksEpisodeHeader(raw);
    if (episode) {
      if (episode.title) episodeTitle = episode.title;
      continue;
    }
    const act = parseSunnyBanksActHeader(raw);
    if (act) {
      hasActHeaders = true;
      currentAct = act;
      touch(currentAct);
      continue;
    }
    const titled = parseSunnyBanksTitledActHeader(raw);
    if (titled) {
      hasActHeaders = true;
      currentAct = titled.actId;
      touch(currentAct);
      linesByAct[currentAct].push(rawLine.replace(/[ \t]+$/g, ""));
      continue;
    }
    touch(currentAct);
    linesByAct[currentAct].push(rawLine.replace(/[ \t]+$/g, ""));
  }

  if (order.length === 0) touch(fallbackActId);

  let inheritedLocation: SunnyBanksLocationId | undefined;
  for (const act of order) {
    const body = linesByAct[act] ?? [];
    const hasOwnLocation = body.some((line) => Boolean(extractGodScriptTags(line.trim()).locationId));
    if (!hasOwnLocation && inheritedLocation) {
      body.unshift(`[Location: ${inheritedLocation}]`);
    }
    for (const line of body) {
      const loc = extractGodScriptTags(line.trim()).locationId;
      if (loc) inheritedLocation = loc;
    }
    linesByAct[act] = body;
  }

  const actScripts: Record<string, string> = {};
  for (const act of order) {
    actScripts[act] = (linesByAct[act] ?? []).join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  }
  return { episodeTitle, hasActHeaders, actIds: order, actScripts };
}

/**
 * Which location a queue row renders at (2026-10-01, Stuart approved).
 *
 * - A row with a `[Location: …]` tag (its own, or the nearest one above
 *   it in the act) renders at that tag. A location saved from the row's
 *   dropdown only beats the tag when it was picked while that same tag
 *   was in force (`pickedOverTag`), so whichever came last wins: pick
 *   after writing the tag and the pick counts; change the tag after the
 *   pick and the new tag counts.
 * - A row with no tag uses its saved dropdown pick, else the act default.
 *
 * Why: EP02 Act II said `[Location: park_site_4]`, but every row still
 * carried a saved "Tin Shed & Mower" from the old Crash Lab demo seed,
 * and the saved value always won, on Grok and LTX alike.
 */
export function resolveSunnyBanksRowLocationId(
  chunk: Pick<SunnyBanksScriptChunk, "locationId" | "locationTag">,
  saved: SunnyBanksLocationId | undefined,
  pickedOverTag: SunnyBanksLocationId | undefined,
  defaultLocationId: SunnyBanksLocationId
): SunnyBanksLocationId {
  if (chunk.locationTag) {
    return saved && pickedOverTag === chunk.locationTag ? saved : chunk.locationTag;
  }
  return saved ?? chunk.locationId ?? defaultLocationId;
}

/**
 * The saved row maps after the row dropdown picks `locationId` (pure, for
 * the panel and tests). On a tagged row the pick also records the tag it
 * was made against; picking the tag itself just clears the row's pick.
 */
export function pickSunnyBanksRowLocation(
  maps: {
    locationOverrides: Record<number, SunnyBanksLocationId>;
    locationPickTags: Record<number, SunnyBanksLocationId>;
  },
  rowIndex: number,
  locationTag: SunnyBanksLocationId | undefined,
  locationId: SunnyBanksLocationId
): { locationOverrides: Record<number, SunnyBanksLocationId>; locationPickTags: Record<number, SunnyBanksLocationId> } {
  const locationOverrides = { ...maps.locationOverrides };
  const locationPickTags = { ...maps.locationPickTags };
  delete locationPickTags[rowIndex];
  if (locationTag && locationId === locationTag) {
    delete locationOverrides[rowIndex];
  } else {
    locationOverrides[rowIndex] = locationId;
    if (locationTag) locationPickTags[rowIndex] = locationTag;
  }
  return { locationOverrides, locationPickTags };
}

/**
 * Split a pasted script on newlines into Speak/Hold chunks.
 * Looks up speakers against `SUNNY_BANKS_CAST` keys (name-keyed
 * records, never a guessed id). Empty dialogue after a speaker prefix
 * is a Hold. A line with no prefix continues the previous speaker.
 * Blank lines are skipped. God Script headers (`# EPISODE:`, `=== ACT`,
 * `[Location: id]`, `[Action: text]`, `[Character Name: look]`) are not
 * queue rows. `=== LABEL ===` scene headers (e.g. `=== THE EPISODE TAG
 * ===`, `=== ACT III — CROWD CUTAWAY ===`) stay in the parse array as
 * `kind: "scene"` sequence chunks and are not spreadsheet rows.
 * `[Character Dazza wrapped in bandages]` (no colon) and
 * `[Character Name: description]` both strip into `appearanceModifier`
 * on the next Speak/Hold row — gold look strings in `lib/sunnyBanks.ts`
 * stay verbatim. Empty `Crowd:` (any non-CAST `Name:`) is a location
 * Hold cutaway — not a Speak continuation of the previous CAST
 * speaker, and not skipped. Skipping it left `[Action:]` with nowhere
 * to land, so a drone/crowd beat never became Idle and Render stayed
 * on "Clips already loaded" while the 10 Act III seed lines stayed Done.
 * Each queue chunk keeps `sourceLineIndex` so a row's + can insert a
 * Hold in between Done clips without re-pasting the whole God Script.
 */
export function parseSunnyBanksScriptBlock(text: string): SunnyBanksScriptChunk[] {
  const chunks: SunnyBanksScriptChunk[] = [];
  let previousName = "";
  let currentLocation: SunnyBanksLocationId = defaultScriptLocationId();
  let taggedLocation: SunnyBanksLocationId | undefined;
  let pendingActions: string[] = [];
  let pendingLooks: Array<{ name: string | null; look: string }> = [];
  let pendingCast: string[] = [];
  let pendingBackend: RowVideoBackend | undefined;
  // Scenes (2026-10-03): a tag block, then the rows under it until the
  // next tag line or scene header. Only a block with [Action:] or
  // [Cast:] and two or more talking rows becomes a shared-picture scene.
  interface SceneBlock {
    actions: string[];
    cast: string[];
    looks: Array<{ name: string | null; look: string }>;
    rows: SunnyBanksScriptChunk[];
    ghost: boolean;
  }
  const blocks: SceneBlock[] = [];
  let block: SceneBlock = { actions: [], cast: [], looks: [], rows: [], ghost: false };
  const startBlock = () => {
    if (block.rows.length > 0) blocks.push(block);
    if (block.rows.length > 0 || block.ghost) block = { actions: [], cast: [], looks: [], rows: [], ghost: false };
  };
  const rawLines = text.split(/\r?\n/);
  for (let sourceLineIndex = 0; sourceLineIndex < rawLines.length; sourceLineIndex += 1) {
    const rawLine = rawLines[sourceLineIndex];
    const raw = rawLine.trim();
    if (!raw) continue;
    if (parseSunnyBanksEpisodeHeader(raw) || parseSunnyBanksActHeader(raw) || isSunnyBanksMarkdownHeading(raw)) continue;
    const sceneLabel = parseSunnyBanksSceneHeader(raw);
    if (sceneLabel) {
      startBlock();
      block = { actions: [], cast: [], looks: [], rows: [], ghost: false };
      chunks.push({
        raw,
        characterName: "",
        line: sceneLabel,
        kind: "scene",
        sourceLineIndex,
        locationId: currentLocation,
      });
      continue;
    }
    const tagged = extractGodScriptTags(raw);
    const hasSceneTag =
      Boolean(tagged.locationId) || tagged.actions.length > 0 || tagged.looks.length > 0 || tagged.castNames.length > 0;
    if (hasSceneTag) {
      startBlock();
      block.actions.push(...tagged.actions);
      block.cast.push(...tagged.castNames);
      block.looks.push(...tagged.looks);
    }
    if (tagged.locationId) {
      currentLocation = tagged.locationId;
      taggedLocation = tagged.locationId;
    }
    if (tagged.actions.length > 0) pendingActions = [...pendingActions, ...tagged.actions];
    if (tagged.looks.length > 0) pendingLooks = [...pendingLooks, ...tagged.looks];
    if (tagged.castNames.length > 0) pendingCast = [...pendingCast, ...tagged.castNames];
    if (tagged.videoBackend) pendingBackend = tagged.videoBackend;
    if (!tagged.rest) continue;
    const ghostName = parseSunnyBanksGhostTargetName(tagged.rest);
    if (ghostName) {
      const action = pendingActions.join(" ").trim();
      pendingActions = [];
      // A cutaway never has cast: every look stays its old merged text.
      const appearanceModifier = pendingLooks.map((l) => l.look).join(" ").trim();
      pendingLooks = [];
      pendingCast = [];
      block.ghost = true;
      const chunk: SunnyBanksScriptChunk = {
        raw: tagged.rest,
        characterName: ghostName,
        line: "",
        kind: "hold",
        sourceLineIndex,
        locationId: currentLocation,
      };
      if (action) chunk.action = action;
      if (appearanceModifier) chunk.appearanceModifier = appearanceModifier;
      if (taggedLocation) chunk.locationTag = taggedLocation;
      if (pendingBackend) chunk.videoBackend = pendingBackend;
      pendingBackend = undefined;
      chunks.push(chunk);
      continue;
    }
    const matched = matchSpeakerPrefix(tagged.rest);
    let characterName: string;
    let line: string;
    if (matched) {
      characterName = matched.name;
      line = matched.rest;
      previousName = matched.name;
    } else {
      characterName = previousName || fallbackCharacterName();
      line = tagged.rest;
      if (characterName) previousName = characterName;
    }
    const action = pendingActions.join(" ").trim();
    pendingActions = [];
    const looks = splitLooksForRow(pendingLooks, characterName);
    pendingLooks = [];
    const appearanceModifier = looks.own.join(" ").trim();
    const castNames = pendingCast;
    pendingCast = [];
    const chunk: SunnyBanksScriptChunk = {
      raw: tagged.rest,
      characterName,
      line,
      kind: line.length > 0 ? "speak" : "hold",
      sourceLineIndex,
      locationId: currentLocation,
    };
    if (action) chunk.action = action;
    if (appearanceModifier) chunk.appearanceModifier = appearanceModifier;
    if (castNames.length > 0) chunk.castNames = castNames;
    if (looks.others.length > 0) chunk.castLooks = looks.others;
    if (taggedLocation) chunk.locationTag = taggedLocation;
    if (pendingBackend) chunk.videoBackend = pendingBackend;
    pendingBackend = undefined;
    chunks.push(chunk);
    block.rows.push(chunk);
    // Inline tags on the speaker's own line end its block there.
    if (hasSceneTag) startBlock();
  }
  startBlock();
  for (const scene of blocks) markSunnyBanksScene(scene);
  return chunks;
}

/**
 * Two or more talking lines in a row under one `[Action:]` / `[Cast:]`
 * block, with no tag between them, are one scene (2026-10-03): they
 * share one picture, and each line's cast includes everyone with a line
 * in it. Anything else (one row, a silent hold or a Crowd cutaway in
 * the run, no Action/Cast tag) is left exactly as before.
 */
function markSunnyBanksScene(scene: {
  actions: string[];
  cast: string[];
  looks: Array<{ name: string | null; look: string }>;
  rows: SunnyBanksScriptChunk[];
  ghost: boolean;
}): void {
  if (scene.ghost || scene.rows.length < 2) return;
  if (scene.actions.length === 0 && scene.cast.length === 0) return;
  if (scene.rows.some((row) => row.kind !== "speak")) return;
  const first = scene.rows[0];
  const sceneKey = `scene-${first.sourceLineIndex}`;
  const sceneAction = scene.actions.join(" ").trim();
  const sceneSpeakers = scene.rows
    .map((row) => row.characterName)
    .filter((name, i, all) => all.findIndex((n) => sameShotCastName(n, name)) === i);
  for (const row of scene.rows) {
    row.sceneKey = sceneKey;
    if (sceneAction) row.sceneAction = sceneAction;
    row.sceneSpeakers = sceneSpeakers;
    if (scene.cast.length > 0 && !row.castNames) row.castNames = [...scene.cast];
    if (row !== first && !row.castLooks) {
      const others = splitLooksForRow(scene.looks, row.characterName).others;
      if (others.length > 0) row.castLooks = others;
    }
  }
}

/** Empty `Name:` Hold — the inserted shot between two existing clips. */
export function buildSunnyBanksHoldScriptLine(characterName: string): string {
  const name = characterName.trim() || fallbackCharacterName();
  return `${name}:`;
}

export function insertSunnyBanksLineAfter(
  script: string,
  afterSourceLineIndex: number,
  line: string
): string {
  const lines = script.split(/\r?\n/);
  const at = Math.min(Math.max(afterSourceLineIndex + 1, 0), lines.length);
  lines.splice(at, 0, line);
  return lines.join("\n");
}

export function insertSunnyBanksLineBefore(
  script: string,
  beforeSourceLineIndex: number,
  line: string
): string {
  const lines = script.split(/\r?\n/);
  const at = Math.min(Math.max(beforeSourceLineIndex, 0), lines.length);
  lines.splice(at, 0, line);
  return lines.join("\n");
}

export function replaceSunnyBanksSourceLine(
  script: string,
  sourceLineIndex: number,
  nextLine: string
): string {
  const lines = script.split(/\r?\n/);
  if (sourceLineIndex < 0 || sourceLineIndex >= lines.length) return script;
  lines[sourceLineIndex] = nextLine;
  return lines.join("\n");
}

export function removeSunnyBanksSourceLine(script: string, sourceLineIndex: number): string {
  const lines = script.split(/\r?\n/);
  if (sourceLineIndex < 0 || sourceLineIndex >= lines.length) return script;
  lines.splice(sourceLineIndex, 1);
  return lines.join("\n");
}

/** Keep any leading `[Tag]` prefixes; replace the speaker + dialogue. */
export function rewriteSunnyBanksSpeakerLine(
  original: string,
  characterName: string,
  dialogue: string
): string {
  const name = characterName.trim() || fallbackCharacterName();
  let rest = original.trimEnd();
  const tags: string[] = [];
  const tagRe = /^(\[[^\]]+\]\s*)/;
  while (tagRe.test(rest)) {
    const match = rest.match(tagRe);
    if (!match) break;
    tags.push(match[1]);
    rest = rest.slice(match[1].length);
  }
  // A `[GROK]` / `[LTX]` / `[H3]` typed after the name stays on the line.
  const backend = extractVideoBackendOverride(rest).override;
  if (backend && !tags.some((tag) => extractVideoBackendOverride(tag).override)) {
    tags.push(`${videoBackendTagLabel(backend)} `);
  }
  const spoken = dialogue.replace(/\s+/g, " ").trim();
  const speaker = spoken.length > 0 ? `${name}: ${spoken}` : `${name}:`;
  return `${tags.join("")}${speaker}`;
}

/** Shift per-row override maps when a queue row is inserted at `insertAt`. */
export function shiftKeyedIndexRecord<T>(record: Record<number, T>, insertAt: number): Record<number, T> {
  const next: Record<number, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const index = Number(key);
    if (!Number.isInteger(index)) continue;
    next[index >= insertAt ? index + 1 : index] = value;
  }
  return next;
}

/** Drop `removeAt` and pull later keys down after an Idle row is removed. */
export function unshiftKeyedIndexRecord<T>(record: Record<number, T>, removeAt: number): Record<number, T> {
  const next: Record<number, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index === removeAt) continue;
    next[index > removeAt ? index - 1 : index] = value;
  }
  return next;
}

/** Speaker + spoken/hold text — stable across tag-only lines and a
 * re-parse that would otherwise mint a new `raw` / index. */
export function sunnyBanksDialogueKey(characterName: string, line: string): string {
  return `${characterName}\n${line}`;
}

export function sunnyBanksRuntimeMatchesChunk(
  stored: Pick<RowRuntime, "lineKey" | "characterName" | "line">,
  chunk: Pick<SunnyBanksScriptChunk, "raw" | "characterName" | "line">
): boolean {
  if (stored.lineKey === chunk.raw) return true;
  if (
    typeof stored.characterName === "string" &&
    typeof stored.line === "string" &&
    sunnyBanksDialogueKey(stored.characterName, stored.line) ===
      sunnyBanksDialogueKey(chunk.characterName, chunk.line)
  ) {
    return true;
  }
  const fromKey = matchSpeakerPrefix(stored.lineKey);
  if (fromKey) {
    return (
      sunnyBanksDialogueKey(fromKey.name, fromKey.rest) ===
      sunnyBanksDialogueKey(chunk.characterName, chunk.line)
    );
  }
  return false;
}

/**
 * Re-bind in-memory Done clips onto a freshly parsed queue. A tag-only
 * `[Location:]` / `[Character:]` / `[Action:]` line must not idle a
 * row whose speaker + dialogue still match a clip from this tab.
 * Unmatched previous entries are not deleted — Undo can restore the
 * script and they reattach.
 */
export function preserveRenderedRuntimes(
  chunks: readonly SunnyBanksScriptChunk[],
  previous: Record<number, RowRuntime>
): Record<number, RowRuntime> {
  const queue = sunnyBanksQueueChunks(chunks);
  const claimed = new Set<number>();
  const next: Record<number, RowRuntime> = {};
  const attach = (oldIndex: number, chunk: SunnyBanksScriptChunk, newIndex: number) => {
    claimed.add(oldIndex);
    const stored = previous[oldIndex];
    next[newIndex] = {
      ...stored,
      lineKey: chunk.raw,
      characterName: chunk.characterName,
      line: chunk.line,
    };
  };
  // Pass 1 (2026-09-30): every row that still sits on its own stored key
  // claims it first. Before, one pass ran top to bottom, so an inserted
  // `Shazza:` hold took a later `Shazza:` row's clip by content before
  // that row got to claim its own, and the later row went Idle.
  queue.forEach((chunk, index) => {
    if (previous[index] && !claimed.has(index) && sunnyBanksRuntimeMatchesChunk(previous[index], chunk)) {
      attach(index, chunk, index);
    }
  });
  // Pass 2: rows that moved (the script was edited by hand) find their
  // Done clip by speaker + line among the ones nobody claimed. A line
  // added above pushes rows down, so first a row looks only at clips
  // stored at or above its own number (nearest first); only then, for
  // lines removed above, at clips stored below it (nearest first). That
  // way a new look-alike line (`Shazza:`) can't take a clip belonging to
  // a later row that moved down.
  const candidates = (chunk: SunnyBanksScriptChunk) =>
    Object.keys(previous)
      .map((key) => Number(key))
      .filter(
        (i) =>
          Number.isInteger(i) &&
          !claimed.has(i) &&
          previous[i]?.status === "done" &&
          Boolean(previous[i]?.videoUrl) &&
          sunnyBanksRuntimeMatchesChunk(previous[i], chunk)
      );
  queue.forEach((chunk, index) => {
    if (index in next) return;
    const above = candidates(chunk).filter((i) => i <= index);
    if (above.length > 0) attach(Math.max(...above), chunk, index);
  });
  queue.forEach((chunk, index) => {
    if (index in next) return;
    const below = candidates(chunk).filter((i) => i > index);
    if (below.length > 0) attach(Math.min(...below), chunk, index);
  });
  return next;
}

function statusPillLabel(status: RowStatus): string {
  if (status === "rendering") return "Rendering...";
  if (status === "done") return "Done";
  if (status === "failed") return "Failed";
  return "Idle";
}

/** Closed-control fit at 390px — "Main Entrance Sign" → "Main Entrance".
 * Full label stays on `title` / aria. Not a parser, not gold. */
function compactQueueLocationLabel(label: string): string {
  const words = label.trim().split(/\s+/);
  return words.length <= 2 ? label : `${words[0]} ${words[1]}`;
}

function statusPillClass(status: RowStatus): string {
  if (status === "rendering") return "bg-amber-300/15 text-amber-100";
  if (status === "done") return "bg-emerald-400/15 text-emerald-200";
  if (status === "failed") return "bg-rose-400/15 text-rose-200";
  return "bg-white/10 text-white/55";
}

export function collectRenderedClips(args: {
  actIds: readonly string[];
  actScripts: ActKeyed<string>;
  runtimeMap: ActKeyed<Record<number, RowRuntime>>;
  characterOverrides: ActKeyed<Record<number, string>>;
}): SunnyBanksRenderedClip[] {
  const clips: SunnyBanksRenderedClip[] = [];
  for (const act of args.actIds) {
    const parsed = parseSunnyBanksScriptBlock(args.actScripts[act] ?? "");
    const chunks = sunnyBanksQueueChunks(parsed);
    const runtimes = args.runtimeMap[act] ?? {};
    const remapped = preserveRenderedRuntimes(parsed, runtimes);
    const overrides = args.characterOverrides[act] ?? {};
    chunks.forEach((chunk, index) => {
      const stored = remapped[index];
      if (!stored || stored.status !== "done" || !stored.videoUrl) {
        return;
      }
      clips.push({
        act,
        index,
        characterName: overrides[index] ?? chunk.characterName,
          lineLabel: chunk.line.length > 0 ? chunk.line : chunk.action?.trim() || "Silent hold",
        videoUrl: stored.videoUrl,
        durationSec: stored.durationSec,
        ...(stored.videoBackend ? { videoBackend: stored.videoBackend } : {}),
        ...(stored.castNames && stored.castNames.length > 1 ? { castNames: stored.castNames } : {}),
      });
    });
  }
  return clips;
}

/**
 * The CLIPS strip as one sideways row per act (2026-09-30): every act in
 * act order, each with its clips (possibly none). Pure grouping of
 * `collectRenderedClips`' output; nothing saved changes.
 */
export function groupSunnyBanksClipsByAct(
  actIds: readonly SunnyBanksActId[],
  clips: readonly SunnyBanksRenderedClip[]
): { act: SunnyBanksActId; clips: SunnyBanksRenderedClip[] }[] {
  return actIds.map((act) => ({ act, clips: clips.filter((clip) => clip.act === act) }));
}

/**
 * Whether an act's clip row is open. A tap on its label wins (kept in
 * component state only, never saved); otherwise the act being edited or
 * rendered is open, and any other act is open when it has clips.
 */
export function isSunnyBanksClipRowOpen(args: {
  act: SunnyBanksActId;
  clipCount: number;
  activeAct: SunnyBanksActId;
  toggled?: boolean;
}): boolean {
  if (typeof args.toggled === "boolean") return args.toggled;
  return args.act === args.activeAct || args.clipCount > 0;
}

/**
 * Remove on a clip in the CLIPS strip (2026-09-30): the row that clip
 * belongs to goes back to Idle, so "Render 1 line" makes it again. Same
 * Remove as Music video's rendered-clips shelf, but no file is deleted —
 * the MP4 stays in Blob, and a new render saves beside it as `-v2`
 * (`putDeckMediaOrLegacy` never overwrites).
 *
 * Works on the act's runtimes as the screen shows them
 * (`preserveRenderedRuntimes`), since a Done clip can sit under an older
 * row number after shots were inserted. Entries the screen doesn't use
 * are kept where they were, except the removed clip itself, so it
 * can't re-attach to this row or a look-alike one.
 */
export function resetSunnyBanksClipRuntime(
  script: string,
  runtimes: Record<number, RowRuntime>,
  index: number
): Record<number, RowRuntime> {
  const parsed = parseSunnyBanksScriptBlock(script);
  const chunk = sunnyBanksQueueChunks(parsed)[index];
  if (!chunk) return runtimes;
  const removedUrl = preserveRenderedRuntimes(parsed, runtimes)[index]?.videoUrl;
  const next = normalizeSunnyBanksActRuntimes(script, runtimes, removedUrl);
  next[index] = idleRuntimeFor(chunk);
  return next;
}

function idleRuntimeFor(chunk: SunnyBanksScriptChunk): RowRuntime {
  return { lineKey: chunk.raw, status: "idle", characterName: chunk.characterName, line: chunk.line };
}

/**
 * An act's saved runtimes re-keyed to the rows as the screen shows them
 * (2026-09-30). Rows are stored by row number, and the screen already
 * follows a clip whose row moved (`preserveRenderedRuntimes`), but the
 * store kept the old numbers. Writing a new render at its new number
 * then landed on another row's old key and wiped that row's Done clip
 * (Stuart: after a "+" between rows 15 and 16, the "It bloody well is…"
 * row went Idle and wanted billing again). Every write goes through this
 * first, so the stored number always matches the row on screen.
 *
 * Entries the screen doesn't use stay where they were (nothing is thrown
 * away), except ones whose clip is already shown on another row or is
 * `dropUrl`.
 */
export function normalizeSunnyBanksActRuntimes(
  script: string,
  runtimes: Record<number, RowRuntime>,
  dropUrl?: string
): Record<number, RowRuntime> {
  const shown = preserveRenderedRuntimes(parseSunnyBanksScriptBlock(script), runtimes);
  const shownUrls = new Set(
    Object.values(shown)
      .map((r) => r.videoUrl)
      .filter((u): u is string => Boolean(u))
  );
  const next: Record<number, RowRuntime> = {};
  for (const [key, stored] of Object.entries(runtimes)) {
    const k = Number(key);
    if (!Number.isInteger(k) || k in shown) continue;
    if (stored.videoUrl && (stored.videoUrl === dropUrl || shownUrls.has(stored.videoUrl))) continue;
    next[k] = stored;
  }
  return Object.assign(next, shown);
}

/** One row's runtime written at its row number, after re-keying the rest (see above). */
export function writeSunnyBanksRowRuntime(
  script: string,
  runtimes: Record<number, RowRuntime>,
  index: number,
  row: RowRuntime
): Record<number, RowRuntime> {
  return { ...normalizeSunnyBanksActRuntimes(script, runtimes), [index]: row };
}

/**
 * Runtimes after a "+" puts a new row at `insertAt` (`scriptAfter` is the
 * script with it in). Every row at or below moves down one with its clip,
 * and the new row starts Idle, so it can't borrow a look-alike row's clip.
 */
export function shiftSunnyBanksRuntimesForInsert(
  scriptBefore: string,
  scriptAfter: string,
  runtimes: Record<number, RowRuntime>,
  insertAt: number
): Record<number, RowRuntime> {
  const next = shiftKeyedIndexRecord(normalizeSunnyBanksActRuntimes(scriptBefore, runtimes), insertAt);
  const inserted = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(scriptAfter))[insertAt];
  if (inserted) next[insertAt] = idleRuntimeFor(inserted);
  return next;
}

/** Runtimes after − drops the row at `removeAt`: every row below moves up one with its clip. */
export function shiftSunnyBanksRuntimesForRemove(
  scriptBefore: string,
  runtimes: Record<number, RowRuntime>,
  removeAt: number
): Record<number, RowRuntime> {
  return unshiftKeyedIndexRecord(normalizeSunnyBanksActRuntimes(scriptBefore, runtimes), removeAt);
}

/** Prompts for any episode source — the live working copy, or a saved
 * card straight off the EPISODES row. Parameterised (2026-09-18) so
 * "download that episode" doesn't have to load it into the editor
 * first, which would quietly replace whatever is open. */
export function collectSunnyBanksEpisodePrompts(source: {
  actIds: readonly SunnyBanksActId[];
  actScripts: ActKeyed<string>;
  characterOverrides: ActKeyed<Record<number, string>>;
  locationOverrides: ActKeyed<Record<number, SunnyBanksLocationId>>;
  locationPickTags?: ActKeyed<Record<number, SunnyBanksLocationId>>;
  defaultLocationId: SunnyBanksLocationId;
}) {
  const look = studioGenreProfile(helperGenre()).look;
  const prompts: Array<{
    act: SunnyBanksActId;
    index: number;
    characterName: string;
    kind: BeatKind;
    line: string;
    locationId: string;
    prompt: string;
  }> = [];
  for (const act of source.actIds) {
    const chunks = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(source.actScripts[act] ?? ""));
    const overrides = source.characterOverrides[act] ?? {};
    const locations = source.locationOverrides[act] ?? {};
    const pickTags = source.locationPickTags?.[act] ?? {};
    chunks.forEach((chunk, index) => {
      const characterName = overrides[index] ?? chunk.characterName;
      const lock = speakerLock(characterName);
      const locationId = resolveSunnyBanksRowLocationId(chunk, locations[index], pickTags[index], source.defaultLocationId);
      const kind = chunk.kind;
      const extra = [chunk.action, chunk.appearanceModifier].filter(Boolean).join(" ");
      const gold = lock
        ? kind === "hold"
          ? buildSunnyBanksHoldPrompt(lock, chunk.action, look)
          : buildSunnyBanksSpeakingPrompt(lock, chunk.line, look)
        : kind === "hold"
          ? buildSunnyBanksLocationCutawayPrompt(chunk.action)
          : "";
      const prompt = lock ? appendSunnyBanksActionToPrompt(gold, extra) : gold;
      prompts.push({
        act,
        index,
        characterName,
        kind,
        line: chunk.line,
        locationId,
        prompt,
      });
    });
  }
  return prompts;
}

/** The panel root's id: the pencil on an EPISODES card scrolls here. */
export const SUNNY_BANKS_EDITOR_ID = "sunny-banks-editor";

/** Everything the episode zip needs: a saved card or the live copy. */
export interface SunnyBanksEpisodeZipSource {
  title: string;
  defaultLocationId: SunnyBanksLocationId;
  actIds: readonly SunnyBanksActId[];
  actScripts: ActKeyed<string>;
  characterOverrides: ActKeyed<Record<number, string>>;
  locationOverrides: ActKeyed<Record<number, SunnyBanksLocationId>>;
  locationPickTags?: ActKeyed<Record<number, SunnyBanksLocationId>>;
  runtimeMap: ActKeyed<Record<number, RowRuntime>>;
  /** The episode's Extras (2026-10-04), into the zip's `extras/` folder. */
  extras?: readonly EpisodeExtra[];
}

/**
 * Zip one episode (script + gold prompts + every finished clip) and hand
 * it to the browser as a download. Moved out of the panel (2026-09-30)
 * so the download icon on each EPISODES card can use it; the panel's own
 * Download Episode button is gone.
 *
 * Live QA (2026-09-18): a 64-clip episode over a phone connection takes
 * minutes, so `onProgress` reports each clip, and the result says how
 * many clips actually made it in (a dropped stream is skipped rather
 * than sinking the whole zip).
 */
export async function downloadSunnyBanksEpisodeZip(
  source: SunnyBanksEpisodeZipSource,
  onProgress?: (progress: { done: number; total: number }) => void
): Promise<{ clipCount: number; fetchedClipCount: number; extraCount: number; fetchedExtraCount: number }> {
  const clips = collectRenderedClips({
    actIds: source.actIds,
    actScripts: source.actScripts,
    runtimeMap: source.runtimeMap,
    characterOverrides: source.characterOverrides,
  });
  const result = await buildSunnyBanksEpisodeBundle({
    title: source.title,
    defaultLocationId: source.defaultLocationId,
    actIds: source.actIds,
    actScripts: source.actScripts,
    prompts: collectSunnyBanksEpisodePrompts(source),
    clips,
    onProgress,
    extras: episodeExtrasZipEntries(source.extras ?? []),
  });
  const zipBlob = new Blob([result.zipBytes.slice().buffer], { type: "application/zip" });
  triggerBlobDownload(zipBlob, result.filename);
  return {
    clipCount: result.clipCount,
    fetchedClipCount: result.fetchedClipCount,
    extraCount: result.extraCount,
    fetchedExtraCount: result.fetchedExtraCount,
  };
}


/**
 * On-page God Script cheat sheet (2026-09-18, Stuart's ask: "add this as
 * a cheat sheet somewhere on the page so we can always refer back to it
 * when we're writing the next lot of scripts").
 *
 * Default closed and collapsed behind its own 44px row, same pattern as
 * "Show Script Text & Queued Lines" — a reference panel that pushed the
 * Clips shelf off a 390px screen would be worse than no reference at
 * all. Cast and location lists come from `SUNNY_BANKS_CAST` /
 * `SUNNY_BANKS_LOCATIONS` via `lib/sunnyBanksGodScriptGuide.ts`, so a
 * new location can never leave this panel quietly lying.
 *
 * The Copy button hands over the same rules as one prompt for whatever
 * LLM is drafting the scripts — that is where these scripts actually
 * come from, so the cheat sheet being human-readable only would mean
 * re-typing the rules into a chat window every session. Clipboard
 * failure is reported, never swallowed: a silent no-op on a copy button
 * is indistinguishable from a copy that worked.
 */
/**
 * Full-screen God Script editor (2026-09-18, Stuart's ask: "open the God
 * Script box to full screen and edit everything in there without it
 * updating before we update... rather than trying to read it in a tiny
 * little window").
 *
 * The point is the **draft buffer**, not the size. The inline textarea
 * re-parses the whole script on every keystroke, which re-derives the
 * queue as you type: a half-finished line stops matching its rendered
 * clip, so `preserveRenderedRuntimes` can't rebind it and the row
 * flickers back to Idle mid-edit. Nothing is billed by that — Render is
 * still a deliberate tap — but it makes a long edit unreadable. Here the
 * text lives in local React state and touches nothing until **Done**,
 * which runs the same `onApply` (`handleScriptChange`) one time.
 *
 * **Deliberate trade-off, stated in the sheet itself**: while this is
 * open the draft is NOT saved. The rest of this panel autosaves on every
 * keystroke (`patchSunnyBanksLive` → `persist`), and this one screen
 * opts out of that, because not-updating-until-we-update is the whole
 * request. So the header says so in as many words, and Cancel on a
 * changed draft asks first. A localStorage draft mirror with a "recover
 * your draft?" prompt on reopen is the obvious next step if a real
 * session ever loses work here; not built speculatively.
 *
 * Reuses `SunnyBanksScriptHighlightOverlay` so the tag colours (and the
 * "white text means the parser doesn't know this and will read it out
 * loud" tell) work at full size too, and carries its own Format button
 * since reflowing a pasted block is the main reason to be in here.
 */
function SunnyBanksFullScreenScriptEditor({
  initialText,
  onApply,
  onClose,
}: {
  initialText: string;
  onApply: (next: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const formatFeedback = useScriptFormatFeedback();
  const handleFormat = () => {
    const formatted = formatSunnyBanksGodScript(draft);
    if (formatted !== draft) setDraft(formatted);
    formatFeedback.show(formatted !== draft);
  };
  const dirty = draft !== initialText;

  const handleCancel = () => {
    if (dirty && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={handleCancel}
          className="min-h-[44px] shrink-0 px-1 text-[13px] font-medium text-white/60"
        >
          {confirmingDiscard ? "Discard?" : "Cancel"}
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-[12px] font-semibold text-white/80">
          {dirty ? "Editing — not saved yet" : "God Script"}
        </span>
        <button
          type="button"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
          className="min-h-[44px] shrink-0 rounded-md bg-amber-300 px-4 text-[13px] font-semibold text-zinc-950"
        >
          Done
        </button>
      </div>

      {confirmingDiscard && (
        <p role="alert" className="border-b border-white/10 px-3 py-2 text-[11px] leading-snug text-rose-300/90">
          Tap Discard again to throw these edits away, or Done to keep them.
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        <SunnyBanksScriptHighlightOverlay text={draft} overlayRef={overlayRef} />
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setConfirmingDiscard(false);
          }}
          onScroll={(e) => {
            if (overlayRef.current) {
              overlayRef.current.scrollTop = e.currentTarget.scrollTop;
              overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          onPaste={(e) => {
            const raw = e.clipboardData.getData("text/plain") || e.clipboardData.getData("text");
            const decoded = decodeSunnyBanksPastedScript(raw);
            if (decoded === raw) return;
            e.preventDefault();
            const el = e.currentTarget;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;
            setDraft(`${el.value.slice(0, start)}${decoded}${el.value.slice(end)}`);
          }}
          autoFocus
          spellCheck={false}
          aria-label="God Script full screen editor"
          className="relative z-10 h-full w-full resize-none bg-transparent px-3 py-2 text-base leading-6 text-transparent caret-amber-300 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={handleFormat}
          disabled={!draft.trim()}
          aria-live="polite"
          className="min-h-[40px] shrink-0 rounded-md bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
        >
          {formatFeedback.label}
        </button>
        <p className="min-w-0 flex-1 text-[10px] leading-snug text-white/40">
          Nothing re-parses until you tap Done. Coloured text is a tag the app understands —
          white text gets spoken out loud.
        </p>
      </div>
    </div>
  );
}

function SunnyBanksGodScriptCheatSheet({ genre = "sunnybank" }: { genre?: StudioGenre }) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopyPrompt = async () => {
    try {
      const prompt = inStudioGenre(genre, () => buildSunnyBanksGodScriptPrompt(locationList(), guideCast(), genre));
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left"
      >
        <span className="text-[12px] font-semibold text-white/80">God Script Cheat Sheet</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="flex touch-pan-y flex-col gap-3 overscroll-y-contain px-3 pb-3">
          <p className="text-[11px] leading-snug text-amber-200/80">
            Every queue row is a paid render. A line the parser doesn&apos;t recognise isn&apos;t
            skipped — it gets spoken out loud in a real clip.
          </p>
          {genre === "skidmarks" && (
            <p className="text-[11px] leading-snug text-white/60">{SKIDMARKS_GOD_SCRIPT_NOTE}</p>
          )}
          {genre === "shorts" && (
            <p className="text-[11px] leading-snug text-white/60">{SHORTS_GOD_SCRIPT_NOTE}</p>
          )}

          <div className="flex flex-col gap-2.5">
            {SUNNY_BANKS_GOD_SCRIPT_RULES.map((rule) => (
              <div key={rule.title} className="flex flex-col gap-1">
                <p className="text-[11px] font-semibold text-white/75">{rule.title}</p>
                {rule.body.map((paragraph) => (
                  <p key={paragraph} className="text-[11px] leading-snug text-white/50">
                    {paragraph}
                  </p>
                ))}
                {rule.example && (
                  <pre className="overflow-x-auto whitespace-pre rounded-lg bg-black/40 px-2 py-1.5 text-[10px] leading-relaxed text-white/60">
                    {rule.example}
                  </pre>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold text-white/75">Who can speak</p>
            <p className="text-[11px] leading-snug text-white/50">
              {listSunnyBanksSpeakingCast(guideCast()).join(", ")} — exact spelling and capitals. Any other
              name with an empty line is a location shot with nobody in it.
            </p>
            {listSunnyBanksNonSpeakingCast(guideCast()).length > 0 && (
              <p className="text-[11px] leading-snug text-white/40">
                Not speaking yet:{" "}
                {listSunnyBanksNonSpeakingCast(guideCast())
                  .map((c) => `${c.name} (${c.note})`)
                  .join(", ")}
                .
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold text-white/75">Location ids</p>
            <div className="flex flex-col gap-0.5">
              {listSunnyBanksLocationIds(locationList()).map(({ id, label }) => (
                <p key={id} className="text-[11px] leading-snug text-white/50">
                  <span className="text-yellow-300/90">{id}</span> — {label}
                </p>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-white/40">
              From the Locations row. An id that isn&apos;t on it gets a red warning on its row and
              won&apos;t render.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold text-white/75">A correct script</p>
            <pre className="overflow-x-auto whitespace-pre rounded-lg bg-black/40 px-2 py-1.5 text-[10px] leading-relaxed text-white/60">
              {SUNNY_BANKS_GOD_SCRIPT_EXAMPLE}
            </pre>
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="min-h-[40px] rounded-md border border-white/15 bg-white/[0.04] px-3 text-[12px] font-semibold text-white/80"
            >
              Copy these rules as an AI prompt
            </button>
            {copyState === "copied" && (
              <p role="status" className="text-[10px] leading-snug text-emerald-300/90">
                Copied — paste it into your script-writing chat.
              </p>
            )}
            {copyState === "failed" && (
              <p role="alert" className="text-[10px] leading-snug text-rose-300/90">
                This browser blocked the clipboard. Long-press the example above to select
                instead.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A tiny zip-file icon (the act zip in CLIPS). */
function ZipIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
      <path d="M5.5 2.75h6l3 3v11.5h-9V2.75Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 3v1.5M10.5 4.5V6M9 6v1.5M10.5 7.5V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="8.5" y="10" width="2.5" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function SkidmarksSunnyBanksPanel({ genre = "sunnybank" }: { genre?: StudioGenre } = {}) {
  // The script helpers read the open show's cast and locations
  // (`helperGenre()`: the session's project, which is also what put this
  // panel on screen with this `genre`).
  const studioState = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const studio = getStudioState(genre, studioState);
  // Shorts (2026-10-05): an older shot-card episode (EP01–EP03) opens here
  // too, converted to a script on the fly (`lib/shortsShotCardStudio.ts`).
  const shotCardLive = genre === "shorts" ? shortsShotCardStudioLive(studioState) : null;
  const live = shotCardLive ?? studio?.live ?? getSunnyBanksLiveOrDefault(studioState, genre);
  /** Every edit of this show's live episode (auto-saved onto its card),
   * with the script helpers on this show even if it lands after a render.
   * The first edit of a converted shot-card episode saves it as a script
   * episode (`adoptShortsShotCardLive`); just opening it saves nothing. */
  const patchLive = (updater: (prev: SunnyBanksLiveState) => SunnyBanksLiveState) => {
    const inGenre = (prev: SunnyBanksLiveState) => inStudioGenre(genre, () => updater(prev));
    const shotCardBase = genre === "shorts" ? shortsShotCardStudioLive(getSkidmarksSnapshot()) : null;
    if (shotCardBase) adoptShortsShotCardLive(shotCardBase, inGenre);
    else patchSunnyBanksLive(inGenre, genre);
  };
  const actIds = live.actIds;
  const activeAct = live.activeAct;
  const actScripts = live.actScripts;
  // Skidmarks has no built-in place: its first saved location until one is picked.
  const defaultLocationId = live.defaultLocationId || defaultScriptLocationId();
  const characterOverridesByAct = live.characterOverrides;
  const locationOverridesByAct = live.locationOverrides;
  const locationPickTagsByAct = live.locationPickTags ?? {};
  const runtimeMapByAct = live.runtimeMap;
  const workspaceTitle = live.workspaceTitle;
  /** The show's engines (2026-10-04): Shorts adds Siray for silent rows and plates. */
  const profile = studioGenreProfile(genre);
  /** The silent-row switch (saved with the session): Grok/H3, or Siray/Grok/H3 on Shorts. */
  const silentShotBackend = studioSilentBackend(genre, studio?.silentShotBackend);
  /** The plate switch (Shorts: Siray or Grok); every other show plates on Grok. */
  const plateEngine = studioPlateEngine(genre, studio?.plateEngine);
  const offersPlateSwitch = profile.plateEngines.length > 1;
  const plateCostUsd = plateEngine === "siray" ? SIRAY_STILL_COST_USD : ESTIMATED_STILL_COST_USD;
  /** The row whose "Make plate" is running (2026-10-04). */
  const [platingIndex, setPlatingIndex] = useState<number | null>(null);
  /** The free H3 key check's last answer, shown next to the switch. */
  const [h3KeyCheck, setH3KeyCheck] = useState<string | null>(null);
  const [runningKind, setRunningKind] = useState<BeatKind | null>(null);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [clipsOpen, setClipsOpen] = useState(true);
  /** The clip whose Remove was tapped, waiting on the confirm. */
  const [pendingClipRemove, setPendingClipRemove] = useState<SunnyBanksRenderedClip | null>(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptUndo, setScriptUndo] = useState<ScriptUndoSnapshot | null>(null);
  /** The acts row scrolls sideways, so a freshly added act can land
   * past the right edge — `handleAddAct` scrolls it into view rather
   * than leaving Stuart to discover it by swiping. */
  const actStripRef = useRef<HTMLDivElement>(null);
  const scriptHighlightRef = useRef<HTMLDivElement>(null);
  const locationDataUrlCacheRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);
  /** Stop (2026-09-30): the queue ends before the next line starts; the
   * line that's rendering finishes and saves. */
  const stopRequestedRef = useRef(false);
  const [stopRequested, setStopRequested] = useState(false);

  const scriptText = actScripts[activeAct] ?? "";
  const characterOverrides = characterOverridesByAct[activeAct] ?? {};
  const locationOverrides = locationOverridesByAct[activeAct] ?? {};
  const locationPickTags = locationPickTagsByAct[activeAct] ?? {};
  const parsed = parseSunnyBanksScriptBlock(scriptText);
  const remappedRuntime = preserveRenderedRuntimes(parsed, runtimeMapByAct[activeAct] ?? {});
  const running = runningKind !== null;
  // Tell the episode row above (outside this panel) not to swap episodes
  // while a clip renders.
  useEffect(() => {
    setSunnyBanksBusy(running, "render");
  }, [running]);
  useEffect(() => () => setSunnyBanksBusy(false, "render"), []);

  const runtimeFor = (index: number, raw: string): RowRuntime => {
    return remappedRuntime[index] ?? { lineKey: raw, status: "idle" };
  };

  // The Locations row's list (or the built-ins until it has one).
  // Skidmarks (2026-10-04): only the open episode's own places.
  const locations = studioLocationList(studioState, genre);
  // Skidmarks (2026-10-04): the open episode's own Cast; everyone in it
  // is in the episode (the episode tick row from PR 242 is gone).
  const castCardList = sunnyBanksCastCards(studioState, genre);
  /** A row's character picker: the show's cast, voiced first
   * (Skidmarks: the open episode's own Cast). */
  const rowSpeakerChoices = sunnyBanksSpeakerList(studioState, genre);
  const queue = sunnyBanksQueueChunks(parsed).map((chunk, index) => {
    const characterName = characterOverrides[index] ?? chunk.characterName;
    const locationId = resolveSunnyBanksRowLocationId(chunk, locationOverrides[index], locationPickTags[index], defaultLocationId);
    const character = speakerLock(characterName);
    // An unknown location is never quietly swapped for the storefront
    // (EP01's Park Site 4 scene was): the row says so and Render waits.
    const locationProblem = sunnyBanksLocationProblem(locations, locationId);
    const location: SunnyBanksLocationLock = locations.find((l) => l.id === locationId) ?? {
      id: locationId,
      label: locationId,
      image: "",
    };
    const line = chunk.line;
    // Talking rows on LTX; silent rows on the switch, unless the line says
    // [GROK] / [LTX] / [H3] (a Grok/H3 tag on a talking row is ignored).
    const backendChoice = pickRowVideoBackend({
      kind: chunk.kind,
      override: chunk.videoBackend,
      silentDefault: silentShotBackend,
      silentOffered: profile.silentBackends,
    });
    // Who's in the shot (2026-10-03): the shared helper, same as every genre.
    const rowCast = resolveSunnyBanksRowCast(
      {
        kind: chunk.kind,
        characterName,
        cutaway: chunk.kind === "hold" && !character,
        action: chunk.action,
        sceneAction: chunk.sceneAction,
        castNames: chunk.castNames,
        castLooks: chunk.castLooks,
        sceneSpeakers: chunk.sceneSpeakers,
        appearanceModifier: chunk.appearanceModifier,
      },
      castCardList
    );
    return { chunk, index, characterName, character, location, locationProblem, line, kind: chunk.kind, backendChoice, rowCast };
  });
  type QueueRow = (typeof queue)[number];
  /** A scene's shared picture already made (a row in it kept its `plateUrl`). */
  // Only a picture made with these same people counts: change who's in
  // the shot and a new picture is made.
  const plateFor = (row: QueueRow, from: QueueRow): string | undefined => {
    const runtime = runtimeFor(from.index, from.chunk.raw);
    const names = row.rowCast.cast.names;
    const same =
      runtime.castNames?.length === names.length &&
      runtime.castNames.every((n) => names.some((m) => sameShotCastName(m, n)));
    return same ? runtime.plateUrl : undefined;
  };
  const savedScenePlate = (row: QueueRow): string | undefined => {
    if (!row.rowCast.cast.isMulti) return undefined;
    if (!row.chunk.sceneKey) return plateFor(row, row);
    for (const other of queue) {
      if (other.chunk.sceneKey !== row.chunk.sceneKey) continue;
      const url = plateFor(row, other);
      if (url) return url;
    }
    return undefined;
  };
  /** A one-person row's own plate (made with "Make plate", 2026-10-04), for this same person only. */
  const rowOwnPlate = (row: QueueRow): string | undefined => {
    if (row.rowCast.cast.isMulti || row.location.peopleInPicture || !row.character) return undefined;
    if (isSunnyBanksLocationCutaway(row.chunk)) return undefined;
    const runtime = runtimeFor(row.index, row.chunk.raw);
    const names = runtime.castNames ?? [];
    return names.length === 1 && sameShotCastName(names[0], row.character.name) ? runtime.plateUrl : undefined;
  };
  /** The plate this row would render from: its own, or its scene's shared one. */
  const rowPlate = (row: QueueRow): string | undefined =>
    row.rowCast.cast.isMulti ? savedScenePlate(row) : rowOwnPlate(row);
  /** A row that gets a plate made at all (not a cutaway, not a location with the people already in it). */
  const rowTakesPlate = (row: QueueRow): boolean =>
    Boolean(row.character) && !row.location.peopleInPicture && !isSunnyBanksLocationCutaway(row.chunk);
  /** Pictures this row still needs before it can render (one person or several). */
  const rowMissingPictures = (row: QueueRow): string[] => {
    if (row.location.peopleInPicture) return [];
    if (row.rowCast.cast.isMulti) {
      if (savedScenePlate(row)) return [];
      return row.rowCast.cast.missingPicture;
    }
    if (!row.character || isSunnyBanksLocationCutaway(row.chunk)) return [];
    if (rowOwnPlate(row)) return [];
    return resolveSunnyBanksStartImage(row.character) ? [] : [row.character.name];
  };
  /** The free pre-send check (2026-10-04, `lib/preSendChecks.ts`): the same rules every show uses. */
  const castNameList = castCardList.map((c) => c.name);
  const rowPreSend = (row: QueueRow): PreSendIssue[] => {
    if (!row.character || isSunnyBanksLocationCutaway(row.chunk)) return [];
    const inShot = row.rowCast.cast.names.length > 0 ? row.rowCast.cast.names : [row.character.name];
    return preSendChecks({
      kind: row.kind,
      speakerName: row.kind === "speak" ? row.character.name : null,
      inShotNames: inShot,
      castNames: castNameList,
      promptText: [row.chunk.action, row.chunk.sceneAction, row.chunk.appearanceModifier].filter(Boolean).join(" "),
      line: row.kind === "speak" ? row.line : undefined,
    });
  };

  const renderedClips = collectRenderedClips({
    actIds,
    actScripts,
    runtimeMap: runtimeMapByAct,
    characterOverrides: characterOverridesByAct,
  });
  const clipsByAct = groupSunnyBanksClipsByAct(actIds, renderedClips);
  /** Act rows Stuart tapped open or shut, per episode. Component state only. */
  const [clipRowToggles, setClipRowToggles] = useState<Record<string, boolean>>({});
  /** The clip tile that's open in the Clips grid (`"<act>:<line index>"`). Component state only. */
  const [openClipKey, setOpenClipKey] = useState<string | null>(null);
  /** The episode's pinned folder name (`ep01-the-first-fleet`) when it
   * has one, else its name. Read only: the zip never pins a folder. */
  const zipEpisodeName =
    live.mediaSlug ??
    studio?.workspaces.find((w) => w.id === live.episodeId)?.mediaSlug ??
    (live.workspaceTitle.trim() || "episode");
  /** Why an act's zip didn't start (rare: the page checks first). */
  const [zipNotice, setZipNotice] = useState<{ act: SunnyBanksActId; text: string } | null>(null);
  const clipRowKey = (act: SunnyBanksActId) => `${live.episodeId ?? ""}|${act}`;

  /** Finished shots collapse out of the way (2026-09-18, Stuart's ask).
   * Default closed: a real act is mostly Done rows once it has been
   * rendered once, and on a 390px phone six of them fill the screen
   * before the row you actually want to work on. Closed hides only
   * `status === "done"` rows — a failed row stays visible, because that
   * is unfinished work, not history. */
  const [doneRowsOpen, setDoneRowsOpen] = useState(false);

  const pendingRows = queue.filter((row) => runtimeFor(row.index, row.chunk.raw).status !== "done");
  /** Finished history vs. rows still worth looking at. A row that is
   * currently rendering is never hidden, even though it is about to
   * become Done — watching it is the whole point. */
  const doneRowCount = queue.length - pendingRows.length;
  const visibleQueue = doneRowsOpen
    ? queue
    : queue.filter(
        (row) => row.index === runningIndex || runtimeFor(row.index, row.chunk.raw).status !== "done"
      );

  const overlayCostUsd = pendingRows.length * plateCostUsd;
  // Per row, on the engine each row will use (estimates; LTX's is Deck's stand-in rate).
  const holdVideoCostUsd = pendingRows
    .filter((row) => row.kind === "hold")
    .reduce((sum, row) => sum + estimateRowVideoCostUsd(row.backendChoice.backend, SUNNY_BANKS_HOLD_DURATION_SEC), 0);
  const speakCount = pendingRows.filter((row) => row.kind === "speak").length;

  const canRenderAll =
    pendingRows.length > 0 &&
    !running &&
    platingIndex === null &&
    pendingRows.every((row) => {
      if (row.locationProblem || !row.location.image) return false;
      // The free pre-send check's blocks (the speaker isn't in the shot).
      if (preSendBlocks(rowPreSend(row))) return false;
      if (isSunnyBanksLocationCutaway(row.chunk)) return true;
      if (!row.character) return false;
      // No Cast card picture (anyone in the shot): never rendered (red note on the row).
      if (rowMissingPictures(row).length > 0) return false;
      if (row.kind === "speak") return !!row.character.voiceId && row.line.length > 0;
      return true;
    });

  const resolveLocationDataUrl = async (image: string): Promise<string> => {
    const cached = locationDataUrlCacheRef.current[image];
    if (cached) return cached;
    const dataUrl = await resolvePlateReferenceDataUrl(image);
    locationDataUrlCacheRef.current[image] = dataUrl;
    return dataUrl;
  };

  const postBeat = async (args: SunnyBanksBeatArgs): Promise<
    | {
        ok: true;
        videoUrl: string;
        durationSec: number;
        audioMuxed?: boolean;
        videoBackend?: RowVideoBackend;
        plateUrl?: string;
        castNames?: string[];
      }
    | { ok: false; message: string; plateUrl?: string; castNames?: string[]; pending?: true; sirayTaskId?: string }
  > => {
    const res = await fetch("/api/skidmarks/sunnybank/generate-speak-beat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...deckBuildHeaders() },
      body: JSON.stringify(sunnyBanksBeatRequestBody(args)),
    });
    const body = (await res.json()) as GenerateBeatResponseBody;
    const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";
    const plate = {
      ...(typeof body.plateUrl === "string" && /^https:\/\//i.test(body.plateUrl) ? { plateUrl: body.plateUrl } : {}),
      ...(Array.isArray(body.castNames) && body.castNames.every((n) => typeof n === "string")
        ? { castNames: body.castNames as string[] }
        : {}),
    };
    // Siray still rendering (2026-10-04): the panel checks back with the task id.
    if (res.status === 202 && body.pending === true && typeof body.sirayTaskId === "string" && body.sirayTaskId) {
      return { ok: false, pending: true, sirayTaskId: body.sirayTaskId, message: "Siray is still rendering.", ...plate };
    }
    if (!res.ok || !videoUrl) {
      const error = typeof body.error === "string" ? body.error : `Render failed (HTTP ${res.status}).`;
      return { ok: false, message: body.plateFailed === true ? plateFailedMessage(error) : error, ...plate };
    }
    return {
      ...plate,
      ok: true,
      videoUrl,
      durationSec: typeof body.durationSec === "number" ? body.durationSec : 0,
      audioMuxed: typeof body.audioMuxed === "boolean" ? body.audioMuxed : undefined,
      videoBackend:
        body.videoBackend === "ltx" || body.videoBackend === "grok" || body.videoBackend === "h3" || body.videoBackend === "siray"
          ? body.videoBackend
          : args.videoBackend ?? "ltx",
    };
  };

  /** Make plate first (2026-10-04): the row's plate only, saved; no voice, no video. */
  const postPlateOnly = async (
    args: SunnyBanksBeatArgs
  ): Promise<{ ok: true; plateUrl: string; castNames?: string[] } | { ok: false; message: string }> => {
    try {
      const res = await fetch("/api/skidmarks/sunnybank/generate-speak-beat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...deckBuildHeaders() },
        body: JSON.stringify(sunnyBanksBeatRequestBody(args)),
      });
      const body = (await res.json()) as GenerateBeatResponseBody;
      if (res.ok && typeof body.plateUrl === "string" && /^https:\/\//i.test(body.plateUrl)) {
        const castNames =
          Array.isArray(body.castNames) && body.castNames.every((n) => typeof n === "string") ? (body.castNames as string[]) : undefined;
        return { ok: true, plateUrl: body.plateUrl, ...(castNames ? { castNames } : {}) };
      }
      return { ok: false, message: plateFailedMessage(typeof body.error === "string" ? body.error : `HTTP ${res.status}`) };
    } catch (err) {
      return { ok: false, message: plateFailedMessage(err instanceof Error ? err.message : "network error") };
    }
  };

  /** Everything one row sends, for a render or a plate. */
  const rowBeatArgs = async (
    row: QueueRow,
    act: SunnyBanksActId,
    opts: { scenePlateUrl?: string; rowPlateUrl?: string; plateOnly?: boolean; sirayTaskId?: string; videoBackend?: RowVideoBackend; sceneFirstRowNumber: number }
  ): Promise<SunnyBanksBeatArgs> => {
    const lock = inStudioGenre(genre, () => speakerLock(row.characterName));
    const startImageDataUrl = await resolveLocationDataUrl(row.location.image);
    return sunnyBanksRowBeatArgs({
      chunk: row.chunk,
      characterName: lock?.name ?? row.characterName,
      speaker: sunnyBanksSpeakerRequestExtras(lock, genre),
      location: row.location,
      startImageDataUrl,
      rowCast: row.rowCast,
      videoBackend: opts.videoBackend ?? row.backendChoice.backend,
      act,
      // A converted shot-card episode not saved yet: its own folder, nothing pinned.
      episodeSlug:
        (genre === "shorts" ? shortsShotCardStudioLive(getSkidmarksSnapshot())?.mediaSlug : undefined) ??
        ensureSunnyBanksEpisodeMediaSlug(genre),
      rowNumber: row.index + 1,
      sceneFirstRowNumber: opts.sceneFirstRowNumber,
      scenePlateUrl: opts.scenePlateUrl,
      genre,
      rowPlateUrl: opts.rowPlateUrl,
      plateOnly: opts.plateOnly,
      // Only a show with a plate switch says which engine (Sunny Banks' request is unchanged).
      plateEngine: offersPlateSwitch ? plateEngine : undefined,
      sirayTaskId: opts.sirayTaskId,
    });
  };

  /** One row's runtime, written onto the live episode (auto-saved onto its card). */
  const writeRowRuntime = (act: SunnyBanksActId, index: number, next: RowRuntime) => {
    const row = queue[index];
    const stamped: RowRuntime = {
      ...next,
      characterName: next.characterName ?? row?.characterName,
      line: next.line ?? row?.line ?? "",
    };
    patchLive((prev) => ({
      ...prev,
      runtimeMap: {
        ...prev.runtimeMap,
        [act]: writeSunnyBanksRowRuntime(prev.actScripts[act] ?? "", prev.runtimeMap[act] ?? {}, index, stamped),
      },
    }));
  };

  /** The row number a scene's shared picture is named after (its first line). */
  const firstSceneRowNumber = (row: QueueRow): number => {
    const first = row.chunk.sceneKey ? queue.find((q) => q.chunk.sceneKey === row.chunk.sceneKey) : undefined;
    return (first ?? row).index + 1;
  };

  /** "Make plate" / "Remake plate" on one row (2026-10-04): ~$0.02–0.04, and the cheap check for a refusal before the paid clip. */
  /** A refused or failed "Make plate" (its act and row). Cleared when that row is plated or rendered again. */
  const [plateNotice, setPlateNotice] = useState<{ act: SunnyBanksActId; index: number; text: string } | null>(null);
  const handleMakePlate = async (row: QueueRow) => {
    if (runningRef.current || !rowTakesPlate(row) || !row.location.image || row.locationProblem) return;
    const act = activeAct;
    const lock = inStudioGenre(genre, () => speakerLock(row.characterName));
    if (!lock) return;
    runningRef.current = true;
    setPlatingIndex(row.index);
    setPlateNotice(null);
    try {
      const made = await postPlateOnly(
        await rowBeatArgs(row, act, { plateOnly: true, sceneFirstRowNumber: firstSceneRowNumber(row) })
      );
      if (!made.ok) {
        setPlateNotice({ act, index: row.index, text: made.message });
        return;
      }
      const castNames = made.castNames && made.castNames.length > 1 ? made.castNames : [lock.name];
      writeRowRuntime(act, row.index, { lineKey: row.chunk.raw, status: "idle", plateUrl: made.plateUrl, castNames });
    } catch (err) {
      setPlateNotice({ act, index: row.index, text: plateFailedMessage(err instanceof Error ? err.message : "network error") });
    } finally {
      runningRef.current = false;
      setPlatingIndex(null);
    }
  };

  /** Free check that MiniMax accepts the server's key (lists one task,
   * starts nothing). */
  const handleCheckH3Key = async () => {
    setH3KeyCheck("Checking…");
    try {
      const res = await fetch("/api/skidmarks/h3-key-check", { cache: "no-store" });
      const body = (await res.json()) as { status?: unknown; message?: unknown };
      const message = typeof body.message === "string" ? body.message : "";
      setH3KeyCheck(
        body.status === "ok"
          ? "H3 key works."
          : body.status === "missing"
            ? "No MINIMAX_API_KEY on the server."
            : body.status === "rejected"
              ? `MiniMax refused the key${message ? `: ${message}` : "."}`
              : `Couldn't check${message ? `: ${message}` : "."}`
      );
    } catch {
      setH3KeyCheck("Couldn't reach Deck to check.");
    }
  };

  /** Remove on a clip: its row goes back to Idle (no file deleted), ready for "Render 1 line". */
  const handleRemoveClip = (clip: SunnyBanksRenderedClip) => {
    if (runningRef.current) return;
    patchLive((prev) => ({
      ...prev,
      runtimeMap: {
        ...prev.runtimeMap,
        [clip.act]: resetSunnyBanksClipRuntime(prev.actScripts[clip.act] ?? "", prev.runtimeMap[clip.act] ?? {}, clip.index),
      },
    }));
  };

  /** How many times a Siray silent shot is checked on (each check waits up to ~30 s on the server). */
  const SIRAY_CHECKS = 20;

  /**
   * One row: its plate first when it needs one on Siray (a slow engine
   * never shares a call with the video), then the clip. Shared by Render
   * all and "Try with Grok". `false` stops the queue.
   */
  const renderRow = async (
    row: QueueRow,
    i: number,
    act: SunnyBanksActId,
    ctx: { scenePlatesThisRun: Record<string, string>; videoBackend?: RowVideoBackend }
  ): Promise<boolean> => {
    const writeRuntime = (index: number, next: RowRuntime) => writeRowRuntime(act, index, next);
    // An old "Plate not made" note goes: this render says what happens now.
    setPlateNotice((n) => (n && n.act === act && n.index === i ? null : n));
    const lock = inStudioGenre(genre, () => speakerLock(row.characterName));
    const cutaway = inStudioGenre(genre, () => isSunnyBanksLocationCutaway(row.chunk));
    if ((!lock && !cutaway) || !row.location.image || row.locationProblem) {
      writeRuntime(i, {
        lineKey: row.chunk.raw,
        status: "failed",
        error: row.locationProblem ?? "Character or location is missing.",
      });
      return false;
    }
    const before = runtimeFor(row.index, row.chunk.raw);
    const backend = ctx.videoBackend ?? row.backendChoice.backend;
    // Shared picture for a scene: one made earlier this run, or kept on a row.
    let scenePlateUrl = row.rowCast.cast.isMulti
      ? ((row.chunk.sceneKey ? ctx.scenePlatesThisRun[row.chunk.sceneKey] : undefined) ?? savedScenePlate(row))
      : undefined;
    let rowPlateUrl = rowOwnPlate(row);
    const missing = row.rowCast.cast.isMulti && scenePlateUrl ? [] : rowMissingPictures(row);
    if (lock && !cutaway && missing.length > 0) {
      writeRuntime(i, { lineKey: row.chunk.raw, status: "failed", error: missingCastPictureMessage(missing[0]) });
      return false;
    }
    setRunningKind(row.kind);
    setRunningIndex(i);
    /** The plate this row keeps while it renders (and after, if the clip fails). */
    let keptPlate: Pick<RowRuntime, "plateUrl" | "castNames"> =
      rowPlateUrl && before.castNames ? { plateUrl: rowPlateUrl, castNames: before.castNames } : {};
    writeRuntime(i, { lineKey: row.chunk.raw, status: "rendering", ...keptPlate });
    const engine = videoBackendName(backend);
    setProgressText(
      cutaway
        ? `Line ${i + 1} of ${queue.length} — cutaway at ${row.location.label} on ${engine} (~${SUNNY_BANKS_HOLD_DURATION_SEC}s)…`
        : row.kind === "hold"
          ? `Line ${i + 1} of ${queue.length} — holding ${lock!.name} at ${row.location.label} on ${engine} (~${SUNNY_BANKS_HOLD_DURATION_SEC}s)…`
          : `Line ${i + 1} of ${queue.length} — rendering ${lock!.name}'s line…`
    );
    try {
      // A Siray plate is its own call first (2026-10-04): it is slow, and a
      // refused or failed plate stops here, before the paid clip.
      const needsPlate =
        lock && !cutaway && rowTakesPlate(row) && (row.rowCast.cast.isMulti ? !scenePlateUrl : !rowPlateUrl);
      if (needsPlate && plateEngine === "siray") {
        setProgressText(`Line ${i + 1} of ${queue.length} — making the plate on Siray (~$${plateCostUsd.toFixed(2)})…`);
        const made = await postPlateOnly(
          await rowBeatArgs(row, act, { plateOnly: true, sceneFirstRowNumber: firstSceneRowNumber(row) })
        );
        if (!made.ok) {
          writeRuntime(i, { lineKey: row.chunk.raw, status: "failed", error: made.message });
          return false;
        }
        if (row.rowCast.cast.isMulti) {
          scenePlateUrl = made.plateUrl;
          if (row.chunk.sceneKey) ctx.scenePlatesThisRun[row.chunk.sceneKey] = made.plateUrl;
        } else {
          rowPlateUrl = made.plateUrl;
        }
        keptPlate = {
          plateUrl: made.plateUrl,
          castNames: made.castNames && made.castNames.length > 1 ? made.castNames : [lock.name],
        };
        writeRuntime(i, { lineKey: row.chunk.raw, status: "rendering", ...keptPlate });
        setProgressText(`Line ${i + 1} of ${queue.length} — plate made, now the clip on ${engine}…`);
      }
      const argsFor = (sirayTaskId?: string) =>
        rowBeatArgs(row, act, {
          scenePlateUrl,
          rowPlateUrl,
          sirayTaskId,
          videoBackend: backend,
          sceneFirstRowNumber: firstSceneRowNumber(row),
        });
      // A Siray shot still rendering from before is checked on, never paid for twice.
      let result = await postBeat(await argsFor(backend === "siray" ? before.sirayTaskId : undefined));
      for (let check = 1; !result.ok && result.pending && result.sirayTaskId && check <= SIRAY_CHECKS; check++) {
        writeRuntime(i, { lineKey: row.chunk.raw, status: "rendering", sirayTaskId: result.sirayTaskId, ...keptPlate });
        setProgressText(`Line ${i + 1} of ${queue.length} — Siray is rendering (check ${check} of ${SIRAY_CHECKS})…`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        result = await postBeat(await argsFor(result.sirayTaskId));
      }
      if (row.rowCast.cast.isMulti && result.plateUrl && row.chunk.sceneKey) ctx.scenePlatesThisRun[row.chunk.sceneKey] = result.plateUrl;
      const plateFields: Pick<RowRuntime, "plateUrl" | "castNames"> = result.plateUrl
        ? {
            plateUrl: result.plateUrl,
            ...(result.castNames && result.castNames.length > 1
              ? { castNames: result.castNames }
              : !row.rowCast.cast.isMulti && lock
                ? { castNames: [lock.name] }
                : {}),
          }
        : keptPlate;
      if (!result.ok) {
        writeRuntime(i, {
          lineKey: row.chunk.raw,
          status: "failed",
          error: result.pending
            ? "Siray is still rendering. Tap Render again to check on it (it won't be paid for twice)."
            : result.message,
          ...(result.pending && result.sirayTaskId ? { sirayTaskId: result.sirayTaskId } : {}),
          ...(backend === "siray" && !result.pending ? { videoBackend: "siray" as const } : {}),
          ...plateFields,
        });
        return false;
      }
      writeRuntime(i, {
        ...plateFields,
        lineKey: row.chunk.raw,
        status: "done",
        videoUrl: result.videoUrl,
        durationSec: result.durationSec,
        audioMuxed: result.audioMuxed,
        videoBackend: result.videoBackend,
        error:
          result.audioMuxed === false
            ? result.videoBackend && result.videoBackend !== "ltx"
              ? `Clip finished on ${videoBackendName(result.videoBackend)}, but its own sound could not be swapped for silence.`
              : "Clip finished, but the driving audio did not land in the file. Lips may move with no sound."
            : undefined,
      });
      return true;
    } catch (err) {
      writeRuntime(i, {
        lineKey: row.chunk.raw,
        status: "failed",
        error: err instanceof Error ? err.message : "Could not render this line.",
        ...keptPlate,
        ...(backend === "siray" ? { videoBackend: "siray" as const } : {}),
      });
      return false;
    }
  };

  const finishRun = () => {
    runningRef.current = false;
    stopRequestedRef.current = false;
    setStopRequested(false);
    setRunningKind(null);
    setRunningIndex(null);
    setProgressText((current) => (current?.startsWith("Stopped") ? current : null));
  };

  const handleRenderAll = async () => {
    if (!canRenderAll || runningRef.current) return;
    const act = activeAct;
    runningRef.current = true;
    stopRequestedRef.current = false;
    setStopRequested(false);
    /** Shared pictures made during this run, by scene, so a two-hander's
     * second line uses the first line's picture (2026-10-03). */
    const scenePlatesThisRun: Record<string, string> = {};
    try {
      const run = await runSunnyBanksRenderQueue(queue, {
        skip: (row) => runtimeFor(row.index, row.chunk.raw).status === "done",
        // Stop (2026-09-30): read before each new line starts, so the
        // line that's rendering finishes and saves.
        shouldStop: () => stopRequestedRef.current,
        render: (row, i) => renderRow(row, i, act, { scenePlatesThisRun }),
      });
      if (run.outcome === "stopped") setProgressText(sunnyBanksStoppedText(run.index));
      else if (run.outcome === "halted") setProgressText(`Stopped at line ${run.index + 1} — later lines were not billed.`);
    } finally {
      finishRun();
    }
  };

  /**
   * "Try with Grok" on a silent row that failed on Siray (2026-10-04,
   * Stuart: Grok is the backup). One tap renders just that row on Grok;
   * nothing is ever retried on a paid engine without the tap.
   */
  const handleRetrySilentOnGrok = async (row: QueueRow) => {
    if (runningRef.current || row.kind !== "hold" || platingIndex !== null) return;
    const act = activeAct;
    runningRef.current = true;
    try {
      await renderRow(row, row.index, act, { scenePlatesThisRun: {}, videoBackend: "grok" });
    } finally {
      finishRun();
    }
  };

  const captureScriptUndo = () => {
    setScriptUndo({
      actIds: [...actIds],
      activeAct,
      actScripts: cloneActRecord(actScripts, actIds),
      characterOverrides: cloneActRecord(characterOverridesByAct, actIds),
      locationOverrides: cloneActRecord(locationOverridesByAct, actIds),
      locationPickTags: cloneActRecord(locationPickTagsByAct, actIds),
      runtimeMap: cloneActRecord(runtimeMapByAct, actIds),
      workspaceTitle,
    });
  };

  const handleUndoScript = () => {
    if (!scriptUndo || running) return;
    patchLive(() => ({
      actIds: [...scriptUndo.actIds],
      activeAct: scriptUndo.activeAct,
      actScripts: cloneActRecord(scriptUndo.actScripts, scriptUndo.actIds),
      characterOverrides: cloneActRecord(scriptUndo.characterOverrides, scriptUndo.actIds),
      locationOverrides: cloneActRecord(scriptUndo.locationOverrides, scriptUndo.actIds),
      locationPickTags: cloneActRecord(scriptUndo.locationPickTags, scriptUndo.actIds),
      runtimeMap: cloneActRecord(scriptUndo.runtimeMap, scriptUndo.actIds),
      workspaceTitle: scriptUndo.workspaceTitle,
      defaultLocationId,
    }));
    setScriptUndo(null);
  };

  /** One tap: reflow the pasted/typed script onto one tag or speaker per
   * line (`formatSunnyBanksGodScript`) — never rewrites a tag or a word
   * of dialogue, only whitespace. Routed through the same
   * `handleScriptChange` every other script edit uses, so this gets the
   * same undo-capture, act-header re-split, and Neon persistence for
   * free rather than needing its own copy of that logic. */
  /** Open state for the full-screen God Script editor. Its draft lives
   * inside that component, not here — this panel deliberately learns
   * nothing about the edit until Done applies it in one go. */
  const [fullScreenScriptOpen, setFullScreenScriptOpen] = useState(false);

  /** What the Format button last did, shown on the button itself for a
   * moment (2026-09-30). Live QA: on an already-tidy script Format was a
   * silent no-op, and with the script box folded shut even a real
   * change happened out of sight, so the tap looked dead either way. */
  const formatFeedback = useScriptFormatFeedback();

  const handleFormatScript = () => {
    if (running) return;
    const formatted = formatSunnyBanksGodScript(scriptText);
    const changed = formatted !== scriptText;
    if (changed) {
      handleScriptChange(formatted);
      setScriptOpen(true);
    }
    formatFeedback.show(changed);
  };

  const handleScriptChange = (value: string) => {
    const decoded = decodeSunnyBanksPastedScript(value);
    const parsedDoc = parseSunnyBanksGodDocument(decoded, activeAct);
    // Typing inside an act whose own script has a titled header
    // (`=== ACT IV — SCENE A1 — THE PAYOFF ===`) used to go down the
    // "split into acts" path on every keystroke (2026-09-30): that path
    // trims each line and the ends of the text, so a space typed at the
    // end of a line or a new line vanished, the text changed under the
    // caret, and the act's per-row picks were reset. When every header
    // names the act already open there is nothing to split, so it is
    // an ordinary edit and the text is kept exactly as typed.
    const staysInThisAct = parsedDoc.actIds.every((id) => id === activeAct);
    const doc = staysInThisAct ? { ...parsedDoc, hasActHeaders: false } : parsedDoc;
    if (doc.hasActHeaders || decoded !== scriptText) {
      captureScriptUndo();
    }
    patchLive((prev) => {
      // A pasted script whose own title header names a different episode
      // is a new episode, not a rename of the card that's open: auto-save
      // then adds a card instead of overwriting this one (as Save always
      // did). Only a paste counts (a big jump in length), and only when
      // the open episode already has a name, so typing or editing the
      // `# EPISODE:` line a letter at a time renames this card instead
      // of minting a new card per keystroke.
      const looksLikePaste = Math.abs(decoded.length - scriptText.length) > 12;
      const namesOtherEpisode =
        looksLikePaste &&
        typeof doc.episodeTitle === "string" &&
        prev.workspaceTitle.trim().length > 0 &&
        doc.episodeTitle.trim().toLowerCase() !== prev.workspaceTitle.trim().toLowerCase();
      if (namesOtherEpisode) prev = { ...prev, episodeId: undefined, mediaSlug: undefined };
      if (!doc.hasActHeaders) {
        return {
          ...prev,
          workspaceTitle: doc.episodeTitle ?? prev.workspaceTitle,
          actScripts: { ...prev.actScripts, [prev.activeAct]: decoded },
        };
      }
      const nextIds = mergeSunnyBanksActIds(prev.actIds, doc.actIds);
      const actScriptsNext = { ...prev.actScripts };
      const characterNext = { ...prev.characterOverrides };
      const locationNext = { ...prev.locationOverrides };
      const pickTagsNext = { ...(prev.locationPickTags ?? {}) };
      const runtimeNext = { ...prev.runtimeMap };
      for (const id of nextIds) {
        if (!(id in actScriptsNext)) actScriptsNext[id] = "";
        if (!(id in characterNext)) characterNext[id] = {};
        if (!(id in locationNext)) locationNext[id] = {};
        if (!(id in runtimeNext)) runtimeNext[id] = {};
      }
      for (const id of doc.actIds) {
        actScriptsNext[id] = doc.actScripts[id] ?? "";
        characterNext[id] = {};
        locationNext[id] = {};
        delete pickTagsNext[id];
      }
      if (!doc.actIds.includes(prev.activeAct)) actScriptsNext[prev.activeAct] = "";
      return {
        ...prev,
        workspaceTitle: doc.episodeTitle ?? prev.workspaceTitle,
        actIds: nextIds,
        activeAct: !doc.actIds.includes(prev.activeAct) && doc.actIds[0] ? doc.actIds[0] : prev.activeAct,
        actScripts: actScriptsNext,
        characterOverrides: characterNext,
        locationOverrides: locationNext,
        locationPickTags: pickTagsNext,
        runtimeMap: runtimeNext,
      };
    });
  };

  const applyActScript = (nextScript: string) => {
    patchLive((prev) => ({
      ...prev,
      actScripts: { ...prev.actScripts, [prev.activeAct]: nextScript },
    }));
  };

  const handleInsertShotAfter = (rowIndex: number) => {
    if (running) return;
    const row = queue[rowIndex];
    if (!row) return;
    const holdLine = buildSunnyBanksHoldScriptLine(row.characterName);
    captureScriptUndo();
    const insertAt = rowIndex + 1;
    patchLive((prev) => {
      const act = prev.activeAct;
      const script = prev.actScripts[act] ?? "";
      // The new hold sits under this row, so it gets this row's place
      // the same way (same tag, same pick).
      const shiftedLocations = shiftKeyedIndexRecord(prev.locationOverrides[act] ?? {}, insertAt);
      const shiftedPickTags = shiftKeyedIndexRecord(prev.locationPickTags?.[act] ?? {}, insertAt);
      const picked = pickSunnyBanksRowLocation(
        { locationOverrides: shiftedLocations, locationPickTags: shiftedPickTags },
        insertAt,
        row.chunk.locationTag,
        row.location.id
      );
      const nextScript = insertSunnyBanksLineAfter(script, row.chunk.sourceLineIndex, holdLine);
      return {
        ...prev,
        actScripts: {
          ...prev.actScripts,
          [act]: nextScript,
        },
        // Every Done row below moves down with its clip (2026-09-30).
        runtimeMap: {
          ...prev.runtimeMap,
          [act]: shiftSunnyBanksRuntimesForInsert(script, nextScript, prev.runtimeMap[act] ?? {}, insertAt),
        },
        characterOverrides: {
          ...prev.characterOverrides,
          [act]: shiftKeyedIndexRecord(prev.characterOverrides[act] ?? {}, insertAt),
        },
        locationOverrides: { ...prev.locationOverrides, [act]: picked.locationOverrides },
        locationPickTags: { ...(prev.locationPickTags ?? {}), [act]: picked.locationPickTags },
      };
    });
    if (!scriptOpen) setScriptOpen(true);
  };

  const handleInsertShotBeforeFirst = () => {
    if (running) return;
    const first = queue[0];
    const name = first?.characterName || fallbackCharacterName();
    const holdLine = buildSunnyBanksHoldScriptLine(name);
    captureScriptUndo();
    patchLive((prev) => {
      const act = prev.activeAct;
      const script = prev.actScripts[act] ?? "";
      const nextScript = first
        ? insertSunnyBanksLineBefore(script, first.chunk.sourceLineIndex, holdLine)
        : script.trim()
          ? `${script.replace(/\n+$/, "")}\n${holdLine}`
          : holdLine;
      const shiftedLocations = shiftKeyedIndexRecord(prev.locationOverrides[act] ?? {}, 0);
      const shiftedPickTags = shiftKeyedIndexRecord(prev.locationPickTags?.[act] ?? {}, 0);
      const picked = pickSunnyBanksRowLocation(
        { locationOverrides: shiftedLocations, locationPickTags: shiftedPickTags },
        0,
        first?.chunk.locationTag,
        first?.location.id ?? prev.defaultLocationId
      );
      return {
        ...prev,
        actScripts: { ...prev.actScripts, [act]: nextScript },
        runtimeMap: {
          ...prev.runtimeMap,
          [act]: shiftSunnyBanksRuntimesForInsert(script, nextScript, prev.runtimeMap[act] ?? {}, 0),
        },
        characterOverrides: {
          ...prev.characterOverrides,
          [act]: shiftKeyedIndexRecord(prev.characterOverrides[act] ?? {}, 0),
        },
        locationOverrides: { ...prev.locationOverrides, [act]: picked.locationOverrides },
        locationPickTags: { ...(prev.locationPickTags ?? {}), [act]: picked.locationPickTags },
      };
    });
    if (!scriptOpen) setScriptOpen(true);
  };

  const handleRemoveShot = (rowIndex: number) => {
    if (running) return;
    const row = queue[rowIndex];
    if (!row) return;
    const status = runtimeFor(row.index, row.chunk.raw).status;
    if (status === "done" || status === "rendering") return;
    captureScriptUndo();
    patchLive((prev) => {
      const act = prev.activeAct;
      const script = prev.actScripts[act] ?? "";
      return {
        ...prev,
        actScripts: {
          ...prev.actScripts,
          [act]: removeSunnyBanksSourceLine(script, row.chunk.sourceLineIndex),
        },
        characterOverrides: {
          ...prev.characterOverrides,
          [act]: unshiftKeyedIndexRecord(prev.characterOverrides[act] ?? {}, rowIndex),
        },
        locationOverrides: {
          ...prev.locationOverrides,
          [act]: unshiftKeyedIndexRecord(prev.locationOverrides[act] ?? {}, rowIndex),
        },
        locationPickTags: {
          ...(prev.locationPickTags ?? {}),
          [act]: unshiftKeyedIndexRecord(prev.locationPickTags?.[act] ?? {}, rowIndex),
        },
        // Every Done row below moves up with its clip (2026-09-30).
        runtimeMap: {
          ...prev.runtimeMap,
          [act]: shiftSunnyBanksRuntimesForRemove(script, prev.runtimeMap[act] ?? {}, rowIndex),
        },
      };
    });
  };

  const handleIdleLineChange = (rowIndex: number, dialogue: string) => {
    const row = queue[rowIndex];
    if (!row || running) return;
    const lines = scriptText.split(/\r?\n/);
    const original = lines[row.chunk.sourceLineIndex] ?? `${row.characterName}:`;
    applyActScript(
      replaceSunnyBanksSourceLine(
        scriptText,
        row.chunk.sourceLineIndex,
        rewriteSunnyBanksSpeakerLine(original, row.characterName, dialogue)
      )
    );
  };

  const handleAddAct = () => {
    if (running || actIds.length >= MAX_SUNNY_BANKS_ACTS) return;
    const id = nextSunnyBanksActId(actIds);
    patchLive((prev) => ({
      ...prev,
      actIds: [...prev.actIds, id],
      activeAct: id,
      actScripts: { ...prev.actScripts, [id]: "" },
      characterOverrides: { ...prev.characterOverrides, [id]: {} },
      locationOverrides: { ...prev.locationOverrides, [id]: {} },
      runtimeMap: { ...prev.runtimeMap, [id]: {} },
    }));
    window.setTimeout(() => {
      actStripRef.current?.scrollTo({ left: actStripRef.current.scrollWidth, behavior: "smooth" });
    }, 0);
  };

  return (
    <div id={SUNNY_BANKS_EDITOR_ID} className="flex scroll-mt-4 flex-col gap-4">
      {/* The display-only Cast strip was removed 2026-09-29 (Stuart): the
          faces live in the Characters section now, with "not ready" shown
          there (see `sunnyBanksNotReadyReason` in lib/characterRoster.ts). */}
      <div className="flex touch-pan-y flex-col gap-2.5 overscroll-y-contain rounded-2xl border border-amber-300/25 bg-amber-300/[0.03] p-3">
        {/* Every character always shows; one with no Cast card picture gets a red note on its rows (2026-10-01). */}
          <>
            {/* Acts scroll sideways; the script tools sit on their own
              * row below. Two separate rows is the fix (2026-09-18):
              * acts and tools used to share one strip, so adding the
              * Full screen button pushed Act I/II/III clean off the
              * left edge and they read as missing. Wrapping the acts
              * instead fixed that but cost two rows of vertical space
              * on a 390px phone for what is a one-line control, so
              * they're a scroll strip again — just one that only ever
              * holds acts, and can't be crowded out by a tool button. */}
            <div
              ref={actStripRef}
              role="tablist"
              aria-label="Act"
              className="flex min-w-0 flex-row flex-nowrap gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap touch-pan-x touch-pan-y pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none]"
            >
              {actIds.map((act) => {
                const selected = act === activeAct;
                const lineCount = sunnyBanksQueueChunks(
                  parseSunnyBanksScriptBlock(actScripts[act] ?? "")
                ).length;
                return (
                  <button
                    key={act}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => patchLive((prev) => ({ ...prev, activeAct: act }))}
                    disabled={running}
                    className={[
                      "min-h-[40px] shrink-0 rounded-md px-3.5 text-[12px] font-semibold transition-colors disabled:opacity-60",
                      selected
                        ? "bg-amber-300 text-zinc-950"
                        : "bg-white/[0.04] text-white/70 ring-1 ring-inset ring-white/10",
                    ].join(" ")}
                  >
                    Act {act}
                    {lineCount > 0 ? ` · ${lineCount}` : ""}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={handleAddAct}
                disabled={running || actIds.length >= MAX_SUNNY_BANKS_ACTS}
                className="min-h-[40px] shrink-0 rounded-md bg-white/[0.04] px-3.5 text-[12px] font-semibold text-white/80 ring-1 ring-inset ring-white/10 disabled:opacity-60"
              >
                + Add Act
              </button>
            </div>

            <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleFormatScript}
                disabled={running || !scriptText.trim()}
                aria-label="Auto-format script spacing"
                aria-live="polite"
                className="min-h-[40px] shrink-0 rounded-md bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
              >
                {formatFeedback.label}
              </button>
              <button
                type="button"
                onClick={() => setFullScreenScriptOpen(true)}
                disabled={running}
                aria-label="Edit script full screen"
                className="min-h-[40px] shrink-0 rounded-md bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
              >
                ⤢ Full screen
              </button>
              <button
                type="button"
                onClick={handleUndoScript}
                disabled={!scriptUndo || running}
                aria-label="Undo script"
                className="min-h-[40px] shrink-0 rounded-md bg-zinc-800 px-3 text-xs font-medium text-white/80 disabled:opacity-40"
              >
                ↩ Undo
              </button>
            </div>
            <button
              type="button"
              onClick={() => setScriptOpen((open) => !open)}
              aria-expanded={scriptOpen}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-left"
            >
              <span className="text-[12px] font-semibold text-white/80">
                Show Script Text & Queued Lines
                <span aria-hidden className="ml-1.5 font-medium text-white/40">
                  {"\u00b7"} {queue.length}
                </span>
              </span>
              <ChevronIcon open={scriptOpen} />
            </button>
            {scriptOpen && (
              <div className="flex touch-pan-y flex-col gap-2.5 overscroll-y-contain">
                <div className="relative rounded-xl border border-white/10 bg-white/[0.03] focus-within:border-amber-300/40">
                  <SunnyBanksScriptHighlightOverlay text={scriptText} overlayRef={scriptHighlightRef} autoGrowMinRows={12} />
                  <textarea
                    value={scriptText}
                    onChange={(e) => handleScriptChange(e.target.value)}
                    onScroll={(e) => {
                      if (scriptHighlightRef.current) {
                        scriptHighlightRef.current.scrollTop = e.currentTarget.scrollTop;
                        scriptHighlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
                      }
                    }}
                    onPaste={(e) => {
                      const raw =
                        e.clipboardData.getData("text/plain") || e.clipboardData.getData("text");
                      const decoded = decodeSunnyBanksPastedScript(raw);
                      if (decoded === raw) return;
                      e.preventDefault();
                      const el = e.currentTarget;
                      const start = el.selectionStart ?? el.value.length;
                      const end = el.selectionEnd ?? el.value.length;
                      handleScriptChange(`${el.value.slice(0, start)}${decoded}${el.value.slice(end)}`);
                    }}
                    disabled={running}
                    placeholder={
                      genre === "skidmarks" || genre === "shorts"
                        ? "[Location: Town street]\n[Action: walks along the pavement, side on]\nDap:"
                        : "Shazza: You right?\nDazza: Yeah nah, she'll be right.\nRanger Bazza:"
                    }
                    rows={12}
                    className="relative z-10 w-full resize-y bg-transparent px-3 py-2 text-base leading-6 text-transparent caret-white placeholder:text-white/30 focus:outline-none disabled:opacity-60"
                  />
                </div>
                {/* The prose hint that used to sit here (one-speaker-per-line,
                  * + / − rows, Unit 4S stays barefoot) is gone as of 2026-09-18 —
                  * every line of it is now in the God Script Cheat Sheet below,
                  * properly laid out, and two copies of the same rules is how
                  * they drift apart. The colour key stays: it is a legend for
                  * what the textarea is doing right now, not documentation. */}
                <p className="text-[10px] leading-snug text-white/40">
                  <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-yellow-300" />
                      <span className="text-yellow-300/90">[Location: ]</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                      <span className="text-cyan-300/90">[Character ] / Name:</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-300" />
                      <span className="text-green-300/90">[Action: ] / [silence]</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      <span className="text-red-400/90">
                        {profile.silentBackends.includes("siray") ? "[SIRAY] / [GROK] / [LTX] / [H3] video" : "[GROK] / [LTX] / [H3] video"}
                      </span>
                    </span>
                  </span>
                </p>

                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={handleInsertShotBeforeFirst}
                    disabled={running}
                    aria-label="Insert shot at the start"
                    className="flex h-10 min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-lg font-medium text-white/45 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>

                {doneRowCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setDoneRowsOpen((open) => !open)}
                    aria-expanded={doneRowsOpen}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-left"
                  >
                    <span className="text-[12px] font-semibold text-white/60">
                      {doneRowCount} finished shot{doneRowCount === 1 ? "" : "s"}
                      <span aria-hidden className="ml-1.5 font-medium text-white/35">
                        {doneRowsOpen ? "hide" : "show"}
                      </span>
                    </span>
                    <ChevronIcon open={doneRowsOpen} />
                  </button>
                )}

                {visibleQueue.length > 0 && (
                  <ol className="flex min-w-0 flex-col border-y border-white/10">
                    {visibleQueue.map((row) => {
                      const runtime = runtimeFor(row.index, row.chunk.raw);
                      const status = row.index === runningIndex ? "rendering" : runtime?.status ?? "idle";
                      const isStatic = status === "done";
                      const cutaway = isSunnyBanksLocationCutaway(row.chunk);
                      const lineLabel =
                        row.kind === "hold"
                          ? row.chunk.action?.trim() || "Silent hold"
                          : row.line;
                      const rowChip = rowVideoBackendChip({
                        status,
                        used: runtime?.videoBackend,
                        planned: row.backendChoice.backend,
                      });
                      return (
                        <li key={`${activeAct}:${row.index}:${row.chunk.sourceLineIndex}`} className="min-w-0">
                          <div className="flex min-w-0 w-full items-start gap-1 overflow-x-hidden py-1.5 [touch-action:pan-y]">
                            <span className="w-4 shrink-0 pt-1 text-center text-[10px] font-medium text-white/40">
                              {row.index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-h-[32px] min-w-0 items-center gap-1">
                                {isStatic || cutaway ? (
                                  <span className="min-w-0 truncate text-[12px] font-semibold text-white/90">
                                    {row.characterName}
                                  </span>
                                ) : (
                                  <select
                                    value={row.characterName}
                                    onChange={(e) => {
                                      const name = e.target.value;
                                      patchLive((prev) => ({
                                        ...prev,
                                        characterOverrides: {
                                          ...prev.characterOverrides,
                                          [prev.activeAct]: {
                                            ...(prev.characterOverrides[prev.activeAct] ?? {}),
                                            [row.index]: name,
                                          },
                                        },
                                      }));
                                    }}
                                    disabled={running}
                                    aria-label={`Character for line ${row.index + 1}`}
                                    className="h-10 min-h-[40px] w-[4.75rem] max-w-[4.75rem] shrink-0 truncate rounded-lg border border-white/10 bg-white/[0.03] px-1 text-[12px] text-white disabled:opacity-60"
                                  >
                                    {rowSpeakerChoices.map((c) => (
                                      <option key={c.name} value={c.name} className="bg-zinc-900">
                                        {c.name}
                                        {!resolveSunnyBanksStartImage(c)
                                          ? " (no Cast card picture)"
                                          : !c.voiceId
                                            ? " (no voice — hold only)"
                                            : ""}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {!isStatic && (
                                  <select
                                    value={row.location.id}
                                    onChange={(e) => {
                                      const locationId = e.target.value as SunnyBanksLocationId;
                                      patchLive((prev) => {
                                        const act = prev.activeAct;
                                        const picked = pickSunnyBanksRowLocation(
                                          {
                                            locationOverrides: prev.locationOverrides[act] ?? {},
                                            locationPickTags: prev.locationPickTags?.[act] ?? {},
                                          },
                                          row.index,
                                          row.chunk.locationTag,
                                          locationId
                                        );
                                        return {
                                          ...prev,
                                          locationOverrides: { ...prev.locationOverrides, [act]: picked.locationOverrides },
                                          locationPickTags: { ...(prev.locationPickTags ?? {}), [act]: picked.locationPickTags },
                                        };
                                      });
                                    }}
                                    disabled={running}
                                    title={row.location.label}
                                    aria-label={`Location for line ${row.index + 1}`}
                                    className="h-10 min-h-[40px] min-w-0 max-w-[120px] shrink truncate rounded-lg border border-white/10 bg-white/[0.03] px-1 text-[12px] text-white disabled:opacity-60"
                                  >
                                    {row.locationProblem && !locations.some((l) => l.id === row.location.id) && (
                                      <option value={row.location.id} className="bg-zinc-900">
                                        {row.location.id} (unknown)
                                      </option>
                                    )}
                                    {locations.map((location) => (
                                      <option key={location.id} value={location.id} className="bg-zinc-900">
                                        {compactQueueLocationLabel(location.label)}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                <span
                                  title={`Renders on ${videoBackendName(rowChip)}`}
                                  className="ml-auto shrink-0 text-[9px] font-bold tracking-wide text-red-400"
                                >
                                  {videoBackendTagLabel(rowChip)}
                                </span>
                                <span
                                  className={[
                                    "flex-shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold",
                                    statusPillClass(status),
                                  ].join(" ")}
                                >
                                  {statusPillLabel(status)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleInsertShotAfter(row.index)}
                                  disabled={running}
                                  aria-label={`Insert shot after line ${row.index + 1}`}
                                  className="flex h-10 min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg text-lg font-medium text-white/45 disabled:opacity-40"
                                >
                                  +
                                </button>
                              </div>
                              {(() => {
                                // Who's in the shot (2026-10-03): chips when it's two or more people.
                                const chipNames = row.rowCast.cast.isMulti ? row.rowCast.cast.names : (runtime?.castNames ?? []);
                                const missingNow = isStatic || cutaway ? [] : rowMissingPictures(row);
                                return (
                                  <>
                                    {chipNames.length > 1 && (
                                      <div className="flex min-w-0 items-center gap-1 pt-0.5">
                                        <CastChips names={chipNames} missing={missingNow} />
                                        {row.location.peopleInPicture && (
                                          <span className="text-[9px] text-white/40">already in the picture</span>
                                        )}
                                      </div>
                                    )}
                                    {missingNow.map((name) => (
                                      <p key={name} role="alert" className="pt-0.5 text-[10px] leading-snug text-red-300">
                                        {missingCastPictureMessage(name)}
                                      </p>
                                    ))}
                                    {!isStatic && !cutaway && row.kind === "speak" && row.character && !row.character.voiceId && (
                                      <p role="alert" className="pt-0.5 text-[10px] leading-snug text-red-300">
                                        {missingVoiceMessage(row.character.name)}
                                      </p>
                                    )}
                                    {(() => {
                                      const plateShown = runtime?.plateUrl ?? (isStatic ? undefined : rowPlate(row));
                                      const plateLabel = row.rowCast.cast.isMulti ? "Shared plate" : "Plate";
                                      const canPlate = !isStatic && rowTakesPlate(row) && !row.locationProblem && !!row.location.image;
                                      return (
                                        <>
                                          {plateShown && (
                                            <details className="min-w-0 pt-0.5">
                                              <summary className="cursor-pointer text-[10px] text-cyan-200/80 [-webkit-tap-highlight-color:transparent]">
                                                {plateLabel}
                                              </summary>
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={plateShown}
                                                alt={`${plateLabel}: ${chipNames.length > 0 ? chipNames.join(" + ") : row.characterName}`}
                                                className="mt-1 aspect-video w-full max-w-[320px] rounded-lg object-cover"
                                              />
                                            </details>
                                          )}
                                          {/* Make plate first (2026-10-04): optional, and the cheap check for a refusal. */}
                                          {canPlate && (
                                            <button
                                              type="button"
                                              onClick={() => void handleMakePlate(row)}
                                              disabled={running || platingIndex !== null || missingNow.length > 0}
                                              aria-label={`${plateShown ? "Remake" : "Make"} plate for line ${row.index + 1}`}
                                              className="mt-0.5 min-h-[32px] self-start rounded-md border border-cyan-300/25 px-2 text-[10px] font-semibold text-cyan-200/90 disabled:opacity-50"
                                            >
                                              {platingIndex === row.index
                                                ? `Making plate on ${videoBackendName(plateEngine === "siray" ? "siray" : "grok")}…`
                                                : `${plateShown ? "Remake plate" : "Make plate"} (~$${plateCostUsd.toFixed(2)})`}
                                            </button>
                                          )}
                                          {plateNotice?.act === activeAct && plateNotice.index === row.index && (
                                            <p role="alert" className="pt-0.5 text-[10px] leading-snug text-rose-300/90">
                                              {plateNotice.text}
                                            </p>
                                          )}
                                        </>
                                      );
                                    })()}
                                    {!isStatic &&
                                      rowPreSend(row).map((issue) => (
                                        <p
                                          key={issue.code + issue.message}
                                          role={issue.level === "block" ? "alert" : "status"}
                                          className={[
                                            "pt-0.5 text-[10px] leading-snug",
                                            issue.level === "block" ? "text-red-300" : "text-amber-200/80",
                                          ].join(" ")}
                                        >
                                          {issue.level === "block" ? "" : "Check: "}
                                          {issue.message}
                                        </p>
                                      ))}
                                  </>
                                );
                              })()}
                              {!isStatic && row.locationProblem && (
                                <p role="alert" className="pt-0.5 text-[10px] leading-snug text-red-300">
                                  {row.locationProblem}
                                </p>
                              )}
                              {!isStatic && row.backendChoice.ignoredOverride && (
                                <p className="pt-0.5 text-[10px] leading-snug text-amber-200/80">
                                  {ignoredVideoBackendWarning(row.backendChoice.ignoredOverride, row.kind)}
                                </p>
                              )}
                              {isStatic ? (
                                <details className="group min-w-0 pt-0.5">
                                  <summary
                                    title={lineLabel}
                                    aria-label={`Spoken line ${row.index + 1}`}
                                    className="cursor-pointer list-none truncate text-[12px] leading-snug text-white/75 [-webkit-tap-highlight-color:transparent] group-open:whitespace-normal group-open:overflow-visible [&::-webkit-details-marker]:hidden"
                                  >
                                    {lineLabel}
                                  </summary>
                                </details>
                              ) : (
                                <div className="flex min-w-0 items-center gap-1 pt-0.5">
                                  {cutaway ? (
                                    <p
                                      title={lineLabel}
                                      className="min-w-0 flex-1 truncate text-[12px] leading-snug text-white/75"
                                    >
                                      {lineLabel}
                                    </p>
                                  ) : (
                                    <input
                                      type="text"
                                      value={row.line}
                                      onChange={(e) => handleIdleLineChange(row.index, e.target.value)}
                                      disabled={running}
                                      placeholder="Empty is a silent hold"
                                      aria-label={`Spoken line ${row.index + 1}`}
                                      className="min-h-[40px] min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-1.5 text-[12px] leading-snug text-white/80 placeholder:text-white/30 focus:border-amber-300/40 focus:outline-none disabled:opacity-60"
                                    />
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveShot(row.index)}
                                    disabled={running || status === "rendering"}
                                    aria-label={`Remove shot ${row.index + 1}`}
                                    className="flex h-10 min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg text-lg font-medium text-white/45 disabled:opacity-40"
                                  >
                                    −
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          {runtime?.status === "failed" && runtime.error && (
                            <p role="alert" className="pb-1.5 pl-5 text-[11px] leading-snug text-rose-300/90">
                              {runtime.error}
                            </p>
                          )}
                          {/* Grok is Siray's backup for a silent row (2026-10-04): one tap, never automatic. */}
                          {runtime?.status === "failed" &&
                            row.kind === "hold" &&
                            runtime.videoBackend === "siray" &&
                            !runtime.sirayTaskId &&
                            profile.silentBackends.includes("grok") && (
                              <div className="pb-1.5 pl-5">
                                <button
                                  type="button"
                                  onClick={() => void handleRetrySilentOnGrok(row)}
                                  disabled={running || platingIndex !== null}
                                  aria-label={`Try line ${row.index + 1} with Grok`}
                                  className="min-h-[36px] rounded-md border border-red-300/30 px-2.5 text-[11px] font-semibold text-red-200 disabled:opacity-50"
                                >
                                  Try with Grok (~${estimateRowVideoCostUsd("grok", SUNNY_BANKS_HOLD_DURATION_SEC).toFixed(2)})
                                </button>
                              </div>
                            )}
                          {runtime?.status === "done" && runtime.error && (
                            <p role="status" className="pb-1.5 pl-5 text-[11px] leading-snug text-amber-200/80">
                              {runtime.error}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}

            <SunnyBanksGodScriptCheatSheet genre={genre} />

            {fullScreenScriptOpen && (
              <SunnyBanksFullScreenScriptEditor
                initialText={scriptText}
                onApply={handleScriptChange}
                onClose={() => setFullScreenScriptOpen(false)}
              />
            )}

            {pendingRows.length > 0 && !canRenderAll && !running && (
              <p className="text-[10px] leading-snug text-white/40">
                {pendingRows.some((row) => row.locationProblem)
                  ? "A line's location isn't on the Locations row (see the red note on it). Add that location, or fix the [Location: …] tag."
                  : pendingRows.some((row) => preSendBlocks(rowPreSend(row)))
                    ? "A line's speaker isn't in the shot (see the red note on it). Add them to the shot first."
                  : "Every line needs a character with a Cast card picture (see any red note). Speak also needs a voice. Change the dropdown or the script."}
              </p>
            )}

            {/* The free pre-send check, next to Render (2026-10-04): which lines it flagged. */}
            {(() => {
              const flagged = pendingRows.filter((row) => rowPreSend(row).length > 0).map((row) => row.index + 1);
              return flagged.length > 0 && !running ? (
                <p role="status" className="text-[10px] leading-snug text-amber-200/80">
                  Check before rendering: line{flagged.length === 1 ? "" : "s"} {flagged.join(", ")} (see the note on each).
                </p>
              ) : null;
            })()}

            {/* Grok/H3 switch for silent rows (2026-09-30). Talking rows
              * are always LTX; a [GROK] / [LTX] / [H3] tag beats this. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-snug text-white/40">
              <span>Silent shots on</span>
              <span role="group" aria-label="Video engine for silent shots" className="inline-flex overflow-hidden rounded-full border border-white/10">
                {profile.silentBackends.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={silentShotBackend === option}
                    onClick={() => {
                      setSunnyBanksSilentShotBackend(option, genre);
                      setH3KeyCheck(null);
                    }}
                    disabled={running}
                    className={[
                      "min-h-[32px] px-2.5 font-semibold disabled:opacity-60",
                      silentShotBackend === option ? "bg-red-400/15 text-red-300" : "text-white/45",
                    ].join(" ")}
                  >
                    {videoBackendName(option)}
                  </button>
                ))}
              </span>
              <span>
                ~${estimateRowVideoCostUsd(silentShotBackend, SUNNY_BANKS_HOLD_DURATION_SEC).toFixed(2)} per 5s · talking on LTX
              </span>
              {silentShotBackend === "h3" && (
                <button
                  type="button"
                  onClick={() => void handleCheckH3Key()}
                  className="min-h-[32px] font-medium text-white/55 underline decoration-white/25 underline-offset-2"
                >
                  Check H3 key
                </button>
              )}
              {h3KeyCheck && <span role="status" className="text-white/60">{h3KeyCheck}</span>}
            </div>
            {/* Plate switch (2026-10-04, Shorts): Siray by default, Grok when wanted. */}
            {offersPlateSwitch && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-snug text-white/40">
                <span>Plates on</span>
                <span role="group" aria-label="Engine for plates" className="inline-flex overflow-hidden rounded-full border border-white/10">
                  {profile.plateEngines.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={plateEngine === option}
                      onClick={() => setStudioPlateEngine(option, genre)}
                      disabled={running || platingIndex !== null}
                      className={[
                        "min-h-[32px] px-2.5 font-semibold disabled:opacity-60",
                        plateEngine === option ? "bg-cyan-400/15 text-cyan-200" : "text-white/45",
                      ].join(" ")}
                    >
                      {videoBackendName(option)}
                    </button>
                  ))}
                </span>
                <span>~${plateCostUsd.toFixed(2)} a plate · made first, so a refusal costs only the plate</span>
              </div>
            )}
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => void handleRenderAll()}
                disabled={!canRenderAll}
                className="min-h-[44px] min-w-0 flex-1 rounded-md bg-amber-300 px-3.5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-200 active:bg-amber-300/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {running
                  ? `Rendering line ${(runningIndex ?? 0) + 1} of ${queue.length}…`
                  : queue.length === 0
                    ? "Render lines"
                    : pendingRows.length === 0
                      ? "Clips already loaded"
                      : `Render ${pendingRows.length} line${pendingRows.length === 1 ? "" : "s"}`}
              </button>
              {/* Stop: only while rendering. The line on screen finishes
                  and saves; nothing after it starts. */}
              {running && (
                <button
                  type="button"
                  onClick={() => {
                    stopRequestedRef.current = true;
                    setStopRequested(true);
                  }}
                  disabled={stopRequested}
                  aria-label={stopRequested ? "Stopping after this line" : "Stop after this line"}
                  title="Stop after this line"
                  className="shrink-0 rounded-md bg-rose-400 px-3 text-xs font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:opacity-60"
                >
                  {stopRequested ? "Stopping…" : "Stop"}
                </button>
              )}
            </div>
            <p className="text-[10px] leading-snug text-white/40">
              {pendingRows.length === 0
                ? "Existing Crash Lab clips are already in the strip below. Tap + on a row to insert a shot between them, or − on an Idle row to drop it — one clip at a time, never a batch of these 46."
                : `One clip at a time — overlay ~$${overlayCostUsd.toFixed(2)}${
                    pendingRows.filter((row) => row.kind === "hold").length > 0
                      ? `, silent video ~$${holdVideoCostUsd.toFixed(2)}`
                      : ""
                  }${speakCount > 0 ? `, speak video ~$0.13/s after TTS` : ""}. Stops if a line fails so later lines are not billed. Route still loads the full character lock by name for the gold prompts.`}
            </p>
          </>
        {progressText && (
          <p role="status" className="text-[11px] leading-snug text-amber-200/80">
            {progressText}
          </p>
        )}
      </div>

      {/* Extras (2026-10-04): the same row in every genre, below the acts/script. */}
      <EpisodeExtrasRow genre={genre} />

      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={() => setClipsOpen((open) => !open)}
          aria-expanded={clipsOpen}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
            Clips
            <span aria-hidden className="ml-1.5 text-white/25">
              {"\u00b7"} {renderedClips.length}
            </span>
          </span>
          <ChevronIcon open={clipsOpen} />
        </button>
        {clipsOpen &&
          (renderedClips.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-white/35">Nothing rendered yet.</p>
          ) : (
            // One sideways row per act, stacked in act order (2026-09-30).
            // Each row scrolls on its own; `touch-pan-x touch-pan-y` on the
            // cards keeps an up/down swipe scrolling the page (PR 223).
            <div className="flex flex-col gap-3">
              {clipsByAct.map((group) => {
                const rowOpen = isSunnyBanksClipRowOpen({
                  act: group.act,
                  clipCount: group.clips.length,
                  activeAct,
                  toggled: clipRowToggles[clipRowKey(group.act)],
                });
                return (
                  <div key={group.act} className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-center gap-1 self-start">
                      <button
                        type="button"
                        onClick={() =>
                          setClipRowToggles((prev) => ({ ...prev, [clipRowKey(group.act)]: !rowOpen }))
                        }
                        aria-expanded={rowOpen}
                        aria-label={`Act ${group.act} clips, ${group.clips.length}. ${rowOpen ? "Hide" : "Show"}`}
                        className="flex min-h-[32px] items-center gap-1.5 self-start text-left text-[10px] font-semibold uppercase tracking-wide text-white/40 [-webkit-tap-highlight-color:transparent]"
                      >
                        <span>
                          Act {group.act}
                          <span aria-hidden className="ml-1 text-white/25">
                            {"\u00b7"} {group.clips.length}
                          </span>
                        </span>
                        <ChevronIcon open={rowOpen} />
                      </button>
                      {/* One zip of this act's Done clips, built on the server
                          (2026-09-30): ep01-act-ii-01-shazza.mp4, … */}
                      {group.clips.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const result = downloadSunnyBanksActZip({
                              episode: zipEpisodeName,
                              act: group.act,
                              clips: group.clips.map((clip) => ({
                                url: clip.videoUrl,
                                line: clip.index + 1,
                                character: clip.characterName,
                              })),
                            });
                            setZipNotice(result.ok ? null : { act: group.act, text: result.error });
                          }}
                          aria-label={`Download Act ${group.act}'s ${group.clips.length} clips as one zip`}
                          title="Download this act as a zip"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-white/40 transition-colors hover:text-white/70 [-webkit-tap-highlight-color:transparent]"
                        >
                          <ZipIcon />
                        </button>
                      )}
                    </div>
                    {zipNotice?.act === group.act && (
                      <p role="alert" className="text-[10px] leading-snug text-red-300">
                        {zipNotice.text}
                      </p>
                    )}
                    {rowOpen &&
                      (group.clips.length === 0 ? (
                        <p className="text-[10px] leading-snug text-white/30">Nothing rendered in this act yet.</p>
                      ) : (
                        // The shared shot grid (2026-09-30, the same one Shorts
                        // uses): each Done line is a tile; tap it for the full
                        // player and its Remove.
                        <ShotGrid
                          labelPrefix="Line"
                          tiles={group.clips.map(
                            (clip): ShotTileView => ({
                              id: `${clip.act}:${clip.index}`,
                              number: clip.index + 1,
                              pictureUrl: null,
                              clipUrl: clip.videoUrl,
                              status: "rendered",
                              caption: `${clip.characterName}${
                                typeof clip.durationSec === "number" ? ` \u00b7 ${clip.durationSec.toFixed(1)}s` : ""
                              }`,
                              // Clips from before the engine was saved were all LTX.
                              engine: {
                                label: videoBackendTagLabel(clip.videoBackend ?? "ltx"),
                                title: `Video on ${videoBackendName(clip.videoBackend ?? "ltx")}`,
                              },
                              ...(clip.castNames ? { cast: { names: clip.castNames } } : {}),
                            }),
                          )}
                          openId={openClipKey}
                          onToggle={setOpenClipKey}
                          panelTitle={(tile) => `Act ${group.act} · line ${tile.number}`}
                          renderPanel={(id) => {
                            const clip = group.clips.find((c) => `${c.act}:${c.index}` === id);
                            if (!clip) return null;
                            return (
                              <div className="flex flex-col gap-1.5">
                                <video
                                  key={clip.videoUrl}
                                  src={clip.videoUrl}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="aspect-video w-full max-w-xl rounded-xl bg-black object-contain"
                                />
                                <p className="truncate text-[11px] font-medium leading-tight text-white/70">
                                  {clip.characterName}
                                  {typeof clip.durationSec === "number"
                                    ? ` \u00b7 ${clip.durationSec.toFixed(1)}s`
                                    : ""}
                                </p>
                                <p className="text-[10px] leading-tight text-white/40">
                                  Line {clip.index + 1} · {clip.lineLabel}
                                </p>
                                <div className="flex items-center justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setPendingClipRemove(clip)}
                                    disabled={running}
                                    aria-label={`Remove the clip for line ${clip.index + 1} so it can be rendered again`}
                                    title="Remove this clip"
                                    className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-white/45 transition-colors hover:border-rose-400/30 hover:text-rose-300/90 disabled:cursor-not-allowed disabled:text-white/25"
                                  >
                                    <TrashIcon />
                                    Remove
                                  </button>
                                </div>
                              </div>
                            );
                          }}
                        />
                      ))}
                  </div>
                );
              })}
            </div>
          ))}
        <SkidmarksConfirmDialog
          open={pendingClipRemove !== null}
          title="Remove this clip?"
          body={
            pendingClipRemove
              ? `Line ${pendingClipRemove.index + 1} (${pendingClipRemove.characterName}) goes back to Idle so you can render it again. The old video file is kept.`
              : ""
          }
          confirmLabel="Remove clip"
          onCancel={() => setPendingClipRemove(null)}
          onConfirm={() => {
            const target = pendingClipRemove;
            setPendingClipRemove(null);
            if (target) handleRemoveClip(target);
          }}
        />
      </div>

    </div>
  );
}
