/**
 * Persistent player profile (localStorage), versioned with forward migrations.
 *
 * Bump PROFILE_VERSION and append a migration whenever the shape changes; migrations receive
 * the raw object of the previous version and must return the next version's object.
 * Modules that need their own persisted data can use `profile.ext[<moduleId>]`.
 */

export interface Profile {
  version: number;
  currencies: { coins: number; keys: number; boards: number };
  owned: { characters: string[]; boards: string[] };
  equipped: { character: string; board: string };
  stats: { bestScore: number; bestDistance: number; totalCoins: number; runs: number; totalDistance: number };
  missions: { set: number; progress: Record<string, number>; completed: string[] };
  settings: { music: number; sfx: number; muted: boolean; reducedMotion: boolean };
  /** Free-form per-module storage, e.g. ext["upgrades"]. */
  ext: Record<string, unknown>;
}

export const PROFILE_VERSION = 1;

export function defaultProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    currencies: { coins: 0, keys: 0, boards: 3 },
    owned: { characters: ["char.runner.default"], boards: [] },
    equipped: { character: "char.runner.default", board: "" },
    stats: { bestScore: 0, bestDistance: 0, totalCoins: 0, runs: 0, totalDistance: 0 },
    missions: { set: 1, progress: {}, completed: [] },
    settings: { music: 0.7, sfx: 0.9, muted: false, reducedMotion: false },
    ext: {},
  };
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a version-n object to version n+1. */
const migrations: Record<number, Migration> = {
  // 1: (raw) => ({ ...raw, version: 2, newField: 0 }),
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const k = "__yd_probe";
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
    private readonly key = "yard-dash.profile",
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
