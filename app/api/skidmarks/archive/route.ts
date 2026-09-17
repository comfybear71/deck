import { del, list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  collapseArchivedSongsByIdentity,
  songsShareArchiveIdentity,
} from "@/lib/skidmarksArchiveDedupe";

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
 * **One shelf row per song file (2026-09-17)**: Archive used to append
 * a new id on every save, so the same MP3 stacked (My Best Friend ×3,
 * Simulation.mp3 empty pair, Give Me Something 27 + 27 + 22). `add`
 * now replaces any existing row with the same `bandId` + filename, and
 * every index read collapses leftover copies, keeping the one with more
 * rendered plates / clips. Opening a song still does not delete it.
 *
 * **Never claims to be configured when it isn't** — the same honest
 * `{ configured: false }` shape `app/api/skidmarks/clip-renders/
 * route.ts` already uses for an unconfigured Blob store, not a bare
 * 500.
 */
export const runtime = "nodejs";

const ARCHIVE_INDEX_PATHNAME = "skidmarks/archive/index.json";
const ARCHIVE_PATH_PREFIX = "skidmarks/archive/";
const SNAPSHOT_PATHNAME_RE = /^skidmarks\/archive\/([^/]+)\/snapshot\.json$/;

function isRecordWithId(value: unknown): value is {
  id: string;
  bandId?: unknown;
  fileName?: unknown;
  snapshotUrl?: unknown;
} {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

function snapshotUrlOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const url = (value as { snapshotUrl?: unknown }).snapshotUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

async function deleteSnapshotUrls(urls: string[]): Promise<void> {
  const unique = [...new Set(urls)];
  await Promise.all(
    unique.map(async (url) => {
      try {
        await del(url);
      } catch {
        // Best-effort — a leftover snapshot blob is storage waste, not
        // a failed Archive. Recovery skips it once the index row is gone
        // and a same-song winner is already listed.
      }
    })
  );
}

/**
 * **Real, confirmed recovery need (2026-09-16)**: `archiveSkidmarksSession`
 * (`lib/skidmarksArchive.ts`) uploads a song's full snapshot first, then
 * separately POSTs it into this index — two steps, not one. A snapshot
 * can land safely in Blob while the index write after it fails (or
 * never ran, or raced with something else), leaving a real, complete,
 * fully-restorable song sitting in storage with no row on the shelf and
 * no way to find it — indistinguishable from data loss to Stuart, even
 * though nothing was actually gone.
 *
 * Every index read now self-heals: lists every real `snapshot.json`
 * under the archive prefix, and any one whose id isn't already in the
 * index gets read back and re-added automatically — the *next* time
 * the shelf loads, an orphaned song reappears on its own, no special
 * "recover" action needed. Best-effort per orphan (one snapshot that
 * fails to parse never blocks the others, or the songs that were
 * already properly indexed) — this only ever *adds* rows back, it
 * never removes or overwrites an existing one.
 */
async function recoverOrphanedSnapshots(indexed: unknown[]): Promise<unknown[]> {
  const knownIds = new Set(indexed.filter(isRecordWithId).map((s) => s.id));
  let blobs: { pathname: string; url: string; uploadedAt: Date }[];
  try {
    ({ blobs } = await list({ prefix: ARCHIVE_PATH_PREFIX }));
  } catch {
    return []; // Blob itself unreachable — nothing to recover this pass, not a crash.
  }

  const recovered: unknown[] = [];
  for (const blob of blobs) {
    const match = blob.pathname.match(SNAPSHOT_PATHNAME_RE);
    if (!match) continue;
    const id = match[1];
    if (knownIds.has(id)) continue;
    try {
      const res = await fetch(blob.url);
      if (!res.ok) continue;
      const snapshot = (await res.json()) as { band?: { id?: unknown; name?: unknown; coverImage?: unknown }; mp3?: unknown };
      const band = snapshot.band;
      const mp3 = snapshot.mp3 as
        | { fileName?: unknown; durationSec?: unknown; segments?: unknown[]; audioUrl?: unknown }
        | undefined;
      if (!band || typeof band.id !== "string" || typeof band.name !== "string" || !mp3 || typeof mp3.fileName !== "string") {
        continue; // Not a real, complete song snapshot — skip rather than list a broken row.
      }
      const segments = Array.isArray(mp3.segments) ? mp3.segments : [];
      const renderedPlateCount = segments.reduce((sum: number, seg) => {
        const plates = (seg as { plates?: unknown[] })?.plates;
        if (!Array.isArray(plates)) return sum;
        return sum + plates.filter((p) => (p as { still?: unknown })?.still).length;
      }, 0);
      recovered.push({
        id,
        bandId: band.id,
        bandName: band.name,
        coverImage: typeof band.coverImage === "string" ? band.coverImage : undefined,
        fileName: mp3.fileName,
        archivedAt: blob.uploadedAt instanceof Date ? blob.uploadedAt.getTime() : Date.now(),
        durationSec: typeof mp3.durationSec === "number" ? mp3.durationSec : null,
        clipCount: segments.length,
        renderedPlateCount,
        snapshotUrl: blob.url,
        audioUrl: typeof mp3.audioUrl === "string" ? mp3.audioUrl : undefined,
      });
    } catch {
      continue; // One unreadable/corrupt orphan never blocks the rest.
    }
  }
  return recovered;
}

async function readIndex(): Promise<unknown[]> {
  const { blobs } = await list({ prefix: ARCHIVE_INDEX_PATHNAME });
  const indexBlob = blobs.find((b) => b.pathname === ARCHIVE_INDEX_PATHNAME);
  let indexed: unknown[] = [];
  if (indexBlob) {
    try {
      const res = await fetch(indexBlob.url);
      if (res.ok) {
        const parsed = await res.json();
        indexed = Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // Falls through to the recovery scan below with an empty `indexed`.
    }
  }

  const recovered = await recoverOrphanedSnapshots(indexed);
  const merged = recovered.length > 0 ? [...recovered, ...indexed] : indexed;
  const identifiable = merged.filter(isRecordWithId);
  const others = merged.filter((s) => !isRecordWithId(s));
  const { kept, dropped } = collapseArchivedSongsByIdentity(identifiable);
  if (recovered.length === 0 && dropped.length === 0) return indexed;

  const next = [...kept, ...others];
  const droppedUrls = dropped.map(snapshotUrlOf).filter((url): url is string => url !== null);
  const keptUrls = new Set(kept.map(snapshotUrlOf).filter((url): url is string => url !== null));
  await deleteSnapshotUrls(droppedUrls.filter((url) => !keptUrls.has(url)));
  await writeIndex(next);
  return next;
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
      const incoming = body.song;
      const current = await readIndex();
      const superseded = current.filter(
        (s) =>
          isRecordWithId(s) &&
          (s.id === incoming.id || songsShareArchiveIdentity(s, incoming))
      );
      const withoutExisting = current.filter(
        (s) =>
          !(
            isRecordWithId(s) &&
            (s.id === incoming.id || songsShareArchiveIdentity(s, incoming))
          )
      );
      const next = [incoming, ...withoutExisting];
      const incomingUrl = snapshotUrlOf(incoming);
      const supersededUrls = superseded
        .map(snapshotUrlOf)
        .filter((url): url is string => url !== null && url !== incomingUrl);
      await deleteSnapshotUrls(supersededUrls);
      await writeIndex(next);
      return NextResponse.json({ ok: true, songs: next });
    }

    if (body.action === "delete") {
      // A real, deliberate delete from the shelf (2026-09-16): the row
      // AND its snapshot file, otherwise `recoverOrphanedSnapshots`
      // would faithfully bring the "deleted" song straight back on the
      // next list read. Only ever reached through the in-app confirm.
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) {
        return NextResponse.json({ error: "Missing `id`." }, { status: 400 });
      }
      const current = await readIndex();
      const target = current.find((s) => isRecordWithId(s) && s.id === id) as { snapshotUrl?: unknown } | undefined;
      if (target && typeof target.snapshotUrl === "string") {
        await del(target.snapshotUrl);
      }
      const next = current.filter((s) => !(isRecordWithId(s) && s.id === id));
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

    return NextResponse.json({ error: "Unknown `action` \u2014 expected \"add\", \"remove\" or \"delete\"." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Vercel Blob is not configured." },
      { status: 502 }
    );
  }
}
