"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchPersistedClipRenders,
  persistedRenderKey,
  type PersistedClipRender,
} from "@/lib/clipRenders";
import type { SkidmarksClipSegment } from "@/lib/skidmarks";

/**
 * Owns the one "which plates across this whole song already have a
 * saved render" lookup — lifted out of `SkidmarksClipTimeline` (which
 * used to own it alone) so `SkidmarksRenderedClipsShelf` can share the
 * exact same fetched state instead of re-fetching independently the
 * moment both need to know about a render. Fetched once
 * (`fetchPersistedClipRenders`, `lib/clipRenders.ts`) for every clip id
 * on mount and whenever the *set* of clip ids changes (a fresh MP3
 * attach), not on every keystroke.
 *
 * Keyed by `persistedRenderKey(segmentId, plateId)` — a render is a
 * per-*plate* fact now (see `lib/clipRenderBlob.ts`'s module doc
 * comment), not per-clip.
 */
export function useSkidmarksClipRenders(segments: SkidmarksClipSegment[]) {
  const [renders, setRenders] = useState<Map<string, PersistedClipRender>>(new Map());

  const segmentIdsKey = useMemo(() => segments.map((s) => s.id).join(","), [segments]);

  useEffect(() => {
    const segmentIds = segmentIdsKey ? segmentIdsKey.split(",") : [];
    if (segmentIds.length === 0) return;
    let cancelled = false;
    fetchPersistedClipRenders(segmentIds).then((outcome) => {
      if (cancelled || !outcome.ok) return;
      setRenders((prev) => {
        const next = new Map(prev);
        for (const render of outcome.renders) {
          next.set(persistedRenderKey(render.segmentId, render.plateId), render);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // Re-fetches when the *set* of clip ids changes (a fresh MP3
    // attach), not on every shot-prompt/motion-text keystroke —
    // `segmentIdsKey` is stable across an edit to an existing segment's
    // own fields.
  }, [segmentIdsKey]);

  const addRender = (render: PersistedClipRender) => {
    setRenders((prev) => {
      const next = new Map(prev);
      next.set(persistedRenderKey(render.segmentId, render.plateId), render);
      return next;
    });
  };

  /** The local-state half of Stuart's "remove old MP4s from the shelf"
   * ask — `SkidmarksRenderedClipsShelf` calls this only *after* the real
   * `DELETE /api/skidmarks/clip-renders` call
   * (`lib/clipRenders.ts`'s `deletePersistedClipRender`) actually
   * succeeds, so a real delete failure never silently clears a tick/
   * shelf row for a render that's still sitting there. Purely a Map
   * removal — this never touches `lib/skidmarks.ts`'s plate/prompt
   * state, which is what keeps the still + shot/motion text untouched. */
  const removeRender = (segmentId: string, plateId: string) => {
    setRenders((prev) => {
      const key = persistedRenderKey(segmentId, plateId);
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  return { renders, addRender, removeRender };
}
