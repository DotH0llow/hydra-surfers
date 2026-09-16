/**
 * Power-up registry (PLAN.md §2). Each power-up = {id, label, assetId, duration, hooks}.
 * The foundation ships the four timed built-ins with durations, events and getState reporting;
 * their gameplay effects (jetpack lift + sky coins, higher jumps, coin pull, score x2) are lane B's (piece B6):
 * fill them in with the hooks below or replace a def via registerPowerup (same id).
 */
import { defineTuning } from "../../core/tuning";
import type { RunContext } from "../types";

export const POWERUPS = defineTuning("powerups", "Power-ups", {
  jetpackSeconds: { default: 11.5, min: 1, max: 30, step: 0.5, label: "Jetpack duration", unit: "s" },
  sneakersSeconds: { default: 10, min: 1, max: 30, step: 0.5, label: "Super sneakers duration", unit: "s" },
  magnetSeconds: { default: 10, min: 1, max: 30, step: 0.5, label: "Coin magnet duration", unit: "s" },
  multiplierSeconds: { default: 10, min: 1, max: 30, step: 0.5, label: "Royal blessing duration", unit: "s" },
  aegisSeconds: { default: 18, min: 1, max: 60, step: 0.5, label: "Aegis duration (or until it takes a hit)", unit: "s" },
  hourglassSeconds: { default: 7, min: 1, max: 30, step: 0.5, label: "Hourglass duration", unit: "s" },
});

export interface PowerupDef {
  id: string;
  label: string;
  /** Manifest id of the pickup model/icon. */
  assetId: string;
  /** Seconds, read at activation (so live tuning and the run's rules apply to the next pickup). */
  duration(ctx: RunContext): number;
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

registerPowerup({ id: "jetpack", label: "Asas do Grifo", assetId: "pickup.griffin", duration: () => POWERUPS.jetpackSeconds });
registerPowerup({ id: "sneakers", label: "Botas do Gigante", assetId: "pickup.boots", duration: () => POWERUPS.sneakersSeconds });
registerPowerup({ id: "magnet", label: "Amuleto Magnético", assetId: "pickup.amulet", duration: () => POWERUPS.magnetSeconds });
registerPowerup({ id: "multiplier", label: "Bênção do Rei", assetId: "pickup.blessing", duration: () => POWERUPS.multiplierSeconds });
registerPowerup({ id: "aegis", label: "Égide", assetId: "pickup.aegis", duration: () => POWERUPS.aegisSeconds });
registerPowerup({ id: "hourglass", label: "Ampulheta", assetId: "pickup.hourglass", duration: () => POWERUPS.hourglassSeconds });
