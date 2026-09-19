/**
 * What one run produced, and what a profile remembers about every run.
 *
 * One vocabulary, used by contracts, achievements, records and the results screen, so a new
 * contract ("survive 500 m without a scratch") is a data entry over an existing counter rather
 * than a new pipe from the simulation to the meta layer.
 *
 * The App fills a RunStats from game events while the run is in progress; nothing here touches
 * the simulation.
 */
import type { Profile } from "../core/store";

export type RunStat =
  | "runs"
  | "distance"
  | "score"
  | "coins"
  | "keys"
  | "jumps"
  | "rolls"
  | "laneChanges"
  | "powerups"
  | "mounts"
  | "revives"
  | "crashes"
  | "stumbles"
  /** Obstacles that were a genuine threat and were cleared. */
  | "obstacles"
  | "nearMisses"
  | "perfectDodges"
  /** Best combo reached (a peak, not a total). */
  | "maxCombo"
  /** Longest stretch in metres without touching anything (a peak). */
  | "cleanDistance"
  /** Fastest speed reached (a peak). */
  | "topSpeed"
  /** Distinct regions crossed. */
  | "biomes"
  /** Seconds of run time. */
  | "time";

export type RunStats = Record<RunStat, number>;

/** Stats that are a peak rather than a total: merging keeps the larger value. */
export const PEAK_STATS: ReadonlySet<RunStat> = new Set<RunStat>(["maxCombo", "cleanDistance", "topSpeed"]);

export const RUN_STATS: readonly RunStat[] = [
  "runs",
  "distance",
  "score",
  "coins",
  "keys",
  "jumps",
  "rolls",
  "laneChanges",
  "powerups",
  "mounts",
  "revives",
  "crashes",
  "stumbles",
  "obstacles",
  "nearMisses",
  "perfectDodges",
  "maxCombo",
  "cleanDistance",
  "topSpeed",
  "biomes",
  "time",
];

export function emptyRunStats(): RunStats {
  const out = {} as RunStats;
  for (const key of RUN_STATS) out[key] = 0;
  return out;
}

/** Everything the meta layer needs to know about a finished run. */
export interface RunSummary {
  stats: RunStats;
  /** Region ids crossed, in order (for "reach the mines" style contracts). */
  biomes: string[];
  /** Equipment ids that were worn, for contracts that ask for a specific build. */
  equipment: string[];
  /** Board this run counts for: "season" | "daily" | "weekly" | "event:<id>". */
  board: string;
  /** Period key of that board ("" for the season board). */
  period: string;
  seed: number;
  /** How the run ended: "crash" | "quit" | "time" | "forced". */
  reason: string;
  /** What ended it ("caught", an obstacle id, or ""). */
  cause: string;
  /** True when no power-up was collected all run (for purist contracts). */
  noPowerups: boolean;
  /** Coins actually banked: collected x the run's coinValue rule. */
  coinsBanked: number;
  /** Power-up ids collected this run (for the "use every power-up" achievement). */
  powerupKinds: string[];
}

/**
 * Folds a finished run into the profile's lifetime counters. Peaks keep the larger value,
 * everything else accumulates. Mutates `p` (call inside ProfileStore.update).
 */
export function addRunToLifetime(p: Profile, summary: RunSummary): void {
  const s = summary.stats;
  const st = p.stats;
  st.runs += s.runs;
  st.totalDistance += s.distance;
  st.totalCoins += s.coins;
  st.jumps += s.jumps;
  st.rolls += s.rolls;
  st.laneChanges += s.laneChanges;
  st.powerups += s.powerups;
  st.mountsUsed += s.mounts;
  st.revives += s.revives;
  st.crashes += s.crashes;
  st.stumbles += s.stumbles;
  st.obstaclesDodged += s.obstacles;
  st.nearMisses += s.nearMisses;
  st.perfectDodges += s.perfectDodges;
  st.timePlayed += s.time;
  st.bestScore = Math.max(st.bestScore, s.score);
  st.bestDistance = Math.max(st.bestDistance, s.distance);
  st.bestCoinsRun = Math.max(st.bestCoinsRun, s.coins);
  st.bestCombo = Math.max(st.bestCombo, s.maxCombo);
  st.bestCleanDistance = Math.max(st.bestCleanDistance, s.cleanDistance);
  st.bestSpeed = Math.max(st.bestSpeed, s.topSpeed);
  for (const id of summary.biomes) {
    if (!st.biomesVisited.includes(id)) st.biomesVisited.push(id);
  }
}

/** A personal record the results screen can shout about. */
export interface RecordBreak {
  id: string;
  label: string;
  value: number;
  previous: number;
  /** Rendered with a metre suffix when true. */
  metres?: boolean;
}

/**
 * Which lifetime records this run beat. Read BEFORE the run is folded in, since it compares
 * against the stored values.
 */
export function recordsBroken(p: Readonly<Profile>, summary: RunSummary): RecordBreak[] {
  const s = summary.stats;
  const st = p.stats;
  const out: RecordBreak[] = [];
  const check = (id: string, label: string, value: number, previous: number, metres = false) => {
    if (value > previous && value > 0) out.push({ id, label, value, previous, metres });
  };
  check("score", "Melhor pontuação", s.score, st.bestScore);
  check("distance", "Maior distância", Math.floor(s.distance), Math.floor(st.bestDistance), true);
  check("coins", "Mais moedas numa corrida", s.coins, st.bestCoinsRun);
  check("combo", "Maior combo", s.maxCombo, st.bestCombo);
  check("clean", "Maior sequência sem colisão", Math.floor(s.cleanDistance), Math.floor(st.bestCleanDistance), true);
  check("speed", "Maior velocidade", Math.round(s.topSpeed), Math.round(st.bestSpeed));
  return out;
}
