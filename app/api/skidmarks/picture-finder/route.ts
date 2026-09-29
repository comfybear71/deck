import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

/**
 * GET /api/skidmarks/picture-finder?since=ISO&until=ISO&prefix=skidmarks/member-photos/
 *
 * Read-only list of saved pictures in Blob storage, oldest first, with
 * their upload times (2026-09-30). It exists to find the training
 * pictures whose list on the BIG SEXY / SOUL REBEL character cards was
 * wiped on 2026-09-29, when the pictures themselves were never deleted.
 * It never uploads, changes or deletes anything, and makes no paid
 * call. The prefix must stay inside `skidmarks/`.
 *
 * No `BLOB_READ_WRITE_TOKEN` makes `list()` throw, which comes back as
 * `{ configured: false }`, never a 500.
 */
export const runtime = "nodejs";

export interface PictureFinderItem {
  pathname: string;
  url: string;
  uploadedAt: string;
  size: number;
}

const DEFAULT_PREFIX = "skidmarks/member-photos/";
const MAX_PAGES = 20;

function parseTime(raw: string | null): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawPrefix = params.get("prefix")?.trim() || DEFAULT_PREFIX;
  if (!rawPrefix.startsWith("skidmarks/") || rawPrefix.includes("..")) {
    return NextResponse.json({ error: "prefix must start with skidmarks/" }, { status: 400 });
  }
  const since = parseTime(params.get("since"));
  const until = parseTime(params.get("until"));

  const items: PictureFinderItem[] = [];
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await list({ prefix: rawPrefix, cursor, limit: 1000 });
      for (const b of res.blobs) {
        const at = new Date(b.uploadedAt).getTime();
        if (since !== null && at < since) continue;
        if (until !== null && at > until) continue;
        items.push({ pathname: b.pathname, url: b.url, uploadedAt: new Date(b.uploadedAt).toISOString(), size: b.size });
      }
      if (!res.hasMore || !res.cursor) break;
      cursor = res.cursor;
    }
  } catch (err) {
    return NextResponse.json({
      configured: false,
      items: [],
      error: err instanceof Error ? err.message : "Blob storage is not reachable.",
    });
  }
  items.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  return NextResponse.json({ configured: true, prefix: rawPrefix, count: items.length, items });
}
