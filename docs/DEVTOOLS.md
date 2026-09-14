# Devtools

Three layers, from lightest to heaviest:

1. **Debug API** `window.__game`: scripting and inspection for tools, tests and critics. It ships in every build and is off unless `?debug=1` (always on under `npm run dev`).
2. **Dev panel** (`src/dev/`): an on-screen panel with live stats and a button for every cheat. It is a separate chunk loaded by dynamic import only when devtools are enabled, and is stripped from production bundles.
3. **Capture tools** (`tools/`): deterministic frame captures, touch-gesture captures, perf runs and contact sheets, driven through the debug API in the locally installed Chrome.

## Flags (`src/core/flags.ts`)

| flag | how to enable | effect |
|---|---|---|
| `debug` | `npm run dev`, or `?debug=1` on any build | installs `window.__game` |
| `devtools` | build: `npm run dev` or `VITE_DEVTOOLS=1 npm run build`; runtime: `?dev=1` (automatic in dev) | dynamically imports `src/dev` and shows the panel toggle |
| `clock` | `?clock=manual` | the sim advances only through `__game.step()` |
| `seed` | `?seed=123` | seed for the first run |
| `scenario` | `?scenario=barrier-ahead` | scenario used when a run starts from Home |
| `autostart` | `?autostart=1` | skip Home |
| `mute` | `?mute=1` | no audio |

The devtools gate is the compile-time constant `__DEVTOOLS_BUILD__` (defined in `vite.config.ts`) combined with `flags.devtools`. When it is `false`, Vite removes the `import("./dev/index")` branch entirely. `npm run check:devstrip` builds twice (with `VITE_DEVTOOLS` unset and with `VITE_DEVTOOLS=1`) and fails if the production output contains any devtools marker, or if the devtools build contains none (so the check cannot pass vacuously). CI runs `npm run check:devstrip -- --skip-build` against the real `dist/`.

## Dev panel

- Toggle: the backquote key (<code>`</code>), the small **DEV** button bottom-left, or a three-finger tap.
- Shows fps, worst frame time, draw calls, triangles, DPR, screen, run mode, clock, speed, distance, lane/state and JS heap (when the browser exposes it). It samples only while open.
- Lists every registered cheat, grouped, with inputs for numeric arguments.
- The current panel is intentionally minimal. The full cheats panel (piece D1) and the tuning editor (piece D2) build on the same registries: `listCheats()` in `src/core/cheats.ts`, `tuning.list()` in `src/core/tuning.ts`, and `app.store`.

### Cheats

A cheat is registered once and is then available everywhere:

```ts
import { registerCheat } from "../core/cheats";
registerCheat({ name: "giveCoins", label: "Give coins", group: "Profile",
  args: [{ name: "amount", kind: "number", default: 1000 }],
  run: (n) => store.update((p) => (p.currencies.coins += Number(n))) });
```

Call it from the panel or with `window.__game.cheat("giveCoins", 500)`. Current cheats: `god`, `setSpeed`, `timeScale`, `crash`, `giveCoins`, `giveKeys`, `resetProfile`, and `devPanel` (registered by the panel). The generated list with labels is in [TUNING.md](TUNING.md#cheats).

## Debug API (`window.__game`)

Contract methods (PLAN.md §4):

| method | behaviour |
|---|---|
| `ready` | promise; resolves when assets and the first frame are ready |
| `setClock('realtime' \| 'manual')` | manual: the sim advances only via `step` |
| `step(frames, fps = 60)` | advance and render exactly `frames` frames of `1/fps` s (the 120 Hz sim uses integer tick accounting, so runs are reproducible) |
| `setSeed(n)` | seed for the next run |
| `startRun({scenario?, seed?, skipIntro?})` | begin a run |
| `goto(screen)` | `home` `run` `pause` `gameover` `shop` `missions` `leaderboard` `settings` |
| `input(action)` | `left` `right` `jump` `roll` `hoverboard` `pause` `tap`, through the same router as real input |
| `getState()` | JSON snapshot: time, frame, speed, distance, score, multiplier, coins, player, camera, chaser, powerups, screen, render stats |
| `setTuning(path, value)` / `getTuning()` | live tuning |
| `cheat(name, ...args)` | run a cheat |

Extras: `screenshot()` returns a canvas PNG data URL (no DOM UI). Also available: `tuningSchema()`, `cheats()`, `scenarios()`, `assets()` (which ids use placeholders), `profile()`, `entities()` (live obstacles and coins in sim space), `inputLog(since?)` (every action the game received, with source, tick and frame), and `isReady()`.

## Capture tools

All tools use `playwright-core` with the locally installed Chrome (`channel: "chrome"`). Never run `playwright install`. Output goes to `.captures/` (git-ignored) unless `--out` is given. Use your lane's port (PLAN.md §8).

### `tools/capture.mjs`

```sh
node tools/capture.mjs --scenario lane-switch --port 5100                  # deterministic frames
node tools/capture.mjs --scenario touch-rapid --port 5100                  # real touch swipes (scenario sets touch)
node tools/capture.mjs --scenario jump --touch --viewport 375x812          # any scenario with touch gestures
node tools/capture.mjs --scenario perf-run --perf --throttle 4 --seconds 60
```

| option | default | meaning |
|---|---|---|
| `--scenario` | required | name in `tools/scenarios/` or a path to a JSON file |
| `--out` | `.captures/<name>[-touch][-perf]` | output directory |
| `--port` | 5100 | preview port; an already running preview of this app is reused |
| `--viewport` / `--dpr` | 540x960 / 1 | page size |
| `--fps` / `--seconds` | scenario or 30 / 3 | capture rate and length |
| `--touch` | off | `hasTouch` + `isMobile`; `input` items become swipes/taps through CDP `Input.dispatchTouchEvent` |
| `--perf` | off | realtime clock and CPU throttling; writes `perf.json` |
| `--throttle` | 1 | CPU slowdown factor for `--perf` |
| `--warmup` / `--shots` | 1 / 0 | perf: seconds excluded from stats / screenshot interval |
| `--devtools` | off | capture a `VITE_DEVTOOLS=1` build (`.capture/dist-devtools`) with `?dev=1` |
| `--query` | | extra query string, e.g. `scenario=train-ahead&seed=3` |
| `--rebuild` / `--no-build` | | force or skip the build-if-stale step |
| `--headed` / `--keep-server` / `--no-contact` | | debugging conveniences |

Deterministic mode: builds `dist/` if any source is newer, starts `vite preview`, and opens `?debug=1&clock=manual&mute=1`. It then runs the scenario `setup`. For each frame *f* it fires the timeline items at *f*, calls `step(1, fps)`, records `getState()` and takes a page screenshot (canvas plus DOM UI). An input at frame *f* can therefore be visible in frame *f* itself.

Outputs: `frames/0000.png…`, `contact.png`, `trace.json` (one `getState()` per frame) and `meta.json`. `meta.json` contains `fps`, `viewport`, `events: [{frame, label}]`, `responses` (per directional input: the actions the game actually received, and the frames until the first visible motion), the final state, page console errors and phase timings. A 180-frame capture takes about 13 s.

Perf mode writes `perf.json` with: fps avg/p50/p5/p1, frame-time p50/p95/p99/max, long frames (>20, >33, >50 ms), long tasks, draw calls max/avg, triangles, JS heap start/end/min/max, and the largest heap drop between 250 ms samples (the GC sawtooth). It also prints a PASS/FAIL line against the D5 budget.

### Scenario files (`tools/scenarios/*.json`)

```json
{ "description": "...", "seed": 1, "touch": false, "query": "",
  "setup": [["cheat", "god", true], ["startRun", { "scenario": "flat-straight", "skipIntro": true }]],
  "timeline": [
    { "frame": 30, "input": "left", "label": "left" },
    { "frame": 40, "key": "ArrowUp" },
    { "frame": 50, "call": ["setTuning", "input.swipeThresholdPx", 30] },
    { "frame": 60, "gesture": { "type": "swipe", "dir": "down", "distance": 90, "steps": 6 } }
  ],
  "repeatTimelineEvery": 0, "seconds": 3, "fps": 30, "viewport": "540x960" }
```

`setup` items are `[method, ...args]` calls on `window.__game`. The `startRun` scenario ids (`flat-straight`, `barrier-ahead`, `train-ahead`, `train-side`, `coin-line`, `obstacle-kit`, `default`) are the game's layouts in `src/game/spawn/scenarios.ts`. Gesture types: `swipe` (`dir` = left/right/up/down), `tap`, `doubletap`.

| file | what it shows |
|---|---|
| `run-straight` | empty straight track, no input |
| `lane-switch` | single left/right, fast double switch, reversal mid-switch |
| `jump` | plain jump, jump + lane change, jump then slam into roll |
| `roll` | plain roll, roll then jump cancel, roll + lane change |
| `crash` | frontal crash into a barrier, then results |
| `touch-rapid` | real touch flicks: left, left, up, down within 0.8 s, then right, right |
| `perf-run` | 20 s procedural god-mode run for `--perf` |

### `tools/contact-sheet.mjs`

```sh
node tools/contact-sheet.mjs --dir .captures/jump/frames --out sheet.png --fps 30 --cols 10 --max 90
```

Renders a grid page in Chrome and screenshots it. Each tile shows the frame index and time. Frames that have an event in the adjacent `meta.json` get an orange border and the event label. Above `--max` tiles, frames are sampled evenly and event frames are always kept.

## Other tools

| command | what it does |
|---|---|
| `npm run check:devstrip` | proves devtools are excluded from production builds (see above) |
| `npm run assets:check` | validates the manifest and asset files (formats, image sizes, glTF clip names and triangle budgets), lists placeholders in use, and flags hard-coded asset paths in `src/` |
| `npm run assets:doc` | regenerates [ASSETS.md](ASSETS.md) from the manifest (`--check` to verify) |
| `npm run docs:tuning` | regenerates [TUNING.md](TUNING.md) from the live registries (`--check` to verify) |
