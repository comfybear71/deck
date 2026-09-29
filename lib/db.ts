/**
 * Shared Neon Postgres client for this app's one durable-database use
 * case so far: the Skidmarks live edit session (`lib/skidmarksSession-
 * server.ts`). Not a general ORM/migration layer — just the smallest
 * thing that gets a real `sql` tagged-template client out of whichever
 * connection string Vercel's Neon integration actually sets.
 *
 * Uses `@neondatabase/serverless`'s HTTP driver (`neon()`), not a real
 * long-lived TCP `pg` client — this app's routes are short-lived
 * serverless functions, and the HTTP driver is Neon's own documented
 * fit for that shape (no connection pooling/lifecycle to manage across
 * invocations). That also means the *pooled* vs. *unpooled* connection
 * string distinction Neon's own dashboard makes for a real `pg` pool
 * doesn't matter here — either works over HTTP, so this just prefers
 * `DATABASE_URL` (pooled, the more common one Vercel's Neon integration
 * sets) and falls back to `DATABASE_URL_UNPOOLED` if that's the only
 * one present.
 *
 * **Never throws for a missing connection string** — `getSkidmarksSql`
 * returns `null` instead, so every caller gets the same honest
 * "not configured" outcome this app already uses for an unconnected
 * Vercel Blob store (`app/api/skidmarks/archive/route.ts`'s
 * `configured: false` shape) rather than a bare crash.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type SkidmarksSql = NeonQueryFunction<false, false>;

let cachedSql: SkidmarksSql | null = null;
let cachedConnectionString: string | null = null;

function resolveConnectionString(): string | null {
  const pooled = process.env.DATABASE_URL?.trim();
  if (pooled) return pooled;
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
  return unpooled || null;
}

/**
 * Lazily creates (and caches, keyed off the connection string itself so
 * a changed env var during a long-lived dev process picks up correctly)
 * the Neon HTTP `sql` client. `null` when neither `DATABASE_URL` nor
 * `DATABASE_URL_UNPOOLED` is set — the honest "Neon isn't connected in
 * this environment" case every caller must check for before querying.
 */
export function getSkidmarksSql(): SkidmarksSql | null {
  const connectionString = resolveConnectionString();
  if (!connectionString) return null;
  if (cachedSql && cachedConnectionString === connectionString) return cachedSql;
  cachedSql = neon(connectionString);
  cachedConnectionString = connectionString;
  return cachedSql;
}

export const DATABASE_UNCONFIGURED_MESSAGE =
  "DATABASE_URL is not set — Neon isn't connected in this environment.";
