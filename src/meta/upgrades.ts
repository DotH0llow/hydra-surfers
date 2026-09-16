/**
 * Shop economy (piece C5, lean): power-up duration upgrades, hoverboards, keys and revive pricing.
 * Pure functions over Profile (call inside ProfileStore.update) plus a module-level mirror of the
 * upgrade levels that game code reads on the hot path (`upgradeLevel`), synced by the App.
 */
import type { Profile } from "../core/store";

export const UPGRADE_IDS = ["jetpack", "sneakers", "magnet", "multiplier"] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

export const MAX_UPGRADE_LEVEL = 5;
/** Coins for going from level n to n+1. */
export const UPGRADE_COSTS: readonly number[] = [500, 1200, 2500, 5000, 10000];
export const MOUNT_PRICE = 300;
export const KEY_PRICE = 2000;
/** Revives allowed per run; each one costs twice the previous (1, 2, 4 keys). */
export const MAX_REVIVES = 3;

const levels: Record<string, number> = {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readUpgrades(p: Readonly<Profile>): Record<UpgradeId, number> {
  const raw = isObj(p.ext.upgrades) ? p.ext.upgrades : {};
  const out = {} as Record<UpgradeId, number>;
  for (const id of UPGRADE_IDS) {
    const v = Math.floor(Number(raw[id]) || 0);
    out[id] = Math.min(MAX_UPGRADE_LEVEL, Math.max(0, v));
  }
  return out;
}

/** Mirrors the profile's upgrade levels for `upgradeLevel` (call after load and after every purchase). */
export function syncUpgrades(p: Readonly<Profile>): void {
  Object.assign(levels, readUpgrades(p));
}

export function upgradeLevel(id: string): number {
  return levels[id] ?? 0;
}

/** Cost of the next level, or null when maxed. */
export function upgradeCost(level: number): number | null {
  return level >= MAX_UPGRADE_LEVEL ? null : (UPGRADE_COSTS[level] ?? null);
}

function spend(p: Profile, coins: number): boolean {
  if (p.currencies.coins < coins) return false;
  p.currencies.coins -= coins;
  return true;
}

export function buyUpgrade(p: Profile, id: UpgradeId): boolean {
  const current = readUpgrades(p);
  const cost = upgradeCost(current[id]);
  if (cost === null || !spend(p, cost)) return false;
  p.ext.upgrades = { ...current, [id]: current[id] + 1 };
  return true;
}

export function buyMount(p: Profile): boolean {
  if (!spend(p, MOUNT_PRICE)) return false;
  p.currencies.mounts += 1;
  return true;
}

export function buyKey(p: Profile): boolean {
  if (!spend(p, KEY_PRICE)) return false;
  p.currencies.keys += 1;
  return true;
}

/** Keys needed for the next revive after `revivesUsed` revives this run. */
export function reviveCost(revivesUsed: number): number {
  return 2 ** Math.max(0, revivesUsed);
}
