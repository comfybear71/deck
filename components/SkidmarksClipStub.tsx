"use client";

import { useEffect, useRef, useState } from "react";
import {
  readImageFileAsDataUrl,
  SKIDMARKS_SEGMENT_LABEL_META,
  type SkidmarksBand,
  type SkidmarksClipSegment,
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
  previousStill?: SkidmarksPlateStill;
  onSetShotPrompt: (shotPrompt: string) => void;
  onSetStill: (still: SkidmarksPlateStill | null) => void;
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

/**
 * A clip's expanded body — one dashed-border plate placeholder (empty
 * until a still exists) and one shot-prompt textarea, per Stuart's
 * live-QA chrome lock (see the doc comment on the earlier, since-deleted
 * `SkidmarksPlatesAndCamera`, and `SkidmarksClipTimeline`'s doc comment).
 * Two real things now live in that one placeholder box, per Stuart's
 * follow-up ask after the chrome-lock pass shipped:
 *
 * 1. **Upload** — tapping the empty box opens a tiny two-option popover
 *    (Upload / Generate, no other chrome); Upload opens a real native
 *    `accept="image/*"` file picker and, once a file's picked, resizes it
 *    the same way the band cover/member avatar pickers already do
 *    (`readImageFileAsDataUrl`) and stores it as this clip's `still`.
 * 2. **Generate** — calls the one real image backend this build wires up,
 *    xAI's Grok Imagine API, via `lib/plateGeneration.ts`'s
 *    `buildPlateGenerationRequest` + `generatePlateStill`
 *    (`app/api/skidmarks/generate-still/route.ts`). Requires a non-empty
 *    `shotPrompt` first (there's nothing to generate from otherwise) —
 *    everything else (model-routing framing, vocalist auto-include,
 *    character locks, continuity) is automatic, no extra fields to fill
 *    in beyond the one **"Use last plate"** checkbox that only appears
 *    when the previous clip already has a still (see
 *    `buildPlateGenerationRequest`'s doc comment for exactly what that
 *    wires in). While a request is in flight, the box shows a spinner
 *    overlay (over the existing still, if this is a regenerate) instead
 *    of any full-screen loading state.
 *
 * **Once a still exists**, Stuart's ask was gestures *on the plate
 * itself*, not a row of buttons: tapping the still image reopens the same
 * Upload/Generate popover (replace), a tiny always-visible "×" in the
 * plate's corner clears it back to the empty placeholder outright, and a
 * press-and-hold on the plate does the same clear (redundant with the ×,
 * not instead of it — Stuart's ask was "X on the plate (or long-press
 * clear)", so both ship rather than picking one over the other). Editing
 * the shot-prompt textarea never touches an existing still on its own —
 * regenerating (via the popover) is what applies an edited prompt to a
 * new still; there's no auto-invalidate-on-prompt-edit behavior here.
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
  onSetStill,
}: SkidmarksClipStubProps) {
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

  const hasStill = !!segment.still;
  const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label].vocal;
  const vocalist = vocal ? resolveVocalistForPrompt(band.members) : undefined;

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
    const shotPrompt = segment.shotPrompt.trim();
    if (!shotPrompt) {
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
        shotPrompt,
        vocal,
        model: segment.model,
        bandName: band.name,
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
    <div className="flex flex-col gap-2.5 border-t border-white/[0.06] pt-3">
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
            "relative flex h-28 w-full touch-none select-none items-center justify-center overflow-hidden rounded-2xl",
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
              src={segment.still!.dataUrl}
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

      {error && <p role="alert" className="text-[11px] leading-relaxed text-rose-300/90">{error}</p>}

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
