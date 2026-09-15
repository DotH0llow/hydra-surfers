/**
 * Named deterministic layouts for captures, critics and tests:
 * `window.__game.startRun({ scenario: "barrier-ahead" })`.
 *
 * A scenario either hand-places content (`build`) and disables procedural spawning, or enables
 * procedural spawning (seeded) from `proceduralStart`. Register more from any module.
 */
import type { SpawnApi } from "./patterns";

export interface Scenario {
  id: string;
  description: string;
  /** Run the seeded procedural spawner. */
  procedural: boolean;
  /** Distance where procedural content starts (default: spawn.safeStart). */
  proceduralStart?: number;
  /** Hand-placed content (absolute s; the runner starts at s = 0 in lane 0). */
  build?(api: SpawnApi): void;
}

const scenarios = new Map<string, Scenario>();

export function registerScenario(s: Scenario): void {
  scenarios.set(s.id, s);
}

export function getScenario(id: string): Scenario | undefined {
  return scenarios.get(id);
}

export function listScenarios(): Scenario[] {
  return [...scenarios.values()];
}

export const DEFAULT_SCENARIO = "default";

registerScenario({
  id: "default",
  description: "Normal seeded procedural run.",
  procedural: true,
});

registerScenario({
  id: "flat-straight",
  description: "Empty straight track: no obstacles, no coins. Framing/speed reference.",
  procedural: false,
});

registerScenario({
  id: "barrier-ahead",
  description: "One low barrier in the centre lane at 36 m; nothing else.",
  procedural: false,
  build(api) {
    api.obstacle("barrierLow", 0, 36);
  },
});

registerScenario({
  id: "train-ahead",
  description: "Two-car train in the centre lane from 60 m, coin line in the left lane alongside.",
  procedural: false,
  build(api) {
    api.obstacle("train", 0, 60, 13);
    api.obstacle("train", 0, 73.8, 13);
    api.coinLine(-1, 60, 12, 2.2);
  },
});

registerScenario({
  id: "train-side",
  description: "Three-car train in the left lane from 24 m (to ~65 m). Swipe left while alongside = stumble + bounce; twice quickly = caught.",
  procedural: false,
  build(api) {
    api.obstacle("train", -1, 24, 13);
    api.obstacle("train", -1, 37.8, 13);
    api.obstacle("train", -1, 51.6, 13);
  },
});

registerScenario({
  id: "coin-line",
  description: "Ten coins in the centre lane from 16 m, 2 m apart.",
  procedural: false,
  build(api) {
    api.coinLine(0, 16, 10, 2);
  },
});

registerScenario({
  id: "obstacle-kit",
  description: "Barrier centre at 40 m, train left from 70 m, barrier arc with coins right at 110 m.",
  procedural: false,
  build(api) {
    api.obstacle("barrierLow", 0, 40);
    api.obstacle("train", -1, 70, 13);
    api.obstacle("barrierLow", 1, 110);
    api.coinArc(1, 110, 5, 1.7, 1.3);
  },
});

registerScenario({
  id: "roof-run",
  description: "Ramp in the centre lane at 30 m onto a three-car train (roof run), high barrier left at 60 m.",
  procedural: false,
  build(api) {
    api.obstacle("ramp", 0, 30, 6.5);
    for (let c = 0; c < 3; c++) api.obstacle("train", 0, 36.5 + c * 13.8, 13);
    api.coinLine(0, 38, 16, 2.2, 3.6 + 0.75);
    api.obstacle("barrierHigh", -1, 60);
  },
});

registerScenario({
  id: "oncoming",
  description: "Two-car oncoming train in the centre lane starting 150 m ahead; coins in the right lane.",
  procedural: false,
  build(api) {
    const lead = api.obstacle("trainOncoming", 0, 150, 13, 9);
    const tail = api.obstacle("trainOncoming", 0, 163.8, 13, 9);
    if (lead) lead.variant = 0;
    if (tail) tail.variant = 1;
    api.coinLine(1, 20, 20, 2.5);
  },
});

registerScenario({
  id: "pickups",
  description: "One of each pickup in the centre lane from 25 m (magnet, 2x, sneakers, key, jetpack) with coin lines on both sides.",
  procedural: false,
  build(api) {
    api.pickup("magnet", 0, 25);
    api.pickup("multiplier", 0, 45);
    api.pickup("sneakers", 0, 65);
    api.pickup("key", 0, 85);
    api.pickup("jetpack", 0, 105);
    api.coinLine(-1, 20, 30, 2.5);
    api.coinLine(1, 20, 30, 2.5);
  },
});
