import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { LINK_UPDATE_SQL } from "./deckBlobCopyPlan";

/**
 * Runs the copy job's one SQL statement against a real (in-memory,
 * WASM) Postgres. The earlier version passed every unit test but always
 * failed its own guard on the real database, because nothing ran the SQL.
 */
let db: PGlite;

const items = (revs: [string, number][]) =>
  JSON.stringify(revs.map(([id, revision]) => ({ kind: "character", item_id: id, revision, data: { u: "new" } })));

async function run(params: unknown[]) {
  await db.query("BEGIN");
  try {
    const r = await db.query(LINK_UPDATE_SQL, params);
    await db.query("COMMIT");
    return r.rows[0] as Record<string, unknown>;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE skidmarks_sessions (owner_id TEXT PRIMARY KEY, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), revision BIGINT NOT NULL DEFAULT 1);
    CREATE TABLE skidmarks_session_history (id BIGSERIAL PRIMARY KEY, owner_id TEXT NOT NULL, revision BIGINT NOT NULL, state JSONB NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE deck_items (owner_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL, folder TEXT NOT NULL, data JSONB NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ NULL, PRIMARY KEY (owner_id, kind, item_id));
    CREATE TABLE deck_item_history (id BIGSERIAL PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL, folder TEXT NOT NULL,
      data JSONB NOT NULL, revision INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now());
    INSERT INTO skidmarks_sessions VALUES ('stuart', '{"a":"old"}', now(), 1466);
    INSERT INTO skidmarks_session_history (owner_id, revision, state) VALUES ('stuart', 1466, '{"a":"old"}');
    INSERT INTO deck_items VALUES ('stuart','character','c1','sunnybank','{"u":"old"}',1,now(),null), ('stuart','character','c2','music-video','{"u":"old"}',1,now(),null);
  `);
});

describe("LINK_UPDATE_SQL on real Postgres", () => {
  it("updates the session and every item, with history, when nothing moved on", async () => {
    const r = await run(["stuart", 1466, items([["c1", 1], ["c2", 1]]), JSON.stringify({ a: "new" }), true, 1, 2]);
    expect(r).toMatchObject({ sessions: 1, items: 2, item_history: 2, session_history: 1, guard: 1 });
    expect(Number(r.session_revision)).toBe(1467);
    const live = await db.query("SELECT item_id, revision, data FROM deck_items ORDER BY item_id");
    expect(live.rows).toEqual([
      { item_id: "c1", revision: 2, data: { u: "new" } },
      { item_id: "c2", revision: 2, data: { u: "new" } },
    ]);
    const hist = await db.query("SELECT item_id, revision, data FROM deck_item_history ORDER BY item_id");
    expect(hist.rows).toEqual([
      { item_id: "c1", revision: 1, data: { u: "old" } },
      { item_id: "c2", revision: 1, data: { u: "old" } },
    ]);
    const s = await db.query("SELECT state, revision FROM skidmarks_sessions");
    expect(s.rows[0]).toMatchObject({ state: { a: "new" } });
  });

  it("writes nothing when an item was saved after it was read", async () => {
    await db.exec("UPDATE deck_items SET revision = 2 WHERE item_id = 'c2'");
    await expect(run(["stuart", 1466, items([["c1", 1], ["c2", 1]]), JSON.stringify({ a: "new" }), true, 1, 2])).rejects.toThrow(/division by zero/);
    const live = await db.query("SELECT item_id, data FROM deck_items ORDER BY item_id");
    expect(live.rows.map((r) => (r as { data: unknown }).data)).toEqual([{ u: "old" }, { u: "old" }]);
    expect((await db.query("SELECT count(*)::int AS n FROM deck_item_history")).rows[0]).toEqual({ n: 0 });
  });

  it("writes nothing when the session was saved after it was read", async () => {
    await expect(run(["stuart", 1465, items([["c1", 1]]), JSON.stringify({ a: "new" }), true, 1, 1])).rejects.toThrow(/division by zero/);
    expect((await db.query("SELECT state FROM skidmarks_sessions")).rows[0]).toEqual({ state: { a: "old" } });
    expect((await db.query("SELECT data FROM deck_items WHERE item_id = 'c1'")).rows[0]).toEqual({ data: { u: "old" } });
  });

  it("is a no-op once everything is already rewritten", async () => {
    const r = await run(["stuart", 1466, "[]", JSON.stringify({ a: "old" }), false, 0, 0]);
    expect(r).toMatchObject({ sessions: 0, items: 0, item_history: 0, session_history: 0, guard: 1 });
  });
});
