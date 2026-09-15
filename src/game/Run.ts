/**
 * Run — owns one run: world, player, spawner, collisions, score. Steps every RunSystem in order.
 * The same Run object is reused for every run (pools stay warm); `goIdle()` shows the home state.
 *
 * Shared file: change additively. New systems register via game/systems.ts.
 */
import type { PerspectiveCamera, Scene } from "three";
import type { EventBus } from "../core/events";
import { Rng } from "../core/rng";
import { defineTuning } from "../core/tuning";
import type { AssetLibrary } from "../assets/AssetLibrary";
import type { Action } from "../input/actions";
import "./obstacles/builtin";
import "./powerups/PowerupSystem";
import "./hoverboard/Hoverboard";
import "./powerups/PickupSystem";
import "./powerups/effects";
import { Atmosphere } from "./world/Atmosphere";
import { Track } from "./world/Track";
import { Environment } from "./world/Environment";
import { PlayerController } from "./player/PlayerController";
import { PlayerAnimator } from "./player/PlayerAnimator";
import { RunCamera } from "./camera/RunCamera";
import { ObstacleSystem } from "./obstacles/ObstacleSystem";
import { Spawner } from "./spawn/Spawner";
import { CoinSystem } from "./collectibles/CoinSystem";
import { CollisionSystem } from "./collision/CollisionSystem";
import { Chaser } from "./chaser/Chaser";
import { ScoreSystem } from "./score/Score";
import { SPEED, speedAt } from "./spawn/difficulty";
import { DEFAULT_SCENARIO, getScenario } from "./spawn/scenarios";
import { createRegisteredSystems } from "./systems";
import type { ResolvedRunOptions, RunContext, RunState, RunSystem } from "./types";

export const RUN = defineTuning("run", "Run flow", {
  introSeconds: { default: 0.8, min: 0, max: 5, step: 0.05, label: "Intro (camera swing + speed-up)", unit: "s" },
  crashEndSeconds: { default: 1.1, min: 0, max: 6, step: 0.05, label: "Crash → results delay", unit: "s" },
  reviveGraceSeconds: { default: 2, min: 0, max: 10, step: 0.1, label: "Revive: no collisions for", unit: "s" },
  reviveClearAhead: { default: 70, min: 0, max: 300, step: 5, label: "Revive: clear obstacles this far ahead", unit: "m" },
});

export interface RunResult {
  score: number;
  coins: number;
  distance: number;
  time: number;
  seed: number;
  scenario: string;
  reason: string;
  /** Crash cause when reason === "crash" ("caught" = chaser caught the runner; else the obstacle/cheat). */
  cause: string;
  keys: number;
  revives: number;
}

declare module "../core/events" {
  interface EventMap {
    "run:idle": { seed: number };
    "run:start": { seed: number; scenario: string; skipIntro: boolean };
    /** An input action applied inside the sim tick (deterministic hook for other systems). */
    "run:action": { action: Action };
    "run:running": { time: number };
    "run:crash": { cause: string; distance: number };
    /** Accepted light bump; `caught` when it ends the run because the chaser was near. */
    "run:stumble": { cause: string; caught: boolean };
    "run:end": RunResult;
    "run:pause": { time: number };
    "run:resume": { time: number };
    "run:revive": { time: number; revives: number };
  }
}

const QUEUE_CAP = 32;
const evAction = { action: "tap" as Action };
const evCrash = { cause: "", distance: 0 };
const evStumble = { cause: "", caught: false };
const evTime = { time: 0 };

export interface RunDeps {
  bus: EventBus;
  assets: AssetLibrary;
  scene: Scene;
  camera3: PerspectiveCamera;
}

export class Run {
  readonly state: RunState = {
    mode: "idle",
    paused: false,
    seed: 1,
    scenario: DEFAULT_SCENARIO,
    time: 0,
    modeTime: 0,
    introT: 0,
    speed: 0,
    distance: 0,
    prevDistance: 0,
    score: 0,
    coins: 0,
    multiplier: 1,
    god: false,
    speedOverride: 0,
    endReason: "",
    crashCause: "",
    keys: 0,
    revives: 0,
    multiplierBonus: 0,
  };
  /**
   * Asked when a crash sequence finishes; return true to hold the run (paused, still "crashed") for a
   * revive offer, then call `revive()` or `declineRevive()`. Null/false = straight to results.
   */
  reviveOffer: ((state: Readonly<RunState>) => boolean) | null = null;
  /** True while a crashed run waits for the revive decision. */
  awaitingRevive = false;
  readonly ctx: RunContext;
  readonly player = new PlayerController();
  readonly camera = new RunCamera();
  readonly obstacles = new ObstacleSystem();
  readonly coins = new CoinSystem();
  readonly spawner = new Spawner();
  readonly chaser = new Chaser();
  private readonly systems: RunSystem[];
  private readonly byId = new Map<string, RunSystem>();
  private readonly queue: Action[] = new Array<Action>(QUEUE_CAP).fill("tap");
  private qHead = 0;
  private qLen = 0;
  private skipIntro = false;

  constructor(deps: RunDeps) {
    const rng = new Rng(1);
    const self = this;
    this.ctx = {
      bus: deps.bus,
      assets: deps.assets,
      scene: deps.scene,
      camera3: deps.camera3,
      rng,
      state: this.state,
      player: this.player,
      obstacles: this.obstacles,
      coins: this.coins,
      camera: this.camera,
      renderDistance: 0,
      renderAlpha: 1,
      crash: (cause: string) => self.crash(cause),
      stumble: (cause: string, bounce: boolean) => self.stumble(cause, bounce),
      getSystem: <T extends RunSystem>(id: string) => self.byId.get(id) as T | undefined,
    };
    this.systems = [
      new Atmosphere(),
      this.player,
      this.spawner,
      this.obstacles,
      this.coins,
      new CollisionSystem(),
      this.chaser,
      new ScoreSystem(),
      this.camera,
      new Track(),
      new Environment(),
      new PlayerAnimator(),
      ...createRegisteredSystems(),
    ].sort((a, b) => a.order - b.order);
    for (const s of this.systems) {
      if (this.byId.has(s.id)) console.warn(`[run] duplicate system id "${s.id}"`);
      this.byId.set(s.id, s);
    }
  }

  init(): void {
    for (const s of this.systems) s.init?.(this.ctx);
    this.goIdle(this.state.seed);
  }

  get active(): boolean {
    const m = this.state.mode;
    return m === "intro" || m === "running" || m === "crashed";
  }

  listSystems(): string[] {
    return this.systems.map((s) => `${s.order}:${s.id}`);
  }

  /**
   * Adds a system after construction (e.g. devtools overlays loaded by dynamic import). It is
   * initialised immediately (unless `init` is false, e.g. re-attaching a system taken out with
   * removeSystem) and slotted by `order`; systems registered before boot should use
   * game/systems.ts instead. Returns false when the id is taken.
   */
  addSystem(system: RunSystem, init = true): boolean {
    if (this.byId.has(system.id)) return false;
    if (init) system.init?.(this.ctx);
    let i = this.systems.length;
    while (i > 0 && this.systems[i - 1].order > system.order) i--;
    this.systems.splice(i, 0, system);
    this.byId.set(system.id, system);
    return true;
  }

  /** Removes a system added with addSystem (or any other) by id. */
  removeSystem(id: string): boolean {
    const s = this.byId.get(id);
    if (!s) return false;
    this.systems.splice(this.systems.indexOf(s), 1);
    this.byId.delete(id);
    return true;
  }

  /** Home state: runner idle on an empty track. */
  goIdle(seed = this.state.seed): void {
    const st = this.state;
    this.resetState(seed, DEFAULT_SCENARIO);
    st.mode = "idle";
    const opts: ResolvedRunOptions = { scenario: getScenario("flat-straight") ?? getScenario(DEFAULT_SCENARIO)!, seed, skipIntro: true };
    this.resetSystems(opts);
    this.ctx.bus.emit("run:idle", { seed });
  }

  start(opts: ResolvedRunOptions): void {
    this.resetState(opts.seed, opts.scenario.id);
    const st = this.state;
    this.skipIntro = opts.skipIntro || RUN.introSeconds <= 0;
    st.mode = this.skipIntro ? "running" : "intro";
    st.introT = this.skipIntro ? 1 : 0;
    st.speed = this.skipIntro ? speedAt(0) : SPEED.start * SPEED.introStartFactor;
    this.resetSystems(opts);
    this.ctx.bus.emit("run:start", { seed: opts.seed, scenario: opts.scenario.id, skipIntro: this.skipIntro });
  }

  pause(): void {
    if (this.state.paused || !this.active) return;
    this.state.paused = true;
    this.qLen = 0;
    evTime.time = this.state.time;
    this.ctx.bus.emit("run:pause", evTime);
  }

  resume(): void {
    if (!this.state.paused) return;
    this.state.paused = false;
    evTime.time = this.state.time;
    this.ctx.bus.emit("run:resume", evTime);
  }

  /** Ends the run immediately (results). */
  end(reason: string): void {
    const st = this.state;
    if (!this.active) return;
    st.mode = "ended";
    st.modeTime = 0;
    st.speed = 0;
    st.paused = false;
    st.endReason = reason;
    this.ctx.bus.emit("run:end", {
      score: st.score,
      coins: st.coins,
      distance: st.distance,
      time: st.time,
      seed: st.seed,
      scenario: st.scenario,
      reason,
      cause: st.crashCause,
      keys: st.keys,
      revives: st.revives,
    });
  }

  crash(cause: string): void {
    const st = this.state;
    if (st.god || (st.mode !== "running" && st.mode !== "intro")) return;
    const systems = this.systems;
    for (let i = 0; i < systems.length; i++) if (systems[i].absorbCrash?.(this.ctx, cause)) return;
    st.mode = "crashed";
    st.modeTime = 0;
    st.speed = 0;
    st.crashCause = cause;
    this.player.crash(cause);
    evCrash.cause = cause;
    evCrash.distance = st.distance;
    this.ctx.bus.emit("run:crash", evCrash);
  }

  /** Light bump (see collision/CollisionSystem.ts). Second bump while the chaser is near = caught. */
  stumble(cause: string, bounce: boolean): void {
    const st = this.state;
    if (st.mode !== "running" && st.mode !== "intro") return;
    const systems = this.systems;
    for (let i = 0; i < systems.length; i++) if (systems[i].absorbStumble?.(this.ctx, cause)) return;
    if (!this.player.stumble(cause, bounce)) return;
    const caught = this.chaser.onStumble() && !st.god;
    evStumble.cause = cause;
    evStumble.caught = caught;
    this.ctx.bus.emit("run:stumble", evStumble);
    if (caught) this.crash("caught");
  }

  /** Accept the revive offer: clears the crash site and continues the run with a short grace. */
  revive(): void {
    const st = this.state;
    if (!this.awaitingRevive) return;
    this.awaitingRevive = false;
    st.paused = false;
    st.revives++;
    st.mode = "running";
    st.modeTime = 0;
    st.crashCause = "";
    st.speed = st.speedOverride > 0 ? st.speedOverride : speedAt(st.time);
    this.obstacles.clearRange(st.distance - 30, st.distance + RUN.reviveClearAhead);
    this.player.revive(RUN.reviveGraceSeconds);
    this.chaser.nearT = 0;
    this.ctx.bus.emit("run:revive", { time: st.time, revives: st.revives });
  }

  /** Decline (or time out) the revive offer: the run ends normally. */
  declineRevive(): void {
    if (!this.awaitingRevive) return;
    this.awaitingRevive = false;
    this.state.paused = false;
    this.end("crash");
  }

  /** Queue an input action; applied at the start of the next fixed tick. */
  enqueue(action: Action): void {
    if (this.state.paused) return;
    if (this.qLen >= QUEUE_CAP) return;
    this.queue[(this.qHead + this.qLen) % QUEUE_CAP] = action;
    this.qLen++;
  }

  fixedUpdate(dt: number): void {
    const st = this.state;
    if (st.paused) return;
    st.prevDistance = st.distance;

    while (this.qLen > 0) {
      const action = this.queue[this.qHead];
      this.qHead = (this.qHead + 1) % QUEUE_CAP;
      this.qLen--;
      this.player.handleAction(action);
      evAction.action = action;
      this.ctx.bus.emit("run:action", evAction);
    }

    st.modeTime += dt;
    switch (st.mode) {
      case "intro": {
        st.time += dt;
        st.introT = Math.min(1, st.modeTime / RUN.introSeconds);
        const target = st.speedOverride > 0 ? st.speedOverride : speedAt(st.time);
        const k = st.introT * st.introT * (3 - 2 * st.introT);
        st.speed = target * (SPEED.introStartFactor + (1 - SPEED.introStartFactor) * k);
        if (st.introT >= 1) {
          st.mode = "running";
          st.modeTime = 0;
          evTime.time = st.time;
          this.ctx.bus.emit("run:running", evTime);
        }
        break;
      }
      case "running":
        st.time += dt;
        st.speed = st.speedOverride > 0 ? st.speedOverride : speedAt(st.time);
        break;
      case "crashed":
        st.speed = 0;
        if (st.modeTime >= RUN.crashEndSeconds) {
          if (this.reviveOffer?.(st)) {
            this.awaitingRevive = true;
            st.paused = true;
          } else {
            this.end("crash");
          }
        }
        break;
      default:
        st.speed = 0;
        break;
    }
    st.distance += st.speed * dt;

    const systems = this.systems;
    for (let i = 0; i < systems.length; i++) systems[i].fixedUpdate?.(this.ctx, dt);
  }

  render(alpha: number, frameDt: number): void {
    const st = this.state;
    const a = st.paused ? 1 : alpha;
    this.ctx.renderAlpha = a;
    this.ctx.renderDistance = st.prevDistance + (st.distance - st.prevDistance) * a;
    const systems = this.systems;
    for (let i = 0; i < systems.length; i++) systems[i].render?.(this.ctx, a, st.paused ? 0 : frameDt);
  }

  private resetState(seed: number, scenario: string): void {
    const st = this.state;
    st.paused = false;
    st.seed = seed >>> 0;
    st.scenario = scenario;
    st.time = 0;
    st.modeTime = 0;
    st.introT = 0;
    st.speed = 0;
    st.distance = 0;
    st.prevDistance = 0;
    st.score = 0;
    st.coins = 0;
    st.multiplier = 1;
    st.endReason = "";
    st.crashCause = "";
    st.keys = 0;
    st.revives = 0;
    this.awaitingRevive = false;
    this.qLen = 0;
    this.qHead = 0;
    this.ctx.rng.reseed(st.seed);
  }

  private resetSystems(opts: ResolvedRunOptions): void {
    for (const s of this.systems) s.reset?.(this.ctx, opts);
    for (const s of this.systems) s.afterReset?.(this.ctx, opts);
  }
}
