import { describe, expect, it } from "vitest";
import { applyEffects, clampRules, defaultRules, describeEffect, describeEffects, isEffectPositive, resolveRules, type Effect } from "../../src/game/rules";

describe("game/rules", () => {
  it("defaults are neutral: multipliers 1, counters 0", () => {
    const r = defaultRules();
    expect(r.scoreMul).toBe(1);
    expect(r.coinValue).toBe(1);
    expect(r.powerupDurationMul).toBe(1);
    expect(r.shieldCharges).toBe(0);
    expect(r.breakChance).toBe(0);
    expect(r.timeLimitSeconds).toBe(0);
    expect(r.mountAllowed).toBe(1);
    expect(r.revivesAllowed).toBe(3);
  });

  it("stacks multipliers multiplicatively, adds add-ops and lets set override", () => {
    const r = applyEffects(defaultRules(), [
      { rule: "coinValue", value: 1.1 },
      { rule: "coinValue", value: 1.1 },
      { rule: "shieldCharges", op: "add", value: 1 },
      { rule: "shieldCharges", op: "add", value: 1 },
      { rule: "revivesAllowed", op: "set", value: 0 },
    ]);
    // two +10% items give +21%, never a flat +20%
    expect(r.coinValue).toBeCloseTo(1.21, 9);
    expect(r.shieldCharges).toBe(2);
    expect(r.revivesAllowed).toBe(0);
  });

  it("a later multiplier cannot revive something a mutator switched off", () => {
    const r = resolveRules([{ rule: "mountAllowed", op: "set", value: 0 }], [{ rule: "mountAllowed", value: 4 }]);
    expect(r.mountAllowed).toBe(0);
  });

  it("clamps stacked effects into playable bounds", () => {
    const silly: Effect[] = [
      { rule: "speedMul", value: 50 },
      { rule: "jumpHeightMul", value: 0.01 },
      { rule: "magnetDurationMul", value: -3 },
      { rule: "breakChance", op: "add", value: 5 },
      { rule: "revivesAllowed", op: "add", value: 99 },
      { rule: "scoreMul", value: -2 },
    ];
    const r = clampRules(applyEffects(defaultRules(), silly));
    expect(r.speedMul).toBeLessThanOrEqual(2);
    expect(r.jumpHeightMul).toBeGreaterThanOrEqual(0.6);
    expect(r.magnetDurationMul).toBeGreaterThanOrEqual(0.25);
    expect(r.breakChance).toBe(1);
    expect(r.revivesAllowed).toBe(3);
    expect(r.scoreMul).toBeGreaterThanOrEqual(0);
  });

  it("resolveRules composes several sources in order and clamps the result", () => {
    const mutators: Effect[] = [{ rule: "scoreMul", value: 1.25 }];
    const build: Effect[] = [{ rule: "scoreMul", value: 0.95 }, { rule: "coinValue", value: 1.18 }];
    const r = resolveRules(mutators, build, undefined);
    expect(r.scoreMul).toBeCloseTo(1.25 * 0.95, 9);
    expect(r.coinValue).toBeCloseTo(1.18, 9);
  });

  it("ignores unknown ops gracefully and treats a missing op as mul", () => {
    const r = applyEffects(defaultRules(), [{ rule: "coinValue", value: 2 }]);
    expect(r.coinValue).toBe(2);
  });

  it("describes effects in pt-BR with the right sign, dropping no-ops", () => {
    expect(describeEffect({ rule: "coinValue", value: 1.15 })).toBe("+15% moedas");
    expect(describeEffect({ rule: "scoreMul", value: 0.95 })).toBe("−5% pontos");
    expect(describeEffect({ rule: "shieldCharges", op: "add", value: 1 })).toBe("+1 proteção contra queda");
    expect(describeEffect({ rule: "mountAllowed", op: "set", value: 0 })).toBe("sem montaria");
    expect(describeEffect({ rule: "coinValue", value: 1 })).toBe("");
    expect(describeEffects([{ rule: "coinValue", value: 1 }, { rule: "scoreMul", value: 1.1 }])).toEqual(["+10% pontos"]);
  });

  it("knows which side of a trade-off an effect is on, including inverted rules", () => {
    expect(isEffectPositive({ rule: "coinValue", value: 1.15 })).toBe(true);
    expect(isEffectPositive({ rule: "coinValue", value: 0.9 })).toBe(false);
    // going faster is a cost, not a perk: heavy armour trades protection for speed
    expect(isEffectPositive({ rule: "speedMul", value: 1.08 })).toBe(false);
    expect(isEffectPositive({ rule: "startDifficulty", op: "set", value: 0.5 })).toBe(false);
  });
});
