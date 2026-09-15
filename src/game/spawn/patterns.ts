/**
 * Spawn patterns: small hand-authored layouts the Spawner picks by weight (tuning) and
 * difficulty gate. Every pattern leaves at least one passable option.
 */
import { defineTuning } from "../../core/tuning";
import type { Rng } from "../../core/rng";
import { COINS } from "../collectibles/CoinSystem";
import { ONCOMING, RAMP, SIGNAL_OUTER, SIGNAL_RED, TRAIN, TUNNEL } from "../obstacles/builtin";
import type { ObstacleInstance } from "../obstacles/ObstacleSystem";
import type { PickupKind } from "../powerups/PickupSystem";

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
  pickup(kind: PickupKind, lane: number, s: number, y?: number): void;
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
  barrierHigh: { default: 2.2, min: 0, max: 10, step: 0.1, label: "High barrier (roll under)" },
  barrierMixed: { default: 1.5, min: 0, max: 10, step: 0.1, label: "Low + high barriers" },
  trainRamp: { default: 1.6, min: 0, max: 10, step: 0.1, label: "Ramp onto a train (roof run)" },
  trainOncoming: { default: 1.4, min: 0, max: 10, step: 0.1, label: "Oncoming train" },
  tunnel: { default: 1.2, min: 0, max: 10, step: 0.1, label: "Tunnel with barriers" },
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
  barrierMixedMinDifficulty: { default: 0.12, min: 0, max: 1, step: 0.01, label: "Low + high barriers min difficulty" },
  trainRampMinDifficulty: { default: 0.03, min: 0, max: 1, step: 0.01, label: "Ramp onto a train min difficulty" },
  trainOncomingMinDifficulty: { default: 0.2, min: 0, max: 1, step: 0.01, label: "Oncoming train min difficulty" },
  tunnelMinDifficulty: { default: 0.05, min: 0, max: 1, step: 0.01, label: "Tunnel min difficulty" },
  signalChance: { default: 0.35, min: 0, max: 1, step: 0.01, label: "Chance of a trackside signal next to a train" },
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

/** Trackside signal outside the outer lane on the train's side (red when the train is in that lane). */
function placeSignal(api: SpawnApi, trainLane: number, s: number): void {
  const side = trainLane === 0 ? (api.rng.chance(0.5) ? -1 : 1) : trainLane;
  const sig = api.obstacle("signal", side, s);
  if (sig) sig.variant = SIGNAL_OUTER | (side === trainLane ? SIGNAL_RED : 0);
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
    if (api.rng.chance(SPAWN_PATTERNS.signalChance)) placeSignal(api, lane, s - 3);
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

registerPattern({
  id: "barrierHigh",
  label: "High barrier (roll under)",
  minDifficulty: 0,
  weight: () => SPAWN_WEIGHTS.barrierHigh,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    api.obstacle("barrierHigh", lane, s);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      api.coinLine(lane, s - 9, 4);
      api.coinLine(lane, s + 3, 3);
    }
    return 2;
  },
});

registerPattern({
  id: "barrierMixed",
  label: "Low and high barriers",
  get minDifficulty() {
    return SPAWN_PATTERNS.barrierMixedMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.barrierMixed,
  place(api, s) {
    const open = api.rng.int(-1, 1);
    for (let l = -1; l <= 1; l++) {
      if (l !== open) api.obstacle(api.rng.chance(0.5) ? "barrierHigh" : "barrierLow", l, s);
    }
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(open, s - 8, 8);
    return 2;
  },
});

registerPattern({
  id: "trainRamp",
  label: "Ramp onto a train",
  get minDifficulty() {
    return SPAWN_PATTERNS.trainRampMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.trainRamp,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    const cars = api.rng.int(2, Math.max(2, SPAWN_PATTERNS.maxCars));
    api.obstacle("ramp", lane, s, RAMP.length);
    const t0 = s + RAMP.length;
    let extent = RAMP.length + placeTrain(api, lane, t0, cars);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      // coins up the ramp, then along the roof
      for (let d = 1; d < RAMP.length; d += 1.8) api.coin(lane, s + d, COINS.height + TRAIN.height * (d / RAMP.length));
      api.coinLine(lane, t0 + 1.5, Math.max(3, Math.floor((extent - RAMP.length - 3) / 2.2)), 2.2, TRAIN.height + COINS.height);
    }
    // later on, a parked train alongside to hop across on the roofs
    if (api.difficulty > 0.2 && api.rng.chance(0.5)) {
      const start = t0 + api.rng.range(4, 10);
      const side = otherLane(api.rng, lane);
      extent = Math.max(extent, start - s + placeTrain(api, side, start, api.rng.int(1, 2)));
    }
    return extent;
  },
});

registerPattern({
  id: "trainOncoming",
  label: "Oncoming train",
  get minDifficulty() {
    return SPAWN_PATTERNS.trainOncomingMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.trainOncoming,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    const maxCars = Math.max(1, Math.min(ONCOMING.maxCars, 1 + Math.round(api.difficulty * 2)));
    const cars = api.rng.int(1, maxCars);
    // The car starts moving once it is `spawnAhead` in front of the runner and covers `sweep` metres
    // before they meet, so the pattern keeps that stretch of its lane free.
    const sweep = ONCOMING.speed * (ONCOMING.spawnAhead / (Math.max(1, api.speed) + ONCOMING.speed));
    const s0 = s + sweep;
    for (let c = 0; c < cars; c++) {
      const car = api.obstacle("trainOncoming", lane, s0 + c * (TRAIN.carLength + TRAIN.carGap), TRAIN.carLength, ONCOMING.speed);
      if (car) car.variant = c === 0 ? 0 : 1;
    }
    const len = sweep + trainLength(cars);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(otherLane(api.rng, lane), s, Math.max(3, Math.floor(len / 2.5)), 2.5);
    return len;
  },
});

registerPattern({
  id: "tunnel",
  label: "Tunnel with barriers",
  get minDifficulty() {
    return SPAWN_PATTERNS.tunnelMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.tunnel,
  place(api, s) {
    const len = TUNNEL.length + api.rng.range(0, 15);
    api.obstacle("tunnel", 0, s, len);
    const a = api.rng.int(-1, 1);
    api.obstacle("barrierLow", a, s + len * 0.35);
    const b = otherLane(api.rng, a);
    api.obstacle("barrierHigh", b, s + len * 0.7);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(otherLane(api.rng, b), s + 2, Math.floor((len - 4) / 2.5), 2.5);
    return len;
  },
});
