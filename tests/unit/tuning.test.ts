import { describe, expect, it, vi } from "vitest";
import { defineTuning, tuning } from "../../src/core/tuning";

describe("tuning registry", () => {
  it("registers a group and exposes live values", () => {
    const T = defineTuning("tTest", "Test group", {
      a: { default: 2, min: 0, max: 10, step: 0.5, label: "A", unit: "m" },
      b: { default: -1, min: -5, max: 5, step: 1, label: "B" },
    });
    expect(T.a).toBe(2);
    expect(tuning.has("tTest.a")).toBe(true);
    expect(tuning.get("tTest.b")).toBe(-1);
    const entry = tuning.list().find((e) => e.path === "tTest.a")!;
    expect(entry).toMatchObject({ group: "tTest", groupLabel: "Test group", key: "a", min: 0, max: 10, step: 0.5, unit: "m" });
    expect(tuning.groups()).toContain("tTest");
  });

  it("set() updates the same object in place, clamps, and notifies", () => {
    const T = defineTuning("tSet", "Set", { v: { default: 1, min: 0, max: 3, step: 0.1, label: "V" } });
    const seen: Array<[string, number]> = [];
    const off = tuning.subscribe((p, v) => seen.push([p, v]));
    expect(tuning.set("tSet.v", 2.5)).toBe(true);
    expect(T.v).toBe(2.5);
    tuning.set("tSet.v", 99);
    expect(T.v).toBe(3);
    tuning.set("tSet.v", -4);
    expect(T.v).toBe(0);
    tuning.set("tSet.v", 0); // unchanged → no notification
    off();
    tuning.set("tSet.v", 1);
    expect(seen).toEqual([
      ["tSet.v", 2.5],
      ["tSet.v", 3],
      ["tSet.v", 0],
    ]);
  });

  it("rejects NaN / non-numbers", () => {
    const T = defineTuning("tNaN", "NaN", { v: { default: 1, min: 0, max: 3, step: 0.1, label: "V" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(tuning.set("tNaN.v", Number.NaN)).toBe(false);
    expect(tuning.set("tNaN.v", "2" as unknown as number)).toBe(false);
    expect(T.v).toBe(1);
    warn.mockRestore();
  });

  it("keeps unknown paths pending and applies them on registration (presets before modules load)", () => {
    expect(tuning.set("tLate.v", 7)).toBe(false);
    expect(tuning.get("tLate.v")).toBe(7);
    const T = defineTuning("tLate", "Late", { v: { default: 1, min: 0, max: 10, step: 1, label: "V" } });
    expect(T.v).toBe(7);
  });

  it("reset, snapshot, overrides and load round-trip", () => {
    const T = defineTuning("tPreset", "Preset", {
      x: { default: 1, min: 0, max: 10, step: 1, label: "X" },
      y: { default: 2, min: 0, max: 10, step: 1, label: "Y" },
    });
    tuning.set("tPreset.x", 5);
    expect(tuning.snapshot()["tPreset.x"]).toBe(5);
    const ov = tuning.overrides();
    expect(ov["tPreset.x"]).toBe(5);
    expect("tPreset.y" in ov).toBe(false);
    tuning.reset("tPreset.x");
    expect(T.x).toBe(1);
    expect(tuning.load({ "tPreset.x": 4, "tPreset.y": 6, "nope.z": 1 })).toBe(2);
    expect([T.x, T.y]).toEqual([4, 6]);
    tuning.reset();
    expect([T.x, T.y]).toEqual([1, 2]);
  });

  it("ignores duplicate registrations and rejects dotted group names", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const A = defineTuning("tDup", "Dup", { v: { default: 1, min: 0, max: 5, step: 1, label: "first" } });
    const B = defineTuning("tDup", "Dup", { v: { default: 3, min: 0, max: 5, step: 1, label: "second" } });
    expect(A).toBe(B);
    expect(A.v).toBe(1);
    expect(tuning.list().filter((e) => e.path === "tDup.v")).toHaveLength(1);
    expect(() => defineTuning("a.b", "bad", {})).toThrow();
    warn.mockRestore();
  });

  it("every real game tuning entry has a sane schema", async () => {
    await import("../../src/game/Run");
    await import("../../src/App");
    const list = tuning.list().filter((e) => !e.group.startsWith("t"));
    expect(list.length).toBeGreaterThan(60);
    for (const e of list) {
      expect(e.min, e.path).toBeLessThanOrEqual(e.default);
      expect(e.default, e.path).toBeLessThanOrEqual(e.max);
      expect(e.step, e.path).toBeGreaterThan(0);
      expect(e.label.length, e.path).toBeGreaterThan(0);
    }
  }, 60_000);
});
