import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * GET/POST /api/skidmarks/archive — the small, server-side read/write
 * side of the finished-song archive index (see `lib/skidmarksArchive
 * .ts`'s module doc comment for the full picture: this route only ever
 * handles the *index* — a handful of small JSON metadata records, one
 * per archived song — never a song's full snapshot or its media, both
 * of which upload client-side-direct via `@vercel/blob/client` and
 * never pass through this function's own request body).
 *
 * **One shared index file, not one blob per song**: `skidmarks/archive/
 * index.json` holds the whole array. For a single-user, "how many songs
 * has Stuart actually finished" scale, one small read-modify-write is
 * simpler and cheaper than a `list()` + N separate metadata fetches on
 * every page load, and avoids needing a second "which song ids exist"
 * index just to list the first one. Not designed for concurrent writers
 * — a real risk in a multi-user app, a non-issue for Stuart's own
 * single-session use of this feature.
 *
 * **Never claims to be configured when it isn't** — the same honest
 * `{ configured: false }` shape `app/api/skidmarks/clip-renders/
 * route.ts` already uses for an unconfigured Blob store, not a bare
 * 500.
 */
export const runtime = "nodejs";

const ARCHIVE_INDEX_PATHNAME = "skidmarks/archive/index.json";

async function readIndex(): Promise<unknown[]> {
  const { blobs } = await list({ prefix: ARCHIVE_INDEX_PATHNAME });
  const indexBlob = blobs.find((b) => b.pathname === ARCHIVE_INDEX_PATHNAME);
  if (!indexBlob) return [];
  try {
    const res = await fetch(indexBlob.url);
    if (!res.ok) return [];
    const parsed = await res.json();
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(songs: unknown[]): Promise<void> {
  await put(ARCHIVE_INDEX_PATHNAME, JSON.stringify(songs), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function GET() {
  try {
    const songs = await readIndex();
    return NextResponse.json({ configured: true, songs });
  } catch (err) {
    return NextResponse.json({
      configured: false,
      songs: [],
      error: err instanceof Error ? err.message : "Vercel Blob is not configured.",
    });
  }
}

interface ArchivePostBody {
  action?: unknown;
  song?: unknown;
  id?: unknown;
}

function isRecordWithId(value: unknown): value is { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

export async function POST(request: Request) {
  let body: ArchivePostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  try {
    if (body.action === "add") {
      if (!isRecordWithId(body.song)) {
        return NextResponse.json({ error: "Missing or malformed `song`." }, { status: 400 });
      }
      const current = await readIndex();
      const withoutExisting = current.filter((s) => !(isRecordWithId(s) && s.id === (body.song as { id: string }).id));
      const next = [body.song, ...withoutExisting];
      await writeIndex(next);
      return NextResponse.json({ ok: true, songs: next });
    }

    if (body.action === "remove") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) {
        return NextResponse.json({ error: "Missing `id`." }, { status: 400 });
      }
      const current = await readIndex();
      const next = current.filter((s) => !(isRecordWithId(s) && s.id === id));
      await writeIndex(next);
      return NextResponse.json({ ok: true, songs: next });
    }

    return NextResponse.json({ error: "Unknown `action` \u2014 expected \"add\" or \"remove\"." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Vercel Blob is not configured." },
      { status: 502 }
    );
  }
}
