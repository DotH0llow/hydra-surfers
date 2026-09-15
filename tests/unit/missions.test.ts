import { describe, expect, it } from "vitest";
import { defaultProfile } from "../../src/core/store";
import { MISSIONS_PER_SET, activeMissions, applyRunMissions, emptyRunStats, missionSet, multiplierBonus } from "../../src/meta/missions";

describe("meta/missions", () => {
  it("draws three missions with distinct stats per set, deterministically, with goals growing per set", () => {
    expect(missionSet(1)).toEqual(missionSet(1));
    for (const n of [1, 2, 7, 30]) {
      const set = missionSet(n);
      expect(set).toHaveLength(MISSIONS_PER_SET);
      expect(new Set(set.map((m) => m.def.stat)).size).toBe(MISSIONS_PER_SET);
      for (const m of set) expect(m.goal).toBe(m.def.base + m.def.step * (n - 1));
    }
  });

  it("adds totals across runs but keeps only the best single run for per-run missions", () => {
    // a set with at least one per-run and one cumulative mission, all goals > 1
    let n = 1;
    while (n < 200) {
      const s = missionSet(n);
      if (s.some((m) => m.def.perRun) && s.some((m) => !m.def.perRun) && s.every((m) => m.goal > 2)) break;
      n++;
    }
    const p = defaultProfile();
    p.missions.set = n;
    const run = emptyRunStats();
    for (const m of activeMissions(p)) run[m.def.stat] = Math.ceil(m.goal * 0.6);
    const first = applyRunMissions(p, run);
    expect(first.completed).toEqual([]);
    const second = applyRunMissions(p, run);
    expect(second.setAdvanced).toBe(false);
    for (const m of activeMissions(p)) expect(m.done).toBe(!m.def.perRun);
  });

  it("completing all three advances the set and raises the score multiplier", () => {
    const p = defaultProfile();
    expect(multiplierBonus(p)).toBe(0);
    const run = emptyRunStats();
    for (const m of activeMissions(p)) run[m.def.stat] = m.goal;
    const out = applyRunMissions(p, run);
    expect(out.completed).toHaveLength(3);
    expect(out.setAdvanced).toBe(true);
    expect(out.multiplierBonus).toBe(1);
    expect(p.missions.set).toBe(2);
    expect(p.missions.completed).toEqual([]);
    expect(activeMissions(p).every((m) => !m.done && m.progress === 0)).toBe(true);
  });
});
