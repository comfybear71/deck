/**
 * ============================================================================
 * ONE-OFF ROUTE — DELETE AFTER USE.
 * Remove this folder, `lib/deckCopyBlobTreeAuth.ts` and
 * `lib/deckBlobMovePlan207.ts` once the copy below has been run once.
 * ============================================================================
 *
 * Runs the one-time "copy the old flat Blob pictures into the readable
 * deck/ tree" job (`scripts/copy-blob-to-deck-tree.ts`, PR #215) on
 * Vercel, because only Vercel has `BLOB_READ_WRITE_TOKEN`. It calls the
 * very same code as the CLI (`lib/deckBlobCopyRun.ts`) with the approved
 * 207-file plan bundled in `lib/deckBlobMovePlan207.ts`, the app's own
 * Neon connection (`lib/db.ts`: `DATABASE_URL`, else
 * `DATABASE_URL_UNPOOLED`) and owner (`SKIDMARKS_STUDIO_OWNER_ID`,
 * "stuart" by default).
 *
 * - `GET` — dry run. Reads the database inside a READ ONLY transaction
 *   and looks at Blob with plain public HEADs. Writes nothing. Returns
 *   the summary, every file old -> new, and every database field that
 *   would change. `?blobCheck=0` skips the HEADs.
 * - `POST ?write=1` — the script's `--write`: HEAD every source with the
 *   token, copy each file (`allowOverwrite: false`; a byte-identical copy
 *   already there is reused, a different file on that name moves it to
 *   `-v2`…), then ONE compare-and-swap SQL statement that updates the
 *   session row and the affected `deck_items` rows with history backups.
 *   Never deletes anything. Production deployment only.
 *   If the copying runs close to the time limit the response is 202 with
 *   `nextCursor`; POST again with `?write=1&cursor=<nextCursor>` (earlier
 *   files are re-checked and reused, never copied twice). The database is
 *   only touched in the call that finishes the copying.
 *
 * Auth: `Authorization: Bearer <proof>`, see `lib/deckCopyBlobTreeAuth.ts`.
 * Anything else gets 401 before any database or Blob call.
 */
import { NextResponse } from "next/server";
import { buildUrlMap } from "@/lib/deckBlobCopyPlan";
import {
  COPY_RUN_HOST,
  CopyRunConflictError,
  checkBlobPublicly,
  commitLinks,
  copyRow,
  countOldLinksLeft,
  dbRefusals,
  headSources,
  inBatches,
  loadPlan,
  pathOf,
  planDb,
  readDbSnapshot,
  resultCsv,
  summarizePlan,
  writeTokenProblem,
  type CopyOutcome,
  type DbPlan,
  type DbSnapshot,
  type LoadedPlan,
  type PlanSummary,
} from "@/lib/deckBlobCopyRun";
import { MOVE_PLAN_207_CSV, MOVE_PLAN_207_SHA256 } from "@/lib/deckBlobMovePlan207";
import { isCopyBlobTreeAuthorized } from "@/lib/deckCopyBlobTreeAuth";
import { DATABASE_UNCONFIGURED_MESSAGE, getSkidmarksSql, resolveConnectionString } from "@/lib/db";
import { SKIDMARKS_STUDIO_OWNER_ID } from "@/lib/skidmarksSession-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel's ceiling for this project's other long routes; copying stops starting new files well before it. */
export const maxDuration = 300;

const EXPECTED_ROWS = 207;
/** Stop starting new copies after this long and hand back a cursor. */
const COPY_BUDGET_MS = 200_000;
const ONE_OFF = "One-off route: delete app/api/deck/admin/copy-blob-tree after use.";

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json({ oneOff: ONE_OFF, ...body }, { status, headers: { "cache-control": "no-store" } });

function unauthorized() {
  return json({ ok: false, error: "Unauthorized." }, 401);
}

interface Prepared {
  sql: NonNullable<ReturnType<typeof getSkidmarksSql>>;
  plan: LoadedPlan;
  owner: string;
  snap: DbSnapshot;
  dbPlan: DbPlan;
  refused: string[];
  summary: PlanSummary;
}

/** Auth, plan, read-only database snapshot and the planned changes. */
async function prepare(request: Request): Promise<Prepared | { response: NextResponse }> {
  if (!isCopyBlobTreeAuthorized(request.headers.get("authorization"), resolveConnectionString())) return { response: unauthorized() };
  const sql = getSkidmarksSql();
  if (!sql) return { response: json({ ok: false, error: DATABASE_UNCONFIGURED_MESSAGE }, 503) };

  const plan = loadPlan(MOVE_PLAN_207_CSV, EXPECTED_ROWS);
  if (plan.problems.length > 0) return { response: json({ ok: false, error: "The bundled plan has problems.", problems: plan.problems }, 500) };

  const owner = SKIDMARKS_STUDIO_OWNER_ID;
  const snap = await readDbSnapshot(sql, owner);
  if (!snap) return { response: json({ ok: false, error: `No skidmarks_sessions row for owner "${owner}".` }, 409) };

  const dbPlan = planDb(snap, buildUrlMap(plan.rows, (r) => r.new, COPY_RUN_HOST));
  return { sql, plan, owner, snap, dbPlan, refused: dbRefusals(dbPlan), summary: summarizePlan(plan.rows, dbPlan) };
}

function describePlan(p: Prepared) {
  return {
    owner: p.owner,
    store: COPY_RUN_HOST,
    plan: { rows: p.plan.rows.length, sha256: MOVE_PLAN_207_SHA256, bySource: p.plan.bySource, byGenre: p.plan.byGenre },
    session: { revision: p.snap.sessionRevision, lastSavedUtc: p.snap.sessionUpdatedAt },
    summary: p.summary,
    dbChanges: p.dbPlan.planned.map((c) => ({
      table: c.table,
      key: c.key,
      fields: c.changes.map((f) => ({ field: f.field, links: f.links.map(([from, to]) => ({ from: pathOf(from), to: pathOf(to) })) })),
    })),
  };
}

export async function GET(request: Request) {
  try {
    const p = await prepare(request);
    if ("response" in p) return p.response;
    const blobCheck = new URL(request.url).searchParams.get("blobCheck") !== "0";
    const blob = blobCheck ? await checkBlobPublicly(p.plan.rows) : null;
    const wouldRefuse = [...p.refused, ...(blob && blob.missingSources > 0 ? [`${blob.missingSources} source file(s) are missing on Blob.`] : [])];
    return json({
      ok: wouldRefuse.length === 0,
      mode: "dry-run",
      wroteNothing: true,
      ...describePlan(p),
      blob: blob ? { checked: true, missingSources: blob.missingSources, takenTargets: blob.takenTargets } : { checked: false },
      wouldRefuse,
      files: p.plan.rows.map((r) => ({ line: r.line, old: r.old, new: r.new, owner: r.owner, role: r.role, bytes: r.bytes, note: blob?.notes.get(r.line) ?? null })),
      next: wouldRefuse.length === 0 ? "POST ?write=1 with the same Authorization header to copy and update the links." : "Fix the refusals first.",
    });
  } catch (err) {
    return json({ ok: false, mode: "dry-run", wroteNothing: true, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  const log: string[] = [];
  const say = (line: string) => {
    log.push(line);
    console.log(`[copy-blob-tree] ${line}`);
  };
  let stage: "checks" | "copying" | "database" | "check" = "checks";
  try {
    const url = new URL(request.url);
    // Auth first, before anything else is even looked at.
    if (!isCopyBlobTreeAuthorized(request.headers.get("authorization"), resolveConnectionString())) return unauthorized();
    if (url.searchParams.get("write") !== "1") return json({ ok: false, error: "POST needs ?write=1. Use GET for the dry run." }, 400);
    if (process.env.VERCEL_ENV !== "production") {
      return json({ ok: false, error: "Writes only run on the production deployment. Use GET for a dry run here." }, 403);
    }
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    const tokenProblem = writeTokenProblem(token);
    if (tokenProblem || !token) return json({ ok: false, error: `${tokenProblem} Nothing was copied or written.` }, 503);

    const p = await prepare(request);
    if ("response" in p) return p.response;
    const rows = p.plan.rows;
    const cursorRaw = url.searchParams.get("cursor") ?? "0";
    const cursor = Number(cursorRaw);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > rows.length) return json({ ok: false, error: `cursor must be 0..${rows.length}.` }, 400);
    if (p.refused.length > 0) return json({ ok: false, error: "A real run refuses; nothing was copied or written.", refused: p.refused, ...describePlan(p) }, 409);

    say(`Session row: revision ${p.snap.sessionRevision}, last saved ${p.snap.sessionUpdatedAt} (UTC). Starting at file ${cursor}/${rows.length}.`);
    say("Checking every source file with the token...");
    const sources = await headSources(rows, token, say);

    stage = "copying";
    const claimed = new Set(rows.map((r) => r.new));
    const finalPath = new Map<number, string>();
    const outcome = new Map<number, CopyOutcome>();
    const record = (i: number, res: { landed: string; outcome: CopyOutcome }) => {
      finalPath.set(rows[i].line, res.landed);
      outcome.set(rows[i].line, res.outcome);
      say(`  [${i + 1}/${rows.length}] ${res.outcome} ${rows[i].old} -> ${res.landed}`);
    };
    if (cursor > 0) {
      say(`Re-checking the ${cursor} file(s) copied by earlier calls (reused if identical, copied if somehow missing)...`);
      await inBatches(rows.slice(0, cursor), 6, async (r, i) => record(i, await copyRow(r, sources[i], claimed, token, say)));
    }
    say("Copying (never overwriting, never deleting)...");
    for (let i = cursor; i < rows.length; i++) {
      if (Date.now() - started > COPY_BUDGET_MS) {
        say(`Time budget reached; stopping before file ${i + 1}. Nothing was written to the database yet.`);
        return json(
          {
            ok: true,
            phase: "copying",
            done: false,
            nextCursor: i,
            filesLanded: finalPath.size,
            total: rows.length,
            next: `POST ?write=1&cursor=${i} with the same Authorization header to carry on.`,
            databaseWritten: false,
            log,
          },
          202,
        );
      }
      record(i, await copyRow(rows[i], sources[i], claimed, token, say));
    }
    const counts = {
      copied: [...outcome.values()].filter((o) => o === "copied").length,
      reused: [...outcome.values()].filter((o) => o === "reused").length,
      onVersionedName: rows.filter((r) => finalPath.get(r.line) !== r.new).length,
    };
    say(`Copies done: ${counts.copied} copied, ${counts.reused} reused, ${counts.onVersionedName} on a -vN name.`);

    stage = "database";
    say("Updating the database in one transaction...");
    const db = await commitLinks(p.sql, p.snap, rows, finalPath);
    say(
      `Done: ${db.sessions} session row (now revision ${db.session_revision ?? "unchanged"}), ${db.items} deck_items row(s), ` +
        `${db.item_history} deck_item_history row(s), ${db.session_history} session backup(s).`,
    );

    stage = "check";
    const oldLinksLeft = await countOldLinksLeft(p.sql, p.owner);
    say(`Old-folder links left in the session and deck_items: ${oldLinksLeft}. The original files were not touched.`);

    return json({
      ok: true,
      phase: "done",
      done: true,
      copies: counts,
      database: db,
      oldLinksLeft,
      originalsDeleted: 0,
      files: rows.map((r) => ({ old: r.old, new: finalPath.get(r.line), plannedNew: r.new, outcome: outcome.get(r.line) })),
      resultCsv: resultCsv(rows, finalPath, outcome),
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    say(`Stopped during ${stage}: ${message}`);
    const conflict = err instanceof CopyRunConflictError;
    return json(
      {
        ok: false,
        stage,
        error: message,
        databaseWritten: stage === "check" ? true : conflict || stage !== "database" ? false : "unknown",
        note:
          stage === "check"
            ? "The database update succeeded; only the after-check failed."
            : stage === "database" && !conflict
              ? "The update is one statement, so it either fully applied or not at all. Run the GET dry run: 0 database fields to change means it applied. Copies stay and are reused; no original was touched."
              : "Nothing was written to the database. Any copies already made stay and are reused on the next run; no original was touched.",
        log,
      },
      conflict ? 409 : 500,
    );
  }
}
