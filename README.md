# Hydra Surfers

An original, mobile-first three-lane endless runner for the browser. Swipe between lanes, jump barriers, roll under boards, run along train roofs, grab power-ups and outrun the yard warden.

Built with **Vite + TypeScript + three.js** (no game engine), a DOM UI overlay, and deployed as a **Cloudflare Worker with static assets** plus a small `/api` Worker for the leaderboard.

## Play

| | Touch | Keyboard |
|---|---|---|
| Switch lane | swipe left / right | ← → or A D |
| Jump | swipe up | ↑, W or Space |
| Roll / fast fall | swipe down | ↓, S or Shift |
| Hoverboard | double-tap or the board button | E |
| Pause | pause button | Esc or P |

What is in the game:

- **Obstacles**: low barriers (jump or roll), high barriers (roll only), parked trains, oncoming trains, ramps up to train roofs, tunnels, trackside signals.
- **Power-ups**: jetpack (fly over everything along a sky coin trail), super sneakers (jump onto roofs), coin magnet, 2x score. Keys appear now and then.
- **Hoverboards** absorb one crash. **Keys** buy a revive after a crash (1, 2, then 4 keys).
- **Missions**: three at a time; finish a set to raise your permanent score multiplier.
- **Shop**: hoverboards, keys, power-up duration upgrades, and unlockable characters and hoverboards (coins or keys).
- **Music**: a looping in-run track that ducks while paused or crashed, with its own volume setting.
- **Ranks**: global, weekly and friends boards. Offline mock league by default, real D1 database optional.
- Installable as a PWA (portrait, standalone). The screen stays awake during a run, and the game pauses when the tab is hidden.

## Develop

Requires Node 22 (see `.nvmrc`).

```sh
npm ci
npm run dev          # http://localhost:5100 (devtools on: press ` for cheats and the live tuning editor)
npm test             # unit tests (vitest)
npm run typecheck
npm run build        # production build in dist/
npm run preview      # serve dist/ on :5100
```

Useful URL flags: `?debug=1` exposes `window.__game` (scripted input, manual clock, state dumps), `?scenario=roof-run` starts runs from a hand-built layout, `?seed=123` fixes the track, `?mute=1`.

Tooling: `npm run capture -- --scenario jump --out .captures/jump` records frame strips with the local Chrome; `npm run assets:check` validates the asset manifest; `npm run docs:tuning` regenerates `docs/TUNING.md`; `npm run icons` re-renders the PWA icons.

## Deploy to Cloudflare

The repository is ready for Cloudflare Workers. Pick **one** of these:

1. **Cloudflare dashboard, Git integration (simplest).** In Workers & Pages, choose **Create → Import a repository**, select this repository, and set:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`

   Every push to `main` then builds and deploys. Leave the GitHub Actions secrets unset.
2. **GitHub Actions.** Add the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. `.github/workflows/deploy.yml` then deploys on every push to `main` and uploads a preview version for each pull request. Without the secrets the workflow only runs the checks.
3. **From your machine.** Run `npx wrangler login`, then `npm run deploy`.

The Worker name is `hydra-surfers` (`wrangler.jsonc`), served at `https://hydra-surfers.<your-subdomain>.workers.dev`. Custom domains, the optional D1 leaderboard database and all environment variables are covered in [docs/DEPLOY.md](docs/DEPLOY.md) and [docs/ONLINE.md](docs/ONLINE.md).

## Project layout

```
src/            game code: core (loop, events, tuning, store), game systems, input, ui, meta, online, dev
worker/         Cloudflare Worker for /api (leaderboard on D1, 503 fallback without a database)
public/assets/  asset manifest; drop real models/textures/audio at the listed paths to replace placeholders
tools/          capture, asset and docs tooling
docs/           ASSETS, TUNING, DEVTOOLS, ONLINE, DEPLOY
gauntlet/       internal planning and review records
```

All art and sound are procedural placeholders defined by `public/assets/manifest/*.json`. Swapping in real assets needs no code changes: see [docs/ASSETS.md](docs/ASSETS.md). Every gameplay number is live-tunable (see [docs/TUNING.md](docs/TUNING.md) and the in-game editor in dev builds).
