/**
 * Shared body of the one-time seeds for Skidmarks episodes and shorts
 * (`scripts/seed-deck-items-skidmarks-episodes.ts`,
 * `scripts/seed-deck-items-adult-shorts.ts`). Same steps and guards as
 * `scripts/seed-deck-items-characters.ts`; not run on its own.
 *
 * Connection: **`DECK_DATABASE_URL` only** (the Deck Neon database). It
 * deliberately never reads `DATABASE_URL`, which on some machines points
 * at a different project's database.
 *
 * - `--dry-run`: every query runs inside a READ ONLY Postgres
 *   transaction, so it cannot write even by mistake. Prints exactly what
 *   a real run would insert, and whether a real run would refuse.
 * - `--write`: one INSERT, which re-checks inside the same statement that
 *   no rows of this kind exist yet and that the session row is still at
 *   the revision that was read. A save landing in between (or a second
 *   run) makes it insert nothing instead of something stale.
 * - Neither flag: prints usage and exits. Nothing runs by default.
 */
import { neon } from "@neondatabase/serverless";
import type { DeckItemKind } from "../lib/deckItems";
import { formatDeckItemSeedTree, type DeckItemSeedPlan } from "../lib/deckItemSeedPlan";

export interface SeedKindOptions {
  /** Script file name, for the usage text. */
  script: string;
  kind: DeckItemKind;
  /** Plural shown to Stuart ("Skidmarks episodes", "shorts"). */
  label: string;
  /** Heading in the folder tree ("Episodes", "Shorts"). */
  treeHeading: string;
  /** Which part of the session state holds the list, e.g. `["skidmarksEpisodes", "episodes"]`. */
  statePath: [string, string];
  plan: (list: unknown) => DeckItemSeedPlan;
}

function usage(script: string): never {
  console.log(
    [
      "Usage:",
      `  npx vite-node scripts/${script} --dry-run [--owner stuart]`,
      `  npx vite-node scripts/${script} --write   [--owner stuart]`,
      "Needs DECK_DATABASE_URL for the Deck Neon database (DATABASE_URL is never read).",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(script: string, argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const write = argv.includes("--write");
  if (dryRun === write) usage(script);
  const at = argv.indexOf("--owner");
  const owner = at >= 0 ? argv[at + 1] : process.env.SKIDMARKS_STUDIO_OWNER_ID?.trim() || "stuart";
  if (!owner || owner.startsWith("--")) usage(script);
  return { dryRun, owner };
}

export async function runDeckItemSeed(opts: SeedKindOptions): Promise<void> {
  const { dryRun, owner } = parseArgs(opts.script, process.argv.slice(2));
  const conn = process.env.DECK_DATABASE_URL?.trim();
  if (!conn) {
    console.error("DECK_DATABASE_URL is not set.");
    process.exit(2);
  }
  const sql = neon(conn);
  const [outerKey, innerKey] = opts.statePath;
  console.log(`Seed deck_items ${opts.label} (kind "${opts.kind}"): ${dryRun ? "DRY RUN (read-only, nothing will be written)" : "WRITE"}`);
  console.log(`Owner: ${owner}`);

  // 1. Read the session and check the tables, read-only.
  const [sessionRows, tableRows] = (await sql.transaction(
    [
      sql`SELECT state->${outerKey}::text->${innerKey}::text AS list, revision, updated_at
          FROM skidmarks_sessions WHERE owner_id = ${owner} LIMIT 1`,
      sql`SELECT to_regclass('deck_items') IS NOT NULL AS has_items,
                 to_regclass('deck_item_history') IS NOT NULL AS has_history`,
    ],
    { readOnly: true },
  )) as [
    { list: unknown; revision: string | number; updated_at: unknown }[],
    { has_items: boolean; has_history: boolean }[],
  ];

  const session = sessionRows[0];
  if (!session) {
    console.error(`No skidmarks_sessions row for owner "${owner}". Nothing to seed.`);
    process.exit(1);
  }
  const sessionRevision = Number(session.revision);
  const updatedAt = session.updated_at instanceof Date ? session.updated_at.toISOString() : String(session.updated_at);
  console.log(`Session row: revision ${sessionRevision}, updated_at ${updatedAt} (UTC)`);

  const tablesReady = tableRows[0]?.has_items === true && tableRows[0]?.has_history === true;
  let existing = { total: 0, live: 0 };
  if (tablesReady) {
    const [countRows] = (await sql.transaction(
      [
        sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL)::int AS live
            FROM deck_items WHERE owner_id = ${owner} AND kind = ${opts.kind}`,
      ],
      { readOnly: true },
    )) as [{ total: number; live: number }[]];
    existing = { total: Number(countRows[0]?.total ?? 0), live: Number(countRows[0]?.live ?? 0) };
  }

  // 2. Plan.
  const plan = opts.plan(session.list);
  console.log("");
  if (plan.sessionHasNoList) console.log(`The session has no ${outerKey}.${innerKey} list.`);
  console.log(`Would insert ${plan.rows.length} ${opts.label} row(s), revision 1, folder "${plan.folder}":`);
  for (const r of plan.rows) console.log(`    - ${r.itemId}  ${r.title || "(no title)"}`);
  if (plan.skipped.length > 0) {
    console.log(`Skipped ${plan.skipped.length} entr${plan.skipped.length === 1 ? "y" : "ies"}:`);
    for (const s of plan.skipped) console.log(`    - #${s.index}: ${s.reason}`);
  }
  console.log("");
  console.log(formatDeckItemSeedTree(plan, opts.treeHeading));
  console.log("");

  // 3. Refusals (reported in a dry run too).
  const refusals: string[] = [];
  if (!tablesReady) refusals.push("deck_items / deck_item_history don't exist yet. Run db/migrations/2026-09-30_deck_items.sql first.");
  if (existing.total > 0) {
    refusals.push(`deck_items already has ${existing.total} ${opts.kind} row(s) for "${owner}" (${existing.live} live). The seed only runs once.`);
  }
  if (plan.rows.length === 0) refusals.push(`There are no ${opts.label} to seed.`);

  if (dryRun) {
    if (refusals.length > 0) {
      console.log("A real run would REFUSE right now:");
      for (const r of refusals) console.log(`  - ${r}`);
    } else {
      console.log("A real run would go ahead. Nothing was written (dry run).");
    }
    return;
  }

  if (refusals.length > 0) {
    console.error("Refusing to seed:");
    for (const r of refusals) console.error(`  - ${r}`);
    process.exit(1);
  }

  // 4. Write: one statement, guarded again inside itself.
  const payload = JSON.stringify(plan.rows.map((r) => ({ item_id: r.itemId, folder: r.folder, data: r.data })));
  const inserted = (await sql`
    INSERT INTO deck_items (owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at)
    SELECT ${owner}, ${opts.kind}, x.item_id, x.folder, x.data, 1, now(), NULL
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(item_id text, folder text, data jsonb)
    WHERE NOT EXISTS (SELECT 1 FROM deck_items WHERE owner_id = ${owner} AND kind = ${opts.kind})
      AND EXISTS (SELECT 1 FROM skidmarks_sessions WHERE owner_id = ${owner} AND revision = ${sessionRevision})
    RETURNING item_id, folder
  `) as { item_id: string; folder: string }[];

  if (inserted.length === 0) {
    console.error(
      `Inserted nothing: either ${opts.kind} rows appeared meanwhile, or the session was saved since it was read ` +
        `(it is no longer at revision ${sessionRevision}). Run the dry run again.`,
    );
    process.exit(1);
  }
  console.log(`Inserted ${inserted.length} ${opts.label} row(s) into deck_items for "${owner}".`);
}
