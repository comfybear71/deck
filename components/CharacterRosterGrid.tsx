"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AUTO_PICTURE_TARGET,
  CHARACTER_LORA_ESTIMATED_COST_USD,
  CHARACTER_LORA_MIN_IMAGES,
  SIRAY_PICTURE_COST_USD,
  buildCharacterLoraEntry,
  formatCostUsd,
  type CharacterLoraEntry,
  type CharacterTrainingStyle,
  slugifyCharacterName,
} from "@/lib/characterLoras";
import {
  AutoLoraError,
  ensureTrainingPicture,
  makeSirayPicture,
  referenceDataUrlFor,
  startCharacterTraining,
  toTrainingPicture,
} from "@/lib/characterAutoLora";
import {
  characterPlateTargetFor,
  characterReferenceCandidateTargetFor,
  characterReferenceTargetFor,
  rosterPictureTargetFor,
} from "@/lib/deckMediaTargets";
import {
  ROSTER_GROUPS,
  buildCharacterRoster,
  onlyBandCharacters,
  buildCleanReferencePrompt,
  buildTrainingPicturePrompts,
  entryForRosterCharacter,
  minorBlockReason,
  oneTapCost,
  redoReferenceReset,
  startingPictures,
  uploadedCartoonReference,
  type RosterCharacter,
  type RosterGroup,
} from "@/lib/characterRoster";
import {
  addSkidmarksMemberWithPictures,
  flushSkidmarksSessionNow,
  getCharacterLorasState,
  getRosterExtrasState,
  patchCharacterLoras,
  patchRosterExtras,
  patchSkidmarksEpisodes,
  MAX_MEMBERS_PER_BAND,
  getSkidmarksSnapshot,
  type SkidmarksState,
} from "@/lib/skidmarks";
import { episodeNameFirstMessage, isEpisodeCastGenre, isInEpisode } from "@/lib/episodeCast";
import { shortsScriptEditorOpen } from "@/lib/shortsEpisodeCast";
import { openEpisodeScopeIn } from "@/lib/episodeScopes";
import { getOpenEpisodeFolder, pinOpenEpisodeFolder } from "@/lib/episodeFolders";
import { normalizeAdultShortsState } from "@/lib/adultShorts";
import { CharacterProfileFields } from "./CharacterProfileFields";
import {
  addPicturesToRosterExtra,
  buildRosterExtraCharacter,
  isRosterExtraGroup,
  rosterExtraSourceKey,
  type RosterExtraGroup,
} from "@/lib/rosterExtras";
import { SKIDMARKS_CAST_MAX_PICTURES, buildSkidmarksCastMember, castNameFromFileName } from "@/lib/skidmarksEpisodes";
import {
  CHARACTER_NAME_MAX,
  characterCanBeEdited,
  characterCanHaveVoice,
  characterCanHaveProfile,
  characterDeleteBlocker,
  characterVoice,
  deleteRosterCharacter,
  renameRosterCharacter,
  setCharacterVoiceId,
} from "@/lib/characterEdits";
import { EditGlyph, TILE_CORNER_BUTTON_SHAPE_CLASS, TrashGlyph } from "./TileCornerGlyphs";

/**
 * The thumbnail grid at the top of the Characters screen (2026-09-29):
 * every character Deck already knows, in three groups. Tap a face, tap
 * the confirm button, and the rest happens on its own — Siray makes
 * about 15 training pictures from that face, Replicate trains, and the
 * server converts and uploads the files (the card list below shows the
 * Comfy links once it's done). Progress is saved after every picture, so
 * closing the page just pauses it; it carries on next time this screen
 * opens.
 */

const SIRAY_AT_ONCE = 4;
/** Characters worked on at the same time when several are queued (Train everyone). */
const CHARACTERS_AT_ONCE = 2;
const MAX_FAILED_ROUNDS = 3;

const STYLE_LABELS: Record<CharacterTrainingStyle, string> = {
  photo: "Real-looking face",
  cartoon: "Cartoon",
  faceless: "Face hidden",
  render3d: "3D cartoon",
  semireal: "Semi-photoreal",
};

/**
 * The Cast thumbnails on every genre screen (Sunnybank, Music video,
 * Skidmarks, Shorts), one size for all (Stuart, 2026-09-30: twice the old
 * size). Each face is 176px square (the old sideways-row face was 88px).
 *
 * One sideways row (Stuart, 2026-10-01): the wrapping grid dropped the
 * dotted + onto a second line on the left. Now the faces sit on one line
 * that scrolls sideways (mouse, trackpad or a swipe), with the + last at
 * the far right, the same as the LOCATIONS row. Every face keeps its
 * 176px size on a phone too (184px tile with 4px padding each side).
 */
export const CAST_ROW_CLASS =
  "flex touch-pan-x touch-pan-y items-start gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]";
export const CAST_ROW_TILE_CLASS = "w-[184px] shrink-0";

const EMPTY_GROUP_TEXT: Record<RosterGroup, string> = {
  "music-video": "No characters yet. Add a band member, or tap + Add a character.",
  "sunny-banks": "No characters yet. Tap + Add a character.",
  skidmarks: "No Skidmarks characters yet. Tap + Add a character.",
  "adult-shorts": "No characters yet. Tick the 18+ confirm below, then tap + Add a character.",
};

/** Example look in the "+ Add a character" box, per group. */
const LOOK_PLACEHOLDER: Record<RosterGroup, string> = {
  "music-video": "Their look, e.g. early-30s guitarist, shaved head, sleeve tattoos, black denim jacket",
  "sunny-banks": "Their look, e.g. 60s neighbour, curlers, floral dressing gown, thongs",
  skidmarks: "Their look, e.g. late-40s bloke, sunburnt, wild grey mullet, faded hi-vis shirt, stubby shorts",
  "adult-shorts": "Their look, e.g. early-30s, long auburn hair or short dark hair and a beard",
};

interface CastUpload {
  key: string;
  name: string;
  isAnimal: boolean;
  files: File[];
  previews: string[];
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function patchEntry(id: string, patch: Partial<CharacterLoraEntry>) {
  patchCharacterLoras((s) => ({ characters: s.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
}

function findEntry(id: string): CharacterLoraEntry | null {
  return getCharacterLorasState().characters.find((c) => c.id === id) ?? null;
}

function Badge({ char, entry }: { char: RosterCharacter; entry: CharacterLoraEntry | null }) {
  if (char.blockedReason) return <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px]">🔒</span>;
  if (!entry) return null;
  if (entry.status === "ready")
    return (
      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
        ✓
      </span>
    );
  if (entry.status === "making" || entry.status === "training" || entry.status === "finishing")
    return (
      <span className="absolute right-1 top-1 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-medium text-black">
        {entry.status === "making" ? `${entry.trainingImageUrls.length}/${entry.autoPictureTarget ?? AUTO_PICTURE_TARGET}` : "…"}
      </span>
    );
  if (entry.awaitingReview && entry.status === "draft")
    return (
      <span className="absolute right-1 top-1 rounded-full bg-sky-500 px-1.5 text-[10px] font-semibold text-white">Check</span>
    );
  if (entry.status === "failed")
    return <span className="absolute right-1 top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">!</span>;
  return null;
}

/**
 * The one button on a face (top-right): an empty ring to start, a
 * filling ring while it works, a green tick once trained. No prices.
 */
function CornerButton({
  char,
  entry,
  onStart,
  onOpen,
}: {
  char: RosterCharacter;
  entry: CharacterLoraEntry | null;
  onStart: () => void;
  onOpen: () => void;
}) {
  const base = "absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full";
  if (char.blockedReason)
    return (
      <span className={`${base} bg-black/70 text-[11px]`} title={char.blockedReason}>
        🔒
      </span>
    );
  const status = entry?.status;
  if (status === "ready")
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`${base} bg-emerald-500 text-[13px] font-bold text-white shadow`}
        aria-label={`${char.name} is trained. Show their pictures`}
      >
        ✓
      </button>
    );
  if (status === "making" || status === "training" || status === "finishing") {
    const target = entry?.autoPictureTarget ?? AUTO_PICTURE_TARGET;
    // Pictures fill most of the ring; training spins the last part.
    const frac =
      status === "making"
        ? entry?.cleanReferenceApproved
          ? 0.1 + 0.7 * Math.min(1, (entry?.trainingImageUrls.length ?? 0) / Math.max(1, target))
          : 0.05
        : 0.9;
    const r = 11;
    const c = 2 * Math.PI * r;
    return (
      <span
        className={`${base} bg-black/70`}
        role="progressbar"
        aria-label={status === "making" ? `Making ${char.name}'s pictures` : `Training ${char.name}`}
        aria-valuenow={Math.round(frac * 100)}
      >
        <svg viewBox="0 0 28 28" className={`h-7 w-7 -rotate-90 ${status === "making" ? "" : "animate-spin"}`} aria-hidden>
          <circle cx="14" cy="14" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
          <circle
            cx="14"
            cy="14"
            r={r}
            fill="none"
            stroke="rgb(52 211 153)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${c * frac} ${c}`}
          />
        </svg>
      </span>
    );
  }
  if (status === "failed")
    return (
      <button
        type="button"
        onClick={onStart}
        className={`${base} bg-red-500 text-[13px] font-bold text-white shadow`}
        aria-label={`Didn't finish for ${char.name}. Tap to try again`}
        title={entry?.error ?? "Didn't finish. Tap to try again."}
      >
        !
      </button>
    );
  return (
    <button
      type="button"
      onClick={onStart}
      className={`${base} bg-black/60 shadow ring-2 ring-inset ring-white/70 hover:ring-emerald-300`}
      aria-label={`Train ${char.name}`}
      title={`Train ${char.name}`}
    >
      <span className="h-2 w-2 rounded-full bg-white/80" aria-hidden />
    </button>
  );
}

export function CharacterRosterGrid({
  snapshot,
  onlyGroup,
  bandMemberIds,
  addToBandId,
  renderEntryCard,
  simple = false,
}: {
  snapshot: SkidmarksState;
  /** Show just this group (the Characters bar on each project screen). */
  onlyGroup?: RosterGroup;
  /** Music video: only these band members (plus added characters). */
  bandMemberIds?: readonly string[];
  /** Music video: "+ Add a character" adds a member to this band. */
  addToBandId?: string;
  /** The character's LoRA card (pictures, Train, Comfy links), shown inside their panel. */
  renderEntryCard?: (entry: CharacterLoraEntry) => ReactNode;
  /**
   * One-button faces (Stuart, 2026-09-29; Sunny Banks first): a corner
   * button on each face does everything with no stops, prices or
   * settings; a ticked face opens just its pictures and Redo.
   */
  simple?: boolean;
}) {
  const roster = useMemo(() => buildCharacterRoster(snapshot), [snapshot]);
  const { characters } = getCharacterLorasState(snapshot);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [styleOverride, setStyleOverride] = useState<Record<string, CharacterTrainingStyle>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});
  const [armedGroup, setArmedGroup] = useState<string | null>(null);
  const [newCast, setNewCast] = useState<{ name: string; look: string; adult: boolean; openGroup: RosterGroup | null }>({
    name: "",
    look: "",
    adult: false,
    openGroup: null,
  });
  // Picked picture files, grouped by name ("Clive 1.jpg", "Clive 2.jpg" are one character).
  const [castUploads, setCastUploads] = useState<CastUpload[]>([]);
  const [castUploadBusy, setCastUploadBusy] = useState<string | null>(null);
  const castFileInput = useRef<HTMLInputElement | null>(null);
  /** Big view: a character's training pictures (flip + remove) or one single picture. */
  const [viewer, setViewer] = useState<{ entryId: string; index: number } | { url: string } | null>(null);
  const running = useRef(new Set<string>());
  const refCache = useRef(new Map<string, string>());
  /** The open character's name while it's being typed over (tap the name). */
  const [nameDraft, setNameDraft] = useState<{ key: string; value: string } | null>(null);
  /** Escape was pressed: the blur that follows must not save. */
  const cancelRename = useRef(false);
  /** The bin was tapped once on this character; a second tap deletes. */
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  /** A line under the open character's name: why a rename or delete didn't happen, or what to check. */
  const [editNotice, setEditNotice] = useState<{ key: string; text: string; tone: "warn" | "error" } | null>(null);
  /** The ElevenLabs voice id being pasted in next to the open character's name. */
  const [voiceDraft, setVoiceDraft] = useState<{ key: string; value: string } | null>(null);
  /** Escape was pressed in the voice box: the blur that follows must not save. */
  const cancelVoice = useRef(false);
  /** The voice ✕ was tapped once on this character; a second tap removes it. */
  const [confirmVoiceKey, setConfirmVoiceKey] = useState<string | null>(null);
  /** The character whose ▶ test line is being made. */
  const [voiceTestKey, setVoiceTestKey] = useState<string | null>(null);
  const voiceAudio = useRef<HTMLAudioElement | null>(null);

  const adultConfirmed = Boolean(normalizeAdultShortsState(snapshot.adultShorts)?.ageConfirmed);
  // Every Skidmarks and Shorts episode's Cast, so a training that's already running
  // keeps finding its character after another episode is opened (2026-10-04).
  const everyRoster = useMemo(() => buildCharacterRoster(snapshot, { everyEpisode: true }), [snapshot]);
  const allChars = useMemo(() => ROSTER_GROUPS.flatMap((g) => everyRoster[g.id]), [everyRoster]);
  const charByKey = useMemo(() => new Map(allChars.map((c) => [c.sourceKey, c])), [allChars]);

  const fail = (id: string, msg: string) => {
    patchEntry(id, { status: "failed", error: msg, autoPictureTarget: null });
    flushSkidmarksSessionNow();
  };

  /** Makes pictures until the target, then starts training. Safe to call twice; the second call is ignored. */
  const runMaking = async (entryId: string) => {
    if (running.current.has(entryId)) return;
    running.current.add(entryId);
    let failedRounds = 0;
    try {
      for (;;) {
        const e = findEntry(entryId);
        if (!e || e.status !== "making") return;
        const char: Pick<RosterCharacter, "name" | "look" | "neverShow" | "style"> & Partial<RosterCharacter> =
          (e.sourceKey && charByKey.get(e.sourceKey)) || { name: e.name, look: "", neverShow: "", style: e.trainingStyle };
        const withStyle = { ...char, style: e.trainingStyle };

        // One-button faces: draw the clean picture (arms down, empty hands)
        // and use it straight away, with no stop to okay it.
        if (e.autoTrain && !e.cleanReferenceApproved) {
          // A cartoon character's own uploaded picture is the reference as
          // it is: no clean redraw, which is where a flat 2D upload turned
          // soft 3D (2026-09-30).
          const upload = uploadedCartoonReference(
            { thumbUrl: char.thumbUrl ?? null, extraPictureUrls: char.extraPictureUrls ?? [] },
            e.trainingStyle,
          );
          if (upload) {
            try {
              const ref = await ensureTrainingPicture(upload, characterReferenceTargetFor(e));
              patchEntry(entryId, { referenceUrl: ref, cleanReferenceApproved: true, cleanCandidateUrl: null });
              flushSkidmarksSessionNow();
              failedRounds = 0;
            } catch (err) {
              failedRounds++;
              if (failedRounds >= MAX_FAILED_ROUNDS) {
                return fail(entryId, err instanceof Error ? err.message : "Couldn't load their picture to start from.");
              }
            }
            continue;
          }
          const src = char.thumbUrl ?? char.extraPictureUrls?.[0] ?? e.trainingImageUrls[0] ?? null;
          try {
            let refData: string | null = null;
            if (src) {
              refData = refCache.current.get(src) ?? (await referenceDataUrlFor(src));
              refCache.current.set(src, refData);
            }
            const clean = await makeSirayPicture(
              buildCleanReferencePrompt({ ...withStyle, subjectWord: e.subjectWord }, Boolean(refData)),
              refData,
              characterReferenceTargetFor(e),
            );
            patchEntry(entryId, { referenceUrl: clean, cleanReferenceApproved: true, cleanCandidateUrl: null });
            flushSkidmarksSessionNow();
            failedRounds = 0;
          } catch (err) {
            failedRounds++;
            const permanent = err instanceof AutoLoraError && err.permanent;
            if (permanent || failedRounds >= MAX_FAILED_ROUNDS) {
              return fail(entryId, err instanceof Error ? err.message : "Couldn't draw their clean picture.");
            }
          }
          continue;
        }

        // Their existing picture is only Siray's reference, never a training
        // picture: thumbnails often show a held prop (Shazza's cigarette, Nan's
        // bat) and anything in the training set gets baked into the LoRA.
        if (!e.referenceUrl) {
          const starts =
            "sourceKey" in char && char.sourceKey ? startingPictures(char as RosterCharacter, e) : e.trainingImageUrls.slice(0, 1);
          let ref: string | null = null;
          for (const s of starts) {
            try {
              ref = await ensureTrainingPicture(s, characterReferenceTargetFor(e));
              break;
            } catch {
              /* try the next picture */
            }
          }
          if (!ref) return fail(entryId, "Couldn't load their picture to start from.");
          patchEntry(entryId, { referenceUrl: ref });
          flushSkidmarksSessionNow();
          continue;
        }

        const target = e.autoPictureTarget ?? AUTO_PICTURE_TARGET;
        const have = e.trainingImageUrls.length;
        if (have >= target && e.autoTrain) {
          // One-button faces go straight on to training.
          try {
            patchEntry(entryId, await startCharacterTraining({ ...e, fictionalAdultConfirmed: true }));
            flushSkidmarksSessionNow();
          } catch (err) {
            fail(entryId, err instanceof Error ? err.message : "Training didn't start.");
          }
          return;
        }
        if (have >= target) {
          // Stop for a look. Training only starts from "Train on these".
          patchEntry(entryId, { status: "draft", awaitingReview: true, autoPictureTarget: null, error: null });
          flushSkidmarksSessionNow();
          return;
        }

        const refSrc = e.referenceUrl;
        let refData = refCache.current.get(refSrc);
        if (!refData) {
          refData = await referenceDataUrlFor(refSrc);
          refCache.current.set(refSrc, refData);
        }
        const prompts = buildTrainingPicturePrompts(
          { ...withStyle, subjectWord: e.subjectWord },
          Math.min(SIRAY_AT_ONCE, target - have),
          have,
          e.pictureRound ?? 0,
        );
        const results = await Promise.allSettled(
          prompts.map((p, i) => makeSirayPicture(p, refData!, characterPlateTargetFor(e, have + i + 1))),
        );
        const made = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        if (made.length > 0) {
          failedRounds = 0;
          patchCharacterLoras((s) => ({
            characters: s.characters.map((c) =>
              c.id === entryId ? { ...c, trainingImageUrls: [...c.trainingImageUrls, ...made].slice(0, target) } : c,
            ),
          }));
          flushSkidmarksSessionNow();
        } else {
          failedRounds++;
          const errors = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
          const permanent = errors.find((er) => er instanceof AutoLoraError && er.permanent);
          if (permanent || failedRounds >= MAX_FAILED_ROUNDS) {
            const first = (permanent ?? errors[0]) as Error | undefined;
            return fail(entryId, first?.message || "Siray kept failing, so this stopped. Tap to try again.");
          }
        }
      }
    } catch (err) {
      fail(entryId, err instanceof Error ? err.message : "Something went wrong. Tap to try again.");
    } finally {
      running.current.delete(entryId);
    }
  };

  /** Starts queued characters, a couple at a time, until none are left waiting. */
  const pump = () => {
    const waiting = getCharacterLorasState().characters.filter((c) => c.status === "making" && !running.current.has(c.id));
    for (const c of waiting) {
      if (running.current.size >= CHARACTERS_AT_ONCE) return;
      void runMaking(c.id).then(pump);
    }
  };

  // Carry on any run that was going when the page closed.
  const makingKey = characters
    .filter((c) => c.status === "making")
    .map((c) => c.id)
    .join(",");
  useEffect(() => {
    if (makingKey) pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [makingKey]);

  const styleFor = (char: RosterCharacter, entry: CharacterLoraEntry | null): CharacterTrainingStyle =>
    styleOverride[char.sourceKey] ?? entry?.trainingStyle ?? char.style;

  const ensureEntry = (char: RosterCharacter, style: CharacterTrainingStyle): CharacterLoraEntry => {
    const existing = entryForRosterCharacter(getCharacterLorasState().characters, char.sourceKey);
    if (existing) return existing;
    const created = buildCharacterLoraEntry(
      char.name,
      getCharacterLorasState().characters.map((c) => c.slug),
      new Date(),
      { sourceKey: char.sourceKey, trainingStyle: style, subjectWord: char.subjectWord },
    );
    patchCharacterLoras((s) => ({ characters: [...s.characters, created] }));
    return created;
  };

  const startOneTap = (char: RosterCharacter) => {
    const style = styleFor(char, entryForRosterCharacter(characters, char.sourceKey));
    const entry = ensureEntry(char, style);
    patchEntry(entry.id, {
      status: "making",
      trainingStyle: style,
      fictionalAdultConfirmed: true,
      error: null,
      awaitingReview: false,
      autoPictureTarget: Math.max(AUTO_PICTURE_TARGET, entry.trainingImageUrls.length),
    });
    flushSkidmarksSessionNow();
    pump();
  };

  /** The corner button: clean picture, pictures and training in one go. Picks the group's style itself. */
  const startAuto = (char: RosterCharacter) => {
    if (char.blockedReason) return;
    const entry = ensureEntry(char, char.style);
    if (entry.status === "making" || entry.status === "training" || entry.status === "finishing") return;
    patchEntry(entry.id, {
      status: "making",
      trainingStyle: char.style,
      subjectWord: char.subjectWord,
      fictionalAdultConfirmed: true,
      autoTrain: true,
      error: null,
      awaitingReview: false,
      autoPictureTarget: Math.max(AUTO_PICTURE_TARGET, entry.trainingImageUrls.length),
    });
    flushSkidmarksSessionNow();
    pump();
  };

  /**
   * Redo on a trained face: pictures Stuart removed get replaced with new
   * poses and places; if he removed none, all of them are made fresh.
   * Then it retrains (the next version, so the current one keeps working).
   */
  const redo = (char: RosterCharacter, entry: CharacterLoraEntry) => {
    const fresh = findEntry(entry.id) ?? entry;
    const keep = fresh.trainingImageUrls.length >= AUTO_PICTURE_TARGET ? [] : fresh.trainingImageUrls;
    patchEntry(entry.id, {
      trainingImageUrls: keep,
      pictureRound: (fresh.pictureRound ?? 0) + 1,
      status: "draft",
      // Cartoon (Sunny Banks): start again from their current first
      // picture, not the old saved reference (2026-09-30).
      ...redoReferenceReset(styleFor(char, fresh)),
    });
    setSelectedKey(null);
    startAuto(char);
  };

  /** Who "Train everyone" would start in a group, and what it costs. */
  const groupPlan = (list: RosterCharacter[]) => {
    const ready: RosterCharacter[] = [];
    let needFace = 0;
    let totalUsd = 0;
    for (const c of list) {
      if (c.blockedReason) continue;
      const entry = entryForRosterCharacter(characters, c.sourceKey);
      if (entry && ((entry.status !== "draft" && entry.status !== "failed") || entry.awaitingReview)) continue;
      if (!entry?.cleanReferenceApproved) {
        needFace++;
        continue;
      }
      ready.push(c);
      const starting = entry?.trainingImageUrls.length ?? 0;
      totalUsd += oneTapCost(starting).totalUsd;
    }
    return { ready, needFace, totalUsd: Math.round(totalUsd * 100) / 100 };
  };

  const trainChecked = async (char: RosterCharacter, entry: CharacterLoraEntry) => {
    setBusyKey(char.sourceKey);
    setMessage((m) => ({ ...m, [char.sourceKey]: "" }));
    try {
      const fresh = findEntry(entry.id) ?? entry;
      patchEntry(entry.id, await startCharacterTraining({ ...fresh, fictionalAdultConfirmed: true }));
      patchEntry(entry.id, { fictionalAdultConfirmed: true });
      flushSkidmarksSessionNow();
    } catch (err) {
      setMessage((m) => ({ ...m, [char.sourceKey]: err instanceof Error ? err.message : "Training didn't start." }));
    } finally {
      setBusyKey(null);
    }
  };

  const removeReviewPicture = (entry: CharacterLoraEntry, url: string) => {
    patchEntry(entry.id, { trainingImageUrls: entry.trainingImageUrls.filter((u) => u !== url) });
    flushSkidmarksSessionNow();
  };

  /**
   * One clean base picture (arms down, empty hands, plain background)
   * that every training picture is then made from. Thumbnails often show
   * props or folded arms, and Siray copies the reference closely, so
   * making the 15 straight from them gave cigarettes and four arms.
   */
  const makeClean = async (char: RosterCharacter) => {
    setBusyKey(char.sourceKey);
    setMessage((m) => ({ ...m, [char.sourceKey]: "" }));
    try {
      const style = styleFor(char, entryForRosterCharacter(characters, char.sourceKey));
      const entry = ensureEntry(char, style);
      const src = char.thumbUrl ?? char.extraPictureUrls[0] ?? null;
      let refData: string | null = null;
      if (src) {
        refData = refCache.current.get(src) ?? (await referenceDataUrlFor(src));
        refCache.current.set(src, refData);
      }
      const url = await makeSirayPicture(
        buildCleanReferencePrompt({ ...char, style }, Boolean(refData)),
        refData,
        characterReferenceCandidateTargetFor(entry),
      );
      const fresh = findEntry(entry.id) ?? entry;
      patchEntry(entry.id, {
        cleanCandidateUrl: url,
        trainingStyle: style,
        error: null,
        status: fresh.status === "failed" ? "draft" : fresh.status,
      });
      flushSkidmarksSessionNow();
    } catch (err) {
      setMessage((m) => ({ ...m, [char.sourceKey]: err instanceof Error ? err.message : "Siray couldn't make the picture." }));
    } finally {
      setBusyKey(null);
    }
  };

  const approveClean = (entry: CharacterLoraEntry) => {
    if (!entry.cleanCandidateUrl) return;
    patchEntry(entry.id, { referenceUrl: entry.cleanCandidateUrl, cleanReferenceApproved: true, cleanCandidateUrl: null });
    flushSkidmarksSessionNow();
  };

  /** The clean-base step, shown wherever making pictures would otherwise start. */
  const renderCleanStep = (char: RosterCharacter, entry: CharacterLoraEntry | null) => {
    const busy = busyKey === char.sourceKey;
    const candidate = entry?.cleanCandidateUrl ?? null;
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
        {candidate ? (
          <>
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => setViewer({ url: candidate })}
                className="h-32 w-32 shrink-0 overflow-hidden rounded-md bg-white/5"
                aria-label="View bigger"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={candidate} alt="" className="h-full w-full object-cover object-top" />
              </button>
              <p className="text-xs text-white/60">
                Is this {char.name}? Check the face, two arms, and nothing in the hands. All the training pictures are made from
                this one.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => approveClean(entry!)}
                disabled={busy}
                className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Use this
              </button>
              <button
                type="button"
                onClick={() => makeClean(char)}
                disabled={busy}
                className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/85 disabled:opacity-40"
              >
                {busy ? "Drawing…" : "Try another"} · {formatCostUsd(SIRAY_PICTURE_COST_USD)}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-white/60">
              {char.thumbUrl || char.extraPictureUrls.length > 0
                ? `First, Siray draws one clean picture of ${char.name} from this one: arms down, empty hands, plain background. You okay it, then all the training pictures are made from it.`
                : `${char.name} doesn't have a picture yet. Siray draws one clean picture from their description (arms down, empty hands, plain background). You okay it, then all the training pictures are made from it.`}
            </p>
            {!char.thumbUrl && char.look && <p className="line-clamp-2 text-[11px] italic text-white/40">{char.look}</p>}
            <button
              type="button"
              onClick={() => makeClean(char)}
              disabled={busy}
              className="self-start rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {busy ? "Drawing…" : "Make clean picture"} · {formatCostUsd(SIRAY_PICTURE_COST_USD)}
            </button>
          </>
        )}
      </div>
    );
  };

  // Only a character on the row (a Skidmarks card from another episode
  // isn't, 2026-10-04) can be open.
  const onRow = new Set(ROSTER_GROUPS.flatMap((g) => roster[g.id]).map((c) => c.sourceKey));
  const selected = selectedKey && onRow.has(selectedKey) ? charByKey.get(selectedKey) ?? null : null;
  const selectedEntry = selected ? entryForRosterCharacter(characters, selected.sourceKey) : null;

  const openCharacter = (key: string) => {
    setSelectedKey(key);
    setNameDraft(null);
    setConfirmDeleteKey(null);
    setEditNotice(null);
  };

  const closeSelected = () => {
    setSelectedKey(null);
    setNameDraft(null);
    setConfirmDeleteKey(null);
    setEditNotice(null);
    setVoiceDraft(null);
    setConfirmVoiceKey(null);
  };

  /** Enter or leaving the voice box saves the id; Escape leaves it as it was. */
  const commitVoice = (char: RosterCharacter) => {
    const draft = voiceDraft && voiceDraft.key === char.sourceKey && !cancelVoice.current ? voiceDraft.value : null;
    cancelVoice.current = false;
    setVoiceDraft(null);
    if (draft === null || !draft.trim()) return;
    const result = setCharacterVoiceId(char, draft);
    setEditNotice(result.ok ? null : { key: char.sourceKey, text: result.error, tone: "error" });
  };

  /** Two taps: the first turns the ✕ red, the second takes the voice off. */
  const tapRemoveVoice = (char: RosterCharacter) => {
    if (confirmVoiceKey !== char.sourceKey) {
      setConfirmVoiceKey(char.sourceKey);
      return;
    }
    setConfirmVoiceKey(null);
    const result = setCharacterVoiceId(char, null);
    setEditNotice(result.ok ? null : { key: char.sourceKey, text: result.error, tone: "error" });
  };

  /** ▶ — says a short hello in this voice (ElevenLabs only; nothing is saved). */
  const playVoiceTest = async (char: RosterCharacter, voiceId: string) => {
    if (voiceTestKey) return;
    setVoiceTestKey(char.sourceKey);
    setConfirmVoiceKey(null);
    try {
      const res = await fetch("/api/skidmarks/sunnybank/generate-speak-beat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "voice-test", voiceId, line: `G'day, it's ${char.name.trim()}.` }),
      });
      const data = (await res.json().catch(() => ({}))) as { audioDataUrl?: string; error?: string; message?: string };
      if (!res.ok || !data.audioDataUrl) {
        throw new Error(data.error || data.message || `The voice test didn't work (${res.status}).`);
      }
      voiceAudio.current?.pause();
      const audio = new Audio(data.audioDataUrl);
      voiceAudio.current = audio;
      await audio.play();
    } catch (err) {
      setEditNotice({ key: char.sourceKey, text: err instanceof Error ? err.message : "The voice test didn't work.", tone: "error" });
    } finally {
      setVoiceTestKey(null);
    }
  };

  /** Tiny voice controls right after the name: "+ voice", or ▶ ✎ ✕. */
  const renderVoiceControls = (char: RosterCharacter, entry: CharacterLoraEntry | null) => {
    if (!characterCanHaveVoice(char, snapshot)) return null;
    if (voiceDraft?.key === char.sourceKey) {
      return (
        <input
          autoFocus
          value={voiceDraft.value}
          onChange={(e) => setVoiceDraft({ key: char.sourceKey, value: e.target.value })}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => commitVoice(char)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              cancelVoice.current = true;
              e.currentTarget.blur();
            }
          }}
          placeholder="voice ID"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          maxLength={80}
          aria-label={`ElevenLabs voice ID for ${char.name}`}
          className="h-6 w-32 min-w-0 rounded border border-white/15 bg-black/40 px-1.5 text-[16px] leading-none text-white"
        />
      );
    }
    const voice = characterVoice(char, entry);
    const tiny = "flex h-5 w-5 shrink-0 touch-manipulation items-center justify-center rounded-full text-[10px] leading-none";
    if (!voice) {
      return (
        <button
          type="button"
          onClick={() => {
            setEditNotice(null);
            setVoiceDraft({ key: char.sourceKey, value: "" });
          }}
          className="shrink-0 text-[11px] text-sky-300/80 hover:text-sky-200"
          aria-label={`Add an ElevenLabs voice for ${char.name}`}
        >
          + voice
        </button>
      );
    }
    const testing = voiceTestKey === char.sourceKey;
    const confirmingVoice = confirmVoiceKey === char.sourceKey;
    return (
      <span className="flex shrink-0 items-center gap-0.5" title={`Voice ${voice.voiceId}`}>
        <button
          type="button"
          onClick={() => void playVoiceTest(char, voice.voiceId)}
          disabled={Boolean(voiceTestKey)}
          className={`${tiny} text-sky-300/90 hover:text-sky-200 disabled:opacity-50`}
          aria-label={testing ? `Playing ${char.name}'s voice` : `Play ${char.name}'s voice`}
        >
          {testing ? "…" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirmVoiceKey(null);
            setEditNotice(null);
            setVoiceDraft({ key: char.sourceKey, value: voice.voiceId });
          }}
          className={`${tiny} text-white/50 hover:text-white`}
          aria-label={`Change ${char.name}'s voice ID`}
        >
          <EditGlyph />
        </button>
        {voice.saved && (
          <button
            type="button"
            onClick={() => tapRemoveVoice(char)}
            className={`${tiny} ${confirmingVoice ? "bg-red-500/80 text-white" : "text-white/40 hover:text-red-300"}`}
            aria-label={confirmingVoice ? `Tap again to remove ${char.name}'s voice` : `Remove ${char.name}'s voice`}
          >
            ✕
          </button>
        )}
      </span>
    );
  };

  /** Enter or leaving the box saves the name; Escape puts the old one back. */
  const commitName = (char: RosterCharacter) => {
    const draft = nameDraft && nameDraft.key === char.sourceKey && !cancelRename.current ? nameDraft.value : null;
    cancelRename.current = false;
    setNameDraft(null);
    if (draft === null || draft.trim() === char.name.trim()) return;
    const result = renameRosterCharacter(char, draft);
    if (!result.ok) {
      setEditNotice({ key: char.sourceKey, text: result.error, tone: "error" });
      return;
    }
    if (result.sourceKey !== char.sourceKey) setSelectedKey(result.sourceKey);
    setEditNotice(result.note ? { key: result.sourceKey, text: result.note, tone: "warn" } : null);
  };

  /** Two taps, like the bin on an episode card: the first says what will happen, the second removes. */
  const tapDelete = (char: RosterCharacter, entry: CharacterLoraEntry | null) => {
    const blocker = characterDeleteBlocker(char, snapshot);
    if (blocker) {
      setConfirmDeleteKey(null);
      setEditNotice({ key: char.sourceKey, text: blocker, tone: "error" });
      return;
    }
    if (confirmDeleteKey !== char.sourceKey) {
      setConfirmDeleteKey(char.sourceKey);
      setEditNotice({
        key: char.sourceKey,
        text:
          `Tap the bin again to take ${char.name} off the list.` +
          (entry?.status === "ready" ? " Their trained LoRA card goes too." : "") +
          " Their pictures and files stay in storage.",
        tone: "warn",
      });
      return;
    }
    const result = deleteRosterCharacter(char);
    if (!result.ok) {
      setConfirmDeleteKey(null);
      setEditNotice({ key: char.sourceKey, text: result.error, tone: "error" });
      return;
    }
    closeSelected();
  };

  /**
   * The top line of an open character: their name (tap it to rename),
   * the bin, and the close ✕. Built-in Sunny Banks regulars keep a plain
   * name and no bin (their names are Deck's cast list).
   */
  const renderPanelHeader = (char: RosterCharacter, entry: CharacterLoraEntry | null, extra?: ReactNode) => {
    const editable = characterCanBeEdited(char, snapshot);
    const editing = editable && nameDraft?.key === char.sourceKey;
    const confirming = confirmDeleteKey === char.sourceKey;
    const notice = editNotice?.key === char.sourceKey ? editNotice : null;
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {editing ? (
              <input
                autoFocus
                value={nameDraft?.value ?? ""}
                onChange={(e) => setNameDraft({ key: char.sourceKey, value: e.target.value })}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => commitName(char)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") {
                    cancelRename.current = true;
                    e.currentTarget.blur();
                  }
                }}
                maxLength={CHARACTER_NAME_MAX}
                aria-label={`Rename ${char.name}`}
                className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs text-white"
              />
            ) : editable ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteKey(null);
                  setEditNotice(null);
                  setNameDraft({ key: char.sourceKey, value: char.name });
                }}
                className="min-w-0 truncate text-left text-sm font-semibold text-white"
                title="Tap to rename"
                aria-label={`${char.name}. Tap to rename`}
              >
                {char.name}
              </button>
            ) : (
              <p className="truncate text-sm font-semibold text-white">{char.name}</p>
            )}
            {!editing && renderVoiceControls(char, entry)}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {extra}
            {editable && (
              <button
                type="button"
                onClick={() => tapDelete(char, entry)}
                aria-label={confirming ? `Tap again to delete ${char.name}` : `Delete ${char.name}`}
                title="Delete character"
                className={`${TILE_CORNER_BUTTON_SHAPE_CLASS} ${
                  confirming ? "bg-red-500/80 text-white" : "bg-black/50 text-white/70 hover:bg-red-500/60"
                }`}
              >
                <TrashGlyph />
              </button>
            )}
            <button type="button" onClick={closeSelected} className="px-1 text-xs text-white/40" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"} className={`mt-1 text-[11px] ${notice.tone === "error" ? "text-red-300" : "text-amber-200/80"}`}>
            {notice.text}
          </p>
        )}
        {/* Shorts characters' optional profile (2026-09-30), folded to one line. */}
        {characterCanHaveProfile(char, snapshot) && <CharacterProfileFields key={char.sourceKey} char={char} entry={entry} />}
      </>
    );
  };

  const renderSelected = (char: RosterCharacter) => {
    const entry = entryForRosterCharacter(characters, char.sourceKey);
    const face = entry?.referenceUrl ?? char.thumbUrl;
    const style = styleFor(char, entry);
    const starting = entry?.trainingImageUrls.length ?? 0;
    const cost = oneTapCost(starting);
    const busy = busyKey === char.sourceKey;
    const status = entry?.status;
    const canTrain = Boolean(face) && !char.blockedReason && status !== "making" && status !== "training" && status !== "finishing";

    return (
      <div className="col-span-full rounded-xl border border-sky-400/25 bg-black/30 p-3">
        <div className="flex items-start gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-white/5">
            {face ? (
              <button type="button" onClick={() => setViewer({ url: face })} className="block h-full w-full" aria-label="View bigger">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={face} alt="" className="h-full w-full object-cover" />
              </button>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg text-white/40">{initials(char.name)}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {renderPanelHeader(char, entry)}

            {char.blockedReason ? (
              <p className="mt-1 text-xs text-red-200/80">{char.blockedReason}</p>
            ) : status === "ready" ? (
              <div className="mt-1 flex flex-col gap-1.5">
                <p className="text-xs text-emerald-200/80">
                  Trained{entry?.importedToComfy ? " and imported into Comfy" : ""}. The Comfy import links are on their card
                  below.
                </p>
                <button
                  type="button"
                  onClick={() => document.getElementById(`clora-card-${entry!.id}`)?.scrollIntoView({ behavior: "smooth" })}
                  className="self-start rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/80"
                >
                  Show card
                </button>
              </div>
            ) : entry?.awaitingReview && status === "draft" ? (
              <div className="mt-1 flex flex-col gap-2">
                <p className="text-xs text-white/60">
                  Siray made these. Remove any that don&apos;t look like {char.name} (wrong face, extra people, odd hands), then
                  train. Training is about {formatCostUsd(CHARACTER_LORA_ESTIMATED_COST_USD)}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => trainChecked(char, entry)}
                    disabled={busy || entry.trainingImageUrls.length < CHARACTER_LORA_MIN_IMAGES}
                    className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {busy ? "Starting…" : `Train on these ${entry.trainingImageUrls.length}`}
                  </button>
                  {entry.trainingImageUrls.length < AUTO_PICTURE_TARGET && entry.cleanReferenceApproved && (
                    <button
                      type="button"
                      onClick={() => startOneTap(char)}
                      disabled={busy}
                      className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/85 disabled:opacity-40"
                    >
                      Make {AUTO_PICTURE_TARGET - entry.trainingImageUrls.length} more ·{" "}
                      {formatCostUsd((AUTO_PICTURE_TARGET - entry.trainingImageUrls.length) * SIRAY_PICTURE_COST_USD)}
                    </button>
                  )}
                </div>
                {entry.trainingImageUrls.length < CHARACTER_LORA_MIN_IMAGES && (
                  <p className="text-[11px] text-amber-200/80">Needs at least {CHARACTER_LORA_MIN_IMAGES} pictures to train.</p>
                )}
                {entry.trainingImageUrls.length < AUTO_PICTURE_TARGET && !entry.cleanReferenceApproved && (
                  <>
                    <p className="text-[11px] text-white/45">To make more, start from a clean picture:</p>
                    {renderCleanStep(char, entry)}
                  </>
                )}
                {message[char.sourceKey] && <p className="text-xs text-red-300">{message[char.sourceKey]}</p>}
              </div>
            ) : status === "making" ? (
              <p className="mt-1 text-xs text-amber-100/80">
                Making training pictures with Siray: {entry!.trainingImageUrls.length} of{" "}
                {entry!.autoPictureTarget ?? AUTO_PICTURE_TARGET}. Then it stops so you can check them before training. Keep this screen open,
                or come back later and it carries on.
              </p>
            ) : status === "training" || status === "finishing" ? (
              <p className="mt-1 text-xs text-amber-100/80">Training on Replicate, about 5 to 7 minutes. The tick appears when it&apos;s done.</p>
            ) : (
              <div className="mt-1 flex flex-col gap-2">
                {status === "failed" && entry?.error && <p className="text-xs text-red-300">{entry.error}</p>}
                {entry?.cleanReferenceApproved ? (
                  <p className="text-xs text-white/60">
                    Siray makes {cost.sirayPictures} pictures of {char.name} from their clean picture, all with empty hands (
                    {formatCostUsd(cost.sirayPictures * SIRAY_PICTURE_COST_USD)}). You check them, then training is about{" "}
                    {formatCostUsd(CHARACTER_LORA_ESTIMATED_COST_USD)}. Tapping confirms {char.name} is made up, clearly an
                    adult, and not a real person.
                  </p>
                ) : (
                  renderCleanStep(char, entry)
                )}
                <label className="flex items-center gap-1.5 text-[11px] text-white/50">
                  Style
                  <select
                    value={style}
                    onChange={(e) => setStyleOverride((s) => ({ ...s, [char.sourceKey]: e.target.value as CharacterTrainingStyle }))}
                    className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[11px] text-white"
                  >
                    {(Object.keys(STYLE_LABELS) as CharacterTrainingStyle[]).map((s) => (
                      <option key={s} value={s}>
                        {STYLE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  {canTrain && entry?.cleanReferenceApproved && (
                    <button
                      type="button"
                      onClick={() => startOneTap(char)}
                      disabled={busy}
                      className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {status === "failed" ? "Try again" : "Make pictures"} · {formatCostUsd(cost.sirayPictures * SIRAY_PICTURE_COST_USD)}
                    </button>
                  )}
                  {entry?.cleanReferenceApproved && (
                    <button
                      type="button"
                      onClick={() => {
                        patchEntry(entry.id, { cleanReferenceApproved: false });
                        void makeClean(char);
                      }}
                      disabled={busy}
                      className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/85 disabled:opacity-40"
                    >
                      New clean picture · {formatCostUsd(SIRAY_PICTURE_COST_USD)}
                    </button>
                  )}
                </div>
                {message[char.sourceKey] && <p className="text-xs text-red-300">{message[char.sourceKey]}</p>}
              </div>
            )}
          </div>
        </div>
        {entry && entry.trainingImageUrls.length > 0 && (entry.awaitingReview || status === "making") && (
          <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {entry.trainingImageUrls.map((u) => (
              <div key={u} className="relative aspect-square overflow-hidden rounded-md bg-white/5">
                <button
                  type="button"
                  onClick={() => setViewer({ entryId: entry.id, index: entry.trainingImageUrls.indexOf(u) })}
                  className="block h-full w-full"
                  aria-label="View bigger"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="h-full w-full object-cover" />
                </button>
                {entry.awaitingReview && status === "draft" && (
                  <button
                    type="button"
                    onClick={() => removeReviewPicture(entry, u)}
                    className="absolute right-0.5 top-0.5 rounded bg-black/75 px-1.5 text-[11px] text-red-300"
                    aria-label="Remove picture"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  /**
   * An opened face: its name (tap to rename), the bin and ✕ on every face.
   * A ticked one also shows its pictures (X to remove each) and Redo; a
   * failed one shows why and Try again.
   */
  const renderSimpleSelected = (char: RosterCharacter) => {
    const entry = entryForRosterCharacter(characters, char.sourceKey);
    if (entry?.status === "failed")
      return (
        <div className="col-span-full rounded-xl border border-red-400/25 bg-black/30 p-3">
          {renderPanelHeader(char, entry)}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-xs text-red-200/90">{entry.error ?? "That didn't finish."}</p>
            <button
              type="button"
              onClick={() => {
                closeSelected();
                startAuto(char);
              }}
              className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white"
            >
              Try again
            </button>
          </div>
        </div>
      );
    if (!entry || entry.status !== "ready")
      return <div className="col-span-full rounded-xl border border-white/10 bg-black/30 p-3">{renderPanelHeader(char, entry)}</div>;
    const pics = entry.trainingImageUrls;
    return (
      <div className="col-span-full rounded-xl border border-emerald-400/25 bg-black/30 p-3">
        <div className="mb-2">
          {renderPanelHeader(
            char,
            entry,
            <button
              type="button"
              onClick={() => redo(char, entry)}
              className="rounded-md border border-white/20 px-3 py-1 text-xs text-white/85 hover:border-white/40"
            >
              Redo
            </button>,
          )}
        </div>
        {pics.length === 0 ? (
          <p className="text-[11px] text-white/40">No pictures kept for {char.name}. Redo makes a new set.</p>
        ) : (
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {pics.map((u, i) => (
              <div key={`${u}-${i}`} className="relative aspect-square overflow-hidden rounded-md bg-white/5">
                <button
                  type="button"
                  onClick={() => setViewer({ entryId: entry.id, index: i })}
                  className="block h-full w-full"
                  aria-label="View bigger"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="h-full w-full object-cover object-top" />
                </button>
                <button
                  type="button"
                  onClick={() => removeReviewPicture(findEntry(entry.id) ?? entry, u)}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-[11px] text-red-300"
                  aria-label="Remove picture"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const newCastBlocked = minorBlockReason(`${newCast.name} ${newCast.look}`);
  const uploadsBlocked = castUploads.map((u) => (u.isAnimal ? null : minorBlockReason(u.name))).find(Boolean) ?? null;
  const hasUploads = castUploads.length > 0;
  const canAddCast = hasUploads
    ? newCast.adult && !uploadsBlocked && !castUploadBusy && castUploads.every((u) => u.name.trim().length > 0)
    : newCast.name.trim().length > 0 && newCast.look.trim().length > 0 && newCast.adult && !newCastBlocked;
  const addGroup = newCast.openGroup;
  /** Names already in the group being added to, so a picture with that name adds to them. */
  const addGroupKeyByName = new Map(
    (addGroup ? roster[addGroup] : []).map((c) => [slugifyCharacterName(c.name), c.sourceKey]),
  );

  const clearCastUploads = () => {
    setCastUploads((list) => {
      for (const u of list) for (const p of u.previews) URL.revokeObjectURL(p);
      return [];
    });
  };

  const closeAddCast = () => {
    clearCastUploads();
    setCastUploadBusy(null);
    setNewCast({ name: "", look: "", adult: false, openGroup: null });
  };

  const pickCastFiles = (files: FileList | null) => {
    const picked = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!picked.length) return;
    setCastUploads((list) => {
      const next = list.map((u) => ({ ...u, files: [...u.files], previews: [...u.previews] }));
      for (const f of picked) {
        const name = castNameFromFileName(f.name) || "New character";
        const key = name.toLowerCase();
        let group = next.find((u) => u.key === key);
        if (!group) {
          group = { key, name, isAnimal: false, files: [], previews: [] };
          next.push(group);
        }
        if (group.files.length >= SKIDMARKS_CAST_MAX_PICTURES) continue;
        group.files.push(f);
        group.previews.push(URL.createObjectURL(f));
      }
      return next;
    });
  };

  /**
   * Saves one character (or a batch from pictures) to the open group.
   * Skidmarks goes to its cast list (the episodes read it); every other
   * group goes to its added-characters list. A name already in the group
   * gets the pictures added instead of a second character.
   */
  const saveCharacter = (
    group: RosterGroup,
    name: string,
    look: string,
    urls: string[],
    isAnimal: boolean,
  ): string => {
    const slug = slugifyCharacterName(name);
    if (group === "music-video" && addToBandId) {
      const memberId = addSkidmarksMemberWithPictures(addToBandId, name, look, urls);
      if (!memberId) {
        setMessage((m) => ({ ...m, "add-cast": `This band already has ${MAX_MEMBERS_PER_BAND} people.` }));
        return "";
      }
      return `mv:${memberId}`;
    }
    if (group === "skidmarks") {
      const existingKey = addGroupKeyByName.get(slug);
      const existingId = existingKey?.startsWith("sk:") ? existingKey.slice(3) : null;
      if (existingId) {
        patchSkidmarksEpisodes((st) => ({
          ...st,
          cast: st.cast.map((c) =>
            c.id === existingId
              ? {
                  ...c,
                  pictureUrls: [...new Set([...(c.pictureUrls ?? []), ...urls])].slice(0, SKIDMARKS_CAST_MAX_PICTURES),
                  ...(isAnimal ? { isAnimal: true } : {}),
                }
              : c,
          ),
        }));
        return existingKey as string;
      }
      // A new card belongs to the open episode (2026-10-04, each Skidmarks
      // episode has its own Cast); `addCharacters` pinned its folder first.
      const episode = getOpenEpisodeFolder("skidmarks");
      const member = buildSkidmarksCastMember(name, look, "supporting", Date.now(), undefined, { pictureUrls: urls, isAnimal, episode });
      patchSkidmarksEpisodes((st) => ({ ...st, cast: [...st.cast, member] }));
      return `sk:${member.id}`;
    }
    if (!isRosterExtraGroup(group)) return "";
    const g: RosterExtraGroup = group;
    // Shorts (2026-10-04, each episode has its own Cast): only the open
    // episode's people are matched by name, and a new one is tagged with
    // the episode (`addCharacters` pinned its folder first).
    const shortsScope = g === "adult-shorts" ? openEpisodeScopeIn(getSkidmarksSnapshot(), "adult-shorts") : null;
    const already = getRosterExtrasState()[g].find(
      (x) => slugifyCharacterName(x.name) === slug && (!shortsScope || isInEpisode(x, shortsScope)),
    );
    if (already) {
      patchRosterExtras((st) => ({ ...st, [g]: st[g].map((x) => (x.id === already.id ? addPicturesToRosterExtra(x, urls, isAnimal) : x)) }));
    } else {
      const episode = g === "adult-shorts" ? getOpenEpisodeFolder("adult-shorts") : null;
      const c = buildRosterExtraCharacter(name, look, { pictureUrls: urls, isAnimal, episode });
      patchRosterExtras((st) => ({ ...st, [g]: [...st[g], c] }));
      // A built-in character with this name (a band member, a Sunnybank
      // regular) keeps their own tile; the pictures just join them.
      return addGroupKeyByName.get(slug) ?? rosterExtraSourceKey(g, c.id);
    }
    return addGroupKeyByName.get(slug) ?? rosterExtraSourceKey(g, already.id);
  };

  const addCharacters = async () => {
    if (!canAddCast || !addGroup) return;
    // Skidmarks and Shorts (2026-10-04): a new card belongs to the open
    // episode, so the episode needs a name (its folder is pinned here).
    if (isEpisodeCastGenre(addGroup) && !pinOpenEpisodeFolder(addGroup)) {
      setMessage((m) => ({ ...m, "add-cast": episodeNameFirstMessage(addGroup, "characters", shortsScriptEditorOpen(getSkidmarksSnapshot())) }));
      return;
    }
    if (!hasUploads) {
      const key = saveCharacter(addGroup, newCast.name, newCast.look, [], false);
      flushSkidmarksSessionNow();
      closeAddCast();
      if (key) setSelectedKey(key);
      return;
    }
    let lastKey: string | null = null;
    try {
      for (const u of castUploads) {
        const urls: string[] = [];
        // Pictures joining someone already here number on from theirs.
        const existingKey = addGroupKeyByName.get(slugifyCharacterName(u.name));
        const existingChar = existingKey ? roster[addGroup].find((c) => c.sourceKey === existingKey) : undefined;
        const already = existingChar ? (existingChar.thumbUrl ? 1 : 0) + existingChar.extraPictureUrls.length : 0;
        for (let i = 0; i < u.previews.length; i++) {
          setCastUploadBusy(`Saving ${u.name.trim()}, picture ${i + 1} of ${u.previews.length}…`);
          const target = rosterPictureTargetFor(addGroup, u.name, existingKey, already + i + 1, addToBandId);
          urls.push(await toTrainingPicture(u.previews[i], target));
        }
        lastKey = saveCharacter(addGroup, u.name, "", urls, u.isAnimal) || lastKey;
        flushSkidmarksSessionNow();
      }
      closeAddCast();
      if (lastKey) setSelectedKey(lastKey);
    } catch (err) {
      setCastUploadBusy(null);
      setMessage((m) => ({
        ...m,
        "add-cast": err instanceof Error ? err.message : "A picture couldn't be saved. Try again.",
      }));
    }
  };

  const renderCastUploads = () =>
    hasUploads ? (
      <div className="flex flex-col gap-2">
        {castUploads.map((u, i) => {
          const existing = addGroupKeyByName.has(slugifyCharacterName(u.name));
          return (
            <div key={u.key} className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-black/30 p-1.5">
              <div className="flex gap-1 overflow-x-auto">
                {u.previews.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={p} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={u.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setCastUploads((list) => list.map((x, j) => (j === i ? { ...x, name } : x)));
                  }}
                  maxLength={60}
                  className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs text-white"
                />
                {addGroup !== "adult-shorts" && (
                  <label className="flex items-center gap-1 text-[11px] text-white/60">
                    <input
                      type="checkbox"
                      checked={u.isAnimal}
                      onChange={(e) => {
                        const isAnimal = e.target.checked;
                        setCastUploads((list) => list.map((x, j) => (j === i ? { ...x, isAnimal } : x)));
                      }}
                    />
                    Animal
                  </label>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setCastUploads((list) => {
                      for (const p of list[i]?.previews ?? []) URL.revokeObjectURL(p);
                      return list.filter((_, j) => j !== i);
                    })
                  }
                  className="text-[11px] text-white/50"
                  aria-label={`Remove ${u.name}`}
                >
                  ✕
                </button>
              </div>
              <p className="text-[10px] text-white/40">
                {u.previews.length} picture{u.previews.length === 1 ? "" : "s"}
                {existing ? ` · adds to your existing ${u.name.trim()}` : " · new character"}
              </p>
            </div>
          );
        })}
      </div>
    ) : null;

  /**
   * The same "+ Add a character" box in every group (Stuart: one form
   * factor everywhere). Skidmarks characters go to the Skidmarks cast list
   * so the episodes can use them; the others go to that group's list.
   */
  const openAddCast = (group: RosterGroup) => {
    clearCastUploads();
    setNewCast({ name: "", look: "", adult: false, openGroup: group });
  };

  const renderAddCharacter = (group: RosterGroup) =>
    newCast.openGroup === group ? (
      <div className="mb-2 flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
        <input
          ref={castFileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            pickCastFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => castFileInput.current?.click()}
          disabled={Boolean(castUploadBusy)}
          className="rounded-md border border-dashed border-white/25 px-2 py-2 text-xs text-white/80 disabled:opacity-40"
        >
          {hasUploads ? "+ Add more pictures" : "Add from pictures (pick one or many)"}
        </button>
        {hasUploads ? (
          <p className="text-[11px] text-white/50">
            Each file name becomes the name. Pictures with the same name and a number (Clive 1, Clive 2) go to one character.
            A name you already have adds the pictures to them.
          </p>
        ) : (
          <>
            <input
              value={newCast.name}
              onChange={(e) => setNewCast((c) => ({ ...c, name: e.target.value }))}
              placeholder="Name"
              maxLength={60}
              className="rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white placeholder:text-white/30"
            />
            <textarea
              value={newCast.look}
              onChange={(e) => setNewCast((c) => ({ ...c, look: e.target.value }))}
              placeholder={LOOK_PLACEHOLDER[group]}
              rows={2}
              maxLength={600}
              className="rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white placeholder:text-white/30"
            />
          </>
        )}
        {renderCastUploads()}
        <label className="flex items-start gap-2 text-[11px] text-white/60">
          <input
            type="checkbox"
            checked={newCast.adult}
            onChange={(e) => setNewCast((c) => ({ ...c, adult: e.target.checked }))}
            className="mt-0.5"
          />
          {hasUploads
            ? "All made up and not real people. Every person is clearly an adult (over 25)."
            : "Made up, clearly an adult (over 25), and not a real person."}
        </label>
        {(hasUploads ? uploadsBlocked : newCastBlocked) && (
          <p className="text-[11px] text-red-300">{hasUploads ? uploadsBlocked : newCastBlocked}</p>
        )}
        {castUploadBusy && <p className="text-[11px] text-sky-300">{castUploadBusy}</p>}
        {message["add-cast"] && !castUploadBusy && <p className="text-[11px] text-red-300">{message["add-cast"]}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void addCharacters()}
            disabled={!canAddCast}
            className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {hasUploads ? `Add ${castUploads.length} character${castUploads.length === 1 ? "" : "s"}` : "Add"}
          </button>
          <button
            type="button"
            onClick={closeAddCast}
            disabled={Boolean(castUploadBusy)}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/70 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    ) : simple ? null : (
      <button
        type="button"
        onClick={() => openAddCast(group)}
        disabled={Boolean(castUploadBusy)}
        className="mb-2 rounded-md border border-white/20 px-2.5 py-1 text-[11px] text-white/80 disabled:opacity-40"
      >
        + Add a character
      </button>
    );

  // Big view: resolve against the live entry so a removal shows at once.
  const viewerEntry = viewer && "entryId" in viewer ? findEntry(viewer.entryId) : null;
  const viewerUrls = viewer ? ("url" in viewer ? [viewer.url] : viewerEntry?.trainingImageUrls ?? []) : [];
  const viewerIndex = viewer && "index" in viewer ? Math.min(viewer.index, viewerUrls.length - 1) : 0;
  const viewerUrl = viewerUrls[viewerIndex] ?? null;
  const viewerCanRemove = Boolean(
    viewerEntry && ((viewerEntry.awaitingReview && viewerEntry.status === "draft") || (simple && viewerEntry.status === "ready")),
  );
  const flip = (step: number) =>
    setViewer((v) => (v && "entryId" in v && viewerUrls.length > 0 ? { ...v, index: (viewerIndex + step + viewerUrls.length) % viewerUrls.length } : v));

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      else if (e.key === "ArrowRight") flip(1);
      else if (e.key === "ArrowLeft") flip(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (viewer && !viewerUrl) setViewer(null);
  }, [viewer, viewerUrl]);

  const renderViewer = () =>
    viewer && viewerUrl && typeof document !== "undefined" ? createPortal(
      <div
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
        onClick={() => setViewer(null)}
        role="dialog"
        aria-modal="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={viewerUrl}
          alt=""
          className="max-h-[80vh] max-w-full rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {viewerUrls.length > 1 && (
            <button type="button" onClick={() => flip(-1)} className="rounded-md border border-white/20 px-3 py-1.5 text-sm text-white">
              ‹
            </button>
          )}
          {viewerUrls.length > 1 && (
            <span className="text-xs text-white/60">
              {viewerIndex + 1} of {viewerUrls.length}
            </span>
          )}
          {viewerUrls.length > 1 && (
            <button type="button" onClick={() => flip(1)} className="rounded-md border border-white/20 px-3 py-1.5 text-sm text-white">
              ›
            </button>
          )}
          {viewerCanRemove && viewerEntry && (
            <button
              type="button"
              onClick={() => removeReviewPicture(findEntry(viewerEntry.id) ?? viewerEntry, viewerUrl)}
              className="rounded-md border border-red-400/40 px-3 py-1.5 text-xs text-red-300"
            >
              ✕ Remove
            </button>
          )}
          <button type="button" onClick={() => setViewer(null)} className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/80">
            Close
          </button>
        </div>
      </div>,
      document.body,
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {renderViewer()}
      {ROSTER_GROUPS.filter((g) => !onlyGroup || g.id === onlyGroup).map((g) => {
        const list = g.id === "music-video" ? onlyBandCharacters(roster[g.id], bandMemberIds) : roster[g.id];
        const done = list.filter((c) => entryForRosterCharacter(characters, c.sourceKey)?.status === "ready").length;
        const plan = groupPlan(list);
        // Every genre's Cast row (simple mode) is one sideways-scrolling
        // line of 176px faces with the + last (2026-10-01, Stuart), like
        // LOCATIONS. The full roster screen keeps its grid.
        const asRow = simple;
        return (
          <div key={g.id}>
            <div className={simple ? "hidden" : "mb-2 flex items-center justify-between gap-2"}>
              {onlyGroup ? <span /> : <p className="text-xs font-semibold uppercase tracking-wide text-white/60">{g.label}</p>}
              {list.length > 0 && (
                <div className="flex items-center gap-2">
                  {!onlyGroup && (
                    <p className="text-[11px] text-white/35">
                      {done} of {list.length} trained
                    </p>
                  )}
                  {!simple && plan.ready.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (armedGroup !== g.id) return setArmedGroup(g.id);
                        setArmedGroup(null);
                        for (const c of plan.ready) startOneTap(c);
                      }}
                      onBlur={() => setArmedGroup(null)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium text-white ${
                        armedGroup === g.id ? "bg-sky-500" : "bg-sky-500/50 hover:bg-sky-500/70"
                      }`}
                    >
                      {armedGroup === g.id
                        ? `Tap again: ${plan.ready.length} for ~${formatCostUsd(plan.totalUsd)}`
                        : "Make everyone's pictures"}
                    </button>
                  )}
                </div>
              )}
            </div>
            {!simple && armedGroup === g.id && (
              <p className="mb-2 text-[11px] leading-relaxed text-white/50">
                Makes pictures for {plan.ready.map((c) => c.name).join(", ")}, two at a time. Each one then waits for you to
                check the pictures and tap Train (that total includes training). Tapping again confirms they&apos;re all made up,
                clearly adults, and not real people.
                {plan.needFace > 0 && ` ${plan.needFace} ${plan.needFace === 1 ? "is" : "are"} skipped until you make and okay their clean picture.`}
              </p>
            )}
            {!simple && (g.id !== "adult-shorts" || adultConfirmed) && renderAddCharacter(g.id)}
            {list.length === 0 && !(simple && (g.id !== "adult-shorts" || adultConfirmed)) ? (
              <p className="text-[11px] text-white/35">
                {g.id === "adult-shorts" && adultConfirmed ? "No characters yet. Tap + Add a character." : EMPTY_GROUP_TEXT[g.id]}
              </p>
            ) : (
              <>
              <div
                className={
                  asRow ? CAST_ROW_CLASS : "grid grid-cols-4 gap-2 sm:grid-cols-6"
                }
              >
                {list.map((c) => {
                  const entry = entryForRosterCharacter(characters, c.sourceKey);
                  const face = entry?.referenceUrl ?? c.thumbUrl;
                  const isSel = selectedKey === c.sourceKey;
                  if (simple) {
                    // Every face opens (name, rename, bin, ✕); a ticked one also shows its pictures.
                    const trained = entry?.status === "ready";
                    const toggle = () => (isSel ? closeSelected() : openCharacter(c.sourceKey));
                    return (
                      <div
                        key={c.sourceKey}
                        className={`flex flex-col items-center gap-1 rounded-lg p-1 ${CAST_ROW_TILE_CLASS} ${isSel ? "bg-emerald-500/10" : ""}`}
                      >
                        <span
                          className={`relative block aspect-square w-full overflow-hidden rounded-lg bg-white/5 ${
                            c.blockedReason ? "opacity-40" : ""
                          } ${entry?.status === "ready" ? "ring-2 ring-emerald-400/70" : ""}`}
                        >
                          <button
                            type="button"
                            onClick={toggle}
                            className="block h-full w-full"
                            aria-label={trained ? `Show ${c.name}'s pictures` : `Open ${c.name}`}
                          >
                            {face ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={face} alt="" className="h-full w-full object-cover object-top" />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center text-sm text-white/40">{initials(c.name)}</span>
                            )}
                          </button>
                          <CornerButton char={c} entry={entry} onStart={() => startAuto(c)} onOpen={toggle} />
                        </span>
                        <span className="w-full truncate text-center text-[11px] text-white/75">{c.name}</span>
                        {c.notReadyReason && (
                          <span className="-mt-1 w-full truncate text-center text-[9px] text-white/40" title={c.notReadyReason}>
                            not ready
                          </span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={c.sourceKey}
                      type="button"
                      onClick={() => (isSel ? closeSelected() : openCharacter(c.sourceKey))}
                      className={`flex min-w-0 flex-col items-center gap-1 rounded-lg p-1 text-left ${isSel ? "bg-sky-500/15" : ""}`}
                    >
                      <span
                        className={`relative block aspect-square w-full overflow-hidden rounded-lg bg-white/5 ${
                          c.blockedReason ? "opacity-40" : ""
                        } ${entry?.status === "ready" ? "ring-2 ring-emerald-400/70" : ""}`}
                      >
                        {face ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={face} alt="" className="h-full w-full object-cover object-top" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-sm text-white/40">{initials(c.name)}</span>
                        )}
                        <Badge char={c} entry={entry} />
                      </span>
                      <span className="w-full truncate text-center text-[11px] text-white/75">{c.name}</span>
                    </button>
                  );
                })}
                {/* Simple mode: a dotted "+" tile after the faces adds another person
                    (Stuart, 2026-09-29: just the faces and a + tile, nothing else). */}
                {simple && (g.id !== "adult-shorts" || adultConfirmed) && (
                  <div className={`flex flex-col items-center gap-1 p-1 ${CAST_ROW_TILE_CLASS}`}>
                    <button
                      type="button"
                      onClick={() => (newCast.openGroup === g.id ? closeAddCast() : openAddCast(g.id))}
                      disabled={Boolean(castUploadBusy)}
                      aria-label="Add a character"
                      className={`flex aspect-square w-full touch-manipulation items-center justify-center rounded-lg border-2 border-dashed text-3xl font-light disabled:opacity-40 ${
                        newCast.openGroup === g.id ? "border-sky-400/70 text-sky-300" : "border-white/25 text-white/50 hover:border-white/40"
                      }`}
                    >
                      +
                    </button>
                    <span aria-hidden className="text-[11px]">&nbsp;</span>
                  </div>
                )}
                {!asRow && simple && newCast.openGroup === g.id && <div className="col-span-full">{renderAddCharacter(g.id)}</div>}
                {!asRow && selected && selected.group === g.id && (simple ? renderSimpleSelected(selected) : renderSelected(selected))}
                {!simple && selected && selected.group === g.id && renderEntryCard && selectedEntry && (
                  <div className="col-span-full">{renderEntryCard(selectedEntry)}</div>
                )}
              </div>
              {/* In the sideways row, the add form and an opened face sit
                  under the row instead of inside it. */}
              {asRow && (newCast.openGroup === g.id || (selected && selected.group === g.id)) && (
                <div className="mt-2 flex flex-col gap-2">
                  {newCast.openGroup === g.id && renderAddCharacter(g.id)}
                  {selected && selected.group === g.id && renderSimpleSelected(selected)}
                </div>
              )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
