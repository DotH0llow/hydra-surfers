/**
 * BuildSystem — the defensive half of an equipped build.
 *
 * Weapons and armour that change how a hit resolves live here, behind the same `absorbCrash` /
 * `absorbStumble` hooks the mount already uses, so nothing in the collision path needs to know
 * which items exist. Order 57 puts it just after the mount: a rider loses the mount first (it is
 * a consumable the player chose to spend), and only then does armour spend a charge.
 *
 * Every random roll draws from the gameplay stream (`ctx.rng`), never the spawner's, so a bow roll
 * cannot shift the track layout of a seeded run.
 */
import { defineTuning } from "../../core/tuning";
import { registerRunSystem } from "../systems";
import type { ObstacleInstance } from "../obstacles/ObstacleSystem";
import type { PowerupSystem } from "../powerups/PowerupSystem";
import type { RunContext, RunSystem } from "../types";

export const BUILD = defineTuning("build", "Equipment effects", {
  shatterScore: { default: 60, min: 0, max: 500, step: 5, label: "Score for smashing an obstacle" },
  shatterGraceSeconds: { default: 0.35, min: 0, max: 2, step: 0.05, label: "No collisions just after an absorbed hit", unit: "s" },
});

export type AbsorbKind = "smash" | "aegis" | "shield" | "luck" | "stumble";

declare module "../../core/events" {
  interface EventMap {
    /** A build effect swallowed a hit that would otherwise have ended (or dented) the run. */
    "build:absorb": { kind: AbsorbKind; cause: string; left: number };
  }
}

const evAbsorb: { kind: AbsorbKind; cause: string; left: number } = { kind: "shield", cause: "", left: 0 };

export class BuildSystem implements RunSystem {
  readonly id = "build";
  readonly order = 57;
  /** Crashes heavy armour can still swallow. */
  private shields = 0;
  /** Stumbles chainmail can still swallow. */
  private stumbles = 0;
  /** Barricades the hammer can still smash outright. */
  private smashes = 0;
  /** 1 while the horseshoe has not been spent yet. */
  private luck = 0;
  private powerups: PowerupSystem | undefined;

  init(ctx: RunContext): void {
    this.powerups = ctx.getSystem?.<PowerupSystem>("powerups");
  }

  reset(ctx: RunContext): void {
    const r = ctx.rules;
    this.shields = r.shieldCharges;
    this.stumbles = r.stumbleAbsorbs;
    this.smashes = r.breakLowBarriers;
    this.luck = r.luckChance > 0 ? 1 : 0;
  }

  absorbCrash(ctx: RunContext, cause: string): boolean {
    if (cause === "cheat") return false;
    const inst = ctx.lastHit;
    if (inst && inst.type.rules.breakable === true) {
      // the hammer goes through the first barricade of the run without a roll
      if (this.smashes > 0) {
        this.smashes--;
        this.smash(ctx, inst, cause, this.smashes);
        return true;
      }
      if (ctx.rules.breakChance > 0 && ctx.rng.chance(ctx.rules.breakChance)) {
        this.smash(ctx, inst, cause, 0);
        return true;
      }
    }
    // the aegis ward is spent before any permanent equipment charge
    if (this.powerups?.isActive("aegis")) {
      this.powerups.clearOne("aegis");
      this.announce(ctx, "aegis", cause, 0);
      ctx.player.graceT = Math.max(ctx.player.graceT, BUILD.shatterGraceSeconds);
      return true;
    }
    if (this.shields > 0) {
      this.shields--;
      this.announce(ctx, "shield", cause, this.shields);
      ctx.player.graceT = Math.max(ctx.player.graceT, BUILD.shatterGraceSeconds);
      return true;
    }
    if (this.luck > 0 && ctx.rules.luckChance > 0 && ctx.rng.chance(ctx.rules.luckChance)) {
      this.luck = 0;
      this.announce(ctx, "luck", cause, 0);
      ctx.player.graceT = Math.max(ctx.player.graceT, BUILD.shatterGraceSeconds);
      return true;
    }
    return false;
  }

  absorbStumble(ctx: RunContext, cause: string): boolean {
    if (this.stumbles <= 0) return false;
    this.stumbles--;
    this.announce(ctx, "stumble", cause, this.stumbles);
    return true;
  }

  /** What is left of the build's charges, for the HUD and getState(). */
  snapshot(): { shields: number; stumbles: number; smashes: number; luck: number } {
    return { shields: this.shields, stumbles: this.stumbles, smashes: this.smashes, luck: this.luck };
  }

  private smash(ctx: RunContext, inst: ObstacleInstance, cause: string, left: number): void {
    ctx.obstacles.retire(inst);
    ctx.player.graceT = Math.max(ctx.player.graceT, BUILD.shatterGraceSeconds);
    this.announce(ctx, "smash", cause, left);
  }

  private announce(ctx: RunContext, kind: AbsorbKind, cause: string, left: number): void {
    evAbsorb.kind = kind;
    evAbsorb.cause = cause;
    evAbsorb.left = left;
    ctx.bus.emit("build:absorb", evAbsorb);
  }
}

registerRunSystem(() => new BuildSystem());
