/**
 * Score accumulates distance × multiplier (+ optional coin points).
 * Multiplier = base + mission-set bonus (state.multiplierBonus), doubled while the 2x power-up is active.
 */
import { defineTuning } from "../../core/tuning";
import type { PowerupSystem } from "../powerups/PowerupSystem";
import type { RunContext, RunSystem } from "../types";

export const SCORE = defineTuning("score", "Score", {
  pointsPerMeter: { default: 1, min: 0, max: 20, step: 0.1, label: "Points per metre" },
  coinPoints: { default: 0, min: 0, max: 100, step: 1, label: "Points per coin" },
  baseMultiplier: { default: 1, min: 1, max: 30, step: 1, label: "Base score multiplier" },
});

export class ScoreSystem implements RunSystem {
  readonly id = "score";
  readonly order = 80;
  private acc = 0;
  private lastCoins = 0;
  private powerups: PowerupSystem | undefined;

  init(ctx: RunContext): void {
    this.powerups = ctx.getSystem<PowerupSystem>("powerups");
  }

  reset(ctx: RunContext): void {
    this.acc = 0;
    this.lastCoins = 0;
    ctx.state.score = 0;
    ctx.state.multiplier = SCORE.baseMultiplier + ctx.state.multiplierBonus;
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    if (st.mode !== "running" && st.mode !== "intro") return;
    const doubled = this.powerups?.isActive("multiplier") ? 2 : 1;
    st.multiplier = (SCORE.baseMultiplier + st.multiplierBonus) * doubled;
    const ds = st.distance - st.prevDistance;
    this.acc += ds * SCORE.pointsPerMeter * st.multiplier;
    if (st.coins !== this.lastCoins) {
      this.acc += (st.coins - this.lastCoins) * SCORE.coinPoints * st.multiplier;
      this.lastCoins = st.coins;
    }
    st.score = Math.floor(this.acc);
  }
}
