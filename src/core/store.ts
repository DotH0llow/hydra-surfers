/**
 * Persistent player profile (localStorage), versioned with forward migrations.
 *
 * Bump PROFILE_VERSION and append a migration whenever the shape changes; migrations receive
 * the raw object of the previous version and must return the next version's object. Purely
 * additive fields need no migration: `fill()` deep-fills anything missing from the defaults.
 * Modules that need their own persisted data can use `profile.ext[<moduleId>]`.
 */

import type { RankSnapshot } from "../meta/social";

/** Procedurally drawn coat of arms: indices into the part lists in src/ui/crest.ts. */
export interface Crest {
  bg: number;
  symbol: number;
  frame: number;
  /** Palette index (both crest colours come from one palette entry). */
  color: number;
}

export interface Profile {
  version: number;
  currencies: { coins: number; keys: number; mounts: number };
  owned: { characters: string[]; mounts: string[]; equipment: string[]; titles: string[]; crestParts: string[] };
  equipped: {
    character: string;
    mount: string;
    weapon: string;
    armor: string;
    relic: string;
    /** Title id shown next to the name on the boards ("" = none). */
    title: string;
    crest: Crest;
    /** Up to three achievement ids shown on the public card. */
    showcase: string[];
  };
  /** Account level (permanent) and the current season's progress. */
  progress: {
    xp: number;
    /** Season the `seasonXp` below belongs to; a new season id resets it. */
    seasonId: string;
    seasonXp: number;
    /** Season levels whose reward has already been handed out. */
    claimedLevels: number[];
    /** Community bounties whose reward this player already received. */
    claimedBounties: string[];
    /** Local day index of the last XP grant, with how much was granted (daily cap). */
    xpDay: number;
    xpToday: number;
  };
  stats: {
    bestScore: number;
    bestDistance: number;
    totalCoins: number;
    runs: number;
    totalDistance: number;
    // --- extended lifetime counters (achievements, records, the profile screen)
    jumps: number;
    rolls: number;
    laneChanges: number;
    crashes: number;
    stumbles: number;
    revives: number;
    powerups: number;
    mountsUsed: number;
    obstaclesDodged: number;
    nearMisses: number;
    perfectDodges: number;
    bestCombo: number;
    bestCoinsRun: number;
    bestCleanDistance: number;
    bestSpeed: number;
    bestDailyScore: number;
    /** Times the player finished first on a daily board. */
    dailyWins: number;
    /** Ranked Corrida do Dia runs finished. */
    dailyRuns: number;
    /** Players overtaken on the real boards (server-confirmed). */
    overtakes: number;
    contractsDone: number;
    timePlayed: number;
    biomesVisited: string[];
    powerupKinds: string[];
  };
  /** The permanent guild contract set (was: missions) and its score multiplier. */
  missions: { set: number; progress: Record<string, number>; completed: string[] };
  /** Daily / weekly / special contracts: progress and claimed rewards by contract key. */
  contracts: { progress: Record<string, number>; claimed: string[] };
  /** Achievement id → local day index it was unlocked on. */
  achievements: Record<string, number>;
  /** Daily login streak. Breaking it only restarts the cycle; nothing earned is lost. */
  streak: { day: number; count: number; best: number; claimed: number };
  /** Per-mode attempt bookkeeping, keyed by board id ("daily", "weekly", "event:<id>"). */
  modes: Record<string, { period: string; attempts: number; best: number; bestDistance: number }>;
  social: {
    /** House id ("" = not chosen yet). */
    faction: string;
    /** Rank and the players just below, per board, at the last tavern visit (see meta/social.ts). */
    lastRanks: Record<string, RankSnapshot>;
    /** Whether the onboarding (name, crest, house) has been completed. */
    registered: boolean;
  };
  settings: {
    music: number;
    sfx: number;
    muted: boolean;
    reducedMotion: boolean;
    /** Keep local balance metrics (never leaves the device unless online is on). */
    analytics: boolean;
    /** Show other players' ghosts in seeded modes. */
    ghosts: boolean;
    /** Race your own best instead of the rival above. */
    ghostSelf: boolean;
  };
  /** Free-form per-module storage, e.g. ext["upgrades"]. */
  ext: Record<string, unknown>;
}

export const PROFILE_VERSION = 2;

/**
 * Starter equipment. These ids are `source: { kind: "start" }` in src/meta/equipment.ts and are
 * owned implicitly, so they are referenced here as plain strings rather than importing the
 * catalogue (which imports this file for the Profile type).
 */
const STARTER = { weapon: "weapon.sword", armor: "armor.leather", relic: "relic.kingscoin" } as const;

export function defaultProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    currencies: { coins: 0, keys: 0, mounts: 3 },
    owned: { characters: ["char.runner.default"], mounts: [], equipment: [], titles: [], crestParts: [] },
    equipped: {
      character: "char.runner.default",
      mount: "",
      weapon: STARTER.weapon,
      armor: STARTER.armor,
      relic: STARTER.relic,
      title: "",
      crest: { bg: 0, symbol: 0, frame: 0, color: 0 },
      showcase: [],
    },
    progress: { xp: 0, seasonId: "", seasonXp: 0, claimedLevels: [], claimedBounties: [], xpDay: 0, xpToday: 0 },
    stats: {
      bestScore: 0,
      bestDistance: 0,
      totalCoins: 0,
      runs: 0,
      totalDistance: 0,
      jumps: 0,
      rolls: 0,
      laneChanges: 0,
      crashes: 0,
      stumbles: 0,
      revives: 0,
      powerups: 0,
      mountsUsed: 0,
      obstaclesDodged: 0,
      nearMisses: 0,
      perfectDodges: 0,
      bestCombo: 0,
      bestCoinsRun: 0,
      bestCleanDistance: 0,
      bestSpeed: 0,
      bestDailyScore: 0,
      dailyWins: 0,
      dailyRuns: 0,
      overtakes: 0,
      contractsDone: 0,
      timePlayed: 0,
      biomesVisited: [],
      powerupKinds: [],
    },
    missions: { set: 1, progress: {}, completed: [] },
    contracts: { progress: {}, claimed: [] },
    achievements: {},
    streak: { day: 0, count: 0, best: 0, claimed: 0 },
    modes: {},
    social: { faction: "", lastRanks: {}, registered: false },
    settings: { music: 0.7, sfx: 0.9, muted: false, reducedMotion: false, analytics: true, ghosts: true, ghostSelf: false },
    ext: {},
  };
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** migrations[n] upgrades a version-n object to version n+1. */
const migrations: Record<number, Migration> = {
  /**
   * v1 → v2: the medieval pass renamed hoverboards to mounts and added progression. Only the
   * renames need code here; every new field is filled from the defaults.
   */
  1: (raw) => {
    const next: Record<string, unknown> = { ...raw, version: 2 };
    const currencies = isObject(raw.currencies) ? raw.currencies : {};
    if (currencies.boards !== undefined) {
      next.currencies = { ...currencies, mounts: currencies.boards };
      delete (next.currencies as Record<string, unknown>).boards;
    }
    const owned = isObject(raw.owned) ? raw.owned : {};
    if (owned.boards !== undefined) {
      next.owned = { ...owned, mounts: owned.boards };
      delete (next.owned as Record<string, unknown>).boards;
    }
    const equipped = isObject(raw.equipped) ? raw.equipped : {};
    if (equipped.board !== undefined) {
      next.equipped = { ...equipped, mount: equipped.board };
      delete (next.equipped as Record<string, unknown>).board;
    }
    return next;
  },
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const k = "__hs_probe";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-fills missing keys from defaults (keeps unknown extra keys). */
function fill<T>(value: unknown, defaults: T): T {
  if (!isObj(defaults)) return (value === undefined || typeof value !== typeof defaults ? defaults : value) as T;
  const src = isObj(value) ? value : {};
  const out: Record<string, unknown> = { ...src };
  for (const k of Object.keys(defaults)) {
    const d = (defaults as Record<string, unknown>)[k];
    if (Array.isArray(d)) out[k] = Array.isArray(src[k]) ? src[k] : d;
    else if (isObj(d) && Object.keys(d).length === 0) out[k] = isObj(src[k]) ? src[k] : d;
    else out[k] = fill(src[k], d);
  }
  return out as T;
}

export function migrateProfile(raw: unknown, targetVersion = PROFILE_VERSION): Profile {
  if (!isObj(raw)) return defaultProfile();
  let obj: Record<string, unknown> = raw;
  let v = typeof obj.version === "number" ? obj.version : 0;
  if (v > targetVersion) {
    console.warn(`[store] profile version ${v} is newer than this build (${targetVersion}); using defaults for unknown fields`);
  }
  while (v < targetVersion) {
    const m = migrations[v];
    if (m) obj = m(obj);
    v++;
    obj.version = v;
  }
  const filled = fill(obj, defaultProfile());
  filled.version = targetVersion;
  return filled;
}

type ProfileListener = (p: Readonly<Profile>) => void;

export class ProfileStore {
  private profile: Profile;
  private readonly listeners: ProfileListener[] = [];
  private readonly storage: StorageLike | null;

  constructor(
    private readonly key = "hydra-surfers.profile",
    storage: StorageLike | null = safeStorage(),
  ) {
    this.storage = storage;
    this.profile = this.read();
  }

  get(): Readonly<Profile> {
    return this.profile;
  }

  /** Mutate through a callback; saves and notifies. */
  update(fn: (p: Profile) => void): void {
    fn(this.profile);
    this.save();
  }

  save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.profile));
    } catch (err) {
      console.warn("[store] save failed", err);
    }
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](this.profile);
  }

  reset(): void {
    this.profile = defaultProfile();
    this.save();
  }

  /** Replace from an exported JSON object (migrated). */
  import(raw: unknown): void {
    this.profile = migrateProfile(raw);
    this.save();
  }

  export(): Profile {
    return JSON.parse(JSON.stringify(this.profile)) as Profile;
  }

  subscribe(fn: ProfileListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private read(): Profile {
    try {
      const txt = this.storage?.getItem(this.key);
      if (!txt) return defaultProfile();
      return migrateProfile(JSON.parse(txt));
    } catch (err) {
      console.warn("[store] corrupt profile; starting fresh", err);
      return defaultProfile();
    }
  }
}
