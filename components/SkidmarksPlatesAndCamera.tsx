"use client";

import {
  formatSegmentRange,
  isLipSyncModel,
  segmentDurationSec,
  skidmarksModelBadge,
  SKIDMARKS_CAMERA_ANGLES,
  SKIDMARKS_LOCATION_PLATES,
  SKIDMARKS_MODELS,
  type SkidmarksCameraAngleId,
  type SkidmarksClipSegment,
  type SkidmarksModelId,
  type SkidmarksPlateId,
} from "@/lib/skidmarks";

interface SkidmarksPlatesAndCameraProps {
  segment: SkidmarksClipSegment;
  onSetPlate: (plateId: SkidmarksPlateId) => void;
  onSetCameraAngle: (cameraAngle: SkidmarksCameraAngleId) => void;
  onSetModel: (model: SkidmarksModelId) => void;
}

function CameraAngleIcon({ id }: { id: SkidmarksCameraAngleId }) {
  if (id === "close-up") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
        <circle cx="10" cy="10" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="10" cy="10" r="1.6" fill="currentColor" />
      </svg>
    );
  }
  if (id === "wide") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
        <rect x="2.5" y="6" width="15" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (id === "low-angle") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
        <path
          d="M10 16V4M10 4 6 8M10 4l4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (id === "tracking") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
        <path
          d="M3 14c3-6 8-9 14-8"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="2.2 2.2"
        />
        <circle cx="17" cy="6" r="1.6" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <rect x="3" y="3" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 10h14M10 3v14" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * Plates & Camera — a clip's expanded body: a horizontal scroll of
 * location plates, a wrapped row of camera angles, and the model row.
 * Every option here is a seed/stub tag (no real plate photos, no real
 * camera coverage, no real model call — the "Lip-sync" badge and
 * vocalist-position dot below are decorative UI, not a real pose/vision
 * detection) — see `lib/skidmarks.ts`'s module doc comment. Rendered
 * per-clip inside `SkidmarksClipTimeline`, not as a shared section, per
 * the locked plates mockup.
 */
export function SkidmarksPlatesAndCamera({
  segment,
  onSetPlate,
  onSetCameraAngle,
  onSetModel,
}: SkidmarksPlatesAndCameraProps) {
  const durationSec = segmentDurationSec(segment.startSec, segment.endSec);
  const timeRange = formatSegmentRange(segment.startSec, segment.endSec);
  const lipSync = isLipSyncModel(segment.model);

  return (
    <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-3">
      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-white/35">
          Location plates
        </p>
        {/* Each card repeats this clip's time range, duration, and current
            model/lip-sync tags — a horizontal scroll can lose the
            segment's own header out of view, so every plate stays
            self-describing on its own rather than relying on scroll
            position for context. */}
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {SKIDMARKS_LOCATION_PLATES.map((plate) => {
            const active = segment.plateId === plate.id;
            return (
              <button
                key={plate.id}
                type="button"
                onClick={() => onSetPlate(plate.id)}
                aria-pressed={active}
                aria-label={`${plate.label} plate \u2014 ${timeRange}, ${durationSec}s, ${skidmarksModelBadge(segment.model)}${lipSync ? ", lip-sync" : ""}`}
                className={[
                  "flex w-24 shrink-0 flex-col overflow-hidden rounded-xl text-left transition-transform active:scale-[0.97]",
                  active ? "ring-2 ring-rose-400 ring-offset-1 ring-offset-zinc-950" : "ring-1 ring-white/10",
                ].join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "relative flex h-14 w-full items-center justify-center bg-gradient-to-br px-1",
                    plate.gradient,
                  ].join(" ")}
                >
                  <span className="line-clamp-2 text-[10px] font-medium leading-tight text-white drop-shadow">
                    {plate.label}
                  </span>
                  {lipSync && (
                    <>
                      <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wide text-rose-200">
                        Lip-sync
                      </span>
                      {/* Seed placement, not a real pose/vision detection —
                          just "roughly here" so the lip-sync framing reads
                          as intentional, not arbitrary. */}
                      <span
                        title="Vocalist position (seed placement, not detected)"
                        className="absolute bottom-1.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-rose-300 ring-2 ring-white/80"
                      />
                    </>
                  )}
                </span>
                <span className="flex flex-col gap-0.5 bg-black/50 px-1.5 py-1">
                  <span className="text-[9px] font-medium tabular-nums text-white/70">{timeRange}</span>
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-[8px] text-white/40">{durationSec}s</span>
                    <span className="rounded bg-white/10 px-1 py-[1px] text-[8px] font-semibold text-white/70">
                      {skidmarksModelBadge(segment.model)}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-white/35">
          Camera angles
        </p>
        <p className="mb-1.5 text-[10px] leading-relaxed text-white/30">
          One angle for now {"\u2014"} Seedance/Framer-style multi-camera
          coverage from a single still is a later upgrade, not this pass.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SKIDMARKS_CAMERA_ANGLES.map((angle) => {
            const active = segment.cameraAngle === angle.id;
            return (
              <button
                key={angle.id}
                type="button"
                onClick={() => onSetCameraAngle(angle.id)}
                aria-pressed={active}
                className={[
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  active
                    ? "border-rose-400/50 bg-rose-400/15 text-rose-200"
                    : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white/80",
                ].join(" ")}
              >
                <CameraAngleIcon id={angle.id} />
                {angle.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-white/35">
          Model
        </p>
        <p className="mb-1.5 text-[10px] leading-relaxed text-white/30">
          Singing defaults to LTX Lip-sync; instrumental/lead/break default
          to a plain model {"\u2014"} tap any pill to override.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SKIDMARKS_MODELS.map((model) => {
            const active = segment.model === model.id;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => onSetModel(model.id)}
                aria-pressed={active}
                className={[
                  "rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  active
                    ? "border-rose-400/60 bg-rose-400/15 text-rose-200 shadow-[0_0_14px_-4px_rgba(251,113,133,0.7)]"
                    : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white/80",
                ].join(" ")}
              >
                {model.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
