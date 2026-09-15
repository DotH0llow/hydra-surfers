import { describe, expect, it } from "vitest";
import { RAMP, TRAIN } from "../../src/game/obstacles/builtin";
import type { ObstacleInstance } from "../../src/game/obstacles/ObstacleSystem";
import { getObstacleType } from "../../src/game/obstacles/registry";
import { supportHeight } from "../../src/game/obstacles/SurfaceSystem";

const inst = (typeId: string, lane: number, s: number, length: number): ObstacleInstance => ({
  uid: 1,
  type: getObstacleType(typeId)!,
  active: true,
  lane,
  s,
  prevS: s,
  length,
  speed: 0,
  variant: 0,
  view: null as never,
});

describe("walkable surfaces (ramps and train roofs)", () => {
  const ramp = inst("ramp", 0, 30, RAMP.length);
  const train = inst("train", 0, 30 + RAMP.length, TRAIN.carLength);
  const list = [ramp, train];

  it("is the ballast away from any surface", () => {
    expect(supportHeight(list, 0, 10, 10.5, 0)).toBe(0);
    expect(supportHeight(list, 2.5, 33, 33.5, 0)).toBe(0); // next lane
  });

  it("climbs a ramp from the ground and reaches roof height at its far end", () => {
    expect(supportHeight(list, 0, 32.75 - 0.5, 30 + RAMP.length / 2, 0)).toBeCloseTo(TRAIN.height / 2, 5);
    expect(supportHeight(list, 0, 36, 30 + RAMP.length, 3.4)).toBeCloseTo(TRAIN.height, 5);
  });

  it("walks along the roof, but a train side seen from the ground is a wall, not a step", () => {
    expect(supportHeight(list, 0, 40, 40.5, TRAIN.height)).toBe(TRAIN.height);
    expect(supportHeight([train], 0, 40, 40.5, 0)).toBe(0);
  });
});
