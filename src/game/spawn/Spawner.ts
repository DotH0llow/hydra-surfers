/** Seeded chunk/pattern generator: keeps content generated `ahead` metres beyond the runner. */
import { defineTuning } from "../../core/tuning";
import { Rng, hash32 } from "../../core/rng";
import { COINS } from "../collectibles/CoinSystem";
import type { ObstacleInstance } from "../obstacles/ObstacleSystem";
import { PICKUPS, choosePickup, type PickupKind, type PickupSystem } from "../powerups/PickupSystem";
import type { ResolvedRunOptions, RunContext, RunSystem } from "../types";
import { LATE, SPEED, difficultyAt, distanceAtTime, lateAt, speedAt, timeAtDistance } from "./difficulty";
import { listPatterns, type SpawnApi } from "./patterns";
import type { BiomeSystem } from "../world/BiomeSystem";
import type { BiomeDef } from "../world/biomes";
import type { EventDirector, RunEventDef } from "../world/events";

/**
 * Salt for the spawner's private RNG stream. The track must be a pure function of the seed, so it
 * cannot share `ctx.rng` with gameplay: a jetpack trail or a bow roll draws from that stream, and
 * the layout after it would differ between two players on the same daily seed.
 */
const SPAWN_STREAM_SALT = 0x5ea9d;

export const SPAWN = defineTuning("spawn", "Spawner", {
  ahead: { default: 210, min: 40, max: 600, step: 5, label: "Generate ahead", unit: "m" },
  safeStart: { default: 50, min: 0, max: 300, step: 1, label: "Empty track at run start", unit: "m" },
  gapSecondsStart: { default: 1.25, min: 0.2, max: 5, step: 0.05, label: "Gap between patterns at start", unit: "s" },
  gapSecondsEnd: { default: 0.8, min: 0.2, max: 5, step: 0.05, label: "Gap between patterns at full difficulty", unit: "s" },
  gapJitter: { default: 0.25, min: 0, max: 1, step: 0.01, label: "Gap jitter (±fraction)" },
  minGap: { default: 9, min: 0, max: 60, step: 0.5, label: "Minimum gap", unit: "m" },
  minGapSeconds: {
    default: 0.65,
    min: 0,
    max: 3,
    step: 0.05,
    label: "Minimum gap in time",
    unit: "s",
    help: "Time to cross two lanes between patterns, so the open lane can switch sides fairly (tests/unit/fairness.test.ts)",
  },
});

/** The late game is announced like a road event (toast and horn). */
const evLate = { id: "late", name: "O cerco se fecha!" };

export class Spawner implements RunSystem, SpawnApi {
  readonly id = "spawner";
  readonly order = 30;
  /** Private stream (see SPAWN_STREAM_SALT): patterns draw from this, never from ctx.rng. */
  readonly rng = new Rng(1);
  difficulty = 0;
  speed = 0;
  /** Late-game pressure (0..1) at the placement distance. */
  late = 0;
  private lateAnnounced = false;
  private nextS = 0;
  private procedural = false;
  private layoutSpeedMul = 1;
  private weights = new Float64Array(16);
  private ctx!: RunContext;
  private biomes: BiomeSystem | undefined;
  /** Region the pattern currently being placed belongs to (drives weights and coin density). */
  private biome: BiomeDef | undefined;
  private events: EventDirector | undefined;
  /** Run event covering the pattern being placed (market day, ambush …), if any. */
  private event: RunEventDef | null = null;

  init(ctx: RunContext): void {
    this.ctx = ctx;
    // optional: lean test harnesses build a context without the system registry
    this.biomes = ctx.getSystem?.<BiomeSystem>("biomes");
    this.events = ctx.getSystem?.<EventDirector>("events");
  }

  reset(ctx: RunContext, opts: ResolvedRunOptions): void {
    this.rng.reseed(hash32(opts.seed ^ SPAWN_STREAM_SALT));
    this.difficulty = 0;
    this.late = 0;
    this.lateAnnounced = false;
    this.speed = speedAt(0);
    const sc = opts.scenario;
    const live = ctx.state.mode !== "idle";
    this.procedural = live && sc.procedural;
    this.nextS = sc.proceduralStart ?? SPAWN.safeStart;
    this.layoutSpeedMul = opts.layoutSpeedMul ?? 1;
  }

  /** Scenario layouts are placed after obstacle/coin pools have been cleared by their own reset. */
  afterReset(ctx: RunContext, opts: ResolvedRunOptions): void {
    if (ctx.state.mode !== "idle" && opts.scenario.build) opts.scenario.build(this);
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    if (!this.procedural || (st.mode !== "running" && st.mode !== "intro")) return;
    if (!this.lateAnnounced && st.distance >= distanceAtTime(LATE.startSeconds)) {
      this.lateAnnounced = true;
      ctx.bus.emit("event:start", evLate);
    }
    const pats = listPatterns();
    if (this.weights.length < pats.length) this.weights = new Float64Array(pats.length * 2);
    let guard = 0;
    while (this.nextS < st.distance + SPAWN.ahead && guard++ < 8) {
      // Difficulty and speed are read at the PLACEMENT distance on the nominal curve, so the whole
      // layout is a pure function of (seed, distance) — independent of how fast this particular
      // player is actually travelling (see timeAtDistance).
      const nominalTime = timeAtDistance(this.nextS);
      this.difficulty = Math.min(1, difficultyAt(nominalTime) + ctx.rules.startDifficulty);
      this.speed = Math.max(speedAt(nominalTime), SPEED.start);
      this.late = lateAt(nominalTime);
      // the region the pattern lands in decides what it is likely to be
      this.biome = this.biomes?.at(this.nextS);
      this.event = this.events?.at(this.nextS) ?? null;
      const biomeWeights = this.biome?.patternWeights;
      const eventWeights = this.event?.patternWeights;
      for (let i = 0; i < pats.length; i++) {
        const p = pats[i];
        // a pattern tied to regions is only placed there, unless the running event calls for it
        const favoured = (eventWeights?.[p.id] ?? 0) > 1;
        const regionOk = !p.biomes || favoured || !this.biome || p.biomes.includes(this.biome.id);
        let w = regionOk && this.difficulty >= p.minDifficulty && this.late >= (p.minLate ?? 0) ? p.weight() : 0;
        if (w > 0 && p.lateWeight !== undefined) w *= 1 + (p.lateWeight - 1) * this.late;
        if (w > 0 && biomeWeights) w *= biomeWeights[p.id] ?? 1;
        if (w > 0 && eventWeights) w *= eventWeights[p.id] ?? 1;
        this.weights[i] = w;
      }
      const idx = this.rng.weighted(this.weights, pats.length);
      const used = idx >= 0 ? pats[idx].place(this, this.nextS) : 10;
      const gapT = SPAWN.gapSecondsStart + (SPAWN.gapSecondsEnd - SPAWN.gapSecondsStart) * this.difficulty;
      // the floor uses the mode's speed, not the build's, so every player on a daily seed gets the
      // same road
      const floor = Math.max(SPAWN.minGap, this.speed * this.layoutSpeedMul * SPAWN.minGapSeconds);
      const lateGap = 1 + (LATE.gapMul - 1) * this.late;
      const gap = Math.max(floor, this.speed * gapT * (1 + this.rng.range(-SPAWN.gapJitter, SPAWN.gapJitter)) * ctx.rules.obstacleGapMul * lateGap * (this.event?.gapMul ?? 1));
      // pickups sit in the open gap after a pattern. All three draws happen whether or not the
      // pickup appears: a build with more pickups must not shift the rest of the road.
      if (idx >= 0) {
        const roll = this.rng.next();
        const kind = choosePickup(this.rng, this.difficulty);
        const lane = this.rng.int(-1, 1);
        if (roll < PICKUPS.chance * ctx.rules.pickupChanceMul) this.pickup(kind, lane, this.nextS + used + gap * 0.5);
      }
      this.nextS += used + gap;
    }
  }

  // ------------------------------------------------------------------ SpawnApi

  obstacle(typeId: string, lane: number, s: number, length?: number, speed?: number): ObstacleInstance | null {
    return this.ctx.obstacles.spawn(typeId, lane, s, length, speed);
  }

  /** Continue procedural generation from track position `s` (dev warp). */
  restartAt(s: number): void {
    this.nextS = s;
  }

  pickup(kind: PickupKind, lane: number, s: number, y?: number): void {
    this.ctx.getSystem?.<PickupSystem>("pickups")?.spawn(kind, lane, s, y);
  }

  coin(lane: number, s: number, y?: number): void {
    this.ctx.coins.spawn(lane, s, y ?? COINS.height);
  }

  coinLine(lane: number, s: number, count: number, spacing = COINS.spacing, y = COINS.height): void {
    // coinDensityMul stretches every line, so a market-fair mutator needs no pattern of its own,
    // and each region leans richer or leaner on top of it
    const n = Math.max(1, Math.round(count * this.ctx.rules.coinDensityMul * (this.biome?.coinMul ?? 1) * (this.event?.coinMul ?? 1)));
    for (let i = 0; i < n; i++) this.ctx.coins.spawn(lane, s + i * spacing, y);
  }

  coinArc(lane: number, sCenter: number, count: number, spacing: number, peak: number): void {
    const half = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const u = half > 0 ? (i - half) / half : 0;
      this.ctx.coins.spawn(lane, sCenter + (i - half) * spacing, COINS.height + peak * (1 - u * u));
    }
  }
}
