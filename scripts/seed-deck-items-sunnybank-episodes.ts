/**
 * ONE-TIME SEED for per-item saving, step 2 (Sunnybank episodes). Run by
 * hand, never by the app, never on deploy.
 *
 * Reads the saved episode cards (`sunnyBanks.workspaces`) from Stuart's
 * `skidmarks_sessions` row and inserts each one as a `deck_items` row
 * (kind `sunnybank-episode`, folder `sunnybank`, item id = the card's
 * own `id`, revision 1). A card with no pinned media folder yet gets one
 * from its name (`mediaSlug`, `deck/sunnybank/episodes/<mediaSlug>/`).
 * The live working copy is not a card and is never seeded.
 *
 * **Dry run by default.** With no flag it only reads, inside a READ ONLY
 * Postgres transaction, and prints exactly what a real run would insert.
 * Only `--write` writes.
 *
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-sunnybank-episodes.ts
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-sunnybank-episodes.ts --write
 *
 * Reads only `DECK_DATABASE_URL` (the Deck Neon database). It never falls
 * back to `DATABASE_URL`, which on some machines points somewhere else.
 *
 * Options: `--owner <id>` (default `SKIDMARKS_STUDIO_OWNER_ID` or
 * `stuart`, same as the app).
 *
 * Refuses to write if the tables don't exist, if the owner already has
 * any `sunnybank-episode` rows (live or deleted), or if there are no
 * cards. The insert is one statement that re-checks, inside itself, that
 * no episode rows exist yet and that the session row is still at the
 * revision that was read, so a save landing in between (or a second run)
 * makes it insert nothing instead of something stale.
 */
import { neon } from "@neondatabase/serverless";
import { planSunnybankEpisodeSeed } from "../lib/deckItemsSeed";

const KIND = "sunnybank-episode";
const FOLDER = "sunnybank";

function usage(): never {
  console.log(
    [
      "Usage:",
      "  npx vite-node scripts/seed-deck-items-sunnybank-episodes.ts           [--owner stuart]   (dry run, read-only)",
      "  npx vite-node scripts/seed-deck-items-sunnybank-episodes.ts --write   [--owner stuart]",
      "Needs DECK_DATABASE_URL for the Deck Neon database.",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const known = new Set(["--write", "--dry-run", "--owner"]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--owner") i++;
    else if (!known.has(argv[i])) usage();
  }
  const write = argv.includes("--write");
  if (write && argv.includes("--dry-run")) usage();
  const at = argv.indexOf("--owner");
  const owner = at >= 0 ? argv[at + 1] : process.env.SKIDMARKS_STUDIO_OWNER_ID?.trim() || "stuart";
  if (!owner || owner.startsWith("--")) usage();
  return { dryRun: !write, owner };
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

async function main() {
  const { dryRun, owner } = parseArgs(process.argv.slice(2));
  const conn = process.env.DECK_DATABASE_URL?.trim();
  if (!conn) {
    console.error("DECK_DATABASE_URL is not set.");
    process.exit(2);
  }
  const sql = neon(conn);
  console.log(`Seed deck_items Sunnybank episodes: ${dryRun ? "DRY RUN (read-only, nothing will be written)" : "WRITE"}`);
  console.log(`Owner: ${owner}`);

  // 1. Read the session and check the tables, read-only.
  const [sessionRows, tableRows] = (await sql.transaction(
    [
      sql`SELECT state->'sunnyBanks' AS sunny_banks, revision, updated_at
          FROM skidmarks_sessions WHERE owner_id = ${owner} LIMIT 1`,
      sql`SELECT to_regclass('deck_items') IS NOT NULL AS has_items,
                 to_regclass('deck_item_history') IS NOT NULL AS has_history`,
    ],
    { readOnly: true },
  )) as [
    { sunny_banks: unknown; revision: string | number; updated_at: unknown }[],
    { has_items: boolean; has_history: boolean }[],
  ];

  const session = sessionRows[0];
  if (!session) {
    console.error(`No skidmarks_sessions row for owner "${owner}". Nothing to seed.`);
    process.exit(1);
  }
  const sessionRevision = Number(session.revision);
  console.log(`Session row: revision ${sessionRevision}, updated_at ${iso(session.updated_at)} (UTC)`);

  const tablesReady = tableRows[0]?.has_items === true && tableRows[0]?.has_history === true;
  let existing = { total: 0, live: 0 };
  if (tablesReady) {
    const [countRows] = (await sql.transaction(
      [
        sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL)::int AS live
            FROM deck_items WHERE owner_id = ${owner} AND kind = ${KIND}`,
      ],
      { readOnly: true },
    )) as [{ total: number; live: number }[]];
    existing = { total: Number(countRows[0]?.total ?? 0), live: Number(countRows[0]?.live ?? 0) };
  }

  // 2. Plan.
  const plan = planSunnybankEpisodeSeed(session.sunny_banks);
  console.log("");
  if (plan.sessionHasNoSunnybank) {
    console.log("The session has no sunnyBanks value at all (no Sunnybank episodes and no live working copy saved).");
  } else {
    console.log(
      `Live working copy (not an item, not seeded): ${plan.liveTitle ? JSON.stringify(plan.liveTitle) : "(no name)"}`,
    );
  }
  console.log(`Would insert ${plan.rows.length} Sunnybank episode row(s), kind "${KIND}", folder "${FOLDER}", revision 1:`);
  for (const r of plan.rows) {
    console.log(
      `  - ${r.itemId}  ${JSON.stringify(r.label)}  saved ${new Date(r.savedAt).toISOString()} (UTC)  ` +
        `${r.acts} act(s), ${r.clips} clip(s), ${r.bytes} bytes  ` +
        `media deck/sunnybank/episodes/${r.mediaSlug}/${r.mediaSlugNew ? " (pinned now)" : ""}`,
    );
  }
  if (plan.skipped.length > 0) {
    console.log(`Skipped ${plan.skipped.length} entr${plan.skipped.length === 1 ? "y" : "ies"}:`);
    for (const s of plan.skipped) console.log(`    - #${s.index}: ${s.reason}`);
  }
  console.log("");

  // 3. Refusals (reported in a dry run too).
  const refusals: string[] = [];
  if (!tablesReady) refusals.push("deck_items / deck_item_history don't exist yet. Run db/migrations/2026-09-30_deck_items.sql first.");
  if (existing.total > 0) {
    refusals.push(`deck_items already has ${existing.total} Sunnybank episode row(s) for "${owner}" (${existing.live} live). The seed only runs once.`);
  }
  if (plan.rows.length === 0) refusals.push("There are no Sunnybank episodes to seed.");

  if (dryRun) {
    if (refusals.length > 0) {
      console.log("A real run (--write) would REFUSE right now:");
      for (const r of refusals) console.log(`  - ${r}`);
    } else {
      console.log("A real run (--write) would go ahead. Nothing was written (dry run).");
    }
    return;
  }

  if (refusals.length > 0) {
    console.error("Refusing to seed:");
    for (const r of refusals) console.error(`  - ${r}`);
    process.exit(1);
  }

  // 4. Write: one statement, guarded again inside itself.
  const payload = JSON.stringify(plan.rows.map((r) => ({ item_id: r.itemId, data: r.data })));
  const inserted = (await sql`
    INSERT INTO deck_items (owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at)
    SELECT ${owner}, ${KIND}, x.item_id, ${FOLDER}, x.data, 1, now(), NULL
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(item_id text, data jsonb)
    WHERE NOT EXISTS (SELECT 1 FROM deck_items WHERE owner_id = ${owner} AND kind = ${KIND})
      AND EXISTS (SELECT 1 FROM skidmarks_sessions WHERE owner_id = ${owner} AND revision = ${sessionRevision})
    RETURNING item_id
  `) as { item_id: string }[];

  if (inserted.length === 0) {
    console.error(
      "Inserted nothing: either episode rows appeared meanwhile, or the session was saved since it was read " +
        `(it is no longer at revision ${sessionRevision}). Run the dry run again.`,
    );
    process.exit(1);
  }
  console.log(`Inserted ${inserted.length} Sunnybank episode row(s) into deck_items for "${owner}".`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
