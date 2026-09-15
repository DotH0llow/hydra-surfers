/**
 * Built-in obstacle kit (sizes in metres; the runner is 1.7 m tall, lanes 2.5 m apart):
 *  - barrierLow     low striped barrier: jump over it (or roll under it)
 *  - barrierHigh    tall chevron board on posts with an open gap below: roll only
 *  - train          parked freight car: dodge, or run along its roof
 *  - trainOncoming  commuter car driving toward the runner (lit headlights): dodge, never ride in front
 *  - ramp           wooden ramp onto the near end of a train: run up to the roofs
 *  - tunnel         structure spanning all lanes (scenery, no collider)
 *  - signal         light signal on a post between lanes (scenery, red/green lamp)
 */
import type { Object3D } from "three";
import { defineTuning } from "../../core/tuning";
import { LANES, laneX } from "../world/coords";
import { registerRunSystem } from "../systems";
import type { Aabb } from "../types";
import type { ObstacleInstance } from "./ObstacleSystem";
import { noCollider, registerObstacleType } from "./registry";
import { SurfaceSystem } from "./SurfaceSystem";
import "./placeholders";

export const BARRIER_LOW = defineTuning("obsBarrierLow", "Obstacle: low barrier", {
  width: { default: 2.1, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  bottom: { default: 0.55, min: 0, max: 2, step: 0.01, label: "Collider bottom (roll clearance)", unit: "m" },
  height: { default: 0.5, min: 0.1, max: 3, step: 0.01, label: "Collider height", unit: "m" },
  length: { default: 0.3, min: 0.05, max: 3, step: 0.01, label: "Collider depth", unit: "m" },
});

export const BARRIER_HIGH = defineTuning("obsBarrierHigh", "Obstacle: high barrier (roll only)", {
  width: { default: 2.1, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  bottom: { default: 0.8, min: 0, max: 2, step: 0.01, label: "Collider bottom (roll clearance)", unit: "m" },
  top: { default: 3.3, min: 1, max: 6, step: 0.05, label: "Collider top", unit: "m" },
  length: { default: 0.3, min: 0.05, max: 3, step: 0.01, label: "Collider depth", unit: "m" },
});

export const TRAIN = defineTuning("obsTrain", "Obstacle: train", {
  width: { default: 2.2, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  height: { default: 3.6, min: 1, max: 6, step: 0.05, label: "Collider height (= roof walking height)", unit: "m" },
  carLength: { default: 13, min: 4, max: 30, step: 0.5, label: "Car length", unit: "m" },
  carGap: { default: 0.8, min: 0, max: 5, step: 0.05, label: "Gap between cars", unit: "m" },
});

export const ONCOMING = defineTuning("obsOncoming", "Obstacle: oncoming train", {
  speed: { default: 9, min: 0, max: 30, step: 0.5, label: "Speed toward the runner", unit: "m/s" },
  spawnAhead: { default: 120, min: 20, max: 400, step: 5, label: "Starts moving this far ahead of the runner", unit: "m" },
  maxCars: { default: 3, min: 1, max: 6, step: 1, label: "Max cars" },
});

export const RAMP = defineTuning("obsRamp", "Obstacle: ramp", {
  length: { default: 6.5, min: 2, max: 20, step: 0.1, label: "Ramp length (ground to roof)", unit: "m" },
});

export const TUNNEL = defineTuning("obsTunnel", "Structure: tunnel", {
  length: { default: 30, min: 4, max: 200, step: 1, label: "Default tunnel length", unit: "m" },
});

export const SIGNAL = defineTuning("obsSignal", "Structure: light signal", {
  edgeOffset: { default: 0.55, min: 0, max: 3, step: 0.05, label: "Outer-edge signal offset beyond the outer lane half-spacing", unit: "m" },
});

/** Model lengths baked into the placeholder/asset specs (views scale along Z by length / modelLength). */
export const MODEL_LENGTH = { train: 13, ramp: 6.5, tunnel: 30 } as const;

/** signal `variant` bits */
export const SIGNAL_RED = 1;
export const SIGNAL_OUTER = 2;

registerRunSystem(() => new SurfaceSystem());

const laneBox = (inst: ObstacleInstance, out: Aabb, halfWidth: number, minY: number, maxY: number): void => {
  const x = laneX(inst.lane);
  out.minX = x - halfWidth;
  out.maxX = x + halfWidth;
  out.minY = minY;
  out.maxY = maxY;
  out.minS = inst.s;
  out.maxS = inst.s + inst.length;
};

registerObstacleType({
  id: "barrierLow",
  label: "Low barrier",
  assetId: "obstacle.barrier.low",
  rules: { jumpable: true, rollable: true, solid: false },
  poolSize: 16,
  modelLength: 0,
  defaultLength: () => BARRIER_LOW.length,
  collider(inst, out) {
    laneBox(inst, out, BARRIER_LOW.width / 2, BARRIER_LOW.bottom, BARRIER_LOW.bottom + BARRIER_LOW.height);
  },
});

registerObstacleType({
  id: "barrierHigh",
  label: "High barrier",
  assetId: "obstacle.barrier.high",
  rules: { jumpable: false, rollable: true, solid: false },
  poolSize: 12,
  modelLength: 0,
  defaultLength: () => BARRIER_HIGH.length,
  collider(inst, out) {
    laneBox(inst, out, BARRIER_HIGH.width / 2, BARRIER_HIGH.bottom, BARRIER_HIGH.top);
  },
});

const trainCollider = (inst: ObstacleInstance, out: Aabb): void => laneBox(inst, out, TRAIN.width / 2, 0, TRAIN.height);
const roof = (): number => TRAIN.height;

registerObstacleType({
  id: "train",
  label: "Parked train car",
  assetId: "obstacle.train.car",
  rules: { jumpable: false, rollable: false, solid: true },
  poolSize: 24,
  modelLength: MODEL_LENGTH.train,
  defaultLength: () => TRAIN.carLength,
  collider: trainCollider,
  surface: roof,
});

registerObstacleType({
  id: "trainOncoming",
  label: "Oncoming train car",
  assetId: "obstacle.train.oncoming",
  rules: { jumpable: false, rollable: false, solid: true },
  poolSize: 9,
  modelLength: MODEL_LENGTH.train,
  defaultLength: () => TRAIN.carLength,
  collider: trainCollider,
  surface: roof,
  moveWithin: () => ONCOMING.spawnAhead,
  renderView(inst, view) {
    // Only the leading car shows its cab/headlights; trailing cars face away (variant 1).
    const beam = view.userData.beam as Object3D | undefined ?? (view.userData.beam = view.getObjectByName("cabFront") ?? null);
    if (beam) beam.visible = inst.variant === 0;
  },
});

/** Ramp height at track position s (0 at the near end, roof height at the far end). */
export function rampHeight(inst: ObstacleInstance, s: number): number {
  const u = (s - inst.s) / (inst.length > 0 ? inst.length : 1);
  return TRAIN.height * (u < 0 ? 0 : u > 1 ? 1 : u);
}

registerObstacleType({
  id: "ramp",
  label: "Ramp onto a train",
  assetId: "obstacle.train.ramp",
  rules: { jumpable: false, rollable: false, solid: false },
  poolSize: 8,
  modelLength: MODEL_LENGTH.ramp,
  defaultLength: () => RAMP.length,
  collider: noCollider,
  surface: rampHeight,
  snapSurface: true,
});

registerObstacleType({
  id: "tunnel",
  label: "Tunnel",
  assetId: "struct.tunnel",
  rules: { jumpable: false, rollable: false, solid: false },
  poolSize: 3,
  modelLength: MODEL_LENGTH.tunnel,
  defaultLength: () => TUNNEL.length,
  collider: noCollider,
  renderView(_inst, view) {
    view.position.x = 0;
  },
});

/** Lateral position of a signal: between lane `lane` (±1) and the centre, or outside that outer lane. */
export function signalX(lane: number, variant: number): number {
  const side = lane < 0 ? -1 : 1;
  return variant & SIGNAL_OUTER ? side * (LANES.spacing * 1.5 + SIGNAL.edgeOffset) : side * LANES.spacing * 0.5;
}

registerObstacleType({
  id: "signal",
  label: "Light signal",
  assetId: "struct.signal",
  rules: { jumpable: false, rollable: false, solid: false },
  poolSize: 8,
  modelLength: 0,
  defaultLength: () => 0.3,
  collider: noCollider,
  renderView(inst, view) {
    view.position.x = signalX(inst.lane, inst.variant);
    const ud = view.userData;
    if (ud.red === undefined) {
      ud.red = view.getObjectByName("lampRed") ?? null;
      ud.green = view.getObjectByName("lampGreen") ?? null;
    }
    const red = (inst.variant & SIGNAL_RED) !== 0;
    if (ud.red) (ud.red as Object3D).visible = red;
    if (ud.green) (ud.green as Object3D).visible = !red;
  },
});
