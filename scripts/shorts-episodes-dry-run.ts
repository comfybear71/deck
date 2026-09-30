/**
 * DRY RUN ONLY: what Shorts' EPISODES row will show for Stuart's data,
 * and what the first save would write (2026-09-30). There is no write
 * mode: the change itself happens in code on load, and nothing is saved
 * until Stuart edits something.
 *
 *   DECK_DATABASE_URL=... npx vite-node scripts/shorts-episodes-dry-run.ts [--owner stuart]
 *
 * Every query runs inside a READ ONLY Postgres transaction. Connection:
 * `DECK_DATABASE_URL` only (`DATABASE_URL` is never read).
 */
import { neon } from "@neondatabase/serverless";
import type { DeckItemRecord } from "../lib/deckItems";
import { formatShortsEpisodesPlan, planShortsEpisodes } from "../lib/shortsEpisodesMigration";

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--owner");
  const owner = at >= 0 ? argv[at + 1] : process.env.SKIDMARKS_STUDIO_OWNER_ID?.trim() || "stuart";
  const conn = process.env.DECK_DATABASE_URL?.trim();
  if (!conn) {
    console.error("DECK_DATABASE_URL is not set.");
    process.exit(2);
  }
  const sql = neon(conn);
  const [sessionRows, itemRows] = (await sql.transaction(
    [
      sql`SELECT state->'adultShorts' AS adult_shorts, revision FROM skidmarks_sessions WHERE owner_id = ${owner} LIMIT 1`,
      sql`SELECT item_id, folder, data, revision, updated_at, deleted_at FROM deck_items
          WHERE owner_id = ${owner} AND kind = 'adult-short' ORDER BY item_id`,
    ],
    { readOnly: true },
  )) as [
    { adult_shorts: unknown; revision: number }[],
    { item_id: string; folder: string; data: unknown; revision: number; updated_at: string; deleted_at: string | null }[],
  ];
  if (!sessionRows[0]) {
    console.log(`No session row for owner "${owner}". Nothing to show.`);
    return;
  }
  const live: DeckItemRecord[] = itemRows
    .filter((r) => !r.deleted_at)
    .map((r) => ({ itemId: r.item_id, folder: r.folder, data: r.data, revision: r.revision, updatedAt: String(r.updated_at), deletedAt: null }) as DeckItemRecord);
  const deleted = itemRows.filter((r) => r.deleted_at).map((r) => r.item_id);
  console.log(`Shorts → episodes: DRY RUN (read-only, nothing will be written)`);
  console.log(`Owner: ${owner} · session revision ${sessionRows[0].revision} · adult-short rows: ${live.length} live, ${deleted.length} deleted`);
  console.log(formatShortsEpisodesPlan(planShortsEpisodes(sessionRows[0].adult_shorts, live, deleted)));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
