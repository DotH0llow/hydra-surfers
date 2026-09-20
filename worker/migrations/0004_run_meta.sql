-- Adds the balance columns to a database created before them. Run once:
--   npx wrangler d1 execute hydra-surfers --remote --file=worker/migrations/0004_run_meta.sql
-- (A database created from the current worker/schema.sql already has them.)
ALTER TABLE runs ADD COLUMN powerup TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN version TEXT NOT NULL DEFAULT '';
