# Online (leaderboards)

The game talks to leaderboards only through the `LeaderboardService` interface in `src/online/LeaderboardService.ts`. The provider is chosen at **build time** with `VITE_ONLINE_PROVIDER`:

| value | provider | behaviour |
|---|---|---|
| `mock` (default) | `MockProvider` | Seeded fake league stored locally (`localStorage`), with 80-260 ms simulated latency. Works offline and needs no server. |
| `http` | `HttpProvider` | Calls the Worker API (`/api/*`). It records every score locally too, and falls back to the mock league whenever the API answers non-2xx (e.g. `503` with no database) or is unreachable. The UI always has a board. |

`createLeaderboardService(storage)` in `src/online/index.ts` builds the right provider. A random player identity (`playerId`, `playerName`) is created once and stored under `hydra-surfers.player`.

## Interface

```ts
type BoardScope = "global" | "weekly" | "friends";

interface LeaderboardService {
  readonly id: "mock" | "http";
  submitScore(s: { score: number; coins: number; distance: number; seed?: number }): Promise<SubmitResult>;
  getBoard(scope: BoardScope, around?: string): Promise<Board>;   // around = playerId to centre on
  getProfile(): Promise<PlayerSummary>;
}

interface Board { scope; entries: LeaderboardEntry[]; me: LeaderboardEntry | null;
                  resetsAt: number | null;  /* weekly reset, Monday 00:00 UTC */  provider: "mock" | "http" }
```

`Board.provider` reports which provider actually answered, so the UI can show "offline league" when the http provider fell back.

Current scope. This is the skeleton from the foundation piece; lane C (piece C6) owns the full feature:
- `friends` is served by the mock league in both providers.
- Tiers/brackets, rewards and rate limiting are not implemented yet.

## Worker API (`worker/index.ts`)

| route | method | response |
|---|---|---|
| `/api/health` | GET | `{ ok: true, db: <D1 bound?>, version, time }` |
| `/api/leaderboard?scope=global\|weekly&limit=50&player=<id>` | GET | `{ scope, week, entries: [{rank, playerId, name, score, distance, at}], me: {rank, score} \| null }`. Best score per player; `limit` is capped at 100. |
| `/api/scores` | POST | JSON `{ playerId, name, score, coins?, distance?, seed? }` → `201 { ok: true, rank }` |

- Validation: `playerId` is 6-64 chars of `[A-Za-z0-9_-]`; `name` is 1-16 printable chars (control characters stripped); `score` 0-1e9; `coins` 0-1e7; `distance` 0-1e7; `seed` an integer. Bad JSON returns `400 bad_json`. Invalid fields return `422 {"error":"invalid","errors":[...]}`.
- No database bound: `/api/leaderboard` and `/api/scores` return `503 {"error":"db_unavailable","fallback":"mock"}` with `retry-after: 3600`. The http provider then uses the mock league.
- Wrong method returns `405`, unknown `/api/*` path returns `404`, and CORS preflight (`OPTIONS`) returns `204`.
- Weekly boards use ISO week keys (`2026-W37`, weeks start Monday UTC).
- Tests: `worker/index.test.ts` covers health, 503 without D1, validation, method checks, and the SQL issued against a fake D1.

Schema: `worker/schema.sql` creates one `scores` table plus indexes. It is idempotent (`CREATE ... IF NOT EXISTS`).

## Connecting a real D1 database

1. Log in once: `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` (see [DEPLOY.md](DEPLOY.md)).
2. Create the database: `npx wrangler d1 create hydra-surfers`. Copy the printed `database_id`.
3. In `wrangler.jsonc`, uncomment the `d1_databases` block and paste the id. Keep `"binding": "DB"`.
4. Create the tables remotely: `npx wrangler d1 execute hydra-surfers --remote --file=worker/schema.sql`.
5. (Optional, local dev) Create them locally too: `npx wrangler d1 execute hydra-surfers --local --file=worker/schema.sql`.
6. Build the client against the API: `VITE_ONLINE_PROVIDER=http npm run build`. In CI, add `VITE_ONLINE_PROVIDER: http` as an `env:` on the Build step.
7. Deploy: `npx wrangler deploy` (or push to `main`).
8. Verify: `curl https://<your-worker>/api/health` should show `"db": true`. Then `curl "https://<your-worker>/api/leaderboard?scope=global"` returns `200` with `entries`.

If the API token in CI is used for D1 commands as well, it also needs **D1: Edit**.

## Local end-to-end

```sh
VITE_ONLINE_PROVIDER=http npm run build
npx wrangler dev                    # http://localhost:8787 serves dist/ and /api/*
curl -X POST http://localhost:8787/api/scores -H "content-type: application/json" \
  -d '{"playerId":"p_local01","name":"Tester","score":1234}'
```

Without a bound database the POST returns `503`. That is the expected fallback signal.
