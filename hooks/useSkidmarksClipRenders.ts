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
 * **Replaces the map on every segment-set change — never merges onto
 * whatever was there before.** Real live bug (2026-09-15, Stuart's own
 * report): attaching a brand-new MP3 to the same band mints an entirely
 * new set of segment/plate ids, but this used to fold the freshly
 * fetched renders *into* the existing map instead of starting over —
 * so a fresh song's shelf kept showing every render from whatever song
 * was attached before it, forever, with no way to clear. Same gap if
 * the MP3 is removed outright (`segments` goes to `[]`): the old code
 * skipped the fetch entirely on an empty id list and left the stale
 * map untouched. A prior segment/plate id can never legitimately
 * reappear once a fresh MP3 attach mints new ones, so there is no real
 * case where carrying old entries forward is correct — a full replace
 * on every id-set change (including a failed refetch, which means "we
 * don't know this new set's renders," not "assume the old ones still
 * apply") is what actually matches "this shelf reflects the currently
 * attached song," which is the one invariant callers rely on.
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
    let cancelled = false;
    // No ids (MP3 removed) resolves through the same `.then()` path as
    // a real fetch, rather than calling `setRenders` synchronously in
    // the effect body — same replace-not-merge behavior either way,
    // just via a microtask so this never trips the "no setState
    // directly in an effect" rule the rest of this codebase follows.
    const load = segmentIds.length === 0 ? Promise.resolve({ ok: true as const, renders: [] }) : fetchPersistedClipRenders(segmentIds);
    load.then((outcome) => {
      if (cancelled) return;
      const next = new Map<string, PersistedClipRender>();
      if (outcome.ok) {
        for (const render of outcome.renders) {
          next.set(persistedRenderKey(render.segmentId, render.plateId), render);
        }
      }
      setRenders(next);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetches (and fully replaces) whenever the *set* of clip ids
    // changes (a fresh MP3 attach, or the MP3 being removed), not on
    // every shot-prompt/motion-text keystroke — `segmentIdsKey` is
    // stable across an edit to an existing segment's own fields.
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
