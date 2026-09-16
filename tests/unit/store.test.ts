import { describe, expect, it, vi } from "vitest";
import { PROFILE_VERSION, ProfileStore, defaultProfile, migrateProfile, type StorageLike } from "../../src/core/store";

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe("profile store + migrations", () => {
  it("starts from defaults with the current version", () => {
    const s = new ProfileStore("k", new MemStorage());
    expect(s.get()).toEqual(defaultProfile());
    expect(s.get().version).toBe(PROFILE_VERSION);
  });

  it("persists updates and reloads them", () => {
    const mem = new MemStorage();
    const a = new ProfileStore("k", mem);
    a.update((p) => {
      p.currencies.coins = 120;
      p.owned.mounts.push("mount.basic");
      p.ext.upgrades = { magnet: 2 };
    });
    const b = new ProfileStore("k", mem);
    expect(b.get().currencies.coins).toBe(120);
    expect(b.get().owned.mounts).toEqual(["mount.basic"]);
    expect(b.get().ext).toEqual({ upgrades: { magnet: 2 } });
  });

  it("migrates a legacy (version 0 / unversioned) object by deep-filling defaults", () => {
    const legacy = { currencies: { coins: 55 }, stats: { bestScore: 900 }, somethingOld: true };
    const p = migrateProfile(legacy);
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.currencies).toEqual({ coins: 55, keys: 0, mounts: 3 });
    expect(p.stats.bestScore).toBe(900);
    expect(p.stats.runs).toBe(0);
    expect(p.settings).toEqual(defaultProfile().settings);
    expect((p as unknown as Record<string, unknown>).somethingOld).toBe(true); // unknown keys kept
  });

  it("replaces wrong-typed fields with defaults", () => {
    const p = migrateProfile({ version: PROFILE_VERSION, currencies: { coins: "lots", keys: 3 }, owned: { characters: "nope" }, ext: [] });
    expect(p.currencies).toEqual({ coins: 0, keys: 3, mounts: 3 });
    expect(p.owned.characters).toEqual(defaultProfile().owned.characters);
    expect(p.ext).toEqual({});
  });

  it("handles garbage and corrupt JSON without throwing", () => {
    expect(migrateProfile(null)).toEqual(defaultProfile());
    expect(migrateProfile([1, 2])).toEqual(defaultProfile());
    const mem = new MemStorage();
    mem.setItem("k", "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(new ProfileStore("k", mem).get()).toEqual(defaultProfile());
    warn.mockRestore();
  });

  it("migrates a v1 profile: hoverboards become mounts, progression is filled in", () => {
    const v1 = {
      version: 1,
      currencies: { coins: 900, keys: 4, boards: 7 },
      owned: { characters: ["char.runner.default", "char.runner.nova"], boards: ["gear.hoverboard.flame"] },
      equipped: { character: "char.runner.nova", board: "gear.hoverboard.flame" },
      stats: { bestScore: 4200, bestDistance: 1800, totalCoins: 5000, runs: 12, totalDistance: 9000 },
      missions: { set: 3, progress: { "3:jumps": 4 }, completed: [] },
      settings: { music: 0.5, sfx: 0.4, muted: true, reducedMotion: false },
      ext: { upgrades: { magnet: 3 } },
    };
    const p = migrateProfile(v1);
    expect(p.version).toBe(PROFILE_VERSION);
    // renamed, with the old keys gone
    expect(p.currencies).toEqual({ coins: 900, keys: 4, mounts: 7 });
    expect(p.owned.mounts).toEqual(["gear.hoverboard.flame"]);
    expect(p.equipped.mount).toBe("gear.hoverboard.flame");
    expect((p.currencies as unknown as Record<string, unknown>).boards).toBeUndefined();
    expect((p.owned as unknown as Record<string, unknown>).boards).toBeUndefined();
    expect((p.equipped as unknown as Record<string, unknown>).board).toBeUndefined();
    // everything the player had is still there
    expect(p.owned.characters).toEqual(["char.runner.default", "char.runner.nova"]);
    expect(p.equipped.character).toBe("char.runner.nova");
    expect(p.stats.bestScore).toBe(4200);
    expect(p.missions).toEqual({ set: 3, progress: { "3:jumps": 4 }, completed: [] });
    expect(p.settings.muted).toBe(true);
    expect(p.ext).toEqual({ upgrades: { magnet: 3 } });
    // new v2 fields exist with their defaults, and starter equipment is equipped
    expect(p.progress).toEqual(defaultProfile().progress);
    expect(p.equipped.weapon).toBe("weapon.sword");
    expect(p.contracts).toEqual({ progress: {}, claimed: [] });
    expect(p.social.registered).toBe(false);
    expect(p.settings.analytics).toBe(true);
  });

  it("walks the migration chain in order (future versions)", () => {
    // Simulate a v2 build: migrations[1] must receive a v1 object and return v2.
    const calls: number[] = [];
    const fakeChain = (raw: Record<string, unknown>, target: number) => {
      let obj = raw;
      let v = typeof obj.version === "number" ? obj.version : 0;
      const chain: Record<number, (r: Record<string, unknown>) => Record<string, unknown>> = {
        1: (r) => (calls.push(1), { ...r, renamed: r.oldName }),
      };
      while (v < target) {
        if (chain[v]) obj = chain[v](obj);
        v++;
        obj.version = v;
      }
      return obj;
    };
    const out = fakeChain({ version: 1, oldName: "x" }, 2);
    expect(calls).toEqual([1]);
    expect(out).toMatchObject({ version: 2, renamed: "x" });
    // and the real migrator clamps newer-version profiles to this build's version, keeping data
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const newer = migrateProfile({ version: PROFILE_VERSION + 5, currencies: { coins: 9, keys: 1 } });
    expect(newer.version).toBe(PROFILE_VERSION);
    expect(newer.currencies.coins).toBe(9);
    warn.mockRestore();
  });

  it("export is a deep copy; import migrates; reset restores defaults; subscribers fire", () => {
    const s = new ProfileStore("k", new MemStorage());
    const seen: number[] = [];
    const off = s.subscribe((p) => seen.push(p.currencies.coins));
    s.update((p) => (p.currencies.coins = 10));
    const ex = s.export();
    ex.currencies.coins = 999;
    expect(s.get().currencies.coins).toBe(10);
    s.import({ currencies: { coins: 77 } });
    expect(s.get().currencies.coins).toBe(77);
    expect(s.get().version).toBe(PROFILE_VERSION);
    s.reset();
    off();
    s.update((p) => (p.currencies.coins = 5));
    expect(seen).toEqual([10, 77, 0]);
  });

  it("works without storage (private mode)", () => {
    const s = new ProfileStore("k", null);
    s.update((p) => (p.currencies.keys = 2));
    expect(s.get().currencies.keys).toBe(2);
  });
});
