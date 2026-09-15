import { describe, expect, it } from "vitest";
import { defaultProfile } from "../../src/core/store";
import {
  BOARD_PRICE,
  MAX_UPGRADE_LEVEL,
  UPGRADE_COSTS,
  buyBoard,
  buyKey,
  buyUpgrade,
  readUpgrades,
  reviveCost,
  syncUpgrades,
  upgradeCost,
  upgradeLevel,
} from "../../src/meta/upgrades";

describe("meta/upgrades", () => {
  it("buys upgrade levels with coins up to the max", () => {
    const p = defaultProfile();
    expect(buyUpgrade(p, "magnet")).toBe(false);
    p.currencies.coins = UPGRADE_COSTS.reduce((a, b) => a + b, 0);
    for (let i = 0; i < MAX_UPGRADE_LEVEL; i++) expect(buyUpgrade(p, "magnet")).toBe(true);
    expect(p.currencies.coins).toBe(0);
    expect(readUpgrades(p).magnet).toBe(MAX_UPGRADE_LEVEL);
    expect(upgradeCost(MAX_UPGRADE_LEVEL)).toBeNull();
    p.currencies.coins = 1e6;
    expect(buyUpgrade(p, "magnet")).toBe(false);
    syncUpgrades(p);
    expect(upgradeLevel("magnet")).toBe(MAX_UPGRADE_LEVEL);
    expect(upgradeLevel("jetpack")).toBe(0);
  });

  it("sanitises stored levels", () => {
    const p = defaultProfile();
    p.ext.upgrades = { magnet: 99, jetpack: -3, sneakers: "2" };
    expect(readUpgrades(p)).toEqual({ jetpack: 0, sneakers: 2, magnet: MAX_UPGRADE_LEVEL, multiplier: 0 });
  });

  it("sells boards and keys, and doubles the revive cost each time", () => {
    const p = defaultProfile();
    const boards = p.currencies.boards;
    expect(buyBoard(p)).toBe(false);
    p.currencies.coins = BOARD_PRICE;
    expect(buyBoard(p)).toBe(true);
    expect(p.currencies.boards).toBe(boards + 1);
    expect(buyKey(p)).toBe(false);
    expect([0, 1, 2].map(reviveCost)).toEqual([1, 2, 4]);
  });
});
