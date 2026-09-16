import { describe, expect, it } from "vitest";
import { defaultProfile } from "../../src/core/store";
import { resolveRules } from "../../src/game/rules";
import {
  EQUIPMENT,
  SLOTS,
  buildEffects,
  buildSummary,
  buyEquip,
  equipSlot,
  equippedItem,
  findEquip,
  grantEquip,
  itemLines,
  itemsForSlot,
  ownsEquip,
  starterItems,
} from "../../src/meta/equipment";

describe("meta/equipment", () => {
  it("every item is a trade-off: something gained and something given up", () => {
    for (const item of EQUIPMENT) {
      const { gains, costs } = itemLines(item);
      expect(gains.length, `${item.id} has no upside`).toBeGreaterThan(0);
      expect(costs.length, `${item.id} is strictly better than not equipping it`).toBeGreaterThan(0);
    }
  });

  it("offers a real choice in every slot", () => {
    for (const slot of SLOTS) expect(itemsForSlot(slot).length, slot).toBeGreaterThanOrEqual(3);
    expect(EQUIPMENT.every((i) => SLOTS.includes(i.slot))).toBe(true);
    // ids are unique
    expect(new Set(EQUIPMENT.map((i) => i.id)).size).toBe(EQUIPMENT.length);
  });

  it("starts the player with one item per slot, owned implicitly", () => {
    const p = defaultProfile();
    const starters = starterItems();
    expect(starters).toHaveLength(SLOTS.length);
    for (const id of starters) expect(ownsEquip(p, id)).toBe(true);
    for (const slot of SLOTS) expect(equippedItem(p, slot), slot).not.toBeNull();
    expect(buildSummary(p)).toContain("Espada Curta");
  });

  it("does not let a player equip something they do not own", () => {
    const p = defaultProfile();
    const locked = EQUIPMENT.find((i) => i.source.kind === "season")!;
    expect(ownsEquip(p, locked.id)).toBe(false);
    expect(equipSlot(p, locked.slot, locked.id)).toBe(false);
    expect(grantEquip(p, locked.id)).toBe(true);
    expect(equipSlot(p, locked.slot, locked.id)).toBe(true);
    expect(equippedItem(p, locked.slot)?.id).toBe(locked.id);
    // granting twice is a no-op, not a duplicate
    expect(grantEquip(p, locked.id)).toBe(false);
    expect(p.owned.equipment.filter((i) => i === locked.id)).toHaveLength(1);
  });

  it("refuses to equip an item into the wrong slot, and allows clearing a slot", () => {
    const p = defaultProfile();
    const weapon = itemsForSlot("weapon")[0];
    expect(equipSlot(p, "relic", weapon.id)).toBe(false);
    expect(equipSlot(p, "weapon", "")).toBe(true);
    expect(equippedItem(p, "weapon")).toBeNull();
    expect(equipSlot(p, "weapon", "does.not.exist")).toBe(false);
  });

  it("buys shop items with their own currency and refuses when short", () => {
    const p = defaultProfile();
    const shopItem = EQUIPMENT.find((i) => i.source.kind === "shop")!;
    const source = shopItem.source as { kind: "shop"; price: number; currency: "coins" | "keys" };
    expect(buyEquip(p, shopItem.id)).toBe(false);
    p.currencies[source.currency] = source.price;
    expect(buyEquip(p, shopItem.id)).toBe(true);
    expect(p.currencies[source.currency]).toBe(0);
    expect(ownsEquip(p, shopItem.id)).toBe(true);
    // already owned
    expect(buyEquip(p, shopItem.id)).toBe(false);
    // season/achievement items are not purchasable
    const seasonItem = EQUIPMENT.find((i) => i.source.kind === "season")!;
    p.currencies.coins = 999_999;
    expect(buyEquip(p, seasonItem.id)).toBe(false);
  });

  it("collects the equipped build's effects and keeps a full build inside sane bounds", () => {
    const p = defaultProfile();
    const effects = buildEffects(p);
    expect(effects.length).toBeGreaterThan(0);
    const rules = resolveRules(effects);
    expect(rules.speedMul).toBeLessThanOrEqual(2);
    expect(rules.scoreMul).toBeGreaterThan(0);

    // the greediest coin build available should still be a modest edge, not a different game
    const coinItems = SLOTS.map((slot) =>
      itemsForSlot(slot)
        .slice()
        .sort((a, b) => coinGain(b) - coinGain(a))[0],
    );
    for (const item of coinItems) {
      grantEquip(p, item.id);
      equipSlot(p, item.slot, item.id);
    }
    const greedy = resolveRules(buildEffects(p));
    expect(greedy.coinValue).toBeLessThan(1.6);
  });

  it("finds items by id and ignores unknown ones", () => {
    expect(findEquip(EQUIPMENT[0].id)?.name).toBe(EQUIPMENT[0].name);
    expect(findEquip("nope")).toBeUndefined();
    expect(ownsEquip(defaultProfile(), "nope")).toBe(false);
  });
});

/** How much an item multiplies coin value by (1 = neutral), used to build the greediest loadout. */
function coinGain(item: (typeof EQUIPMENT)[number]): number {
  let mul = 1;
  for (const e of item.effects) {
    if (e.rule === "coinValue" && (e.op ?? "mul") === "mul") mul *= e.value;
  }
  return mul;
}
