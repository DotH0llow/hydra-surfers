# Yard Dash — handoff (paused 2026-09-15 11:50, weekly usage nearly spent)

Read this first when continuing in a new chat. Contracts: `PLAN.md` (architecture, lane ownership §8b, pass rule §9) and `gauntlet/pieces.json` (every piece's dimension/criteria). This file is internal planning (it may name the benchmark; `npm run check:brand` exempts `gauntlet/` and `PLAN.md`).

## What it is

An original mobile-first 3-lane endless runner ("Yard Dash", branding in `src/brand/brand.json`) whose mechanics are held to the bar of the current Subway Surfers mobile game. Vite + TypeScript + three.js, DOM UI overlay, Cloudflare Workers static assets + `worker/` API. No benchmark names/art/audio may ship.

## Where things are

| thing | location |
|---|---|
| main repo (branch `main`) | `C:\Users\Pichau\AppData\Roaming\Claude\scratch-workspaces\1b75f0df-10f3-4d0e-929e-5157d4a77477\7cda4526-2458-4296-9f90-00d1e50fa47f\scratch-2026-09-13-093770` (real path, as git reports it: `C:\Users\Pichau\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\scratch-workspaces\…`) |
| lane worktrees | `K:/yard-dash-data/wt/lane-{a,b,c,d}` on `lane/a-run-feel`, `lane/b-track`, `lane/c-ui-meta`, `lane/d-platform` (ports 5101–5104) |
| reference evidence (git-ignored, never commit/publish) | `.reference/` → junction to `K:\yard-dash-data\.reference` |
| blind A/B packets | `K:/yard-dash-data/packets/<piece>/r<N>/{A,B}` (none built yet) |
| build loop script | `gauntlet/workflows/lanes.js` (lean, sequential) |
| verdicts / follow-ups | `gauntlet/verdicts/<piece>/r<N>.json`, `gauntlet/followups.md` (created on first pass) |
| progress log | `gauntlet/progress.jsonl` (git-ignored), written by `node gauntlet/log.mjs <piece> <stage> <status> "<text>"` |
| live board (optional) | https://claude.ai/code/artifact/c6111f73-356b-42e2-b302-aff0c58335e6 — db docs `meta/overview`, `pieces/<id>`, `feed/recent`; writes need `if_version` from a fresh read |

## Status

- **F1 foundation — PASSED** (critic r2, 8/8, commit `96162dc`, verdict `fc7e1ac`). Playable greybox: 3 lanes, jump/roll/switch via keyboard + touch, barrier + train, coins, crash/restart, chaser, 120 Hz deterministic sim, tuning registry (163 fields), `window.__game` debug API, capture tools (`tools/capture.mjs` incl. `--touch`/`--perf`, 9 scenarios), manifest asset swap with placeholders, devtools stripped from prod, wrangler dry-run OK. 73 unit tests, 177.8 kB gzip initial JS.
- **Reference evidence — 18 of 21 compare pieces** have `.reference/pieces/<id>/notes.md` + strips: A2, A5, A6, A7, B1–B7, C1–C6, Z1. Missing: **A1 camera, A3 jump, A4 roll** (no folders; A7/A5/A2 strips already contain jump ≈700 ms airtime, roll ≈467 ms, camera framing — the lean builder uses those). No merged `dossier.md` yet; per-group sections are in `.reference/dossier-*.md` and `facts.md`.
  - Not in public footage (recorded with substitutes): exact input latency/swipe thresholds, true mid-switch reversal, double soft stumble, accepted revive, jetpack altitude in runner heights.
- **Build pieces — 0 of 26 passed.** Each lane branch has one `WIP (interrupted round-1 builder, unverified)` commit on top of `fc7e1ac` from the first ~12 min of A2 / B1 / C1 / D1 builders. The next builder merges main and keeps what is sound.
- **Z1 full-run** comparison runs after the lanes merge.

Reference measurements worth knowing: lane switch peaks at +2 frames and settles in ~10–12.5 frames (faster later in a run); motion begins on the first changed frame; speed ≈7.35 sleepers/s flat for ~28 s, then a linear ramp to ≈2× by ~3.5–4 min; run cadence ~5 steps/s constant; power-ups ~10 s base (jetpack 11–12 s); coin pickups every 5/3/2 frames as speed rises; full home→run→home loop 2:00, crash→home 19 s.

## Rules now in force (changed 2026-09-15)

- **Close calls count as passes** (PLAN §9, `pieces.json` `passRule`): compare pieces pass if ours wins **or** loses with margin `narrow` (timings within ±2 frames at 30 fps or ±15 %, sizes/positions within ±10 %, no item clearly worse). Engineering pieces pass if all criteria pass **or** the only failures are minor.
- **Max 3 rounds per piece**, then park it with its gap and move on.
- **One piece at a time** (see why below). Critics use the cheapest decisive checks.

## How to continue

1. Decide scope (see recommendations). A playable, deployable MVP subset:
   `A2-lane-switch, A3-jump, A4-roll, A6-speed-pacing, B1-obstacle-kit, B3-collision-stumble, B2-track-generation, C1-hud, C2-home-and-start, C3-pause-revive-results, D5-perf-mobile, D6-cloudflare-deploy`
2. Launch: `Workflow({ scriptPath: "<repo>/gauntlet/workflows/lanes.js", args: { pieces: [ ...ids ] } })`. Without `args` it runs all 26 in priority order.
3. If a usage limit stops it **in the same chat**, relaunch with the same `scriptPath` + `args` and `resumeFromRunId` (finished agents replay from cache). In a new chat, relaunch with only the pieces that have not passed (check `gauntlet/verdicts/` and `git log main`), and commit any lane WIP first.
4. GitHub push and real Cloudflare deploy need explicit user approval (`gh` is not logged in).

## Over-engineering review (2026-09-15)

The game code is not the problem (6.9 k src lines, one runtime dependency). The **process** is:

1. **Parallel agents under a usage cap.** Throughput is bounded by tokens, not wall-clock, but every agent a limit kills loses its context. Recent runs: 1.21 M tokens (6 agents, 1 finished), 0.99 M (5 agents, none reached its end), 0.79 M (4 agents, 3 finished), 0.57 M (4 agents, 6 minutes, nothing committed). → Fixed: sequential script.
2. **Reference capture was deep**: 18 measured packets, ~14 GB of frames (8.8 GB of it throwaway scratch in `.reference/work`), a planned 3-round audit loop. Enough evidence exists. → Fixed: no audit loop; A1/A3/A4 use existing strips.
3. **The gauntlet bar**: 28 pieces × (build + capture + blind packet + harsh critic + merge), "beat real footage", up to 6 rounds, critics running fresh checkouts and dozens of probes. → Fixed: close calls pass, 3 rounds, targeted critic checks.
4. **Not yet changed — recommended:**
   - Cut or defer scope that a first playable doesn't need: D2 editor presets/import/export, C5 shop depth, C6 real D1 leaderboard backend (keep mock), C4 daily challenge, D6 PR preview deploys, D3 tri-count validation, B6 beyond magnet + 2x.
   - For timing pieces (A2–A6, B4), consider replacing blind A/B packets with numeric checks against the reference numbers from `trace.json` — much cheaper than building and judging frame packets each round; keep blind critics for gestalt pieces (A1, B2, C1–C3, Z1).
   - Skip live-board syncing (orchestrator tokens) or update it only on piece pass/park.
   - `.reference/work` (8.8 GB on K:) is scratch and can be deleted by the user.

## Open follow-ups from the foundation critic

- `tools/check-brand.mjs` uses `\b` word boundaries: joined spellings slip through; binaries skipped (→ D6).
- `assets/files.json` is build-time: a texture dropped into an already-deployed dist needs a rebuild; docs don't say so. Garbage audio bytes are reported as loaded until decode fails. All 27 manifest ids are placeholders (→ D3).
- Perf at 4× CPU throttle: p50 75 fps but p95 26.7 ms, p99 106.7 ms (→ D5 target p95 ≤ 20 ms).

## Environment gotchas

- **C: is almost full** (~13 GB free of 477 GB). Keep heavy data, worktrees and captures on K:. Move, don't delete.
- `git worktree add` fails under the long scratchpad path; use `K:/yard-dash-data/wt/…`. `core.longpaths=true` is set.
- Chrome via `playwright-core` `channel:'chrome'`; never download Playwright browsers. Portrait reference videos and timestamps: `.reference/overview/index.md`.
- Usage limit: roughly 1 M subagent tokens per ~5 h window; work resumes only while the app is open.

## Paste-ready kickoff for the new chat

> Continue the Yard Dash build in this repo. Read `gauntlet/HANDOFF.md`, then `PLAN.md` §8b and §9. Weekly usage is tight: keep it lean, one piece at a time, no new parallel fan-outs. First confirm the scope with me (the MVP subset in the handoff is the default), then run `gauntlet/workflows/lanes.js` with those pieces and report each pass/park.
