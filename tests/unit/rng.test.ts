import { describe, expect, it } from "vitest";
import { Rng, hash32 } from "../../src/core/rng";

describe("Rng (mulberry32)", () => {
  it("is reproducible for a seed and differs across seeds", () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const c = new Rng(1235);
    const sa = Array.from({ length: 64 }, () => a.next());
    const sb = Array.from({ length: 64 }, () => b.next());
    const sc = Array.from({ length: 64 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it("matches the reference mulberry32 sequence", () => {
    // Known first outputs of mulberry32(1) as uint32 / 2^32.
    const r = new Rng(1);
    const ref = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        let t = (s = (s + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const g = ref(1);
    for (let i = 0; i < 10; i++) expect(r.next()).toBe(g());
    expect(new Rng(1).next()).toBeCloseTo(0.6270739405881613, 15);
  });

  it("stays in range and is roughly uniform", () => {
    const r = new Rng(99);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]++;
    }
    for (const n of buckets) expect(Math.abs(n - 2000)).toBeLessThan(200);
  });

  it("int() is inclusive and covers every value", () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(-1, 1);
      expect([-1, 0, 1]).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });

  it("range, chance and pick behave", () => {
    const r = new Rng(3);
    for (let i = 0; i < 500; i++) {
      const v = r.range(2, 5);
      expect(v >= 2 && v < 5).toBe(true);
    }
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
    expect(r.pick([])).toBeUndefined();
    expect(["a", "b"]).toContain(r.pick(["a", "b"]));
  });

  it("weighted() never picks zero weights and follows proportions", () => {
    const r = new Rng(42);
    const w = new Float64Array([0, 1, 3, 0]);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) counts[r.weighted(w)]++;
    expect(counts[0]).toBe(0);
    expect(counts[3]).toBe(0);
    expect(counts[2] / counts[1]).toBeGreaterThan(2.6);
    expect(counts[2] / counts[1]).toBeLessThan(3.4);
    expect(r.weighted([0, 0, -1])).toBe(-1);
    expect(r.weighted([5, 5, 5], 1)).toBe(0);
  });

  it("state save/restore and reseed replay the stream", () => {
    const r = new Rng(5);
    r.next();
    const saved = r.getState();
    const x = [r.next(), r.next()];
    r.setState(saved);
    expect([r.next(), r.next()]).toEqual(x);
    r.reseed(5);
    expect(r.seed).toBe(5);
    expect(r.next()).toBe(new Rng(5).next());
  });

  it("fork() yields independent deterministic child streams", () => {
    const a = new Rng(10).fork(1);
    const b = new Rng(10).fork(1);
    const c = new Rng(10).fork(2);
    expect(a.next()).toBe(b.next());
    expect(new Rng(10).fork(1).next()).not.toBe(c.next());
    expect(hash32(0)).toBe(0);
    expect(hash32(1)).not.toBe(hash32(2));
    expect(hash32(-1)).toBeGreaterThanOrEqual(0);
  });
});
