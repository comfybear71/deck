/**
 * Server-side: every blob under a few prefixes, following Blob's page
 * cursor so nothing past the first 1000 is missed. Used by the shelves
 * that find renders and archives in both the old `skidmarks/...` folders
 * and the readable `deck/` tree. Read-only.
 */
import { list } from "@vercel/blob";

export interface ListedBlob {
  pathname: string;
  url: string;
  uploadedAt: Date;
}

/** Safety cap on pages per prefix (1000 blobs each). */
const MAX_PAGES_PER_PREFIX = 20;

/** Throws if Blob itself is unreachable, like `list()` does, so callers
 * keep their own honest "not configured" handling. */
export async function listAllBlobsUnder(prefixes: readonly string[]): Promise<ListedBlob[]> {
  const out: ListedBlob[] = [];
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES_PER_PREFIX; page++) {
      const res = await list(cursor ? { prefix, cursor } : { prefix });
      for (const b of res.blobs) out.push({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt });
      if (!res.hasMore || !res.cursor) break;
      cursor = res.cursor;
    }
  }
  return out;
}
