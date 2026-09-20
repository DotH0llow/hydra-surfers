/**
 * Run events and weather — short stretches of road where the kingdom changes the rules.
 *
 * Deliberately NOT scripted content: an event is a named bundle of multipliers the spawner and
 * the atmosphere already understand (pattern weights, gap, coin density, light), so a market day
 * or an ambush is recombined out of what exists instead of being built. They last a couple of
 * hundred metres and are announced when the runner enters them.
 *
 * Where they happen is a pure function of (seed, distance) on their own stream, like biomes, so a
 * daily run's events are the same for everybody. `rules.eventChanceMul` scales how often they fire.
 *
 * Weather is the run-wide mood (clear, sunset, fog, night, rain): picked from the seed unless the
 * mode forces one, and visual only.
 */
import { defineTuning } from "../../core/tuning";
import { hash32 } from "../../core/rng";
import { registerRunSystem } from "../systems";
import type { ResolvedRunOptions, RunContext, RunSystem } from "../types";

export const EVENTS = defineTuning("events", "Run events & weather", {
  firstAt: { default: 350, min: 0, max: 3000, step: 25, label: "No event before", unit: "m" },
  slotMetres: { default: 480, min: 100, max: 3000, step: 20, label: "One event roll every", unit: "m" },
  chance: { default: 0.35, min: 0, max: 1, step: 0.01, label: "Chance a slot holds an event" },
  length: { default: 220, min: 40, max: 1000, step: 10, label: "Event length", unit: "m" },
  weatherChance: { default: 0.35, min: 0, max: 1, step: 0.01, label: "Chance a run has non-clear weather" },
});

/** How an event or weather tints the light (applied on top of the region). */
export interface Mood {
  /** Multiplies light intensities (1 = unchanged). */
  light: number;
  /** Multiplies fog distances (<1 = thicker). */
  fog: number;
  /** Colour the sky and fog lean toward, and how much (0..1). */
  tint: string;
  tintAmount: number;
  /** Rain streaks, 0..1 (see Rain.ts); omitted = dry. */
  rain?: number;
}

export interface RunEventDef {
  id: string;
  name: string;
  weight: number;
  /** Multiplies these pattern weights while active. */
  patternWeights?: Record<string, number>;
  gapMul?: number;
  coinMul?: number;
  mood?: Mood;
}

export const RUN_EVENTS: readonly RunEventDef[] = [
  { id: "feira", name: "Dia de Feira!", weight: 1.2, coinMul: 2.2, gapMul: 0.85, patternWeights: { barricadeSingle: 1.6, barricadeDouble: 1.4, coinRun: 1.8 } },
  { id: "emboscada", name: "Emboscada!", weight: 1, gapMul: 0.72, patternWeights: { beamSingle: 1.6, barricadeMixed: 1.8, barricadeRow: 1.4 } },
  { id: "carrocas", name: "Carroças soltas!", weight: 0.9, patternWeights: { runawayCart: 4, wagonDouble: 0.6 } },
  { id: "tempestade", name: "Tempestade", weight: 0.8, gapMul: 1.1, mood: { light: 0.55, fog: 0.5, tint: "#3d4a5c", tintAmount: 0.55, rain: 1 } },
  { id: "cavaleiros", name: "Cavaleiros!", weight: 0.9, patternWeights: { knightCharge: 6, wagonDouble: 0.5, coinRun: 0.6 } },
  { id: "portao", name: "Fechem os portões!", weight: 0.8, patternWeights: { closingGate: 6, barricadeSingle: 0.6 } },
  { id: "invasao", name: "Invasão!", weight: 0.7, gapMul: 0.85, patternWeights: { knightCharge: 2.5, runawayCart: 2, barricadeRow: 1.5, coinRun: 0.4 }, mood: { light: 0.8, fog: 0.8, tint: "#8a4a2a", tintAmount: 0.35 } },
  { id: "dragao", name: "Dragão!", weight: 0.5, gapMul: 1.15, patternWeights: { dragonFire: 8, coinRun: 0.4, wagonDouble: 0.4 }, mood: { light: 0.7, fog: 0.75, tint: "#7a3a1e", tintAmount: 0.45 } },
  { id: "ponte", name: "Ponte quebrada!", weight: 0.7, patternWeights: { brokenBridge: 6, wagonDouble: 0.5, wagonRamp: 0.5 } },
  { id: "neblina", name: "Neblina", weight: 0.8, mood: { light: 0.85, fog: 0.35, tint: "#c8cfd6", tintAmount: 0.6 } },
];

export const WEATHER: Record<string, Mood> = {
  clear: { light: 1, fog: 1, tint: "#ffffff", tintAmount: 0 },
  sunset: { light: 0.85, fog: 0.9, tint: "#e8925a", tintAmount: 0.45 },
  fog: { light: 0.9, fog: 0.45, tint: "#c8cfd6", tintAmount: 0.55 },
  night: { light: 0.35, fog: 0.7, tint: "#1a2238", tintAmount: 0.8 },
  rain: { light: 0.6, fog: 0.55, tint: "#4a5566", tintAmount: 0.5, rain: 0.6 },
};

const RANDOM_WEATHER = ["sunset", "fog", "night", "rain"] as const;
const EVENT_SALT = 0xe7e7;
const WEATHER_SALT = 0x3ea7;

declare module "../../core/events" {
  interface EventMap {
    /** The runner entered a run event (announced on the HUD). */
    "event:start": { id: string; name: string };
  }
}

const evStart = { id: "", name: "" };

export class EventDirector implements RunSystem {
  readonly id = "events";
  readonly order = 6;
  /** Run-wide weather mood. */
  weather: Mood = WEATHER.clear;
  weatherId = "clear";
  private seed = 1;
  private chanceMul = 1;
  private announced = -1;

  reset(ctx: RunContext, opts: ResolvedRunOptions): void {
    this.seed = hash32(opts.seed ^ EVENT_SALT);
    this.chanceMul = ctx.rules.eventChanceMul;
    this.announced = -1;
    const forced = opts.weather && WEATHER[opts.weather] ? opts.weather : null;
    if (forced) this.weatherId = forced;
    else {
      const h = hash32(opts.seed ^ WEATHER_SALT);
      this.weatherId = (h % 1000) / 1000 < EVENTS.weatherChance ? RANDOM_WEATHER[(h >>> 10) % RANDOM_WEATHER.length] : "clear";
    }
    // the home screen stays clear
    if (ctx.state.mode === "idle") this.weatherId = "clear";
    this.weather = WEATHER[this.weatherId];
  }

  /** The event covering a track position, if any (the spawner asks at the placement distance). */
  at(s: number): RunEventDef | null {
    const slot = this.slotAt(s);
    if (slot < 0) return null;
    const start = EVENTS.firstAt + slot * EVENTS.slotMetres;
    if (s < start || s >= start + EVENTS.length) return null;
    return this.eventOf(slot);
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    if (st.mode !== "running") return;
    const slot = this.slotAt(st.distance);
    if (slot < 0 || slot === this.announced) return;
    const ev = this.at(st.distance);
    if (!ev) return;
    this.announced = slot;
    evStart.id = ev.id;
    evStart.name = ev.name;
    ctx.bus.emit("event:start", evStart);
  }

  private slotAt(s: number): number {
    if (s < EVENTS.firstAt || EVENTS.slotMetres <= 0) return -1;
    return Math.floor((s - EVENTS.firstAt) / EVENTS.slotMetres);
  }

  private eventOf(slot: number): RunEventDef | null {
    const h = hash32(this.seed ^ Math.imul(slot + 1, 0x9e3779b1));
    if ((h % 10000) / 10000 >= Math.min(1, EVENTS.chance * this.chanceMul)) return null;
    let total = 0;
    for (const e of RUN_EVENTS) total += e.weight;
    let r = ((h >>> 14) % 10000) / 10000 * total;
    for (const e of RUN_EVENTS) {
      if (r < e.weight) return e;
      r -= e.weight;
    }
    return RUN_EVENTS[RUN_EVENTS.length - 1];
  }
}

registerRunSystem(() => new EventDirector());
