/**
 * Power-up registry (PLAN.md §2). Each power-up = {id, label, assetId, duration, hooks}.
 * The foundation ships the four timed built-ins with durations, events and getState reporting;
 * their gameplay effects (jetpack lift + sky coins, higher jumps, coin pull, score x2) are lane B's (piece B6):
 * fill them in with the hooks below or replace a def via registerPowerup (same id).
 */
import { defineTuning } from "../../core/tuning";
import type { RunContext } from "../types";

export const POWERUPS = defineTuning("powerups", "Power-ups", {
  jetpackSeconds: { default: 8, min: 1, max: 30, step: 0.5, label: "Jetpack duration", unit: "s" },
  sneakersSeconds: { default: 10, min: 1, max: 30, step: 0.5, label: "Super sneakers duration", unit: "s" },
  magnetSeconds: { default: 10, min: 1, max: 30, step: 0.5, label: "Coin magnet duration", unit: "s" },
  multiplierSeconds: { default: 10, min: 1, max: 30, step: 0.5, label: "2x multiplier duration", unit: "s" },
});

export interface PowerupDef {
  id: string;
  label: string;
  /** Manifest id of the pickup model/icon. */
  assetId: string;
  /** Seconds, read at activation (so live tuning applies to the next pickup). */
  duration(): number;
  /** First activation (not called when an active power-up is refreshed). */
  onStart?(ctx: RunContext): void;
  /** Every fixed tick while active. Must not allocate. */
  onTick?(ctx: RunContext, dt: number, remaining: number): void;
  /** Expired or cleared (run reset). */
  onEnd?(ctx: RunContext): void;
}

const defs = new Map<string, PowerupDef>();

export function registerPowerup(def: PowerupDef): void {
  defs.set(def.id, def);
}

export function getPowerup(id: string): PowerupDef | undefined {
  return defs.get(id);
}

export function listPowerups(): PowerupDef[] {
  return [...defs.values()];
}

registerPowerup({ id: "jetpack", label: "Jetpack", assetId: "pickup.jetpack", duration: () => POWERUPS.jetpackSeconds });
registerPowerup({ id: "sneakers", label: "Super sneakers", assetId: "pickup.sneakers", duration: () => POWERUPS.sneakersSeconds });
registerPowerup({ id: "magnet", label: "Coin magnet", assetId: "pickup.magnet", duration: () => POWERUPS.magnetSeconds });
registerPowerup({ id: "multiplier", label: "2x multiplier", assetId: "pickup.multiplier", duration: () => POWERUPS.multiplierSeconds });
