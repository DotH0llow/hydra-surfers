import { describe, expect, it } from "vitest";
import { RAMP, WAGON } from "../../src/game/obstacles/builtin";
import type { ObstacleInstance } from "../../src/game/obstacles/ObstacleSystem";
import { getObstacleType } from "../../src/game/obstacles/registry";
import { supportHeight } from "../../src/game/obstacles/SurfaceSystem";

const inst = (typeId: string, lane: number, s: number, length: number): ObstacleInstance => ({
  uid: 1,
  type: getObstacleType(typeId)!,
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
  length,
  speed: 0,
  variant: 0,
  view: null as never,
});

describe("walkable surfaces (ramps and wagon roofs)", () => {
  const ramp = inst("ramp", 0, 30, RAMP.length);
  const wagon = inst("wagon", 0, 30 + RAMP.length, WAGON.carLength);
  const list = [ramp, wagon];

  it("is the ballast away from any surface", () => {
    expect(supportHeight(list, 0, 10, 10.5, 0)).toBe(0);
    expect(supportHeight(list, 2.5, 33, 33.5, 0)).toBe(0); // next lane
  });

  it("climbs a ramp from the ground and reaches roof height at its far end", () => {
    expect(supportHeight(list, 0, 32.75 - 0.5, 30 + RAMP.length / 2, 0)).toBeCloseTo(WAGON.height / 2, 5);
    expect(supportHeight(list, 0, 36, 30 + RAMP.length, 3.4)).toBeCloseTo(WAGON.height, 5);
  });

  it("walks along the roof, but a wagon side seen from the ground is a wall, not a step", () => {
    expect(supportHeight(list, 0, 40, 40.5, WAGON.height)).toBe(WAGON.height);
    expect(supportHeight([wagon], 0, 40, 40.5, 0)).toBe(0);
  });
});
