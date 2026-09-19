import { describe, expect, it } from "vitest";
import { defaultProfile, type Profile } from "../../src/core/store";
import { dayStart, dayIndexOf } from "../../src/shared/calendar";
import { CONTRACT_GRACE_DAYS, SEASON, STREAK_REWARDS, XP } from "../../src/shared/content/season";
import { activeContracts, claimContract, dailyContracts, pruneContracts } from "../../src/meta/contracts";
import { accountLevel, applyRun, attemptsUsed, grantXp, recordBoardAttempt, recordBoardResult } from "../../src/meta/progression";
import { emptyRunStats, type RunStats, type RunSummary } from "../../src/meta/stats";

/** Noon local time on a season day, so day boundaries never interfere. */
const DAY0 = dayIndexOf(SEASON.startDay);
const at = (dayOffset: number) => dayStart(DAY0 + dayOffset) + 12 * 3_600_000;

function summary(over: Omit<Partial<RunSummary>, "stats"> & { stats?: Partial<RunStats> } = {}): RunSummary {
  const stats = { ...emptyRunStats(), runs: 1, ...over.stats };
  return {
    biomes: ["village"],
    equipment: ["weapon.sword"],
    board: "season",
    period: "",
    seed: 1,
    reason: "crash",
    cause: "barricade",
    noPowerups: true,
    coinsBanked: stats.coins,
    powerupKinds: [],
    ...over,
    stats,
  };
}

describe("meta/progression applyRun", () => {
  it("banks coins, folds the run into lifetime stats and reports broken records", () => {
    const p = defaultProfile();
    const r1 = applyRun(p, summary({ stats: { distance: 820, score: 1500, coins: 60 } }), at(0));
    expect(r1.coinsEarned).toBe(60);
    // a first-ever value is not reported as a broken record
    expect(r1.records).toEqual([]);
    expect(p.stats).toMatchObject({ runs: 1, bestScore: 1500, totalCoins: 60 });
    expect(p.currencies.coins).toBeGreaterThanOrEqual(60);

    const r2 = applyRun(p, summary({ stats: { distance: 400, score: 900, coins: 20 } }), at(0));
    expect(r2.records).toEqual([]);
    const r3 = applyRun(p, summary({ stats: { distance: 900, score: 2000, coins: 10 } }), at(0));
    expect(r3.records.map((r) => r.id)).toEqual(["score", "distance"]);
    expect(r3.records[0]).toMatchObject({ value: 2000, previous: 1500 });
    expect(p.stats.runs).toBe(3);
    expect(p.stats.bestScore).toBe(2000);
    expect(p.stats.totalDistance).toBeCloseTo(2120);
  });

  it("banks coinValue-scaled coins while contracts still count coins collected", () => {
    const p = defaultProfile();
    const r = applyRun(p, summary({ coinsBanked: 118, stats: { coins: 100 } }), at(0));
    expect(r.coinsEarned).toBe(118);
    expect(p.stats.totalCoins).toBe(100);
  });

  it("grants XP, advances the season and hands each level reward out exactly once", () => {
    const p = defaultProfile();
    const r = applyRun(p, summary({ stats: { distance: 3000, score: 20000 } }), at(0));
    expect(r.xpEarned).toBeGreaterThan(0);
    expect(p.progress.seasonId).toBe(SEASON.id);
    // push the profile across a few levels in one go
    p.progress.seasonXp = SEASON.xpPerLevel * 3 + 10;
    const again = applyRun(p, summary(), at(0));
    expect(again.seasonLevelAfter).toBeGreaterThanOrEqual(3);
    const claimed = p.progress.claimedLevels.slice();
    expect(claimed).toEqual(expect.arrayContaining([1, 2, 3]));
    const third = applyRun(p, summary(), at(0));
    expect(third.seasonRewards).toEqual([]);
  });

  it("caps XP per local day and resets the cap the next day", () => {
    const p = defaultProfile();
    p.progress.seasonId = SEASON.id;
    // far ahead of pace, so no catch-up bonus muddies the numbers
    p.progress.seasonXp = SEASON.xpPerLevel * SEASON.levels;
    const first = grantXp(p, XP.dailyCap * 2, at(1));
    expect(first.granted).toBe(XP.dailyCap);
    expect(first.capped).toBe(true);
    expect(grantXp(p, 100, at(1)).granted).toBe(0);
    expect(grantXp(p, 100, at(2)).granted).toBe(100);
  });

  it("gives a behind-pace player the catch-up bonus", () => {
    const behind = defaultProfile();
    behind.progress.seasonId = SEASON.id;
    const onPace = defaultProfile();
    onPace.progress.seasonId = SEASON.id;
    onPace.progress.seasonXp = SEASON.xpPerLevel * 20;
    const day = 15;
    expect(grantXp(behind, 1000, at(day)).granted).toBeGreaterThan(grantXp(onPace, 1000, at(day)).granted);
  });

  it("advances the streak once per day and restarts the cycle after a gap without taking anything back", () => {
    const p = defaultProfile();
    expect(applyRun(p, summary(), at(0)).streak?.count).toBe(1);
    expect(applyRun(p, summary(), at(0)).streak).toBeNull();
    expect(applyRun(p, summary(), at(1)).streak?.count).toBe(2);
    const keysBefore = p.currencies.keys;
    const coinsBefore = p.currencies.coins;
    const afterGap = applyRun(p, summary(), at(5));
    expect(afterGap.streak).toMatchObject({ count: 1, day: 1, reward: STREAK_REWARDS[0] });
    expect(p.currencies.keys).toBeGreaterThanOrEqual(keysBefore);
    expect(p.currencies.coins).toBeGreaterThanOrEqual(coinsBefore);
    expect(p.streak.best).toBe(2);
  });

  it("unlocks achievements once and grants their rewards", () => {
    const p = defaultProfile();
    const r = applyRun(p, summary({ stats: { distance: 1200 } }), at(0));
    const ids = r.achievements.map((a) => a.id);
    expect(ids).toContain("ach.first");
    expect(ids).toContain("ach.km1");
    expect(applyRun(p, summary({ stats: { distance: 1200 } }), at(0)).achievements).toEqual([]);
    expect(accountLevel(p.progress.xp)).toBeGreaterThanOrEqual(1);
  });
});

describe("meta/contracts", () => {
  it("gives every player the same daily contracts", () => {
    const a = dailyContracts(defaultProfile(), DAY0).map((c) => c.key);
    const b = dailyContracts(defaultProfile(), DAY0).map((c) => c.key);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(dailyContracts(defaultProfile(), DAY0 + 1).map((c) => c.key)).not.toEqual(a);
  });

  it("keeps the last days claimable (catch-up) and drops older ones", () => {
    const p = defaultProfile();
    const keys = activeContracts(p, at(10)).map((c) => c.key);
    const daily = keys.filter((k) => k.startsWith("d:"));
    expect(daily).toHaveLength(3 * CONTRACT_GRACE_DAYS);
    expect(keys.some((k) => k.startsWith("w:"))).toBe(true);
    // progress on a day that has fallen out of the window is pruned
    p.contracts.progress["d:2000-01-01:coins"] = 5;
    pruneContracts(p, at(10));
    expect(p.contracts.progress["d:2000-01-01:coins"]).toBeUndefined();
  });

  it("progresses from runs, completes, and can be claimed exactly once", () => {
    const p = defaultProfile();
    const target = activeContracts(p, at(3)).find((c) => c.scope === "daily" && !c.def.requires && c.def.stat === "runs")
      ?? activeContracts(p, at(3)).find((c) => c.scope === "daily" && !c.def.requires)!;
    const stats = { ...emptyRunStats(), runs: 1, [target.def.stat]: target.goal };
    const r = applyRun(p, summary({ stats, biomes: ["village", "mines", "cemetery"], board: "daily" }), at(3));
    expect(r.contracts.completed.map((c) => c.key)).toContain(target.key);
    const claim = claimContract(p, target.key, at(3));
    expect(claim?.reward.kind).toBe("coins");
    expect(claimContract(p, target.key, at(3))).toBeNull();
    expect(p.stats.contractsDone).toBe(1);
  });

  it("only counts runs that meet a contract's condition", () => {
    const p: Profile = defaultProfile();
    // find a day whose contracts include a region requirement
    let day = DAY0;
    let conditional = dailyContracts(p, day).find((c) => c.def.requires?.biome);
    while (!conditional && day < DAY0 + 200) conditional = dailyContracts(p, ++day).find((c) => c.def.requires?.biome);
    expect(conditional).toBeDefined();
    const now = dayStart(day) + 12 * 3_600_000;
    applyRun(p, summary({ biomes: ["village"] }), now);
    expect(activeContracts(p, now).find((c) => c.key === conditional!.key)?.done).toBe(false);
    applyRun(p, summary({ biomes: ["village", conditional!.def.requires!.biome!] }), now);
    expect(activeContracts(p, now).find((c) => c.key === conditional!.key)?.done).toBe(true);
  });
});

describe("meta/progression boards", () => {
  it("spends ranked attempts at the start and keeps the best at the end", () => {
    const p = defaultProfile();
    expect(attemptsUsed(p, "daily", "2026-09-15")).toBe(0);
    recordBoardAttempt(p, "daily", "2026-09-15");
    recordBoardResult(p, "daily", "2026-09-15", 900, 400);
    recordBoardAttempt(p, "daily", "2026-09-15");
    recordBoardResult(p, "daily", "2026-09-15", 700, 300);
    expect(attemptsUsed(p, "daily", "2026-09-15")).toBe(2);
    expect(p.modes.daily).toMatchObject({ best: 900, bestDistance: 400 });
    expect(p.stats.bestDailyScore).toBe(900);
    // a new period starts from zero
    expect(attemptsUsed(p, "daily", "2026-09-16")).toBe(0);
  });
});
