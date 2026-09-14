/**
 * Meta progression (PLAN.md §2 src/meta): what a finished run does to the persistent profile.
 * Pure functions over Profile so they are unit-testable; App calls them inside store.update().
 * Lane C owns src/meta (missions, multiplier, catalog, upgrades, daily) and extends this additively.
 */
import type { Profile } from "../core/store";

export interface RunTotals {
  score: number;
  coins: number;
  distance: number;
}

export interface RunOutcome {
  newBest: boolean;
  best: number;
  bestDistance: number;
}

/** Banks coins and updates lifetime stats. Mutates `p` (call inside ProfileStore.update). */
export function applyRunResult(p: Profile, r: RunTotals): RunOutcome {
  const coins = Math.max(0, Math.floor(r.coins));
  const score = Math.max(0, Math.floor(r.score));
  const distance = Math.max(0, r.distance);
  const prevBest = p.stats.bestScore;
  p.stats.runs++;
  p.stats.totalCoins += coins;
  p.stats.totalDistance += distance;
  p.stats.bestScore = Math.max(prevBest, score);
  p.stats.bestDistance = Math.max(p.stats.bestDistance, distance);
  p.currencies.coins += coins;
  return { newBest: score > prevBest, best: p.stats.bestScore, bestDistance: p.stats.bestDistance };
}
