-- Hydra Surfers leaderboard schema (Cloudflare D1 / SQLite).
-- Apply locally:   npx wrangler d1 execute hydra-surfers --local  --file=worker/schema.sql
-- Apply remotely:  npx wrangler d1 execute hydra-surfers --remote --file=worker/schema.sql
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  score       INTEGER NOT NULL CHECK (score >= 0),
  coins       INTEGER NOT NULL DEFAULT 0,
  distance    REAL    NOT NULL DEFAULT 0,
  seed        INTEGER,
  week        TEXT    NOT NULL,              -- ISO week key, e.g. 2026-W37 (weekly boards)
  created_at  INTEGER NOT NULL               -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_scores_score       ON scores (score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_week_score  ON scores (week, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player      ON scores (player_id, score DESC);
