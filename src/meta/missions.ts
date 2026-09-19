/**
 * Missions & score multiplier (piece C4, lean). Three missions at a time, drawn deterministically from a
 * pool for the current set number; goals grow with the set. Completing all three advances the set,
 * which raises the permanent score multiplier by +1 (max +29).
 *
 * Pure functions over Profile (unit-tested) plus RunStats, the per-run counters the App collects
 * from game events.
 */
import { Rng, hash32 } from "../core/rng";
import type { Profile } from "../core/store";
import { emptyRunStats, type RunStats } from "./stats";

/** The counters a guild contract can ask for: a subset of the shared run stats. */
export type MissionStat = "coins" | "jumps" | "rolls" | "laneChanges" | "distance" | "score" | "mounts" | "powerups" | "runs";

export interface MissionDef {
  id: string;
  stat: MissionStat;
  /** Best single run counts (instead of the running total across runs). */
  perRun: boolean;
  base: number;
  step: number;
  label(goal: number): string;
}

export const MISSION_POOL: readonly MissionDef[] = [
  { id: "coins-total", stat: "coins", perRun: false, base: 150, step: 100, label: (g) => `Colete ${g} moedas` },
  { id: "coins-run", stat: "coins", perRun: true, base: 60, step: 30, label: (g) => `Colete ${g} moedas numa corrida` },
  { id: "jumps", stat: "jumps", perRun: false, base: 25, step: 15, label: (g) => `Salte ${g} vezes` },
  { id: "rolls", stat: "rolls", perRun: false, base: 20, step: 12, label: (g) => `Role ${g} vezes` },
  { id: "lanes", stat: "laneChanges", perRun: false, base: 60, step: 40, label: (g) => `Troque de pista ${g} vezes` },
  { id: "distance-run", stat: "distance", perRun: true, base: 500, step: 250, label: (g) => `Corra ${g} m numa corrida` },
  { id: "score-run", stat: "score", perRun: true, base: 1500, step: 1200, label: (g) => `Faça ${g} pontos numa corrida` },
  { id: "mounts", stat: "mounts", perRun: false, base: 1, step: 1, label: (g) => (g === 1 ? "Use uma montaria" : `Use ${g} montarias`) },
  { id: "powerups", stat: "powerups", perRun: false, base: 3, step: 2, label: (g) => `Colete ${g} poderes` },
  { id: "runs", stat: "runs", perRun: false, base: 3, step: 2, label: (g) => `Jogue ${g} corridas` },
];

export const MISSIONS_PER_SET = 3;
export const MAX_MULTIPLIER_BONUS = 29;

export type { RunStats };
export { emptyRunStats };

export interface ActiveMission {
  /** Unique per set: `<set>:<id>`. */
  key: string;
  def: MissionDef;
  goal: number;
  label: string;
  progress: number;
  done: boolean;
}

declare module "../core/events" {
  interface EventMap {
    /** A mission goal was reached during a run (progress is saved when the run ends). */
    "mission:complete": { key: string; label: string };
  }
}

/** The three missions of `set` (1-based), with distinct stats. */
export function missionSet(set: number): Array<{ key: string; def: MissionDef; goal: number }> {
  const n = Math.max(1, Math.floor(set));
  const rng = new Rng(hash32(Math.imul(n, 0x9e3779b1) ^ 0x51ab));
  const pool = MISSION_POOL.slice();
  const out: Array<{ key: string; def: MissionDef; goal: number }> = [];
  const stats = new Set<MissionStat>();
  while (out.length < MISSIONS_PER_SET && pool.length) {
    const def = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    if (stats.has(def.stat)) continue;
    stats.add(def.stat);
    out.push({ key: `${n}:${def.id}`, def, goal: def.base + def.step * (n - 1) });
  }
  return out;
}

export function activeMissions(p: Readonly<Profile>): ActiveMission[] {
  return missionSet(p.missions.set).map(({ key, def, goal }) => {
    const progress = Math.max(0, Number(p.missions.progress[key]) || 0);
    const done = p.missions.completed.includes(key) || progress >= goal;
    return { key, def, goal, label: def.label(goal), progress: Math.min(goal, progress), done };
  });
}

/** Progress a mission would have if the current run ended now. */
export function liveProgress(m: ActiveMission, run: RunStats): number {
  const v = run[m.def.stat];
  return m.def.perRun ? Math.max(m.progress, v) : m.progress + v;
}

export function multiplierBonus(p: Readonly<Profile>): number {
  return Math.min(MAX_MULTIPLIER_BONUS, Math.max(0, p.missions.set - 1));
}

export interface MissionOutcome {
  /** Labels of missions completed by this run. */
  completed: string[];
  /** All three done: the set advanced and the multiplier went up. */
  setAdvanced: boolean;
  multiplierBonus: number;
}

/** Applies one finished run to mission progress. Mutates `p` (call inside ProfileStore.update). */
export function applyRunMissions(p: Profile, run: RunStats): MissionOutcome {
  const completed: string[] = [];
  for (const m of activeMissions(p)) {
    if (m.done) continue;
    const next = liveProgress(m, run);
    p.missions.progress[m.key] = next;
    if (next >= m.goal) {
      p.missions.completed.push(m.key);
      completed.push(m.label);
    }
  }
  const setAdvanced = activeMissions(p).every((m) => m.done);
  if (setAdvanced) {
    p.missions.set += 1;
    p.missions.progress = {};
    p.missions.completed = [];
  }
  return { completed, setAdvanced, multiplierBonus: multiplierBonus(p) };
}
