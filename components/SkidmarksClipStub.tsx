"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_PLATES_PER_CLIP,
  readImageFileAsDataUrl,
  SKIDMARKS_SEGMENT_LABEL_META,
  type SkidmarksBand,
  type SkidmarksClipPlateSlot,
  type SkidmarksClipSegment,
  type SkidmarksMember,
  type SkidmarksModelId,
  type SkidmarksPlateStill,
} from "@/lib/skidmarks";
import {
  buildPlateGenerationRequest,
  generatePlateStill,
  resolvePlateReferenceDataUrl,
  resolveVocalistForPrompt,
} from "@/lib/plateGeneration";

interface SkidmarksClipStubProps {
  segment: SkidmarksClipSegment;
  band: SkidmarksBand;
  /** The previous *clip's* last plate's still, if any — the continuity
   * reference for this clip's **first** plate slot only; every later
   * slot in this clip's own strip continues from the plate right before
   * it instead (see this component's doc comment). */
  previousStill?: SkidmarksPlateStill;
  onSetShotPrompt: (shotPrompt: string) => void;
  onSetPlateStill: (plateId: string, still: SkidmarksPlateStill | null) => void;
  onAddPlate: () => void;
  onRemovePlate: (plateId: string) => void;
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

/** Same spinner shape as `SkidmarksChecklistChips`' "analyzing" state —
 * one visual language for "real work in flight" across this feature. */
function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 animate-spin text-white/80">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
      <path d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

interface SkidmarksPlateBoxProps {
  plate: SkidmarksClipPlateSlot;
  previousStill?: SkidmarksPlateStill;
  shotPrompt: string;
  vocal: boolean;
  model: SkidmarksModelId;
  bandName: string;
  vocalist?: SkidmarksMember;
  /** Only true for an *empty* slot when the clip has more than one —
   * removing a slot that already holds a real still is a separate,
   * more deliberate two-step (clear it first via the existing ×/
   * long-press, then remove the now-empty slot) rather than one tap
   * that could discard a real image by mistake. */
  canRemove: boolean;
  onSetStill: (still: SkidmarksPlateStill | null) => void;
  onRemove: () => void;
}

/**
 * One plate slot in a clip's horizontal strip — the same
 * upload/generate/replace/clear box `SkidmarksClipStub` always had,
 * just scoped to one slot instead of the whole clip so several can sit
 * side by side (see that component's doc comment for why). All of this
 * box's interaction logic (the tiny Upload/Generate popover, the
 * press-and-hold clear, the spinner overlay) is unchanged from the
 * single-plate build — only the props feeding it (which still, which
 * continuity reference) now vary per slot instead of per clip.
 */
function SkidmarksPlateBox({
  plate,
  previousStill,
  shotPrompt,
  vocal,
  model,
  bandName,
  vocalist,
  canRemove,
  onSetStill,
  onRemove,
}: SkidmarksPlateBoxProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [useLastPlate, setUseLastPlate] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const hasStill = !!plate.still;

  const closeMenu = () => setMenuOpen(false);

  const handleBoxClick = () => {
    if (generating) return;
    if (longPressFiredRef.current) {
      // The press-and-hold clear already fired for this gesture — the
      // browser's own trailing click shouldn't also reopen the popover
      // on an image that no longer exists.
      longPressFiredRef.current = false;
      return;
    }
    setError(null);
    setMenuOpen((v) => !v);
  };

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleClear = () => {
    onSetStill(null);
    setMenuOpen(false);
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
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      onSetStill({ dataUrl, source: "upload", createdAt: Date.now() });
      closeMenu();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
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
      // by the time it gets there.
      let resolvedVocalist = vocalist;
      if (vocal && vocalist?.avatarImage) {
        const identityDataUrl = await resolvePlateReferenceDataUrl(vocalist.avatarImage);
        resolvedVocalist = { ...vocalist, avatarImage: identityDataUrl };
      }

      const request = buildPlateGenerationRequest({
        shotPrompt: trimmedPrompt,
        vocal,
        model,
        bandName,
        vocalist: resolvedVocalist,
        continuityStillDataUrl: useLastPlate ? previousStill?.dataUrl : undefined,
      });

      const outcome = await generatePlateStill(request);
      if (outcome.ok) {
        onSetStill({ dataUrl: outcome.dataUrl, source: "generated", createdAt: Date.now() });
        closeMenu();
      } else {
        setError(outcome.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the reference image for generation.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex w-32 shrink-0 flex-col gap-1">
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
              ? "Plate still \u2014 tap to replace, press and hold to remove"
              : "Empty plate \u2014 tap to upload or generate a still"
          }
          className={[
            // `touch-none`: without it, a real touchscreen can interpret the
            // start of a press-and-hold as the beginning of a scroll and
            // fire `pointercancel` before `LONG_PRESS_MS` elapses \u2014
            // disabling the browser's own touch gesture handling here is
            // what makes the hold reliable on a phone, not just a mouse.
            "relative flex h-24 w-32 touch-none select-none items-center justify-center overflow-hidden rounded-2xl",
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
          {!hasStill && !generating && <EmptyStillIcon />}
          {generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 text-[11px] font-medium text-white/85">
              <Spinner />
              {"Generating\u2026"}
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

        {menuOpen && !generating && (
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-1.5 bottom-1.5 z-10 flex flex-col gap-1.5 rounded-xl bg-zinc-950/95 p-1.5 ring-1 ring-white/10 backdrop-blur-sm"
          >
            {previousStill && (
              <label className="flex items-center gap-1.5 px-1 text-[10px] text-white/60">
                <input
                  type="checkbox"
                  checked={useLastPlate}
                  onChange={(e) => setUseLastPlate(e.target.checked)}
                  className="h-3 w-3 accent-rose-400"
                />
                Use last plate
              </label>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleUploadClick}
                className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/15"
              >
                Upload
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                className="flex-1 rounded-lg bg-rose-400 px-2 py-1.5 text-[11px] font-semibold text-zinc-950 transition-colors hover:bg-rose-300"
              >
                Generate
              </button>
            </div>
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      {error && <p role="alert" className="text-[10px] leading-snug text-rose-300/90">{error}</p>}
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
 * exactly one dashed empty plate, same style as before — nothing new
 * to look at until Stuart taps "+". Each plate slot keeps every gesture
 * the single-plate build already had (`SkidmarksPlateBox`, unchanged
 * logic): tapping the empty box opens the tiny Upload/Generate popover;
 * once a still exists, tapping it reopens that same popover (replace),
 * a corner "×" clears it back to empty, and a press-and-hold does the
 * same clear. **"+" appends one more empty slot** to the strip
 * (`addSkidmarksClipPlate`, capped at `MAX_PLATES_PER_CLIP`) so Stuart
 * can generate/upload a different still into it — a scroll strip, not a
 * grid, keeps this from turning into a location-card layout. An empty
 * slot beyond the first can also be removed outright (a small "×" in
 * its *other* corner) to undo an accidental "+" — but only while it's
 * still empty; removing a slot that already holds a real still means
 * clearing it first, so one tap can never discard a generated/uploaded
 * image by accident.
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
 * `lib/plateGeneration.ts`'s `routingFramingHint`.
 */
export function SkidmarksClipStub({
  segment,
  band,
  previousStill,
  onSetShotPrompt,
  onSetPlateStill,
  onAddPlate,
  onRemovePlate,
}: SkidmarksClipStubProps) {
  const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label].vocal;
  const vocalist = vocal ? resolveVocalistForPrompt(band.members) : undefined;
  const canAddPlate = segment.plates.length < MAX_PLATES_PER_CLIP;

  return (
    <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {segment.plates.map((plate, i) => (
          <SkidmarksPlateBox
            key={plate.id}
            plate={plate}
            previousStill={i > 0 ? segment.plates[i - 1].still : previousStill}
            shotPrompt={segment.shotPrompt}
            vocal={vocal}
            model={segment.model}
            bandName={band.name}
            vocalist={vocalist}
            canRemove={segment.plates.length > 1}
            onSetStill={(still) => onSetPlateStill(plate.id, still)}
            onRemove={() => onRemovePlate(plate.id)}
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
    </div>
  );
}
