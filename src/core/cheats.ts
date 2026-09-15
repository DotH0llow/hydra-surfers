/**
 * Cheat registry. The dev cheats panel (src/dev) lists these; `window.__game.cheat(name, ...args)`
 * calls the same functions. Systems register their own cheats additively.
 */

export interface CheatArg {
  name: string;
  kind: "number" | "boolean" | "string";
  default?: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface CheatDef {
  name: string;
  label: string;
  group: string;
  args?: CheatArg[];
  /** Returns an optional JSON-serialisable result. */
  run: (...args: unknown[]) => unknown;
}

const cheats = new Map<string, CheatDef>();

export function registerCheat(def: CheatDef): void {
  if (cheats.has(def.name)) console.warn(`[cheats] "${def.name}" re-registered; replacing`);
  cheats.set(def.name, def);
}

export function runCheat(name: string, ...args: unknown[]): unknown {
  const def = cheats.get(name);
  if (!def) {
    throw new Error(`[cheats] unknown cheat "${name}". Known: ${[...cheats.keys()].join(", ")}`);
  }
  return def.run(...args);
}

export function listCheats(): CheatDef[] {
  return [...cheats.values()];
}

/**
 * Unlock sources for the `unlockAll` dev cheat. A module that owns unlockable content (e.g. the
 * meta catalog) registers a function that marks all of its items owned on the given profile
 * object. `unlockAll` runs every source inside one `store.update`. Typed loosely so core does not
 * depend on the profile shape.
 */
export type UnlockSource = (profile: unknown) => void;
const unlockSources = new Map<string, UnlockSource>();

export function registerUnlockSource(id: string, source: UnlockSource): void {
  unlockSources.set(id, source);
}

export function listUnlockSources(): Array<[string, UnlockSource]> {
  return [...unlockSources.entries()];
}
