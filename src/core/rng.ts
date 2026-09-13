/**
 * Seeded PRNG (mulberry32). ALL gameplay randomness goes through an Rng instance so a run
 * is reproducible from seed + input timeline + tuning. Never call Math.random in sim code.
 */
export class Rng {
  private state = 0;
  private _seed = 0;

  constructor(seed = 1) {
    this.reseed(seed);
  }

  get seed(): number {
    return this._seed;
  }

  reseed(seed: number): void {
    this._seed = seed >>> 0;
    this.state = this._seed;
  }

  /** Raw 32-bit state, for save/restore. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Picks an element; returns undefined for an empty array. */
  pick<T>(arr: readonly T[]): T | undefined {
    return arr.length ? arr[Math.floor(this.next() * arr.length)] : undefined;
  }

  /**
   * Weighted index pick without allocation. `weights[i] <= 0` never picks i.
   * Returns -1 when every weight is <= 0.
   */
  weighted(weights: ArrayLike<number>, count = weights.length): number {
    let total = 0;
    for (let i = 0; i < count; i++) if (weights[i] > 0) total += weights[i];
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < count; i++) {
      const w = weights[i];
      if (w <= 0) continue;
      if (r < w) return i;
      r -= w;
    }
    for (let i = count - 1; i >= 0; i--) if (weights[i] > 0) return i;
    return -1;
  }

  /** Derives an independent child stream (e.g. visuals vs gameplay) from this seed. */
  fork(salt: number): Rng {
    return new Rng(hash32(this._seed ^ Math.imul(salt | 0, 0x9e3779b1)));
  }
}

/** Integer hash (lowbias32). */
export function hash32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
