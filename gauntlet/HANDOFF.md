# Hydra Surfers — handoff (2026-09-15, game complete, deploy pending)

Read this first when continuing. Contracts: `PLAN.md` (architecture, lane ownership §8b, pass rule §9) and `gauntlet/pieces.json` (every piece's dimension/criteria). This file is internal planning and may name the benchmark.

The game was called Yard Dash until 2026-09-15; it is now **Hydra Surfers** (brand, Worker `hydra-surfers`, package, storage keys). The automated benchmark-name check (`tools/check-brand.mjs`) was removed at the owner's request.

## Where things are

| thing | location |
|---|---|
| working clone (branch `main`) | `K:\hydra-surfers`, remote `origin` = GitHub, remote `scratch` = the original scratch repo |
| original scratch repo | `C:\Users\Pichau\AppData\Roaming\Claude\scratch-workspaces\…\scratch-2026-09-13-093770` (stops at the lane merge commits) |
| old lane worktrees | `K:/yard-dash-data/wt/lane-{a,b,c,d}`, all merged; safe to remove with `git worktree remove` from the scratch repo |
| reference evidence (never commit/publish) | `K:\yard-dash-data\.reference` |
| verification captures | `.captures/{roof-run,pickups,shop,settings}` (git-ignored; `npm run capture -- --scenario <name>`) |
| historical build loop | `gauntlet/workflows/lanes.js` still tells agents to run `npm run check:brand`, which no longer exists; drop those lines before reusing it |

## Status

Implemented and verified with unit tests, scripted `window.__game` runs and headless captures. The blind A/B critic loop against reference footage was not run.

- **Run feel**: lane switch feel (lane A), jump 0.70 s, roll 0.47 s, constant 5 steps/s run cadence, speed holds 28 s then ramps linearly to 2× by 225 s (reference numbers).
- **Track**: low/high barriers, parked and oncoming trains, ramps and walkable roofs, tunnels, signals; seeded patterns with fairness rules; gap pickups.
- **Power-ups**: jetpack (11.5 s, sky coin trail), sneakers, magnet, 2x; keys; hoverboards absorb one crash.
- **Flow**: home, HUD, pause with 3-2-1 resume, revive with keys, results with missions and rank, quit banks progress.
- **Meta**: missions raise the permanent multiplier; shop with hoverboards, keys, 5-level upgrades, 4 characters and 4 hoverboards (coins or keys); leaderboard tabs (mock league until D1).
- **Audio**: synthesized sfx for every event, looping run music with ducking, sfx/music volume, mute.
- **Settings**: sound, volumes, reduced motion, controls, two-tap reset. Menus scroll on touch.
- **Performance**: static placeholder meshes are merged per material at load (`src/assets/mergeStatic.ts`): a busy 180 s run went from 171 to ~61 draw calls (peak 80, target ≤ 120). Initial JS 52.9 kB app + 145.9 kB three gzip (budget 250).
- **Devtools** (`?dev=1` in dev builds, stripped from production): cheats panel plus a tuning editor generated from the registry (search, per-field reset, persisted presets, copy/paste JSON); toggles: ` key, DEV button, 3-finger tap, corner long-press; cheats include no-clip, jump to time/distance, unlock all, give coins/keys/boards, power-ups, complete missions.
- **Platform**: PWA manifest + icons, wake lock during runs, pause on hidden tab, portrait letterbox on desktop.
- **Deploy**: ready but not connected. See `docs/DEPLOY.md` (Workers Builds import, or GitHub secrets). CI runs typecheck, tests, build, devstrip, asset check and a wrangler dry run on every push.

Verified 2026-09-15: typecheck (app + worker), vitest 15 files / 95 tests, build, `check:devstrip`, `assets:check` (50 ids), `wrangler deploy --dry-run`; scripted roof run, every pickup, oncoming crash → revive, 180 s god-mode procedural run with every obstacle type and no errors.

## Remaining gaps

1. All art and audio are procedural placeholders; `docs/ASSETS.md` lists every id with its spec (drop files at the listed paths, no code changes).
2. Reference comparison pieces (A1–A7, B1–B5, C1–C3, Z1) are not critic-judged.
3. Online is the mock league until D1 is bound and the client is built with `VITE_ONLINE_PROVIDER=http` (`docs/ONLINE.md`).
4. Dev cheats not built: show hitboxes, lane grid, force a specific pattern.
5. Perf at 4× CPU throttle not re-measured after the mesh merge (`npm run capture -- --scenario perf-run --perf`).

## Environment gotchas

- **C: is almost full**; keep heavy data on K:.
- Chrome via `playwright-core` `channel:'chrome'`; never download Playwright browsers.
- The Claude preview pane screenshots time out when the app window is behind others; `tools/capture.mjs --port 5105` (own headless Chrome) is the reliable way to get frames.
- Git on this machine converts LF → CRLF in the working copy (warnings only).
