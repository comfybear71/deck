/**
 * ONE-TIME SEED for per-item saving: locations (2026-09-30). Run by
 * hand, never by the app, never on deploy.
 *
 * Reads `locations` from Stuart's `skidmarks_sessions` row, adds
 * Sunnybank's nine built-ins when Sunnybank has no saved locations yet,
 * and inserts each as one `deck_items` row (kind `location`, folder =
 * its genre, revision 1, id `loc_<genre>_<key>`). Each built-in picture
 * (a repo file under `public/skidmarks/sunnybanks/`) is first copied to
 * Deck Blob at `deck/sunnybank/locations/<location>.jpg`, and the row
 * points at that copy. Refuses if the owner already has any location
 * rows (live or deleted), or if the tables haven't been created.
 *
 *   # See what it would do. Read-only (READ ONLY transaction), no Blob:
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-locations.ts --dry-run
 *
 *   # Really copy the pictures and insert (only after checking the dry run,
 *   # and only with Stuart's yes). Also needs BLOB_READ_WRITE_TOKEN:
 *   DECK_DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... npx vite-node scripts/seed-deck-items-locations.ts --write
 *
 * Connection: **`DECK_DATABASE_URL` only**; `DATABASE_URL` is never read.
 * Blob copies never overwrite: an existing file at that name is reused.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { formatLocationSeedTree, planLocationSeed, type LocationSeedRow } from "../lib/deckLocationsSeed";

const SCRIPT = "seed-deck-items-locations.ts";
const KIND = "location";

function usage(): never {
  console.log(
    [
      "Usage:",
      `  npx vite-node scripts/${SCRIPT} --dry-run [--owner stuart]`,
      `  npx vite-node scripts/${SCRIPT} --write   [--owner stuart]   (also needs BLOB_READ_WRITE_TOKEN)`,
      "Needs DECK_DATABASE_URL for the Deck Neon database (DATABASE_URL is never read).",
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

/** Copies one repo picture into Blob (never overwriting) and returns its URL. */
async function copyPicture(row: LocationSeedRow): Promise<string> {
  const copy = row.blobCopy!;
  const { head, put } = await import("@vercel/blob");
  try {
    const existing = await head(copy.toPathname);
    console.log(`    = ${copy.toPathname} is already there, reused`);
    return existing.url;
  } catch {
    // Not there yet: upload below.
  }
  const bytes = await readFile(path.join(process.cwd(), "public", copy.fromPublicPath.replace(/^\//, "")));
  const blob = await put(copy.toPathname, bytes, {
    access: "public",
    contentType: copy.toPathname.endsWith(".png") ? "image/png" : "image/jpeg",
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  console.log(`    + ${copy.fromPublicPath} -> ${blob.pathname}`);
  return blob.url;
}

async function main() {
  const { dryRun, owner } = parseArgs(process.argv.slice(2));
  const conn = process.env.DECK_DATABASE_URL?.trim();
  if (!conn) {
    console.error("DECK_DATABASE_URL is not set.");
    process.exit(2);
  }
  const sql = neon(conn);
  console.log(`Seed deck_items locations (kind "${KIND}"): ${dryRun ? "DRY RUN (read-only, nothing will be written, no Blob)" : "WRITE"}`);
  console.log(`Owner: ${owner}`);

  // 1. Read the session and check the tables, read-only.
  const [sessionRows, tableRows] = (await sql.transaction(
    [
      sql`SELECT state->'locations' AS locations, revision, updated_at
          FROM skidmarks_sessions WHERE owner_id = ${owner} LIMIT 1`,
      sql`SELECT to_regclass('deck_items') IS NOT NULL AS has_items,
                 to_regclass('deck_item_history') IS NOT NULL AS has_history`,
    ],
    { readOnly: true },
  )) as [
    { locations: unknown; revision: string | number; updated_at: unknown }[],
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
            FROM deck_items WHERE owner_id = ${owner} AND kind = ${KIND}`,
      ],
      { readOnly: true },
    )) as [{ total: number; live: number }[]];
    existing = { total: Number(countRows[0]?.total ?? 0), live: Number(countRows[0]?.live ?? 0) };
  }

  // 2. Plan.
  const plan = planLocationSeed(session.locations);
  console.log("");
  if (plan.sessionHasNoList) console.log("The session has no locations list yet (nothing saved on any Locations row).");
  console.log(`Would insert ${plan.rows.length} location row(s), revision 1:`);
  for (const r of plan.rows) console.log(`    - ${r.itemId}  "${r.title}"  folder ${r.folder}  (${r.source})`);
  const copies = plan.rows.filter((r) => r.blobCopy);
  console.log(`Would copy ${copies.length} picture(s) into Blob first (never overwriting):`);
  for (const r of copies) console.log(`    - public${r.blobCopy!.fromPublicPath} -> ${r.blobCopy!.toPathname}`);
  if (plan.skipped.length > 0) {
    console.log(`Skipped ${plan.skipped.length} entr${plan.skipped.length === 1 ? "y" : "ies"}:`);
    for (const s of plan.skipped) console.log(`    - #${s.index}: ${s.reason}`);
  }
  console.log("");
  console.log(formatLocationSeedTree(plan));
  console.log("");

  // 3. Refusals (reported in a dry run too).
  const refusals: string[] = [];
  if (!tablesReady) refusals.push("deck_items / deck_item_history don't exist yet. Run db/migrations/2026-09-30_deck_items.sql first.");
  if (existing.total > 0) {
    refusals.push(`deck_items already has ${existing.total} ${KIND} row(s) for "${owner}" (${existing.live} live). The seed only runs once.`);
  }
  if (plan.rows.length === 0) refusals.push("There are no locations to seed.");
  if (!dryRun && copies.length > 0 && !process.env.BLOB_READ_WRITE_TOKEN) {
    refusals.push("BLOB_READ_WRITE_TOKEN is not set, so the pictures can't be copied into Blob.");
  }

  if (dryRun) {
    if (refusals.length > 0) {
      console.log("A real run would REFUSE right now:");
      for (const r of refusals) console.log(`  - ${r}`);
    } else {
      console.log("A real run would go ahead (it also needs BLOB_READ_WRITE_TOKEN for the picture copies). Nothing was written (dry run).");
    }
    return;
  }

  if (refusals.length > 0) {
    console.error("Refusing to seed:");
    for (const r of refusals) console.error(`  - ${r}`);
    process.exit(1);
  }

  // 4. Copy the pictures, then one guarded INSERT.
  console.log("Copying pictures:");
  const rows = [];
  for (const r of plan.rows) {
    const pictureUrl = r.blobCopy ? await copyPicture(r) : r.data.pictureUrl;
    rows.push({ item_id: r.itemId, folder: r.folder, data: { ...r.data, pictureUrl } });
  }
  const payload = JSON.stringify(rows);
  const inserted = (await sql`
    INSERT INTO deck_items (owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at)
    SELECT ${owner}, ${KIND}, x.item_id, x.folder, x.data, 1, now(), NULL
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(item_id text, folder text, data jsonb)
    WHERE NOT EXISTS (SELECT 1 FROM deck_items WHERE owner_id = ${owner} AND kind = ${KIND})
      AND EXISTS (SELECT 1 FROM skidmarks_sessions WHERE owner_id = ${owner} AND revision = ${sessionRevision})
    RETURNING item_id, folder
  `) as { item_id: string; folder: string }[];

  if (inserted.length === 0) {
    console.error(
      `Inserted nothing: either location rows appeared meanwhile, or the session was saved since it was read ` +
        `(it is no longer at revision ${sessionRevision}). The picture copies stay in Blob and are reused next time. Run the dry run again.`,
    );
    process.exit(1);
  }
  console.log(`Inserted ${inserted.length} location row(s) into deck_items for "${owner}".`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
