/**
 * Windowed burn — turns "one flat `amount` per meter" into an honest
 * "what actually landed in the last 7 or 30 days" figure.
 *
 * ## Why this exists
 *
 * Before this module, the header/card just summed every countable meter's
 * `amount` as if it were guaranteed monthly spend — including a prepaid
 * balance (DeepSeek) that isn't spend at all until drawn down, and a
 * historical usage invoice (xAI) explicitly noted as "backed off since."
 * That's the "current figures feel wrong" Stuart flagged. There was also
 * no concept of a time window at all — "$930.32" with no window is a
 * lifetime-flavored number by accident, not a real "last 30 days" one.
 *
 * ## The documented rule
 *
 * For a given meter and a selected window (7 or 30 days, ending "now"):
 *
 * 1. **Real charges win.** If any of the meter's charges (seed `history`
 *    plus ingested mail receipts matched to this meter) fall inside the
 *    window, the meter's window amount is the sum of exactly those
 *    charges — nothing prorated, nothing added on top. This is "invoice
 *    reality": Vercel's two separate charges ($195, $59) each count only
 *    if their own date falls in the window, so a 7-day view can
 *    legitimately show just the $195 one while the 30-day view shows both.
 * 2. **No real charge in the window, but the meter is a recurring
 *    monthly subscription** (`cadence === "monthly"`): fall back to a
 *    prorated run-rate, `amount / 30 * windowDays`. This is clearly an
 *    *estimate* (labelled as such in the UI) — it's what lets a $50/mo
 *    subscription still show ~$11.67 in a 7-day window instead of a
 *    misleading $0 just because its billing date didn't fall this week.
 * 3. **No real charge, and the meter is `balance` / `one-time` /
 *    `unknown` cadence**: contributes $0 to the window. A prepaid balance
 *    (DeepSeek) or a closed one-time charge (DigitalOcean) is not
 *    recurring spend, so it's never prorated — it only shows up in a
 *    window via an actual draw-down charge. The meter's static `amount`
 *    (e.g. "balance remaining") is still shown, just labelled separately
 *    from "spend in this window."
 * 4. Meters excluded from totals altogether (`isCountable` from
 *    `lib/meters.ts` — `pending`/`closed` status, or `amount === null`)
 *    are excluded here too, at every step.
 *
 * USD and AUD are always summed separately (same "never silently convert"
 * rule as `lib/meters.ts`).
 */

import type { ChargeRecord, Currency, Meter } from "./types";
import type { IngestReceipt } from "./overrides";
import { isCountable } from "./meters";

export const WINDOW_OPTIONS = [7, 30] as const;
export type WindowDays = (typeof WINDOW_OPTIONS)[number];
export const DEFAULT_WINDOW_DAYS: WindowDays = 30;

export function isWindowDays(value: number): value is WindowDays {
  return (WINDOW_OPTIONS as readonly number[]).includes(value);
}

export interface ResolvedCharge {
  /** ISO calendar date, "YYYY-MM-DD". */
  date: string;
  amount: number;
  currency: Currency;
  source: "seed" | "mail";
  note?: string;
}

/** How a meter's window amount was derived — surfaced in the vendor table
 * so "estimated" never quietly passes as "actual." */
export type WindowBasis = "actual" | "prorated" | "none";

export interface MeterWindowAmount {
  meterId: string;
  amountUSD: number;
  amountAUD: number;
  basis: WindowBasis;
  charges: ResolvedCharge[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Truncates to a UTC calendar date so day-math doesn't drift across DST
 * or local-timezone edge cases — this module only ever cares about whole
 * days, never times of day. */
function toCalendarDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((toCalendarDate(to).getTime() - toCalendarDate(from).getTime()) / DAY_MS);
}

/** Seed `history` entries resolved to absolute dates against `now`. */
function seedCharges(meter: Meter, now: Date): ResolvedCharge[] {
  if (!meter.history) return [];
  const today = toCalendarDate(now);
  return meter.history.map((h: ChargeRecord) => ({
    date: toISODate(new Date(today.getTime() - h.daysAgo * DAY_MS)),
    amount: h.amount,
    currency: h.currency,
    source: "seed" as const,
    note: h.note,
  }));
}

/** Ingested mail receipts matched to this meter, resolved to `ResolvedCharge`. */
function mailCharges(meter: Meter, receipts: IngestReceipt[]): ResolvedCharge[] {
  return receipts
    .filter((r) => r.meterId === meter.id)
    .map((r) => ({
      date: r.date.slice(0, 10),
      amount: r.amount,
      currency: r.currency,
      source: "mail" as const,
      note: r.subject,
    }));
}

/** Whether an ISO calendar date falls inside the last `windowDays` days
 * ending "now" (inclusive of today). Exported so callers that already have
 * a resolved charge list (e.g. the vendor table's expanded row) can mark
 * which entries are in-window without re-deriving charges from scratch. */
export function isDateInWindow(dateISO: string, now: Date, windowDays: WindowDays): boolean {
  const diff = daysBetween(new Date(`${dateISO}T00:00:00.000Z`), now);
  return diff >= 0 && diff < windowDays;
}

/**
 * All resolved charges for one meter (seed + mail), regardless of window —
 * used both to compute a window total and to render the "see spend" list
 * in the vendor table's expanded row.
 */
export function meterCharges(meter: Meter, receipts: IngestReceipt[], now: Date): ResolvedCharge[] {
  return [...seedCharges(meter, now), ...mailCharges(meter, receipts)].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );
}

/** Applies the documented rule (see module doc) for one meter + window. */
export function meterWindowAmount(
  meter: Meter,
  receipts: IngestReceipt[],
  windowDays: WindowDays,
  now: Date
): MeterWindowAmount {
  if (!isCountable(meter)) {
    return { meterId: meter.id, amountUSD: 0, amountAUD: 0, basis: "none", charges: [] };
  }

  const allCharges = meterCharges(meter, receipts, now);
  const chargesInWindow = allCharges.filter((c) => isDateInWindow(c.date, now, windowDays));

  if (chargesInWindow.length > 0) {
    const amountUSD = chargesInWindow
      .filter((c) => c.currency === "USD")
      .reduce((sum, c) => sum + c.amount, 0);
    const amountAUD = chargesInWindow
      .filter((c) => c.currency === "AUD")
      .reduce((sum, c) => sum + c.amount, 0);
    return { meterId: meter.id, amountUSD, amountAUD, basis: "actual", charges: chargesInWindow };
  }

  if (meter.cadence === "monthly" && meter.amount) {
    const prorated = (meter.amount / 30) * windowDays;
    return {
      meterId: meter.id,
      amountUSD: meter.currency === "USD" ? prorated : 0,
      amountAUD: meter.currency === "AUD" ? prorated : 0,
      basis: "prorated",
      charges: [],
    };
  }

  return { meterId: meter.id, amountUSD: 0, amountAUD: 0, basis: "none", charges: [] };
}

export function windowBurnUSD(
  meters: Meter[],
  receipts: IngestReceipt[],
  windowDays: WindowDays,
  now: Date
): number {
  return meters.reduce(
    (sum, m) => sum + meterWindowAmount(m, receipts, windowDays, now).amountUSD,
    0
  );
}

export function windowBurnAUD(
  meters: Meter[],
  receipts: IngestReceipt[],
  windowDays: WindowDays,
  now: Date
): number {
  return meters.reduce(
    (sum, m) => sum + meterWindowAmount(m, receipts, windowDays, now).amountAUD,
    0
  );
}

export interface BurnBucket {
  /** Short label, e.g. "Mon" (7d, daily buckets) or "Sep 1–7" (30d, weekly). */
  label: string;
  startDate: string;
  endDate: string;
  amountUSD: number;
}

/**
 * Buckets the window for the burn graph: daily for a 7-day window, weekly
 * for a 30-day one (compact — ~4–5 bars, not 30). Each meter contributes
 * to a bucket the same way it contributes to the window total: an actual
 * charge lands in the bucket containing its date; a meter with no actual
 * charge anywhere in the window spreads its prorated daily run-rate evenly
 * across every day (so the bucketed sum always reconciles with
 * `windowBurnUSD` for the same window).
 */
export function buildBurnSeries(
  meters: Meter[],
  receipts: IngestReceipt[],
  windowDays: WindowDays,
  now: Date
): BurnBucket[] {
  const bucketSizeDays = windowDays === 7 ? 1 : 7;
  const today = toCalendarDate(now);
  const buckets: BurnBucket[] = [];

  for (let start = 0; start < windowDays; start += bucketSizeDays) {
    const size = Math.min(bucketSizeDays, windowDays - start);
    const endOffset = start; // days-ago of the most recent day in this bucket
    const startOffset = start + size - 1; // days-ago of the oldest day in this bucket
    const endDate = new Date(today.getTime() - endOffset * DAY_MS);
    const startDate = new Date(today.getTime() - startOffset * DAY_MS);
    buckets.push({
      label: bucketLabel(startDate, endDate, bucketSizeDays),
      startDate: toISODate(startDate),
      endDate: toISODate(endDate),
      amountUSD: 0,
    });
  }
  // Oldest-first for a left-to-right timeline.
  buckets.reverse();

  const dailyProratedUSD = new Map<string, number>();
  for (const meter of meters) {
    if (!isCountable(meter) || meter.currency !== "USD") continue;
    const charges = meterCharges(meter, receipts, now).filter((c) =>
      isDateInWindow(c.date, now, windowDays)
    );
    if (charges.length === 0 && meter.cadence === "monthly" && meter.amount) {
      dailyProratedUSD.set(meter.id, meter.amount / 30);
    }
  }

  for (const bucket of buckets) {
    for (const meter of meters) {
      if (!isCountable(meter) || meter.currency !== "USD") continue;
      const charges = meterCharges(meter, receipts, now).filter(
        (c) => c.date >= bucket.startDate && c.date <= bucket.endDate
      );
      if (charges.length > 0) {
        bucket.amountUSD += charges.reduce((sum, c) => sum + c.amount, 0);
        continue;
      }
      const dailyRate = dailyProratedUSD.get(meter.id);
      if (dailyRate) {
        const bucketDays = daysBetween(new Date(`${bucket.startDate}T00:00:00.000Z`), new Date(`${bucket.endDate}T00:00:00.000Z`)) + 1;
        bucket.amountUSD += dailyRate * bucketDays;
      }
    }
    bucket.amountUSD = Math.round(bucket.amountUSD * 100) / 100;
  }

  return buckets;
}

function bucketLabel(startDate: Date, endDate: Date, bucketSizeDays: number): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  if (bucketSizeDays === 1) {
    return endDate.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  }
  return `${fmt(startDate)}\u2013${fmt(endDate)}`;
}

export function windowLabel(windowDays: WindowDays): string {
  return `Last ${windowDays} days`;
}
