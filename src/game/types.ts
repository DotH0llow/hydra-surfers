/**
 * Shared run types. A run is a set of RunSystems stepped in `order` by Run.ts.
 * Lanes add systems via `registerRunSystem` (game/systems.ts) instead of editing Run.ts.
 */
import type { PerspectiveCamera, Scene } from "three";
import type { EventBus } from "../core/events";
import type { Rng } from "../core/rng";
import type { AssetLibrary } from "../assets/AssetLibrary";
import type { PlayerController } from "./player/PlayerController";
import type { ObstacleSystem } from "./obstacles/ObstacleSystem";
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
  endReason: string;
  crashCause: string;
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
}

export interface RunContext {
  readonly bus: EventBus;
  readonly assets: AssetLibrary;
  readonly scene: Scene;
  readonly camera3: PerspectiveCamera;
  /** Gameplay RNG (reseeded per run). Visual-only randomness must hash the seed instead. */
  readonly rng: Rng;
  readonly state: RunState;
  readonly player: PlayerController;
  readonly obstacles: ObstacleSystem;
  readonly coins: CoinSystem;
  readonly camera: RunCamera;
  /** Interpolated distance for the frame being rendered. */
  renderDistance: number;
  /** Interpolation alpha for the frame being rendered. */
  renderAlpha: number;
  /** Request a crash (ignored in god mode or when not running). */
  crash(cause: string): void;
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
  /** Deterministic sim step (fixed dt). Must not allocate. */
  fixedUpdate?(ctx: RunContext, dt: number): void;
  /** Visual update. Must not mutate sim state. Must not allocate. */
  render?(ctx: RunContext, alpha: number, frameDt: number): void;
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
