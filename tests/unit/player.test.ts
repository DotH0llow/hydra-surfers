import { beforeEach, describe, expect, it } from "vitest";
import { EventBus, type EventMap } from "../../src/core/events";
import { tuning } from "../../src/core/tuning";
import { PLAYER, PLAYER_HITBOX, PlayerController } from "../../src/game/player/PlayerController";
import { LANES, laneX } from "../../src/game/world/coords";
import type { Action } from "../../src/input/actions";
import type { Aabb, RunContext, RunMode } from "../../src/game/types";
import { makeAabb } from "../../src/game/types";

const DT = 1 / 120;

function makeHarness(mode: RunMode = "running") {
  const bus = new EventBus();
  const events: Array<{ name: string; payload: unknown }> = [];
  const names: Array<keyof EventMap> = [
    "player:laneChange",
    "player:edgeBump",
    "player:jump",
    "player:land",
    "player:roll",
    "player:rollEnd",
    "player:fastFall",
    "player:crash",
    "player:stumble",
  ];
  for (const n of names) bus.on(n, (p) => events.push({ name: n, payload: { ...(p as object) } }));
  const state = { mode, speed: 12, distance: 0, prevDistance: 0, time: 0 };
  const ctx = { bus, state } as unknown as RunContext;
  const p = new PlayerController();
  p.init(ctx);
  p.reset(ctx);
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      state.prevDistance = state.distance;
      state.distance += state.speed * DT;
      state.time += DT;
      p.fixedUpdate(ctx, DT);
    }
  };
  const seconds = (s: number) => tick(Math.round(s * 120));
  const act = (a: Action) => p.handleAction(a);
  const count = (name: string) => events.filter((e) => e.name === name).length;
  const last = (name: string) => [...events].reverse().find((e) => e.name === name)?.payload as Record<string, unknown> | undefined;
  return { p, ctx, state, tick, seconds, act, events, count, last };
}

describe("PlayerController state machine", () => {
  beforeEach(() => tuning.reset());

  it("starts running in the centre lane (idle on the home screen)", () => {
    const h = makeHarness();
    expect(h.p.state).toBe("run");
    expect(h.p.lane).toBe(0);
    expect(h.p.grounded).toBe(true);
    expect(makeHarness("idle").p.state).toBe("idle");
  });

  it("ignores actions when not running or intro", () => {
    const h = makeHarness("idle");
    h.act("left");
    h.act("jump");
    expect(h.p.lane).toBe(0);
    expect(h.p.grounded).toBe(true);
    const intro = makeHarness("intro");
    intro.act("left");
    expect(intro.p.lane).toBe(-1);
  });

  it("switches lanes immediately with eased motion that settles exactly on the lane", () => {
    const h = makeHarness();
    h.act("left");
    expect(h.p.lane).toBe(-1);
    expect(h.last("player:laneChange")).toEqual({ from: 0, to: -1, dir: -1 });
    h.tick(1);
    // motion starts on the very first tick after the input
    expect(h.p.x).toBeLessThan(0);
    const xs: number[] = [h.p.x];
    const ticks = Math.ceil(PLAYER.laneSwitchSeconds / DT);
    for (let i = 1; i < ticks; i++) {
      h.tick(1);
      xs.push(h.p.x);
    }
    // monotonic, ease-out (first step bigger than last)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1]);
    expect(Math.abs(xs[0] - 0)).toBeGreaterThan(Math.abs(xs[xs.length - 1] - xs[xs.length - 2]));
    h.tick(2);
    expect(h.p.x).toBe(laneX(-1));
    expect(h.p.switchT).toBe(1);
  });

  it("bumps the edge instead of leaving the track", () => {
    const h = makeHarness();
    h.act("right");
    h.seconds(0.5);
    h.act("right");
    expect(h.p.lane).toBe(1);
    expect(h.count("player:edgeBump")).toBe(1);
    expect(h.last("player:edgeBump")).toEqual({ dir: 1 });
  });

  it("reverses mid-switch from the current position without teleporting", () => {
    const h = makeHarness();
    h.act("left");
    h.tick(6);
    const mid = h.p.x;
    expect(mid).toBeLessThan(0);
    expect(mid).toBeGreaterThan(laneX(-1));
    h.act("right");
    expect(h.p.lane).toBe(0);
    h.tick(1);
    // one 120 Hz tick of the fastest (ease-out) part of the move: a small step, never a jump
    expect(Math.abs(h.p.x - mid)).toBeLessThan(0.2 * LANES.spacing);
    h.seconds(0.5);
    expect(h.p.x).toBe(laneX(0));
  });

  it("chains rapid double switches (left, left)", () => {
    const h = makeHarness();
    h.act("right");
    h.tick(3);
    h.act("left");
    h.tick(3);
    h.act("left");
    expect(h.p.lane).toBe(-1);
    h.seconds(0.5);
    expect(h.p.x).toBe(laneX(-1));
  });

  it("jumps to the tuned apex and lands after the tuned airtime", () => {
    const h = makeHarness();
    h.act("jump");
    expect(h.p.state).toBe("jump");
    expect(h.p.grounded).toBe(false);
    let maxY = 0;
    let ticks = 0;
    while (!h.p.grounded && ticks < 1000) {
      h.tick(1);
      ticks++;
      maxY = Math.max(maxY, h.p.y);
    }
    expect(maxY).toBeCloseTo(PLAYER.jumpHeight, 2);
    expect(Math.abs(ticks - PLAYER.jumpSeconds * 120)).toBeLessThanOrEqual(1);
    expect(h.p.state).toBe("run");
    expect(h.p.y).toBe(0);
    expect(h.last("player:land")).toMatchObject({ fastFall: false });
  });

  it("jump apex follows tuning live", () => {
    const h = makeHarness();
    tuning.set("player.jumpHeight", 2.5);
    h.act("jump");
    let maxY = 0;
    for (let i = 0; i < 200; i++) {
      h.tick(1);
      maxY = Math.max(maxY, h.p.y);
    }
    expect(maxY).toBeCloseTo(2.5, 2);
  });

  it("buffers a jump pressed shortly before landing, but not one pressed too early", () => {
    const h = makeHarness();
    h.act("jump");
    h.seconds(PLAYER.jumpSeconds - 0.1);
    h.act("jump");
    expect(h.count("player:jump")).toBe(1);
    h.seconds(0.15);
    expect(h.count("player:jump")).toBe(2);
    expect(h.last("player:jump")).toEqual({ buffered: true, fromRoll: false });
    expect(h.p.grounded).toBe(false);

    const e = makeHarness();
    e.act("jump");
    e.seconds(0.1);
    e.act("jump"); // buffer (0.2 s) expires long before landing
    e.seconds(1);
    expect(e.count("player:jump")).toBe(1);
    expect(e.p.grounded).toBe(true);
  });

  it("rolls for the tuned duration with the low hitbox", () => {
    const h = makeHarness();
    h.act("roll");
    expect(h.p.state).toBe("roll");
    expect(h.p.rolling).toBe(true);
    const box: Aabb = makeAabb();
    h.p.getHitbox(box);
    expect(box.maxY - box.minY).toBeCloseTo(PLAYER_HITBOX.rollHeight);
    h.seconds(PLAYER.rollSeconds - 0.02);
    expect(h.p.rolling).toBe(true);
    h.seconds(0.04);
    expect(h.p.rolling).toBe(false);
    expect(h.p.state).toBe("run");
    expect(h.last("player:rollEnd")).toEqual({ cancelled: false });
    h.p.getHitbox(box);
    expect(box.maxY - box.minY).toBeCloseTo(PLAYER_HITBOX.height);
  });

  it("cancels a roll into a jump", () => {
    const h = makeHarness();
    h.act("roll");
    h.seconds(0.1);
    h.act("jump");
    expect(h.p.rolling).toBe(false);
    expect(h.p.state).toBe("jump");
    expect(h.last("player:rollEnd")).toEqual({ cancelled: true });
    expect(h.last("player:jump")).toEqual({ buffered: false, fromRoll: true });
  });

  it("roll while airborne fast-falls and lands into a roll", () => {
    const h = makeHarness();
    h.act("jump");
    h.seconds(0.2);
    h.act("roll");
    expect(h.p.fastFalling).toBe(true);
    expect(h.p.vy).toBeLessThanOrEqual(-PLAYER.fastFallSpeed);
    let ticks = 0;
    while (!h.p.grounded && ticks < 500) {
      h.tick(1);
      ticks++;
    }
    expect(ticks).toBeLessThan((PLAYER.jumpSeconds - 0.2) * 120); // faster than a normal fall
    expect(h.last("player:land")).toMatchObject({ fastFall: true });
    expect(h.p.rolling).toBe(true);
    expect(h.last("player:roll")).toEqual({ fromAir: true });
  });

  it("changes lanes while airborne and while rolling", () => {
    const h = makeHarness();
    h.act("jump");
    h.tick(10);
    h.act("left");
    h.seconds(0.3);
    expect(h.p.x).toBe(laneX(-1));
    expect(h.p.grounded).toBe(false);
    h.seconds(1);
    h.act("roll");
    h.act("right");
    h.seconds(0.3);
    expect(h.p.rolling).toBe(true);
    expect(h.p.x).toBe(laneX(0));
  });

  it("crash freezes the controller and ignores further input", () => {
    const h = makeHarness();
    h.act("jump");
    h.tick(5);
    h.p.crash("barrierLow");
    expect(h.p.state).toBe("crash");
    expect(h.last("player:crash")).toEqual({ cause: "barrierLow" });
    h.act("left");
    expect(h.p.lane).toBe(0);
    h.seconds(2);
    expect(h.p.grounded).toBe(true); // still falls to the ground
    expect(h.p.state).toBe("crash");
  });

  it("stumble bounces back to the previous lane and honours the grace window", () => {
    const h = makeHarness();
    h.act("left");
    h.tick(4);
    expect(h.p.stumble("train", true)).toBe(true);
    expect(h.p.lane).toBe(0);
    expect(h.last("player:stumble")).toEqual({ cause: "train", bounce: true });
    expect(h.p.stumble("train", true)).toBe(false);
    h.seconds(PLAYER.stumbleGraceSeconds + 0.02);
    expect(h.p.x).toBe(laneX(0));
    expect(h.p.stumble("wall", false)).toBe(true);
    expect(h.p.lane).toBe(0);
  });

  it("is deterministic for the same input timeline", () => {
    const timeline: Array<[number, Action]> = [
      [5, "left"],
      [20, "jump"],
      [40, "right"],
      [41, "right"],
      [70, "roll"],
      [95, "jump"],
      [130, "roll"],
    ];
    const runOnce = () => {
      const h = makeHarness();
      const trace: number[] = [];
      for (let t = 0; t < 240; t++) {
        for (const [f, a] of timeline) if (f === t) h.act(a);
        h.tick(1);
        trace.push(h.p.x, h.p.y, h.p.vy, h.p.rolling ? 1 : 0);
      }
      return trace;
    };
    expect(runOnce()).toEqual(runOnce());
  });
});
