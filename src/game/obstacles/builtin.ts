/** Greybox obstacle kit: low barrier (jump or roll) and a train car (dodge). */
import { defineTuning } from "../../core/tuning";
import { laneX } from "../world/coords";
import { registerObstacleType } from "./registry";

export const BARRIER_LOW = defineTuning("obsBarrierLow", "Obstacle: low barrier", {
  width: { default: 2.1, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  bottom: { default: 0.55, min: 0, max: 2, step: 0.01, label: "Collider bottom (roll clearance)", unit: "m" },
  height: { default: 0.5, min: 0.1, max: 3, step: 0.01, label: "Collider height", unit: "m" },
  length: { default: 0.3, min: 0.05, max: 3, step: 0.01, label: "Collider depth", unit: "m" },
});

export const TRAIN = defineTuning("obsTrain", "Obstacle: train", {
  width: { default: 2.2, min: 0.5, max: 3, step: 0.05, label: "Collider width", unit: "m" },
  height: { default: 3.6, min: 1, max: 6, step: 0.05, label: "Collider height", unit: "m" },
  carLength: { default: 13, min: 4, max: 30, step: 0.5, label: "Car length", unit: "m" },
  carGap: { default: 0.8, min: 0, max: 5, step: 0.05, label: "Gap between cars", unit: "m" },
});

registerObstacleType({
  id: "barrierLow",
  label: "Low barrier",
  assetId: "obstacle.barrier.low",
  rules: { jumpable: true, rollable: true, solid: false },
  poolSize: 16,
  modelLength: 0,
  defaultLength: () => BARRIER_LOW.length,
  collider(inst, out) {
    const x = laneX(inst.lane);
    const hw = BARRIER_LOW.width / 2;
    out.minX = x - hw;
    out.maxX = x + hw;
    out.minY = BARRIER_LOW.bottom;
    out.maxY = BARRIER_LOW.bottom + BARRIER_LOW.height;
    out.minS = inst.s;
    out.maxS = inst.s + inst.length;
  },
});

registerObstacleType({
  id: "train",
  label: "Train car",
  assetId: "obstacle.train.car",
  rules: { jumpable: false, rollable: false, solid: true },
  poolSize: 24,
  modelLength: 13,
  defaultLength: () => TRAIN.carLength,
  collider(inst, out) {
    const x = laneX(inst.lane);
    const hw = TRAIN.width / 2;
    out.minX = x - hw;
    out.maxX = x + hw;
    out.minY = 0;
    out.maxY = TRAIN.height;
    out.minS = inst.s;
    out.maxS = inst.s + inst.length;
  },
});
