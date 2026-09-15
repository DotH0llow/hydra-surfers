import { describe, expect, it } from "vitest";
import { defaultProfile } from "../../src/core/store";
import { BOARDS, CHARACTERS, DEFAULT_BOARD, DEFAULT_CHARACTER, buyItem, equipItem, equippedId, owns } from "../../src/meta/catalog";

describe("meta/catalog", () => {
  it("free items are always owned and equipped by default", () => {
    const p = defaultProfile();
    expect(owns(p, "character", DEFAULT_CHARACTER)).toBe(true);
    expect(owns(p, "board", DEFAULT_BOARD)).toBe(true);
    expect(equippedId(p, "character")).toBe(DEFAULT_CHARACTER);
    expect(equippedId(p, "board")).toBe(DEFAULT_BOARD);
  });

  it("buys with the item's currency, then equips; unaffordable or unowned items are refused", () => {
    const p = defaultProfile();
    const coinChar = CHARACTERS.find((c) => c.price > 0 && c.currency === "coins")!;
    const keyBoard = BOARDS.find((b) => b.currency === "keys")!;
    expect(buyItem(p, "character", coinChar.id)).toBe(false);
    expect(equipItem(p, "character", coinChar.id)).toBe(false);
    p.currencies.coins = coinChar.price;
    expect(buyItem(p, "character", coinChar.id)).toBe(true);
    expect(p.currencies.coins).toBe(0);
    expect(buyItem(p, "character", coinChar.id)).toBe(false); // already owned
    expect(equipItem(p, "character", coinChar.id)).toBe(true);
    expect(equippedId(p, "character")).toBe(coinChar.id);

    p.currencies.keys = keyBoard.price;
    expect(buyItem(p, "board", keyBoard.id)).toBe(true);
    expect(p.currencies.keys).toBe(0);
    expect(p.owned.boards).toContain(keyBoard.id);
  });

  it("falls back to the default when the stored equipped id is unknown", () => {
    const p = defaultProfile();
    p.equipped.board = "gear.nope";
    expect(equippedId(p, "board")).toBe(DEFAULT_BOARD);
  });
});
