/**
 * Server side of per-item saving (`GET`/`PUT`/`DELETE /api/deck/items`).
 * See `lib/deckItems.ts` for the why.
 *
 * **Never creates tables.** `deck_items` and `deck_item_history` come
 * from `db/migrations/2026-09-30_deck_items.sql`, run by hand. When they
 * aren't there every call returns `reason: "table-missing"` and the
 * client quietly carries on with the whole-session save, so merging or
 * deploying this can never write to the database on its own.
 *
 * Same owner handling as `/api/skidmarks/session`: this app has no
 * login, so rows are keyed by the one fixed studio owner id
 * (`SKIDMARKS_STUDIO_OWNER_ID`, "stuart" unless the env var says
 * otherwise).
 *
 * Every write is a compare-and-swap on `revision`. A caller that last saw
 * revision 3 can only write if the row is still at 3; otherwise nothing
 * is written and the caller gets the server's copy back (409 at the
 * route). A new item is written with `expectedRevision: 0`, which only
 * succeeds if no row with that id has ever existed. Each edit or delete
 * copies the version it replaces into `deck_item_history` in the same
 * statement, then trims that item's history to the newest
 * `DECK_ITEM_HISTORY_KEEP`.
 *
 * Never throws: every export returns an outcome object.
 */
import { normalizeCharacterLoraEntry } from "./characterLoras";
import { normalizeSunnyBanksWorkspace } from "./sunnyBanksWorkspace";
import { DATABASE_UNCONFIGURED_MESSAGE, getSkidmarksSql } from "./db";
import {
  DECK_ITEM_HISTORY_KEEP,
  DECK_ITEM_MAX_DATA_BYTES,
  DECK_ITEM_NEW_REVISION,
  DECK_ITEMS_TABLE_MISSING_MESSAGE,
  characterFolder,
  isValidDeckItemId,
  type DeckItemKind,
  type DeckItemRecord,
  type DeckItemTombstone,
} from "./deckItems";
import { SKIDMARKS_STUDIO_OWNER_ID } from "./skidmarksSession-server";

type Sql = NonNullable<ReturnType<typeof getSkidmarksSql>>;

export type DeckItemsFailure =
  | { ok: false; reason: "unconfigured"; error: string }
  | { ok: false; reason: "table-missing"; error: string }
  | { ok: false; reason: "invalid"; error: string }
  | { ok: false; reason: "error"; error: string };

export type ListDeckItemsOutcome =
  | {
      ok: true;
      items: DeckItemRecord[];
      deleted: DeckItemTombstone[];
      /** At least one row of this kind exists for the owner (live or deleted),
       * i.e. the one-time seed has run. Until then the client keeps the old
       * whole-session behaviour. */
      seeded: boolean;
    }
  | DeckItemsFailure;

export type WriteDeckItemOutcome =
  | { ok: true; item: DeckItemRecord }
  /** Nothing written: the row moved on (or already exists). `item` is the
   * server's copy (possibly soft-deleted), or `null` if there is no row. */
  | { ok: false; conflict: true; item: DeckItemRecord | null }
  | { ok: false; notFound: true }
  | DeckItemsFailure;

interface Row {
  item_id: string;
  folder: string;
  data: unknown;
  revision: number | string;
  updated_at: unknown;
  deleted_at: unknown;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

function toRevision(value: number | string): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function toRecord(row: Row): DeckItemRecord {
  return {
    itemId: row.item_id,
    folder: row.folder,
    data: row.data,
    revision: toRevision(row.revision),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIso(row.deleted_at),
  };
}

export function isDeckItemsTableMissingError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "42P01") return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /relation "?deck_item(s|_history)"? does not exist/i.test(message);
}

function failure(err: unknown, fallback: string): DeckItemsFailure {
  if (isDeckItemsTableMissingError(err)) {
    return { ok: false, reason: "table-missing", error: DECK_ITEMS_TABLE_MISSING_MESSAGE };
  }
  return { ok: false, reason: "error", error: err instanceof Error ? err.message : fallback };
}

function unconfigured(): DeckItemsFailure {
  return { ok: false, reason: "unconfigured", error: DATABASE_UNCONFIGURED_MESSAGE };
}

/**
 * Cleans and checks what a client sent for one item, and works out its
 * folder on the server (never trusting a folder from the client).
 */
export function prepareDeckItemData(
  kind: DeckItemKind,
  itemId: string,
  data: unknown,
): { ok: true; data: Record<string, unknown>; folder: string } | { ok: false; error: string } {
  if (!isValidDeckItemId(itemId)) return { ok: false, error: "Missing or malformed item id." };
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "Missing or malformed item data." };
  switch (kind) {
    case "character": {
      const entry = normalizeCharacterLoraEntry(data);
      if (!entry) return { ok: false, error: "That isn't a character card." };
      if (entry.id !== itemId) return { ok: false, error: "The card's id doesn't match the item id." };
      if (JSON.stringify(entry).length > DECK_ITEM_MAX_DATA_BYTES) return { ok: false, error: "That card is too big to save." };
      return { ok: true, data: entry as unknown as Record<string, unknown>, folder: characterFolder(entry.sourceKey) };
    }
    case "sunnybank-episode": {
      const episode = normalizeSunnyBanksWorkspace(data);
      if (!episode) return { ok: false, error: "That isn't a Sunnybank episode." };
      if (episode.id !== itemId) return { ok: false, error: "The episode's id doesn't match the item id." };
      if (JSON.stringify(episode).length > DECK_ITEM_MAX_DATA_BYTES) return { ok: false, error: "That episode is too big to save." };
      return { ok: true, data: episode as unknown as Record<string, unknown>, folder: "sunnybank" };
    }
  }
}

async function readRow(sql: Sql, ownerId: string, kind: DeckItemKind, itemId: string): Promise<DeckItemRecord | null> {
  const rows = (await sql`
    SELECT item_id, folder, data, revision, updated_at, deleted_at
    FROM deck_items
    WHERE owner_id = ${ownerId} AND kind = ${kind} AND item_id = ${itemId}
    LIMIT 1
  `) as Row[];
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Best-effort: a failed trim must never turn a good save into a failure. */
async function trimHistory(sql: Sql, ownerId: string, kind: DeckItemKind, itemId: string): Promise<void> {
  try {
    await sql`
      DELETE FROM deck_item_history
      WHERE owner_id = ${ownerId} AND kind = ${kind} AND item_id = ${itemId}
        AND id < COALESCE((
          SELECT id FROM deck_item_history
          WHERE owner_id = ${ownerId} AND kind = ${kind} AND item_id = ${itemId}
          ORDER BY id DESC OFFSET ${DECK_ITEM_HISTORY_KEEP - 1} LIMIT 1
        ), 0)
    `;
  } catch {
    // Deliberately silent: see the doc comment.
  }
}

/** Every row of one kind for the owner: live ones in `items`, soft-deleted ones as tombstones. */
export async function listDeckItems(kind: DeckItemKind, ownerId: string = SKIDMARKS_STUDIO_OWNER_ID): Promise<ListDeckItemsOutcome> {
  const sql = getSkidmarksSql();
  if (!sql) return unconfigured();
  try {
    const rows = (await sql`
      SELECT item_id, folder, data, revision, updated_at, deleted_at
      FROM deck_items
      WHERE owner_id = ${ownerId} AND kind = ${kind}
      ORDER BY data->>'createdAt' ASC NULLS LAST, item_id ASC
    `) as Row[];
    const records = rows.map(toRecord);
    return {
      ok: true,
      items: records.filter((r) => r.deletedAt === null),
      deleted: records.filter((r) => r.deletedAt !== null).map((r) => ({ itemId: r.itemId, revision: r.revision })),
      seeded: records.length > 0,
    };
  } catch (err) {
    return failure(err, "Could not read saved items.");
  }
}

/**
 * Writes one item if (and only if) the row is still at `expectedRevision`
 * (0 = brand new). Returns the saved row, or the server's copy on a
 * conflict.
 */
export async function putDeckItem(
  kind: DeckItemKind,
  itemId: string,
  data: unknown,
  expectedRevision: number,
  ownerId: string = SKIDMARKS_STUDIO_OWNER_ID,
): Promise<WriteDeckItemOutcome> {
  const prepared = prepareDeckItemData(kind, itemId, data);
  if (!prepared.ok) return { ok: false, reason: "invalid", error: prepared.error };
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return { ok: false, reason: "invalid", error: "expectedRevision must be a whole number, 0 for a new item." };
  }
  const sql = getSkidmarksSql();
  if (!sql) return unconfigured();
  const payload = JSON.stringify(prepared.data);
  try {
    let written: Row[];
    if (expectedRevision === DECK_ITEM_NEW_REVISION) {
      written = (await sql`
        INSERT INTO deck_items (owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at)
        VALUES (${ownerId}, ${kind}, ${itemId}, ${prepared.folder}, ${payload}::jsonb, 1, now(), NULL)
        ON CONFLICT (owner_id, kind, item_id) DO NOTHING
        RETURNING item_id, folder, data, revision, updated_at, deleted_at
      `) as Row[];
    } else {
      written = (await sql`
        WITH prior AS (
          SELECT owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at
          FROM deck_items
          WHERE owner_id = ${ownerId} AND kind = ${kind} AND item_id = ${itemId}
            AND revision = ${expectedRevision} AND deleted_at IS NULL
          FOR UPDATE
        ),
        written AS (
          UPDATE deck_items AS d
          SET folder = ${prepared.folder}, data = ${payload}::jsonb, revision = d.revision + 1, updated_at = now()
          FROM prior
          WHERE d.owner_id = prior.owner_id AND d.kind = prior.kind AND d.item_id = prior.item_id
          RETURNING d.item_id, d.folder, d.data, d.revision, d.updated_at, d.deleted_at
        ),
        saved AS (
          INSERT INTO deck_item_history (owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at)
          SELECT owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at FROM prior
          WHERE EXISTS (SELECT 1 FROM written)
        )
        SELECT item_id, folder, data, revision, updated_at, deleted_at FROM written
      `) as Row[];
    }
    if (written.length > 0) {
      if (expectedRevision !== DECK_ITEM_NEW_REVISION) await trimHistory(sql, ownerId, kind, itemId);
      return { ok: true, item: toRecord(written[0]) };
    }
    return { ok: false, conflict: true, item: await readRow(sql, ownerId, kind, itemId) };
  } catch (err) {
    return failure(err, "Could not save that item.");
  }
}

/**
 * Soft-deletes one item. Only ever called from a real delete tap (see
 * `lib/characterItems.ts`), never because a list was missing something.
 * With `expectedRevision`, refuses (conflict) if the item changed since
 * the caller saw it. Deleting an already-deleted item is a no-op success.
 */
export async function deleteDeckItem(
  kind: DeckItemKind,
  itemId: string,
  expectedRevision: number | undefined,
  ownerId: string = SKIDMARKS_STUDIO_OWNER_ID,
): Promise<WriteDeckItemOutcome> {
  if (!isValidDeckItemId(itemId)) return { ok: false, reason: "invalid", error: "Missing or malformed item id." };
  if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
    return { ok: false, reason: "invalid", error: "expectedRevision must be a whole number above 0." };
  }
  const sql = getSkidmarksSql();
  if (!sql) return unconfigured();
  const anyRevision = expectedRevision === undefined;
  const revision = expectedRevision ?? 0;
  try {
    const written = (await sql`
      WITH prior AS (
        SELECT owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at
        FROM deck_items
        WHERE owner_id = ${ownerId} AND kind = ${kind} AND item_id = ${itemId}
          AND deleted_at IS NULL AND (${anyRevision}::boolean OR revision = ${revision})
        FOR UPDATE
      ),
      written AS (
        UPDATE deck_items AS d
        SET deleted_at = now(), revision = d.revision + 1, updated_at = now()
        FROM prior
        WHERE d.owner_id = prior.owner_id AND d.kind = prior.kind AND d.item_id = prior.item_id
        RETURNING d.item_id, d.folder, d.data, d.revision, d.updated_at, d.deleted_at
      ),
      saved AS (
        INSERT INTO deck_item_history (owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at)
        SELECT owner_id, kind, item_id, folder, data, revision, updated_at, deleted_at FROM prior
        WHERE EXISTS (SELECT 1 FROM written)
      )
      SELECT item_id, folder, data, revision, updated_at, deleted_at FROM written
    `) as Row[];
    if (written.length > 0) {
      await trimHistory(sql, ownerId, kind, itemId);
      return { ok: true, item: toRecord(written[0]) };
    }
    const current = await readRow(sql, ownerId, kind, itemId);
    if (!current) return { ok: false, notFound: true };
    if (current.deletedAt !== null) return { ok: true, item: current };
    return { ok: false, conflict: true, item: current };
  } catch (err) {
    return failure(err, "Could not delete that item.");
  }
}
