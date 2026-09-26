import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  applyPlaylistAction,
  isPlaylistShape,
  parsePlaylistAction,
  type SkidmarksPlaylist,
} from "@/lib/skidmarksPlaylists";

/**
 * Library playlists for Skidmarks. One Blob JSON file holds every
 * playlist (same store and style as the archive index), so phone and
 * PC share them. Playlists only point at archived songs; creating or
 * deleting a playlist never touches the songs themselves.
 */
export const runtime = "nodejs";

const PLAYLISTS_PATHNAME = "skidmarks/playlists/index.json";

async function readPlaylists(): Promise<SkidmarksPlaylist[]> {
  const { blobs } = await list({ prefix: PLAYLISTS_PATHNAME });
  const blob = blobs.find((b) => b.pathname === PLAYLISTS_PATHNAME);
  if (!blob) return [];
  const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not read playlists (${res.status}).`);
  const parsed: unknown = await res.json();
  return Array.isArray(parsed) ? parsed.filter(isPlaylistShape) : [];
}

async function writePlaylists(playlists: SkidmarksPlaylist[]): Promise<void> {
  await put(PLAYLISTS_PATHNAME, JSON.stringify(playlists), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function GET() {
  try {
    return NextResponse.json({ configured: true, playlists: await readPlaylists() });
  } catch (err) {
    return NextResponse.json({
      configured: false,
      playlists: [],
      error: err instanceof Error ? err.message : "Vercel Blob is not configured.",
    });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ configured: true, error: "Invalid JSON." }, { status: 400 });
  }
  const change = parsePlaylistAction(body);
  if (!change) {
    return NextResponse.json({ configured: true, error: "Invalid playlist change." }, { status: 400 });
  }
  try {
    const current = await readPlaylists();
    const next = applyPlaylistAction(current, change, Date.now(), () => crypto.randomUUID());
    await writePlaylists(next);
    return NextResponse.json({ configured: true, playlists: next });
  } catch (err) {
    return NextResponse.json(
      { configured: false, playlists: [], error: err instanceof Error ? err.message : "Could not save playlists." },
      { status: 500 }
    );
  }
}
