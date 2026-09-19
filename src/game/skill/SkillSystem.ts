/**
 * Skill — near misses, perfect dodges, combo and the clean-run streak.
 *
 * This is where the game gets a ceiling. Everything else about a run is "do not touch things";
 * this system pays attention to HOW you did not touch them, so two players who both survive 2 km
 * can still be separated by a wide margin.
 *
 * Three rewards, deliberately different in kind:
 *  - **dodge**: you cleared something that was genuinely in your lane. Small, frequent, keeps the
 *    combo alive.
 *  - **near miss**: you cleared it by a hair. Pays for bravery, not for luck — the margins come
 *    from the real colliders.
 *  - **perfect dodge**: you were on a collision course and got out of it inside a short window.
 *    Pays for reading the road late and correctly, which is the actual hard skill.
 *
 * All of it is simulated (order 65, after collisions have resolved) so it is deterministic and
 * replayable: the same seed and the same inputs produce the same combo.
 */
import { defineTuning } from "../../core/tuning";
import { registerRunSystem } from "../systems";
import { PLAYER_HITBOX } from "../player/PlayerController";
import { laneX } from "../world/coords";
import { makeAabb, type RunContext, type RunSystem } from "../types";
import type { ObstacleInstance } from "../obstacles/ObstacleSystem";
import type { ScoreSystem } from "../score/Score";

export const SKILL = defineTuning("skill", "Skill, near miss & combo", {
  threatSeconds: { default: 0.75, min: 0.1, max: 3, step: 0.05, label: "An obstacle counts as a threat this far ahead", unit: "s" },
  nearLateral: { default: 0.5, min: 0.05, max: 2, step: 0.01, label: "Near miss: sideways clearance under", unit: "m" },
  nearVertical: { default: 0.3, min: 0.05, max: 2, step: 0.01, label: "Near miss: clearance when jumping over", unit: "m" },
  perfectSeconds: { default: 0.3, min: 0.05, max: 1, step: 0.01, label: "Perfect dodge: acted this long before impact", unit: "s" },
  dodgeScore: { default: 5, min: 0, max: 200, step: 1, label: "Score for clearing a threat" },
  nearScore: { default: 25, min: 0, max: 500, step: 1, label: "Score for a near miss" },
  perfectScore: { default: 60, min: 0, max: 1000, step: 5, label: "Score for a perfect dodge" },
  comboWindow: { default: 2.6, min: 0.5, max: 10, step: 0.1, label: "Combo drops after", unit: "s" },
  comboPerCoins: { default: 8, min: 1, max: 40, step: 1, label: "Coins per combo step" },
  comboStepBonus: { default: 0.02, min: 0, max: 0.2, step: 0.005, label: "Score bonus per combo step" },
  comboCap: { default: 40, min: 1, max: 200, step: 1, label: "Combo steps that still count" },
  perfectStreakGoal: { default: 5, min: 2, max: 20, step: 1, label: "Perfect dodges in a row for the dagger bonus" },
  perfectStreakScore: { default: 250, min: 0, max: 2000, step: 10, label: "Dagger streak bonus" },
});

declare module "../../core/events" {
  interface EventMap {
    /** Cleared something by a hair. */
    "skill:nearMiss": { score: number; combo: number };
    /** Got out of a collision course inside the window. */
    "skill:perfect": { score: number; combo: number; streak: number };
    /** Combo changed (0 = it just broke). */
    "combo:change": { combo: number; best: number };
  }
}

const evNear = { score: 0, combo: 0 };
const evPerfect = { score: 0, combo: 0, streak: 0 };
const evCombo = { combo: 0, best: 0 };
const pBox = makeAabb();
const oBox = makeAabb();

export class SkillSystem implements RunSystem {
  readonly id = "skill";
  readonly order = 65;
  /** Current combo steps. */
  combo = 0;
  /** Best combo this run. */
  bestCombo = 0;
  nearMisses = 0;
  perfectDodges = 0;
  dodges = 0;
  /** Longest stretch in metres without touching anything. */
  bestClean = 0;
  /** Consecutive perfect dodges (the dagger pays on a streak). */
  perfectStreak = 0;

  private comboT = 0;
  private coinRun = 0;
  private cleanFrom = 0;
  private lastLaneChangeT = -99;
  private lastJumpT = -99;
  private lastRollT = -99;
  private score: ScoreSystem | undefined;
  private unsubscribe: Array<() => void> = [];

  init(ctx: RunContext): void {
    this.score = ctx.getSystem?.<ScoreSystem>("score");
    const bus = ctx.bus;
    this.unsubscribe.push(
      bus.on("player:laneChange", () => (this.lastLaneChangeT = ctx.state.time)),
      bus.on("player:jump", () => (this.lastJumpT = ctx.state.time)),
      bus.on("player:roll", () => (this.lastRollT = ctx.state.time)),
      bus.on("coin:collect", () => this.onCoin(ctx)),
      // any contact ends the streak and the combo; the run has to be earned again
      bus.on("player:stumble", () => this.breakRun(ctx)),
      bus.on("run:crash", () => this.breakRun(ctx)),
    );
  }

  reset(ctx: RunContext): void {
    this.combo = 0;
    this.bestCombo = 0;
    this.nearMisses = 0;
    this.perfectDodges = 0;
    this.dodges = 0;
    this.bestClean = 0;
    this.perfectStreak = 0;
    this.comboT = 0;
    this.coinRun = 0;
    this.cleanFrom = 0;
    this.lastLaneChangeT = -99;
    this.lastJumpT = -99;
    this.lastRollT = -99;
    if (this.score) this.score.comboBonus = 1;
    void ctx;
  }

  fixedUpdate(ctx: RunContext, dt: number): void {
    const st = ctx.state;
    if (st.mode !== "running" && st.mode !== "intro") return;
    const p = ctx.player;
    p.getHitbox(pBox);
    const hd = PLAYER_HITBOX.depth / 2;
    const horizon = st.distance + Math.max(1, st.speed) * SKILL.threatSeconds;
    const list = ctx.obstacles.active;

    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      if (inst.retired || inst.resolved) continue;
      const type = inst.type;
      // scenery (no real collider) is not something you dodge
      if (!type.rules.solid && !type.rules.jumpable && !type.rules.rollable) continue;
      type.collider(inst, oBox);
      if (oBox.maxY <= oBox.minY) continue;

      const front = inst.s;
      const back = inst.s + inst.length;

      // 1. is it a threat? (in our lane, close enough ahead)
      if (inst.threatT < 0 && front > st.distance && front <= horizon) {
        const x = laneX(p.lane);
        if (x + PLAYER_HITBOX.width / 2 > oBox.minX && x - PLAYER_HITBOX.width / 2 < oBox.maxX) inst.threatT = st.time;
      }

      // 2. while we are alongside it, remember the tightest clearance
      if (front <= st.distance + hd && back >= st.distance - hd) {
        if (inst.reachT < 0) inst.reachT = st.time;
        const lateral = Math.max(oBox.minX - pBox.maxX, pBox.minX - oBox.maxX);
        if (lateral > 0 && lateral < inst.minLateral) inst.minLateral = lateral;
        // only clearance ABOVE counts: rolling under something is a constant gap, not a near miss
        const above = pBox.minY - oBox.maxY;
        if (above >= 0 && above < inst.minVertical && !type.surface) inst.minVertical = above;
      }

      // 3. fully behind us and never hit: score it
      if (back < st.distance - hd) this.resolve(ctx, inst);
    }

    // combo decay
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.setCombo(ctx, 0);
    }
    if (this.score) this.score.comboBonus = 1 + Math.min(this.combo, SKILL.comboCap) * SKILL.comboStepBonus * ctx.rules.comboScoreMul;

    // clean-run streak
    const clean = st.distance - this.cleanFrom;
    if (clean > this.bestClean) this.bestClean = clean;
  }

  private resolve(ctx: RunContext, inst: ObstacleInstance): void {
    inst.resolved = true;
    const wasThreat = inst.threatT >= 0;
    if (!wasThreat) return;
    this.dodges++;
    let score = SKILL.dodgeScore;
    this.bump(ctx);

    const near = inst.minLateral < SKILL.nearLateral || inst.minVertical < SKILL.nearVertical;
    if (near) {
      this.nearMisses++;
      score += SKILL.nearScore;
      evNear.score = SKILL.nearScore;
      evNear.combo = this.combo;
      ctx.bus.emit("skill:nearMiss", evNear);
      this.bump(ctx);
    }

    // perfect: the avoiding action came inside the window before it reached us
    const reach = inst.reachT >= 0 ? inst.reachT : ctx.state.time;
    const last = Math.max(this.lastLaneChangeT, this.lastJumpT, this.lastRollT);
    if (last >= inst.threatT && reach - last <= SKILL.perfectSeconds) {
      this.perfectDodges++;
      this.perfectStreak++;
      score += SKILL.perfectScore;
      evPerfect.score = SKILL.perfectScore;
      evPerfect.combo = this.combo;
      evPerfect.streak = this.perfectStreak;
      ctx.bus.emit("skill:perfect", evPerfect);
      this.bump(ctx);
      // the dagger pays for a run of them
      const goal = SKILL.perfectStreakGoal;
      if (ctx.rules.perfectStreakBonus > 0 && this.perfectStreak > 0 && this.perfectStreak % goal === 0) {
        score += SKILL.perfectStreakScore * ctx.rules.perfectStreakBonus;
      }
    } else if (near) {
      this.perfectStreak = 0;
    }

    this.score?.award(ctx, score);
  }

  private onCoin(ctx: RunContext): void {
    this.coinRun++;
    if (this.coinRun >= SKILL.comboPerCoins) {
      this.coinRun = 0;
      this.bump(ctx);
    } else if (this.combo > 0) {
      this.comboT = SKILL.comboWindow * ctx.rules.comboWindowMul;
    }
  }

  /** One combo step, and the window starts again. */
  private bump(ctx: RunContext): void {
    this.setCombo(ctx, this.combo + 1);
  }

  private setCombo(ctx: RunContext, value: number): void {
    this.combo = Math.max(0, value);
    this.comboT = this.combo > 0 ? SKILL.comboWindow * ctx.rules.comboWindowMul : 0;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    evCombo.combo = this.combo;
    evCombo.best = this.bestCombo;
    ctx.bus.emit("combo:change", evCombo);
  }

  /** A contact: the combo, the perfect streak and the clean run all end. */
  private breakRun(ctx: RunContext): void {
    const st = ctx.state;
    const clean = st.distance - this.cleanFrom;
    if (clean > this.bestClean) this.bestClean = clean;
    this.cleanFrom = st.distance;
    this.perfectStreak = 0;
    this.coinRun = 0;
    if (this.combo > 0) this.setCombo(ctx, 0);
  }

  /** Plain snapshot for the HUD and the debug API. */
  snapshot(): { combo: number; best: number; near: number; perfect: number; dodges: number; clean: number } {
    return { combo: this.combo, best: this.bestCombo, near: this.nearMisses, perfect: this.perfectDodges, dodges: this.dodges, clean: this.bestClean };
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }
}

registerRunSystem(() => new SkillSystem());

