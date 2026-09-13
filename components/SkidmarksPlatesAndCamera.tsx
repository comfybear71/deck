"use client";

import {
  formatSegmentRange,
  isLipSyncModel,
  skidmarksModelBadge,
  SKIDMARKS_LOCATION_PLATES,
  SKIDMARKS_MODELS,
  SKIDMARKS_SHOT_PROMPT_EXAMPLES,
  type SkidmarksClipSegment,
  type SkidmarksModelId,
  type SkidmarksPlateId,
} from "@/lib/skidmarks";

interface SkidmarksPlatesAndCameraProps {
  segment: SkidmarksClipSegment;
  onSetPlate: (plateId: SkidmarksPlateId) => void;
  onSetModel: (model: SkidmarksModelId) => void;
  onSetShotPrompt: (shotPrompt: string) => void;
}

const SHOT_PROMPT_MAX_LENGTH = 160;

/**
 * A clip's expanded body — kept ruthlessly minimal per Stuart's chrome
 * lock: an **auto summary line** (model + location, always derived
 * from `segment`, never authored — a one-glance "what's picked right
 * now" before scrolling), **large location-plate cards** in a
 * horizontal scroll (time range overlaid top-left on the image, model
 * badge top-right, no text stacked underneath), **one shot-prompt
 * box**, and a **compact model pill row**. The old Camera Angles block
 * is deleted outright — there's
 * no camera-angle concept left to pick. The Model row survives (Stuart
 * still wants H3/Seedance reachable) but per his cost lock ("be very
 * wary of spend") it's a plain one-tap pick, never something the app
 * assigns on its own: `defaultSegmentModel` in `lib/skidmarks.ts` only
 * ever auto-picks LTX or Grok, and typing in the shot prompt no longer
 * touches `model` at all (an earlier pass did — see
 * `setSkidmarksSegmentShotPrompt`'s doc comment for why that got
 * reverted). SIRAY survives only as a data-layer opt-in
 * (`uncensoredPlateStills`/`SKIDMARKS_UNCENSORED_STILLS_LABEL`) with no
 * pill here; Kling isn't in this build at all.
 *
 * The shot-prompt box's placeholder/helper (see
 * `SKIDMARKS_SHOT_PROMPT_EXAMPLES`) deliberately steers toward **story
 * beat + energy** ("chorus hits hard", "creep to the keyhole") rather
 * than camera jargon — Stuart writes the feeling of the moment, not a
 * shot list; see that constant's doc comment for how a future real
 * pipeline is meant to turn that into an actual cut rhythm on its own.
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
  onSetModel,
  onSetShotPrompt,
}: SkidmarksPlatesAndCameraProps) {
  const timeRange = formatSegmentRange(segment.startSec, segment.endSec);
  const lipSync = isLipSyncModel(segment.model);
  const modelBadge = skidmarksModelBadge(segment.model);
  const promptPreview = segment.shotPrompt.trim();
  const activePlateLabel =
    SKIDMARKS_LOCATION_PLATES.find((p) => p.id === segment.plateId)?.label ?? segment.plateId;

  return (
    <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-3">
      {/* Auto summary line — a plain glance at the two things this clip
          is currently set to (model, location), always derived straight
          from `segment` rather than authored — never a stand-in for the
          shot prompt itself, just "what's picked right now" before
          scrolling the cards below. */}
      <p
        aria-hidden
        className="text-[10px] font-medium text-white/45"
      >
        {modelBadge}
        {lipSync && (
          <span aria-hidden className="ml-1 text-[9px]">
            {"\u{1F3A4}"}
          </span>
        )}
        <span className="mx-1.5 text-white/25">{"\u00b7"}</span>
        {activePlateLabel}
      </p>

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
        placeholder={`e.g. \u201c${SKIDMARKS_SHOT_PROMPT_EXAMPLES[2]}\u201d or \u201c${SKIDMARKS_SHOT_PROMPT_EXAMPLES[1]}\u201d`}
        maxLength={SHOT_PROMPT_MAX_LENGTH}
        aria-label="Shot prompt"
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
      />
      <p className="text-[9px] leading-relaxed text-white/30">
        Story beat + energy, not camera terms {"\u2014"} e.g. {"\u201c"}
        {SKIDMARKS_SHOT_PROMPT_EXAMPLES[0]}
        {"\u201d"}.
      </p>

      {/* Compact model row — a plain one-tap pick, never auto-assigned
          (see this file's doc comment). One short line, not a helper
          paragraph, flags that H3/Seedance are optional extras rather
          than something that might get picked for Stuart. */}
      <div className="flex flex-wrap gap-1.5">
        {SKIDMARKS_MODELS.map((model) => {
          const active = segment.model === model.id;
          return (
            <button
              key={model.id}
              type="button"
              onClick={() => onSetModel(model.id)}
              aria-pressed={active}
              title={model.note}
              className={[
                "rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-rose-400/60 bg-rose-400/15 text-rose-200"
                  : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white/80",
              ].join(" ")}
            >
              {model.badge}
            </button>
          );
        })}
      </div>
      <p className="text-[9px] leading-relaxed text-white/30">
        H3 and Seedance are optional {"\u2014"} tap to pick. Auto-assign only
        ever chooses LTX (vocal) or Grok (instrumental).
      </p>
    </div>
  );
}
