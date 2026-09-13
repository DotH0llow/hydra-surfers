# Yard Dash — build plan & architecture contract

Working title **Yard Dash** (all branding lives in `src/brand/brand.json`; rename freely).
An original 3-lane endless runner whose *mechanics* are held to the bar of the current shipped
Subway Surfers mobile game. No Subway Surfers names, art, audio, logos or characters are used or shipped.

Every agent working on this repo follows this file. If you must change a contract here, update this file in the same commit.

---

## 1. Stack

- **Vite + TypeScript (strict) + three.js** (WebGL2, WebGL1 fallback not required). No game engine.
- UI = DOM overlay (HTML/CSS) above the canvas — cheap, crisp on phones, trivially reskinnable.
- `vitest` for pure-logic tests. `playwright-core` driving the locally installed Chrome (`channel: "chrome"`) for capture/e2e. No Playwright browser download.
- Deploy: **Cloudflare Workers with static assets** (`wrangler.jsonc`), API Worker in `worker/` for `/api/*`, optional D1. GitHub Actions deploy + Cloudflare Git integration both documented in `docs/DEPLOY.md`.
- Units: **1 world unit = 1 metre**. +Z is forward (run direction is -Z in three.js camera space is fine, but document it in `src/game/world/coords.ts`). Lanes indexed `-1, 0, 1`.

## 2. Directory layout

```
index.html
src/
  main.ts                 boot: load manifest → create App → route to Home
  brand/brand.json        name, palette, fonts, copy strings
  core/
    loop.ts               fixed-timestep sim (120 Hz) + interpolated render; clock modes: realtime | manual
    events.ts             typed event bus (EventMap interface — add events there)
    rng.ts                seeded PRNG (mulberry32); ALL gameplay randomness goes through it
    tuning.ts             tuning registry: systems register schema {path, default, min, max, step, group, label}
    store.ts              persistent profile (localStorage, versioned + migrations): currencies, owned, equipped, stats, missions, settings
    debugApi.ts           window.__game (see §4)
    flags.ts              devtools enabled? (import.meta.env.DEV || VITE_DEVTOOLS==="1") && (?dev=1 or DEV)
  assets/
    manifest.ts           types + loader for public/assets/manifest.json
    placeholders.ts       procedural fallbacks (meshes, textures, sfx, ui icons) keyed by `placeholder` field
    AssetLibrary.ts       get(id) → ready-to-use object; never throws on missing file (falls back + console.warn once)
  game/
    Run.ts                owns one run: world, player, spawner, collisions, score; emits events
    world/                track, lanes, environment chunks, curved-world vertex shader, fog, lighting
    player/               PlayerController (lane/jump/roll state machine), PlayerAnimator
    camera/               RunCamera (follow, lag, shake)
    obstacles/            registry: each obstacle type = {id, collider, assetId, rules}
    spawn/                seeded pattern/chunk generator + difficulty curve
    collectibles/         coins (instanced), pickup feedback
    powerups/             registry: jetpack, sneakers, magnet, multiplier, (mystery box)
    hoverboard/
    chaser/               guard + dog
    collision/            AABB/lane-based collision + stumble/crash resolution
    score/
  input/                  InputRouter: SwipeRecognizer (touch/pointer), Keyboard; emits abstract actions
  audio/                  AudioBus (WebAudio), sfx by asset id, music
  ui/                     screens/: Home, Hud, Pause, GameOver, Revive, Shop, Missions, Leaderboard, Settings; ui kit
  meta/                   progression: missions, multiplier, currencies, catalog (data/*.json), upgrades, daily
  online/                 LeaderboardService interface; MockProvider (seeded fake players + local scores); HttpProvider (/api)
  dev/                    CheatsPanel, Editor (auto-built from tuning registry + store), only imported when flags.devtools
public/assets/manifest.json + folders (models/, textures/, audio/, ui/)
worker/                   index.ts (/api/leaderboard, /api/scores), schema.sql (D1), mock fallback when no DB binding
tools/
  capture.mjs             scenario capture → frames/*.png, contact.png, trace.json (see §5)
  contact-sheet.mjs       builds a labelled grid image from a folder of frames (renders HTML in Chrome, screenshots it)
  scenarios/*.json
docs/ ASSETS.md TUNING.md ONLINE.md DEPLOY.md DEVTOOLS.md
gauntlet/ pieces.json, verdicts/<piece>/r<N>.json, progress.jsonl
```

## 3. Core rules

- Simulation is deterministic given seed + input timeline + tuning. Rendering never mutates sim state.
- **Every gameplay number lives in tuning** (registered by the owning system), never a magic constant. The editor builds itself from the registry.
- Systems talk via the event bus (`coin:collect`, `player:jump`, `player:stumble`, `run:end`, `powerup:start` …). UI and audio only subscribe.
- Allocation-free hot loop: pools for obstacles/coins/particles, instancing where possible, no per-frame closures/arrays.
- Mobile first: portrait 9:16 design, safe-area insets, no scroll/zoom/pull-to-refresh, pause on `visibilitychange`, DPR capped (tunable, default 2).
- Devtools code is dynamically imported only when `flags.devtools` is true, so production bundles can strip it by env.

## 4. Debug API (`window.__game`) — contract used by capture tools and critics

Available in every build when `?debug=1` (and always in dev). Methods:

| method | behaviour |
|---|---|
| `ready: Promise<void>` | resolves when assets + first frame are ready |
| `setClock('realtime'\|'manual')` | manual = sim advances only via `step` |
| `step(frames, fps=60)` | advance sim + render exactly `frames` frames at `1/fps` |
| `setSeed(n)` | seed for next run |
| `startRun({scenario?, seed?, skipIntro?})` | begin a run; scenario = named deterministic layout from `src/game/spawn/scenarios.ts` |
| `goto(screen)` | `home` `run` `pause` `gameover` `shop` `missions` `leaderboard` `settings` |
| `input(action)` | `left` `right` `jump` `roll` `hoverboard` `pause` `tap` — identical path to real input |
| `getState()` | plain JSON: `{t, frame, speed, distance, score, multiplier, coins, player:{lane, x,y,z, vy, state}, camera:{x,y,z, fov, pitch}, chaser:{dist}, activePowerups, screen}` |
| `setTuning(path, value)` / `getTuning()` | live tuning |
| `cheat(name, ...args)` | same actions as the cheats panel |

## 5. Capture tooling contract

`node tools/capture.mjs --scenario <name> --out <dir> [--port 5100] [--viewport 540x960] [--fps 30] [--seconds 3] [--throttle 1]`
- Starts (or reuses) `vite preview` on `--port` after `vite build` if `dist/` is stale; uses Chrome via playwright-core; `?debug=1&clock=manual`.
- Scenario JSON: `{ "query": "...", "seed": 1, "setup": [["startRun",{...}]], "timeline": [{"frame": 30, "call": ["input","left"]}], "seconds": 3, "fps": 30 }`.
- Writes `frames/0000.png…`, `contact.png` (grid, frame index + time labels), `trace.json` (getState per frame), `meta.json` `{fps, viewport, events:[{frame, label}]}`.
- Also supports `--touch` (hasTouch, isMobile, real swipe gestures via CDP) and `--perf` (realtime clock, CPU throttle, reports fps percentiles, long frames, draw calls, JS heap).

## 6. Assets — swap contract (for the art AI)

`public/assets/manifest.json` is the single source of truth. To keep parallel lanes from colliding it only lists `parts` (`core.json`, `track.json`, `ui.json`, `audio.json` in `public/assets/manifest/`), merged at load; ids must be unique across parts. Entry:
```json
{ "id": "char.runner.default", "type": "gltf", "src": "models/characters/runner_default.glb",
  "placeholder": "capsule-runner", "scale": 1, "pivot": "feet-center", "forward": "-z",
  "animations": {"run": "Run", "jump": "Jump", "roll": "Roll", "stumble": "Stumble", "death": "Death", "idle": "Idle", "leanL": "LeanLeft", "leanR": "LeanRight"},
  "spec": "Height 1.7 m, origin at feet, faces -Z, ≤ 6k tris, 1 material, 512² texture" }
```
Types: `gltf`, `texture`, `sprite` (UI), `audio`, `font`, `json`. If `src` is missing/404 the placeholder is used. Swapping art = drop the file at `src` (or edit `src`) — zero code changes. `docs/ASSETS.md` is generated from the manifest (`npm run assets:doc`); `npm run assets:check` validates files, sizes, tri counts, clip names.

## 7. Online

`src/online/LeaderboardService.ts` interface (`submitScore`, `getBoard(scope: 'global'|'weekly'|'friends', around?)`, `getProfile`). Provider chosen by `VITE_ONLINE_PROVIDER=mock|http`. Mock = seeded fake league stored locally with realistic latency jitter. Http = `worker/` endpoints; D1 schema in `worker/schema.sql`. Worker returns 503 JSON when no D1 binding so the client falls back to mock gracefully.

## 8. Ports (parallel lanes)

main 5100 · lane-a 5101 · lane-b 5102 · lane-c 5103 · lane-d 5104. Always pass your lane's port to capture tools.

## 8b. Lane ownership (parallel work without merge pain)

| lane | owns | may touch additively |
|---|---|---|
| A run feel | `src/game/player`, `camera`, `world`, `src/input` | scenarios, tuning, events |
| B track content | `src/game/obstacles`, `spawn`, `collectibles`, `powerups`, `hoverboard`, `chaser`, `collision`, `score` | `manifest/track.json` |
| C UI & meta | `src/ui`, `src/meta`, `src/online`, `worker/` leaderboard routes | `manifest/ui.json` |
| D platform | `src/dev`, `src/audio`, `tools/`, `docs/`, `wrangler.jsonc`, `.github/`, `index.html`/PWA | `manifest/audio.json`, `manifest/core.json` |

Shared files (`src/core/*`, `src/main.ts`, `src/game/Run.ts`) change **additively only**: new events are declared with module augmentation (`declare module "../core/events" { interface EventMap { … } }`) inside the owning module; systems register themselves in registries instead of editing a central switch.

## 9. The gauntlet (how work is judged)

- `gauntlet/pieces.json` lists the smallest independently judgeable pieces, each with a comparison dimension and evidence recipe.
- Reference evidence lives in `.reference/` (git-ignored, never shipped, never published): frames captured from real current Subway Surfers gameplay footage plus `dossier.md` measurements.
- Per piece, per round: **builder** implements/improves and produces our evidence with `tools/capture.mjs`; builder then assembles a neutral packet `.gauntlet/<piece>/r<N>/A` and `/B` (order chosen by the orchestrator) containing only frames, contact sheet and neutral `meta.json` — no names, paths, or notes that reveal which is which.
- A separate **critic** with fresh context judges A vs B on the piece's dimension only (placeholder art quality is out of scope; composition, proportions, timing, motion, readability, flow, responsiveness are in scope), picks a winner, and names the single biggest gap of the loser.
- Loop until ours wins. Verdicts are stored in `gauntlet/verdicts/<piece>/r<N>.json`; one-line events append to `gauntlet/progress.jsonl`.
- Engineering pieces with no Subway Surfers counterpart (cheats, editor, asset pipeline, deploy, perf) are judged against their written acceptance criteria and must PASS every criterion.
