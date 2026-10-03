/**
 * "This page is older than the server" guard (2026-10-03).
 *
 * Real failure: PR #240 (multi-cast shots) went live at 3:13 PM, and four
 * minutes later Stuart rendered EP05 Act V rows 11–13 from an iPhone
 * Safari tab that had been open since before the update. The page still
 * ran the old code, so it sent the old one-person requests. Every row
 * was billed and came back with one Cast picture each, as if the feature
 * didn't exist. Nothing on the screen said the page was out of date.
 *
 * Every build stamps its id (the git commit) into the page and the
 * server alike (`next.config.ts`). A paid render route compares the
 * page's stamp (the `x-deck-build` header) with its own and refuses an
 * older or newer page before anything is billed, with "reload the page".
 * No build id (local dev, tests) = no check.
 */

export const DECK_BUILD_HEADER = "x-deck-build";

export const STALE_PAGE_MESSAGE =
  "Deck has been updated since this page was opened. Reload the page, then tap Render again. Nothing was charged.";

/** This build's id, the same string in the page and on the server. Empty outside Vercel. */
export function deckBuildId(): string {
  return (process.env.NEXT_PUBLIC_DECK_BUILD ?? "").trim();
}

/** The header every paid render request carries (nothing when there's no build id). */
export function deckBuildHeaders(): Record<string, string> {
  const id = deckBuildId();
  return id ? { [DECK_BUILD_HEADER]: id } : {};
}
