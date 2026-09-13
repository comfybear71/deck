"use client";

import {
  formatSegmentRange,
  isLipSyncModel,
  skidmarksModelBadge,
  SKIDMARKS_LOCATION_PLATES,
  type SkidmarksClipSegment,
  type SkidmarksPlateId,
} from "@/lib/skidmarks";

interface SkidmarksPlatesAndCameraProps {
  segment: SkidmarksClipSegment;
  onSetPlate: (plateId: SkidmarksPlateId) => void;
  onSetShotPrompt: (shotPrompt: string) => void;
}

const SHOT_PROMPT_MAX_LENGTH = 160;

/**
 * A clip's expanded body — Stuart's final chrome lock, ruthlessly
 * minimal: **large location-plate cards** in a horizontal scroll (time
 * range overlaid top-left on the image, model badge top-right, no text
 * stacked underneath), and **one shot-prompt box**. That's the entire
 * control surface — the Camera Angles block and the manual Model row
 * (LTX/H3/Grok/SIRAY/Kling pills + their helper paragraphs) that used to
 * live here are gone outright, not just hidden: `model` is now fully
 * automatic from the shot prompt + clip type (see `lib/skidmarks.ts`'s
 * `defaultSegmentModel`), and there's no camera-angle concept left to
 * pick. SIRAY survives only as a data-layer opt-in
 * (`uncensoredPlateStills`/`SKIDMARKS_UNCENSORED_STILLS_LABEL`) with no
 * control here; Kling and Seedance aren't in this build at all.
 *
 * Each plate card is a stub — no real plate photos, no real still
 * generation — but is deliberately sized like an actual still (bigger
 * than the old thumbnail row) since it's Stuart's primary visual here:
 * what he needs to *see* is which location this clip's on and roughly
 * what's happening in it, not a metadata table. Tapping a card picks
 * that location; nothing here ever hardcodes shot content — the only
 * text a card (or this file) ever shows is Stuart's own `shotPrompt`.
 * Rendered per-clip inside `SkidmarksClipTimeline`, not as a shared
 * top-level section, per the locked plates mockup.
 */
export function SkidmarksPlatesAndCamera({
  segment,
  onSetPlate,
  onSetShotPrompt,
}: SkidmarksPlatesAndCameraProps) {
  const timeRange = formatSegmentRange(segment.startSec, segment.endSec);
  const lipSync = isLipSyncModel(segment.model);
  const modelBadge = skidmarksModelBadge(segment.model);
  const promptPreview = segment.shotPrompt.trim();

  return (
    <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-3">
      {/* Big stub stills — the primary visual. Every card shares this
          clip's one shot prompt as its caption (never a hardcoded scene
          description), so scrolling between location options never loses
          "what's supposed to be happening here". */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {SKIDMARKS_LOCATION_PLATES.map((plate) => {
          const active = segment.plateId === plate.id;
          return (
            <button
              key={plate.id}
              type="button"
              onClick={() => onSetPlate(plate.id)}
              aria-pressed={active}
              aria-label={`${plate.label} plate stub \u2014 ${timeRange}, ${modelBadge}${lipSync ? ", lip-sync" : ""}`}
              className={[
                "relative flex h-28 w-40 shrink-0 flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br px-2 py-1.5 text-left transition-transform active:scale-[0.97]",
                plate.gradient,
                // `ring-inset`, not `ring-offset` — see `SkidmarksBandPicker`'s
                // `BandTile` for why: an offset ring draws outside the box and
                // a scrolling ancestor's overflow can clip it clean off; inset
                // never can.
                active ? "ring-2 ring-inset ring-rose-400" : "ring-1 ring-inset ring-white/15",
              ].join(" ")}
            >
              <span className="flex items-start justify-between gap-1">
                <span className="rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-white/85">
                  {timeRange}
                </span>
                <span className="flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-rose-200">
                  {lipSync && <span aria-hidden>{"\u{1F3A4}"}</span>}
                  {modelBadge}
                </span>
              </span>

              <span aria-hidden className="line-clamp-3 px-0.5 text-center text-[10px] leading-snug text-white/80 drop-shadow">
                {promptPreview || "No shot prompt yet"}
              </span>

              <span className="truncate text-[10px] font-medium text-white drop-shadow">
                {plate.label}
              </span>
            </button>
          );
        })}
      </div>

      <input
        type="text"
        value={segment.shotPrompt}
        onChange={(e) => onSetShotPrompt(e.target.value)}
        placeholder="What happens in this shot"
        maxLength={SHOT_PROMPT_MAX_LENGTH}
        aria-label="Shot prompt"
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
      />
    </div>
  );
}
