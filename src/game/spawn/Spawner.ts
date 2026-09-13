/** Seeded chunk/pattern generator: keeps content generated `ahead` metres beyond the runner. */
import { defineTuning } from "../../core/tuning";
import type { Rng } from "../../core/rng";
import { COINS } from "../collectibles/CoinSystem";
import type { ObstacleInstance } from "../obstacles/ObstacleSystem";
import type { ResolvedRunOptions, RunContext, RunSystem } from "../types";
import { SPEED, difficultyAt, speedAt } from "./difficulty";
import { listPatterns, type SpawnApi } from "./patterns";

export const SPAWN = defineTuning("spawn", "Spawner", {
  ahead: { default: 210, min: 40, max: 600, step: 5, label: "Generate ahead", unit: "m" },
  safeStart: { default: 50, min: 0, max: 300, step: 1, label: "Empty track at run start", unit: "m" },
  gapSecondsStart: { default: 1.25, min: 0.2, max: 5, step: 0.05, label: "Gap between patterns at start", unit: "s" },
  gapSecondsEnd: { default: 0.8, min: 0.2, max: 5, step: 0.05, label: "Gap between patterns at full difficulty", unit: "s" },
  gapJitter: { default: 0.25, min: 0, max: 1, step: 0.01, label: "Gap jitter (±fraction)" },
  minGap: { default: 9, min: 0, max: 60, step: 0.5, label: "Minimum gap", unit: "m" },
});

export class Spawner implements RunSystem, SpawnApi {
  readonly id = "spawner";
  readonly order = 30;
  rng!: Rng;
  difficulty = 0;
  speed = 0;
  private nextS = 0;
  private procedural = false;
  private weights = new Float64Array(16);
  private ctx!: RunContext;

  init(ctx: RunContext): void {
    this.ctx = ctx;
    this.rng = ctx.rng;
  }

  reset(ctx: RunContext, opts: ResolvedRunOptions): void {
    this.difficulty = 0;
    this.speed = speedAt(0);
    const sc = opts.scenario;
    const live = ctx.state.mode !== "idle";
    this.procedural = live && sc.procedural;
    this.nextS = sc.proceduralStart ?? SPAWN.safeStart;
  }

  /** Scenario layouts are placed after obstacle/coin pools have been cleared by their own reset. */
  afterReset(ctx: RunContext, opts: ResolvedRunOptions): void {
    if (ctx.state.mode !== "idle" && opts.scenario.build) opts.scenario.build(this);
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    if (!this.procedural || (st.mode !== "running" && st.mode !== "intro")) return;
    this.difficulty = difficultyAt(st.time);
    this.speed = Math.max(st.speed, SPEED.start);
    const pats = listPatterns();
    if (this.weights.length < pats.length) this.weights = new Float64Array(pats.length * 2);
    let guard = 0;
    while (this.nextS < st.distance + SPAWN.ahead && guard++ < 8) {
      for (let i = 0; i < pats.length; i++) {
        const p = pats[i];
        this.weights[i] = this.difficulty >= p.minDifficulty ? p.weight() : 0;
      }
      const idx = this.rng.weighted(this.weights, pats.length);
      const used = idx >= 0 ? pats[idx].place(this, this.nextS) : 10;
      const gapT = SPAWN.gapSecondsStart + (SPAWN.gapSecondsEnd - SPAWN.gapSecondsStart) * this.difficulty;
      const gap = Math.max(SPAWN.minGap, this.speed * gapT * (1 + this.rng.range(-SPAWN.gapJitter, SPAWN.gapJitter)));
      this.nextS += used + gap;
    }
  }

  // ------------------------------------------------------------------ SpawnApi

  obstacle(typeId: string, lane: number, s: number, length?: number, speed?: number): ObstacleInstance | null {
    return this.ctx.obstacles.spawn(typeId, lane, s, length, speed);
  }

  coin(lane: number, s: number, y?: number): void {
    this.ctx.coins.spawn(lane, s, y ?? COINS.height);
  }

  coinLine(lane: number, s: number, count: number, spacing = COINS.spacing, y = COINS.height): void {
    for (let i = 0; i < count; i++) this.ctx.coins.spawn(lane, s + i * spacing, y);
  }

  coinArc(lane: number, sCenter: number, count: number, spacing: number, peak: number): void {
    const half = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const u = half > 0 ? (i - half) / half : 0;
      this.ctx.coins.spawn(lane, sCenter + (i - half) * spacing, COINS.height + peak * (1 - u * u));
    }
  }
}
