import { beforeEach, describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { EventBus } from "../../src/core/events";
import { tuning } from "../../src/core/tuning";
import { CAMERA, RunCamera } from "../../src/game/camera/RunCamera";
import { PLAYER, PlayerController } from "../../src/game/player/PlayerController";
import {
  SWITCH_FEEL,
  easeHermite,
  easeHermiteVel,
  switchHop,
  switchLean,
  switchLeanSeconds,
  switchTimeScale,
} from "../../src/game/player/switchMotion";
import { laneX } from "../../src/game/world/coords";
import type { ResolvedRunOptions, RunContext } from "../../src/game/types";

const DT = 1 / 120;

function harness() {
  const bus = new EventBus();
  const state = { mode: "running", speed: 12, distance: 0, prevDistance: 0, time: 0, introT: 1 };
  const p = new PlayerController();
  const cam = new RunCamera();
  const ctx = { bus, state, player: p, camera3: new PerspectiveCamera() } as unknown as RunContext;
  p.init(ctx);
  p.reset(ctx);
  cam.init(ctx);
  cam.reset(ctx, { skipIntro: true } as ResolvedRunOptions);
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      state.prevDistance = state.distance;
      state.distance += state.speed * DT;
      p.fixedUpdate(ctx, DT);
      cam.fixedUpdate(ctx, DT);
    }
  };
  return { p, cam, ctx, state, tick };
}

describe("switch feel curves", () => {
  beforeEach(() => tuning.reset());

  it("time scale is 1 up to the reference speed, shrinks above it and is clamped", () => {
    expect(switchTimeScale(0)).toBe(1);
    expect(switchTimeScale(SWITCH_FEEL.refSpeed)).toBe(1);
    const faster = switchTimeScale(SWITCH_FEEL.refSpeed * 1.33);
    expect(faster).toBeLessThan(0.85);
    expect(faster).toBeGreaterThan(0.7);
    expect(switchTimeScale(1000)).toBe(SWITCH_FEEL.minTimeScale);
    tuning.set("switchFeel.speedExponent", 0);
    expect(switchTimeScale(40)).toBe(1);
  });

  it("lean tilts into the move at once, holds, counter-tilts on landing and ends upright", () => {
    const F = SWITCH_FEEL;
    expect(switchLean(0, -1, 1, 0)).toBe(0);
    expect(switchLean(F.leanInSeconds, -1, 1, 0)).toBe(-1);
    expect(switchLean(F.leanInSeconds + F.leanHoldSeconds * 0.5, -1, 1, 0)).toBe(-1);
    const counterAt = F.leanInSeconds + F.leanHoldSeconds + F.counterSeconds;
    expect(switchLean(counterAt, -1, 1, 0)).toBeCloseTo(F.counterLean, 6);
    expect(switchLean(switchLeanSeconds(), -1, 1, 0)).toBe(0);
    expect(switchLean(5, 1, 1, 0.3)).toBe(0);
    // continuous everywhere (no pose pops), including a retarget that starts from a non-zero lean
    for (const from of [0, 0.8, -0.5]) {
      let prev = switchLean(0, 1, 1, from);
      expect(prev).toBeCloseTo(from, 9);
      for (let t = 0.001; t < switchLeanSeconds() + 0.05; t += 0.001) {
        const v = switchLean(t, 1, 1, from);
        expect(Math.abs(v - prev)).toBeLessThan(0.06);
        prev = v;
      }
    }
  });

  it("hop rises from the onset, peaks mid-way, lands at the end and blends a hop in progress", () => {
    const T = SWITCH_FEEL.hopSeconds;
    expect(switchHop(0, 0)).toBe(0);
    expect(switchHop(T / 2, 0)).toBeCloseTo(1, 6);
    expect(switchHop(T, 0)).toBe(0);
    expect(switchHop(0, 0.7)).toBeCloseTo(0.7, 9);
    expect(switchHop(T * 0.99, 0.7)).toBeLessThan(0.1);
  });

  it("hermite ease is smoothstep from rest, C1 and never overshoots when chaining the same way", () => {
    expect(easeHermite(0, 0, 1, 0.5)).toBeCloseTo(0.5, 9);
    expect(easeHermite(0, 0, 1, 0.25)).toBeCloseTo(0.15625, 9);
    expect(easeHermite(2, 5, 7, 1)).toBe(7);
    expect(easeHermiteVel(0, 3, 1, 0)).toBe(3);
    expect(easeHermiteVel(0, 3, 1, 1)).toBe(0);
    // numeric derivative matches
    const h = 1e-6;
    expect((easeHermite(0, 1.2, 2, 0.4 + h) - easeHermite(0, 1.2, 2, 0.4 - h)) / (2 * h)).toBeCloseTo(easeHermiteVel(0, 1.2, 2, 0.4), 4);
    // smoothstep peak velocity is 1.5·Δ: restarting toward a further lane at that velocity stays ≤ target
    for (let s = 0; s <= 1; s += 0.01) expect(easeHermite(0.5, 1.5 * 2.5, 2.5, s)).toBeLessThanOrEqual(2.5 + 1e-9);
  });
});

describe("switch feel in the controller and camera", () => {
  beforeEach(() => tuning.reset());

  it("the body is on the new lane within the tuned switch time and the lean/hop start on the onset tick", () => {
    const { p, tick } = harness();
    p.handleAction("left");
    tick(1);
    expect(p.leanAt()).toBeLessThan(0);
    expect(p.hopAt()).toBeGreaterThan(0);
    tick(Math.ceil(PLAYER.laneSwitchSeconds / DT));
    expect(p.x).toBe(laneX(-1));
    // counter-tilt (toward +x) after landing, upright later
    tick(Math.round((SWITCH_FEEL.leanInSeconds + SWITCH_FEEL.leanHoldSeconds + SWITCH_FEEL.counterSeconds) / DT) - Math.ceil(PLAYER.laneSwitchSeconds / DT) - 1);
    expect(p.leanAt()).toBeGreaterThan(0.3);
    tick(Math.ceil(switchLeanSeconds() / DT));
    expect(p.leanAt()).toBe(0);
    expect(p.hopAt()).toBe(0);
  });

  it("a second switch mid-lean continues from the current pose (no snap)", () => {
    const { p, tick } = harness();
    p.handleAction("right");
    tick(Math.round(0.25 / DT));
    const before = p.leanAt();
    const hopBefore = p.hopAt();
    p.handleAction("left");
    expect(p.leanAt()).toBeCloseTo(before, 9);
    expect(p.hopAt()).toBeCloseTo(hopBefore, 9);
  });

  it("bounce-back returns over bounceSwitchSeconds with a lean toward the starting lane", () => {
    const { p, tick } = harness();
    p.handleAction("left");
    tick(3);
    expect(p.stumble("train", true)).toBe(true);
    expect(p.lane).toBe(0);
    tick(Math.round(SWITCH_FEEL.leanInSeconds / DT) + 1);
    expect(p.leanAt()).toBeGreaterThan(0);
    expect(p.leanAt()).toBeLessThanOrEqual(SWITCH_FEEL.bounceLean + 1e-9);
    tick(Math.ceil(PLAYER.bounceSwitchSeconds / DT));
    expect(p.x).toBe(laneX(0));
  });

  it("feel timings run faster at higher speed", () => {
    const slow = harness();
    const fast = harness();
    fast.state.speed = SWITCH_FEEL.refSpeed * 1.5;
    slow.p.handleAction("left");
    fast.p.handleAction("left");
    slow.tick(24);
    fast.tick(24);
    expect(fast.p.leanT).toBeGreaterThan(slow.p.leanT * 1.2);
  });

  it("camera eases laterally to the new lane in laneFollowSeconds: S-curve, monotonic, no overshoot", () => {
    const { p, cam, tick } = harness();
    const target = laneX(1) * CAMERA.followX;
    p.handleAction("right");
    const ticks = Math.round(CAMERA.laneFollowSeconds / DT);
    const xs: number[] = [];
    for (let i = 0; i < ticks; i++) {
      tick(1);
      xs.push(cam.x);
    }
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
    expect(xs[Math.round(ticks * 0.1)]).toBeLessThan(target * 0.1); // slow start (lags the body)
    expect(xs[Math.round(ticks / 2) - 1]).toBeGreaterThan(target * 0.4);
    expect(xs[Math.round(ticks / 2) - 1]).toBeLessThan(target * 0.6);
    expect(xs[xs.length - 1]).toBeCloseTo(target, 6);
    tick(60);
    expect(cam.x).toBeCloseTo(target, 9);
  });

  it("camera retargets mid-ease without a jump (rapid double switch and reversal)", () => {
    const { p, cam, tick } = harness();
    p.handleAction("right");
    tick(12);
    const x0 = cam.x;
    tick(1);
    const stepBefore = cam.x - x0;
    p.handleAction("left");
    p.handleAction("left");
    const x1 = cam.x;
    tick(1);
    const stepAfter = cam.x - x1;
    // velocity carries through the retarget (C1): the first step after differs only by the new pull
    expect(stepBefore).toBeGreaterThan(0);
    expect(Math.abs(stepAfter - stepBefore)).toBeLessThan(0.02);
    const limit = ((1.5 * (laneX(1) - laneX(-1))) / CAMERA.laneFollowSeconds) * CAMERA.followX * DT * 1.2;
    let prev = cam.x;
    for (let i = 0; i < 120; i++) {
      tick(1);
      expect(Math.abs(cam.x - prev)).toBeLessThan(limit);
      prev = cam.x;
    }
    expect(cam.x).toBeCloseTo(laneX(-1) * CAMERA.followX, 6);
  });
});
