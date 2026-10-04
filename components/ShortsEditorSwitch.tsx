"use client";

import { useSyncExternalStore } from "react";
import { getAdultShortsState, getSkidmarksSnapshot, setShortsEditor, subscribeSkidmarks } from "@/lib/skidmarks";
import { getSunnyBanksBusy, subscribeSunnyBanksBusy } from "@/lib/sunnyBanksBusy";

/**
 * Shorts has two editors (2026-10-04): the script studio (the same one
 * as Sunny Banks and Skidmarks) and the shot cards every Shorts episode
 * used until now. EP01–EP03 stay on the shot cards, untouched; a script
 * episode is a new episode. This switch only says which one is on screen.
 */
export function ShortsEditorSwitch() {
  const state = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const busy = useSyncExternalStore(subscribeSunnyBanksBusy, getSunnyBanksBusy, () => false);
  const script = getAdultShortsState(state).editor === "script";
  const options = [
    { id: "script" as const, label: "Script episodes" },
    { id: null, label: "Shot-card episodes" },
  ];
  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label="Shorts editor" className="flex overflow-hidden rounded-xl border border-white/10">
        {options.map((option) => {
          const on = (option.id === "script") === script;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={on}
              disabled={Boolean(busy)}
              onClick={() => setShortsEditor(option.id)}
              className={[
                "min-h-[44px] flex-1 px-3 text-[12px] font-semibold disabled:opacity-60",
                on ? "bg-amber-300/15 text-amber-200" : "text-white/50",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] leading-snug text-white/40">
        {script
          ? "Script episodes: write the whole episode as a script, like Sunny Banks and Skidmarks. EP01–EP03 are under Shot-card episodes."
          : "Shot-card episodes: EP01–EP03 and any short made one shot at a time."}
      </p>
    </div>
  );
}
