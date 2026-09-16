/**
 * Run modes: what a player can press "Partir" on.
 *
 * A mode resolves (now) into everything a run and a submission need — the seed, the board it
 * counts for, the period key, the mutators and how many ranked attempts are left. Modes are
 * derived from the shared calendar and the season content, so the client and the worker agree on
 * which daily a run belongs to without exchanging any extra state.
 *
 * Seeded competitive modes are **normalised**: the permanent guild multiplier and the shop's
 * power-up upgrades are switched off, so a daily board ranks how well people ran the same track
 * rather than how long they have been grinding. Equipment still applies — choosing a build is the
 * interesting decision, buying levels is not.
 */
import type { Effect } from "../game/rules";
import { dayKey, seedFor, weekKey } from "../shared/calendar";
import { DAILY_ATTEMPTS, WEEKLY_ATTEMPTS, activeTournament, challengeForWeek } from "../shared/content/season";

export type RunModeId = "normal" | "daily" | "weekly" | "event";

export interface RunMode {
  id: RunModeId;
  /** Board this mode submits to: "season" | "daily" | "weekly" | "event:<id>". */
  board: string;
  /** Period the board is scoped to: "" (season) | "2026-09-15" | "2026-W38" | "<tournament id>". */
  period: string;
  name: string;
  description: string;
  /** Fixed seed for seeded modes; 0 means "roll a fresh one per run". */
  seed: number;
  /** Ranked attempts allowed in this period (0 = unlimited). */
  attempts: number;
  /** Mutators applied on top of the player's build. */
  effects: Effect[];
  /** Only these biomes may appear (undefined = the full rotation). */
  biomes?: string[];
  /** Forced weather for the whole run. */
  weather?: string;
  /** True when grind-based advantages are switched off (see file header). */
  normalised: boolean;
}

/** Effects that put every player on the same footing in a seeded board. */
const NORMALISE: Effect[] = [
  { rule: "guildMultiplier", op: "set", value: 0 },
  { rule: "upgrades", op: "set", value: 0 },
];

export function normalMode(): RunMode {
  return {
    id: "normal",
    board: "season",
    period: "",
    name: "Partir",
    description: "Corrida livre. Conta para o ranking geral da temporada.",
    seed: 0,
    attempts: 0,
    effects: [],
    normalised: false,
  };
}

export function dailyMode(now: number): RunMode {
  const period = dayKey(now);
  return {
    id: "daily",
    board: "daily",
    period,
    name: "Corrida do Dia",
    description: "A mesma estrada para todo o reino, hoje. Melhor tentativa conta.",
    seed: seedFor("daily", period),
    attempts: DAILY_ATTEMPTS,
    effects: NORMALISE,
    normalised: true,
  };
}

export function weeklyMode(now: number): RunMode {
  const period = weekKey(now);
  const challenge = challengeForWeek(weekIndexOf(period));
  return {
    id: "weekly",
    board: "weekly",
    period,
    name: challenge.name,
    description: challenge.description,
    seed: seedFor("weekly", period),
    attempts: WEEKLY_ATTEMPTS,
    effects: [...NORMALISE, ...challenge.effects],
    biomes: challenge.biomes,
    weather: challenge.weather,
    normalised: true,
  };
}

/** The tournament running right now, or null. */
export function eventMode(now: number): RunMode | null {
  const t = activeTournament(now);
  if (!t) return null;
  return {
    id: "event",
    board: `event:${t.id}`,
    period: t.id,
    name: t.name,
    description: t.description,
    seed: seedFor("event", t.id),
    attempts: t.attempts,
    effects: [...NORMALISE, ...t.effects],
    biomes: t.biomes,
    weather: t.weather,
    normalised: true,
  };
}

/** Every mode a player can start right now, in the order the tavern shows them. */
export function availableModes(now: number): RunMode[] {
  const out = [normalMode(), dailyMode(now), weeklyMode(now)];
  const event = eventMode(now);
  if (event) out.push(event);
  return out;
}

export function modeById(id: RunModeId, now: number): RunMode {
  switch (id) {
    case "daily":
      return dailyMode(now);
    case "weekly":
      return weeklyMode(now);
    case "event":
      return eventMode(now) ?? normalMode();
    default:
      return normalMode();
  }
}

/** The seed a run of this mode should use (`normal` rolls a fresh one). */
export function seedForMode(mode: RunMode, random: () => number = Math.random): number {
  return mode.seed !== 0 ? mode.seed >>> 0 : Math.floor(random() * 0x7fffffff) >>> 0;
}

/** Parses the week index back out of a `YYYY-Www` key (the rotation index for challenges). */
function weekIndexOf(period: string): number {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(period);
  if (!m) return 0;
  // Year * 52 + week is enough to advance the rotation monotonically across a year boundary.
  return Number(m[1]) * 52 + Number(m[2]);
}
