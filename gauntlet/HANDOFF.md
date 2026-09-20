# Hydra Surfers — handoff (2026-09-19, medieval pass)

Read this first when continuing. Contracts: `PLAN.md` (architecture, §10 for the medieval pass) and `docs/ONLINE.md` (API).

The game became a medieval runner for a private group of ~30-40 friends over a 30-day season. Everything below was built on the existing architecture (deterministic sim, tuning registry, event bus, asset manifest, registries); no system was rewritten except where the theme required it (environment, road, obstacle and character placeholders).

## Status by phase

**Phase 1 — medieval identity: done.** Eight regions (village, forest, castle, mines, cemetery, battlefield, ruins, swamp) with their own palette, fog, light, scenery and pattern weights, crossing with a blend. Cobbled road with kerbs and cart ruts. Obstacle kit re-dressed with identical colliders and spawn rules (barricade, hanging beam, cargo wagon, runaway cart, hay ramp, gatehouse, lantern post). Ten archetypes whose silhouette is manifest data; royal guard chaser; eight mounts; medieval power-ups plus Aegis and Hourglass. Tavern hub, all UI in pt-BR.

**Phase 2 — replayability: done.** Daily seed (3 ranked attempts), weekly challenge with data-driven mutators (5 attempts), tournaments, daily/weekly contracts with a 3-day catch-up window, achievements, titles, extended lifetime stats and records, rich results screen, rival line on the tavern and rank movement on results.

**Phase 3 — progression: done.** Account level + 30-level season track with rewards and catch-up bonus, XP daily cap, 15 equipment items where every item is a trade-off (tested invariant), builds applied through run rules, economy prices centralised, 7-day streak that only restarts.

**Phase 4 — social: mostly done.** Profiles (name, title, procedural crest), daily/weekly/season/tournament boards and record boards (distance, coins, combo, clean), rival lines, community bounty (sum over the bounty window), bearer-token identity with recovery code, proportional plausibility checks.

**Phase 5 — polish: partly done.** Near miss, perfect dodge, combo, clean streak (SkillSystem, tested). Run events (market day, ambush, runaway carts, storm, fog) and per-run weather as spawn/light modifiers. Speed FOV (off with reduced motion). Sounds for near miss, perfect dodge (pitch climbs along the streak), combo milestones, blocked hits, road events (horn) and records/level-ups on results (fanfare).

**Fairness (anti-frustration).** `tests/unit/fairness.test.ts` generates the real road (spawner + regions + events) for the free run and every weekly challenge, at normal speed and under the Hourglass, and proves every stretch is reachable with a 0.25 s human budget per lane change. It found and fixed: runaway carts ignoring the Hourglass (they met the runner up to ~13 m early), gaps too short to cross two lanes at top speed in dense modes (new `spawn.minGapSeconds`, planned on the mode's speed, not the build's), and pickup draws that let a build with more pickups shift the rest of a daily road (now asserted: every equipment item leaves the daily road identical). After touching patterns or spawn tuning run `FAIRNESS_SEEDS=200 npx vitest run tests/unit/fairness.test.ts`.

**Late game.** After top speed (~4 min, `late.*` tuning) the pressure keeps building through the layout: gaps tighten toward `late.gapMul`, each pattern's `lateWeight` shifts the mix toward the harder ones, and a late-only wagon slalom appears (the open lane moves one step per gate). Announced with a toast and horn ("O cerco se fecha!"). The fairness test covers it (8 km). Capture: `npm run capture -- --scenario late --devtools`.

**Set pieces and regions.** Four patterns of their own, each tied to the regions where they belong (`Pattern.biomes`, overridden when a road event calls for them): charging knights (battlefield, castle), closing gates (castle, village — the portcullis drops as you approach, the opening moves one lane per gate), mine tunnel (mines — beams across the road, one roll after another) and dragon fire (ruins, cemetery, battlefield — one or two lanes burning). New road events: Cavaleiros, Fechem os portões, Invasão and Dragão, which also flies a dragon over the road (`src/game/world/Dragon.ts`) with a roar. Captures: `--scenario setpieces --devtools` (knights) and `--scenario gates --devtools`.

**Broken bridge.** New obstacle `hole` (jump only; falling in is a crash, rolling does not help) with a plank-deck placeholder, a `brokenBridge` pattern (first row spans the road, later rows leave one or two lanes whole, rows spaced to land and jump again, coins arc over a hole) and a "Ponte quebrada!" road event that favours it. Capture: `--scenario bridge`.

**Ghosts.** Daily run only (the road must be the same). `GhostRecorder` samples the runner at 10 Hz of run time into preallocated arrays; a ranked daily run that beats the day's best uploads the track with the run (`src/shared/ghost.ts`, checked by the Worker against the run's time and distance, one ghost per player and day). `GhostRunner` replays the ghost of the player just above you (your own when you lead, the lowest before your first run) as a translucent runner with a HUD line; settings can turn it off. Dev: cheat `ghostDemo`, capture `--scenario ghost --devtools`.

**Rain.** Rain weather and the storm event draw rain streaks (`src/game/world/Rain.ts`: one LineSegments draw call animated in the vertex shader, amount = draw range, `rain.*` tuning), driven by the mood's `rain` value. Capture: `npm run capture -- --scenario rain`.

**Houses.** Four houses (`HOUSES` in the season content), picked in the crest screen (`profile.social.faction`). Runs carry the house; `/api/houses` ranks by the mean of each house's five best weekly players (empty places = 0). "Casas" tab in the champions book. Existing databases need `worker/migrations/0002_houses.sql` once.

**First visit.** The tavern asks for the name the group will see; a taken name is reported instead of silently getting digits, and with no server the name is kept and registered with the first run.

## Not done (deliberately left for a second stage)

1. **Rooftop sequences** (jumping onto roofs, running along them, awnings). Everything else from the brief's set-piece list is in: wagon ramp, gatehouse, broken bridge, late slalom, charging knights, closing gates, mine tunnel, dragon fire.
2. **In-game analytics dashboard**: deliberately replaced by the ready-made queries in `docs/ONLINE.md` ("Reading the season"). Run `cause` is opt-out in the settings.

## Operating the season

- Edit `src/shared/content/season.ts` to set the season start date, rewards, weekly challenges, tournaments, bounties and prices. The day boundary is local midnight UTC-3 (`src/shared/calendar.ts`).
- D1 must be bound for the group to see each other (`docs/ONLINE.md`). Balance data: `SELECT cause, COUNT(*), AVG(distance) FROM runs GROUP BY cause`.

## Verified (2026-09-19)

Typecheck (app + worker), vitest 22 files / 169 tests (Worker routes against real SQLite via node:sqlite), build within the 250 kB initial-JS budget, assets:check, devstrip, wrangler dry run. Captures of the region crossings (village → ruins → mines), a pickup run, the tavern and the results screen.

## Environment gotchas

- **C: is almost full**; keep heavy data on K:.
- Chrome via `playwright-core` `channel:'chrome'`; never download Playwright browsers.
- `npm run capture -- --scenario <name>` is the reliable way to see frames (`tools/scenarios/`: `biomes`, `tavern`, `results`, `pickups`, …).
- Git on this machine converts LF → CRLF in the working copy (warnings only).
- `gauntlet/workflows/lanes.js` still references the removed `check:brand`; drop those lines before reusing it.
