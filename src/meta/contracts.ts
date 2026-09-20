/**
 * Contracts — the board of jobs in the tavern (daily, weekly and special).
 *
 * Everyone in the group gets the SAME daily contracts, drawn deterministically from the day index,
 * because half the fun of a private league is comparing the same job. Weekly contracts work the
 * same way from the week index.
 *
 * Catch-up is built in: daily contracts stay claimable for `CONTRACT_GRACE_DAYS`, so missing a day
 * costs a player nothing but time. Nothing here expires progress that was already earned.
 *
 * A contract is data over the counters in stats.ts — adding one never means new plumbing.
 */
import { Rng, hash32 } from "../core/rng";
import type { Profile } from "../core/store";
import { dayIndex, dayKey, dayStart, weekIndex, weekKey } from "../shared/calendar";
import { CONTRACT_GRACE_DAYS, XP, type Reward } from "../shared/content/season";
import type { RunStat, RunSummary } from "./stats";

export type ContractScope = "daily" | "weekly";

export interface ContractDef {
  id: string;
  stat: RunStat;
  /** Best single run counts, instead of the running total across runs. */
  perRun: boolean;
  /** Base goal; weekly contracts multiply it (see SCOPE). */
  base: number;
  label(goal: number): string;
  /** Extra condition on the run for this to count at all. */
  requires?: ContractCondition;
}

export interface ContractCondition {
  /** Only runs that crossed this region. */
  biome?: string;
  /** Only runs where no power-up was collected. */
  noPowerups?: boolean;
  /** Only runs on this board ("daily", "weekly", "season"). */
  board?: string;
  /** Only runs with this equipment id worn. */
  equipment?: string;
}

/** Pool for both scopes; weekly picks harder, longer jobs from the same list. */
export const CONTRACT_POOL: readonly ContractDef[] = [
  { id: "coins", stat: "coins", perRun: false, base: 300, label: (g) => `Colete ${g} moedas` },
  { id: "coins-run", stat: "coins", perRun: true, base: 120, label: (g) => `Colete ${g} moedas numa só corrida` },
  { id: "distance", stat: "distance", perRun: false, base: 2000, label: (g) => `Corra ${g} m` },
  { id: "distance-run", stat: "distance", perRun: true, base: 900, label: (g) => `Alcance ${g} m numa só corrida` },
  { id: "powerups", stat: "powerups", perRun: false, base: 3, label: (g) => `Use ${g} poderes` },
  { id: "obstacles", stat: "obstacles", perRun: false, base: 40, label: (g) => `Desvie de ${g} obstáculos` },
  { id: "jumps", stat: "jumps", perRun: false, base: 25, label: (g) => `Salte ${g} vezes` },
  { id: "rolls", stat: "rolls", perRun: false, base: 20, label: (g) => `Role ${g} vezes` },
  { id: "clean", stat: "cleanDistance", perRun: true, base: 500, label: (g) => `Corra ${g} m sem encostar em nada` },
  { id: "near", stat: "nearMisses", perRun: false, base: 12, label: (g) => `Passe raspando ${g} vezes` },
  { id: "perfect", stat: "perfectDodges", perRun: false, base: 6, label: (g) => `Faça ${g} esquivas perfeitas` },
  { id: "combo", stat: "maxCombo", perRun: true, base: 20, label: (g) => `Chegue a um combo de ${g}` },
  { id: "score-run", stat: "score", perRun: true, base: 4000, label: (g) => `Faça ${g} pontos numa só corrida` },
  { id: "runs", stat: "runs", perRun: false, base: 4, label: (g) => `Complete ${g} corridas` },
  { id: "mines", stat: "runs", perRun: false, base: 1, label: () => "Chegue às Minas Profundas", requires: { biome: "mines" } },
  { id: "cemetery", stat: "runs", perRun: false, base: 1, label: () => "Chegue ao Cemitério Antigo", requires: { biome: "cemetery" } },
  { id: "purist", stat: "distance", perRun: true, base: 800, label: (g) => `Corra ${g} m sem usar nenhum poder`, requires: { noPowerups: true } },
  { id: "daily-run", stat: "runs", perRun: false, base: 1, label: () => "Corra a Corrida do Dia", requires: { board: "daily" } },
  { id: "weekly-run", stat: "runs", perRun: false, base: 1, label: () => "Encare o Desafio Semanal", requires: { board: "weekly" } },
  { id: "score-total", stat: "score", perRun: false, base: 9000, label: (g) => `Some ${g} pontos somando suas corridas` },
];

const SCOPE = {
  daily: { count: 3, goalScale: 1, xp: XP.contractDaily, coins: 220 },
  weekly: { count: 4, goalScale: 4.5, xp: XP.contractWeekly, coins: 900 },
} as const;

export interface ActiveContract {
  /** Unique storage key: `d:2026-09-15:coins` or `w:2026-W38:distance`. */
  key: string;
  scope: ContractScope;
  def: ContractDef;
  goal: number;
  label: string;
  progress: number;
  done: boolean;
  claimed: boolean;
  reward: Reward;
  /** Period key this belongs to, for grouping in the UI. */
  period: string;
  /** Local day index it expires after (daily only; weekly uses the week). */
  expiresDay: number;
}

/** Deterministic draw of `count` distinct contracts for a period. */
function draw(salt: number, count: number): ContractDef[] {
  const rng = new Rng(hash32(salt));
  const pool = CONTRACT_POOL.slice();
  const out: ContractDef[] = [];
  const stats = new Set<RunStat>();
  while (out.length < count && pool.length) {
    const def = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    // keep the set varied: at most one job per counter
    if (stats.has(def.stat) && rng.chance(0.85)) continue;
    stats.add(def.stat);
    out.push(def);
  }
  return out;
}

function goalFor(def: ContractDef, scope: ContractScope): number {
  const scale = SCOPE[scope].goalScale;
  // jobs that ask to reach something once are not scaled by scope
  if (def.base === 1) return 1;
  const raw = def.base * (def.perRun ? Math.min(2, scale) : scale);
  return Math.round(raw / 10) * 10 || 1;
}

function rewardFor(scope: ContractScope): Reward {
  return { kind: "coins", amount: SCOPE[scope].coins };
}

/** XP a completed contract of this scope is worth. */
export function contractXp(scope: ContractScope): number {
  return SCOPE[scope].xp;
}

function build(p: Readonly<Profile>, scope: ContractScope, period: string, salt: number, expiresDay: number): ActiveContract[] {
  return draw(salt, SCOPE[scope].count).map((def) => {
    const goal = goalFor(def, scope);
    const key = `${scope === "daily" ? "d" : "w"}:${period}:${def.id}`;
    const progress = Math.max(0, Number(p.contracts.progress[key]) || 0);
    return {
      key,
      scope,
      def,
      goal,
      label: def.label(goal),
      progress: Math.min(goal, progress),
      done: progress >= goal,
      claimed: p.contracts.claimed.includes(key),
      reward: rewardFor(scope),
      period,
      expiresDay,
    };
  });
}

/** The daily contracts of one local day. */
export function dailyContracts(p: Readonly<Profile>, dayIdx: number): ActiveContract[] {
  return build(p, "daily", dayKey(dayStart(dayIdx)), Math.imul(dayIdx, 0x9e3779b1) ^ 0xda11, dayIdx + CONTRACT_GRACE_DAYS);
}

/** The weekly contracts of one week. */
export function weeklyContracts(p: Readonly<Profile>, now: number): ActiveContract[] {
  const week = weekIndex(now);
  return build(p, "weekly", weekKey(now), Math.imul(week, 0x85ebca6b) ^ 0x77ee, dayIndex(now) + 7);
}

/**
 * Everything claimable right now: today's contracts, the previous days still inside the grace
 * window, and this week's. Older days are dropped — nothing already claimed is affected.
 */
export function activeContracts(p: Readonly<Profile>, now: number): ActiveContract[] {
  const today = dayIndex(now);
  const out: ActiveContract[] = [];
  for (let back = 0; back < CONTRACT_GRACE_DAYS; back++) out.push(...dailyContracts(p, today - back));
  out.push(...weeklyContracts(p, now));
  return out;
}

/** Whether a run satisfies a contract's extra condition. */
export function runMatches(condition: ContractCondition | undefined, run: RunSummary): boolean {
  if (!condition) return true;
  if (condition.biome && !run.biomes.includes(condition.biome)) return false;
  if (condition.noPowerups && !run.noPowerups) return false;
  if (condition.board && run.board !== condition.board) return false;
  if (condition.equipment && !run.equipment.includes(condition.equipment)) return false;
  return true;
}

/** Progress a contract would have if this run were counted. */
export function liveProgress(c: ActiveContract, run: RunSummary): number {
  if (!runMatches(c.def.requires, run)) return c.progress;
  const value = run.stats[c.def.stat];
  return c.def.perRun ? Math.max(c.progress, value) : c.progress + value;
}

export interface ContractOutcome {
  /** Contracts this run finished off. */
  completed: ActiveContract[];
  /** Contracts that moved but are not done. */
  progressed: ActiveContract[];
}

/**
 * Applies one finished run to every claimable contract. Mutates `p` (call inside
 * ProfileStore.update). Rewards are NOT granted here — the player claims them from the board, so
 * the results screen can show what is waiting.
 */
export function applyRunToContracts(p: Profile, run: RunSummary, now: number): ContractOutcome {
  const out: ContractOutcome = { completed: [], progressed: [] };
  for (const c of activeContracts(p, now)) {
    if (c.done) continue;
    const next = liveProgress(c, run);
    if (next <= c.progress) continue;
    p.contracts.progress[c.key] = next;
    const updated: ActiveContract = { ...c, progress: Math.min(c.goal, next), done: next >= c.goal };
    if (updated.done) out.completed.push(updated);
    else out.progressed.push(updated);
  }
  return out;
}

/**
 * Claims a finished contract. Returns the reward to hand out, or null when it is not claimable.
 * Mutates `p`; the caller grants the reward (see rewards.ts) and the XP from `contractXp`.
 */
export function claimContract(p: Profile, key: string, now: number): { reward: Reward; scope: ContractScope } | null {
  const contract = activeContracts(p, now).find((c) => c.key === key);
  if (!contract || !contract.done || contract.claimed) return null;
  p.contracts.claimed.push(key);
  p.stats.contractsDone += 1;
  return { reward: contract.reward, scope: contract.scope };
}

/** Drops progress and claims for contracts that have fallen out of the grace window. */
export function pruneContracts(p: Profile, now: number): void {
  const live = new Set(activeContracts(p, now).map((c) => c.key));
  for (const key of Object.keys(p.contracts.progress)) {
    if (!live.has(key)) delete p.contracts.progress[key];
  }
  p.contracts.claimed = p.contracts.claimed.filter((k) => live.has(k));
}
