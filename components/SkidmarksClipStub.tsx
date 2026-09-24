"use client";

import { SkidmarksConfirmDialog } from "./SkidmarksConfirmDialog";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  downscaleDataUrlImage,
  flushSkidmarksSessionNow,
  keepSkidmarksMemberSleeveStill,
  MAX_PLATES_PER_CLIP,
  resolveInstrumentalVideoModel,
  resolveSelectedPlateId,
  SKIDMARKS_SEGMENT_LABEL_META,
  type SkidmarksBand,
  type SkidmarksClipPlateSlot,
  type SkidmarksClipSegment,
  type SkidmarksClipSentPayload,
  type SkidmarksInstrumentalVideoModel,
  type SkidmarksMember,
  type SkidmarksModelId,
  type SkidmarksPlateStill,
} from "@/lib/skidmarks";
import {
  buildLibraryPlateStill,
  resolveMemberStillSleeve,
  urlIsInMemberSleeve,
  type SkidmarksMemberSleeveEntry,
} from "@/lib/memberStillSleeve";
import {
  buildPlateGenerationRequest,
  buildSirayClipStillPrompt,
  generatePlateStill,
  generatePlateStillViaSiray,
  plateGenerationHoldsIdentity,
  resolvePlateReferenceDataUrl,
  resolveVocalistForPrompt,
  shotPromptMentionsLockedCharacter,
} from "@/lib/plateGeneration";
import { SIRAY_SEEDREAM_45_COST_USD } from "@/lib/sirayClient";
import { resolveLocationStill } from "@/lib/plateLocation";
import { computeLtxPlateDurationSec, computePlateDurationSec } from "@/lib/clipGeneration";
import { uploadSkidmarksPlateStill } from "@/lib/plateStillBlob";
import { SkidmarksClipRender } from "./SkidmarksClipRender";
import type { PersistedClipRender } from "@/lib/clipRenders";

interface SkidmarksClipStubProps {
  segment: SkidmarksClipSegment;
  band: SkidmarksBand;
  /** The previous *clip's* last plate's still, if any — the continuity
   * reference for this clip's **first** plate slot only; every later
   * slot in this clip's own strip continues from the plate right before
   * it instead (see this component's doc comment). */
  previousStill?: SkidmarksPlateStill;
  onSetShotPrompt: (shotPrompt: string) => void;
  /** The counterpart "what to keep out of this shot" field — see
   * `lib/skidmarks.ts`'s `SkidmarksClipSegment.negativePrompt` doc
   * comment for what this actually reaches (Vocal/LTX only). */
  onSetNegativePrompt: (negativePrompt: string) => void;
  onSetPlateStill: (plateId: string, still: SkidmarksPlateStill | null) => void;
  onAddPlate: () => void;
  onRemovePlate: (plateId: string) => void;
  /** The corner select control on a filled plate tile — radio-style,
   * one plate selected at a time; see `lib/skidmarks.ts`'s
   * `resolveSelectedPlateId`. */
  onSelectPlate: (plateId: string) => void;
  /** This plate's own stored camera-motion text — per-plate now, see
   * `SkidmarksClipPlateSlot.motionPrompt`'s doc comment. */
  onSetPlateMotionPrompt: (plateId: string, motionPrompt: string) => void;
  onSetPlateLastSent: (plateId: string, sent: SkidmarksClipSentPayload) => void;
  /** The H3/Grok switch inside `SkidmarksClipRender`'s Render confirm —
   * see `lib/skidmarks.ts`'s `SkidmarksInstrumentalVideoModel`/
   * `setSkidmarksSegmentInstrumentalVideoModel`. Only meaningful (and
   * only rendered) on an Instrumental clip. */
  onSetClipInstrumentalModel: (model: SkidmarksInstrumentalVideoModel) => void;
  /** Which of *this clip's* plates already have a persisted render —
   * drives each plate tile's tick and the Render control's "already
   * rendered" status line. Scoped to this one segment by the caller
   * (`SkidmarksClipTimeline`), which tracks renders across the whole
   * song. */
  renderedPlateIds: ReadonlySet<string>;
  /** Threaded straight through to `SkidmarksClipRender` \u2014 see that
   * component's doc comment and `SkidmarksClipTimeline`'s "one render at
   * a time" state. */
  renderLocked: boolean;
  onRenderStart: (plateId: string) => void;
  onRenderEnd: (plateId: string) => void;
  /** This clip's 1-based position in the timeline — passed straight
   * through to `SkidmarksClipRender` for its numeric download filename
   * and Blob pathname; everything else it needs (`segment.id`,
   * `segment.startSec`/`endSec`) is already on `segment`. */
  clipIndex: number;
  onPersisted: (render: PersistedClipRender) => void;
  /** The attached song's own durable Blob URL
   * (`SkidmarksMp3Attachment.audioUrl`) — threaded straight through to
   * `SkidmarksClipRender` for the Vocal/Comfy-LTX render path, which
   * needs a real slice of it (`lib/mp3Slice.ts`, server-side). `undefined`
   * until that upload finishes (or if it never configures/succeeds) —
   * see `lib/mp3Blob.ts`. Unused on an Instrumental clip's Grok render. */
  mp3AudioUrl?: string;
}

const SHOT_PROMPT_MAX_LENGTH = 500;
/** Long enough that a normal tap/scroll gesture never fires it by
 * accident, short enough to read as deliberate — matches the general
 * "long-press to delete" feel on iOS/Android without needing a hint. */
const LONG_PRESS_MS = 550;

function EmptyStillIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-6 w-6">
      <path
        d="M4 14.5 8 9l2.5 3L14 8l2 3v3.5H4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="6.5" r="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-2.5 w-2.5">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Same spinner shape used everywhere else in this feature for "real
 * work in flight". */
function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 animate-spin text-white/80">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
      <path d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className={className}>
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M10 13.5V4.5M6.25 8.25 10 4.5l3.75 3.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 14v1.1c0 .77.62 1.4 1.4 1.4h8.2c.77 0 1.4-.63 1.4-1.4V14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface SkidmarksPlatePopoverProps {
  /** `"sm"` for the tiny popover anchored on a strip tile, `"md"` for
   * the roomier one inside the lightbox — same layout, just tuned for
   * the space available in each spot. */
  size?: "sm" | "md";
  previousStill?: SkidmarksPlateStill;
  useLastPlate: boolean;
  onSetUseLastPlate: (value: boolean) => void;
  onUpload: () => void;
  onGenerate: () => void;
  /** Optional Siray spicy still — same slot as Generate, ~$0.04. */
  onSiray?: () => void;
  onDismiss: () => void;
  /** When set, show a free "From sleeve" action that opens the member's
   * still library — never a generate-still call. */
  onOpenSleeve?: () => void;
  sleeveAvailable?: boolean;
}

/**
 * Shared Upload/Generate popover — used both for an *empty* plate tile's
 * inline menu and for the lightbox's "Replace" panel (same choice, same
 * shape, so they don't drift). Per Stuart's redesign: a top bar with the
 * dismiss "×" on the left and Upload (icon-only) on the right, opposite
 * each other; "Use last plate" (only when there's a still to continue
 * from) sits below that; Generate is the one primary action, centered on
 * its own row. The surface itself is a **fully opaque** `bg-zinc-950` —
 * no `/95` alpha, no `backdrop-blur` — specifically because the previous
 * translucent+blurred version let whatever sat behind it (the shot
 * prompt textarea, other tiles) bleed/ghost through.
 */
function SkidmarksPlatePopover({
  size = "md",
  previousStill,
  useLastPlate,
  onSetUseLastPlate,
  onUpload,
  onGenerate,
  onSiray,
  onDismiss,
  onOpenSleeve,
  sleeveAvailable,
}: SkidmarksPlatePopoverProps) {
  const dense = size === "sm";
  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      className={[
        "flex w-full flex-col rounded-xl bg-zinc-950 ring-1 ring-white/10",
        dense ? "gap-1.5 p-1.5" : "gap-2 p-2.5",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          className={[
            "flex items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white",
            dense ? "h-5 w-5" : "h-6 w-6",
          ].join(" ")}
        >
          <CloseIcon className={dense ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </button>
        <button
          type="button"
          onClick={onUpload}
          aria-label="Upload a still"
          className={[
            "flex items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white",
            dense ? "h-5 w-5" : "h-6 w-6",
          ].join(" ")}
        >
          <UploadIcon className={dense ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </button>
      </div>

      {previousStill && (
        <label
          className={[
            "flex items-center justify-center gap-1.5 text-white/60",
            dense ? "text-[10px]" : "text-[11px]",
          ].join(" ")}
        >
          <input
            type="checkbox"
            checked={useLastPlate}
            onChange={(e) => onSetUseLastPlate(e.target.checked)}
            className="h-3 w-3 accent-rose-400"
          />
          Use last plate
        </label>
      )}

      {sleeveAvailable && onOpenSleeve && (
        <button
          type="button"
          onClick={onOpenSleeve}
          className={[
            "mx-auto rounded-full border border-white/15 bg-white/[0.04] font-medium text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white",
            dense ? "px-4 py-1.5 text-[11px]" : "px-5 py-2 text-[12px]",
          ].join(" ")}
        >
          From sleeve
        </button>
      )}

      <button
        type="button"
        onClick={onGenerate}
        className={[
          "mx-auto rounded-full bg-rose-400 font-semibold text-zinc-950 transition-colors hover:bg-rose-300",
          dense ? "px-4 py-1.5 text-[11px]" : "px-5 py-2 text-[12px]",
        ].join(" ")}
      >
        Generate
      </button>

      {onSiray && (
        <button
          type="button"
          onClick={onSiray}
          title={`Siray spicy still · ~$${SIRAY_SEEDREAM_45_COST_USD.toFixed(2)}`}
          className={[
            "mx-auto rounded-full border border-rose-400/40 bg-rose-400/10 font-medium text-rose-200 transition-colors hover:bg-rose-400/20",
            dense ? "px-4 py-1.5 text-[11px]" : "px-5 py-2 text-[12px]",
          ].join(" ")}
        >
          {`Siray · $${SIRAY_SEEDREAM_45_COST_USD.toFixed(2)}`}
        </button>
      )}
    </div>
  );
}

interface SkidmarksPlateLightboxProps {
  dataUrl: string;
  previousStill?: SkidmarksPlateStill;
  /** Whether the tiny inline Replace panel (Upload/Generate, same two
   * options the empty-plate popover offers) is showing below the
   * enlarged image right now. */
  replaceOpen: boolean;
  generating: boolean;
  error: string | null;
  useLastPlate: boolean;
  onToggleReplace: () => void;
  onSetUseLastPlate: (value: boolean) => void;
  onUpload: () => void;
  onGenerate: () => void;
  onSiray?: () => void;
  onClear: () => void;
  onClose: () => void;
  statusNote?: string | null;
  onKeep?: () => void;
  keepLabel?: string;
  onOpenSleeve?: () => void;
  sleeveAvailable?: boolean;
  sleeveOpen?: boolean;
  sleeveEntries?: SkidmarksMemberSleeveEntry[];
  onPickSleeve?: (entry: SkidmarksMemberSleeveEntry) => void;
  onCloseSleeve?: () => void;
}

/**
 * Enlarge/lightbox view — a filled plate's primary tap opens this now
 * instead of the Upload/Generate popover, so Stuart can actually
 * inspect framing/light at real size. Just the enlarged still, a "×"
 * to dismiss (backdrop tap does the same), and a Replace/Clear row.
 * "Replace" swaps that row for the same Upload/Generate mini-panel the
 * empty-plate popover uses; all state/handlers still live in
 * `SkidmarksPlateBox`, passed down as props.
 *
 * **Portaled to `document.body`** (not rendered in place). This plate
 * lives deep inside `SkidmarksDetailSheet`'s `overflow-y-auto` scroll
 * body; on iOS Safari, a `position: fixed` element nested inside a
 * scrolling ancestor doesn't reliably escape it — the enlarged still
 * kept rendering *behind* the sheet's own chrome (Stuart's report,
 * after #39 only fixed the backdrop's opacity, not this). Portaling
 * out to `document.body` sidesteps that scroll-container/stacking
 * nesting entirely, and the `z-[999]` here only has to beat every
 * sheet/modal's own z-index (the detail sheets are `z-50`, the
 * artist-generate popup is `z-[60]`) since it's compared in the same
 * root stacking context as a `body`-level sibling either way.
 */
function SkidmarksPlateLightbox({
  dataUrl,
  previousStill,
  replaceOpen,
  generating,
  error,
  useLastPlate,
  onToggleReplace,
  onSetUseLastPlate,
  onUpload,
  onGenerate,
  onSiray,
  onClear,
  onClose,
  statusNote,
  onKeep,
  keepLabel,
  onOpenSleeve,
  sleeveAvailable,
  sleeveOpen,
  sleeveEntries,
  onPickSleeve,
  onCloseSleeve,
}: SkidmarksPlateLightboxProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // `SkidmarksPlateBox` only ever mounts this once `lightboxOpen` flips
  // true from a client-side click/keyboard handler — never during SSR —
  // so `document.body` is always available here; no mount-guard needed.
  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      {/* Solid, fully opaque scrim — no alpha, no blur. The previous
          `bg-black/90 backdrop-blur-sm` still let the sheet/strip behind
          it show through as a ghosted, blurred strip (Stuart's report);
          a flat `bg-black` covers it completely instead. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Plate still, enlarged"
        className="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 animate-[sheet-in_0.18s_ease-out]"
      >
        <div className="relative w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- data-URL still, next/image can't optimize it */}
          <img
            src={dataUrl}
            alt="Plate still, enlarged"
            className="max-h-[70vh] w-full rounded-2xl object-contain"
          />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-950 text-white/80 ring-1 ring-white/15 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            <CloseIcon />
          </button>

          {generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-black/70 text-[12px] font-medium text-white/85">
              <Spinner />
              {"Generating\u2026"}
            </div>
          )}
        </div>

        {!generating && sleeveOpen && sleeveEntries && onPickSleeve && (
          <div className="flex w-full flex-col gap-2 rounded-xl bg-zinc-950 p-2.5 ring-1 ring-white/10">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/70">Artist sleeve</p>
              <button
                type="button"
                onClick={onCloseSleeve}
                aria-label="Close sleeve"
                className="flex h-6 w-6 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {sleeveEntries.length === 0 ? (
              <p className="text-[11px] text-white/45">No stills kept yet — tap Keep on a plate still first.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch]">
                {sleeveEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onPickSleeve(entry)}
                    aria-label="Apply sleeve still to this plate"
                    className="h-16 w-20 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/15 transition hover:ring-rose-300/50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={entry.dataUrl} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!generating &&
          !sleeveOpen &&
          (replaceOpen ? (
            <SkidmarksPlatePopover
              size="md"
              previousStill={previousStill}
              useLastPlate={useLastPlate}
              onSetUseLastPlate={onSetUseLastPlate}
              onUpload={onUpload}
              onGenerate={onGenerate}
              onSiray={onSiray}
              onDismiss={onToggleReplace}
              onOpenSleeve={onOpenSleeve}
              sleeveAvailable={sleeveAvailable}
            />
          ) : (
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={onToggleReplace}
                className="flex-1 rounded-full bg-white/10 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
              >
                Replace
              </button>
              {onKeep && (
                <button
                  type="button"
                  onClick={onKeep}
                  className="flex-1 rounded-full border border-rose-400/35 bg-rose-400/10 px-3.5 py-2 text-sm font-medium text-rose-100 transition-colors hover:bg-rose-400/20"
                >
                  {keepLabel ?? "Keep"}
                </button>
              )}
              <button
                type="button"
                onClick={onClear}
                className="flex-1 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
              >
                Clear
              </button>
            </div>
          ))}

        {error && <p role="alert" className="text-[11px] leading-snug text-rose-300/90">{error}</p>}
        {!error && statusNote && (
          <p className="text-[11px] leading-snug text-emerald-300/90">{statusNote}</p>
        )}
      </div>
    </div>,
    document.body
  );
}

interface SkidmarksPlateBoxProps {
  plate: SkidmarksClipPlateSlot;
  previousStill?: SkidmarksPlateStill;
  shotPrompt: string;
  negativePrompt: string;
  vocal: boolean;
  model: SkidmarksModelId;
  bandName: string;
  bandId: string;
  vocalist?: SkidmarksMember;
  /** Only true for an *empty* slot when the clip has more than one —
   * removing a slot that already holds a real still is a separate,
   * more deliberate two-step (clear it first via the existing ×/
   * long-press, then remove the now-empty slot) rather than one tap
   * that could discard a real image by mistake. */
  canRemove: boolean;
  onSetStill: (still: SkidmarksPlateStill | null) => void;
  onRemove: () => void;
  /** Whether this plate is the one clip's Render control currently
   * targets (radio-style — see `lib/skidmarks.ts`'s
   * `resolveSelectedPlateId`), and whether it already has a saved
   * render. Only meaningful once the plate is filled — the corner
   * select control doesn't render on an empty plate. */
  selected: boolean;
  rendered: boolean;
  onSelect: () => void;
}

/** Small filled dot — "this is the plate Render will use next." */
function SelectDotIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-2.5 w-2.5">
      <circle cx="10" cy="10" r="6" />
    </svg>
  );
}

/** Small checkmark — "this plate already has a saved render." */
function TickIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-2.5 w-2.5">
      <path
        d="M4.5 10.5 8 14l7.5-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The one small corner control Stuart's per-plate select ask needed:
 * bottom-right on a filled plate tile, radio-style (tapping any plate's
 * dot selects *that* plate and implicitly deselects every other plate
 * on the same clip — there's no separate "deselect" state). Doubles as
 * the render tick: a plate that already has a saved render shows a
 * filled emerald check instead of a plain dot, whether or not it's also
 * the currently-selected one (selection and "already rendered" are
 * independent facts about a plate) — an unrendered, unselected plate
 * shows a faint empty ring, per Stuart's "empty mark = not rendered
 * yet" ask.
 *
 * **Live-QA hit-target fix**: Stuart reported that tapping this corner
 * opened the enlarge lightbox instead of selecting the plate — and, on
 * an already-filled plate, sometimes cleared the still entirely instead
 * of selecting it. Root-caused by actually reproducing the exact DOM/
 * CSS shape in a headless-browser click test (a precise tap dead-center
 * on the control already routed correctly to *this* button, not the
 * tile beneath it, even before this fix — the two are DOM *siblings*,
 * not nested, so the tile's own `onClick` was never reachable via
 * bubbling from here regardless of `stopPropagation`). The real gap:
 * this control's actual tappable box was only the ~20px visible dot —
 * well under Apple's ~44pt HIG minimum touch target — sitting right at
 * the tile's own extreme corner, exactly where a thumb's contact point
 * is least precise. A tap that missed by even a few px landed on the
 * tile *underneath* instead: a short miss opened the lightbox (a plain
 * tap on the tile); a miss held a beat too long — very easy while a
 * thumb hunts for a tiny corner target — fired the tile's own
 * press-and-hold-to-clear timer instead, deleting the still. Both of
 * Stuart's symptoms are explained by the one same root cause. The fix
 * is a real, `h-10 w-10` (~40px) invisible hit area anchored flush in
 * the tile's own corner — comfortably inside its `h-32 w-40` bounds, so
 * it never spills into a neighboring plate tile in the horizontal strip
 * — wrapping the *same* small, unchanged-size visible dot/tick as an
 * inner `<span>`. `stopPropagation` stays on the click handler as
 * defense-in-depth against a future refactor that nests these
 * differently, even though it isn't what's fixing today's bug.
 */
function SkidmarksPlateSelectControl({
  selected,
  rendered,
  onSelect,
}: {
  selected: boolean;
  rendered: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerDown={(e) => {
        // Belt-and-suspenders: a tap that starts here should never be
        // able to also start the tile's own press-and-hold-clear timer
        // underneath, however these two elements get nested in the
        // future.
        e.stopPropagation();
      }}
      aria-pressed={selected}
      aria-label={
        rendered
          ? selected
            ? "Selected for Render — already has a saved render"
            : "Already has a saved render — tap to select for Render"
          : selected
            ? "Selected for Render"
            : "Tap to select this plate for Render"
      }
      className="absolute bottom-0 right-0 z-10 flex h-10 w-10 items-center justify-center"
    >
      <span
        className={[
          "flex h-5 w-5 items-center justify-center rounded-full ring-1 transition-colors",
          rendered
            ? "bg-emerald-400/90 text-zinc-950 ring-emerald-300/60"
            : selected
              ? "bg-rose-400 text-zinc-950 ring-rose-300/60"
              : "bg-black/60 text-white/40 ring-white/20",
        ].join(" ")}
      >
        {rendered ? <TickIcon /> : selected ? <SelectDotIcon /> : null}
      </span>
    </button>
  );
}

/**
 * One plate slot in a clip's horizontal strip. Empty plate: tap opens
 * the Upload/Generate popover (unchanged). Filled plate: tap opens
 * `SkidmarksPlateLightbox` instead; the corner "×" and press-and-hold
 * clear stay on the tile as before, plus the new bottom-right select/
 * tick control (see `SkidmarksPlateSelectControl`).
 */
function SkidmarksPlateBox({
  plate,
  previousStill,
  shotPrompt,
  negativePrompt,
  vocal,
  model,
  bandName,
  bandId,
  vocalist,
  canRemove,
  onSetStill,
  onRemove,
  selected,
  rendered,
  onSelect,
}: SkidmarksPlateBoxProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [sleeveOpen, setSleeveOpen] = useState(false);
  const [useLastPlate, setUseLastPlate] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Generating…");
  const [error, setError] = useState<string | null>(null);
  const [keepNote, setKeepNote] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const hasStill = !!plate.still;

  const closeMenu = () => {
    setMenuOpen(false);
    setSleeveOpen(false);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setMenuOpen(false);
    setSleeveOpen(false);
    setError(null);
    setKeepNote(null);
  };

  const sleeveEntries = resolveMemberStillSleeve(vocalist);
  const sleeveAvailable = !!vocalist && sleeveEntries.length > 0;
  const alreadyKept =
    !!plate.still && !!vocalist && urlIsInMemberSleeve(vocalist, plate.still.dataUrl);

  const handleOpenSleeve = () => {
    setError(null);
    setMenuOpen(false);
    setSleeveOpen(true);
  };

  const handlePickSleeve = (entry: SkidmarksMemberSleeveEntry) => {
    // Free apply — never calls generate-still.
    onSetStill(buildLibraryPlateStill(entry.dataUrl));
    flushSkidmarksSessionNow();
    setSleeveOpen(false);
    setMenuOpen(false);
    setError(null);
  };

  const handleKeep = () => {
    if (!vocalist || !plate.still) return;
    if (urlIsInMemberSleeve(vocalist, plate.still.dataUrl)) {
      setKeepNote("In sleeve");
      return;
    }
    keepSkidmarksMemberSleeveStill(bandId, vocalist.id, plate.still.dataUrl);
    flushSkidmarksSessionNow();
    setKeepNote("Kept");
  };

  const handleBoxClick = () => {
    if (generating) return;
    if (longPressFiredRef.current) {
      // The press-and-hold clear already fired for this gesture — the
      // browser's own trailing click shouldn't also reopen anything on
      // an image that no longer exists.
      longPressFiredRef.current = false;
      return;
    }
    setError(null);
    // Filled plate: primary tap enlarges (the lightbox owns Replace/
    // Clear from there — see `SkidmarksPlateLightbox`). Empty plate:
    // unchanged, tap opens the tiny Upload/Generate popover right here.
    if (hasStill) {
      setLightboxOpen(true);
    } else {
      setMenuOpen((v) => !v);
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const [confirmClear, setConfirmClear] = useState(false);
  /** Every remove/clear goes through the in-app confirm first
   * (2026-09-16 ask: no delete without an "are you sure"). */
  const handleClear = () => setConfirmClear(true);
  const performClear = () => {
    setConfirmClear(false);
    onSetStill(null);
    setMenuOpen(false);
    setLightboxOpen(false);
    setError(null);
  };

  const startLongPress = () => {
    longPressFiredRef.current = false;
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressFiredRef.current = true;
      handleClear();
    }, LONG_PRESS_MS);
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets picking the exact same file again still fire onChange
    if (!file) return;
    setBusyLabel("Saving…");
    setGenerating(true);
    setError(null);
    try {
      // Uploads the picked file straight to Vercel Blob (no base64
      // round trip needed — a real `File` is already what `upload()`
      // wants) so the session's Neon PUT only ever stores this still's
      // URL, not its full bytes — see `lib/plateStillBlob.ts`'s module
      // doc comment for the real 413 this fixes.
      const outcome = await uploadSkidmarksPlateStill(file);
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      onSetStill({ dataUrl: outcome.url, source: "upload", createdAt: Date.now() });
      // Real live bug (2026-09-14): Stuart generated real plates, then
      // did a "cold restart" shortly after, and they were gone on
      // reload — consistent with this write still sitting in the
      // session's normal 600ms-debounced save when his phone/Safari
      // actually died. Flushing right now, rather than waiting on that
      // debounce or on backgrounding to fire it, shrinks that window to
      // as close to zero as this app can get.
      flushSkidmarksSessionNow();
      closeMenu();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setGenerating(false);
      setBusyLabel("Generating…");
    }
  };

  const handleGenerate = async () => {
    const trimmedPrompt = shotPrompt.trim();
    if (!trimmedPrompt) {
      setError("Add a shot prompt first \u2014 Generate needs something to go on.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      // A resolved vocalist's `avatarImage` may be a relative asset path
      // (the seeded Jack Ash reference photo — see `SEED_BANDS` in
      // `lib/skidmarks.ts`) rather than an already-a-`data:` URL upload;
      // `buildPlateGenerationRequest` only ever forwards `avatarImage` as
      // a reference verbatim, so it has to already be a real `data:` URL
      // by the time it gets there. Resolved regardless of `vocal` — an
      // Instrumental clip naming a locked character needs this too (see
      // `characterInFrame` in `buildPlateGenerationRequest`); resolving
      // an already-`data:` URL is a fast no-op either way.
      let resolvedVocalist = vocalist;
      if (vocalist?.avatarImage) {
        const identityDataUrl = await resolvePlateReferenceDataUrl(vocalist.avatarImage);
        resolvedVocalist = { ...vocalist, avatarImage: identityDataUrl };
      }

      // `previousStill.dataUrl` is a real Blob URL as of 2026-09-14
      // (`lib/plateStillBlob.ts`), not a base64 `data:` URL — resolve it
      // the same way `vocalist.avatarImage` just was, a fast no-op for a
      // still saved before that change (still a literal `data:` URL).
      const continuityStillDataUrl =
        useLastPlate && previousStill ? await resolvePlateReferenceDataUrl(previousStill.dataUrl) : undefined;
      const requestParams = {
        shotPrompt: trimmedPrompt,
        vocal,
        model,
        bandName,
        vocalist: resolvedVocalist,
        continuityStillDataUrl,
        // Live-QA fix: only carry the locked-character lock forward from
        // continuity when the plate being continued from *itself*
        // already featured him — see `lib/skidmarks.ts`'s
        // `SkidmarksPlateStill.featuresLockedCharacter` doc comment.
        continuityFeaturesLockedCharacter: continuityStillDataUrl ? previousStill?.featuresLockedCharacter : undefined,
      };

      // **Lock the place before locking the person** (2026-09-19) — the
      // half of the original Skidmarks repo's plate call Deck never had.
      // A plate with a real artist to hold is composited: image 1 is an
      // empty still of the place, image 2 is the artist's own photo, and
      // the model is told to put that person into that picture rather
      // than to paint a scene from a paragraph describing one. See
      // `lib/plateGeneration.ts`'s `buildPlateGenerationRequest` for why
      // a paragraph always beat the photo before this, and
      // `lib/plateLocation.ts` for the cost (one extra cheap still per
      // scene, cached for the whole clip strip and every re-generate).
      //
      // Skipped entirely when there's a continuity plate to continue
      // from (that *is* the locked place), and for a plate with nobody
      // in it — person-less B-roll has nothing to drift, so it still
      // costs exactly one call and its prompt is unchanged.
      let locationStillDataUrl: string | undefined;
      if (!continuityStillDataUrl && plateGenerationHoldsIdentity(requestParams)) {
        setBusyLabel("Locking the place\u2026");
        const location = await resolveLocationStill({ sceneText: trimmedPrompt, bandName });
        if (!location.ok || !location.dataUrl) {
          setError(
            location.message
              ? `Couldn't lock this shot's place, so the artist wasn't plated \u2014 ${location.message}`
              : "Couldn't lock this shot's place, so the artist wasn't plated."
          );
          return;
        }
        locationStillDataUrl = location.dataUrl;
        setBusyLabel("Generating\u2026");
      }

      const request = buildPlateGenerationRequest({ ...requestParams, locationStillDataUrl });

      const outcome = await generatePlateStill(request);
      if (outcome.ok) {
        // xAI's own raw response has no size cap — see
        // `downscaleDataUrlImage`'s doc comment for why this app never
        // used to bound it the way an *uploaded* still already was
        // (`readImageFileAsDataUrl`), and why that gap is the real fix
        // for a live-QA'd "plates wiped" report. Falls back to the
        // untouched original if downscaling itself fails for any
        // reason — a still Stuart just paid for should never be
        // dropped over a client-side re-encode hiccup.
        let dataUrl = outcome.dataUrl;
        try {
          dataUrl = await downscaleDataUrlImage(outcome.dataUrl);
        } catch {
          // Keep the original, full-size dataUrl — see comment above.
        }
        // Uploads to Blob so the session's Neon PUT stores this still's
        // URL, not its full base64 bytes (see `lib/plateStillBlob.ts`'s
        // module doc comment for the 413 this fixes). A still Stuart
        // just paid xAI/Siray for should never be dropped over a Blob
        // hiccup — falls back to keeping it inline this session (usable
        // now, just won't survive a save until regenerated) rather than
        // losing it.
        setBusyLabel("Saving…");
        const uploadOutcome = await uploadSkidmarksPlateStill(dataUrl);
        onSetStill({
          dataUrl: uploadOutcome.ok ? uploadOutcome.url : dataUrl,
          source: "generated",
          createdAt: Date.now(),
          featuresLockedCharacter: request.featuresLockedCharacter,
        });
        if (!uploadOutcome.ok) {
          setError(`Generated, but couldn't save it for persistence yet — ${uploadOutcome.message}`);
        }
        // See the matching comment in `handleFileChange` above — flush
        // immediately rather than trust the debounce/backgrounding flush
        // to catch a real still before a "cold restart."
        flushSkidmarksSessionNow();
        closeMenu();
      } else {
        setError(outcome.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the reference image for generation.");
    } finally {
      setGenerating(false);
      setBusyLabel("Generating…");
    }
  };

  /** Per-clip Siray spicy still (~$0.04). Optional reference = "Use last
   * plate" continuity or this plate's existing still; otherwise text-only
   * t2i. Character lock only when the shot prompt names them (#170). */
  const handleSiray = async () => {
    const trimmedPrompt = shotPrompt.trim();
    if (!trimmedPrompt) {
      setError("Add a shot prompt first \u2014 Siray needs something to go on.");
      return;
    }
    setGenerating(true);
    setBusyLabel("Siray\u2026");
    setError(null);
    try {
      let resolvedVocalist = vocalist;
      if (vocalist?.avatarImage) {
        try {
          const identityDataUrl = await resolvePlateReferenceDataUrl(vocalist.avatarImage);
          resolvedVocalist = { ...vocalist, avatarImage: identityDataUrl };
        } catch {
          resolvedVocalist = vocalist;
        }
      }

      const prompt = buildSirayClipStillPrompt({
        shotPrompt: trimmedPrompt,
        negativePrompt,
        vocalist: resolvedVocalist,
      });

      let referenceDataUrl: string | undefined;
      const rawRef =
        useLastPlate && previousStill
          ? previousStill.dataUrl
          : plate.still?.dataUrl;
      if (rawRef) {
        try {
          referenceDataUrl = await resolvePlateReferenceDataUrl(rawRef);
        } catch {
          referenceDataUrl = undefined;
        }
      }

      const outcome = await generatePlateStillViaSiray(prompt, referenceDataUrl);
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }

      let dataUrl = outcome.dataUrl;
      try {
        dataUrl = await downscaleDataUrlImage(outcome.dataUrl);
      } catch {
        // Keep the original — same as Generate.
      }
      setBusyLabel("Saving\u2026");
      const uploadOutcome = await uploadSkidmarksPlateStill(dataUrl);
      onSetStill({
        dataUrl: uploadOutcome.ok ? uploadOutcome.url : dataUrl,
        source: "generated",
        createdAt: Date.now(),
        featuresLockedCharacter: Boolean(
          resolvedVocalist && shotPromptMentionsLockedCharacter(trimmedPrompt, resolvedVocalist)
        ),
      });
      if (!uploadOutcome.ok) {
        setError(`Generated, but couldn't save it for persistence yet — ${uploadOutcome.message}`);
      }
      flushSkidmarksSessionNow();
      closeMenu();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Siray still failed.");
    } finally {
      setGenerating(false);
      setBusyLabel("Generating\u2026");
    }
  };

  return (
    <div className="flex w-40 shrink-0 flex-col gap-1">
      <div className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={handleBoxClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleBoxClick();
            }
          }}
          onPointerDown={hasStill ? startLongPress : undefined}
          onPointerUp={hasStill ? clearLongPressTimer : undefined}
          onPointerLeave={hasStill ? clearLongPressTimer : undefined}
          onPointerCancel={hasStill ? clearLongPressTimer : undefined}
          aria-label={
            hasStill
              ? "Plate still \u2014 tap to enlarge, press and hold to remove"
              : "Empty plate \u2014 tap to upload or generate a still"
          }
          className={[
            // `touch-pan-x` (not `touch-none`): keeps vertical/pinch
            // gestures suppressed for a reliable press-and-hold, but
            // still lets a horizontal drag scroll the strip \u2014
            // `touch-none` was blocking that scroll on iOS Safari
            // whenever a drag started on a tile (the whole strip's
            // touchable surface).
            "relative flex h-32 w-40 touch-pan-x select-none items-center justify-center overflow-hidden rounded-2xl",
            hasStill
              ? "border border-white/10 bg-white/[0.02]"
              : "border border-dashed border-white/15 bg-white/[0.02] text-white/20",
          ].join(" ")}
        >
          {hasStill && (
            // `draggable={false}` + `pointer-events-none`: a plain <img> is
            // natively draggable, and a mouse-down-then-tiny-move during a
            // press-and-hold can trigger the browser's own image drag
            // instead of completing the long-press gesture below — the img
            // is purely decorative here, so every pointer/mouse event
            // should reach the parent `role="button"` div untouched.
            // eslint-disable-next-line @next/next/no-img-element -- data-URL still, next/image can't optimize it
            <img
              src={plate.still!.dataUrl}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
          )}
          {!hasStill && !generating && (
            // A bare icon read as decorative, not tappable — Stuart's own
            // live-QA report: he didn't know tapping this opened the
            // Upload/Generate popover below. One tiny label fixes that.
            <div className="flex flex-col items-center gap-1">
              <EmptyStillIcon />
              <span className="text-[9px] font-medium uppercase tracking-wide text-white/25">Tap to add</span>
            </div>
          )}
          {generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 text-[11px] font-medium text-white/85">
              <Spinner />
              {busyLabel}
            </div>
          )}
        </div>

        {hasStill && !generating && (
          <button
            type="button"
            aria-label="Remove still"
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/80 ring-1 ring-white/15 transition-colors hover:bg-black/90 hover:text-white"
          >
            <ClearIcon />
          </button>
        )}

        {hasStill && !generating && (
          <SkidmarksPlateSelectControl selected={selected} rendered={rendered} onSelect={onSelect} />
        )}

        {/* Real visible proof the last-frame chaining (2026-09-14,
            Stuart's ask) actually ran on this plate — it was silent
            before, and Stuart's own reasonable pushback ("how do I know
            this is going to work?") is exactly why this exists now. Only
            ever shown on a still `resolveChainedPlateTarget`
            (`lib/skidmarks.ts`) actually auto-filled, never claimed for
            an upload or a manual Generate. */}
        {hasStill && !generating && plate.still!.source === "chained" && (
          // Left-aligned and capped short of the tile's own bottom-right
          // select control (`SkidmarksPlateSelectControl`, a 40x40 tap
          // target right there) so the two never overlap on this tile's
          // tight 128x96 footprint.
          <span
            className="absolute bottom-1.5 left-1.5 z-10 max-w-[74px] truncate rounded-full bg-black/70 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-emerald-300 ring-1 ring-white/15"
            title="Auto-filled from the previous clip's last rendered frame"
          >
            From last clip
          </span>
        )}

        {!hasStill && !generating && canRemove && (
          <button
            type="button"
            aria-label="Remove this empty plate"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/60 ring-1 ring-white/15 transition-colors hover:bg-black/90 hover:text-white"
          >
            <ClearIcon />
          </button>
        )}

        {/* Anchored right on the strip — only for the *empty*-plate
            popover. A filled plate's Upload/Generate now lives inside
            the lightbox instead (`menuOpen` doubles as that panel's
            open state there too — see the lightbox render below). */}
        {!hasStill && sleeveOpen && !generating && (
          <div className="absolute inset-x-1.5 bottom-1.5 z-10 rounded-xl bg-zinc-950 p-1.5 ring-1 ring-white/10">
            <div className="mb-1 flex items-center justify-between px-0.5">
              <span className="text-[9px] font-medium text-white/60">Sleeve</span>
              <button
                type="button"
                onClick={() => setSleeveOpen(false)}
                aria-label="Close sleeve"
                className="flex h-5 w-5 items-center justify-center rounded-full text-white/50 hover:bg-white/10"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {sleeveEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePickSleeve(entry);
                  }}
                  className="h-12 w-14 shrink-0 overflow-hidden rounded-md ring-1 ring-white/15"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={entry.dataUrl} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Portaled sheet — never nest the Upload/Generate/Siray menu
            inside the tiny plate tile. Live phone QA (2026-09-24, ~390px):
            From sleeve / Generate / Siray · $0.04 rendered inside the
            tile and got clipped by the strip's overflow. Same
            document.body portal pattern as the lightbox. */}
        {!hasStill && menuOpen && !sleeveOpen && !generating &&
          createPortal(
            <div className="fixed inset-0 z-[999] flex items-end justify-center p-4 sm:items-center">
              <button
                type="button"
                aria-label="Close"
                onClick={closeMenu}
                className="absolute inset-0 bg-black/80"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Add a plate still"
                className="relative z-10 w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <SkidmarksPlatePopover
                  size="md"
                  previousStill={previousStill}
                  useLastPlate={useLastPlate}
                  onSetUseLastPlate={setUseLastPlate}
                  onUpload={handleUploadClick}
                  onGenerate={handleGenerate}
                  onSiray={handleSiray}
                  onDismiss={closeMenu}
                  onOpenSleeve={handleOpenSleeve}
                  sleeveAvailable={sleeveAvailable}
                />
              </div>
            </div>,
            document.body
          )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      {error && !lightboxOpen && (
        <p role="alert" className="text-[10px] leading-snug text-rose-300/90">
          {error}
        </p>
      )}

      <SkidmarksConfirmDialog
        open={confirmClear}
        title="Remove this still?"
        body="The picture on this plate will be cleared. Any render already made from it stays on the shelf. You can generate or upload a new one after."
        confirmLabel="Remove still"
        onCancel={() => setConfirmClear(false)}
        onConfirm={performClear}
      />

      {hasStill && lightboxOpen && (
        <SkidmarksPlateLightbox
          dataUrl={plate.still!.dataUrl}
          previousStill={previousStill}
          replaceOpen={menuOpen}
          generating={generating}
          error={error}
          statusNote={keepNote}
          useLastPlate={useLastPlate}
          onToggleReplace={() => {
            setError(null);
            setKeepNote(null);
            setSleeveOpen(false);
            setMenuOpen((v) => !v);
          }}
          onSetUseLastPlate={setUseLastPlate}
          onUpload={handleUploadClick}
          onGenerate={handleGenerate}
          onSiray={handleSiray}
          onClear={handleClear}
          onClose={closeLightbox}
          onKeep={vocalist ? handleKeep : undefined}
          keepLabel={alreadyKept ? "In sleeve" : "Keep"}
          onOpenSleeve={handleOpenSleeve}
          sleeveAvailable={sleeveAvailable}
          sleeveOpen={sleeveOpen}
          sleeveEntries={sleeveEntries}
          onPickSleeve={handlePickSleeve}
          onCloseSleeve={() => setSleeveOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * A clip's expanded body — a **horizontal strip of plate slots** plus
 * one shared shot-prompt textarea, per Stuart's live-QA chrome lock
 * (see the doc comment on the earlier, since-deleted
 * `SkidmarksPlatesAndCamera`, and `SkidmarksClipTimeline`'s doc
 * comment). Originally this panel held exactly one plate; it's back to
 * more than one **only** because a single 40-second Instrumental clip
 * (Stuart's "door → keyhole → Jack seated" case) needs a different
 * still per beat without splitting that clip into several separate
 * timeline rows — the fix scoped as small as it could be: an
 * independently expandable/plate-able *strip* on the same one clip,
 * not a second timeline concept.
 *
 * **First use / empty state is unchanged**: a fresh clip still shows
 * exactly one dashed empty plate, and tapping it still opens the tiny
 * Upload/Generate popover right there. **A filled plate's primary tap
 * now opens `SkidmarksPlateLightbox`** (a fullscreen enlarge view) so
 * Stuart can inspect the still at real size — Replace/Clear moved into
 * the lightbox rather than being lost. The corner "×" and
 * press-and-hold clear stay on the strip tile as before. **"+" appends
 * one more empty slot** to the strip
 * (`addSkidmarksClipPlate`, capped at `MAX_PLATES_PER_CLIP`) so Stuart
 * can generate/upload a different still into it — a scroll strip, not a
 * grid, keeps this from turning into a location-card layout. An empty
 * slot beyond the first can also be removed outright (a small "×" in
 * its *other* corner) to undo an accidental "+" — but only while it's
 * still empty; removing a slot that already holds a real still means
 * clearing it first, so one tap can never discard a generated/uploaded
 * image by accident.
 *
 * **iOS Safari horizontal-scroll fix**: each tile had `touch-action:
 * none` (Tailwind's `touch-none`), which blocks *all* native panning
 * starting on that tile — including the horizontal drag needed to
 * reach the 3rd plate/"+". Swapped to `touch-pan-x` (still blocks
 * vertical/pinch so the press-and-hold stays reliable) plus
 * `overscroll-x-contain` + `-webkit-overflow-scrolling: touch` on the
 * strip container.
 *
 * **One shared shot prompt for the whole clip, not one per plate** —
 * Stuart's explicit preference: editing the prompt before tapping
 * Generate on whichever slot is enough to get different content per
 * plate (each generated still already bakes in whatever the prompt said
 * *at generation time*), so a second prompt field per slot would just
 * repeat the same control for no real gain. See `lib/skidmarks.ts`'s
 * `SkidmarksClipSegment` doc comment for the same reasoning in the data
 * layer.
 *
 * **Continuity**: the "Use last plate" checkbox in each slot's Generate
 * popover only appears when there's something to continue from — for
 * any slot after the first *in this same clip's strip*, that's the
 * still-slot right before it (so door → keyhole → Jack, all under one
 * clip, can hold the same scene across shots); for the strip's very
 * first slot, it's the previous *clip's* last plate instead (threaded
 * down from `SkidmarksClipTimeline` as `previousStill`) — same
 * cross-clip continuity the single-plate build already had.
 *
 * Model choice (`segment.model`) still isn't rendered as a badge/pill
 * anywhere in this panel (Stuart's chrome lock stands) — it only steers
 * this same xAI call's prompt phrasing under the hood, see
 * `lib/plateGeneration.ts`'s `routingFramingHint`. **Separately**, an
 * Instrumental clip's *video-render* backend (H3 vs. Grok — a genuinely
 * different field, `segment.instrumentalVideoModel`, see
 * `lib/skidmarks.ts`'s `SkidmarksInstrumentalVideoModel` for why it's
 * not the same field as `model`) has exactly one real switch, added on
 * Stuart's explicit ask: two small buttons *inside*
 * `SkidmarksClipRender`'s own two-tap Render confirm step, not
 * anywhere on this strip.
 *
 * **Per-plate select rework**: each filled plate tile now also carries
 * a small bottom-right corner control (`SkidmarksPlateSelectControl`) —
 * tap it to pick which single plate this clip's one Render control
 * below the strip actually animates next (radio-style; a filled emerald
 * check instead means that exact plate already has a saved render,
 * independent of whether it's also currently selected). This clip's
 * `SkidmarksClipRender` no longer receives every plate's still at
 * once — just the resolved selection's own still, motion text, and
 * auto-computed duration (`lib/clipGeneration.ts`'s
 * `computePlateDurationSec`, `segmentLengthSec / plateCount` clamped
 * 5–15s). See `lib/skidmarks.ts`'s `resolveSelectedPlateId` for exactly
 * how "nothing explicitly selected yet" resolves (first unrendered
 * filled plate, or first filled plate — never mysteriously nothing).
 *
 * **Clip start/end edit** lives in the clip row's own always-visible
 * header now, not here — `SkidmarksClipTimeline.tsx`'s
 * `SkidmarksClipTimingHeaderEdit`, double-tap either number to edit it.
 * It used to be a compact −1s/+1s stepper opening this expanded panel
 * (`SkidmarksClipTimingNudge`); removed 2026-09-13 on Stuart's "I hate
 * seeing big buttons like this and wasting great real estate" ask — see
 * `SkidmarksClipTimeline`'s own doc comment for the full story.
 */
export function SkidmarksClipStub({
  segment,
  band,
  previousStill,
  onSetShotPrompt,
  onSetNegativePrompt,
  onSetPlateStill,
  onAddPlate,
  onRemovePlate,
  onSelectPlate,
  onSetPlateMotionPrompt,
  onSetPlateLastSent,
  onSetClipInstrumentalModel,
  renderedPlateIds,
  renderLocked,
  onRenderStart,
  onRenderEnd,
  clipIndex,
  onPersisted,
  mp3AudioUrl,
}: SkidmarksClipStubProps) {
  const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label].vocal;
  // Resolved regardless of `vocal` now — an Instrumental/B-roll clip
  // that names a *locked* character (Jack Ash) in its own shot prompt
  // still needs this to carry his identity ref + hallmark lock (see
  // `buildPlateGenerationRequest`'s `characterInFrame`); a generic
  // Instrumental clip that never names a locked character still never
  // auto-features/locks anyone, so resolving this here is harmless.
  const vocalist = resolveVocalistForPrompt(band.members);
  const canAddPlate = segment.plates.length < MAX_PLATES_PER_CLIP;

  // The per-plate select rework's own resolution — see
  // `resolveSelectedPlateId`'s doc comment for the fallback order
  // ("first unrendered filled plate, or first filled" — never fails
  // mysteriously with nothing selected as long as *something* is
  // filled).
  const selectedPlateId = resolveSelectedPlateId(segment.plates, segment.selectedPlateId, renderedPlateIds);
  const selectedPlateIndex = segment.plates.findIndex((p) => p.id === selectedPlateId);
  const selectedPlate = selectedPlateIndex >= 0 ? segment.plates[selectedPlateIndex] : undefined;
  const plateCount = segment.plates.length;
  // Only ever read on the Instrumental path — see
  // `SkidmarksClipRender`'s own `instrumentalVideoModel` doc comment.
  const instrumentalVideoModel = resolveInstrumentalVideoModel(segment.instrumentalVideoModel);
  // Vocal clips route to Comfy Cloud LTX (real [5, 15]s ceiling — see
  // `lib/clipGeneration.ts`'s module doc comment's "History of this
  // ceiling" note); Instrumental ones keep Grok's real [5, 15]s ceiling
  // too — the two ranges are the same now.
  const durationSec = vocal
    ? computeLtxPlateDurationSec(segment.endSec - segment.startSec, plateCount, Math.max(0, selectedPlateIndex))
    : computePlateDurationSec(segment.endSec - segment.startSec, plateCount, Math.max(0, selectedPlateIndex));

  return (
    <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-3">
      {/* `-webkit-overflow-scrolling:touch` + `overscroll-x-contain`
          for reliable iOS Safari momentum scroll on this strip. */}
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch]">
        {segment.plates.map((plate, i) => (
          <SkidmarksPlateBox
            key={plate.id}
            plate={plate}
            previousStill={i > 0 ? segment.plates[i - 1].still : previousStill}
            shotPrompt={segment.shotPrompt}
            negativePrompt={segment.negativePrompt}
            vocal={vocal}
            model={segment.model}
            bandName={band.name}
            bandId={band.id}
            vocalist={vocalist}
            canRemove={segment.plates.length > 1}
            onSetStill={(still) => onSetPlateStill(plate.id, still)}
            onRemove={() => onRemovePlate(plate.id)}
            selected={plate.id === selectedPlateId}
            rendered={renderedPlateIds.has(plate.id)}
            onSelect={() => onSelectPlate(plate.id)}
          />
        ))}

        {canAddPlate && (
          <button
            type="button"
            onClick={onAddPlate}
            aria-label="Add another plate to this clip"
            className="flex h-24 w-10 shrink-0 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-white/40 transition-colors hover:border-white/30 hover:text-white/70"
          >
            <PlusIcon />
          </button>
        )}
      </div>

      <textarea
        value={segment.shotPrompt}
        onChange={(e) => onSetShotPrompt(e.target.value)}
        placeholder="What happens in this shot?"
        rows={3}
        maxLength={SHOT_PROMPT_MAX_LENGTH}
        aria-label="Shot prompt"
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] leading-relaxed text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
      />

      <textarea
        value={segment.negativePrompt}
        onChange={(e) => onSetNegativePrompt(e.target.value)}
        placeholder="Keep out of this shot (optional) — only sent on a Singing clip, not Mute"
        rows={2}
        maxLength={SHOT_PROMPT_MAX_LENGTH}
        aria-label="Negative prompt"
        title="Only reaches the video model on a Singing (Vocal) clip — Mute (Instrumental) clips have no negative-prompt channel to send this on."
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-white/80 placeholder:text-white/25 focus:border-rose-400/40 focus:outline-none"
      />

      {selectedPlate && (
        // `key={selectedPlate.id}` forces a full remount when Stuart
        // switches which plate is selected — a stale "just rendered"
        // flash, in-flight confirm step, or error message from the
        // *previous* selected plate should never linger under a
        // different plate's controls; a fresh mount is the simplest,
        // most reliable way to guarantee that (React's own recommended
        // "reset state on a meaningfully different identity" pattern).
        <SkidmarksClipRender
          key={selectedPlate.id}
          shotPrompt={segment.shotPrompt}
          negativePrompt={segment.negativePrompt}
          bandName={band.name}
          plateStillDataUrl={selectedPlate.still?.dataUrl ?? null}
          motionPrompt={selectedPlate.motionPrompt ?? ""}
          onSetMotionPrompt={(value) => onSetPlateMotionPrompt(selectedPlate.id, value)}
          lastSent={selectedPlate.lastSent}
          onSent={(sent) => onSetPlateLastSent(selectedPlate.id, sent)}
          durationSec={durationSec}
          vocal={vocal}
          instrumentalVideoModel={instrumentalVideoModel}
          onSetInstrumentalVideoModel={onSetClipInstrumentalModel}
          vocalist={vocalist}
          mp3AudioUrl={mp3AudioUrl}
          locked={renderLocked}
          onRenderStart={onRenderStart}
          onRenderEnd={onRenderEnd}
          segmentId={segment.id}
          plateId={selectedPlate.id}
          plateIndex={Math.max(0, selectedPlateIndex)}
          plateCount={plateCount}
          clipIndex={clipIndex}
          startSec={segment.startSec}
          endSec={segment.endSec}
          alreadyRendered={renderedPlateIds.has(selectedPlate.id)}
          onPersisted={onPersisted}
        />
      )}
    </div>
  );
}
