"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { videoBackendTagLabel } from "@/lib/videoBackendRouting";
import {
  ADULT_SHORTS_MAX_SHOT_SEC,
  ADULT_SHORTS_MAX_SHOTS,
  ADULT_SHORTS_MIN_SHOT_SEC,
  ADULT_SHORTS_STILL_COST_USD,
  ADULT_SHORTS_LINE_MAX,
  adultShortSpeaker,
  buildAdultShortsMotionPrompt,
  buildAdultShortsShot,
  buildAdultShortsTalkingPrompt,
  formatAdultShortsTalkingCost,
  isAdultShortTalkingShot,
  adultShortEpisodeCode,
  adultShortEpisodeNumbers,
  adultShortIsAdult,
  adultShortShotPeople,
  sameAdultShortPerson,
  setAdultShortStarring,
  ADULT_SHORTS_MAX_STARRING,
  buildAdultShortsStillPrompt,
  clampAdultShortsDuration,
  estimateAdultShortsClipCostUsd,
  formatUsd,
  editorHasUnsavedChanges,
  resolveAdultShortsStartImage,
  saveAdultShortToLibrary,
  startNewAdultShort,
  suggestAdultShortTitle,
  type AdultShortsShot,
} from "@/lib/adultShorts";
import { buildForceDownloadUrl } from "@/lib/clipRenders";
import type { DeckMediaTarget } from "@/lib/deckMediaPaths";
import { adultShortTargetFor } from "@/lib/deckMediaTargets";
import { uploadSkidmarksMemberPhoto } from "@/lib/memberPhotoBlob";
import { resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import {
  flushSkidmarksSessionNow,
  getAdultShortsState,
  getSkidmarksSnapshot,
  patchAdultShorts,
  subscribeSkidmarks,
} from "@/lib/skidmarks";
import {
  resolveShortsStarring,
  shortsCastList,
  shortsEpisodeStarringList,
  shortsCastPictures,
  shortsCharacterFromCast,
  shortsPlateReferences,
  shortsShotCast,
  shortsShotPeople,
} from "@/lib/shortsCast";
import { ShotGrid, type ShotTileView } from "./ShotGrid";
import { EpisodeExtrasRow } from "./EpisodeExtrasRow";
import { setShortsBusy } from "@/lib/shortsBusy";
import { runSunnyBanksRenderQueue } from "@/lib/sunnyBanksRenderQueue";
import { preSendChecks } from "@/lib/preSendChecks";
import { SHORTS_EDITOR_ID } from "./ShortsEpisodeRow";
import { deckBuildHeaders } from "@/lib/deckBuild";

/**
 * Adult shorts (2026-09-28) — the screen behind the fourth landing tile.
 * An 18+ confirm, one character from the Shorts Cast row ("Starring",
 * her name, look and up to three pictures), then a short shot list: each shot makes a Siray
 * spicy plate from one reference, then renders a Siray Wan spicy clip
 * from that plate (or from the previous clip's last frame when chained).
 * Every paid action is a deliberate tap with its price on the button;
 * Render is two taps. Nothing here runs on its own.
 *
 * Since 2026-09-30 this is the open episode from the Shorts EPISODES row
 * (`ShortsEpisodeRow`): every change is saved onto that card as it
 * happens. "Render N clips" runs the unfinished shots one after another,
 * with the same Stop as Sunnybank (the shot already rendering finishes,
 * later shots are never billed).
 *
 * Talking shots (2026-09-30): a shot with a Line is voiced with the
 * speaker's Cast card ElevenLabs voice and lip-synced on LTX from its
 * plate (`/api/skidmarks/adult-shorts/render-talking`, the same pipeline
 * as Sunnybank's talking lines). A shot with no Line stays a silent Siray
 * clip, exactly as before.
 *
 * The old "Character" box (name, look, three pictures, 2026-09-28) was
 * removed on 2026-09-30: the Cast row above does that job. The episode's
 * own copy of her stays saved as it was; plates and clips read her
 * through her Cast card (`lib/shortsCast.ts`).
 */

/** ~40s per server poll, so this is roughly 12 minutes of waiting. */
const MAX_PENDING_POLLS = 18;
/** A dropped connection (Safari/Chrome "Failed to fetch") is retried this many times in a row. */
const MAX_NETWORK_RETRIES = 3;

function isNetworkDrop(err: unknown): boolean {
  return err instanceof TypeError;
}

function friendlyError(err: unknown, fallback: string): string {
  if (isNetworkDrop(err)) return "The connection dropped while Siray was working. Tap again to retry.";
  return err instanceof Error ? err.message : fallback;
}

type Busy = { shotId: string; kind: "plate" | "clip" } | null;

async function persistImageUrl(dataOrHttps: string, target?: DeckMediaTarget | null): Promise<string> {
  if (!dataOrHttps.startsWith("data:")) return dataOrHttps;
  const up = await uploadSkidmarksMemberPhoto(dataOrHttps, target);
  // No Blob store (local dev) — keep the downscaled data URL so the flow still works.
  return up.ok ? up.url : dataOrHttps;
}

export function AdultShortsPanel() {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const state = getAdultShortsState(snapshot);
  const { shots } = state;
  // Everyone starring, each read through their own Cast card (main face first).
  const starringPeople = resolveShortsStarring(snapshot);
  // Only the open episode's own Cast can star (2026-10-04, each Shorts
  // episode has its own Cast); EP01 and EP02 read exactly as before.
  const starringList = shortsEpisodeStarringList(snapshot);
  const cast = shortsCastList(snapshot);
  const isAdult = adultShortIsAdult(state);
  const [openShotId, setOpenShotId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [armedRenderId, setArmedRenderId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingTitle, setSavingTitle] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  /** "Render N clips": armed after the first tap, running while the queue goes. */
  const [queueArmed, setQueueArmed] = useState(false);
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueNote, setQueueNote] = useState<string | null>(null);
  const stopRequestedRef = useRef(false);
  const [stopRequested, setStopRequested] = useState(false);
  // The EPISODES row can't switch episodes while anything here is going.
  useEffect(() => {
    setShortsBusy(Boolean(busy) || queueRunning, "panel");
  }, [busy, queueRunning]);
  useEffect(() => () => setShortsBusy(false, "panel"), []);
  const currentSaved = state.currentSavedId ? state.saved.find((x) => x.id === state.currentSavedId) ?? null : null;
  const unsaved = editorHasUnsavedChanges(state);

  const confirmSave = () => {
    const title = (savingTitle ?? "").trim();
    patchAdultShorts((s) => saveAdultShortToLibrary(s, new Date(), title));
    flushSkidmarksSessionNow();
    setSavingTitle(null);
    setSavedNote("Saved to Library, under the 18+ tab.");
  };

  const newShort = (keepCharacter: boolean) => {
    patchAdultShorts((s) => startNewAdultShort(s, keepCharacter));
    flushSkidmarksSessionNow();
    setConfirmNew(false);
    setSavedNote(null);
    setErrors({});
    setArmedRenderId(null);
  };

  const setShotError = (id: string, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });

  const patchShot = (id: string, patch: Partial<AdultShortsShot>) =>
    patchAdultShorts((s) => ({ ...s, shots: s.shots.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  if (!state.ageConfirmed) {
    return (
      <section className="rounded-2xl border border-red-400/30 bg-red-500/[0.04] p-5">
        <p className="text-sm font-semibold text-white">Shorts are 18+ only</p>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          Everything made here must show a made-up, AI-created adult who is clearly over 25 and isn&apos;t based on a real
          person&apos;s face or photo. Spicy and nudity are fine, but no sex acts. Every prompt gets those rules added
          automatically.
        </p>
        <button
          type="button"
          onClick={() => {
            patchAdultShorts((s) => ({ ...s, ageConfirmed: true }));
            flushSkidmarksSessionNow();
          }}
          className="mt-4 rounded-md bg-red-500/80 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          I&apos;m 18+, continue
        </button>
      </section>
    );
  }

  /** "Starring" (2026-09-30): anyone from the Cast row, more than one allowed. A tap adds or removes them. */
  const toggleStarring = (key: string) => {
    const c = cast.find((x) => x.sourceKey === key);
    if (!c || c.blockedReason) return;
    patchAdultShorts((st) => {
      const now = shortsEpisodeStarringList({ ...getSkidmarksSnapshot(), adultShorts: st });
      const on = now.some((p) => sameAdultShortPerson(p.name, c.name));
      const next = on ? now.filter((p) => !sameAdultShortPerson(p.name, c.name)) : [...now, shortsCharacterFromCast(c)];
      return setAdultShortStarring(st, next);
    });
    flushSkidmarksSessionNow();
  };

  /** "In this shot": who's in one shot, from the people starring. All of them = no picks saved. */
  const toggleShotPerson = (shot: AdultShortsShot, name: string) => {
    const inShot = adultShortShotPeople(starringList, shot).map((p) => p.name);
    const on = inShot.some((n) => sameAdultShortPerson(n, name));
    const next = on ? inShot.filter((n) => !sameAdultShortPerson(n, name)) : [...inShot, name];
    if (next.length === 0) return; // Someone has to be in the shot; untick everyone else instead.
    const all = starringList.every((p) => next.some((n) => sameAdultShortPerson(n, p.name)));
    patchAdultShorts((st) => ({
      ...st,
      shots: st.shots.map((x) => {
        if (x.id !== shot.id) return x;
        const rest = { ...x };
        delete rest.castNames;
        return all ? rest : { ...rest, castNames: next };
      }),
    }));
  };

  const makePlate = async (shot: AdultShortsShot) => {
    if (busy) return;
    const people = shortsShotPeople(starringPeople, shot);
    // One picture of each person in the shot, in the order the prompt names them.
    const refs = shortsPlateReferences(people);
    // The shared helper's answer (2026-10-03): anyone without a picture stops it here.
    const missing = shortsShotCast(starringPeople, shot).missingPicture;
    if (missing.length) {
      setShotError(shot.id, `Add pictures of ${missing.join(" and ")} on their Cast card first.`);
      return;
    }
    if (!shot.prompt.trim()) {
      setShotError(shot.id, "Write what this shot shows first.");
      return;
    }
    setShotError(shot.id, null);
    setBusy({ shotId: shot.id, kind: "plate" });
    try {
      const refData = await Promise.all(refs.map((ref) => resolvePlateReferenceDataUrl(ref)));
      const plateTarget = adultShortTargetFor("plate", shots.findIndex((x) => x.id === shot.id) + 1);
      const res = await fetch("/api/skidmarks/generate-still-siray", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...deckBuildHeaders() },
        body: JSON.stringify({
          prompt: buildAdultShortsStillPrompt(people, shot, { adult: isAdult }),
          referenceImageDataUrls: refData,
          mediaTarget: plateTarget,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { dataUrl?: string; url?: string; error?: string };
      if (!res.ok || !(json.url || json.dataUrl)) throw new Error(json.error || `Siray still failed (HTTP ${res.status}).`);
      const plateUrl = await persistImageUrl(json.url || json.dataUrl!, plateTarget);
      patchShot(shot.id, { plateUrl });
      flushSkidmarksSessionNow();
    } catch (err) {
      setShotError(shot.id, friendlyError(err, "Siray still failed."));
    } finally {
      setBusy(null);
    }
  };

  /** Renders one shot's clip. `true` once it's saved; `false` if it failed or is still waiting on Siray. */
  const renderClip = async (shotId: string, fromQueue = false): Promise<boolean> => {
    if (busy && !fromQueue) return false;
    setArmedRenderId(null);
    // Read the editor fresh: in "Render N clips" the previous shot's last
    // frame (for a chained shot) was only just saved.
    const now = getAdultShortsState();
    const index = now.shots.findIndex((x) => x.id === shotId);
    const shot = now.shots[index];
    if (!shot) return false;
    const people = shortsShotPeople(resolveShortsStarring(getSkidmarksSnapshot()), shot);
    const adultNow = adultShortIsAdult(now);
    const startImageUrl = resolveAdultShortsStartImage(now.shots, index);
    // A shot with a Line talks: voiced, then LTX (a Siray job still waiting finishes first).
    if (isAdultShortTalkingShot(shot) && !shot.sirayTaskId) return renderTalking(shot, index, people, adultNow, startImageUrl);
    if (!startImageUrl && !shot.sirayTaskId) {
      setShotError(
        shot.id,
        shot.chainFromPrevious ? "Render the previous clip first, or make this shot's plate." : "Make the plate first."
      );
      return false;
    }
    setShotError(shot.id, null);
    setBusy({ shotId: shot.id, kind: "clip" });
    let taskId = shot.sirayTaskId;
    let networkRetries = 0;
    // Same name on every poll: the server saves the clip on the last one.
    const clipTarget = adultShortTargetFor("clip", index + 1);
    try {
      for (let attempt = 0; attempt <= MAX_PENDING_POLLS; ) {
        let res: Response;
        try {
          res = await fetch("/api/skidmarks/adult-shorts/render-clip", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...deckBuildHeaders() },
            body: JSON.stringify({
              prompt: buildAdultShortsMotionPrompt(people, shot, { adult: adultNow }),
              startImageUrl,
              durationSec: shot.durationSec,
              ...(taskId ? { sirayTaskId: taskId } : {}),
              mediaTarget: clipTarget,
            }),
          });
        } catch (err) {
          // Only retry automatically once we hold a task id — retrying a
          // submit whose answer we never saw could start a second paid job.
          if (isNetworkDrop(err) && taskId && networkRetries < MAX_NETWORK_RETRIES) {
            networkRetries += 1;
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          throw err;
        }
        networkRetries = 0;
        attempt += 1;
        const json = (await res.json().catch(() => ({}))) as {
          pending?: boolean;
          sirayTaskId?: string;
          videoUrl?: string;
          lastFrameUrl?: string | null;
          error?: string;
        };
        if (res.status === 202 && json.sirayTaskId) {
          taskId = json.sirayTaskId;
          patchShot(shot.id, { sirayTaskId: taskId });
          flushSkidmarksSessionNow();
          continue;
        }
        if (!res.ok || !json.videoUrl) {
          // A failed job is finished — drop its id so the next tap starts fresh.
          if (taskId) patchShot(shot.id, { sirayTaskId: null });
          throw new Error(json.error || `Siray clip failed (HTTP ${res.status}).`);
        }
        patchShot(shot.id, { clipUrl: json.videoUrl, lastFrameUrl: json.lastFrameUrl ?? null, sirayTaskId: null });
        flushSkidmarksSessionNow();
        return true;
      }
      setShotError(shot.id, "Siray is still rendering. Tap Keep waiting. It won't charge twice.");
      return false;
    } catch (err) {
      setShotError(
        shot.id,
        isNetworkDrop(err) && taskId
          ? "The connection dropped, but Siray has the job. Tap Keep waiting. It won't charge twice."
          : friendlyError(err, "Siray clip failed.")
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** A talking shot: the speaker's voice says the Line, then LTX lip-syncs the plate. One call, like Sunnybank's. */
  const renderTalking = async (
    shot: AdultShortsShot,
    index: number,
    people: ReturnType<typeof shortsShotPeople>,
    adultNow: boolean,
    startImageUrl: string | null,
  ): Promise<boolean> => {
    const speaker = adultShortSpeaker(people, shot);
    if (!speaker) {
      setShotError(shot.id, "Pick who's in this shot first.");
      return false;
    }
    if (!speaker.voiceId) {
      setShotError(shot.id, `${speaker.name} has no voice yet. Add their ElevenLabs voice ID on their Cast card.`);
      return false;
    }
    if (!startImageUrl) {
      setShotError(shot.id, shot.chainFromPrevious ? "Render the previous clip first, or make this shot's plate." : "Make the plate first.");
      return false;
    }
    setShotError(shot.id, null);
    setBusy({ shotId: shot.id, kind: "clip" });
    try {
      const res = await fetch("/api/skidmarks/adult-shorts/render-talking", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...deckBuildHeaders() },
        body: JSON.stringify({
          prompt: buildAdultShortsTalkingPrompt(people, shot, speaker.name, { adult: adultNow }),
          line: shot.line ?? "",
          speakerName: speaker.name,
          voiceId: speaker.voiceId,
          startImageUrl,
          mediaTarget: adultShortTargetFor("clip", index + 1),
          voiceTarget: adultShortTargetFor("voice", index + 1),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { videoUrl?: string; lastFrameUrl?: string | null; error?: string };
      if (!res.ok || !json.videoUrl) throw new Error(json.error || `The talking clip failed (HTTP ${res.status}).`);
      patchShot(shot.id, { clipUrl: json.videoUrl, lastFrameUrl: json.lastFrameUrl ?? null });
      flushSkidmarksSessionNow();
      return true;
    } catch (err) {
      setShotError(
        shot.id,
        isNetworkDrop(err) ? "The connection dropped while LTX was working. Tap Render to try again." : err instanceof Error ? err.message : "The talking clip failed."
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const unfinished = shots.filter((s) => !s.clipUrl);
  const unfinishedTalking = unfinished.filter((s) => isAdultShortTalkingShot(s));
  // Like Sunnybank's Render all: not while a talking shot's speaker has no voice.
  const voiceless = unfinishedTalking
    .map((s) => adultShortSpeaker(shortsShotPeople(starringPeople, s), s))
    .filter((p): p is NonNullable<typeof p> => Boolean(p && !p.voiceId))
    .map((p) => p.name)
    .filter((n, i, all) => all.indexOf(n) === i);
  const sirayQueueCost = formatUsd(
    unfinished.filter((s) => !isAdultShortTalkingShot(s)).reduce((sum, s) => sum + estimateAdultShortsClipCostUsd(s.durationSec), 0)
  );
  // Talking shots are as long as their Line: priced per second, the way Sunnybank shows it.
  const queueCost =
    unfinishedTalking.length === 0
      ? sirayQueueCost
      : unfinishedTalking.length === unfinished.length
        ? `talking ${formatAdultShortsTalkingCost()}`
        : `${sirayQueueCost} + talking ${formatAdultShortsTalkingCost()}`;
  const episodeNumber = state.currentSavedId ? adultShortEpisodeNumbers(state.saved).get(state.currentSavedId) : undefined;

  /** "Render N clips" (two taps): every unfinished shot, in order, with Stop. */
  const renderAll = async () => {
    if (busy || queueRunning) return;
    setQueueArmed(false);
    setQueueNote(null);
    stopRequestedRef.current = false;
    setStopRequested(false);
    setQueueRunning(true);
    try {
      const ids = getAdultShortsState().shots.map((x) => x.id);
      const run = await runSunnyBanksRenderQueue(ids, {
        skip: (id) => Boolean(getAdultShortsState().shots.find((x) => x.id === id)?.clipUrl),
        shouldStop: () => stopRequestedRef.current,
        render: (id) => renderClip(id, true),
      });
      if (run.outcome === "stopped") setQueueNote(`Stopped before shot ${run.index + 1}. Later shots were not billed.`);
      else if (run.outcome === "halted") setQueueNote(`Stopped at shot ${run.index + 1}. Later shots were not billed.`);
      else setQueueNote(run.rendered ? `Rendered ${run.rendered} clip${run.rendered === 1 ? "" : "s"}.` : null);
    } finally {
      stopRequestedRef.current = false;
      setStopRequested(false);
      setQueueRunning(false);
    }
  };

  /**
   * The free pre-send check's warnings for one shot (2026-10-04). The
   * speaker-not-in-shot block is the shot cards' own guard (PR #249), so it
   * isn't said twice here.
   */
  const shortsCastNames = shortsCastList(snapshot).map((c) => c.name);
  const shotPreSend = (shot: AdultShortsShot, inShotNames: string[]) =>
    preSendChecks({
      kind: isAdultShortTalkingShot(shot) ? "speak" : "hold",
      speakerName: shot.speakerName ?? inShotNames[0] ?? null,
      inShotNames,
      castNames: shortsCastNames,
      promptText: shot.prompt,
      line: shot.line,
      // A talking shot is as long as its Line; a silent one has its own length.
      durationSec: isAdultShortTalkingShot(shot) ? null : shot.durationSec,
    }).filter((issue) => issue.code !== "speaker_not_in_shot");

  /** One shot's editor, opened from its tile: every control the stacked rows had. */
  const renderShotPanel = (shot: AdultShortsShot, index: number) => {
    const isBusy = busy?.shotId === shot.id;
    const armed = armedRenderId === shot.id;
    const people = shortsShotPeople(starringPeople, shot);
    const talking = isAdultShortTalkingShot(shot);
    const speaker = talking ? adultShortSpeaker(people, shot) : null;
    const noVoice = Boolean(talking && speaker && !speaker.voiceId);
    const clipCost = talking ? formatAdultShortsTalkingCost() : formatUsd(estimateAdultShortsClipCostUsd(shot.durationSec));
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-end gap-2">
          <select
            value={shot.durationSec}
            onChange={(e) => patchShot(shot.id, { durationSec: clampAdultShortsDuration(Number(e.target.value)) })}
            aria-label={`Shot ${index + 1} length`}
            disabled={talking}
            title={talking ? "A talking shot is as long as its Line." : undefined}
            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            {Array.from({ length: ADULT_SHORTS_MAX_SHOT_SEC - ADULT_SHORTS_MIN_SHOT_SEC + 1 }, (_, i) => i + ADULT_SHORTS_MIN_SHOT_SEC).map(
              (sec) => (
                <option key={sec} value={sec}>
                  {sec}s
                </option>
              )
            )}
          </select>
          {shots.length > 1 && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                patchAdultShorts((s) => ({ ...s, shots: s.shots.filter((x) => x.id !== shot.id) }));
                setOpenShotId(null);
              }}
              aria-label={`Remove shot ${index + 1}`}
              className="rounded-md px-2 py-1 text-xs text-white/40 hover:text-white/80"
            >
              Remove
            </button>
          )}
        </div>

        <textarea
          value={shot.prompt}
          onChange={(e) => patchShot(shot.id, { prompt: e.target.value })}
          rows={3}
          placeholder="What happens in this shot, e.g. lounging on a velvet couch in a band room, laughing, glitter falling, slow push-in"
          aria-label={`Shot ${index + 1} prompt`}
          className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-base text-white placeholder:text-white/30 sm:text-sm"
        />

        {/* The Line (2026-09-30): something said = a talking shot on LTX; empty = silent on Siray. */}
        <textarea
          value={shot.line ?? ""}
          onChange={(e) => {
            const line = e.target.value.slice(0, ADULT_SHORTS_LINE_MAX);
            patchAdultShorts((st) => ({
              ...st,
              shots: st.shots.map((x) => {
                if (x.id !== shot.id) return x;
                const rest = { ...x };
                delete rest.line;
                return line ? { ...rest, line } : rest;
              }),
            }));
          }}
          rows={2}
          maxLength={ADULT_SHORTS_LINE_MAX}
          placeholder="Line (optional), e.g. [whispers] You came back. Leave empty for a silent clip."
          aria-label={`Shot ${index + 1} line`}
          className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-base text-white placeholder:text-white/30 sm:text-sm"
        />

        {/* Who's in this shot: everyone starring unless some are unticked. */}
        {starringList.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/60">
            <span className="mr-0.5">In this shot</span>
            {starringList.map((p) => {
              const on = people.some((x) => sameAdultShortPerson(x.name, p.name));
              return (
                <button
                  key={p.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleShotPerson(shot, p.name)}
                  className={[
                    "min-h-[28px] rounded-full border px-2.5 py-0.5",
                    on ? "border-sky-400/70 bg-sky-500/15 text-white" : "border-white/15 text-white/50",
                  ].join(" ")}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Who says the Line, when more than one person is in the shot (default: the first). */}
        {talking && people.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/60">
            <span className="mr-0.5">Speaker</span>
            {people.map((p) => {
              const on = Boolean(speaker && sameAdultShortPerson(speaker.name, p.name));
              return (
                <button
                  key={p.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    patchAdultShorts((st) => ({
                      ...st,
                      shots: st.shots.map((x) => {
                        if (x.id !== shot.id) return x;
                        const rest = { ...x };
                        delete rest.speakerName;
                        return sameAdultShortPerson(p.name, people[0].name) ? rest : { ...rest, speakerName: p.name };
                      }),
                    }))
                  }
                  className={[
                    "min-h-[28px] rounded-full border px-2.5 py-0.5",
                    on ? "border-amber-300/70 bg-amber-400/15 text-white" : "border-white/15 text-white/50",
                  ].join(" ")}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
        {noVoice && speaker && (
          <p className="text-xs text-red-300">{speaker.name} has no voice yet. Add their ElevenLabs voice ID on their Cast card.</p>
        )}
        {/* The free pre-send check (2026-10-04): the same rules as every show (`lib/preSendChecks.ts`). */}
        {!shot.clipUrl &&
          shotPreSend(shot, people.map((p) => p.name)).map((issue) => (
            <p key={issue.code + issue.message} role="status" className="text-xs text-amber-200/80">
              Check: {issue.message}
            </p>
          ))}

        {index > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={shot.chainFromPrevious}
                onChange={(e) => patchShot(shot.id, { chainFromPrevious: e.target.checked })}
              />
              Start from shot {index}&apos;s last frame
            </label>
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex w-32 shrink-0 flex-col gap-1.5">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/40 text-[11px] text-white/30">
              {shot.plateUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shot.plateUrl} alt={`Shot ${index + 1} plate`} className="h-full w-full object-cover" />
              ) : (
                "No plate"
              )}
            </div>
            <button
              type="button"
              disabled={Boolean(busy) || queueRunning}
              onClick={() => void makePlate(shot)}
              className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/80 hover:bg-white/[0.06] disabled:opacity-40"
            >
              {isBusy && busy?.kind === "plate"
                ? "Making…"
                : `${shot.plateUrl ? "Remake" : "Make"} plate ${formatUsd(ADULT_SHORTS_STILL_COST_USD)}`}
            </button>
          </div>
          <div className="flex min-w-0 max-w-md flex-1 flex-col gap-1.5">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/40 text-[11px] text-white/30">
              {shot.clipUrl ? (
                <video src={shot.clipUrl} controls playsInline preload="metadata" className="h-full w-full object-cover" />
              ) : (
                "No clip"
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={Boolean(busy) || queueRunning || (noVoice && !shot.sirayTaskId)}
                onClick={() => (armed || shot.sirayTaskId ? void renderClip(shot.id) : setArmedRenderId(shot.id))}
                className={[
                  "flex-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40",
                  armed ? "bg-red-500 text-white" : "bg-red-500/70 text-white hover:bg-red-500/90",
                ].join(" ")}
              >
                {isBusy && busy?.kind === "clip"
                  ? "Rendering…"
                  : shot.sirayTaskId
                    ? "Keep waiting"
                    : armed
                      ? `Tap again: ${clipCost}`
                      : `${shot.clipUrl ? "Re-render" : "Render"} ${clipCost}`}
              </button>
              {shot.clipUrl && shot.clipUrl.startsWith("https:") && (
                <a
                  href={buildForceDownloadUrl(shot.clipUrl)}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70 hover:text-white"
                >
                  Download
                </a>
              )}
            </div>
          </div>
        </div>
        {errors[shot.id] && <p className="text-xs text-red-300">{errors[shot.id]}</p>}
      </div>
    );
  };

  return (
    <div id={SHORTS_EDITOR_ID} className="flex scroll-mt-4 flex-col gap-6">
      <section className="flex flex-col gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">
          Shots{episodeNumber ? ` · ${adultShortEpisodeCode(episodeNumber)}` : ""}
        </p>

        {/* This episode's own 18+ switch (2026-09-30): off for new shorts. */}
        <label className="flex items-center gap-2 self-start text-xs text-white/70">
          <input
            type="checkbox"
            checked={isAdult}
            disabled={Boolean(busy) || queueRunning}
            onChange={(e) => {
              const adult = e.target.checked;
              patchAdultShorts((s) => ({ ...s, adult }));
              flushSkidmarksSessionNow();
            }}
          />
          <span>
            18+ episode
            <span className="ml-1 text-white/40">{isAdult ? "· spicy allowed, no sex acts" : "· fully clothed, nothing sexual"}</span>
          </span>
        </label>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-white/60">
          <span className="mr-0.5 shrink-0">Starring</span>
          {cast.length === 0 && <span className="text-white/40">Add people in the Cast row above.</span>}
          {cast.map((c) => {
            const on = starringList.some((p) => sameAdultShortPerson(p.name, c.name));
            const face = shortsCastPictures(c)[0];
            const full = !on && starringList.length >= ADULT_SHORTS_MAX_STARRING;
            return (
              <button
                key={c.sourceKey}
                type="button"
                aria-pressed={on}
                disabled={Boolean(c.blockedReason) || full || Boolean(busy) || queueRunning}
                onClick={() => toggleStarring(c.sourceKey)}
                title={c.blockedReason ?? (on ? `Take ${c.name} out of this episode` : `Put ${c.name} in this episode`)}
                className={[
                  "flex min-h-[32px] items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 disabled:opacity-40",
                  on ? "border-sky-400/70 bg-sky-500/15 text-white" : "border-white/15 text-white/60 hover:border-white/30",
                ].join(" ")}
              >
                {face ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={face} alt="" className="h-6 w-6 rounded-full object-cover object-top" />
                ) : (
                  <span className="h-6 w-6 rounded-full bg-white/10" />
                )}
                {c.name}
              </button>
            );
          })}
        </div>
        {starringPeople.some((p) => p.referenceUrls.length === 0) && (
          <p className="text-xs text-white/40">
            {starringPeople
              .filter((p) => p.referenceUrls.length === 0)
              .map((p) => p.name)
              .join(" and ")}{" "}
            {starringPeople.filter((p) => p.referenceUrls.length === 0).length === 1 ? "has" : "have"} no pictures yet. Add them on
            their card in the Cast row above.
          </p>
        )}

        {/* Render every unfinished shot in order, with Stop (the same
            controls as Sunnybank's Render all, 2026-09-30). At the top,
            above the grid. */}
        {(unfinished.length > 1 || queueRunning) && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={Boolean(busy) || queueRunning || voiceless.length > 0}
              title={voiceless.length ? `${voiceless.join(" and ")} ${voiceless.length === 1 ? "has" : "have"} no voice yet.` : undefined}
              onClick={() => (queueArmed ? void renderAll() : setQueueArmed(true))}
              onBlur={() => setQueueArmed(false)}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40",
                queueArmed ? "bg-red-500" : "bg-red-500/70 hover:bg-red-500/90",
              ].join(" ")}
            >
              {queueRunning
                ? "Rendering…"
                : queueArmed
                  ? `Tap again: ${queueCost}`
                  : `Render all ${unfinished.length} clips ${queueCost}`}
            </button>
            {queueRunning && (
              <button
                type="button"
                onClick={() => {
                  stopRequestedRef.current = true;
                  setStopRequested(true);
                }}
                disabled={stopRequested}
                aria-label={stopRequested ? "Stopping after this shot" : "Stop after this shot"}
                title="Stop after this shot"
                className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/85 hover:border-white/40 disabled:opacity-50"
              >
                {stopRequested ? "Stopping…" : "Stop"}
              </button>
            )}
          </div>
        )}
        {/* Next to Render all: which shots the free pre-send check flagged (2026-10-04). */}
        {(() => {
          const flagged = shots
            .map((shot, index) => ({ index, n: shot.clipUrl ? 0 : shotPreSend(shot, shortsShotPeople(starringPeople, shot).map((p) => p.name)).length }))
            .filter((x) => x.n > 0);
          return flagged.length > 0 ? (
            <p role="status" className="text-xs text-amber-200/80">
              Check before rendering: shot{flagged.length === 1 ? "" : "s"} {flagged.map((x) => x.index + 1).join(", ")} (open the shot to see why).
            </p>
          ) : null;
        })()}

        <ShotGrid
          tiles={shots.map((shot, index): ShotTileView => {
            const isBusy = busy?.shotId === shot.id;
            const rendering = (isBusy && busy?.kind === "clip") || Boolean(shot.sirayTaskId);
            const tileCast = shortsShotCast(starringPeople, shot);
            return {
              id: shot.id,
              number: index + 1,
              pictureUrl: shot.plateUrl,
              clipUrl: shot.clipUrl,
              status: rendering ? "rendering" : shot.clipUrl ? "rendered" : errors[shot.id] ? "failed" : "empty",
              ...(isBusy && busy?.kind === "plate" ? { statusText: "Making plate…" } : {}),
              caption: shot.prompt.trim() || shot.line?.trim() || undefined,
              // A shot with a Line talks on LTX; every other Shorts clip is Siray Wan 3.0 spicy.
              engine: isAdultShortTalkingShot(shot)
                ? { label: videoBackendTagLabel("ltx"), title: "Talking, on LTX" }
                : { label: videoBackendTagLabel("siray"), title: "Video on Siray" },
              ...(tileCast.isMulti ? { cast: { names: tileCast.names, missing: tileCast.missingPicture } } : {}),
            };
          })}
          openId={openShotId && shots.some((x) => x.id === openShotId) ? openShotId : null}
          onToggle={setOpenShotId}
          onAdd={
            shots.length < ADULT_SHORTS_MAX_SHOTS
              ? () => {
                  const added = buildAdultShortsShot();
                  patchAdultShorts((s) => ({ ...s, shots: [...s.shots, added] }));
                  setOpenShotId(added.id);
                }
              : undefined
          }
          layout="split"
          emptyPanelHint="Tap a shot to edit it here."
          renderPanel={(id) => {
            const index = shots.findIndex((x) => x.id === id);
            const shot = shots[index];
            if (!shot) return null;
            return renderShotPanel(shot, index);
          }}
        />
        {queueNote && <p className="text-xs text-white/60">{queueNote}</p>}
      </section>

      {/* Extras (2026-10-04): the same row in every genre, below the shots. */}
      <EpisodeExtrasRow genre="shorts" />

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4" aria-label="Save or start new">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/50">
            {currentSaved
              ? unsaved
                ? `Editing “${currentSaved.title}”, with changes not saved yet.`
                : `Saved in Library as “${currentSaved.title}”.`
              : "Not in the Library yet."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setSavedNote(null);
                setConfirmNew(false);
                setSavingTitle(currentSaved?.title ?? suggestAdultShortTitle(state, new Date()));
              }}
              className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-white disabled:opacity-40"
            >
              {currentSaved ? "Save changes" : "Save to Library"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setSavingTitle(null);
                setSavedNote(null);
                setConfirmNew(true);
              }}
              className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:text-white disabled:opacity-40"
            >
              New short
            </button>
          </div>
        </div>

        {savingTitle !== null && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={savingTitle}
              onChange={(e) => setSavingTitle(e.target.value)}
              placeholder="Title"
              aria-label="Short title"
              maxLength={80}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
            <button type="button" onClick={confirmSave} className="rounded-md bg-emerald-500/80 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500">
              Save
            </button>
            <button type="button" onClick={() => setSavingTitle(null)} className="rounded-md px-2 py-2 text-xs text-white/50 hover:text-white">
              Cancel
            </button>
          </div>
        )}

        {confirmNew && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-xs text-white/60">
              {unsaved
                ? "This short has changes that aren't in the Library. Save first if you want to keep them."
                : "Start a new short? This one stays in the Library."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => newShort(true)} className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-white">
                New short, same character
              </button>
              <button type="button" onClick={() => newShort(false)} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:text-white">
                New short, new character
              </button>
              <button type="button" onClick={() => setConfirmNew(false)} className="rounded-md px-2 py-1.5 text-xs text-white/50 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        )}

        {savedNote && <p className="mt-2 text-xs text-emerald-300/80">{savedNote}</p>}
      </section>
    </div>
  );
}
