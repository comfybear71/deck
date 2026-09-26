import { SKIDMARKS_NODE_ID } from "@/lib/constants";

/**
 * Which Deck detail sheets reopen by themselves after a page refresh.
 * Only Skidmarks for now (the production studio Stuart works in all
 * day). Budju / Propfolio / generic sheets still close on refresh,
 * exactly as before.
 */
export const RESTORABLE_SHEET_IDS: readonly string[] = [SKIDMARKS_NODE_ID];

/** Turn a stored value back into a sheet id, or null if it shouldn't reopen. */
export function parseStoredOpenSheet(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return RESTORABLE_SHEET_IDS.includes(raw) ? raw : null;
}
