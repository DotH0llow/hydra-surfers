/**
 * Layout fairness: no procedural road may contain a stretch the runner cannot get through.
 *
 * Barricades, beams, ramps and gatehouses are always passable by an action (jump, roll, run up,
 * run through), so the only things that close a lane are wagons and runaway carts. The check is a
 * reachability pass over a 3-lane grid: the runner moves forward, and a lane change costs
 * `LANE_CHANGE_SECONDS` of travel during which both lanes must be free — a budget for a human to
 * read and swipe, well above the 0.1 s the switch animation takes.
 *
 * It runs every weekly challenge (their speed, density and difficulty mutators) with the real
 * spawner, regions and road events, over the whole difficulty ramp.
 */
import { describe, expect, it } from "vitest";
import { Rng } from "../../src/core/rng";
import { tuning } from "../../src/core/tuning";
import { WAGON, RUNAWAY } from "../../src/game/obstacles/builtin";
import { defaultRules, resolveRules, type RunRules } from "../../src/game/rules";
import { Spawner } from "../../src/game/spawn/Spawner";
import { getScenario } from "../../src/game/spawn/scenarios";
import { speedAt, timeAtDistance } from "../../src/game/spawn/difficulty";
import { BiomeSystem } from "../../src/game/world/BiomeSystem";
import { EventDirector } from "../../src/game/world/events";
import { POWERUP_FX } from "../../src/game/powerups/effects";
import { WEEKLY_CHALLENGES } from "../../src/shared/content/season";
import { EQUIPMENT } from "../../src/meta/equipment";
import { dailyMode } from "../../src/meta/modes";
import type { ResolvedRunOptions, RunContext } from "../../src/game/types";

const LANE_CHANGE_SECONDS = 0.25;
/** Seeds per mode; raise with FAIRNESS_SEEDS=200 after changing patterns or spawn tuning. */
const SEEDS = Number(process.env.FAIRNESS_SEEDS ?? 24);
const METRES = 6000;
const STEP = 0.25;
/** Runner body margin added around every blocked interval. */
const BODY = 0.6;
/**
 * Road speed scales to check: normal, and slowed by the Hourglass. Carts share the road's clock,
 * so the meeting point does not move; a slower runner only has more time for each lane change.
 */
const SPEED_SCALES = [1, POWERUP_FX.hourglassSpeedScale];

interface Placed {
  type: string;
  lane: number;
  s: number;
  length: number;
  speed: number;
  /** Nominal runner speed the spawner planned this pattern for. */
  planned: number;
}

interface Block {
  type: string;
  lane: number;
  from: number;
  to: number;
}

function layout(seed: number, rules: RunRules, biomes?: string[], layoutSpeedMul = rules.speedMul): Placed[] {
  const placed: Placed[] = [];
  const state = { mode: "running", time: 0, distance: 0, prevDistance: 0, speed: 12, speedScale: 1 };
  const biomeSys = new BiomeSystem();
  const events = new EventDirector();
  const sp = new Spawner();
  const systems: Record<string, unknown> = { biomes: biomeSys, events };
  const ctx = {
    rng: new Rng(seed),
    rules,
    state,
    getSystem: (id: string) => systems[id],
    obstacles: {
      spawn: (type: string, lane: number, s: number, length?: number, speed?: number) => {
        placed.push({ type, lane, s, length: length ?? 0, speed: speed ?? 0, planned: sp.speed });
        return null;
      },
    },
    coins: { spawn: () => 0 },
  } as unknown as RunContext;
  const opts = { scenario: getScenario("default")!, seed, skipIntro: true, rules, biomes, layoutSpeedMul } as ResolvedRunOptions;
  biomeSys.reset(ctx, opts);
  events.reset(ctx, opts);
  sp.init(ctx);
  sp.reset(ctx, opts);
  sp.afterReset(ctx, opts);
  while (state.distance < METRES) {
    state.distance += 5;
    sp.fixedUpdate(ctx);
  }
  return placed;
}

/**
 * Where each obstacle closes its lane, for a runner going `scale` times the road speed. A wagon
 * closes its own extent. A runaway cart rolls toward the runner from `s` once they are
 * `spawnAhead` away: they meet its front at s - R·A/(v+R) and are alongside it for v·len/(v+R)
 * metres, after which the lane is clear again.
 */
function blocksFor(placed: Placed[], rules: RunRules, scale: number): Block[] {
  return placed.filter((o) => o.type === "wagon" || o.type === "runaway").map((o) => {
    if (o.type !== "runaway") return { type: o.type, lane: o.lane, from: o.s, to: o.s + o.length };
    const v = o.planned * rules.speedMul * scale;
    const r = o.speed * scale;
    const meet = o.s - r * (RUNAWAY.spawnAhead / (v + r));
    return { type: o.type, lane: o.lane, from: meet, to: meet + (v * o.length) / (v + r) };
  });
}

/** Runner speed at a track position (the curve is in run time; speedMul stretches distance). */
const speedAtS = (s: number, rules: RunRules) => speedAt(timeAtDistance(s / rules.speedMul)) * rules.speedMul;

/** First position no lane can reach, or -1. */
function firstDeadEnd(blocks: Block[], rules: RunRules, scale = 1): number {
  const n = Math.ceil(METRES / STEP) + 1;
  // prefix sums of blocked cells per lane: O(1) "is this window free"
  const blocked = [new Int32Array(n + 1), new Int32Array(n + 1), new Int32Array(n + 1)];
  const mark = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (const b of blocks) {
    const a = Math.max(0, Math.floor((b.from - BODY) / STEP));
    const z = Math.min(n - 1, Math.ceil((b.to + BODY) / STEP));
    for (let i = a; i <= z; i++) mark[b.lane + 1][i] = 1;
  }
  for (let l = 0; l < 3; l++) for (let i = 0; i < n; i++) blocked[l][i + 1] = blocked[l][i] + mark[l][i];
  const free = (l: number, a: number, z: number) => blocked[l][Math.min(n, z + 1)] - blocked[l][a] === 0;

  const reach = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let l = 0; l < 3; l++) reach[l][0] = mark[l][0] ? 0 : 1;
  for (let i = 0; i < n - 1; i++) {
    let any = false;
    const k = Math.max(1, Math.ceil((speedAtS(i * STEP, rules) * scale * LANE_CHANGE_SECONDS) / STEP));
    for (let l = 0; l < 3; l++) {
      if (!reach[l][i]) continue;
      any = true;
      if (!mark[l][i + 1]) reach[l][i + 1] = 1;
      for (const to of [l - 1, l + 1]) {
        if (to < 0 || to > 2 || i + k >= n) continue;
        if (free(l, i, i + k) && free(to, i, i + k)) reach[to][i + k] = 1;
      }
    }
    if (!any) return i * STEP;
  }
  return reach.some((r) => r[n - 1]) ? -1 : METRES;
}

const describeAround = (blocks: Block[], s: number) =>
  blocks
    .filter((b) => b.to > s - 40 && b.from < s + 20)
    .map((b) => `${b.type}@${b.lane} ${b.from.toFixed(1)}..${b.to.toFixed(1)}`)
    .join(", ");

const MODES: Array<{ id: string; rules: RunRules; biomes?: string[] }> = [
  { id: "normal", rules: defaultRules() },
  ...WEEKLY_CHALLENGES.map((c) => ({ id: c.id, rules: resolveRules(c.effects), biomes: c.biomes })),
];

describe("layout fairness", () => {
  it("every procedural road stays passable across modes and the full difficulty ramp", () => {
    tuning.reset();
    const failures: string[] = [];
    for (const mode of MODES) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const placed = layout(seed * 7919, mode.rules, mode.biomes);
        for (const scale of SPEED_SCALES) {
          const blocks = blocksFor(placed, mode.rules, scale);
          const dead = firstDeadEnd(blocks, mode.rules, scale);
          if (dead >= 0) failures.push(`${mode.id} x${scale} seed ${seed * 7919} at ${dead.toFixed(1)} m: ${describeAround(blocks, dead)}`);
        }
      }
    }
    expect(failures.length, failures.slice(0, 5).join(" | ")).toBe(0);
  });

  it("a seeded road is the same whatever the player has equipped", () => {
    tuning.reset();
    const daily = dailyMode(Date.UTC(2026, 8, 20, 12));
    const reference = layout(daily.seed, resolveRules(daily.effects), undefined, 1);
    expect(reference.length).toBeGreaterThan(200);
    for (const item of EQUIPMENT) {
      const withItem = resolveRules(daily.effects, item.effects);
      expect(layout(daily.seed, withItem, undefined, 1), item.id).toEqual(reference);
    }
  });

  it("the checker itself catches a wall", () => {
    const rules = defaultRules();
    const wall: Block[] = [-1, 0, 1].map((lane) => ({ type: "wagon", lane, from: 100, to: 113 }));
    expect(firstDeadEnd(wall, rules)).toBeGreaterThan(95);
    // two lanes closed with the open lane switching sides too quickly to cross
    const zigzag: Block[] = [
      { type: "wagon", lane: 0, from: 100, to: 113 },
      { type: "wagon", lane: 1, from: 100, to: 113 },
      { type: "wagon", lane: -1, from: 114, to: 127 },
      { type: "wagon", lane: 0, from: 114, to: 127 },
    ];
    expect(firstDeadEnd(zigzag, rules)).toBeGreaterThan(0);
    expect(firstDeadEnd([{ type: "wagon", lane: 0, from: 100, to: 100 + WAGON.carLength }], rules)).toBe(-1);
  });
});
