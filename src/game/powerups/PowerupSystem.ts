/**
 * Runs power-up timers for every registered def (./registry.ts), emits powerup:start / powerup:end,
 * and reports `activePowerups` for window.__game.getState(). Lane B owns; extend additively.
 */
import { registerCheat } from "../../core/cheats";
import { registerRunSystem } from "../systems";
import type { RunContext, RunSystem } from "../types";
import { listPowerups, type PowerupDef } from "./registry";

declare module "../../core/events" {
  interface EventMap {
    "powerup:start": { id: string; duration: number; refreshed: boolean };
    "powerup:end": { id: string; reason: "expired" | "cleared" };
  }
}

export interface ActivePowerup {
  id: string;
  remaining: number;
  duration: number;
}

interface Slot {
  def: PowerupDef;
  active: boolean;
  remaining: number;
  duration: number;
}

const evStart = { id: "", duration: 0, refreshed: false };
const evEnd: { id: string; reason: "expired" | "cleared" } = { id: "", reason: "expired" };

export class PowerupSystem implements RunSystem {
  readonly id = "powerups";
  readonly order = 55;
  private readonly slots: Slot[] = [];
  private ctx: RunContext | null = null;

  init(ctx: RunContext): void {
    this.ctx = ctx;
    this.syncSlots();
    registerCheat({
      name: "powerup",
      label: "Give power-up",
      group: "Power-ups",
      args: [{ name: "id", kind: "string", default: "magnet", options: listPowerups().map((d) => d.id) }],
      run: (id) => this.activate(String(id ?? "magnet")),
    });
    registerCheat({ name: "clearPowerups", label: "Clear power-ups", group: "Power-ups", run: () => this.clear(true) });
  }

  /** Starts (or refreshes) a power-up. Only while running. Returns false for unknown ids / not running. */
  activate(id: string): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const mode = ctx.state.mode;
    if (mode !== "running" && mode !== "intro") return false;
    this.syncSlots();
    const slot = this.slots.find((s) => s.def.id === id);
    if (!slot) {
      console.warn(`[powerups] unknown power-up "${id}"`);
      return false;
    }
    const refreshed = slot.active;
    slot.duration = Math.max(0, slot.def.duration());
    slot.remaining = slot.duration;
    slot.active = true;
    if (!refreshed) slot.def.onStart?.(ctx);
    evStart.id = id;
    evStart.duration = slot.duration;
    evStart.refreshed = refreshed;
    ctx.bus.emit("powerup:start", evStart);
    return true;
  }

  isActive(id: string): boolean {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].def.id === id) return this.slots[i].active;
    return false;
  }

  reset(ctx: RunContext): void {
    this.ctx = ctx;
    this.clear(false);
  }

  fixedUpdate(ctx: RunContext, dt: number): void {
    const mode = ctx.state.mode;
    if (mode !== "running" && mode !== "intro") return; // timers freeze during the crash sequence
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.active) continue;
      s.def.onTick?.(ctx, dt, s.remaining);
      s.remaining -= dt;
      if (s.remaining <= 0) this.end(ctx, s, "expired", true);
    }
  }

  /** Plain JSON for getState(). */
  snapshot(): ActivePowerup[] {
    const out: ActivePowerup[] = [];
    for (const s of this.slots) if (s.active) out.push({ id: s.def.id, remaining: Math.max(0, s.remaining), duration: s.duration });
    return out;
  }

  private clear(emit: boolean): number {
    const ctx = this.ctx;
    let n = 0;
    if (!ctx) return n;
    for (const s of this.slots) {
      if (!s.active) continue;
      this.end(ctx, s, "cleared", emit);
      n++;
    }
    return n;
  }

  private end(ctx: RunContext, s: Slot, reason: "expired" | "cleared", emit: boolean): void {
    s.active = false;
    s.remaining = 0;
    s.def.onEnd?.(ctx);
    if (!emit) return;
    evEnd.id = s.def.id;
    evEnd.reason = reason;
    ctx.bus.emit("powerup:end", evEnd);
  }

  /** Picks up defs registered after this system was created. */
  private syncSlots(): void {
    for (const def of listPowerups()) {
      const existing = this.slots.find((s) => s.def.id === def.id);
      if (existing) existing.def = def;
      else this.slots.push({ def, active: false, remaining: 0, duration: 0 });
    }
  }
}

registerRunSystem(() => new PowerupSystem());
