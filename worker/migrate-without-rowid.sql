-- One-time migration: rebuild `comparisons` as a WITHOUT ROWID table.
--
-- Why: a normal rowid table with `id TEXT PRIMARY KEY` stores the row in a
-- rowid btree AND keeps a separate unique index on id — so each insert writes 2
-- rows against D1's daily write quota. WITHOUT ROWID makes `id` the table's own
-- clustering key: the table btree *is* the id index, so an insert writes just 1
-- row. Halves rows-written per pick again (2 -> 1). Idempotent operations
-- (INSERT OR IGNORE, delete-by-id) still use the primary key exactly as before.
--
-- Apply (run once, ideally at a low-traffic time):
--   npx wrangler d1 execute preference-ranker --remote \
--     -c worker/wrangler.toml --file worker/migrate-without-rowid.sql
--
-- The copy writes ~one row per existing comparison (a one-time burst against the
-- daily quota). The original table is left intact until the final DROP/RENAME,
-- so a mid-run failure is recoverable. Verify afterwards (counts must match):
--   npx wrangler d1 execute preference-ranker --remote \
--     --command "SELECT COUNT(*) AS n FROM comparisons"

DROP TABLE IF EXISTS comparisons_new;

CREATE TABLE comparisons_new (
  id            TEXT PRIMARY KEY,   -- client uuid → idempotent upserts
  collection_id TEXT NOT NULL,      -- e.g. 'col:muse'
  user_id       TEXT NOT NULL,      -- anonymous GUID
  item_a_id     TEXT NOT NULL,
  item_b_id     TEXT NOT NULL,
  winner_id     TEXT NOT NULL,
  created_at    INTEGER NOT NULL,   -- client epoch ms
  received_at   INTEGER NOT NULL    -- server epoch ms
) WITHOUT ROWID;

INSERT OR IGNORE INTO comparisons_new
  (id, collection_id, user_id, item_a_id, item_b_id, winner_id, created_at, received_at)
SELECT
  id, collection_id, user_id, item_a_id, item_b_id, winner_id, created_at, received_at
FROM comparisons;

DROP TABLE comparisons;

ALTER TABLE comparisons_new RENAME TO comparisons;
