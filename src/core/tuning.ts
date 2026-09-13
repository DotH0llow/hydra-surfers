/**
 * Tuning registry. Every gameplay number lives here, registered by the owning system.
 * The in-game editor (src/dev) builds itself from `tuning.list()` — adding an entry needs
 * zero editor code.
 *
 * ```ts
 * export const PLAYER = defineTuning("player", "Player", {
 *   laneWidth: { default: 2.5, min: 1.5, max: 4, step: 0.05, label: "Lane spacing (m)" },
 * });
 * PLAYER.laneWidth // live number, updated in place by setTuning — zero-alloc reads
 * ```
 * Paths are `<group>.<key>` (e.g. `player.laneWidth`).
 */

export interface TuningField {
  default: number;
  min: number;
  max: number;
  step: number;
  label: string;
  /** Optional longer help text for the editor. */
  help?: string;
  /** Optional unit hint for display ("m", "s", "m/s", "px", "°"). */
  unit?: string;
}

export interface TuningEntry extends TuningField {
  path: string;
  group: string;
  groupLabel: string;
  key: string;
}

export type TuningValues<S extends Record<string, TuningField>> = { [K in keyof S]: number };

type ChangeListener = (path: string, value: number) => void;

class TuningRegistry {
  private readonly entries = new Map<string, TuningEntry>();
  private readonly targets = new Map<string, Record<string, number>>();
  private readonly listeners: ChangeListener[] = [];
  /** Values set before their group was registered (e.g. restored presets). */
  private readonly pending = new Map<string, number>();

  define<S extends Record<string, TuningField>>(group: string, groupLabel: string, schema: S): TuningValues<S> {
    if (group.includes(".")) throw new Error(`[tuning] group "${group}" must not contain "."`);
    let target = this.targets.get(group);
    if (!target) {
      target = {};
      this.targets.set(group, target);
    }
    for (const key of Object.keys(schema)) {
      const f = schema[key];
      const path = `${group}.${key}`;
      if (this.entries.has(path)) {
        console.warn(`[tuning] "${path}" registered twice; keeping the first definition`);
        continue;
      }
      if (!(f.min <= f.default && f.default <= f.max)) {
        console.warn(`[tuning] "${path}" default ${f.default} outside [${f.min}, ${f.max}]`);
      }
      this.entries.set(path, { ...f, path, group, groupLabel, key });
      const pendingValue = this.pending.get(path);
      target[key] = pendingValue ?? f.default;
      this.pending.delete(path);
    }
    return target as TuningValues<S>;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get(path: string): number | undefined {
    const e = this.entries.get(path);
    if (!e) return this.pending.get(path);
    return this.targets.get(e.group)![e.key];
  }

  /** Sets a value (clamped to the schema range). Unknown paths are kept pending and applied on registration. */
  set(path: string, value: number): boolean {
    if (typeof value !== "number" || Number.isNaN(value)) {
      console.warn(`[tuning] ignoring non-numeric value for "${path}"`, value);
      return false;
    }
    const e = this.entries.get(path);
    if (!e) {
      this.pending.set(path, value);
      return false;
    }
    const v = Math.min(e.max, Math.max(e.min, value));
    const target = this.targets.get(e.group)!;
    if (target[e.key] === v) return true;
    target[e.key] = v;
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](path, v);
    return true;
  }

  reset(path?: string): void {
    if (path) {
      const e = this.entries.get(path);
      if (e) this.set(path, e.default);
      return;
    }
    for (const e of this.entries.values()) this.set(e.path, e.default);
  }

  /** Schema entries in registration order. */
  list(): TuningEntry[] {
    return [...this.entries.values()];
  }

  groups(): string[] {
    return [...this.targets.keys()];
  }

  /** Flat `{path: value}` of every registered entry. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries.values()) out[e.path] = this.targets.get(e.group)![e.key];
    return out;
  }

  /** Only the entries that differ from their defaults (for presets). */
  overrides(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries.values()) {
      const v = this.targets.get(e.group)![e.key];
      if (v !== e.default) out[e.path] = v;
    }
    return out;
  }

  /** Applies a `{path: value}` object; returns the number of known paths applied. */
  load(values: Record<string, number>): number {
    let n = 0;
    for (const path of Object.keys(values)) if (this.set(path, values[path])) n++;
    return n;
  }

  subscribe(fn: ChangeListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}

export const tuning = new TuningRegistry();
export type { TuningRegistry };

export function defineTuning<S extends Record<string, TuningField>>(group: string, groupLabel: string, schema: S): TuningValues<S> {
  return tuning.define(group, groupLabel, schema);
}
