/**
 * Server-side half of the Mail -> Tab bridge. Backs the
 * `/api/ingest/*` routes with a small local store.
 *
 * `data/overrides.json` on disk is the source of truth, read fresh on
 * every access rather than cached in a module-level variable: the ingest
 * routes and the page that renders the card are separate server modules
 * (each API route / page is its own bundle), so a long-lived in-memory
 * cache in one would never see writes made via another. The file is what
 * lets them agree.
 *
 * On a read-only deploy filesystem (e.g. Vercel), the file write silently
 * no-ops and an in-memory fallback (scoped to this one module instance)
 * takes over for the rest of that warm instance's life — an accepted
 * limitation of a v0 stub, same as `lib/control-plane-server.ts`. See the
 * README's "Mail -> Tab" section for the full picture, including why live
 * IMAP itself is intentionally not wired up here.
 */

import fs from "node:fs";
import path from "node:path";
import type { Currency, Meter } from "./types";
import metersSeedData from "@/data/meters.json";
import {
  emptyOverridesState,
  matchMeter,
  mergeOverrides,
  type IngestReceipt,
  type IngestReceiptInput,
  type LastSync,
  type OverridesState,
} from "./overrides";

const VALID_CURRENCIES: Currency[] = ["USD", "AUD"];

function isValidCurrency(value: string): value is Currency {
  return (VALID_CURRENCIES as string[]).includes(value);
}

const OVERRIDES_FILE = path.join(process.cwd(), "data", "overrides.json");
const RECEIPT_LOG_LIMIT = 100;
const INGEST_KEY_ENV = "DECK_INGEST_KEY";

const seedMeters = metersSeedData as Meter[];

/** Per-module-instance fallback, only ever used when the file write below fails. */
let memoryFallback: OverridesState | null = null;
let warnedMissingKey = false;

function normalizeState(parsed: unknown): OverridesState {
  const p = (parsed ?? {}) as Partial<OverridesState>;
  return {
    receipts: Array.isArray(p.receipts) ? p.receipts : [],
    adjustments:
      p.adjustments && typeof p.adjustments === "object" ? p.adjustments : {},
    lastSync: {
      at: typeof p.lastSync?.at === "number" ? p.lastSync.at : null,
      count: typeof p.lastSync?.count === "number" ? p.lastSync.count : 0,
    },
  };
}

function readFromDisk(): OverridesState | null {
  try {
    const raw = fs.readFileSync(OVERRIDES_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    // Missing/unreadable/invalid file — the caller falls back from here.
    return null;
  }
}

/** Always prefers the on-disk file (shared across all route modules); falls back to this instance's own memory when the file can't be read. */
function getState(): OverridesState {
  return readFromDisk() ?? memoryFallback ?? emptyOverridesState();
}

function persist(next: OverridesState): void {
  memoryFallback = next;
  try {
    fs.mkdirSync(path.dirname(OVERRIDES_FILE), { recursive: true });
    fs.writeFileSync(
      OVERRIDES_FILE,
      `${JSON.stringify(next, null, 2)}\n`,
      "utf8"
    );
  } catch {
    // Read-only filesystem (deployed) — this instance's in-memory fallback
    // is still correct for its own remaining requests; it just won't be
    // visible to other instances/modules and won't survive a cold start.
  }
}

/**
 * Shared-secret check for the ingest routes. Missing `DECK_INGEST_KEY` is
 * allowed (dev convenience, per the README) but logged once so it's not a
 * silent surprise if it's forgotten before a real deploy.
 */
export function isIngestAuthorized(headerValue: string | null): boolean {
  const expected = process.env[INGEST_KEY_ENV];
  if (!expected) {
    if (!warnedMissingKey) {
      console.warn(
        `[ingest] ${INGEST_KEY_ENV} is not set \u2014 allowing ingest requests unauthenticated. ` +
          `Set ${INGEST_KEY_ENV} in the environment before pointing a real mail job at this endpoint.`
      );
      warnedMissingKey = true;
    }
    return true;
  }
  return headerValue === expected;
}

export function normalizeReceipt(
  input: unknown
): IngestReceipt | { error: string } {
  if (!input || typeof input !== "object") {
    return { error: "Body must be a JSON object." };
  }

  const { vendor, amount, currency, date, subject, source, meterId } =
    input as Partial<IngestReceiptInput>;

  if (typeof vendor !== "string" || vendor.trim().length === 0) {
    return { error: "vendor is required and must be a non-empty string." };
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return { error: "amount is required and must be a finite number." };
  }
  if (currency !== undefined && typeof currency !== "string") {
    return { error: "currency must be a string when provided." };
  }
  const normalizedCurrency = (currency ?? "USD").trim().toUpperCase();
  if (!isValidCurrency(normalizedCurrency)) {
    return { error: "currency must be one of USD|AUD (the two The Tab tracks)." };
  }
  if (date !== undefined && typeof date !== "string") {
    return { error: "date must be a string when provided." };
  }
  if (subject !== undefined && typeof subject !== "string") {
    return { error: "subject must be a string when provided." };
  }
  if (source !== undefined && typeof source !== "string") {
    return { error: "source must be a string when provided." };
  }
  if (meterId !== undefined && typeof meterId !== "string") {
    return { error: "meterId must be a string when provided." };
  }

  return {
    vendor: vendor.trim(),
    amount,
    currency: normalizedCurrency,
    date: date ?? new Date().toISOString(),
    subject: subject?.trim() || undefined,
    source: source ?? "imap",
    meterId: meterId?.trim() || undefined,
    receivedAt: Date.now(),
  };
}

/**
 * Records one normalized receipt: appends it to the log, and — if its
 * vendor matches a seed meter — updates that meter's override. Returns
 * whether a match was found so the API response can tell the caller.
 */
export function recordReceipt(receipt: IngestReceipt): {
  matched: boolean;
  meterId?: string;
} {
  const current = getState();
  const meter = matchMeter(seedMeters, receipt.vendor, receipt.meterId);

  const receipts = [...current.receipts, receipt].slice(-RECEIPT_LOG_LIMIT);
  const adjustments = { ...current.adjustments };
  if (meter) {
    adjustments[meter.id] = {
      meterId: meter.id,
      amount: receipt.amount,
      currency: receipt.currency,
      vendor: receipt.vendor,
      subject: receipt.subject,
      source: receipt.source,
      receivedAt: receipt.receivedAt,
    };
  }

  const lastSync: LastSync = {
    at: receipt.receivedAt,
    count: current.lastSync.count + 1,
  };

  persist({ receipts, adjustments, lastSync });

  return { matched: Boolean(meter), meterId: meter?.id };
}

export function getLastSync(): LastSync {
  return getState().lastSync;
}

export function getOverridesSnapshot(): OverridesState {
  return getState();
}

/** Seed meters with any ingested overrides merged on top. What the UI renders. */
export function getMergedMeters(meters: Meter[]): Meter[] {
  return mergeOverrides(meters, getState());
}
