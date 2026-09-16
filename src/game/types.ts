/**
 * Shared run types. A run is a set of RunSystems stepped in `order` by Run.ts.
 * Lanes add systems via `registerRunSystem` (game/systems.ts) instead of editing Run.ts.
 */
import type { PerspectiveCamera, Scene } from "three";
import type { EventBus } from "../core/events";
import type { Rng } from "../core/rng";
import type { RunRules } from "./rules";
import type { AssetLibrary } from "../assets/AssetLibrary";
import type { PlayerController } from "./player/PlayerController";
import type { ObstacleInstance, ObstacleSystem } from "./obstacles/ObstacleSystem";
import type { CoinSystem } from "./collectibles/CoinSystem";
import type { RunCamera } from "./camera/RunCamera";
import type { Scenario } from "./spawn/scenarios";

export type RunMode = "idle" | "intro" | "running" | "crashed" | "ended";

export interface RunState {
  mode: RunMode;
  paused: boolean;
  seed: number;
  scenario: string;
  /** Seconds of run time (intro + running). */
  time: number;
  /** Seconds spent in the current mode. */
  modeTime: number;
  /** 0..1 progress through the intro (1 once running). */
  introT: number;
  speed: number;
  distance: number;
  prevDistance: number;
  score: number;
  coins: number;
  multiplier: number;
  /** Cheat: collisions never crash. */
  god: boolean;
  /** Cheat: fixed forward speed when > 0. */
  speedOverride: number;
  /**
   * Temporary slow-down of the road (hourglass). Scoring divides by it, so slowing down costs no
   * points: it buys reaction time, not score.
   */
  speedScale: number;
  endReason: string;
  crashCause: string;
  /** Keys picked up this run (banked to the profile as they are collected). */
  keys: number;
  /** Revives used this run. */
  revives: number;
  /** Permanent score multiplier bonus from completed mission sets (set by the app before a run). */
  multiplierBonus: number;
}

export interface StartRunOptions {
  scenario?: string;
  seed?: number;
  skipIntro?: boolean;
}

export interface ResolvedRunOptions {
  scenario: Scenario;
  seed: number;
  skipIntro: boolean;
  /** Modifiers for this run (mode mutators + equipped build). Defaults to neutral rules. */
  rules?: RunRules;
  /** Restrict the run to these biome ids (a challenge may); undefined = the full rotation. */
  biomes?: string[];
  /** Force a weather state for the whole run instead of letting the director pick. */
  weather?: string;
}

export interface RunContext {
  readonly bus: EventBus;
  readonly assets: AssetLibrary;
  readonly scene: Scene;
  readonly camera3: PerspectiveCamera;
  /** Gameplay RNG (reseeded per run). Visual-only randomness must hash the seed instead. */
  readonly rng: Rng;
  /**
   * This run's modifiers (see game/rules.ts). Replaced by Run at the start of every run and
   * treated as read-only by systems, so a run stays reproducible from seed + rules + inputs.
   */
  rules: RunRules;
  readonly state: RunState;
  readonly player: PlayerController;
  readonly obstacles: ObstacleSystem;
  readonly coins: CoinSystem;
  readonly camera: RunCamera;
  /** Interpolated distance for the frame being rendered. */
  renderDistance: number;
  /** Interpolation alpha for the frame being rendered. */
  renderAlpha: number;
  /**
   * The obstacle behind the crash/stumble currently being resolved, set by the collision system
   * just before it asks systems to absorb it. Null for causes with no obstacle ("wall", "caught").
   */
  lastHit: ObstacleInstance | null;
  /** Request a crash (ignored in god mode or when not running). */
  crash(cause: string): void;
  /** Light bump: stumbles the runner (optional bounce back); caught if the chaser is near. */
  stumble(cause: string, bounce: boolean): void;
  getSystem<T extends RunSystem>(id: string): T | undefined;
}

export interface RunSystem {
  readonly id: string;
  /**
   * Lower runs first, for both fixedUpdate and render.
   * Built-ins: atmosphere 5, player 20, spawner 30, obstacles 40, coins 50, collision 60,
   * chaser 70, score 80, camera 90, track 100, environment 101, playerView 110.
   */
  readonly order: number;
  /** Once, after assets are ready (create meshes, pools, subscriptions). */
  init?(ctx: RunContext): void;
  /** At every run start and when returning to idle (home). */
  reset?(ctx: RunContext, opts: ResolvedRunOptions): void;
  /**
   * After EVERY system has reset (in order). Place initial content here (e.g. scenario layouts),
   * otherwise a later system's reset (obstacles/coins pools) would clear it.
   */
  afterReset?(ctx: RunContext, opts: ResolvedRunOptions): void;
  /** Deterministic sim step (fixed dt). Must not allocate. */
  fixedUpdate?(ctx: RunContext, dt: number): void;
  /** Visual update. Must not mutate sim state. Must not allocate. */
  render?(ctx: RunContext, alpha: number, frameDt: number): void;
  /** Asked (in order) before a crash is applied; return true to absorb it (e.g. hoverboard). */
  absorbCrash?(ctx: RunContext, cause: string): boolean;
  /** Asked (in order) before a light stumble is applied; return true to absorb it (e.g. dev no-clip). */
  absorbStumble?(ctx: RunContext, cause: string): boolean;
}

/** Axis-aligned box in sim space (x lateral, y up, s forward). */
export interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minS: number;
  maxS: number;
}

export function makeAabb(): Aabb {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0, minS: 0, maxS: 0 };
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minS < b.maxS && a.maxS > b.minS;
}
