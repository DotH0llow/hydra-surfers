-- Adds houses to a database created before they existed. Run once:
--   npx wrangler d1 execute hydra-surfers --remote --file=worker/migrations/0002_houses.sql
-- (A database created from the current worker/schema.sql already has the column.)
ALTER TABLE runs ADD COLUMN house TEXT NOT NULL DEFAULT '';
