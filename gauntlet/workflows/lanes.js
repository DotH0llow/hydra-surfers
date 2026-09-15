export const meta = {
  name: 'yard-dash-lanes-lean',
  description: 'Yard Dash build loop (lean): one piece at a time, builder → blind/engineering critic → fix, close calls pass, max 3 rounds, merge winners to main',
  whenToUse: 'Continue the Yard Dash gauntlet. Pass args {pieces:[ids]} to pick pieces; default is the priority order below. Resume a stopped run in the same session with resumeFromRunId.',
  phases: [
    { title: 'Build', detail: 'builder implements the piece and packages evidence' },
    { title: 'Judge', detail: 'blind compare critic and/or engineering critic' },
    { title: 'Merge', detail: 'merge the lane branch into main' },
  ],
}

// Sequential on purpose: usage limits, not wall-clock, bound throughput, and every agent killed
// mid-work by a limit wastes its context. One agent at a time wastes the least.

const ROOT = 'C:/Users/Pichau/AppData/Roaming/Claude/scratch-workspaces/1b75f0df-10f3-4d0e-929e-5157d4a77477/7cda4526-2458-4296-9f90-00d1e50fa47f/scratch-2026-09-13-093770'
const KDATA = 'K:/yard-dash-data'
const PK = `${KDATA}/packets`
const MAX_ROUNDS = 3

const LANES = {
  A: { key: 'A', name: 'Run feel', port: 5101, branch: 'lane/a-run-feel', wt: `${KDATA}/wt/lane-a`, owns: 'src/game/player, camera, world, src/input' },
  B: { key: 'B', name: 'Track content', port: 5102, branch: 'lane/b-track', wt: `${KDATA}/wt/lane-b`, owns: 'src/game/obstacles, spawn, collectibles, powerups, hoverboard, chaser, collision, score (+ manifest/track.json additively)' },
  C: { key: 'C', name: 'UI & meta', port: 5103, branch: 'lane/c-ui-meta', wt: `${KDATA}/wt/lane-c`, owns: 'src/ui, src/meta, src/online, worker/ leaderboard routes (+ manifest/ui.json additively)' },
  D: { key: 'D', name: 'Platform & tools', port: 5104, branch: 'lane/d-platform', wt: `${KDATA}/wt/lane-d`, owns: 'src/dev, src/audio, tools/, docs/, wrangler.jsonc, .github/, index.html/PWA (+ manifest/audio.json, manifest/core.json additively)' },
}

// Core loop feel first, then the content and UI a player sees every run, then platform, then depth.
const DEFAULT_ORDER = [
  'A2-lane-switch', 'A3-jump', 'A4-roll', 'A6-speed-pacing', 'A5-input-response', 'A1-camera-framing',
  'B1-obstacle-kit', 'B3-collision-stumble', 'B5-coins', 'B2-track-generation', 'B4-chaser',
  'C1-hud', 'C2-home-and-start', 'C3-pause-revive-results',
  'D1-cheats-panel', 'D5-perf-mobile', 'D6-cloudflare-deploy', 'D3-asset-pipeline', 'D4-audio',
  'A7-character-motion', 'B7-hoverboard', 'B6-powerups', 'C4-missions-multiplier', 'C5-shop-progression', 'C6-leaderboards', 'D2-editor',
]

// Kind + judged dimension (compare critics are blind to the repo, so the dimension travels in the prompt).
const PIECES = {
  'A1-camera-framing': { kind: 'compare', dim: 'Still frames mid-run on a straight section: camera height, distance behind runner, pitch, FOV, where the runner sits on screen, lane width vs runner size, track/rail proportions, curved-world horizon bend, draw distance, fog/atmosphere depth cues, portrait composition. Art fidelity excluded.' },
  'A2-lane-switch': { kind: 'compare', dim: 'Frame strips at 30 fps of single and rapid double lane changes: switch duration in frames, easing curve, body lean, camera follow lag and roll, reversal mid-switch, snap/overshoot, how instantly motion begins.' },
  'A3-jump': { kind: 'compare', dim: 'Frame strips at 30 fps: jump apex height relative to runner height, airtime frames, arc shape (rise vs fall asymmetry), camera vertical follow, lane change while airborne, swipe-down fast fall into roll, landing recovery.' },
  'A4-roll': { kind: 'compare', dim: 'Frame strips at 30 fps: roll duration, pose height, entry/exit timing, roll → jump cancel, lane change while rolling, camera response.' },
  'A5-input-response': { kind: 'compare+engineering', dim: 'How crisply rapid input sequences execute (e.g. left,left,jump,roll within ~1 s): no dropped or delayed actions, motion begins on the first frame after the gesture, buffered actions fire at the right moment.' },
  'A6-speed-pacing': { kind: 'compare', dim: 'Perceived and measured forward speed at run start, ~30 s, ~60 s, ~120 s, ~180 s (sleepers/ties passed per second relative to runner size), acceleration smoothness, top speed.' },
  'A7-character-motion': { kind: 'compare', dim: 'Readability and timing of runner poses/animation: run cycle cadence, lean into lane change, jump tuck, roll ball, landing squash, stumble recoil, crash. Judged on motion/timing/silhouette, not model quality.' },
  'B1-obstacle-kit': { kind: 'compare', dim: 'Set of obstacle types and their proportions vs runner and lanes: low barrier (jump or roll), high barrier (roll only), stationary train, oncoming moving train, ramp onto train roofs, roof running, tunnels/overpasses, readability of which action each demands at a glance.' },
  'B2-track-generation': { kind: 'compare', dim: 'Contact sheets sampled every 2 s over the first 3 minutes: obstacle density, pattern variety, fairness (always a path), use of train roofs, coin guidance lines, difficulty ramp.' },
  'B3-collision-stumble': { kind: 'compare', dim: 'Frame strips: side-bump stumble (runner deflects back to lane, chaser closes in), second stumble within window = caught, frontal crash sequence, roof edge / ramp leniency, hit-box fairness.' },
  'B4-chaser': { kind: 'compare', dim: 'Run start chase, how long chaser stays on screen before falling back, return on stumble, catch sequence, on-screen size/position.' },
  'B5-coins': { kind: 'compare', dim: 'Coin line layouts (straight, lane-changing, arcs over barriers, on roofs), spacing, height, spin, pickup feedback (flash/sparkle/HUD tick) and pacing of collection.' },
  'B6-powerups': { kind: 'compare', dim: 'Jetpack (lift, sky coin line, descent), super sneakers (higher jumps), coin magnet (pull radius/feel), 2x multiplier; pickup presentation, duration timers, end transitions.' },
  'B7-hoverboard': { kind: 'compare', dim: 'Activation (double-tap), board visual state, duration, crash absorbed with board-break effect and brief invulnerability, HUD indicator.' },
  'C1-hud': { kind: 'compare', dim: 'Layout, hierarchy and readability at phone size: score + multiplier, coin counter, pause, power-up timers, hoverboard indicator, mission toast; safe areas; number animation.' },
  'C2-home-and-start': { kind: 'compare', dim: 'Home screen composition (runner idle on track, tap-to-play, navigation to shop/missions/leaderboard/profile/settings, currency display) and the transition from tap into a running game.' },
  'C3-pause-revive-results': { kind: 'compare', dim: 'Pause overlay and resume countdown; crash → revive offer (keys) with countdown; results screen (score, coins, best, mission progress, play again/home); timing and clarity of the flow.' },
  'C4-missions-multiplier': { kind: 'compare', dim: 'Mission sets (3 at a time), in-run completion toast, multiplier increase on set completion, daily challenge (original equivalent), clarity of progress UI.' },
  'C5-shop-progression': { kind: 'compare', dim: 'Currencies (coins, keys), character & board catalog with skins, power-up upgrade levels, purchase/equip UX and feedback, progression pacing.' },
  'C6-leaderboards': { kind: 'compare+engineering', dim: 'Leaderboard/league UI: ranks, player row highlight, tiers/brackets, weekly reset timer, rewards preview.' },
  'D1-cheats-panel': { kind: 'engineering' },
  'D2-editor': { kind: 'engineering' },
  'D3-asset-pipeline': { kind: 'engineering' },
  'D4-audio': { kind: 'engineering' },
  'D5-perf-mobile': { kind: 'engineering' },
  'D6-cloudflare-deploy': { kind: 'engineering' },
}

const NOTES = {
  'D3-asset-pipeline': 'Foundation critic follow-ups: (1) assets/files.json is a build-time index, so a texture dropped into an already-built or deployed dist is ignored until rebuild — make docs/ASSETS.md and assets:check state the rebuild step (or make drop-in work); (2) garbage bytes at audio srcs are listed as loaded until lazy decode fails; (3) 27/27 manifest ids are still placeholders.',
  'D5-perf-mobile': 'Foundation critic measured perf-run --perf --throttle 4 at 96162dc: p50 75 fps but p95 26.7 ms, p99 106.7 ms, 36 frames over 50 ms; initial JS 177.8 kB gzip.',
  'D6-cloudflare-deploy': 'Foundation critic follow-up: tools/check-brand.mjs uses \\b word boundaries, so joined spellings of the benchmark name slip through, and binaries are skipped — match substrings case-insensitively.',
}

const PASS_RULE = `Pass rule (PLAN.md §9): close calls count. Compare pieces pass when ours wins OR loses with margin "narrow". Engineering pieces pass when every criterion passes OR the only failures are minor.`

const PRE = `You are one agent in a build of "Yard Dash", an ORIGINAL mobile-first 3-lane endless runner whose mechanics are held to the bar of the current shipped Subway Surfers mobile game.
Main repo (branch main): ${ROOT}. Each lane has its own git worktree on drive K: (given below). Binding contracts: PLAN.md and gauntlet/pieces.json in your worktree — read only the sections you need.
Progress log: run \`node ${ROOT}/gauntlet/log.mjs <piece> <stage> <status> "<text under 140 chars>"\` at start (start) and end (done/fail).
Hard rules:
- Original branding only: no Subway Surfers / SYBO names, art, audio, logos or characters in shipped code, assets, docs or dist (\`npm run check:brand\`). ${ROOT}/.reference/ and ${PK}/ hold reference footage frames: never commit, copy into a repo, or publish them.
- Do not sign in to websites or download videos. Windows; Bash (git-bash) and PowerShell available. Use playwright-core with channel:'chrome' — never download Playwright browsers.
- DISK: C: is nearly full. Heavy scratch (worktrees, captures, frames) goes under ${KDATA}/. Never delete user files. Stop and report if C: drops under 3 GB.
- Git commits end with: Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
- BUDGET: the weekly usage allowance is nearly spent. Do the smallest change that meets the bar. Read contact sheets, not every frame; don't re-verify verified work; no exploratory refactors; commit after each sub-part.
${PASS_RULE}
Your final message is data returned to an orchestrator, not prose for a human.
`

const BUILD_SCHEMA = { type: 'object', properties: {
  blocked: { type: 'boolean' }, summary: { type: 'string' }, commit: { type: 'string' },
  checks_run: { type: 'array', items: { type: 'string' } }, known_gaps: { type: 'array', items: { type: 'string' } }, packet_dir: { type: 'string' } },
  required: ['blocked', 'summary', 'commit', 'checks_run', 'known_gaps'] }
const COMPARE_SCHEMA = { type: 'object', properties: {
  winner: { type: 'string', enum: ['A', 'B'] }, margin: { type: 'string', enum: ['clear', 'narrow'] },
  items: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, better: { type: 'string', enum: ['A', 'B', 'tie'] }, why: { type: 'string' } }, required: ['item', 'better', 'why'] } },
  loser_biggest_gap: { type: 'string' }, loser_other_gaps: { type: 'array', items: { type: 'string' } } },
  required: ['winner', 'margin', 'items', 'loser_biggest_gap', 'loser_other_gaps'] }
const ENG_SCHEMA = { type: 'object', properties: {
  criteria: { type: 'array', items: { type: 'object', properties: {
    criterion: { type: 'string' }, pass: { type: 'boolean' }, severity: { type: 'string', enum: ['none', 'minor', 'major'] }, evidence: { type: 'string' } },
    required: ['criterion', 'pass', 'severity', 'evidence'] } },
  biggest_gap: { type: 'string' }, other_gaps: { type: 'array', items: { type: 'string' } } },
  required: ['criteria', 'biggest_gap'] }
const MERGE_SCHEMA = { type: 'object', properties: {
  main_commit: { type: 'string' }, checks_run: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
  required: ['main_commit', 'checks_run', 'notes'] }

async function run(prompt, opts) {
  const r = await agent(prompt, opts)
  if (r === null || r === undefined) throw new Error(`agent failed or was skipped: ${opts.label}`)
  return r
}

function sideFor(id, round) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973
  return (h + round) % 2 === 0 ? 'A' : 'B'
}

const laneOf = id => LANES[id[0]]

function header(lane, id, stage) {
  return `Piece: ${id}  stage: ${stage}  (lane ${lane.key} — ${lane.name}).
Worktree: ${lane.wt} (branch ${lane.branch}); capture port ${lane.port}. Work and commit only there; in ${ROOT} only run gauntlet/log.mjs and read .reference/. Your lane owns ${lane.owns}; shared files (src/core/*, src/main.ts, src/game/Run.ts) change additively only (PLAN §8b).`
}

function prevBlock(id, prev) {
  if (!prev) return ''
  const out = [`Round ${prev.round} did not pass.`]
  if (prev.cmp) {
    out.push(`Blind critic picked ${prev.cmp.winner} (${prev.cmp.margin}); OUR side was ${prev.side}. Our biggest gap: ${prev.cmp.loser_biggest_gap}. Other gaps: ${JSON.stringify(prev.cmp.loser_other_gaps)}`)
    out.push(`Record it: write gauntlet/verdicts/${id}/r${prev.round}.json = ${JSON.stringify({ piece: id, round: prev.round, ours: prev.side, result: 'fail', verdict: prev.cmp })} and include it in your commit.`)
  }
  if (prev.eng) out.push(`Engineering critic (verdict already committed) found major failures: ${JSON.stringify(prev.eng.criteria.filter(c => !c.pass && c.severity === 'major'))}. Biggest gap: ${prev.eng.biggest_gap}`)
  out.push('Fix the biggest gap first.')
  return out.join('\n')
}

function mergeMainFirst(lane) {
  return `Before building: if main has commits your branch lacks (git -C ${lane.wt} log --oneline ${lane.branch}..main), git merge main (resolve per PLAN §8b; npm ci if package-lock.json changed). If the worktree has uncommitted changes from an interrupted builder, review them and keep what is sound.`
}

function compareBuilder(lane, id, round, side, prev) {
  const other = side === 'A' ? 'B' : 'A'
  return `${header(lane, id, `build r${round}`)}
${round === 1 ? mergeMainFirst(lane) : ''}
Reference: ${ROOT}/.reference/dossier.md (target numbers, if it exists) and ${ROOT}/.reference/pieces/${id}/notes.md with its item folders. If this piece has no notes.md, use the closest existing packets instead (A2 lane switch, A5 input, A7 character motion hold jump/roll/camera strips and timings) — return blocked=true only if nothing relevant exists.
Task: match or beat the reference on this dimension: "${PIECES[id].dim}"${PIECES[id].kind.includes('engineering') ? ' This piece also has engineering criteria in pieces.json — satisfy them.' : ''}
Every gameplay number lives in tuning (PLAN §3); hot loop allocation-free; add unit tests only for logic you change.
${prevBlock(id, prev)}
Capture OUR evidence with tools/capture.mjs on port ${lane.port} matching the piece's evidence recipe item by item (540x960, 30 fps strips or stills). Check our contact sheets once before packaging.
Checks: npm run typecheck, npm test, npm run build, npm run check:brand. Commit to ${lane.branch}.
Blind packet at ${PK}/${id}/r${round}/ (clear it first): OUR evidence in ${side}/, REFERENCE evidence in ${other}/, identical neutral item folder names, frames/0000.png…, contact.png regenerated for both sides with the same tool (labels: frame index + time only), neutral meta.json {fps,size,kind,events}. Copy reference frames verbatim (resize only) using the best occurrences notes describe. No captions, names, URLs or paths. Write items.md with the item list and dimension text only.
Return packet_dir and blocked=false.`
}

function engBuilder(lane, id, round, prev) {
  return `${header(lane, id, `build r${round}`)}
${round === 1 ? mergeMainFirst(lane) : ''}
Task: implement engineering piece ${id} so its pieces.json criteria pass under an independent critic.${NOTES[id] ? `\n${NOTES[id]}` : ''}
${prevBlock(id, prev)}
Prove each criterion with the cheapest decisive check (a test, a capture, a build/dry-run). Keep docs accurate.
Checks: npm run typecheck, npm test, npm run build, npm run check:brand, npm run check:devstrip. Commit to ${lane.branch}. Return blocked=false.`
}

function compareCritic(id, round) {
  return `Piece: ${id}  stage: critic r${round}.
You are an independent judge with fresh context. Log start and end: node ${ROOT}/gauntlet/log.mjs ${id} "critic r${round}" <start|done> "<neutral text: which letter won, margin, why>".
Open ONLY files inside ${PK}/${id}/r${round}/ (items.md, A/, B/). No repositories, git history, other folders or web.
Packets A and B show the same evidence items from two builds of a mobile 3-lane endless runner. Judge ONLY this dimension: "${PIECES[id].dim}"
Out of scope: art fidelity, model/texture detail, lighting polish, branding and HUD styling — a greybox can win. Do not favour the more detailed-looking build.
Method (budget-conscious): contact sheets first; open individual frames only to count timing where it decides the result.
Pick one overall winner. margin = "narrow" if the loser is within tolerance on everything the dimension measures (timings within ±2 frames at 30 fps or ±15%, sizes/positions within ±10% of the screen dimension) and no item is clearly worse; otherwise "clear". Name the loser's single biggest gap as a concrete, measurable change, plus other gaps.
Also write the verdict JSON to ${PK}/${id}/r${round}/verdict.json.`
}

function engCritic(lane, id, round, alsoCompare) {
  const file = `gauntlet/verdicts/${id}/r${round}${alsoCompare ? '-eng' : ''}.json`
  return `${PRE}Piece: ${id}  stage: engineering critic r${round}  (lane ${lane.key}).
Independent engineering critic with fresh context. Verify every criterion of ${id} in pieces.json with the cheapest decisive evidence you run yourself:
- Fresh checkout: git -C ${lane.wt} worktree add --detach ${KDATA}/wt/${id}-critic-r${round} ${lane.branch}; npm ci; npm run typecheck; npm test; npm run build (remove the worktree when done).
- Then one targeted check per criterion (capture on port ${lane.port + 10} with --touch/--perf/--devtools where relevant, output under ${KDATA}/; greps over dist/ for absence criteria; dry-runs for tooling). No exhaustive probing.
Per criterion: pass, severity ("none" if pass; "minor" = cosmetic, docs wording, or a measured value within 10% of target; otherwise "major"), evidence.
Write the verdict JSON to ${lane.wt}/${file} and commit only that file on ${lane.branch} in ${lane.wt}. biggest_gap = most important failure (or "none").`
}

function mergePrompt(lane, id, v) {
  return `${PRE}${header(lane, id, 'merge')}
Piece ${id} PASSED in round ${v.round}${v.close ? ' (close call)' : ''}. Integrate into main:
1. In ${lane.wt}: ${v.compare ? `write gauntlet/verdicts/${id}/r${v.round}.json = ${JSON.stringify({ piece: id, round: v.round, ours: v.side, result: v.close ? 'pass-close' : 'pass', verdict: v.compare })}; ` : ''}append any remaining gaps as follow-ups to gauntlet/followups.md under "## ${id}"; commit.
2. git merge main; resolve per PLAN §8b; npm ci if package-lock.json changed.
3. npm run typecheck, npm test, npm run build, npm run check:brand, npm run check:devstrip. Fix only integration breakage; commit.
4. In ${ROOT} (branch main; never touch .reference): git status --short must be clean, then git merge --ff-only ${lane.branch}; if not a fast-forward, repeat from step 2. npm ci in ${ROOT} if package-lock.json changed.
5. Log done with the new main commit.`
}

async function runPiece(id) {
  const lane = laneOf(id)
  const p = PIECES[id]
  const isCompare = p.kind.includes('compare')
  const isEng = p.kind.includes('engineering')
  let prev = null
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const side = sideFor(id, round)
    const b = await run(PRE + (isCompare ? compareBuilder(lane, id, round, side, prev) : engBuilder(lane, id, round, prev)),
      { label: `${id}:build:r${round}`, phase: 'Build', schema: BUILD_SCHEMA })
    if (b.blocked) return { status: 'blocked', rounds: round - 1 }
    let cmp = null, eng = null, pass = true, close = false
    if (isCompare) {
      cmp = await run(compareCritic(id, round), { label: `${id}:critic:r${round}`, phase: 'Judge', schema: COMPARE_SCHEMA })
      const won = cmp.winner === side
      close = !won && cmp.margin === 'narrow'
      pass = won || close
      log(`${id} r${round}: ours ${won ? 'won' : close ? 'lost narrowly (close call → pass)' : 'lost clearly — ' + cmp.loser_biggest_gap}`)
    }
    if (isEng && pass) {
      eng = await run(engCritic(lane, id, round, isCompare), { label: `${id}:eng-critic:r${round}`, phase: 'Judge', schema: ENG_SCHEMA })
      const major = eng.criteria.filter(c => !c.pass && c.severity !== 'minor')
      const minor = eng.criteria.filter(c => !c.pass && c.severity === 'minor')
      pass = eng.criteria.length > 0 && major.length === 0
      if (pass && minor.length) close = true
      log(`${id} r${round}: engineering ${eng.criteria.length - major.length - minor.length}/${eng.criteria.length} pass, ${minor.length} minor, ${major.length} major`)
    }
    if (pass) {
      const m = await run(mergePrompt(lane, id, { round, side: isCompare ? side : null, compare: cmp, close }), { label: `${id}:merge`, phase: 'Merge', schema: MERGE_SCHEMA })
      log(`${id} passed${close ? ' (close call)' : ''} and merged into main at ${m.main_commit}`)
      return { status: close ? 'pass-close' : 'pass', rounds: round, main: m.main_commit }
    }
    prev = { round, side, cmp, eng }
  }
  log(`${id}: parked after ${MAX_ROUNDS} rounds`)
  return { status: 'parked', rounds: MAX_ROUNDS, gap: prev.cmp ? prev.cmp.loser_biggest_gap : prev.eng.biggest_gap, lastRound: prev }
}

const order = (args && Array.isArray(args.pieces) && args.pieces.length) ? args.pieces : DEFAULT_ORDER
const results = {}
for (const id of order) {
  if (!PIECES[id]) { log(`Unknown piece ${id} — skipped`); continue }
  try {
    results[id] = await runPiece(id)
  } catch (e) {
    results[id] = { status: 'aborted', error: String(e && e.message || e) }
    log(`Stopped at ${id}: ${results[id].error}`)
    break
  }
}
return results
