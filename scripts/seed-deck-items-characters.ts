/**
 * ONE-TIME SEED for per-item saving, step 1 (characters). Run by hand,
 * never by the app, never on deploy.
 *
 * Reads the `characterLoras` list from Stuart's `skidmarks_sessions`
 * row and inserts each card as one `deck_items` row (kind `character`,
 * revision 1, folder from its sourceKey prefix). Refuses to run if the
 * owner already has any character rows (live or deleted), if the tables
 * haven't been created (run `db/migrations/2026-09-30_deck_items.sql`
 * first), or if the session holds no character list.
 *
 *   # See what it would do. Read-only: every query runs inside a
 *   # READ ONLY Postgres transaction, so it cannot write even by mistake.
 *   DATABASE_URL=... npx vite-node scripts/seed-deck-items-characters.ts --dry-run
 *
 *   # Really insert (only after checking the dry run):
 *   DATABASE_URL=... npx vite-node scripts/seed-deck-items-characters.ts --write
 *
 * Options: `--owner <id>` (default `SKIDMARKS_STUDIO_OWNER_ID` or
 * `stuart`, same as the app). Running with neither `--dry-run` nor
 * `--write` only prints this usage.
 *
 * The real insert is one statement that also re-checks, inside the same
 * statement, that no character rows exist yet and that the session row
 * is still at the revision that was read, so a save landing in between
 * (or a second run) makes it insert nothing instead of something stale.
 */
import { neon } from "@neondatabase/serverless";
import { DECK_FOLDER_LABELS } from "../lib/deckItems";
import { DECK_FOLDER_ORDER, formatCharacterSeedTree, planCharacterSeed } from "../lib/deckItemsSeed";

function usage(): never {
  console.log(
    [
      "Usage:",
      "  npx vite-node scripts/seed-deck-items-characters.ts --dry-run [--owner stuart]",
      "  npx vite-node scripts/seed-deck-items-characters.ts --write   [--owner stuart]",
      "Needs DATABASE_URL (or DATABASE_URL_UNPOOLED) for the Deck Neon database.",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const write = argv.includes("--write");
  if (dryRun === write) usage();
  const at = argv.indexOf("--owner");
  const owner = at >= 0 ? argv[at + 1] : process.env.SKIDMARKS_STUDIO_OWNER_ID?.trim() || "stuart";
  if (!owner || owner.startsWith("--")) usage();
  return { dryRun, owner };
}

async function main() {
  const { dryRun, owner } = parseArgs(process.argv.slice(2));
  const conn = process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!conn) {
    console.error("DATABASE_URL is not set.");
    process.exit(2);
  }
  const sql = neon(conn);
  const mode = dryRun ? "DRY RUN (read-only, nothing will be written)" : "WRITE";
  console.log(`Seed deck_items characters: ${mode}`);
  console.log(`Owner: ${owner}`);

  // 1. Read the session and check the tables, read-only.
  const [sessionRows, tableRows] = (await sql.transaction(
    [
      sql`SELECT state->'characterLoras' AS character_loras, revision, updated_at
          FROM skidmarks_sessions WHERE owner_id = ${owner} LIMIT 1`,
      sql`SELECT to_regclass('deck_items') IS NOT NULL AS has_items,
                 to_regclass('deck_item_history') IS NOT NULL AS has_history`,
    ],
    { readOnly: true },
  )) as [
    { character_loras: unknown; revision: string | number; updated_at: unknown }[],
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
            FROM deck_items WHERE owner_id = ${owner} AND kind = 'character'`,
      ],
      { readOnly: true },
    )) as [{ total: number; live: number }[]];
    existing = { total: Number(countRows[0]?.total ?? 0), live: Number(countRows[0]?.live ?? 0) };
  }

  // 2. Plan.
  const plan = planCharacterSeed(session.character_loras);
  console.log("");
  if (plan.sessionHasNoCharacters) {
    console.log("The session has no characterLoras list (the app would show only the Skye seed).");
  }
  console.log(`Would insert ${plan.rows.length} character row(s), revision 1:`);
  for (const f of DECK_FOLDER_ORDER) {
    const ids = plan.rows.filter((r) => r.folder === f);
    console.log(`  ${DECK_FOLDER_LABELS[f]} (folder "${f}"): ${ids.length}`);
    for (const r of ids) console.log(`    - ${r.itemId}  ${r.name || "(no name)"}${r.sourceKey ? `  [${r.sourceKey}]` : ""}`);
  }
  if (plan.skipped.length > 0) {
    console.log(`Skipped ${plan.skipped.length} entr${plan.skipped.length === 1 ? "y" : "ies"}:`);
    for (const s of plan.skipped) console.log(`    - #${s.index}: ${s.reason}`);
  }
  console.log("");
  console.log(formatCharacterSeedTree(plan));
  console.log("");

  // 3. Refusals (reported in a dry run too).
  const refusals: string[] = [];
  if (!tablesReady) refusals.push("deck_items / deck_item_history don't exist yet. Run db/migrations/2026-09-30_deck_items.sql first.");
  if (existing.total > 0) {
    refusals.push(`deck_items already has ${existing.total} character row(s) for "${owner}" (${existing.live} live). The seed only runs once.`);
  }
  if (plan.rows.length === 0) refusals.push("There are no characters to seed.");

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
    SELECT ${owner}, 'character', x.item_id, x.folder, x.data, 1, now(), NULL
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(item_id text, folder text, data jsonb)
    WHERE NOT EXISTS (SELECT 1 FROM deck_items WHERE owner_id = ${owner} AND kind = 'character')
      AND EXISTS (SELECT 1 FROM skidmarks_sessions WHERE owner_id = ${owner} AND revision = ${sessionRevision})
    RETURNING item_id, folder
  `) as { item_id: string; folder: string }[];

  if (inserted.length === 0) {
    console.error(
      "Inserted nothing: either character rows appeared meanwhile, or the session was saved since it was read " +
        `(it is no longer at revision ${sessionRevision}). Run the dry run again.`,
    );
    process.exit(1);
  }
  console.log(`Inserted ${inserted.length} character row(s) into deck_items for "${owner}".`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
