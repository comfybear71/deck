"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchSkidmarksPlaylists,
  mutateSkidmarksPlaylists,
  type PlaylistAction,
  type SkidmarksPlaylist,
} from "@/lib/skidmarksPlaylists";

/**
 * Library playlists, loaded from the server once when Skidmarks opens.
 * Every change goes to the server and the list is replaced with what
 * the server saved, so phone and PC stay in step.
 */
export function useSkidmarksPlaylists() {
  const [playlists, setPlaylists] = useState<SkidmarksPlaylist[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSkidmarksPlaylists().then((outcome) => {
      if (cancelled) return;
      if (outcome.ok) {
        setPlaylists(outcome.playlists);
        setError(null);
      } else {
        setError(outcome.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(async (change: PlaylistAction): Promise<boolean> => {
    const outcome = await mutateSkidmarksPlaylists(change);
    if (outcome.ok) {
      setPlaylists(outcome.playlists);
      setError(null);
      return true;
    }
    setError(`Playlist not saved: ${outcome.message}`);
    return false;
  }, []);

  return { playlists, playlistError: error, mutatePlaylists: mutate };
}
