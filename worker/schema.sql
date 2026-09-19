-- Hydra Surfers schema (Cloudflare D1 / SQLite).
-- Apply remotely:  npx wrangler d1 execute hydra-surfers --remote --file=worker/schema.sql
-- Apply locally:   npx wrangler d1 execute hydra-surfers --local  --file=worker/schema.sql
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS players (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  name_key    TEXT    NOT NULL UNIQUE,         -- case/accent-folded name: one "Ana" per group
  token_hash  TEXT    NOT NULL UNIQUE,         -- sha256 of the bearer token (the recovery code)
  crest       TEXT    NOT NULL DEFAULT '0.1.0.0',
  title       TEXT    NOT NULL DEFAULT '',
  level       INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- One row per finished run. Boards are GROUP BY queries over this table.
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT    NOT NULL,
  season      TEXT    NOT NULL,
  board       TEXT    NOT NULL,                -- season | daily | weekly | event:<id>
  period      TEXT    NOT NULL,                -- '' | 2026-09-15 | 2026-W38 | <tournament id>
  seed        INTEGER NOT NULL,
  score       INTEGER NOT NULL CHECK (score >= 0),
  distance    REAL    NOT NULL DEFAULT 0,
  coins       INTEGER NOT NULL DEFAULT 0,
  duration    REAL    NOT NULL DEFAULT 0,
  max_combo   INTEGER NOT NULL DEFAULT 0,
  clean       REAL    NOT NULL DEFAULT 0,
  contracts   INTEGER NOT NULL DEFAULT 0,
  cause       TEXT    NOT NULL DEFAULT '',     -- what ended the run (balance metrics)
  ranked      INTEGER NOT NULL DEFAULT 1,      -- 0 = practice after the ranked attempts were spent
  house       TEXT    NOT NULL DEFAULT '',     -- house the run was run for ('' = none)
  created_at  INTEGER NOT NULL
);

-- The best ranked run of each player on a seeded board, as a ghost track (src/shared/ghost.ts).
CREATE TABLE IF NOT EXISTS ghosts (
  player_id   TEXT    NOT NULL,
  board       TEXT    NOT NULL,
  period      TEXT    NOT NULL,
  score       INTEGER NOT NULL,
  data        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, board, period)
);

CREATE INDEX IF NOT EXISTS idx_ghosts_board ON ghosts (board, period, score);
CREATE INDEX IF NOT EXISTS idx_runs_board   ON runs (board, period, ranked, player_id);
CREATE INDEX IF NOT EXISTS idx_runs_season  ON runs (season, ranked, player_id);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs (created_at);
