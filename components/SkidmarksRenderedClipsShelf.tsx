"use client";

import { useState } from "react";
import {
  buildForceDownloadUrl,
  buildRendersZip,
  deletePersistedClipRender,
  persistedRenderKey,
  sortPersistedRenders,
  triggerAnchorDownload,
  triggerBlobDownload,
  type PersistedClipRender,
} from "@/lib/clipRenders";

interface SkidmarksRenderedClipsShelfProps {
  renders: Map<string, PersistedClipRender>;
  /** Called only *after* a real `DELETE /api/skidmarks/clip-renders`
   * call actually succeeds for that plate — clears this plate's entry
   * from the shared `renders` map (`hooks/useSkidmarksClipRenders.ts`'s
   * `removeRender`), which is also what clears its tick on the timeline
   * above. Never touches the plate's still or shot/motion text. */
  onRemoved: (segmentId: string, plateId: string) => void;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
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

/**
 * The page-bottom "Rendered clips" shelf — the declutter fix for
 * Stuart's live-QA rejection of a jammed panel under the pink Render
 * button: every rendered plate's real `<video>` player and download
 * link used to render directly inside `SkidmarksClipStub`'s own panel,
 * squashed together with the stills/prompt/motion controls. They now
 * live here instead, in one collapsible section at the bottom of the
 * Skidmarks sheet, **default open** per the task's own ask — a clip's
 * own panel (`SkidmarksClipStub`) stays scoped to stills + shot prompt
 * + motion + Render only, nothing squashed with video.
 *
 * Shows every plate render currently known for the live song/workspace
 * (the `renders` map is already scoped to the current mp3's segment
 * ids by `hooks/useSkidmarksClipRenders.ts`), sorted by clip position so
 * the shelf reads in the same order as the timeline above it. Keeps the
 * existing zip/"download all" behavior reachable from here, falling
 * back to sequential per-clip downloads if the zip step itself fails.
 *
 * **Horizontal strip, not a vertical stack** — a second live-QA report
 * on top of the first: once a song had more than a couple of renders,
 * this shelf's own vertically-stacked full-width players turned the
 * whole page into one very long scroll on a phone. Each render is now a
 * compact card (`w-44`, fixed-height video) in one `overflow-x-auto`
 * row, the exact same iOS-Safari-friendly pattern
 * `SkidmarksClipStub`'s own plate strip already uses one screen up:
 * `touch-pan-x` per card (blocks vertical/pinch so a `<video>` tap
 * doesn't fight the scroll, but still lets a horizontal drag reach the
 * next card) plus `overscroll-x-contain` + `-webkit-overflow-scrolling:
 * touch` on the row itself. The download link + the "Download rendered
 * clips (N)" zip control both stay put underneath the strip — reading
 * order is: horizontal player strip, then the always-reachable download
 * controls, never buried behind a scroll a thumb might not find.
 *
 * **Order lock**: the visible order is always `sortPersistedRenders`'s
 * timeline/plate-position sort (`lib/clipRenders.ts`), recomputed fresh
 * from each render's own `clipIndex`/`startSec`/`filename` every time
 * this renders — never "most recently rendered." A re-render of an
 * already-rendered plate only replaces that plate's `url` in the
 * `renders` map (`hooks/useSkidmarksClipRenders.ts`'s `addRender` calls
 * `Map.set()` on the *same* key), so its position here can't jump to
 * the front/back the way it would if this sorted by insertion order or
 * a "last updated" timestamp instead.
 *
 * **Per-card Remove**: Stuart's explicit ask, alongside the overwrite/
 * de-dupe fixes — a way to clear a render he doesn't want anymore
 * *without* touching that plate's still or shot/motion text (those live
 * entirely separately, in `lib/skidmarks.ts`'s `localStorage`-backed
 * store). Calls the real `DELETE /api/skidmarks/clip-renders`
 * (`lib/clipRenders.ts`'s `deletePersistedClipRender`) first; only on a
 * real success does this clear the card/tick via `onRemoved` — a
 * failed delete leaves the card and its tick exactly where they were,
 * with an honest error line, rather than pretending the render is gone.
 */
export function SkidmarksRenderedClipsShelf({ renders, onRemoved }: SkidmarksRenderedClipsShelfProps) {
  const [open, setOpen] = useState(true);
  const [bundleState, setBundleState] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});

  const list = sortPersistedRenders(Array.from(renders.values()));

  const handleRemove = async (render: PersistedClipRender) => {
    const key = persistedRenderKey(render.segmentId, render.plateId);
    if (removingKey) return;
    setRemovingKey(key);
    setRemoveErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    const outcome = await deletePersistedClipRender(render.segmentId, render.plateId);
    setRemovingKey(null);
    if (outcome.ok) {
      onRemoved(render.segmentId, render.plateId);
    } else {
      setRemoveErrors((prev) => ({ ...prev, [key]: outcome.message }));
    }
  };

  const handleDownloadAll = async () => {
    if (list.length === 0 || bundleState.busy) return;
    setBundleState({ busy: true, message: null });

    if (list.length === 1) {
      const [only] = list;
      triggerAnchorDownload(buildForceDownloadUrl(only.url), only.filename);
      setBundleState({ busy: false, message: null });
      return;
    }

    const zipOutcome = await buildRendersZip(list);
    if (zipOutcome.ok) {
      const zipBlob = new Blob([zipOutcome.zipBytes.slice().buffer], { type: "application/zip" });
      triggerBlobDownload(zipBlob, "skidmarks-renders.zip");
      setBundleState({ busy: false, message: null });
      return;
    }

    // Zip build failed (a real CORS regression, an expired/deleted
    // blob) — fall back to plain sequential per-clip downloads,
    // staggered so the browser doesn't treat a tight burst of clicks as
    // a popup storm.
    for (const render of list) {
      triggerAnchorDownload(buildForceDownloadUrl(render.url), render.filename);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    setBundleState({
      busy: false,
      message: `Couldn't bundle these into a zip (${zipOutcome.message}) \u2014 downloaded them one by one instead.`,
    });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
          Rendered clips
          <span aria-hidden className="ml-1.5 text-white/25">
            {"\u00b7"} {list.length}
          </span>
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <>
          {list.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-white/35">Nothing rendered yet.</p>
          ) : (
            // Same horizontal-strip shape as `SkidmarksClipStub`'s plate
            // strip: `touch-pan-x` on each card (not `touch-none`) keeps
            // this scrollable by a horizontal drag on iOS Safari even
            // when that drag starts on top of a `<video>` element.
            <div className="flex gap-2.5 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch]">
              {list.map((render) => {
                const key = persistedRenderKey(render.segmentId, render.plateId);
                const removing = removingKey === key;
                const removeError = removeErrors[key];
                return (
                  <div key={key} className="flex w-44 shrink-0 touch-pan-x flex-col gap-1.5">
                    <video src={render.url} controls playsInline className="h-28 w-44 rounded-xl bg-black object-cover" />
                    <div className="flex items-center justify-between gap-1.5">
                      <a
                        href={buildForceDownloadUrl(render.url)}
                        download={render.filename}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-[10px] font-medium text-rose-300/90 underline-offset-2 hover:underline"
                        title={`Download ${render.filename}`}
                      >
                        Download {render.filename}
                      </a>
                      <button
                        type="button"
                        onClick={() => handleRemove(render)}
                        disabled={removing}
                        aria-disabled={removing}
                        aria-label={`Remove this rendered clip (${render.filename}) \u2014 keeps the plate still`}
                        title="Remove this rendered clip"
                        className={[
                          "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                          removing
                            ? "cursor-not-allowed border-white/10 bg-white/[0.03] text-white/25"
                            : "border-white/10 bg-white/[0.03] text-white/45 hover:border-rose-400/30 hover:text-rose-300/90",
                        ].join(" ")}
                      >
                        <TrashIcon />
                        {removing ? "\u2026" : "Remove"}
                      </button>
                    </div>
                    {removeError && (
                      <p role="alert" className="text-[10px] leading-snug text-rose-300/90">
                        {`Couldn't remove \u2014 ${removeError}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {list.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={handleDownloadAll}
                disabled={bundleState.busy}
                aria-disabled={bundleState.busy}
                className={[
                  "rounded-full px-4 py-2.5 text-center text-[13px] font-semibold transition-colors",
                  bundleState.busy
                    ? "cursor-not-allowed bg-white/[0.04] text-white/30"
                    : "border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]",
                ].join(" ")}
              >
                {bundleState.busy ? "Bundling\u2026" : `Download rendered clip${list.length > 1 ? "s" : ""} (${list.length})`}
              </button>
              {bundleState.message && (
                <p role="status" aria-live="polite" className="text-[10px] leading-snug text-white/40">
                  {bundleState.message}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
