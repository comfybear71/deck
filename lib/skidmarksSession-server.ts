/**
 * Server-side half of the Skidmarks live edit session's Neon-backed
 * persistence — backs `GET`/`PUT /api/skidmarks/session` (see that
 * route's own doc comment) with a real Neon Postgres table, replacing
 * `localStorage` as this feature's source of truth for bands/session/
 * segments/plates/prompts/motion/selectedPlateId/instrumentalVideoModel/
 * mp3 metadata pointers (see `lib/skidmarks.ts`'s module doc comment
 * and AGENTS.md's "no localStorage for state of record" lock).
 *
 * **One row, single-tenant, by design.** This app has no auth system
 * (see AGENTS.md's env-vars section — nothing here reads a session
 * cookie or a user id), and there is exactly one real user (Stuart).
 * Rather than inventing a login flow this PR was never asked for, this
 * keys the one durable session row off a fixed
 * `SKIDMARKS_STUDIO_OWNER_ID` constant — "Stuart's studio" is the
 * durable identity the task asked this to be keyed by, not a
 * per-browser/per-device one (that's exactly what `localStorage`
 * already was, and exactly what this migration is fixing). Overridable
 * via the optional `SKIDMARKS_STUDIO_OWNER_ID` env var only so a second
 * environment (a staging deploy, a local dev box someone else uses)
 * doesn't have to share the same literal row — not real multi-tenancy;
 * if this app ever grows real accounts, this whole module is what a
 * per-account `owner_id` column would replace the constant with.
 *
 * **Schema-on-demand, not a migration tool.** `ensureSchema` runs a
 * plain `CREATE TABLE IF NOT EXISTS` before every read/write — cheap
 * and idempotent on Neon's HTTP driver, and this repo has no migration
 * runner to hang a "real" migration off of (same "no tooling exists yet,
 * so do the honest minimum" reasoning as `lib/overrides-server.ts`'s
 * on-disk JSON file, just backed by a real table instead of a file this
 * time). `schemaEnsured` only caches "have we already confirmed the
 * table exists this warm instance" — a cold start just re-runs the
 * cheap `CREATE TABLE IF NOT EXISTS` once more, harmlessly.
 *
 * **Never throws — every export returns an honest outcome object.**
 * Mirrors this app's existing Blob-route shape exactly:
 * `{ configured: false, error }` when `DATABASE_URL` isn't set (never a
 * bare 500, and never silently treated as "empty session" — those are
 * different, distinguishable outcomes so the client can tell "nothing's
 * saved yet" apart from "the database itself isn't reachable"), or
 * `{ ok: false, error }` for a real query failure after the connection
 * itself resolved.
 */
import { DATABASE_UNCONFIGURED_MESSAGE, getSkidmarksSql } from "./db";

export const SKIDMARKS_STUDIO_OWNER_ID = process.env.SKIDMARKS_STUDIO_OWNER_ID?.trim() || "stuart";

let schemaEnsured = false;

async function ensureSchema(sql: ReturnType<typeof getSkidmarksSql>): Promise<void> {
  if (schemaEnsured || !sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS skidmarks_sessions (
      owner_id TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  schemaEnsured = true;
}

export type LoadSkidmarksSessionOutcome =
  | { configured: true; state: unknown; updatedAt: string | null }
  | { configured: false; error: string };

/**
 * Reads Stuart's one durable session row. `state: null` (with
 * `configured: true`) is the honest, real "nothing saved to Neon yet"
 * outcome — a brand-new environment, or one where Stuart simply hasn't
 * used Skidmarks yet — distinct from `configured: false`, which means
 * the database connection itself isn't set up at all.
 */
export async function loadSkidmarksSession(): Promise<LoadSkidmarksSessionOutcome> {
  const sql = getSkidmarksSql();
  if (!sql) {
    return { configured: false, error: DATABASE_UNCONFIGURED_MESSAGE };
  }
  try {
    await ensureSchema(sql);
    const rows = (await sql`
      SELECT state, updated_at FROM skidmarks_sessions
      WHERE owner_id = ${SKIDMARKS_STUDIO_OWNER_ID}
      LIMIT 1
    `) as { state: unknown; updated_at: string }[];
    const row = rows[0];
    return { configured: true, state: row?.state ?? null, updatedAt: row?.updated_at ?? null };
  } catch (err) {
    return {
      configured: false,
      error: err instanceof Error ? err.message : "Could not read the Skidmarks session from Neon.",
    };
  }
}

export type SaveSkidmarksSessionOutcome =
  | { ok: true; updatedAt: string }
  /** `configured: false` — Neon isn't connected in this environment at
   * all (honest, expected). `configured: true` — the connection itself
   * resolved but the query/upsert genuinely failed (a real bug/outage).
   * Kept as two distinguishable outcomes, not one flat `error` string,
   * so `lib/skidmarks.ts`'s client-side sync-status indicator can show
   * "not saving here" rather than "broken" for the former. */
  | { ok: false; configured: false; error: string }
  | { ok: false; configured: true; error: string };

/**
 * Upserts Stuart's one durable session row with the *entire* current
 * client-side state (bands/session/removedSeedBandIds — see
 * `lib/skidmarks.ts`'s `SkidmarksState`) — a full replace, not a
 * partial merge/patch. That's deliberate: the client
 * (`lib/skidmarks.ts`'s `persist()`) always pushes its own complete,
 * already-normalized in-memory state, the same "last write wins on the
 * whole object" shape this app's `localStorage` mirror always had, just
 * durable now. `state` is typed `unknown` here on purpose — this module
 * has no business re-validating Skidmarks' own domain shape (that's
 * `lib/skidmarks.ts`'s `normalizeState`'s job, on the read side, the
 * same way a corrupt/legacy `localStorage` blob was always handled);
 * this is just the durable-storage half.
 */
export async function saveSkidmarksSession(state: unknown): Promise<SaveSkidmarksSessionOutcome> {
  const sql = getSkidmarksSql();
  if (!sql) {
    return { ok: false, configured: false, error: DATABASE_UNCONFIGURED_MESSAGE };
  }
  try {
    await ensureSchema(sql);
    const rows = (await sql`
      INSERT INTO skidmarks_sessions (owner_id, state, updated_at)
      VALUES (${SKIDMARKS_STUDIO_OWNER_ID}, ${JSON.stringify(state)}::jsonb, now())
      ON CONFLICT (owner_id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
      RETURNING updated_at
    `) as { updated_at: string }[];
    return { ok: true, updatedAt: rows[0]?.updated_at ?? new Date().toISOString() };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err instanceof Error ? err.message : "Could not save the Skidmarks session to Neon.",
    };
  }
}
