"use client";

import { useRef, useState } from "react";
import { coverGradientClass, readImageFileAsDataUrl, type SkidmarksBand } from "@/lib/skidmarks";

interface SkidmarksBandPickerProps {
  bands: SkidmarksBand[];
  activeBandId: string | null;
  onSelectBand: (bandId: string) => void;
  onCreateBand: () => void;
  onSetCoverImage: (bandId: string, dataUrl: string) => void;
  onRemoveBand: (bandId: string) => void;
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

function TrashGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path
        d="M5 5.5h10M8.25 5.5v-1a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v1M6.25 5.5l.5 9a1 1 0 0 0 1 .95h4.5a1 1 0 0 0 1-.95l.5-9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
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
  onRemove,
}: {
  band: SkidmarksBand;
  active: boolean;
  onSelect: () => void;
  onSetCoverImage: (dataUrl: string) => void;
  onRemove: () => void;
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
          "relative flex h-28 w-28 shrink-0 overflow-hidden rounded-2xl transition-transform active:scale-[0.98]",
          band.coverImage ? "bg-zinc-900" : `bg-gradient-to-br ${coverGradientClass(band.coverSeed)}`,
          // `ring-inset`, not `ring-offset` — an offset ring draws *outside*
          // the box (via an extra box-shadow layer), which a scrolling
          // ancestor's `overflow` can clip clean off; an inset ring draws
          // inside the box's own edge, so no ancestor overflow can ever
          // clip it, no matter how tight the scroll row's padding is.
          active ? "ring-2 ring-inset ring-rose-400" : "ring-1 ring-inset ring-white/10 hover:ring-white/25",
        ].join(" ")}
      >
        {band.coverImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- data-URL cover, next/image can't optimize it */}
            <img
              src={band.coverImage}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* A thin bottom-only scrim — just enough to keep the name/
                tagline legible without washing out the middle of the
                picked cover photo. */}
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/85 via-black/45 to-transparent"
            />
            <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 px-2.5 py-2 text-center">
              <span className="line-clamp-1 text-sm font-bold uppercase tracking-wide text-white drop-shadow">
                {band.name}
              </span>
              <span className="line-clamp-1 text-[10px] leading-tight text-white/80">
                {band.tagline}
              </span>
            </span>
          </>
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-2.5 text-center">
            <span className="line-clamp-2 text-sm font-bold uppercase tracking-wide text-white drop-shadow">
              {band.name}
            </span>
            <span className="line-clamp-2 text-[10px] leading-tight text-white/70">
              {band.tagline}
            </span>
          </span>
        )}
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
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove band ${band.name}`}
        title="Remove band"
        className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white/70 backdrop-blur-sm transition-colors hover:bg-red-500/60 hover:text-white"
      >
        <TrashGlyph />
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
 * per the locked mockup's product rule). Each existing band tile (never
 * the "New" tile, which isn't a band yet) has two small corner glyphs: a
 * pencil/camera "edit cover" glyph (top-right) that opens a real native
 * file picker (jpg/png/webp) and, once a file's chosen, downscales +
 * stores it as a data URL (`readImageFileAsDataUrl`) that the tile then
 * renders instead of the mock gradient — a real picked photo, not a
 * generated stand-in — and a trash "remove band" glyph (top-left) that
 * deletes the band outright via `onRemoveBand`. When a cover photo is
 * set, the name/tagline sit in a thin bottom scrim only, so the picked
 * photo's middle stays visible instead of getting washed out.
 */
export function SkidmarksBandPicker({
  bands,
  activeBandId,
  onSelectBand,
  onCreateBand,
  onSetCoverImage,
  onRemoveBand,
}: SkidmarksBandPickerProps) {
  return (
    // A previous fix tried to out-pad the active tile's `ring-offset`
    // shadow so this row's `overflow-x-auto` (which makes `overflow-y`
    // implicit `auto` too) wouldn't clip it — that still clipped the top
    // ring in practice. The real fix is on the ring itself (`ring-inset`
    // in `BandTile`, below): an inset ring can't be clipped by an
    // ancestor's overflow no matter how this row is padded, so this
    // container just needs enough padding for comfortable edge-to-edge
    // tap targets, nothing load-bearing for the ring anymore.
    <div className="flex items-center gap-3 overflow-x-auto py-1 pl-0.5 pr-1 [scrollbar-width:thin]">
      <NewBandTile onClick={onCreateBand} />
      {bands.map((band) => (
        <BandTile
          key={band.id}
          band={band}
          active={band.id === activeBandId}
          onSelect={() => onSelectBand(band.id)}
          onSetCoverImage={(dataUrl) => onSetCoverImage(band.id, dataUrl)}
          onRemove={() => onRemoveBand(band.id)}
        />
      ))}
    </div>
  );
}
