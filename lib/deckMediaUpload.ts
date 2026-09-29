/**
 * Browser half of "new uploads land in the readable tree"
 * (`lib/deckMediaPaths.ts`). Tries `folder/name.ext`, then `-v2`, `-v3`…
 * when Blob says the name is taken (the token route always issues
 * `deck/` tokens with `allowOverwrite: false`, so a taken name is an
 * error, never an overwrite). If the tree upload fails for any other
 * reason, or there's no target at all, it falls back to the old flat
 * `skidmarks/...` path once, so a picture is never lost over naming.
 */

import { upload } from "@vercel/blob/client";
import {
  DECK_MEDIA_MAX_VERSION,
  buildDeckMediaPathname,
  isBlobAlreadyExistsError,
  isDeckMediaTarget,
  type DeckMediaExtension,
  type DeckMediaTarget,
} from "./deckMediaPaths";

export const BLOB_HANDLE_UPLOAD_URL = "/api/skidmarks/blob-upload";

export async function uploadToDeckTreeOrLegacy(
  body: Blob,
  contentType: string,
  ext: DeckMediaExtension,
  target: DeckMediaTarget | null | undefined,
  legacyPathname: () => string,
): Promise<{ url: string; pathname: string }> {
  if (target && isDeckMediaTarget(target)) {
    for (let version = 1; version <= DECK_MEDIA_MAX_VERSION; version++) {
      const pathname = buildDeckMediaPathname(target, ext, version);
      try {
        const result = await upload(pathname, body, {
          access: "public",
          handleUploadUrl: BLOB_HANDLE_UPLOAD_URL,
          contentType,
        });
        return { url: result.url, pathname: result.pathname };
      } catch (err) {
        if (isBlobAlreadyExistsError(err)) continue;
        // Anything else (no store here, an older server that doesn't
        // know `deck/` yet, a network blip): one try at the old path.
        break;
      }
    }
  }
  const pathname = legacyPathname();
  const result = await upload(pathname, body, {
    access: "public",
    handleUploadUrl: BLOB_HANDLE_UPLOAD_URL,
    contentType,
  });
  return { url: result.url, pathname: result.pathname };
}
