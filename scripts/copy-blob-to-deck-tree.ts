/**
 * ONE-TIME COPY of Deck's existing pictures from the old flat Blob
 * folders into the readable `deck/` tree, then ONE database transaction
 * that points the saved links at the copies. Run by hand, never by the
 * app, never on deploy.
 *
 *   skidmarks/member-photos/<uuid>.jpg -> deck/sunnybank/characters/shazza/plates/shazza-plate-03.jpg
 *   skidmarks/plate-stills/<uuid>.jpg  -> deck/music-video/characters/big-sexy/stills/big-sexy-still-07.jpg
 *   skidmarks/adult-shorts/<uuid>.jpg  -> deck/shorts/shorts/blonde-girl-1/blonde-girl-1-plate-02.jpg
 *
 * The old -> new list is the move plan CSV (default
 * /workspace/deck-blob-plan/move-plan-207.csv; header
 * `old,new,owner,role,also,also_in_song_archives,bytes`). Every new path
 * is checked against the layout in `lib/deckBlobCopyPlan.ts` (same shape
 * for every genre, no random tags) before anything else happens.
 *
 *   # Dry run (the default). Writes nothing anywhere: the database is
 *   # read inside a READ ONLY transaction, and Blob is only looked at
 *   # with plain public HEAD requests (no token needed).
 *   DECK_DATABASE_URL=... npx vite-node scripts/copy-blob-to-deck-tree.ts
 *
 *   # Really copy, then update the links (only after checking the dry run):
 *   DECK_DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     npx vite-node scripts/copy-blob-to-deck-tree.ts --write
 *
 * Options: `--plan <csv>`, `--owner <id>` (default `stuart`),
 * `--expect <n>` (default 207; `--expect any` to skip the count check),
 * `--no-blob-check` (dry run: skip the public HEAD requests).
 *
 * Only `DECK_DATABASE_URL` is read for the database. `DATABASE_URL` is
 * deliberately ignored so this can never hit a different database by
 * accident.
 *
 * What `--write` does, in order, and what it never does:
 * 1. Reads the session row and the `deck_items` rows that hold old links
 *    (read-only) and refuses if any old link isn't in the plan.
 * 2. Copies each file with `copy()`, `allowOverwrite: false`. If the name
 *    is taken by a byte-identical copy (a re-run) it reuses it; if it is
 *    taken by anything else it tries `-v2`, `-v3`… It never overwrites
 *    and NEVER deletes: the originals stay where they are (saved songs
 *    still point at about 41 of them).
 * 3. Writes a result CSV next to the plan with the final paths.
 * 4. One SQL statement (one transaction) that updates the session row
 *    and every affected `deck_items` row, each only if its revision is
 *    still the one read in step 1, saves the before-version of each
 *    `deck_items` row to `deck_item_history`, and keeps a
 *    `skidmarks_session_history` copy of the session before and after.
 *    If anything was saved in between, the whole statement fails and
 *    nothing in the database changes. Run it again: the copies from
 *    step 2 are reused, not duplicated.
 *
 * All the real work (database read, dry-run checks, the copy loop, the
 * one SQL statement) lives in `lib/deckBlobCopyRun.ts`, shared with the
 * one-off route `app/api/deck/admin/copy-blob-tree/route.ts` so the two
 * always run the same code. `--plan bundled` uses the copy of the plan
 * that ships with the app (`lib/deckBlobMovePlan207.ts`).
 */
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import {
  COPY_RUN_HOST,
  CopyRunConflictError,
  checkBlobPublicly,
  commitLinks,
  copyRow,
  countOldLinksLeft,
  dbRefusals,
  headSources,
  loadPlan,
  pathOf,
  planDb,
  readDbSnapshot,
  resultCsv,
  summarizePlan,
  writeTokenProblem,
  type CopyOutcome,
  type PlannedChange,
} from "../lib/deckBlobCopyRun";
import { buildUrlMap } from "../lib/deckBlobCopyPlan";
import { MOVE_PLAN_207_CSV } from "../lib/deckBlobMovePlan207";

const DEFAULT_PLAN = "/workspace/deck-blob-plan/move-plan-207.csv";
const DEFAULT_EXPECT = 207;
const HOST = COPY_RUN_HOST;

function usage(message?: string): never {
  if (message) console.error(message);
  console.log(
    [
      "Usage:",
      "  npx vite-node scripts/copy-blob-to-deck-tree.ts [--dry-run] [--plan file.csv|bundled] [--owner stuart] [--expect 207|any] [--no-blob-check]",
      "  npx vite-node scripts/copy-blob-to-deck-tree.ts --write   [--plan file.csv|bundled] [--owner stuart] [--expect 207|any]",
      "Needs DECK_DATABASE_URL (DATABASE_URL is ignored). --write also needs BLOB_READ_WRITE_TOKEN.",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const known = new Set(["--dry-run", "--write", "--plan", "--owner", "--expect", "--no-blob-check", "--help"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known.has(a)) usage(`Unknown option: ${a}`);
    if (a === "--plan" || a === "--owner" || a === "--expect") i++;
  }
  if (argv.includes("--help")) usage();
  const write = argv.includes("--write");
  if (write && argv.includes("--dry-run")) usage("Pick one of --dry-run or --write.");
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    if (at < 0) return undefined;
    const v = argv[at + 1];
    if (!v || v.startsWith("--")) usage(`${flag} needs a value.`);
    return v;
  };
  const expectRaw = value("--expect");
  const expect = expectRaw === "any" ? undefined : expectRaw ? Number(expectRaw) : DEFAULT_EXPECT;
  if (expect !== undefined && !Number.isInteger(expect)) usage("--expect must be a number or 'any'.");
  return {
    write,
    plan: value("--plan") ?? DEFAULT_PLAN,
    owner: value("--owner") ?? "stuart",
    expect,
    blobCheck: !argv.includes("--no-blob-check"),
  };
}

function printChanges(planned: PlannedChange[]) {
  for (const p of planned) {
    console.log(`  ${p.table} ${p.key}: ${p.changes.length} field(s)`);
    for (const c of p.changes) {
      for (const [from, to] of c.links) console.log(`    ${c.field}\n      ${pathOf(from)}\n   -> ${pathOf(to)}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (line: string) => console.log(line);
  const mode = args.write ? "WRITE (copies files, then one database transaction)" : "DRY RUN (nothing will be written anywhere)";
  console.log(`Copy old Blob pictures into the deck/ tree: ${mode}`);
  console.log(`Plan: ${args.plan === "bundled" ? "bundled (lib/deckBlobMovePlan207.ts)" : args.plan}`);
  console.log(`Owner: ${args.owner}`);
  console.log(`Store: ${HOST}`);

  // ---- 1. The plan --------------------------------------------------------
  const plan = loadPlan(args.plan === "bundled" ? MOVE_PLAN_207_CSV : fs.readFileSync(args.plan, "utf8"), args.expect);
  const rows = plan.rows;
  if (plan.problems.length > 0) {
    console.error(`The plan has ${plan.problems.length} problem(s); fix the CSV first:`);
    for (const p of plan.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\nPlan OK: ${rows.length} file(s) (${plan.bySource.map((s) => `${s.folder} ${s.count}`).join(", ")}).`);
  console.log(`New homes: ${plan.byGenre.map((g) => `deck/${g.genre} ${g.count}`).join(", ")}.`);

  // ---- 2. The database, read-only ------------------------------------------
  const conn = process.env.DECK_DATABASE_URL?.trim();
  if (!conn) {
    console.error("DECK_DATABASE_URL is not set. (DATABASE_URL is deliberately not used.)");
    process.exit(2);
  }
  const sql = neon(conn);
  const snap = await readDbSnapshot(sql, args.owner);
  if (!snap) {
    console.error(`No skidmarks_sessions row for owner "${args.owner}".`);
    process.exit(1);
  }
  console.log(`\nSession row: revision ${snap.sessionRevision}, last saved ${snap.sessionUpdatedAt} (UTC).`);

  const dbPlan = planDb(snap, buildUrlMap(rows, (r) => r.new, HOST));
  const refused = dbRefusals(dbPlan);
  const summary = summarizePlan(rows, dbPlan);

  // ---- 3. Blob, looked at only -----------------------------------------------
  const blob = !args.write && args.blobCheck ? (console.log("\nChecking Blob with public HEAD requests (read-only)..."), await checkBlobPublicly(rows)) : null;
  const missingSources = blob?.missingSources ?? 0;

  // ---- 4. Print the plan ---------------------------------------------------
  console.log(`\nFiles (${rows.length}), old -> new:`);
  for (const r of rows) {
    const note = blob?.notes.get(r.line);
    console.log(`  ${r.old}\n   -> ${r.new}${note ? `\n      ! ${note}` : ""}`);
  }
  console.log(`\nDatabase fields that would change:`);
  printChanges(dbPlan.planned);

  const pad = (s: string) => s.padEnd(34);
  console.log("\nSummary:");
  console.log(`  ${pad("Files to copy:")}${summary.filesToCopy}`);
  console.log(`  ${pad("Files referenced in the database:")}${summary.filesReferenced}`);
  if (summary.unreferenced.length > 0) console.log(`  ${pad("Files not referenced (still copied):")}${summary.unreferenced.length}\n      ${summary.unreferenced.join("\n      ")}`);
  console.log(`  ${pad("Session rows to update:")}${summary.sessionRowsToUpdate} (${summary.sessionFields} field(s), ${summary.sessionLinks} link(s))`);
  console.log(`  ${pad("deck_items rows to update:")}${summary.itemRowsToUpdate} (${summary.itemFields} field(s), ${summary.itemLinks} link(s))`);
  for (const [k, n] of Object.entries(summary.itemRowsByKind)) console.log(`      ${k}: ${n} row(s)`);
  if (blob) {
    console.log(`  ${pad("Sources missing on Blob:")}${blob.missingSources}`);
    console.log(`  ${pad("New names already taken:")}${blob.takenTargets}`);
  }
  console.log(`  ${pad("Originals deleted:")}0 (never)`);

  if (refused.length > 0 || missingSources > 0) {
    const all = [...refused, ...(missingSources > 0 ? [`${missingSources} source file(s) are missing on Blob.`] : [])];
    console.log(`\nA real run would REFUSE:`);
    for (const r of all) console.log(`  - ${r}`);
    process.exit(1);
  }
  if (!args.write) {
    console.log("\nDry run: nothing was copied, nothing was written. Run with --write to do it.");
    return;
  }

  // ---- 5. --write: copy -------------------------------------------------------
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const tokenProblem = writeTokenProblem(token);
  if (tokenProblem || !token) {
    console.error(`\n${tokenProblem} Nothing was copied or written.`);
    process.exit(2);
  }

  console.log("\nChecking every source file with the token...");
  const sources = await headSources(rows, token, log);

  const claimed = new Set(rows.map((r) => r.new));
  const finalPath = new Map<number, string>();
  const outcome = new Map<number, CopyOutcome>();
  console.log("Copying (never overwriting, never deleting)...");
  for (const [i, r] of rows.entries()) {
    const res = await copyRow(r, sources[i], claimed, token, log);
    finalPath.set(r.line, res.landed);
    outcome.set(r.line, res.outcome);
    console.log(`  [${i + 1}/${rows.length}] ${res.outcome} ${r.old} -> ${res.landed}`);
  }

  const planDir = args.plan === "bundled" ? process.cwd() : path.dirname(args.plan);
  const planBase = args.plan === "bundled" ? "move-plan-207" : path.basename(args.plan, ".csv");
  const resultFile = path.join(planDir, `${planBase}-result-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
  fs.writeFileSync(resultFile, resultCsv(rows, finalPath, outcome));
  const versioned = rows.filter((r) => finalPath.get(r.line) !== r.new);
  console.log(`\nCopies done: ${[...outcome.values()].filter((o) => o === "copied").length} copied, ${[...outcome.values()].filter((o) => o === "reused").length} reused, ${versioned.length} on a -vN name.`);
  console.log(`Result CSV: ${resultFile}`);

  // ---- 6. --write: one transaction ----------------------------------------------
  console.log(`\nUpdating the database in one transaction...`);
  let r0;
  try {
    r0 = await commitLinks(sql, snap, rows, finalPath);
  } catch (err) {
    console.error(`\n${err instanceof CopyRunConflictError ? err.message : err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(
    `Done: ${r0.sessions} session row (now revision ${r0.session_revision ?? "unchanged"}), ${r0.items} deck_items row(s), ` +
      `${r0.item_history} deck_item_history row(s), ${r0.session_history} session backup(s).`,
  );

  // ---- 7. Check -----------------------------------------------------------
  console.log(`Old-folder links left in the session and deck_items: ${await countOldLinksLeft(sql, args.owner)}.`);
  console.log("The original files were not touched.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
