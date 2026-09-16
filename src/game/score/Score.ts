/**
 * Score accumulates distance x multiplier, plus whatever the run's rules add.
 *
 * Multiplier = base + the permanent guild bonus (only when `rules.guildMultiplier` allows it, so
 * seeded boards are not decided by how long someone has been playing), doubled while the royal
 * blessing is active. On top of that sit the run's `scoreMul`, the combo bonus written here by the
 * skill system, and a high-speed bonus for builds that pay for it.
 */
import { defineTuning } from "../../core/tuning";
import type { PowerupSystem } from "../powerups/PowerupSystem";
import { SPEED } from "../spawn/difficulty";
import type { RunContext, RunSystem } from "../types";

export const SCORE = defineTuning("score", "Score", {
  pointsPerMeter: { default: 1, min: 0, max: 20, step: 0.1, label: "Points per metre" },
  coinPoints: { default: 0, min: 0, max: 100, step: 1, label: "Points per coin" },
  baseMultiplier: { default: 1, min: 1, max: 30, step: 1, label: "Base score multiplier" },
  highSpeedFraction: { default: 0.9, min: 0.5, max: 1, step: 0.01, label: "High-speed bonus starts at this fraction of top speed" },
});

export class ScoreSystem implements RunSystem {
  readonly id = "score";
  readonly order = 80;
  /**
   * Combo bonus multiplier, written every tick by the skill system (order 65, before this one).
   * 1 = no combo. Kept here so score has a single place where multipliers are combined.
   */
  comboBonus = 1;
  private acc = 0;
  private lastCoins = 0;
  private powerups: PowerupSystem | undefined;

  init(ctx: RunContext): void {
    this.powerups = ctx.getSystem<PowerupSystem>("powerups");
  }

  reset(ctx: RunContext): void {
    this.acc = 0;
    this.lastCoins = 0;
    this.comboBonus = 1;
    ctx.state.score = 0;
    ctx.state.multiplier = SCORE.baseMultiplier + this.guildBonus(ctx);
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    if (st.mode !== "running" && st.mode !== "intro") return;
    const rules = ctx.rules;
    const doubled = this.powerups?.isActive("multiplier") ? 2 : 1;
    st.multiplier = (SCORE.baseMultiplier + this.guildBonus(ctx)) * doubled;
    const mul = this.totalMultiplier(ctx);
    // the hourglass slows the road, not the scoring: divide the ground covered back out
    const ds = (st.distance - st.prevDistance) / Math.max(0.05, st.speedScale);
    this.acc += ds * SCORE.pointsPerMeter * mul;
    if (st.coins !== this.lastCoins) {
      this.acc += (st.coins - this.lastCoins) * (SCORE.coinPoints + rules.coinScoreBonus) * mul;
      this.lastCoins = st.coins;
    }
    st.score = Math.floor(this.acc);
  }

  /**
   * Flat award from another system (near miss, perfect dodge, smashed obstacle). Scaled by the
   * run multipliers so a skilful run in a 1.3x event is worth more, and by `skillScoreMul` so a
   * challenge can make precision the point of the week.
   */
  award(ctx: RunContext, points: number): void {
    if (points <= 0) return;
    this.acc += points * this.totalMultiplier(ctx) * ctx.rules.skillScoreMul;
    ctx.state.score = Math.floor(this.acc);
  }

  /** Everything that multiplies a point right now. */
  private totalMultiplier(ctx: RunContext): number {
    const st = ctx.state;
    const rules = ctx.rules;
    const fast = rules.highSpeedScoreBonus > 0 && st.speed >= SPEED.max * SCORE.highSpeedFraction ? 1 + rules.highSpeedScoreBonus : 1;
    return st.multiplier * rules.scoreMul * this.comboBonus * fast;
  }

  private guildBonus(ctx: RunContext): number {
    return ctx.rules.guildMultiplier > 0 ? ctx.state.multiplierBonus : 0;
  }
}
