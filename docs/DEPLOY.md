# Deploy (Cloudflare Workers)

Yard Dash ships as **one Cloudflare Worker with static assets**:

- `dist/` (the Vite build) is uploaded as the Worker's static assets. Unknown non-API paths serve `index.html` (`not_found_handling: "single-page-application"`).
- `/api/*` runs the Worker in `worker/index.ts` first (`assets.run_worker_first: ["/api/*"]`). Every other request is served straight from the asset store without invoking the Worker.
- An optional D1 database (binding `DB`) stores leaderboard scores. Without it, `/api/leaderboard` and `/api/scores` answer `503 {"error":"db_unavailable","fallback":"mock"}` and the game uses its local mock league (see [ONLINE.md](ONLINE.md)).

Configuration lives in `wrangler.jsonc`. `wrangler` is a devDependency, so every command below uses the pinned version. Node 22 is pinned in `.nvmrc` (read by GitHub Actions and Cloudflare Workers Builds).

## Local checks

```sh
npm ci
npm run typecheck && npm test && npm run build
npm run check:devstrip -- --skip-build   # prod bundle contains no devtools code
npm run check:brand                      # no benchmark names in shipped files
npm run assets:check                     # manifest + asset files valid
npm run deploy:dry                       # wrangler deploy --dry-run (bundles the Worker, reads dist/)
npx wrangler dev                         # Worker + assets locally on http://localhost:8787
curl http://localhost:8787/api/health    # {"ok":true,"db":false,...}
```

`wrangler deploy` does **not** build the game. Always run `npm run build` first (`npm run deploy` does both).

Choose **one** deploy path below. Running both makes every push deploy twice.

## Path A: Cloudflare dashboard Git integration (Workers Builds)

Cloudflare builds and deploys on every push. No secrets are stored in GitHub.

1. In Cloudflare, go to **Workers & Pages → Create → Import a repository** and authorize the Cloudflare GitHub app for this repository.
2. Project name: `yard-dash`. It must match `name` in `wrangler.jsonc`. If you choose another name, change `name` in `wrangler.jsonc` to match it.
3. Build settings:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch deploy command: `npx wrangler versions upload` (gives each branch a preview URL)
   - Root directory: `/`
4. Save and deploy. Later pushes to the production branch (`main`) deploy automatically.
5. Leave the GitHub Actions secrets below unset. The workflow keeps running the checks and skips its Cloudflare steps.

## Path B: GitHub Actions (`.github/workflows/deploy.yml`)

Runs on every push to `main`, every pull request, and on manual dispatch:

1. `npm ci`
2. `npm run typecheck`
3. `npm test` (unit tests and Worker route tests)
4. `npm run build`
5. `npm run check:devstrip -- --skip-build`
6. `npm run check:brand`
7. `npm run assets:check`
8. `npx wrangler deploy --dry-run`
9. **Deploy** with `cloudflare/wrangler-action@v3` (`command: deploy`), on pushes to `main` only.
10. **Preview**: `wrangler versions upload` for pull requests opened from branches of this repository. The preview URL appears in the job log and in the Cloudflare dashboard under the Worker's **Deployments** tab.

Steps 9 and 10 run only when both secrets exist.

Setup:

1. In Cloudflare, go to **My Profile → API Tokens → Create Token** and use the **Edit Cloudflare Workers** template. If you bind D1, add **Account → D1 → Edit**. Restrict it to your account.
2. Find your **Account ID** on the Workers & Pages overview page (right-hand column).
3. In GitHub, go to **Settings → Secrets and variables → Actions** and add these repository secrets:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID`: the id from step 2
4. Push to `main`. The Worker named in `wrangler.jsonc` (`yard-dash`) is created on the first deploy and served at `https://yard-dash.<your-subdomain>.workers.dev`.

## Path C: from your machine

```sh
npx wrangler login
npm run deploy
```

## Custom domain

The domain's zone must be on the same Cloudflare account.

- Dashboard: open the Worker, then **Settings → Domains & Routes → Add → Custom domain**, and enter e.g. `play.example.com`. DNS and the certificate are created for you.
- Or in `wrangler.jsonc` (deployed on the next `wrangler deploy`):
  ```jsonc
  "routes": [{ "pattern": "play.example.com", "custom_domain": true }]
  ```

## D1 (optional leaderboard database)

Short version (full steps and client settings in [ONLINE.md](ONLINE.md)):

```sh
npx wrangler d1 create yard-dash                                         # prints database_id
# paste it into the commented d1_databases block in wrangler.jsonc and uncomment it
npx wrangler d1 execute yard-dash --remote --file=worker/schema.sql      # idempotent
```

Then build the client with `VITE_ONLINE_PROVIDER=http` so the game talks to `/api`. In GitHub Actions, add it as an `env:` on the Build step. In Workers Builds, add it under **Settings → Variables and secrets → Build variables**.

## Environment variables

| name | where | effect |
|---|---|---|
| `VITE_ONLINE_PROVIDER` | build time | `mock` (default) or `http` (use the Worker API, falling back to mock on 503 or network error) |
| `VITE_DEVTOOLS` | build time | `1` includes the dev panel chunk (reachable with `?dev=1`). Leave unset for production. |
| `VITE_SOURCEMAP` | build time | `1` emits source maps (they are never uploaded as public assets, see `public/.assetsignore`) |
| `APP_VERSION` | `wrangler.jsonc` `vars` | shown by `/api/health` |

## Troubleshooting

- **`/api/health` returns HTML:** `run_worker_first` is missing, or you are hitting a static-only deployment. Check `wrangler.jsonc`.
- **Deploy step fails with authentication error 10000:** the token lacks Workers Scripts:Edit, or `CLOUDFLARE_ACCOUNT_ID` does not match the token's account.
- **Workers Builds says the Worker name does not match:** the dashboard project name and `name` in `wrangler.jsonc` must be identical.
- **Blank page after deploy:** `dist/` was empty or stale. Both CI paths build before deploying; when deploying by hand, run `npm run deploy`.
- **Leaderboard always shows mock players:** expected until D1 is bound *and* the client is built with `VITE_ONLINE_PROVIDER=http`. `/api/health` shows `"db": true` once the binding works.
