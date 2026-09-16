import { describe, expect, it } from "vitest";
import { Rng } from "../../src/core/rng";
import { defaultRules } from "../../src/game/rules";
import { tuning } from "../../src/core/tuning";
import { WAGON } from "../../src/game/obstacles/builtin";
import { SPAWN, Spawner } from "../../src/game/spawn/Spawner";
import { getScenario, listScenarios } from "../../src/game/spawn/scenarios";
import { listPatterns } from "../../src/game/spawn/patterns";
import type { RunContext, RunMode } from "../../src/game/types";

const DT = 1 / 120;

interface Placed {
  kind: "obstacle" | "coin";
  type?: string;
  lane: number;
  s: number;
  length?: number;
  y?: number;
}

function simulate(seed: number, seconds: number, scenarioId = "default", mode: RunMode = "running") {
  const log: Placed[] = [];
  const state = { mode, time: 0, distance: 0, prevDistance: 0, speed: 12 };
  const ctx = {
    rng: new Rng(seed),
    rules: defaultRules(),
    state,
    obstacles: {
      spawn: (type: string, lane: number, s: number, length?: number) => {
        log.push({ kind: "obstacle", type, lane, s, length: length ?? (type === "wagon" ? WAGON.carLength : 0.3) });
        return null;
      },
    },
    coins: { spawn: (lane: number, s: number, y: number) => (log.push({ kind: "coin", lane, s, y }), 0) },
  } as unknown as RunContext;
  const sp = new Spawner();
  sp.init(ctx);
  const opts = { scenario: getScenario(scenarioId)!, seed, skipIntro: true };
  sp.reset(ctx, opts);
  sp.afterReset(ctx, opts);
  const ticks = Math.round(seconds * 120);
  for (let i = 0; i < ticks; i++) {
    state.time += DT;
    state.speed = 12 + state.time * 0.05;
    state.prevDistance = state.distance;
    state.distance += state.speed * DT;
    sp.fixedUpdate(ctx);
  }
  return { log, state, spawner: sp };
}

describe("Spawner determinism", () => {
  it("produces an identical layout for the same seed", () => {
    const a = simulate(1234, 90);
    const b = simulate(1234, 90);
    expect(a.log.length).toBeGreaterThan(100);
    expect(a.log).toEqual(b.log);
  });

  it("produces different layouts for different seeds", () => {
    const a = simulate(1, 60);
    const b = simulate(2, 60);
    expect(a.log).not.toEqual(b.log);
  });

  it("uses a registered pattern set with tunable weights", () => {
    const ids = listPatterns().map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["barricadeSingle", "wagonSingle", "coinRun"]));
    tuning.set("spawnWeights.wagonSingle", 0);
    tuning.set("spawnWeights.wagonDouble", 0);
    tuning.set("spawnWeights.wagonRamp", 0);
    const noWagons = simulate(9, 60);
    expect(noWagons.log.some((p) => p.type === "wagon")).toBe(false);
    tuning.reset();
  });

  it("keeps the start of the track empty and generates ahead of the runner", () => {
    const { log, state } = simulate(77, 30);
    const firstObstacle = Math.min(...log.filter((p) => p.kind === "obstacle").map((p) => p.s));
    expect(firstObstacle).toBeGreaterThanOrEqual(SPAWN.safeStart - 1e-9);
    const furthest = Math.max(...log.map((p) => p.s));
    expect(furthest).toBeGreaterThan(state.distance + SPAWN.ahead * 0.8);
  });

  it("never blocks all three lanes with wagons at the same distance (always a path)", () => {
    for (const seed of [3, 11, 404, 2026]) {
      const { log } = simulate(seed, 180);
      const wagons = log.filter((p) => p.type === "wagon");
      const maxS = Math.max(...wagons.map((t) => t.s + (t.length ?? 0)));
      for (let s = 0; s < maxS; s += 0.5) {
        const blocked = new Set(wagons.filter((t) => s >= t.s && s <= t.s + (t.length ?? 0)).map((t) => t.lane));
        expect(blocked.size, `seed ${seed} s=${s}`).toBeLessThan(3);
      }
    }
  });

  it("does nothing on the idle/home track and places hand-authored scenario content", () => {
    expect(simulate(5, 10, "default", "idle").log).toEqual([]);
    const barrier = simulate(5, 5, "barrier-ahead");
    expect(barrier.log).toEqual([{ kind: "obstacle", type: "barricade", lane: 0, s: 36, length: 0.3 }]);
    expect(simulate(5, 20, "flat-straight").log).toEqual([]);
    expect(listScenarios().map((s) => s.id)).toEqual(expect.arrayContaining(["default", "flat-straight", "barrier-ahead", "wagon-ahead"]));
  });
});
