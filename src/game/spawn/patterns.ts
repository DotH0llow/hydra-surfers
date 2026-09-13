/**
 * Spawn patterns: small hand-authored layouts the Spawner picks by weight (tuning) and
 * difficulty gate. Every pattern leaves at least one passable option.
 */
import { defineTuning } from "../../core/tuning";
import type { Rng } from "../../core/rng";
import { TRAIN } from "../obstacles/builtin";
import type { ObstacleInstance } from "../obstacles/ObstacleSystem";

export interface SpawnApi {
  readonly rng: Rng;
  /** 0..1 */
  readonly difficulty: number;
  /** Current forward speed (m/s). */
  readonly speed: number;
  obstacle(typeId: string, lane: number, s: number, length?: number, speed?: number): ObstacleInstance | null;
  coin(lane: number, s: number, y?: number): void;
  coinLine(lane: number, s: number, count: number, spacing?: number, y?: number): void;
  /** Coins centred on sCenter following a parabola `peak` metres above the base height. */
  coinArc(lane: number, sCenter: number, count: number, spacing: number, peak: number): void;
}

export interface Pattern {
  id: string;
  label: string;
  /** Not picked below this difficulty. */
  minDifficulty: number;
  weight(): number;
  /** Place content starting at s; returns the length (m) it occupies. */
  place(api: SpawnApi, s: number): number;
}

export const SPAWN_WEIGHTS = defineTuning("spawnWeights", "Spawn pattern weights", {
  barrierSingle: { default: 3, min: 0, max: 10, step: 0.1, label: "Barrier (1 lane)" },
  barrierDouble: { default: 2, min: 0, max: 10, step: 0.1, label: "Barriers (2 lanes)" },
  barrierRow: { default: 1, min: 0, max: 10, step: 0.1, label: "Barriers (all lanes)" },
  trainSingle: { default: 3, min: 0, max: 10, step: 0.1, label: "Train (1 lane)" },
  trainDouble: { default: 2, min: 0, max: 10, step: 0.1, label: "Trains (2 lanes)" },
  coinsOnly: { default: 1.2, min: 0, max: 10, step: 0.1, label: "Coin line only" },
});

export const SPAWN_PATTERNS = defineTuning("spawnPatterns", "Spawn pattern details", {
  barrierDoubleMinDifficulty: { default: 0.1, min: 0, max: 1, step: 0.01, label: "Barriers (2 lanes) min difficulty" },
  barrierRowMinDifficulty: { default: 0.3, min: 0, max: 1, step: 0.01, label: "Barriers (all) min difficulty" },
  trainDoubleMinDifficulty: { default: 0.15, min: 0, max: 1, step: 0.01, label: "Trains (2 lanes) min difficulty" },
  maxCars: { default: 3, min: 1, max: 6, step: 1, label: "Max cars per train" },
  coinArcCount: { default: 5, min: 2, max: 12, step: 1, label: "Coins in an arc" },
  coinArcSpacing: { default: 1.7, min: 0.5, max: 5, step: 0.1, label: "Arc coin spacing", unit: "m" },
  coinArcPeak: { default: 1.3, min: 0, max: 4, step: 0.05, label: "Arc peak above coin height", unit: "m" },
  coinLineMin: { default: 6, min: 1, max: 30, step: 1, label: "Coin line min count" },
  coinLineMax: { default: 12, min: 1, max: 40, step: 1, label: "Coin line max count" },
  coinChance: { default: 0.75, min: 0, max: 1, step: 0.01, label: "Chance a pattern carries coins" },
});

const patterns: Pattern[] = [];

export function registerPattern(p: Pattern): void {
  const i = patterns.findIndex((q) => q.id === p.id);
  if (i >= 0) patterns[i] = p;
  else patterns.push(p);
}

export function listPatterns(): readonly Pattern[] {
  return patterns;
}

const otherLane = (rng: Rng, not: number): number => {
  const r = rng.int(0, 1);
  const lanes = not === -1 ? [0, 1] : not === 0 ? [-1, 1] : [-1, 0];
  return lanes[r];
};

const trainLength = (cars: number) => cars * TRAIN.carLength + (cars - 1) * TRAIN.carGap;

function placeTrain(api: SpawnApi, lane: number, s: number, cars: number): number {
  for (let c = 0; c < cars; c++) api.obstacle("train", lane, s + c * (TRAIN.carLength + TRAIN.carGap), TRAIN.carLength);
  return trainLength(cars);
}

registerPattern({
  id: "barrierSingle",
  label: "Barrier in one lane",
  minDifficulty: 0,
  weight: () => SPAWN_WEIGHTS.barrierSingle,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    api.obstacle("barrierLow", lane, s);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      if (api.rng.chance(0.6)) api.coinArc(lane, s, SPAWN_PATTERNS.coinArcCount, SPAWN_PATTERNS.coinArcSpacing, SPAWN_PATTERNS.coinArcPeak);
      else api.coinLine(otherLane(api.rng, lane), s - 6, 6);
    }
    return 2;
  },
});

registerPattern({
  id: "barrierDouble",
  label: "Barriers in two lanes",
  get minDifficulty() {
    return SPAWN_PATTERNS.barrierDoubleMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.barrierDouble,
  place(api, s) {
    const open = api.rng.int(-1, 1);
    for (let l = -1; l <= 1; l++) if (l !== open) api.obstacle("barrierLow", l, s);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(open, s - 8, 8);
    return 2;
  },
});

registerPattern({
  id: "barrierRow",
  label: "Barriers across all lanes",
  get minDifficulty() {
    return SPAWN_PATTERNS.barrierRowMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.barrierRow,
  place(api, s) {
    for (let l = -1; l <= 1; l++) api.obstacle("barrierLow", l, s);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      api.coinArc(api.rng.int(-1, 1), s, SPAWN_PATTERNS.coinArcCount, SPAWN_PATTERNS.coinArcSpacing, SPAWN_PATTERNS.coinArcPeak);
    }
    return 2;
  },
});

registerPattern({
  id: "trainSingle",
  label: "Train in one lane",
  minDifficulty: 0,
  weight: () => SPAWN_WEIGHTS.trainSingle,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    const maxCars = Math.max(1, Math.round(1 + api.difficulty * (SPAWN_PATTERNS.maxCars - 1)));
    const cars = api.rng.int(1, maxCars);
    const len = placeTrain(api, lane, s, cars);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      const spacing = 2.2;
      api.coinLine(otherLane(api.rng, lane), s, Math.max(3, Math.floor(len / spacing)), spacing);
    }
    return len;
  },
});

registerPattern({
  id: "trainDouble",
  label: "Trains in two lanes",
  get minDifficulty() {
    return SPAWN_PATTERNS.trainDoubleMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.trainDouble,
  place(api, s) {
    const open = api.rng.int(-1, 1);
    let len = 0;
    for (let l = -1; l <= 1; l++) {
      if (l === open) continue;
      const cars = api.rng.int(1, 2);
      // stagger so the two trains don't read as a wall
      const offset = api.rng.range(0, 6);
      len = Math.max(len, offset + placeTrain(api, l, s + offset, cars));
    }
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(open, s, Math.max(3, Math.floor(len / 2.2)), 2.2);
    return len;
  },
});

registerPattern({
  id: "coinsOnly",
  label: "Coin line",
  minDifficulty: 0,
  weight: () => SPAWN_WEIGHTS.coinsOnly,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    const n = api.rng.int(SPAWN_PATTERNS.coinLineMin, Math.max(SPAWN_PATTERNS.coinLineMin, SPAWN_PATTERNS.coinLineMax));
    api.coinLine(lane, s, n);
    return n * 2;
  },
});
