-- Adds the public profile card to a database created before it existed. Run once:
--   npx wrangler d1 execute hydra-surfers --remote --file=worker/migrations/0003_profiles.sql
-- (A database created from the current worker/schema.sql already has these columns.)
ALTER TABLE players ADD COLUMN house TEXT NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN build TEXT NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN showcase TEXT NOT NULL DEFAULT '';
