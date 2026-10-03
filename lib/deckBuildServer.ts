/**
 * Server half of the "page is older than the server" guard
 * (`lib/deckBuild.ts`). Kept apart so the page never bundles next/server.
 */

import { NextResponse } from "next/server";
import { DECK_BUILD_HEADER, STALE_PAGE_MESSAGE, deckBuildId } from "./deckBuild";

/** 409 `stale_page` when the page that sent this request came from a different build. */
export function staleDeckPageResponse(request: Request): NextResponse | null {
  const server = deckBuildId();
  if (!server) return null;
  const page = request.headers.get(DECK_BUILD_HEADER)?.trim() ?? "";
  if (page === server) return null;
  return NextResponse.json({ error: STALE_PAGE_MESSAGE, code: "stale_page" }, { status: 409 });
}
