"use client";

import { useState, useSyncExternalStore } from "react";
import {
  getSkidmarksSnapshot,
  getSunnyBanksLiveOrDefault,
  openSunnyBanksWorkspace,
  saveSunnyBanksProjectWorkspace,
  startNewSunnyBanksEpisode,
  subscribeSkidmarks,
} from "@/lib/skidmarks";
import { getSunnyBanksBusy, subscribeSunnyBanksBusy } from "@/lib/sunnyBanksBusy";
import {
  buildEmptySunnyBanksLive,
  defaultSunnyBanksLiveFingerprint,
  describeSunnyBanksWorkspace,
  fingerprintWorkspace,
  type SunnyBanksWorkspaceSnapshot,
} from "@/lib/sunnyBanksWorkspace";

const EMPTY_LIVE_FINGERPRINT = fingerprintWorkspace(buildEmptySunnyBanksLive());

/** The first finished clip in the episode, used as its thumbnail. */
function firstClipUrl(workspace: SunnyBanksWorkspaceSnapshot): string | null {
  for (const act of workspace.actIds) {
    const rows = workspace.runtimeMap[act] ?? {};
    const indexes = Object.keys(rows)
      .map(Number)
      .sort((a, b) => a - b);
    for (const index of indexes) {
      const row = rows[index];
      if (row?.status === "done" && typeof row.videoUrl === "string" && row.videoUrl.length > 0) {
        return row.videoUrl;
      }
    }
  }
  return null;
}

/**
 * Sunny Banks episodes as a sideways row of thumbnails, right under the
 * START A PROJECT tiles (Stuart, 2026-09-30), like Music video's "Choose a
 * band" albums. Tap one to open it. The dotted + tile on the far right
 * starts a new episode.
 *
 * Nothing on screen is ever thrown away: if the episode being worked on
 * has changes no saved card holds, it is saved first, then the other
 * episode (or a blank one) opens. The older "Episode workspace" list and
 * buttons further down are unchanged.
 */
export function SunnyBanksEpisodeRow() {
  const studioState = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const busy = useSyncExternalStore(subscribeSunnyBanksBusy, getSunnyBanksBusy, () => false);
  const [notice, setNotice] = useState<string | null>(null);
  const live = studioState.sunnyBanks?.live ?? getSunnyBanksLiveOrDefault(studioState);
  const workspaces = studioState.sunnyBanks?.workspaces ?? [];
  const liveFingerprint = fingerprintWorkspace(live);
  const activeId = workspaces.find((workspace) => workspace.fingerprint === liveFingerprint)?.id ?? null;

  /** Save what's on screen first when no saved card already holds it. */
  const keepLiveWork = (): string | null => {
    if (activeId) return null;
    if (liveFingerprint === EMPTY_LIVE_FINGERPRINT || liveFingerprint === defaultSunnyBanksLiveFingerprint()) {
      return null;
    }
    return saveSunnyBanksProjectWorkspace().label;
  };

  const handleOpen = (workspace: SunnyBanksWorkspaceSnapshot) => {
    if (busy || workspace.id === activeId) return;
    const saved = keepLiveWork();
    openSunnyBanksWorkspace(workspace.id);
    setNotice(saved ? `Saved "${saved}", then opened "${workspace.label}".` : `Opened "${workspace.label}".`);
  };

  const handleNew = () => {
    if (busy) return;
    const saved = keepLiveWork();
    startNewSunnyBanksEpisode();
    setNotice(saved ? `Saved "${saved}", then started a new episode.` : "Started a new episode.");
  };

  return (
    <div>
      <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">Episodes</p>
      <div className="flex touch-pan-x items-start gap-3 overflow-x-auto py-1 pl-0.5 pr-1 [scrollbar-width:thin]">
        {workspaces.map((workspace) => {
          const clip = firstClipUrl(workspace);
          const active = workspace.id === activeId;
          return (
            <button
              key={workspace.id}
              type="button"
              onClick={() => handleOpen(workspace)}
              disabled={busy}
              aria-label={`Open ${workspace.label}`}
              aria-pressed={active}
              className={`relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-amber-300/25 via-orange-400/15 to-zinc-900 text-left disabled:opacity-60 ${
                active ? "ring-2 ring-inset ring-amber-300" : "ring-1 ring-inset ring-white/10"
              }`}
            >
              {clip && (
                <video
                  src={`${clip}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  aria-hidden
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4">
                <span className="block truncate text-[11px] font-semibold text-white">{workspace.label}</span>
                <span className="block truncate text-[9px] text-white/60">{describeSunnyBanksWorkspace(workspace)}</span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={handleNew}
          disabled={busy}
          aria-label="New episode"
          className="flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/25 bg-white/[0.02] transition-colors hover:border-amber-300/40 hover:bg-amber-300/[0.04] active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-base text-white/50">
            +
          </span>
          <span className="text-[11px] font-medium tracking-wide text-white/50">New</span>
        </button>
      </div>
      {notice && (
        <p role="status" className="mt-1.5 text-[11px] leading-snug text-emerald-200/90">
          {notice}
        </p>
      )}
    </div>
  );
}
