/**
 * World coordinate conventions (1 unit = 1 metre).
 *
 * SIM space (all gameplay, collisions, spawning):
 *   s  = distance along the track, increasing FORWARD (the run direction). Runner is at s = run.distance.
 *   x  = lateral, +x to the runner's RIGHT. Lanes are indexed -1 (left), 0 (centre), 1 (right).
 *   y  = up, 0 = top of the ground/ballast the runner stands on.
 *
 * RENDER space (three.js): the runner stays near the origin and the world scrolls past.
 *   renderX = x,  renderY = y,  renderZ = -(s - distance)   → forward is -Z, behind is +Z.
 *   Everything is placed relative to the (interpolated) distance every frame, so render
 *   coordinates stay small no matter how long the run is (no float precision drift).
 *
 * The curved-world bend (world/curve.ts) is a vertex-shader effect only; sim space is straight.
 */
import { defineTuning } from "../../core/tuning";

export const LANES = defineTuning("lanes", "Lanes", {
  spacing: { default: 2.5, min: 1.6, max: 4, step: 0.05, label: "Lane spacing", unit: "m" },
});

export const LANE_MIN = -1;
export const LANE_MAX = 1;
export const LANE_COUNT = 3;

export function laneX(lane: number): number {
  return lane * LANES.spacing;
}

export function clampLane(lane: number): number {
  return lane < LANE_MIN ? LANE_MIN : lane > LANE_MAX ? LANE_MAX : lane;
}

/** Sim distance → render Z relative to the camera-anchored runner distance. */
export function renderZ(s: number, distance: number): number {
  return -(s - distance);
}
