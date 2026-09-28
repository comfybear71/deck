"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  ADULT_SHORTS_MAX_REFERENCES,
  ADULT_SHORTS_MAX_SHOT_SEC,
  ADULT_SHORTS_MAX_SHOTS,
  ADULT_SHORTS_MIN_SHOT_SEC,
  ADULT_SHORTS_STILL_COST_USD,
  buildAdultShortsMotionPrompt,
  buildAdultShortsShot,
  buildAdultShortsStillPrompt,
  clampAdultShortsDuration,
  estimateAdultShortsClipCostUsd,
  formatUsd,
  resolveAdultShortsStartImage,
  type AdultShortsShot,
} from "@/lib/adultShorts";
import { buildForceDownloadUrl } from "@/lib/clipRenders";
import { uploadSkidmarksMemberPhoto } from "@/lib/memberPhotoBlob";
import { resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import {
  flushSkidmarksSessionNow,
  getAdultShortsState,
  getSkidmarksSnapshot,
  patchAdultShorts,
  readImageFileAsDataUrl,
  subscribeSkidmarks,
} from "@/lib/skidmarks";

/**
 * Adult shorts (2026-09-28) — the screen behind the fourth landing tile.
 * An 18+ confirm, one locked character (name, look, up to three
 * reference images), then a short shot list: each shot makes a Siray
 * spicy plate from one reference, then renders a Siray Wan spicy clip
 * from that plate (or from the previous clip's last frame when chained).
 * Every paid action is a deliberate tap with its price on the button;
 * Render is two taps. Nothing here runs on its own.
 */

const REFERENCE_MAX_DIMENSION = 1600;
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

async function persistImageUrl(dataOrHttps: string): Promise<string> {
  if (!dataOrHttps.startsWith("data:")) return dataOrHttps;
  const up = await uploadSkidmarksMemberPhoto(dataOrHttps);
  // No Blob store (local dev) — keep the downscaled data URL so the flow still works.
  return up.ok ? up.url : dataOrHttps;
}

export function AdultShortsPanel() {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const state = getAdultShortsState(snapshot);
  const { character, shots } = state;
  const [busy, setBusy] = useState<Busy>(null);
  const [armedRenderId, setArmedRenderId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refError, setRefError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
        <p className="text-sm font-semibold text-white">Adult shorts are 18+ only</p>
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

  const addReferences = async (files: FileList | null) => {
    if (!files?.length) return;
    setRefError(null);
    setUploading(true);
    try {
      const room = ADULT_SHORTS_MAX_REFERENCES - character.referenceUrls.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      const urls: string[] = [];
      for (const file of picked) {
        const dataUrl = await readImageFileAsDataUrl(file, REFERENCE_MAX_DIMENSION);
        urls.push(await persistImageUrl(dataUrl));
      }
      patchAdultShorts((s) => ({
        ...s,
        character: {
          ...s.character,
          referenceUrls: [...s.character.referenceUrls, ...urls].slice(0, ADULT_SHORTS_MAX_REFERENCES),
        },
      }));
      flushSkidmarksSessionNow();
    } catch (err) {
      setRefError(err instanceof Error ? err.message : "Could not add that image.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeReference = (index: number) =>
    patchAdultShorts((s) => ({
      ...s,
      character: { ...s.character, referenceUrls: s.character.referenceUrls.filter((_, i) => i !== index) },
      shots: s.shots.map((x) => ({
        ...x,
        referenceIndex: x.referenceIndex === index ? 0 : x.referenceIndex > index ? x.referenceIndex - 1 : x.referenceIndex,
      })),
    }));

  const makePlate = async (shot: AdultShortsShot) => {
    if (busy) return;
    const ref = character.referenceUrls[shot.referenceIndex] ?? character.referenceUrls[0];
    if (!ref) {
      setShotError(shot.id, "Add a reference image of her first.");
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
      const res = await fetch("/api/skidmarks/generate-still-siray", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildAdultShortsStillPrompt(character, shot), referenceImageDataUrls: [refData] }),
      });
      const json = (await res.json().catch(() => ({}))) as { dataUrl?: string; url?: string; error?: string };
      if (!res.ok || !(json.url || json.dataUrl)) throw new Error(json.error || `Siray still failed (HTTP ${res.status}).`);
      const plateUrl = await persistImageUrl(json.url || json.dataUrl!);
      patchShot(shot.id, { plateUrl });
      flushSkidmarksSessionNow();
    } catch (err) {
      setShotError(shot.id, friendlyError(err, "Siray still failed."));
    } finally {
      setBusy(null);
    }
  };

  const renderClip = async (shot: AdultShortsShot, index: number) => {
    if (busy) return;
    setArmedRenderId(null);
    const startImageUrl = resolveAdultShortsStartImage(shots, index);
    if (!startImageUrl && !shot.sirayTaskId) {
      setShotError(
        shot.id,
        shot.chainFromPrevious ? "Render the previous clip first, or make this shot's plate." : "Make the plate first."
      );
      return;
    }
    setShotError(shot.id, null);
    setBusy({ shotId: shot.id, kind: "clip" });
    let taskId = shot.sirayTaskId;
    let networkRetries = 0;
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
        return;
      }
      setShotError(shot.id, "Siray is still rendering. Tap Keep waiting. It won't charge twice.");
    } catch (err) {
      setShotError(
        shot.id,
        isNetworkDrop(err) && taskId
          ? "The connection dropped, but Siray has the job. Tap Keep waiting. It won't charge twice."
          : friendlyError(err, "Siray clip failed.")
      );
    } finally {
      setBusy(null);
    }
  };

  const finishedCount = shots.filter((s) => s.clipUrl).length;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Character</p>
          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-200">18+</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            value={character.name}
            onChange={(e) => patchAdultShorts((s) => ({ ...s, character: { ...s.character, name: e.target.value } }))}
            placeholder="Name (made up)"
            aria-label="Character name"
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
          <input
            value={character.look}
            onChange={(e) => patchAdultShorts((s) => ({ ...s, character: { ...s.character, look: e.target.value } }))}
            placeholder="Look, e.g. wavy blonde hair, gold necklaces"
            aria-label="Character look"
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
        </div>
        <div className="mt-3 flex gap-2">
          {character.referenceUrls.map((url, i) => (
            <div key={url.slice(-40) + i} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Reference ${i + 1}`} className="h-full w-full object-cover" />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-white/80">{i + 1}</span>
              <button
                type="button"
                onClick={() => removeReference(i)}
                aria-label={`Remove reference ${i + 1}`}
                className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[11px] text-white/80 hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
          {character.referenceUrls.length < ADULT_SHORTS_MAX_REFERENCES && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-white/20 text-xs text-white/50 hover:border-white/40 hover:text-white/80"
            >
              {uploading ? "Adding…" : "+ Image"}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void addReferences(e.target.files)}
          />
        </div>
        <p className="mt-2 text-xs text-white/40">
          Up to three pictures of her. Crop out play buttons or watermarks first, or Siray may copy them.
        </p>
        {refError && <p className="mt-2 text-xs text-red-300">{refError}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Shots</p>
          <p className="text-xs text-white/40">
            {finishedCount}/{shots.length} clips done · plate {formatUsd(ADULT_SHORTS_STILL_COST_USD)} each
          </p>
        </div>

        {shots.map((shot, index) => {
          const isBusy = busy?.shotId === shot.id;
          const armed = armedRenderId === shot.id;
          const clipCost = formatUsd(estimateAdultShortsClipCostUsd(shot.durationSec));
          return (
            <div key={shot.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-white">Shot {index + 1}</p>
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
                    disabled={Boolean(busy)}
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
                      disabled={Boolean(busy)}
                      onClick={() => (armed || shot.sirayTaskId ? void renderClip(shot, index) : setArmedRenderId(shot.id))}
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
      </section>
    </div>
  );
}
