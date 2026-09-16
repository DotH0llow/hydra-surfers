/**
 * Season content — the one place a host edits to run the next month.
 *
 * Everything here is data: the season window and its reward track, the weekly challenge rotation,
 * the tournament calendar, community bounties, the daily streak and the shop prices. Systems read
 * it; none of them hard-code an event. Shared with worker/ so the server can validate which period
 * a run belongs to and how many attempts it was allowed.
 *
 * Pacing this is tuned for (a private group of ~30-40 players over 30 days):
 *  - a casual player doing the daily run and their contracts earns ~900 XP/day and finishes the
 *    30-level track around day 26 even after missing several days (catch-up bonus below);
 *  - a hardcore player caps the track around day 15 and then plays for boards, records and titles.
 */
import type { Effect } from "../../game/rules";
import { dayIndexOf, dayStart } from "../calendar";

// ---------------------------------------------------------------------------- rewards

export type RewardKind = "coins" | "keys" | "mount" | "item" | "character" | "title" | "crest" | "xp";

export interface Reward {
  kind: RewardKind;
  /** Catalog id for item/character/mount/title/crest rewards. */
  id?: string;
  /** Amount for coins/keys/xp. */
  amount?: number;
}

// ---------------------------------------------------------------------------- season

export interface SeasonDef {
  id: string;
  name: string;
  /** First local day of the season, `YYYY-MM-DD`. */
  startDay: string;
  days: number;
  /** XP needed for each season level (flat: easy for players to reason about). */
  xpPerLevel: number;
  levels: number;
  /**
   * Extra XP for players below the pace the season expects, so someone who misses a week can still
   * finish. 0.5 = +50% while behind (see `catchUpMultiplier`).
   */
  catchUpBonus: number;
  /** One reward per level, index 0 = reaching level 1. */
  track: Reward[];
}

export const SEASON: SeasonDef = {
  id: "s1-reino",
  name: "Temporada I — A Estrada do Reino",
  startDay: "2026-09-15",
  days: 30,
  xpPerLevel: 1000,
  levels: 30,
  catchUpBonus: 0.5,
  track: [
    { kind: "coins", amount: 300 },
    { kind: "crest", id: "crest.symbol.sword" },
    { kind: "keys", amount: 1 },
    { kind: "item", id: "weapon.bow" },
    { kind: "coins", amount: 500 },
    { kind: "title", id: "title.escudeiro" },
    { kind: "mount", id: "mount.barrel" },
    { kind: "coins", amount: 600 },
    { kind: "crest", id: "crest.frame.rope" },
    { kind: "keys", amount: 2 },
    { kind: "item", id: "armor.chainmail" },
    { kind: "coins", amount: 800 },
    { kind: "title", id: "title.cavaleiro" },
    { kind: "character", id: "char.runner.bard" },
    { kind: "coins", amount: 900 },
    { kind: "crest", id: "crest.symbol.raven" },
    { kind: "keys", amount: 2 },
    { kind: "item", id: "relic.horseshoe" },
    { kind: "coins", amount: 1000 },
    { kind: "mount", id: "mount.wolf" },
    { kind: "title", id: "title.mercenario" },
    { kind: "coins", amount: 1200 },
    { kind: "crest", id: "crest.frame.laurel" },
    { kind: "keys", amount: 3 },
    { kind: "item", id: "relic.mageeye" },
    { kind: "character", id: "char.runner.alchemist" },
    { kind: "coins", amount: 1500 },
    { kind: "crest", id: "crest.symbol.dragon" },
    { kind: "mount", id: "mount.dragonling" },
    { kind: "title", id: "title.lenda" },
  ],
};

/** Local day index the season starts on. */
export function seasonStartDay(): number {
  return dayIndexOf(SEASON.startDay);
}

/** 0-based day of the season for a day index, or -1 outside the window. */
export function seasonDay(dayIdx: number): number {
  const d = dayIdx - seasonStartDay();
  return d >= 0 && d < SEASON.days ? d : -1;
}

/** Season level for an XP total (0 = not there yet, capped at `levels`). */
export function seasonLevel(xp: number): number {
  return Math.max(0, Math.min(SEASON.levels, Math.floor(xp / SEASON.xpPerLevel)));
}

/**
 * XP multiplier for a player who is behind the season's pace. The pace is one level per day, so a
 * player on day 10 is "on pace" at level 10; below that they earn the catch-up bonus.
 */
export function catchUpMultiplier(xp: number, dayIdx: number): number {
  const day = seasonDay(dayIdx);
  if (day < 0) return 1;
  const expected = Math.min(SEASON.levels, day + 1);
  return seasonLevel(xp) < expected - 1 ? 1 + SEASON.catchUpBonus : 1;
}

// ---------------------------------------------------------------------------- weekly challenges

export interface ChallengeDef {
  id: string;
  name: string;
  /** One line explaining the twist, shown on the card. */
  description: string;
  effects: Effect[];
  /** Restrict the run to these biomes (director picks only from them). */
  biomes?: string[];
  /** Force a weather state for the whole run. */
  weather?: string;
}

/**
 * The weekly challenge rotation. One is active per ISO week, picked by week index, so the schedule
 * repeats predictably and a host can add entries without touching code.
 */
export const WEEKLY_CHALLENGES: ChallengeDef[] = [
  {
    id: "uma-vida",
    name: "Uma Só Vida",
    description: "Sem montaria e sem reerguimento. Uma queda encerra a corrida.",
    effects: [
      { rule: "mountAllowed", op: "set", value: 0 },
      { rule: "revivesAllowed", op: "set", value: 0 },
      { rule: "scoreMul", value: 1.25 },
    ],
  },
  {
    id: "galope",
    name: "Galope",
    description: "A corrida começa em alta velocidade e a dificuldade já sobe cedo.",
    effects: [
      { rule: "speedMul", value: 1.3 },
      { rule: "startDifficulty", op: "set", value: 0.5 },
    ],
  },
  {
    id: "sem-amuleto",
    name: "Bolsos Furados",
    description: "Sem amuleto magnético: cada moeda precisa ser pega na mão.",
    effects: [
      { rule: "magnetDurationMul", op: "set", value: 0.25 },
      { rule: "coinValue", value: 1.5 },
    ],
  },
  {
    id: "feira-do-rei",
    name: "Feira do Rei",
    description: "Moedas valem o dobro e aparecem em toda parte — mas a estrada está cheia.",
    effects: [
      { rule: "coinValue", value: 2 },
      { rule: "coinDensityMul", value: 1.8 },
      { rule: "obstacleGapMul", value: 0.8 },
    ],
  },
  {
    id: "noite-dos-mortos",
    name: "Noite dos Mortos",
    description: "Noite fechada no cemitério e nas ruínas, com o perseguidor logo atrás.",
    effects: [
      { rule: "chaserGapMul", value: 0.5 },
      { rule: "scoreMul", value: 1.2 },
    ],
    biomes: ["cemetery", "ruins", "swamp"],
    weather: "night",
  },
  {
    id: "bencao-abundante",
    name: "Bênção Abundante",
    description: "Poderes surgem o tempo todo e duram mais.",
    effects: [
      { rule: "pickupChanceMul", value: 2.5 },
      { rule: "powerupDurationMul", value: 1.4 },
      { rule: "scoreMul", value: 0.85 },
    ],
  },
  {
    id: "estrada-estreita",
    name: "Estrada Estreita",
    description: "Obstáculos muito mais densos. Leitura e reação acima de tudo.",
    effects: [
      { rule: "obstacleGapMul", value: 0.65 },
      { rule: "skillScoreMul", value: 1.5 },
    ],
  },
  {
    id: "corrida-curta",
    name: "Corrida Curta",
    description: "Três minutos exatos. Vale o quanto você consegue somar neles.",
    effects: [
      { rule: "timeLimitSeconds", op: "set", value: 180 },
      { rule: "speedMul", value: 1.15 },
      { rule: "coinDensityMul", value: 1.3 },
    ],
  },
  {
    id: "peso-do-ouro",
    name: "Peso do Ouro",
    description: "Pontos vêm das moedas, não da distância.",
    effects: [
      { rule: "coinScoreBonus", op: "set", value: 60 },
      { rule: "scoreMul", value: 0.35 },
      { rule: "coinDensityMul", value: 1.4 },
    ],
  },
  {
    id: "tempestade",
    name: "Tempestade",
    description: "Chuva pesada, pouca visibilidade e eventos o tempo todo.",
    effects: [
      { rule: "eventChanceMul", value: 3 },
      { rule: "scoreMul", value: 1.15 },
    ],
    weather: "rain",
  },
  {
    id: "salto-do-grifo",
    name: "Salto do Grifo",
    description: "Saltos altos e flutuantes. A estrada pede o ar, não o chão.",
    effects: [
      { rule: "jumpHeightMul", value: 1.35 },
      { rule: "airTimeMul", value: 1.25 },
      { rule: "obstacleGapMul", value: 0.85 },
    ],
  },
  {
    id: "cerco",
    name: "Cerco",
    description: "Só muralhas e castelo, com o perseguidor colado e tudo mais denso.",
    effects: [
      { rule: "chaserGapMul", value: 0.45 },
      { rule: "obstacleGapMul", value: 0.8 },
      { rule: "scoreMul", value: 1.3 },
    ],
    biomes: ["castle", "walls", "battlefield"],
  },
];

/** The challenge for a week index (rotates through the list). */
export function challengeForWeek(weekIdx: number): ChallengeDef {
  const n = WEEKLY_CHALLENGES.length;
  return WEEKLY_CHALLENGES[((weekIdx % n) + n) % n];
}

// ---------------------------------------------------------------------------- tournaments

export interface TournamentDef {
  id: string;
  name: string;
  description: string;
  /** Days after the season start when it opens. */
  startDayOffset: number;
  /** How long it stays open, in hours (24-72). */
  hours: number;
  effects: Effect[];
  biomes?: string[];
  weather?: string;
  /** Ranked attempts allowed for the whole tournament. */
  attempts: number;
}

export const TOURNAMENTS: TournamentDef[] = [
  {
    id: "corrida-do-rei",
    name: "Corrida do Rei",
    description: "A abertura da temporada. Estrada nobre, tudo vale pontos.",
    startDayOffset: 2,
    hours: 72,
    effects: [
      { rule: "scoreMul", value: 1.2 },
      { rule: "coinDensityMul", value: 1.2 },
    ],
    attempts: 5,
  },
  {
    id: "cacada-do-dragao",
    name: "Caçada do Dragão",
    description: "O dragão sobrevoa a estrada muito mais vezes do que deveria.",
    startDayOffset: 9,
    hours: 48,
    effects: [
      { rule: "eventChanceMul", value: 4 },
      { rule: "skillScoreMul", value: 1.4 },
    ],
    attempts: 5,
  },
  {
    id: "festival-da-colheita",
    name: "Festival da Colheita",
    description: "Feira aberta: moedas por todo lado, estrada apertada.",
    startDayOffset: 17,
    hours: 48,
    effects: [
      { rule: "coinValue", value: 2 },
      { rule: "coinDensityMul", value: 2 },
      { rule: "obstacleGapMul", value: 0.75 },
    ],
    attempts: 5,
  },
  {
    id: "cerco-ao-castelo",
    name: "Cerco ao Castelo",
    description: "O fecho da temporada: muralhas, uma vida, nada de montaria.",
    startDayOffset: 26,
    hours: 72,
    effects: [
      { rule: "mountAllowed", op: "set", value: 0 },
      { rule: "revivesAllowed", op: "set", value: 0 },
      { rule: "chaserGapMul", value: 0.5 },
      { rule: "scoreMul", value: 1.5 },
    ],
    biomes: ["castle", "walls", "battlefield"],
    attempts: 5,
  },
];

/** The tournament open at `ms`, if any. Windows open at local midnight of their start day. */
export function activeTournament(ms: number): TournamentDef | null {
  for (const t of TOURNAMENTS) {
    const startMs = dayStart(seasonStartDay() + t.startDayOffset);
    if (ms >= startMs && ms < startMs + t.hours * 3_600_000) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------- community bounties

export interface BountyDef {
  id: string;
  name: string;
  /** What everyone's runs add up to. */
  stat: "coins" | "distance" | "runs" | "contracts";
  goal: number;
  startDayOffset: number;
  days: number;
  reward: Reward;
}

/** Goals sized for ~35 players: reachable in the window if most of the group plays. */
export const BOUNTIES: BountyDef[] = [
  { id: "cofre-do-reino", name: "O Cofre do Reino", stat: "coins", goal: 150_000, startDayOffset: 0, days: 10, reward: { kind: "crest", id: "crest.frame.gold" } },
  { id: "estrada-longa", name: "A Estrada Longa", stat: "distance", goal: 500_000, startDayOffset: 10, days: 10, reward: { kind: "title", id: "title.peregrino" } },
  { id: "mil-contratos", name: "Mil Contratos", stat: "contracts", goal: 1000, startDayOffset: 20, days: 10, reward: { kind: "mount", id: "mount.ghosthorse" } },
];

/** The bounty running on a season day, if any. */
export function activeBounty(dayIdx: number): BountyDef | null {
  const day = seasonDay(dayIdx);
  if (day < 0) return null;
  return BOUNTIES.find((b) => day >= b.startDayOffset && day < b.startDayOffset + b.days) ?? null;
}

// ---------------------------------------------------------------------------- daily rhythm

/** Ranked attempts per day on the daily run. Extra runs are playable but not ranked. */
export const DAILY_ATTEMPTS = 3;
/** Ranked attempts per week on the weekly challenge. */
export const WEEKLY_ATTEMPTS = 5;
/** Daily contracts stay claimable for this many days, so missing a day costs nothing. */
export const CONTRACT_GRACE_DAYS = 3;

/**
 * Seven-day streak. Breaking it only restarts the cycle — nothing already earned is lost, which
 * keeps a missed day from feeling punishing in a group where people play irregularly.
 */
export const STREAK_REWARDS: Reward[] = [
  { kind: "coins", amount: 150 },
  { kind: "coins", amount: 250 },
  { kind: "keys", amount: 1 },
  { kind: "coins", amount: 400 },
  { kind: "mount", id: "mount.boar" },
  { kind: "coins", amount: 600 },
  { kind: "keys", amount: 3 },
];

// ---------------------------------------------------------------------------- XP

/**
 * XP a finished run is worth. Distance and score both count so that a long careful run and a
 * short aggressive one are both viable, with a soft cap per run so nobody has to grind one
 * enormous session to keep up.
 */
export const XP = {
  perMetre: 0.06,
  perScore: 0.004,
  /** Most a single run can give before the soft cap halves further gains. */
  runSoftCap: 260,
  /** First ranked daily attempt of the day. */
  dailyRun: 100,
  /** First ranked weekly-challenge attempt of the week. */
  weeklyRun: 150,
  contractDaily: 90,
  contractWeekly: 300,
  achievement: 120,
  /** Most XP the meta will grant one player in one local day (anti-cheat plausibility too). */
  dailyCap: 4000,
} as const;

/** XP for one finished run, before the season catch-up bonus. */
export function runXp(distance: number, score: number): number {
  const raw = distance * XP.perMetre + score * XP.perScore;
  return Math.round(raw <= XP.runSoftCap ? raw : XP.runSoftCap + (raw - XP.runSoftCap) * 0.5);
}

// ---------------------------------------------------------------------------- economy

/**
 * Prices. Target: an active player unlocks something meaningful every 2-3 sessions, and nothing
 * here costs more than about a week of casual play.
 */
export const PRICES = {
  mount: 300,
  key: 1800,
  itemCommon: 1200,
  itemRare: 3500,
  characterCommon: 4000,
  characterRare: 9000,
  mountSkin: 2500,
} as const;
