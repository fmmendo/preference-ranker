-- Apply with:
--   npx wrangler d1 execute preference-ranker --remote --file worker/schema.sql -c worker/wrangler.toml
-- (drop --remote to seed the local dev DB instead)

-- WITHOUT ROWID: `id` is the table's clustering key, so there's no separate
-- rowid btree + PK index (which would be two "rows written" per insert on D1's
-- write quota) — an insert writes a single row. Idempotent INSERT OR IGNORE and
-- delete-by-id use the primary key as usual.
CREATE TABLE IF NOT EXISTS comparisons (
  id            TEXT PRIMARY KEY,   -- client uuid → idempotent upserts
  collection_id TEXT NOT NULL,      -- e.g. 'col:muse'
  user_id       TEXT NOT NULL,      -- anonymous GUID
  item_a_id     TEXT NOT NULL,
  item_b_id     TEXT NOT NULL,
  winner_id     TEXT NOT NULL,
  created_at    INTEGER NOT NULL,   -- client epoch ms
  received_at   INTEGER NOT NULL    -- server epoch ms
) WITHOUT ROWID;

-- No secondary indexes on comparisons: every extra index costs one more
-- "row written" per insert on D1's daily write quota. The only frequent read
-- (the aggregate) scans the whole collection and groups regardless, and
-- collection_id has a single value here so an index on it never narrows the
-- scan. Delete-by-id uses the primary key; the rare per-user reset can afford a
-- full scan. (Re-add a (collection_id, user_id) index if per-user reads — e.g.
-- clustering — ever become hot.)

CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  PRIMARY KEY (user_id, collection_id)
);
