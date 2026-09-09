/**
 * Mail -> Tab bridge: shared types + pure merge logic for meter overrides
 * ingested from receipt emails (see the README's "Mail -> Tab" section).
 *
 * This module is isomorphic (no `fs`, no server-only APIs) so it can be
 * imported from both the server-side store (`lib/overrides-server.ts`) and,
 * if ever useful, from client code without pulling in Node built-ins.
 */

import type { Currency, Meter } from "./types";

export type IngestSource = "imap" | "manual" | string;

/** Shape of a single receipt as POSTed to /api/ingest/receipt. */
export interface IngestReceiptInput {
  vendor: string;
  amount: number;
  currency?: string;
  date?: string;
  subject?: string;
  source?: IngestSource;
  /** Explicit meter id, when the caller already knows it (skips fuzzy match). */
  meterId?: string;
}

/** A normalized, validated receipt as stored in the overrides log. */
export interface IngestReceipt {
  vendor: string;
  amount: number;
  currency: Currency;
  date: string;
  subject?: string;
  source: IngestSource;
  meterId?: string;
  /** Server-side ingest timestamp (ms epoch), not the email date. */
  receivedAt: number;
}

/** The latest amount adjustment applied to one meter, by meter id. */
export interface MeterAdjustment {
  meterId: string;
  amount: number;
  currency: Currency;
  vendor: string;
  subject?: string;
  source: IngestSource;
  receivedAt: number;
}

export interface LastSync {
  /** ms epoch of the most recent ingest, or null if nothing has synced yet. */
  at: number | null;
  /** Running count of receipts ingested since the store was created. */
  count: number;
}

export interface OverridesState {
  /** Recent raw receipts, most-recent-last, capped in the server store. */
  receipts: IngestReceipt[];
  /** Latest override per meter id, applied on top of seed meters. */
  adjustments: Record<string, MeterAdjustment>;
  lastSync: LastSync;
}

export function emptyOverridesState(): OverridesState {
  return { receipts: [], adjustments: {}, lastSync: { at: null, count: 0 } };
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Best-effort match of a free-text vendor string (an email sender or
 * subject line, e.g. "Vercel Inc.") to a seed meter, by explicit id first,
 * then by fuzzy substring match against the meter's id/name. Returns
 * undefined when nothing matches — the receipt is still logged, it just
 * doesn't move any meter's amount.
 */
export function matchMeter(
  meters: Meter[],
  vendor: string,
  meterId?: string
): Meter | undefined {
  if (meterId) {
    const byId = meters.find((m) => m.id === meterId);
    if (byId) return byId;
  }

  const normalizedVendor = normalizeKey(vendor);
  if (!normalizedVendor) return undefined;

  return meters.find((m) => {
    const normalizedId = normalizeKey(m.id);
    const normalizedName = normalizeKey(m.name);
    return (
      normalizedVendor.includes(normalizedId) ||
      normalizedId.includes(normalizedVendor) ||
      normalizedVendor.includes(normalizedName) ||
      normalizedName.includes(normalizedVendor)
    );
  });
}

/**
 * Merge ingested meter adjustments on top of seed meters. Pure — the same
 * shape the ingest API and the UI both go through, so there's one place
 * that decides what "override" means.
 */
export function mergeOverrides(meters: Meter[], state: OverridesState): Meter[] {
  if (Object.keys(state.adjustments).length === 0) return meters;

  return meters.map((meter) => {
    const adjustment = state.adjustments[meter.id];
    if (!adjustment) return meter;

    const syncNote = `Synced from mail (${adjustment.vendor}${
      adjustment.subject ? `: ${adjustment.subject}` : ""
    }).`;

    return {
      ...meter,
      amount: adjustment.amount,
      currency: adjustment.currency,
      status: meter.status === "pending" ? "active" : meter.status,
      notes: meter.notes ? `${meter.notes} ${syncNote}` : syncNote,
    };
  });
}
