/**
 * What a finished run does to the profile — the single pipeline every meta system hangs off.
 *
 * One call, one report: the results screen renders exactly what this returns, so there is no
 * second place where "what the player earned" is decided. Pure functions over Profile, unit-tested;
 * the App calls it inside `store.update()`.
 *
 * Order matters and is deliberate:
 *   records are read BEFORE the run is folded into the lifetime totals (otherwise everything ties),
 *   contracts see the run, then achievements are checked against the already-updated profile.
 */
import type { Profile } from "../core/store";
import { dayIndex } from "../shared/calendar";
import {
  SEASON,
  STREAK_REWARDS,
  XP,
  catchUpMultiplier,
  runXp,
  seasonLevel,
  type Reward,
} from "../shared/content/season";
import { ACHIEVEMENT_XP, checkAchievements, type AchievementDef } from "./achievements";
import { applyRunToContracts, contractXp, type ContractOutcome } from "./contracts";
import { applyRunMissions, type MissionOutcome } from "./missions";
import { grantReward } from "./rewards";
import { addRunToLifetime, recordsBroken, type RecordBreak, type RunSummary } from "./stats";

/** Everything that changed, in the order the results screen shows it. */
export interface RunReport {
  coinsEarned: number;
  keysEarned: number;
  xpEarned: number;
  /** Account level before and after (levels are `SEASON.xpPerLevel` apart). */
  levelBefore: number;
  levelAfter: number;
  seasonLevelBefore: number;
  seasonLevelAfter: number;
  /** Season rewards handed out by the levels gained in this run. */
  seasonRewards: Reward[];
  records: RecordBreak[];
  contracts: ContractOutcome;
  achievements: AchievementDef[];
  missions: MissionOutcome | null;
  /** Set when this run was the first of a new day and the streak advanced. */
  streak: { day: number; count: number; reward: Reward } | null;
  /** True when the XP daily cap swallowed part of the reward. */
  xpCapped: boolean;
}

/** Account level from total XP (same spacing as season levels, but it never resets). */
export function accountLevel(xp: number): number {
  return Math.max(1, Math.floor(xp / SEASON.xpPerLevel) + 1);
}

/**
 * Grants XP, respecting the daily cap and the season catch-up bonus.
 * Returns how much was actually granted.
 */
export function grantXp(p: Profile, amount: number, now: number): { granted: number; capped: boolean } {
  if (amount <= 0) return { granted: 0, capped: false };
  const today = dayIndex(now);
  if (p.progress.xpDay !== today) {
    p.progress.xpDay = today;
    p.progress.xpToday = 0;
  }
  const bonus = catchUpMultiplier(p.progress.seasonXp, today);
  const wanted = Math.round(amount * bonus);
  const room = Math.max(0, XP.dailyCap - p.progress.xpToday);
  const granted = Math.min(wanted, room);
  p.progress.xpToday += granted;
  p.progress.xp += granted;
  p.progress.seasonXp += granted;
  return { granted, capped: granted < wanted };
}

/** Makes sure the profile is pointing at the current season before anything reads it. */
export function ensureSeason(p: Profile): void {
  if (p.progress.seasonId === SEASON.id) return;
  p.progress.seasonId = SEASON.id;
  p.progress.seasonXp = 0;
  p.progress.claimedLevels = [];
}

/**
 * Hands out the season track rewards for every level reached but not yet claimed.
 * Mutates `p`; returns the rewards granted so the results screen can list them.
 */
export function claimSeasonLevels(p: Profile): Reward[] {
  const level = seasonLevel(p.progress.seasonXp);
  const out: Reward[] = [];
  for (let l = 1; l <= level; l++) {
    if (p.progress.claimedLevels.includes(l)) continue;
    const reward = SEASON.track[l - 1];
    p.progress.claimedLevels.push(l);
    if (!reward) continue;
    grantReward(p, reward);
    out.push(reward);
  }
  return out;
}

/**
 * Advances the daily streak on the first run of a new local day.
 * Breaking a streak only restarts the cycle — nothing already earned is taken away.
 */
export function advanceStreak(p: Profile, now: number): { day: number; count: number; reward: Reward } | null {
  const today = dayIndex(now);
  if (p.streak.day === today) return null;
  const gap = p.streak.day === 0 ? 1 : today - p.streak.day;
  p.streak.count = gap === 1 ? p.streak.count + 1 : 1;
  p.streak.day = today;
  p.streak.best = Math.max(p.streak.best, p.streak.count);
  const index = (p.streak.count - 1) % STREAK_REWARDS.length;
  const reward = STREAK_REWARDS[index];
  grantReward(p, reward);
  p.streak.claimed = today;
  return { day: index + 1, count: p.streak.count, reward };
}

/**
 * Applies one finished run to everything. Mutates `p` (call inside ProfileStore.update).
 */
export function applyRun(p: Profile, summary: RunSummary, now: number): RunReport {
  ensureSeason(p);
  const levelBefore = accountLevel(p.progress.xp);
  const seasonLevelBefore = seasonLevel(p.progress.seasonXp);

  // records are compared against the stored bests, so read them before folding the run in
  const records = recordsBroken(p, summary);
  addRunToLifetime(p, summary);

  const coinsEarned = Math.max(0, Math.floor(summary.coinsBanked));
  p.currencies.coins += coinsEarned;
  const keysEarned = Math.max(0, Math.floor(summary.stats.keys));

  // power-up variety, for the "use every power-up" achievement
  for (const kind of summary.powerupKinds) {
    if (!p.stats.powerupKinds.includes(kind)) p.stats.powerupKinds.push(kind);
  }

  const contracts = applyRunToContracts(p, summary, now);
  const missions = applyRunMissions(p, summary.stats);

  let xp = runXp(summary.stats.distance, summary.stats.score);
  for (const c of contracts.completed) xp += contractXp(c.scope);
  const streak = advanceStreak(p, now);

  const achievements = checkAchievements(p, now);
  for (const a of achievements) {
    if (a.reward) grantReward(p, a.reward);
    xp += ACHIEVEMENT_XP;
  }

  const granted = grantXp(p, xp, now);
  const seasonRewards = claimSeasonLevels(p);

  return {
    coinsEarned,
    keysEarned,
    xpEarned: granted.granted,
    levelBefore,
    levelAfter: accountLevel(p.progress.xp),
    seasonLevelBefore,
    seasonLevelAfter: seasonLevel(p.progress.seasonXp),
    seasonRewards,
    records,
    contracts,
    achievements,
    missions,
    streak,
    xpCapped: granted.capped,
  };
}

/** Spends one ranked attempt on a board (called when the run STARTS). */
export function recordBoardAttempt(p: Profile, board: string, period: string): void {
  const entry = p.modes[board];
  if (!entry || entry.period !== period) p.modes[board] = { period, attempts: 1, best: 0, bestDistance: 0 };
  else entry.attempts += 1;
}

/** Keeps the personal best of a ranked run on its board (called when the run ENDS). */
export function recordBoardResult(p: Profile, board: string, period: string, score: number, distance: number): void {
  const entry = p.modes[board];
  if (!entry || entry.period !== period) return;
  entry.best = Math.max(entry.best, score);
  entry.bestDistance = Math.max(entry.bestDistance, distance);
  if (board === "daily") p.stats.bestDailyScore = Math.max(p.stats.bestDailyScore, score);
}

/** Called when the server reports a daily board win, for the Campeão achievement. */
export function recordDailyWin(p: Profile): void {
  p.stats.dailyWins += 1;
}

/** Ranked attempts already used on a board this period. */
export function attemptsUsed(p: Readonly<Profile>, board: string, period: string): number {
  const entry = p.modes[board];
  return entry && entry.period === period ? entry.attempts : 0;
}
