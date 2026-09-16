/**
 * Spawn patterns: small hand-authored layouts the Spawner picks by weight (tuning) and
 * difficulty gate. Every pattern leaves at least one passable option.
 */
import { defineTuning } from "../../core/tuning";
import type { Rng } from "../../core/rng";
import { COINS } from "../collectibles/CoinSystem";
import { GATE, LANTERN_OUTER, LANTERN_WARN, RAMP, RUNAWAY, WAGON } from "../obstacles/builtin";
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
  barricadeSingle: { default: 3, min: 0, max: 10, step: 0.1, label: "Barricade (1 lane)" },
  barricadeDouble: { default: 2, min: 0, max: 10, step: 0.1, label: "Barricades (2 lanes)" },
  barricadeRow: { default: 1, min: 0, max: 10, step: 0.1, label: "Barricades (all lanes)" },
  wagonSingle: { default: 3, min: 0, max: 10, step: 0.1, label: "Wagon (1 lane)" },
  wagonDouble: { default: 2, min: 0, max: 10, step: 0.1, label: "Wagons (2 lanes)" },
  coinRun: { default: 1.2, min: 0, max: 10, step: 0.1, label: "Coin line only" },
  beamSingle: { default: 2.2, min: 0, max: 10, step: 0.1, label: "Hanging beam (roll under)" },
  barricadeMixed: { default: 1.5, min: 0, max: 10, step: 0.1, label: "Barricades + beams" },
  wagonRamp: { default: 1.6, min: 0, max: 10, step: 0.1, label: "Ramp onto a wagon (roof run)" },
  runawayCart: { default: 1.4, min: 0, max: 10, step: 0.1, label: "Runaway cart" },
  gatehouse: { default: 1.2, min: 0, max: 10, step: 0.1, label: "Gatehouse with obstacles" },
});

export const SPAWN_PATTERNS = defineTuning("spawnPatterns", "Spawn pattern details", {
  barricadeDoubleMinDifficulty: { default: 0.1, min: 0, max: 1, step: 0.01, label: "Barricades (2 lanes) min difficulty" },
  barricadeRowMinDifficulty: { default: 0.3, min: 0, max: 1, step: 0.01, label: "Barricades (all) min difficulty" },
  wagonDoubleMinDifficulty: { default: 0.15, min: 0, max: 1, step: 0.01, label: "Wagons (2 lanes) min difficulty" },
  maxCars: { default: 3, min: 1, max: 6, step: 1, label: "Max wagons in a row" },
  coinArcCount: { default: 5, min: 2, max: 12, step: 1, label: "Coins in an arc" },
  coinArcSpacing: { default: 1.7, min: 0.5, max: 5, step: 0.1, label: "Arc coin spacing", unit: "m" },
  coinArcPeak: { default: 1.3, min: 0, max: 4, step: 0.05, label: "Arc peak above coin height", unit: "m" },
  coinLineMin: { default: 6, min: 1, max: 30, step: 1, label: "Coin line min count" },
  coinLineMax: { default: 12, min: 1, max: 40, step: 1, label: "Coin line max count" },
  coinChance: { default: 0.75, min: 0, max: 1, step: 0.01, label: "Chance a pattern carries coins" },
  barricadeMixedMinDifficulty: { default: 0.12, min: 0, max: 1, step: 0.01, label: "Barricades + beams min difficulty" },
  wagonRampMinDifficulty: { default: 0.03, min: 0, max: 1, step: 0.01, label: "Ramp onto a wagon min difficulty" },
  runawayCartMinDifficulty: { default: 0.2, min: 0, max: 1, step: 0.01, label: "Runaway cart min difficulty" },
  gatehouseMinDifficulty: { default: 0.05, min: 0, max: 1, step: 0.01, label: "Gatehouse min difficulty" },
  signalChance: { default: 0.35, min: 0, max: 1, step: 0.01, label: "Chance of a lantern post beside a wagon" },
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

const wagonLength = (cars: number) => cars * WAGON.carLength + (cars - 1) * WAGON.carGap;

function placeWagon(api: SpawnApi, lane: number, s: number, cars: number): number {
  for (let c = 0; c < cars; c++) api.obstacle("wagon", lane, s + c * (WAGON.carLength + WAGON.carGap), WAGON.carLength);
  return wagonLength(cars);
}

/** Lantern post outside the outer lane on the wagon's side (red when a wagon blocks that lane). */
function placeLantern(api: SpawnApi, wagonLane: number, s: number): void {
  const side = wagonLane === 0 ? (api.rng.chance(0.5) ? -1 : 1) : wagonLane;
  const sig = api.obstacle("lantern", side, s);
  if (sig) sig.variant = LANTERN_OUTER | (side === wagonLane ? LANTERN_WARN : 0);
}

registerPattern({
  id: "barricadeSingle",
  label: "Barricade in one lane",
  minDifficulty: 0,
  weight: () => SPAWN_WEIGHTS.barricadeSingle,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    api.obstacle("barricade", lane, s);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      if (api.rng.chance(0.6)) api.coinArc(lane, s, SPAWN_PATTERNS.coinArcCount, SPAWN_PATTERNS.coinArcSpacing, SPAWN_PATTERNS.coinArcPeak);
      else api.coinLine(otherLane(api.rng, lane), s - 6, 6);
    }
    return 2;
  },
});

registerPattern({
  id: "barricadeDouble",
  label: "Barricades in two lanes",
  get minDifficulty() {
    return SPAWN_PATTERNS.barricadeDoubleMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.barricadeDouble,
  place(api, s) {
    const open = api.rng.int(-1, 1);
    for (let l = -1; l <= 1; l++) if (l !== open) api.obstacle("barricade", l, s);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(open, s - 8, 8);
    return 2;
  },
});

registerPattern({
  id: "barricadeRow",
  label: "Barricades across all lanes",
  get minDifficulty() {
    return SPAWN_PATTERNS.barricadeRowMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.barricadeRow,
  place(api, s) {
    for (let l = -1; l <= 1; l++) api.obstacle("barricade", l, s);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      api.coinArc(api.rng.int(-1, 1), s, SPAWN_PATTERNS.coinArcCount, SPAWN_PATTERNS.coinArcSpacing, SPAWN_PATTERNS.coinArcPeak);
    }
    return 2;
  },
});

registerPattern({
  id: "wagonSingle",
  label: "Wagon in one lane",
  minDifficulty: 0,
  weight: () => SPAWN_WEIGHTS.wagonSingle,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    const maxCars = Math.max(1, Math.round(1 + api.difficulty * (SPAWN_PATTERNS.maxCars - 1)));
    const cars = api.rng.int(1, maxCars);
    const len = placeWagon(api, lane, s, cars);
    if (api.rng.chance(SPAWN_PATTERNS.signalChance)) placeLantern(api, lane, s - 3);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      const spacing = 2.2;
      api.coinLine(otherLane(api.rng, lane), s, Math.max(3, Math.floor(len / spacing)), spacing);
    }
    return len;
  },
});

registerPattern({
  id: "wagonDouble",
  label: "Wagons in two lanes",
  get minDifficulty() {
    return SPAWN_PATTERNS.wagonDoubleMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.wagonDouble,
  place(api, s) {
    const open = api.rng.int(-1, 1);
    let len = 0;
    for (let l = -1; l <= 1; l++) {
      if (l === open) continue;
      const cars = api.rng.int(1, 2);
      // stagger so the two wagons do not read as a wall
      const offset = api.rng.range(0, 6);
      len = Math.max(len, offset + placeWagon(api, l, s + offset, cars));
    }
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(open, s, Math.max(3, Math.floor(len / 2.2)), 2.2);
    return len;
  },
});

registerPattern({
  id: "coinRun",
  label: "Coin line",
  minDifficulty: 0,
  weight: () => SPAWN_WEIGHTS.coinRun,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    const n = api.rng.int(SPAWN_PATTERNS.coinLineMin, Math.max(SPAWN_PATTERNS.coinLineMin, SPAWN_PATTERNS.coinLineMax));
    api.coinLine(lane, s, n);
    return n * 2;
  },
});

registerPattern({
  id: "beamSingle",
  label: "Hanging beam (roll under)",
  minDifficulty: 0,
  weight: () => SPAWN_WEIGHTS.beamSingle,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    api.obstacle("beam", lane, s);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      api.coinLine(lane, s - 9, 4);
      api.coinLine(lane, s + 3, 3);
    }
    return 2;
  },
});

registerPattern({
  id: "barricadeMixed",
  label: "Barricades and beams",
  get minDifficulty() {
    return SPAWN_PATTERNS.barricadeMixedMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.barricadeMixed,
  place(api, s) {
    const open = api.rng.int(-1, 1);
    for (let l = -1; l <= 1; l++) {
      if (l !== open) api.obstacle(api.rng.chance(0.5) ? "beam" : "barricade", l, s);
    }
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(open, s - 8, 8);
    return 2;
  },
});

registerPattern({
  id: "wagonRamp",
  label: "Ramp onto a wagon",
  get minDifficulty() {
    return SPAWN_PATTERNS.wagonRampMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.wagonRamp,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    const cars = api.rng.int(2, Math.max(2, SPAWN_PATTERNS.maxCars));
    api.obstacle("ramp", lane, s, RAMP.length);
    const t0 = s + RAMP.length;
    let extent = RAMP.length + placeWagon(api, lane, t0, cars);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) {
      // coins up the ramp, then along the roof
      for (let d = 1; d < RAMP.length; d += 1.8) api.coin(lane, s + d, COINS.height + WAGON.height * (d / RAMP.length));
      api.coinLine(lane, t0 + 1.5, Math.max(3, Math.floor((extent - RAMP.length - 3) / 2.2)), 2.2, WAGON.height + COINS.height);
    }
    // later on, a parked wagon alongside to hop across on the roofs
    if (api.difficulty > 0.2 && api.rng.chance(0.5)) {
      const start = t0 + api.rng.range(4, 10);
      const side = otherLane(api.rng, lane);
      extent = Math.max(extent, start - s + placeWagon(api, side, start, api.rng.int(1, 2)));
    }
    return extent;
  },
});

registerPattern({
  id: "runawayCart",
  label: "Runaway cart",
  get minDifficulty() {
    return SPAWN_PATTERNS.runawayCartMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.runawayCart,
  place(api, s) {
    const lane = api.rng.int(-1, 1);
    const maxCars = Math.max(1, Math.min(RUNAWAY.maxCars, 1 + Math.round(api.difficulty * 2)));
    const cars = api.rng.int(1, maxCars);
    // The car starts moving once it is `spawnAhead` in front of the runner and covers `sweep` metres
    // before they meet, so the pattern keeps that stretch of its lane free.
    const sweep = RUNAWAY.speed * (RUNAWAY.spawnAhead / (Math.max(1, api.speed) + RUNAWAY.speed));
    const s0 = s + sweep;
    for (let c = 0; c < cars; c++) {
      const car = api.obstacle("runaway", lane, s0 + c * (WAGON.carLength + WAGON.carGap), WAGON.carLength, RUNAWAY.speed);
      if (car) car.variant = c === 0 ? 0 : 1;
    }
    const len = sweep + wagonLength(cars);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(otherLane(api.rng, lane), s, Math.max(3, Math.floor(len / 2.5)), 2.5);
    return len;
  },
});

registerPattern({
  id: "gatehouse",
  label: "Gatehouse with obstacles",
  get minDifficulty() {
    return SPAWN_PATTERNS.gatehouseMinDifficulty;
  },
  weight: () => SPAWN_WEIGHTS.gatehouse,
  place(api, s) {
    const len = GATE.length + api.rng.range(0, 15);
    api.obstacle("gate", 0, s, len);
    const a = api.rng.int(-1, 1);
    api.obstacle("barricade", a, s + len * 0.35);
    const b = otherLane(api.rng, a);
    api.obstacle("beam", b, s + len * 0.7);
    if (api.rng.chance(SPAWN_PATTERNS.coinChance)) api.coinLine(otherLane(api.rng, b), s + 2, Math.floor((len - 4) / 2.5), 2.5);
    return len;
  },
});
