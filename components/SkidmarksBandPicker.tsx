"use client";

import { useRef, useState } from "react";
import { coverGradientClass, readImageFileAsDataUrl, type SkidmarksBand } from "@/lib/skidmarks";

interface SkidmarksBandPickerProps {
  bands: SkidmarksBand[];
  activeBandId: string | null;
  onSelectBand: (bandId: string) => void;
  onCreateBand: () => void;
  onSetCoverImage: (bandId: string, dataUrl: string) => void;
}

/** Native file picker's accept list — jpg/png/webp only, matches what a
 * phone's own photo library exports. */
const COVER_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

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
  onSetCoverImage,
}: {
  band: SkidmarksBand;
  active: boolean;
  onSelect: () => void;
  onSetCoverImage: (dataUrl: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [picking, setPicking] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPicking(true);
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      onSetCoverImage(dataUrl);
    } catch {
      // Couldn't decode the picked file — leave the existing cover as-is.
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`Choose band ${band.name}`}
        className={[
          "relative flex h-28 w-28 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl px-2.5 text-center transition-transform active:scale-[0.98]",
          band.coverImage ? "bg-zinc-900" : `bg-gradient-to-br ${coverGradientClass(band.coverSeed)}`,
          active
            ? "ring-2 ring-rose-400 ring-offset-2 ring-offset-zinc-950"
            : "ring-1 ring-white/10 hover:ring-white/25",
        ].join(" ")}
      >
        {band.coverImage && (
          // eslint-disable-next-line @next/next/no-img-element -- data-URL cover, next/image can't optimize it
          <img
            src={band.coverImage}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {band.coverImage && (
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent"
          />
        )}
        <span className="relative line-clamp-2 text-sm font-bold uppercase tracking-wide text-white drop-shadow">
          {band.name}
        </span>
        <span className="relative line-clamp-2 text-[10px] leading-tight text-white/70">
          {band.tagline}
        </span>
      </button>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={picking}
        aria-label={`Change cover art for ${band.name}`}
        title="Change cover art"
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white disabled:opacity-60"
      >
        {picking ? (
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/70" aria-hidden />
        ) : (
          <EditGlyph icon={band.editIcon} />
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={COVER_IMAGE_ACCEPT}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />
    </div>
  );
}

/**
 * "Choose a band" — a horizontal scroll of square album-cover tiles: New
 * (+) first, then every known band, cover art only (never member faces,
 * per the locked mockup's product rule). Each existing band tile has a
 * small pencil/camera "edit cover" glyph in its corner; tapping it opens
 * a real native file picker (jpg/png/webp) and, once a file's chosen,
 * downscales + stores it as a data URL (`readImageFileAsDataUrl`) that
 * the tile then renders instead of the mock gradient — a real picked
 * photo, not a generated stand-in.
 */
export function SkidmarksBandPicker({
  bands,
  activeBandId,
  onSelectBand,
  onCreateBand,
  onSetCoverImage,
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
          onSetCoverImage={(dataUrl) => onSetCoverImage(band.id, dataUrl)}
        />
      ))}
    </div>
  );
}
