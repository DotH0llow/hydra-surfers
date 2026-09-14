import { describe, expect, it } from "vitest";
import { defaultProfile } from "../../src/core/store";
import { applyRunResult } from "../../src/meta/progression";

describe("meta/progression applyRunResult", () => {
  it("banks coins, counts runs and tracks bests", () => {
    const p = defaultProfile();
    const a = applyRunResult(p, { score: 1200, coins: 42, distance: 350.5 });
    expect(a).toEqual({ newBest: true, best: 1200, bestDistance: 350.5 });
    expect(p.currencies.coins).toBe(42);
    expect(p.stats).toMatchObject({ runs: 1, totalCoins: 42, bestScore: 1200 });

    const b = applyRunResult(p, { score: 800, coins: 10, distance: 400 });
    expect(b).toEqual({ newBest: false, best: 1200, bestDistance: 400 });
    expect(p.currencies.coins).toBe(52);
    expect(p.stats.runs).toBe(2);
    expect(p.stats.totalDistance).toBeCloseTo(750.5);
  });

  it("ignores negative / fractional garbage", () => {
    const p = defaultProfile();
    applyRunResult(p, { score: -5, coins: 3.7, distance: -1 });
    expect(p.currencies.coins).toBe(3);
    expect(p.stats.bestScore).toBe(0);
    expect(p.stats.totalDistance).toBe(0);
  });
});
