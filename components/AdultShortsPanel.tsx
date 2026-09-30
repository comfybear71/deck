"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { videoBackendTagLabel } from "@/lib/videoBackendRouting";
import {
  ADULT_SHORTS_MAX_SHOT_SEC,
  ADULT_SHORTS_MAX_SHOTS,
  ADULT_SHORTS_MIN_SHOT_SEC,
  ADULT_SHORTS_STILL_COST_USD,
  buildAdultShortsMotionPrompt,
  buildAdultShortsShot,
  adultShortEpisodeCode,
  adultShortEpisodeNumbers,
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
import { slugifyCharacterName } from "@/lib/characterLoras";
import { resolveShortsRenderCharacter, shortsCastList, shortsCharacterFromCast } from "@/lib/shortsCast";
import { setShortsBusy } from "@/lib/shortsBusy";
import { runSunnyBanksRenderQueue } from "@/lib/sunnyBanksRenderQueue";
import { SHORTS_EDITOR_ID } from "./ShortsEpisodeRow";

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
  // Who's in this episode, read through her Cast card (the episode's own
  // pictures first, so each shot's "From N" still means the same picture).
  const character = resolveShortsRenderCharacter(snapshot);
  const cast = shortsCastList(snapshot);
  const starringSlug = slugifyCharacterName(state.character.name);
  const starring = state.character.name.trim() ? cast.find((c) => slugifyCharacterName(c.name) === starringSlug) ?? null : null;
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

  /** "Starring": the episode's girl comes from the Cast row. */
  const pickStarring = (key: string) => {
    const c = cast.find((x) => x.sourceKey === key);
    if (!c || c.blockedReason) return;
    patchAdultShorts((st) => ({ ...st, character: shortsCharacterFromCast(c) }));
    flushSkidmarksSessionNow();
  };

  const makePlate = async (shot: AdultShortsShot) => {
    if (busy) return;
    const ref = character.referenceUrls[shot.referenceIndex] ?? character.referenceUrls[0];
    if (!ref) {
      setShotError(shot.id, "Add her pictures on her card in the Cast row first.");
      return;
    }
    if (!shot.prompt.trim()) {
      setShotError(shot.id, "Write what this shot shows first.");
      return;
    }
    setShotError(shot.id, null);
    setBusy({ shotId: shot.id, kind: "plate" });
    try {
      const refData = await resolvePlateReferenceDataUrl(ref);
      const plateTarget = adultShortTargetFor("plate", shots.findIndex((x) => x.id === shot.id) + 1);
      const res = await fetch("/api/skidmarks/generate-still-siray", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildAdultShortsStillPrompt(character, shot),
          referenceImageDataUrls: [refData],
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
    const character = resolveShortsRenderCharacter(getSkidmarksSnapshot());
    const startImageUrl = resolveAdultShortsStartImage(now.shots, index);
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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: buildAdultShortsMotionPrompt(character, shot),
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

  const finishedCount = shots.filter((s) => s.clipUrl).length;
  const unfinished = shots.filter((s) => !s.clipUrl);
  const queueCost = formatUsd(unfinished.reduce((sum, s) => sum + estimateAdultShortsClipCostUsd(s.durationSec), 0));
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

  return (
    <div id={SHORTS_EDITOR_ID} className="flex scroll-mt-4 flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">
            Shots{episodeNumber ? ` · ${adultShortEpisodeCode(episodeNumber)}` : ""}
          </p>
          <p className="text-xs text-white/40">
            {finishedCount}/{shots.length} clips done · plate {formatUsd(ADULT_SHORTS_STILL_COST_USD)} each
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-white/60">
          {character.referenceUrls[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={character.referenceUrls[0]} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover object-top" />
          )}
          <label htmlFor="shorts-starring" className="shrink-0">
            Starring
          </label>
          <select
            id="shorts-starring"
            value={starring?.sourceKey ?? ""}
            onChange={(e) => pickStarring(e.target.value)}
            disabled={Boolean(busy) || queueRunning}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-base text-white sm:flex-none sm:text-xs"
          >
            {!starring && <option value="">{state.character.name.trim() || "Pick someone from the Cast row"}</option>}
            {cast.map((c) => (
              <option key={c.sourceKey} value={c.sourceKey} disabled={Boolean(c.blockedReason)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {!character.referenceUrls.length && (
          <p className="text-xs text-white/40">
            {character.name.trim() ? `${character.name.trim()} has no pictures yet.` : "Pick who's in this episode."} Add her
            pictures on her card in the Cast row above.
          </p>
        )}

        {shots.map((shot, index) => {
          const isBusy = busy?.shotId === shot.id;
          const armed = armedRenderId === shot.id;
          const clipCost = formatUsd(estimateAdultShortsClipCostUsd(shot.durationSec));
          return (
            <div key={shot.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-white">
                  Shot {index + 1}
                  {/* Every Shorts clip renders on Siray Wan 3.0 spicy (2026-09-30 engine chip). */}
                  <span title="Video on Siray" className="ml-1.5 align-middle text-[9px] font-bold tracking-wide text-red-400">
                    {videoBackendTagLabel("siray")}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <select
                    value={shot.durationSec}
                    onChange={(e) => patchShot(shot.id, { durationSec: clampAdultShortsDuration(Number(e.target.value)) })}
                    aria-label={`Shot ${index + 1} length`}
                    className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
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
                      onClick={() => patchAdultShorts((s) => ({ ...s, shots: s.shots.filter((x) => x.id !== shot.id) }))}
                      aria-label={`Remove shot ${index + 1}`}
                      className="rounded-md px-2 py-1 text-xs text-white/40 hover:text-white/80"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <textarea
                value={shot.prompt}
                onChange={(e) => patchShot(shot.id, { prompt: e.target.value })}
                rows={3}
                placeholder="What happens in this shot, e.g. lounging on a velvet couch in a band room, laughing, glitter falling, slow push-in"
                aria-label={`Shot ${index + 1} prompt`}
                className="mt-2 w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
              />

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/60">
                {character.referenceUrls.length > 1 && (
                  <span className="flex items-center gap-1">
                    From
                    {character.referenceUrls.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => patchShot(shot.id, { referenceIndex: i })}
                        aria-pressed={shot.referenceIndex === i}
                        className={[
                          "rounded-md border px-2 py-0.5",
                          shot.referenceIndex === i ? "border-red-400/60 text-white" : "border-white/10 text-white/50",
                        ].join(" ")}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </span>
                )}
                {index > 0 && (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={shot.chainFromPrevious}
                      onChange={(e) => patchShot(shot.id, { chainFromPrevious: e.target.checked })}
                    />
                    Start from shot {index}&apos;s last frame
                  </label>
                )}
              </div>

              <div className="mt-3 flex gap-3">
                <div className="flex w-32 shrink-0 flex-col gap-1.5">
                  <div className="flex h-20 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/40 text-[11px] text-white/30">
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
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex h-20 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black/40 text-[11px] text-white/30">
                    {shot.clipUrl ? (
                      <video src={shot.clipUrl} controls playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      "No clip"
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={Boolean(busy) || queueRunning}
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
              {errors[shot.id] && <p className="mt-2 text-xs text-red-300">{errors[shot.id]}</p>}
            </div>
          );
        })}

        {shots.length < ADULT_SHORTS_MAX_SHOTS && (
          <button
            type="button"
            onClick={() => patchAdultShorts((s) => ({ ...s, shots: [...s.shots, buildAdultShortsShot()] }))}
            className="rounded-md border border-dashed border-white/15 px-3 py-2 text-sm text-white/60 hover:border-white/30 hover:text-white"
          >
            + Add shot
          </button>
        )}

        {/* Render every unfinished shot in order, with Stop (the same
            controls as Sunnybank's Render all, 2026-09-30). */}
        {(unfinished.length > 1 || queueRunning) && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={Boolean(busy) || queueRunning}
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
                  : `Render ${unfinished.length} clips ${queueCost}`}
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
        {queueNote && <p className="text-xs text-white/60">{queueNote}</p>}
      </section>

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
