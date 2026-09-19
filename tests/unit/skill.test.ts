import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../src/core/events";
import { tuning } from "../../src/core/tuning";
import { defaultRules } from "../../src/game/rules";
import "../../src/game/obstacles/builtin";
import { getObstacleType } from "../../src/game/obstacles/registry";
import type { ObstacleInstance } from "../../src/game/obstacles/ObstacleSystem";
import { PlayerController } from "../../src/game/player/PlayerController";
import { SKILL, SkillSystem } from "../../src/game/skill/SkillSystem";
import type { RunContext } from "../../src/game/types";

const DT = 1 / 120;

function obstacle(typeId: string, lane: number, s: number): ObstacleInstance {
  const type = getObstacleType(typeId)!;
  return {
    uid: 1,
    type,
    active: true,
    retired: false,
    threatT: -1,
    reachT: -1,
    minLateral: Infinity,
    minVertical: Infinity,
    resolved: false,
    lane,
    s,
    prevS: s,
    length: type.defaultLength(),
    speed: 0,
    variant: 0,
    view: null as never,
  };
}

function harness(obstacles: ObstacleInstance[]) {
  const bus = new EventBus();
  const state = { mode: "running", speed: 12, distance: 0, prevDistance: 0, time: 0 };
  const player = new PlayerController();
  const ctx = { bus, state, player, rules: defaultRules(), obstacles: { active: obstacles } } as unknown as RunContext;
  player.init(ctx);
  player.reset(ctx);
  const skill = new SkillSystem();
  skill.init(ctx);
  skill.reset(ctx);
  const events: string[] = [];
  bus.on("skill:nearMiss", () => events.push("near"));
  bus.on("skill:perfect", () => events.push("perfect"));
  const tick = () => {
    state.prevDistance = state.distance;
    state.distance += state.speed * DT;
    state.time += DT;
    player.fixedUpdate(ctx, DT);
    skill.fixedUpdate(ctx, DT);
  };
  /** Advance until the runner's front is `seconds` of travel away from `s`. */
  const until = (s: number, seconds: number) => {
    while (s - state.distance > state.speed * seconds) tick();
  };
  const runPast = (s: number) => {
    while (state.distance < s + 3) tick();
  };
  return { ctx, player, skill, events, tick, until, runPast, state };
}

describe("game/skill", () => {
  beforeEach(() => tuning.reset());

  it("a late jump over a barricade in the lane is a dodge and a perfect dodge", () => {
    const b = obstacle("barricade", 0, 30);
    const h = harness([b]);
    h.until(30, 0.22);
    h.player.handleAction("jump");
    h.runPast(30);
    expect(h.skill.dodges).toBe(1);
    expect(h.skill.perfectDodges).toBe(1);
    expect(h.events).toContain("perfect");
    expect(h.skill.combo).toBeGreaterThanOrEqual(2);
  });

  it("an early jump still counts as a dodge, but not as perfect", () => {
    const b = obstacle("barricade", 0, 30);
    const h = harness([b]);
    // jump so early the runner is already coming down: the jump clears nothing in time...
    h.until(30, 0.85);
    h.player.handleAction("jump");
    // ...so dodge sideways at the last moment instead, well before the window
    h.until(30, 0.6);
    h.player.handleAction("right");
    h.runPast(30);
    expect(h.skill.dodges).toBe(1);
    expect(h.skill.perfectDodges).toBe(0);
  });

  it("obstacles outside the runner's lane are not threats", () => {
    const h = harness([obstacle("barricade", 1, 30), obstacle("wagon", -1, 20)]);
    h.runPast(40);
    expect(h.skill.dodges).toBe(0);
    expect(h.skill.nearMisses).toBe(0);
  });

  it("the combo decays after the window with no action and breaks on a stumble", () => {
    const b = obstacle("barricade", 0, 30);
    const h = harness([b]);
    h.until(30, 0.22);
    h.player.handleAction("jump");
    h.runPast(30);
    expect(h.skill.combo).toBeGreaterThan(0);
    const best = h.skill.bestCombo;
    for (let i = 0; i < Math.ceil((SKILL.comboWindow + 0.1) / DT); i++) h.tick();
    expect(h.skill.combo).toBe(0);
    expect(h.skill.bestCombo).toBe(best);
  });

  it("tracks the longest clean stretch and restarts it on contact", () => {
    const h = harness([]);
    h.runPast(100);
    expect(h.skill.bestClean).toBeGreaterThan(100);
    h.ctx.bus.emit("player:stumble", { cause: "wagon", bounce: true });
    const before = h.skill.bestClean;
    h.runPast(130);
    // the new stretch (~30 m) is shorter than the first, so the best is unchanged
    expect(h.skill.bestClean).toBe(before);
  });
});
