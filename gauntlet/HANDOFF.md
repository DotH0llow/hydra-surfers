# Yard Dash — handoff (2026-09-15, playable MVP complete)

Read this first when continuing. Contracts: `PLAN.md` (architecture, lane ownership §8b, pass rule §9) and `gauntlet/pieces.json` (every piece's dimension/criteria). This file is internal planning (it may name the benchmark; `npm run check:brand` exempts `gauntlet/` and `PLAN.md`).

## Where things are

| thing | location |
|---|---|
| working clone (branch `main`) | `K:\hydra-surfers`, remote `origin` = the GitHub repository, remote `scratch` = the original scratch repo |
| original scratch repo | `C:\Users\Pichau\AppData\Roaming\Claude\scratch-workspaces\…\scratch-2026-09-13-093770` (stops at the lane merge commits) |
| old lane worktrees | `K:/yard-dash-data/wt/lane-{a,b,c,d}` — their WIP is merged into `main`; safe to remove with `git worktree remove` from the scratch repo |
| reference evidence (never commit/publish) | `K:\yard-dash-data\.reference` (junction `.reference/` in the scratch repo only) |
| verification captures | `.captures/roof-run`, `.captures/pickups` (git-ignored; `npm run capture -- --scenario <name>`) |

## What was done in this pass

Lean, inline, no agent fan-out. The gauntlet A/B critic loop was **not** run; pieces below are implemented and verified with unit tests, scripted `window.__game` runs and headless captures, not judged against the reference footage.

- **Merged** the four interrupted lane WIP branches (switch feel, obstacle kit, HUD tuning, dev triggers) and finished lane B's missing obstacle placeholders.
- **B1 obstacle kit**: low/high barriers, parked and oncoming trains (move once within `obsOncoming.spawnAhead`), ramps, walkable roofs (SurfaceSystem + collision step-up), tunnels, trackside signals.
- **B2 generation**: new patterns (high/mixed barriers, ramp roof runs with side trains, oncoming trains with a swept-lane reservation, tunnels) and gap pickups.
- **B6 power-ups**: jetpack flight with sky coin trail + landing grace, super sneakers (roof-height jumps), coin magnet, 2x multiplier; key pickups. Durations include shop upgrades.
- **B7 hoverboard**: charges mirror `profile.currencies.boards` (default 3), board visual, HUD button.
- **C1 HUD**: zero-padded score, multiplier badge, coin pop, power-up timer bars, resume countdown, toasts.
- **C2/C3 flow**: home with currencies, multiplier and missions card; pause (missions, settings) with 3-2-1 resume; revive offer (1/2/4 keys, max 3, clears the crash site + 2 s grace); results with distance, missions and async global rank; quitting mid-run banks progress.
- **C4 missions**: 3 per set from a pool, goals scale with the set, completing a set raises the permanent multiplier (`src/meta/missions.ts`).
- **C5 shop (lean)**: hoverboards, keys, 5-level duration upgrades for the four power-ups (`src/meta/upgrades.ts`). No character/board skins.
- **C6 ranks UI**: global/weekly/friends tabs over the existing Mock/Http providers.
- **Settings**: sound, effects volume, reduced motion (kills CSS animation and camera shake), controls, two-tap reset.
- **D4 audio**: new synthesized sfx for power-ups, stumble, hoverboard, missions, keys; respects mute/volume.
- **D5 (partial)**: web app manifest + generated PNG icons (`npm run icons`), wake lock during runs.
- **D6 Cloudflare**: workflow deploys/previews only when both secrets exist (checks always run, incl. `assets:check`), Node from `.nvmrc`, README + `docs/DEPLOY.md` cover Workers Builds, Actions and manual deploy.
- New scenarios: `roof-run`, `oncoming`, `pickups` (+ capture JSONs). Tests: 14 files / 92 tests.

## Verified (2026-09-15)

`typecheck` (app + worker), `vitest` 92/92, `vite build` (initial JS 193.7 kB gzip / 250 budget), `check:brand`, `check:devstrip`, `assets:check` (43 ids, all placeholders), `wrangler deploy --dry-run`. Scripted runs: roof run lands at y 3.6 and drops off at the end; each pickup activates; oncoming crash → revive → continues; cheat crash → results; 180 s god-mode procedural run without errors (speed 12 → 23 m/s, every obstacle type spawns).

## Known gaps / next steps

1. **Draw calls ~171** in a busy procedural frame (D5 target ≤ 120). Obstacle placeholders are multi-mesh groups; merge static placeholder geometry per type or instance trains/barriers. Perf capture at 4× throttle not re-measured.
2. **Not judged against reference**: A1–A7, B1–B5, C1–C3, Z1 still need the gauntlet comparison if that bar matters; timings (jump 0.65 s, roll 0.65 s, speed curve) are the foundation values, not re-tuned to the dossier numbers (jump ≈ 0.70 s, roll ≈ 0.47 s, flat speed for ~28 s then linear to 2× by ~3.5–4 min).
3. **D2 editor** (auto-built tuning UI, presets) not built; the dev panel lists cheats only.
4. **D1 cheats panel**: triggers from lane D (`src/dev/triggers.ts`, `devMath.ts`) exist but are not wired; no-clip, hitboxes, lane grid, jump-to-distance not added.
5. Tunnels are rare at the default weight (0.6); raise `spawnWeights.tunnel` if they should read as a regular feature.
6. Mobile scrolling is blocked globally (touchmove prevented), so menus are sized to fit without scrolling; long lists would need a scroll exception.
7. All art/audio are placeholders (`docs/ASSETS.md` lists every id with its spec).
8. Online is the mock league until D1 is bound and the client is built with `VITE_ONLINE_PROVIDER=http` (`docs/ONLINE.md`).

## Environment gotchas

- **C: is almost full**; keep heavy data on K:.
- Chrome via `playwright-core` `channel:'chrome'`; never download Playwright browsers.
- The Claude preview pane screenshots time out when the app window is behind others; `tools/capture.mjs` (own headless Chrome, `--port 5105`) is the reliable way to get frames.
- Git on this machine converts LF → CRLF in the working copy (warnings only).
