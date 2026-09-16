import { beforeEach, describe, expect, it } from "vitest";
import { tuning } from "../../src/core/tuning";
import { SPEED, difficultyAt, distanceAtTime, speedAt, timeAtDistance } from "../../src/game/spawn/difficulty";

describe("speed curve: distance <-> time", () => {
  beforeEach(() => tuning.reset());

  it("is zero at the start and integrates the flat section exactly", () => {
    expect(distanceAtTime(0)).toBe(0);
    expect(distanceAtTime(-5)).toBe(0);
    // the run holds the start speed for flatSeconds
    expect(distanceAtTime(SPEED.flatSeconds)).toBeCloseTo(SPEED.start * SPEED.flatSeconds, 6);
    expect(distanceAtTime(10)).toBeCloseTo(SPEED.start * 10, 6);
  });

  it("matches a numerically integrated speed curve across all three sections", () => {
    const integrate = (t: number, step = 0.001) => {
      let d = 0;
      for (let x = 0; x + step <= t; x += step) d += (speedAt(x) + speedAt(x + step)) * 0.5 * step;
      return d;
    };
    for (const t of [5, 28, 60, 150, 225, 400]) {
      expect(distanceAtTime(t), `t=${t}`).toBeCloseTo(integrate(t), 1);
    }
  });

  it("timeAtDistance inverts distanceAtTime across the flat, ramp and top-speed sections", () => {
    for (const t of [0, 3, 27.9, 28, 28.1, 90, 180, 224.9, 225, 300, 1000]) {
      expect(timeAtDistance(distanceAtTime(t)), `t=${t}`).toBeCloseTo(t, 4);
    }
  });

  it("is monotonic in both directions", () => {
    let prevD = -1;
    let prevT = -1;
    for (let t = 0; t < 600; t += 3) {
      const d = distanceAtTime(t);
      expect(d).toBeGreaterThan(prevD);
      prevD = d;
    }
    for (let d = 0; d < 20000; d += 137) {
      const t = timeAtDistance(d);
      expect(t).toBeGreaterThan(prevT);
      prevT = t;
    }
  });

  it("tops out at the max speed after the ramp", () => {
    const a = distanceAtTime(SPEED.rampSeconds + 10);
    const b = distanceAtTime(SPEED.rampSeconds);
    expect(a - b).toBeCloseTo(SPEED.max * 10, 6);
    expect(speedAt(SPEED.rampSeconds + 100)).toBe(SPEED.max);
  });

  it("follows live tuning, including a non-linear ramp exponent", () => {
    tuning.set("speed.rampExponent", 2);
    for (const t of [40, 120, 220]) expect(timeAtDistance(distanceAtTime(t)), `t=${t}`).toBeCloseTo(t, 3);
    tuning.set("speed.start", 20);
    tuning.set("speed.max", 20);
    expect(distanceAtTime(10)).toBeCloseTo(200, 6);
    expect(timeAtDistance(200)).toBeCloseTo(10, 6);
  });

  it("difficulty ramps from 0 to 1 and then holds", () => {
    expect(difficultyAt(0)).toBe(0);
    expect(difficultyAt(-10)).toBe(0);
    expect(difficultyAt(10_000)).toBe(1);
    expect(difficultyAt(90)).toBeGreaterThan(0);
    expect(difficultyAt(90)).toBeLessThan(1);
  });
});
