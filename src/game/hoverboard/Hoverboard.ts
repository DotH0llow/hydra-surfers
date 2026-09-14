/**
 * Hoverboard (PLAN.md §2): activated by the `hoverboard` action (double-tap / E / __game.input),
 * rides for a tuned duration, and absorbs one crash — the board breaks and grants brief invulnerability.
 * Foundation version: timers, crash absorption, events, cheat, getState. Board visuals, profile board
 * counts and HUD are lane B/C's (pieces B7, C1). Extend additively.
 */
import { registerCheat } from "../../core/cheats";
import { defineTuning } from "../../core/tuning";
import { registerRunSystem } from "../systems";
import type { RunContext, RunSystem } from "../types";

export const HOVERBOARD = defineTuning("hoverboard", "Hoverboard", {
  durationSeconds: { default: 30, min: 1, max: 120, step: 1, label: "Ride duration", unit: "s" },
  breakInvulnSeconds: { default: 1, min: 0, max: 5, step: 0.05, label: "Invulnerability after the board breaks", unit: "s" },
});

declare module "../../core/events" {
  interface EventMap {
    "hoverboard:start": { duration: number };
    "hoverboard:end": { reason: "expired" | "break"; cause: string };
  }
}

export interface HoverboardSnapshot {
  active: boolean;
  remaining: number;
  invulnerable: number;
}

const evStart = { duration: 0 };
const evEnd: { reason: "expired" | "break"; cause: string } = { reason: "expired", cause: "" };

export class HoverboardSystem implements RunSystem {
  readonly id = "hoverboard";
  readonly order = 56;
  active = false;
  remaining = 0;
  invulnerable = 0;
  private ctx: RunContext | null = null;

  init(ctx: RunContext): void {
    this.ctx = ctx;
    ctx.bus.on("run:action", (e) => {
      if (e.action === "hoverboard") this.activate();
    });
    registerCheat({ name: "hoverboard", label: "Activate hoverboard", group: "Hoverboard", run: () => this.activate() });
  }

  activate(): boolean {
    const ctx = this.ctx;
    if (!ctx || this.active) return false;
    const mode = ctx.state.mode;
    if (mode !== "running" && mode !== "intro") return false;
    this.active = true;
    this.remaining = HOVERBOARD.durationSeconds;
    evStart.duration = this.remaining;
    ctx.bus.emit("hoverboard:start", evStart);
    return true;
  }

  /** Run.crash asks every system; true = crash absorbed. Cheat crashes are never absorbed. */
  absorbCrash(ctx: RunContext, cause: string): boolean {
    if (cause === "cheat") return false;
    if (this.invulnerable > 0) return true;
    if (!this.active) return false;
    this.active = false;
    this.remaining = 0;
    this.invulnerable = HOVERBOARD.breakInvulnSeconds;
    evEnd.reason = "break";
    evEnd.cause = cause;
    ctx.bus.emit("hoverboard:end", evEnd);
    return true;
  }

  reset(ctx: RunContext): void {
    this.ctx = ctx;
    this.active = false;
    this.remaining = 0;
    this.invulnerable = 0;
  }

  fixedUpdate(ctx: RunContext, dt: number): void {
    const mode = ctx.state.mode;
    if (mode !== "running" && mode !== "intro") return;
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (!this.active) return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.active = false;
      this.remaining = 0;
      evEnd.reason = "expired";
      evEnd.cause = "";
      ctx.bus.emit("hoverboard:end", evEnd);
    }
  }

  snapshot(): HoverboardSnapshot {
    return { active: this.active, remaining: Math.max(0, this.remaining), invulnerable: this.invulnerable };
  }
}

registerRunSystem(() => new HoverboardSystem());
