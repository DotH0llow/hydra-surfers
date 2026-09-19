import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../src/core/events";
import { tuning } from "../../src/core/tuning";
import { defaultRules } from "../../src/game/rules";
import "../../src/game/obstacles/builtin";
import { getObstacleType } from "../../src/game/obstacles/registry";
import type { ObstacleInstance } from "../../src/game/obstacles/ObstacleSystem";
import { CollisionSystem } from "../../src/game/collision/CollisionSystem";
import { PlayerController } from "../../src/game/player/PlayerController";
import type { RunContext } from "../../src/game/types";

const DT = 1 / 120;

function hole(s: number): ObstacleInstance {
  const type = getObstacleType("hole")!;
  return { uid: 1, type, active: true, retired: false, threatT: -1, reachT: -1, minLateral: Infinity, minVertical: Infinity, resolved: false, lane: 0, s, prevS: s, length: type.defaultLength(), speed: 0, variant: 0, view: null as never };
}

function harness(s: number) {
  const bus = new EventBus();
  const state = { mode: "running", speed: 16, distance: 0, prevDistance: 0, time: 0 };
  const crashes: string[] = [];
  const player = new PlayerController();
  const ctx = {
    bus,
    state,
    player,
    rules: defaultRules(),
    lastHit: null,
    obstacles: { active: [hole(s)] },
    crash: (cause: string) => crashes.push(cause),
    stumble: () => {},
  } as unknown as RunContext;
  player.init(ctx);
  player.reset(ctx);
  const collision = new CollisionSystem();
  const tick = () => {
    state.prevDistance = state.distance;
    state.distance += state.speed * DT;
    state.time += DT;
    player.fixedUpdate(ctx, DT);
    collision.fixedUpdate(ctx);
  };
  const runTo = (d: number) => {
    while (state.distance < d && crashes.length === 0) tick();
  };
  return { player, crashes, runTo, state };
}

describe("obstacle: hole in a broken bridge", () => {
  beforeEach(() => tuning.reset());

  it("swallows a runner who stays on the road", () => {
    const h = harness(30);
    h.runTo(40);
    expect(h.crashes).toEqual(["hole"]);
  });

  it("cannot be rolled under", () => {
    const h = harness(30);
    h.runTo(26);
    h.player.handleAction("roll");
    h.runTo(40);
    expect(h.crashes).toEqual(["hole"]);
  });

  it("is cleared by a jump", () => {
    const h = harness(30);
    h.runTo(25);
    h.player.handleAction("jump");
    h.runTo(45);
    expect(h.crashes).toEqual([]);
  });
});
