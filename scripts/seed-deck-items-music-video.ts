/**
 * ONE-TIME SEED for per-item saving, Music video (bands and songs). The
 * same steps as `scripts/seed-deck-items-characters.ts`. Run by hand,
 * never by the app, never on deploy.
 *
 * Reads the `bands` list and the song on the desk (`session.mp3`) from
 * Stuart's `skidmarks_sessions` row and inserts each band as one
 * `deck_items` row (kind `music-video-band`) and the desk's song, if there
 * is one, as one row (kind `music-video-song`), revision 1, folder `music-video`. Each band
 * member carries a `characterId` pointing at its character row (the live
 * `deck_items` character whose sourceKey is `mv:<member id>`); nothing
 * from the character is copied. Refuses to run if the owner already has
 * any band or song rows (live or deleted), if the tables haven't been
 * created, or if the session holds no bands.
 *
 *   # See what it would do. Read-only: every query runs inside a
 *   # READ ONLY Postgres transaction, so it cannot write even by mistake.
 *   # This is the default: with no flag it is a dry run.
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-music-video.ts
 *
 *   # Really insert (only after checking the dry run):
 *   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-music-video.ts --write
 *
 * Reads **only** `DECK_DATABASE_URL` (never `DATABASE_URL`, which on some
 * machines points at a different database). Options: `--owner <id>`
 * (default `SKIDMARKS_STUDIO_OWNER_ID` or `stuart`, same as the app).
 *
 * The real insert is one statement that also re-checks, inside the same
 * statement, that no band or song rows exist yet and that the session row
 * is still at the revision that was read, so a save landing in between
 * (or a second run) makes it insert nothing instead of something stale.
 */
import { neon } from "@neondatabase/serverless";
import { formatMusicVideoSeedTree, planMusicVideoSeed } from "../lib/musicVideoItemsSeed";

function usage(): never {
  console.log(
    [
      "Usage:",
      "  npx vite-node scripts/seed-deck-items-music-video.ts [--dry-run] [--owner stuart]   (default: dry run)",
      "  npx vite-node scripts/seed-deck-items-music-video.ts --write     [--owner stuart]",
      "Needs DECK_DATABASE_URL for the Deck Neon database (DATABASE_URL is never read).",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const write = argv.includes("--write");
  if (write && argv.includes("--dry-run")) usage();
  const known = new Set(["--write", "--dry-run", "--owner"]);
  const at = argv.indexOf("--owner");
  for (let i = 0; i < argv.length; i++) {
    if (i === at + 1 && at >= 0) continue;
    if (!known.has(argv[i])) usage();
  }
  const owner = at >= 0 ? argv[at + 1] : process.env.SKIDMARKS_STUDIO_OWNER_ID?.trim() || "stuart";
  if (!owner || owner.startsWith("--")) usage();
  return { dryRun: !write, owner };
}

async function main() {
  const { dryRun, owner } = parseArgs(process.argv.slice(2));
  const conn = process.env.DECK_DATABASE_URL?.trim();
  if (!conn) {
    console.error("DECK_DATABASE_URL is not set. (DATABASE_URL is deliberately never used.)");
    process.exit(2);
  }
  const sql = neon(conn);
  const mode = dryRun ? "DRY RUN (read-only, nothing will be written)" : "WRITE";
  console.log(`Seed deck_items Music video (bands, songs): ${mode}`);
  console.log(`Owner: ${owner}`);

  // 1. Read the session and check the tables, read-only.
  const [sessionRows, tableRows] = (await sql.transaction(
    [
      sql`SELECT jsonb_build_object(
                   'bands', state->'bands',
                   'removedSeedBandIds', state->'removedSeedBandIds',
                   'session', state->'session',
                   'characterLoras', state->'characterLoras'
                 ) AS studio,
                 revision, updated_at
          FROM skidmarks_sessions WHERE owner_id = ${owner} LIMIT 1`,
      sql`SELECT to_regclass('deck_items') IS NOT NULL AS has_items,
                 to_regclass('deck_item_history') IS NOT NULL AS has_history`,
    ],
    { readOnly: true },
  )) as [
    { studio: Record<string, unknown>; revision: string | number; updated_at: unknown }[],
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
  let characters: { id: string; sourceKey: string | null }[] = [];
  let charactersFrom = "the session's character list (no character rows yet)";
  if (tablesReady) {
    const [countRows, characterRows] = (await sql.transaction(
      [
        sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL)::int AS live
            FROM deck_items WHERE owner_id = ${owner} AND kind IN ('music-video-band', 'music-video-song')`,
        sql`SELECT item_id, data->>'sourceKey' AS source_key
            FROM deck_items WHERE owner_id = ${owner} AND kind = 'character' AND deleted_at IS NULL`,
      ],
      { readOnly: true },
    )) as [{ total: number; live: number }[], { item_id: string; source_key: string | null }[]];
    existing = { total: Number(countRows[0]?.total ?? 0), live: Number(countRows[0]?.live ?? 0) };
    if (characterRows.length > 0) {
      characters = characterRows.map((r) => ({ id: r.item_id, sourceKey: r.source_key }));
      charactersFrom = `${characterRows.length} live character row(s) in deck_items`;
    }
  }
  if (characters.length === 0) {
    const list = (session.studio.characterLoras as { characters?: unknown } | null)?.characters;
    characters = (Array.isArray(list) ? list : []).flatMap((c) =>
      c && typeof c === "object" && typeof (c as { id?: unknown }).id === "string"
        ? [{ id: (c as { id: string }).id, sourceKey: typeof (c as { sourceKey?: unknown }).sourceKey === "string" ? (c as { sourceKey: string }).sourceKey : null }]
        : [],
    );
  }
  console.log(`Member → character references from: ${charactersFrom}`);

  // 2. Plan.
  const plan = planMusicVideoSeed(session.studio, characters);
  console.log("");
  if (plan.sessionHasNoBands) console.log("The session has no bands list (the app would show only its built-in bands).");
  console.log(`Would insert ${plan.bands.length} band row(s) and ${plan.songs.length} song row(s), revision 1, folder "music-video":`);
  for (const b of plan.bands) {
    console.log(`  band ${b.itemId}  ${b.name || "(no name)"}  (${b.members.length} member(s), ${JSON.stringify(b.data).length} bytes)`);
    for (const m of b.members) console.log(`      member ${m.memberId}  ${m.name || "(no name)"}  → ${m.characterId ?? "no character row yet"}`);
  }
  for (const sg of plan.songs) {
    console.log(`  song ${sg.itemId}  ${sg.fileName}  band ${sg.bandId}  ${sg.clipCount} clip(s)  (${JSON.stringify(sg.data).length} bytes)`);
  }
  if (plan.songs.length === 0) console.log("  (no song on the desk right now, so no song rows; songs still switch on with the bands)");
  if (plan.removedSeedBandIds.length > 0) console.log(`Built-in bands deleted earlier (not seeded): ${plan.removedSeedBandIds.join(", ")}`);
  if (plan.skipped.length > 0) {
    console.log(`Skipped ${plan.skipped.length}:`);
    for (const s of plan.skipped) console.log(`    - ${s.what}: ${s.reason}`);
  }
  console.log("");
  console.log(formatMusicVideoSeedTree(plan));
  console.log("");

  // 3. Refusals (reported in a dry run too).
  const refusals: string[] = [];
  if (!tablesReady) refusals.push("deck_items / deck_item_history don't exist yet. Run db/migrations/2026-09-30_deck_items.sql first.");
  if (existing.total > 0) {
    refusals.push(`deck_items already has ${existing.total} band/song row(s) for "${owner}" (${existing.live} live). The seed only runs once.`);
  }
  if (plan.bands.length === 0) refusals.push("There are no bands to seed.");

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
  const payload = JSON.stringify([
    ...plan.bands.map((r) => ({ kind: "music-video-band", item_id: r.itemId, folder: r.folder, data: r.data })),
    ...plan.songs.map((r) => ({ kind: "music-video-song", item_id: r.itemId, folder: r.folder, data: r.data })),
  ]);
  const inserted = (await sql`
    INSERT INTO deck_items (owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at)
    SELECT ${owner}, x.kind, x.item_id, x.folder, x.data, 1, now(), NULL
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(kind text, item_id text, folder text, data jsonb)
    WHERE NOT EXISTS (SELECT 1 FROM deck_items WHERE owner_id = ${owner} AND kind IN ('music-video-band', 'music-video-song'))
      AND EXISTS (SELECT 1 FROM skidmarks_sessions WHERE owner_id = ${owner} AND revision = ${sessionRevision})
    RETURNING kind, item_id
  `) as { kind: string; item_id: string }[];

  if (inserted.length === 0) {
    console.error(
      "Inserted nothing: either band/song rows appeared meanwhile, or the session was saved since it was read " +
        `(it is no longer at revision ${sessionRevision}). Run the dry run again.`,
    );
    process.exit(1);
  }
  const bands = inserted.filter((r) => r.kind === "music-video-band").length;
  console.log(`Inserted ${bands} band row(s) and ${inserted.length - bands} song row(s) into deck_items for "${owner}".`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
