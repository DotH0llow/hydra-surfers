# Online (players, boards, community)

The game talks to the server only through the `LeaderboardService` interface in `src/online/LeaderboardService.ts`. The provider is chosen at **build time** with `VITE_ONLINE_PROVIDER`:

| value | provider | behaviour |
|---|---|---|
| `http` (default) | `HttpProvider` | Calls the Worker API (`/api/*`). Every run is also recorded locally, and any non-2xx answer (for example `503` with no database) or network error falls back to the offline league, so the UI always has a board. |
| `mock` | `MockProvider` | Offline league only: ~36 seeded fake players per board, stored locally, 80-260 ms simulated latency. |

## Identity

- A player is a **unique display name** (3-16 letters, digits, spaces, `_ . -`; case and accents are folded, so there is only one "Ana") plus a server-issued **token**.
- The client stores `{ playerId, playerName, token }` under `hydra-surfers.player`, separately from the profile, so resetting progress never loses the account.
- The tavern asks for a name on the first visit. A chosen name is checked with the server right away (`409` is shown as "taken"); with no server it is kept locally.
- Registration is otherwise lazy: the first run submitted creates the server-side player. A taken name there (a player who never chose one) is retried with two digits appended.
- Every write carries `Authorization: Bearer <token>`. The token is shown in the settings as the **recovery code** (`XXXXX-XXXXX-XXXXX`); entering it on another device restores the account.
- The server stores only `sha256(token)`.

## Boards

Boards use the same ids as the run modes (`src/meta/modes.ts`):

| board | period | what it ranks |
|---|---|---|
| `season` | `""` | best of every ranked run in the current season |
| `daily` | `2026-09-15` (local day, Brazil) | the Corrida do Dia; everybody plays the same seed |
| `weekly` | `2026-W38` | the weekly challenge (mutators rotate per week) |
| `event:<id>` | the tournament id | a tournament from the season content |

Any board can be ranked by `score`, `distance`, `coins`, `combo` or `clean` (longest stretch without contact); the UI offers the record metrics on the season board.

**Houses.** A player may pick one of four houses (`HOUSES` in `src/shared/content/season.ts`) in the crest screen. Every run carries the house it was run for; `/api/houses?period=<week>` ranks the houses by the mean of their five best players on that week's challenge, with empty places counting as zero, so headcount does not win. Switching house only moves future runs.

**Ghosts.** A ranked daily run that beats the player's best of the day carries its ghost track (`src/shared/ghost.ts`: 10 samples a second, 4 bytes each, ~7 KB for 3 minutes). The Worker keeps one ghost per player and day (only while it is their best) after checking that the track fits the run's time and distance. `GET /api/ghosts/daily` answers the ghost of the player just above you, your own when you lead, or the lowest ghost before your first run. The client races it as a translucent runner with a HUD line ("Marina · 23 m à frente"); players can turn it off in the settings.

Seeded boards give a limited number of **ranked attempts** per period (daily 3, weekly 5, tournaments per their definition). The client spends the attempt when the run starts; the server also counts them and stores extra runs as practice (`ranked = 0`).

## Plausibility (proportional anti-cheat)

`src/shared/plausibility.ts` is shared by the client and the Worker. A run is rejected (`422 implausible`) when:

- the period is not live for the board (a run may arrive up to 6 h after the period rolled over);
- a seeded board's run did not use that board's seed;
- distance is impossible for the run time, or score/coins are impossible for the distance.

This keeps obviously fabricated numbers off the boards without an arms race. Runs also carry `cause` (what ended them) for balance metrics; players can switch that off in the settings.

## Worker API (`worker/index.ts`)

| route | method | auth | answer |
|---|---|---|---|
| `/api/health` | GET | | `{ ok, db, version, time }` |
| `/api/players` | POST `{ name, crest? }` | | `201 { playerId, token, name }`, `409 name_taken`, `422 invalid_name` |
| `/api/players/me` | GET | token | `{ playerId, name, crest, title, level }` (also how recovery works) |
| `/api/players/me` | PUT `{ name?, crest?, title?, level? }` | token | updated profile, `409` if the new name is taken |
| `/api/runs` | POST run claim (+ `house`, `ghost`) | token | `201 { accepted, ranked, rank, previousRank, best, above: { name, value } \| null, ghostStored }` |
| `/api/boards/:board?period=&metric=&player=` | GET | | `{ board, period, metric, entries: [{ rank, playerId, name, crest, title, level, value }], me }` |
| `/api/community` | GET | | `{ bounty: { id, value, goal } \| null }` (sum over the bounty window) |
| `/api/houses?period=` | GET | | `{ period, standings: [{ house, value, players }] }`, best house first |
| `/api/ghosts/daily?period=&player=` | GET | | `{ playerId, name, score, data }` or `404` |

Without a D1 binding every data route answers `503 {"error":"db_unavailable","fallback":"mock"}`.

Tests: `worker/index.test.ts` runs the real `schema.sql` and every query through a small D1 adapter over Node's built-in `node:sqlite`.

## Connecting D1

1. `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN`, see [DEPLOY.md](DEPLOY.md)).
2. `npx wrangler d1 create hydra-surfers` and copy the printed `database_id`.
3. In `wrangler.jsonc`, uncomment the `d1_databases` block and paste the id. Keep `"binding": "DB"`.
4. `npx wrangler d1 execute hydra-surfers --remote --file=worker/schema.sql` (idempotent).
5. Deploy (`npm run deploy` or push to `main`).
6. Check `https://<your-worker>/api/health` shows `"db": true`.

Re-running `worker/schema.sql` is always safe and creates tables added later (such as `ghosts`). A database created before houses existed also needs one migration: `npx wrangler d1 execute hydra-surfers --remote --file=worker/migrations/0002_houses.sql` (a database created from the current `schema.sql` already has the column; running the migration there fails harmlessly with "duplicate column").

The schema changed from the first version (one `scores` table) to `players` + `runs`. The first version was never deployed with a database, so there is nothing to migrate.

## Local end-to-end

```sh
npm run build
npx wrangler d1 execute hydra-surfers --local --file=worker/schema.sql
npx wrangler dev          # http://localhost:8787 serves dist/ and /api/*
```
