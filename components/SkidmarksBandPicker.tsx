"use client";

import { coverGradientClass, type SkidmarksBand } from "@/lib/skidmarks";

interface SkidmarksBandPickerProps {
  bands: SkidmarksBand[];
  activeBandId: string | null;
  onSelectBand: (bandId: string) => void;
  onCreateBand: () => void;
  onEditCover: (bandId: string) => void;
}

function EditGlyph({ icon }: { icon: "pencil" | "camera" }) {
  if (icon === "camera") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
        <path
          d="M4 7.5h2l1-1.5h6l1 1.5h2v8H4v-8Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="11.5" r="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path
        d="M13.5 3.5 16 6l-8.5 8.5-3 1 1-3L13.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NewBandTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="New band"
      className="flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/25 bg-white/[0.02] transition-colors hover:border-rose-400/40 hover:bg-rose-400/[0.04] active:scale-[0.98]"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-base text-white/50">
        +
      </span>
      <span className="text-[11px] font-medium tracking-wide text-white/50">New</span>
    </button>
  );
}

function BandTile({
  band,
  active,
  onSelect,
  onEditCover,
}: {
  band: SkidmarksBand;
  active: boolean;
  onSelect: () => void;
  onEditCover: () => void;
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`Choose band ${band.name}`}
        className={[
          "flex h-28 w-28 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl bg-gradient-to-br px-2.5 text-center transition-transform active:scale-[0.98]",
          coverGradientClass(band.coverSeed),
          active
            ? "ring-2 ring-rose-400 ring-offset-2 ring-offset-zinc-950"
            : "ring-1 ring-white/10 hover:ring-white/25",
        ].join(" ")}
      >
        <span className="line-clamp-2 text-sm font-bold uppercase tracking-wide text-white drop-shadow">
          {band.name}
        </span>
        <span className="line-clamp-2 text-[10px] leading-tight text-white/70">
          {band.tagline}
        </span>
      </button>
      <button
        type="button"
        onClick={onEditCover}
        aria-label={`Change cover art for ${band.name}`}
        title="Change cover art"
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
      >
        <EditGlyph icon={band.editIcon} />
      </button>
    </div>
  );
}

/**
 * "Choose a band" — a horizontal scroll of square album-cover tiles: New
 * (+) first, then every known band, cover art only (never member faces,
 * per the locked mockup's product rule). Each existing band tile has a
 * small pencil/camera "edit cover" glyph in its corner — this build just
 * exposes the affordance (`onEditCover`); it doesn't open a real image
 * picker yet, see `SkidmarksDetailSheet`.
 */
export function SkidmarksBandPicker({
  bands,
  activeBandId,
  onSelectBand,
  onCreateBand,
  onEditCover,
}: SkidmarksBandPickerProps) {
  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-1 pl-0.5 pr-1 [scrollbar-width:thin]">
      <NewBandTile onClick={onCreateBand} />
      {bands.map((band) => (
        <BandTile
          key={band.id}
          band={band}
          active={band.id === activeBandId}
          onSelect={() => onSelectBand(band.id)}
          onEditCover={() => onEditCover(band.id)}
        />
      ))}
    </div>
  );
}
