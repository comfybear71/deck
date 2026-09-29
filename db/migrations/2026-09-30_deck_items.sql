-- Per-item saving, step 1 (characters). Run BY HAND, once, against the
-- Deck Neon database. Nothing in the app runs this: merging or deploying
-- never writes to the database. Safe to run twice (IF NOT EXISTS
-- everywhere), and it only ever adds; it never changes or drops
-- skidmarks_sessions or any other existing table.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/2026-09-30_deck_items.sql
--
-- After this, run the one-time seed (dry run first):
--   npx vite-node scripts/seed-deck-items-characters.ts --dry-run
--   npx vite-node scripts/seed-deck-items-characters.ts --write

BEGIN;

-- One row per saved thing (a character today; episodes, bands, songs
-- and shorts later). The live copy of each item.
CREATE TABLE IF NOT EXISTS deck_items (
  owner_id   TEXT        NOT NULL,
  kind       TEXT        NOT NULL,
  item_id    TEXT        NOT NULL,
  folder     TEXT        NOT NULL,
  data       JSONB       NOT NULL,
  revision   INTEGER     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  PRIMARY KEY (owner_id, kind, item_id)
);

-- Listing one kind for one owner ("all live characters").
CREATE INDEX IF NOT EXISTS deck_items_owner_kind_idx
  ON deck_items (owner_id, kind)
  WHERE deleted_at IS NULL;

-- The version an item had just before each write (edit or delete).
-- The app keeps the newest 20 per item and trims older ones.
CREATE TABLE IF NOT EXISTS deck_item_history (
  id         BIGSERIAL   PRIMARY KEY,
  owner_id   TEXT        NOT NULL,
  kind       TEXT        NOT NULL,
  item_id    TEXT        NOT NULL,
  folder     TEXT        NOT NULL,
  data       JSONB       NOT NULL,
  revision   INTEGER     NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ NULL,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deck_item_history_item_idx
  ON deck_item_history (owner_id, kind, item_id, id DESC);

COMMIT;
