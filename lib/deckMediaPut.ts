/**
 * Server half of "new files land in the readable tree"
 * (`lib/deckMediaPaths.ts`), for the routes that `put()` their own
 * results (Siray stills, Adult shorts clips, Sunnybank beats).
 *
 * With a target: tries `folder/name.ext`, then `-v2`, `-v3`… with
 * `allowOverwrite: false`, so nothing already there is ever replaced.
 * Any other failure, or no target: the route's old flat pathname, with
 * the route's old options, exactly as before this change.
 */

import { put, type PutBlobResult } from "@vercel/blob";
import {
  DECK_MEDIA_MAX_VERSION,
  buildDeckMediaPathname,
  isBlobAlreadyExistsError,
  isDeckMediaTarget,
  type DeckMediaExtension,
  type DeckMediaTarget,
} from "./deckMediaPaths";

type PutBody = Parameters<typeof put>[1];

export async function putDeckMediaOrLegacy(
  body: PutBody,
  args: {
    target: DeckMediaTarget | null | undefined;
    ext: DeckMediaExtension;
    contentType: string;
    legacyPathname: string;
  },
): Promise<PutBlobResult> {
  if (args.target && isDeckMediaTarget(args.target)) {
    for (let version = 1; version <= DECK_MEDIA_MAX_VERSION; version++) {
      try {
        return await put(buildDeckMediaPathname(args.target, args.ext, version), body, {
          access: "public",
          contentType: args.contentType,
          addRandomSuffix: false,
          allowOverwrite: false,
        });
      } catch (err) {
        if (isBlobAlreadyExistsError(err)) continue;
        break;
      }
    }
  }
  return put(args.legacyPathname, body, {
    access: "public",
    contentType: args.contentType,
    addRandomSuffix: false,
  });
}
