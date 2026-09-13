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
