/**
 * READ-ONLY check (2026-09-30): with the old Shorts "Character" box gone,
 * does each Shorts girl's Cast card carry her pictures and look, and do
 * renders get exactly what the box used to hand them? There is no write
 * mode; nothing is migrated in the database (the Cast card reads it on load).
 *
 *   DECK_DATABASE_URL=... npx vite-node scripts/shorts-cast-check.ts [--owner stuart]
 *
 * One READ ONLY Postgres transaction. `DECK_DATABASE_URL` only (`DATABASE_URL` is never read).
 */
import { neon } from "@neondatabase/serverless";
import { normalizeAdultShortsState } from "../lib/adultShorts";
import { findShortsCastCharacter, resolveShortsRenderCharacter, shortsCastList, shortsCastPictures } from "../lib/shortsCast";
import { getSkidmarksSnapshot, type SkidmarksState } from "../lib/skidmarks";

const short = (u: string) => u.replace(/^https:\/\/[^/]+\//, "");

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
  const [rows] = (await sql.transaction(
    [sql`SELECT state, revision FROM skidmarks_sessions WHERE owner_id = ${owner} LIMIT 1`],
    { readOnly: true },
  )) as [{ state: Partial<SkidmarksState>; revision: number }[]];
  if (!rows[0]) {
    console.log(`No session row for owner "${owner}".`);
    return;
  }
  const state = { ...getSkidmarksSnapshot(), ...rows[0].state } as SkidmarksState;
  const adult = normalizeAdultShortsState(state.adultShorts);
  const own = adult?.character ?? { name: "", look: "", referenceUrls: [] };
  console.log(`Shorts Cast check: READ-ONLY, nothing written. Owner ${owner} · session revision ${rows[0].revision}`);
  console.log(`Old Character box (the open episode's own copy, kept as is): ${own.name || "(no name)"} · look "${own.look}" · ${own.referenceUrls.length} pictures`);
  for (const u of own.referenceUrls) console.log(`  ${short(u)}`);
  console.log(`Cast row: ${shortsCastList(state).map((c) => `${c.name} (${shortsCastPictures(c).length} pictures)`).join(", ") || "empty"}`);
  const cast = findShortsCastCharacter(state, own.name);
  if (!cast) {
    console.log(own.name ? `${own.name} is NOT on the Cast row.` : "No girl in the open episode.");
    return;
  }
  const castPics = shortsCastPictures(cast);
  const missing = own.referenceUrls.filter((u) => !castPics.includes(u));
  console.log(`Her Cast card (${cast.sourceKey}): look "${cast.look}" · pictures: ${castPics.map(short).join(", ") || "none"}`);
  console.log(missing.length ? `MISSING from her Cast card: ${missing.map(short).join(", ")}` : "Every picture from the old box is on her Cast card.");
  const r = resolveShortsRenderCharacter(state);
  const same = JSON.stringify(r) === JSON.stringify(own);
  console.log(
    same
      ? "Renders get exactly what the old box handed them (same name, look, pictures and order)."
      : `Renders now get: ${r.name} · look "${r.look}" · ${r.referenceUrls.map(short).join(", ")}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
