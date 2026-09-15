/**
 * PlayerController — deterministic sim state machine.
 *
 * Orthogonal channels:
 *  - lateral: lane target + eased switch (re-targets instantly on every left/right, incl. reversal)
 *  - vertical: grounded | airborne (jump with gravity, swipe-down fast fall)
 *  - posture: running | rolling
 * Top-level `state` for reporting/animation: idle | run | jump | roll | crash.
 *
 * Buffering: jump pressed while airborne is buffered for `jumpBufferSeconds` and fires on landing;
 * roll pressed while airborne triggers fast fall and (optionally) a roll on landing. Lane changes
 * never need buffering — they apply on the tick they are received.
 */
import { defineTuning } from "../../core/tuning";
import { clampLane, laneX } from "../world/coords";
import { SWITCH_FEEL, switchHop, switchLean, switchTimeScale } from "./switchMotion";
import type { Aabb, RunContext, RunSystem } from "../types";
import type { Action } from "../../input/actions";

export const PLAYER = defineTuning("player", "Player movement", {
  laneSwitchSeconds: { default: 0.1, min: 0.03, max: 0.6, step: 0.005, label: "Lane switch duration", unit: "s" },
  laneSwitchEasePower: { default: 2.5, min: 1, max: 6, step: 0.1, label: "Lane switch ease-out power", help: "x = 1-(1-t)^p; 1 = linear" },
  bounceSwitchSeconds: { default: 0.2, min: 0.03, max: 0.8, step: 0.005, label: "Bounce-back return duration", unit: "s" },
  jumpHeight: { default: 1.5, min: 0.5, max: 4, step: 0.05, label: "Jump apex height", unit: "m" },
  jumpSeconds: { default: 0.65, min: 0.3, max: 1.5, step: 0.01, label: "Jump airtime (at fall gravity ×1)", unit: "s" },
  fallGravityScale: { default: 1, min: 0.5, max: 3, step: 0.05, label: "Fall gravity multiplier" },
  fastFallSpeed: { default: 16, min: 0, max: 40, step: 0.5, label: "Fast-fall initial down speed", unit: "m/s" },
  fastFallGravityScale: { default: 2.5, min: 1, max: 8, step: 0.1, label: "Fast-fall gravity multiplier" },
  fastFallRolls: { default: 1, min: 0, max: 1, step: 1, label: "Fast-fall lands into roll (0/1)" },
  rollSeconds: { default: 0.65, min: 0.2, max: 1.5, step: 0.01, label: "Roll duration", unit: "s" },
  jumpBufferSeconds: { default: 0.2, min: 0, max: 0.6, step: 0.01, label: "Jump input buffer (airborne)", unit: "s" },
  stumbleGraceSeconds: { default: 0.4, min: 0, max: 2, step: 0.01, label: "Stumble grace (no repeat bump)", unit: "s" },
  runCyclesPerSecond: { default: 1.55, min: 0.5, max: 4, step: 0.05, label: "Run cycles/s at reference speed", unit: "Hz" },
  runCycleRefSpeed: { default: 12, min: 1, max: 40, step: 0.5, label: "Run cycle reference speed", unit: "m/s" },
});

export const PLAYER_HITBOX = defineTuning("playerHitbox", "Player hitbox", {
  width: { default: 0.5, min: 0.1, max: 2, step: 0.01, label: "Width", unit: "m" },
  depth: { default: 0.5, min: 0.1, max: 2, step: 0.01, label: "Depth", unit: "m" },
  height: { default: 1.6, min: 0.5, max: 2.5, step: 0.01, label: "Standing height", unit: "m" },
  rollHeight: { default: 0.5, min: 0.2, max: 1.5, step: 0.01, label: "Rolling height", unit: "m" },
});

export type PlayerStateName = "idle" | "run" | "jump" | "roll" | "crash";

declare module "../../core/events" {
  interface EventMap {
    "player:laneChange": { from: number; to: number; dir: number };
    "player:edgeBump": { dir: number };
    "player:jump": { buffered: boolean; fromRoll: boolean };
    "player:land": { fastFall: boolean; airTime: number };
    "player:roll": { fromAir: boolean };
    "player:rollEnd": { cancelled: boolean };
    "player:fastFall": { vy: number };
    "player:crash": { cause: string };
    /** Light bump (side of a train, outer wall): bounces back toward the previous lane when `bounce`. */
    "player:stumble": { cause: string; bounce: boolean };
  }
}

const evLane = { from: 0, to: 0, dir: 0 };
const evEdge = { dir: 0 };
const evJump = { buffered: false, fromRoll: false };
const evLand = { fastFall: false, airTime: 0 };
const evRoll = { fromAir: false };
const evRollEnd = { cancelled: false };
const evFast = { vy: 0 };
const evCrash = { cause: "" };
const evStumble = { cause: "", bounce: false };

export class PlayerController implements RunSystem {
  readonly id = "player";
  readonly order = 20;

  lane = 0;
  x = 0;
  prevX = 0;
  y = 0;
  prevY = 0;
  vy = 0;
  grounded = true;
  /** Height of the surface under the runner (0 = ballast; roofs later). */
  groundY = 0;
  state: PlayerStateName = "idle";
  stateTime = 0;
  /** Lane switch: 0..1 progress (1 = settled). */
  switchT = 1;
  switchFrom = 0;
  switchTo = 0;
  switchDir = 0;
  /** Duration (s) of the current lateral move (normal switch or bounce-back). */
  switchSeconds = 0.1;
  /** Feel seconds since the last lean retarget (switch or bounce); see switchMotion.ts. */
  leanT = 10;
  leanDir = 0;
  leanAmp = 0;
  leanFrom = 0;
  /** Feel seconds since the last switch hop started. */
  hopT = 10;
  hopFrom = 0;
  rolling = false;
  rollTimer = 0;
  fastFalling = false;
  rollOnLand = false;
  jumpBuffer = 0;
  airTime = 0;
  sinceLand = 10;
  runPhase = 0;
  crashCause = "";
  /** Lane the last switch started from (stumble bounce-back target). */
  prevLane = 0;
  /** > 0 while a new stumble is ignored. */
  stumbleCooldown = 0;
  /** Seconds since the last stumble (for animation). */
  sinceStumble = 10;

  private ctx!: RunContext;

  init(ctx: RunContext): void {
    this.ctx = ctx;
  }

  reset(ctx: RunContext): void {
    this.lane = 0;
    this.x = this.prevX = laneX(0);
    this.y = this.prevY = 0;
    this.vy = 0;
    this.grounded = true;
    this.groundY = 0;
    this.switchT = 1;
    this.switchFrom = this.switchTo = this.x;
    this.switchDir = 0;
    this.switchSeconds = PLAYER.laneSwitchSeconds;
    this.leanT = 10;
    this.leanDir = 0;
    this.leanAmp = 0;
    this.leanFrom = 0;
    this.hopT = 10;
    this.hopFrom = 0;
    this.rolling = false;
    this.rollTimer = 0;
    this.fastFalling = false;
    this.rollOnLand = false;
    this.jumpBuffer = 0;
    this.airTime = 0;
    this.sinceLand = 10;
    this.runPhase = 0;
    this.crashCause = "";
    this.prevLane = 0;
    this.stumbleCooldown = 0;
    this.sinceStumble = 10;
    this.setState(ctx.state.mode === "idle" ? "idle" : "run");
  }

  /** Initial jump velocity for the tuned apex/airtime. */
  jumpVelocity(): number {
    return (4 * PLAYER.jumpHeight) / PLAYER.jumpSeconds;
  }

  gravity(): number {
    return (8 * PLAYER.jumpHeight) / (PLAYER.jumpSeconds * PLAYER.jumpSeconds);
  }

  /** Signed lane-switch body lean (-1..1, + = right) for animation. */
  leanAt(): number {
    return switchLean(this.leanT, this.leanDir, this.leanAmp, this.leanFrom);
  }

  /** Normalised visual switch hop (0..1) for animation; multiply by SWITCH_FEEL.hopHeight. */
  hopAt(): number {
    return switchHop(this.hopT, this.hopFrom);
  }

  /** Apply one abstract action. Called by Run at the start of a tick. */
  handleAction(action: Action): void {
    const mode = this.ctx.state.mode;
    if (this.state === "crash" || (mode !== "running" && mode !== "intro")) return;
    switch (action) {
      case "left":
        this.changeLane(-1);
        break;
      case "right":
        this.changeLane(1);
        break;
      case "jump":
        if (this.grounded) this.jump(false);
        else this.jumpBuffer = PLAYER.jumpBufferSeconds;
        break;
      case "roll":
        if (this.grounded) this.roll(false);
        else this.fastFall();
        break;
      default:
        break;
    }
  }

  fixedUpdate(ctx: RunContext, dt: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.stateTime += dt;
    this.sinceLand += dt;
    this.sinceStumble += dt;
    if (this.stumbleCooldown > 0) this.stumbleCooldown = Math.max(0, this.stumbleCooldown - dt);
    const mode = ctx.state.mode;
    if (mode === "idle" || mode === "ended") return;

    if (this.state === "crash") {
      if (!this.grounded) this.integrateVertical(dt);
      return;
    }

    this.runPhase += dt * PLAYER.runCyclesPerSecond * Math.sqrt(Math.max(0, ctx.state.speed) / PLAYER.runCycleRefSpeed);
    const feelDt = dt / switchTimeScale(ctx.state.speed);
    if (this.leanT < 10) this.leanT += feelDt;
    if (this.hopT < 10) this.hopT += feelDt;

    // lateral
    if (this.switchT < 1) {
      this.switchT = Math.min(1, this.switchT + dt / this.switchSeconds);
      const e = 1 - Math.pow(1 - this.switchT, PLAYER.laneSwitchEasePower);
      this.x = this.switchFrom + (this.switchTo - this.switchFrom) * e;
      if (this.switchT >= 1) this.switchDir = 0;
    } else {
      this.x = laneX(this.lane);
    }

    // vertical
    if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (!this.grounded) this.integrateVertical(dt);
    else this.y = this.groundY;

    // posture
    if (this.rolling) {
      this.rollTimer -= dt;
      if (this.rollTimer <= 0) {
        this.rolling = false;
        this.rollTimer = 0;
        if (this.grounded) this.setState("run");
        evRollEnd.cancelled = false;
        ctx.bus.emit("player:rollEnd", evRollEnd);
      }
    }
  }

  crash(cause: string): void {
    this.crashCause = cause;
    this.rolling = false;
    this.switchT = 1;
    this.switchDir = 0;
    this.fastFalling = false;
    this.rollOnLand = false;
    this.jumpBuffer = 0;
    this.setState("crash");
    evCrash.cause = cause;
    this.ctx.bus.emit("player:crash", evCrash);
  }

  /**
   * Light bump. Returns false (ignored) inside the grace window. With `bounce`, eases back to the
   * lane the current switch started from.
   */
  stumble(cause: string, bounce: boolean): boolean {
    if (this.state === "crash" || this.stumbleCooldown > 0) return false;
    this.stumbleCooldown = PLAYER.stumbleGraceSeconds;
    this.sinceStumble = 0;
    if (bounce && this.prevLane !== this.lane) {
      this.switchFrom = this.x;
      this.switchTo = laneX(this.prevLane);
      this.switchDir = Math.sign(this.prevLane - this.lane);
      this.switchT = 0;
      this.switchSeconds = PLAYER.bounceSwitchSeconds;
      this.retargetLean(this.switchDir, SWITCH_FEEL.bounceLean);
      this.lane = this.prevLane;
    }
    evStumble.cause = cause;
    evStumble.bounce = bounce;
    this.ctx.bus.emit("player:stumble", evStumble);
    return true;
  }

  /** Sim-space hitbox swept over this tick's forward motion. */
  getHitbox(out: Aabb): Aabb {
    const st = this.ctx.state;
    const hw = PLAYER_HITBOX.width / 2;
    const hd = PLAYER_HITBOX.depth / 2;
    out.minX = this.x - hw;
    out.maxX = this.x + hw;
    out.minY = this.y;
    out.maxY = this.y + (this.rolling ? PLAYER_HITBOX.rollHeight : PLAYER_HITBOX.height);
    out.minS = Math.min(st.prevDistance, st.distance) - hd;
    out.maxS = st.distance + hd;
    return out;
  }

  // ------------------------------------------------------------------ transitions

  private setState(s: PlayerStateName): void {
    if (this.state !== s) this.stateTime = 0;
    this.state = s;
  }

  private changeLane(dir: number): void {
    const target = clampLane(this.lane + dir);
    if (target === this.lane) {
      evEdge.dir = dir;
      this.ctx.bus.emit("player:edgeBump", evEdge);
      return;
    }
    evLane.from = this.lane;
    evLane.to = target;
    evLane.dir = dir;
    this.switchFrom = this.x;
    this.switchTo = laneX(target);
    this.switchT = 0;
    this.switchDir = dir;
    this.switchSeconds = PLAYER.laneSwitchSeconds;
    this.retargetLean(dir, 1);
    this.hopFrom = this.hopAt();
    this.hopT = 0;
    this.prevLane = this.lane;
    this.lane = target;
    this.ctx.bus.emit("player:laneChange", evLane);
  }

  /** Restart the lean curve toward `dir`, continuing from the current lean (no pose snap). */
  private retargetLean(dir: number, amp: number): void {
    this.leanFrom = this.leanAt();
    this.leanDir = dir;
    this.leanAmp = amp;
    this.leanT = 0;
  }

  private jump(buffered: boolean): void {
    const fromRoll = this.rolling;
    if (this.rolling) {
      this.rolling = false;
      this.rollTimer = 0;
      evRollEnd.cancelled = true;
      this.ctx.bus.emit("player:rollEnd", evRollEnd);
    }
    this.vy = this.jumpVelocity();
    this.grounded = false;
    this.airTime = 0;
    this.jumpBuffer = 0;
    this.fastFalling = false;
    this.rollOnLand = false;
    this.setState("jump");
    this.stateTime = 0;
    evJump.buffered = buffered;
    evJump.fromRoll = fromRoll;
    this.ctx.bus.emit("player:jump", evJump);
  }

  private roll(fromAir: boolean): void {
    this.rolling = true;
    this.rollTimer = PLAYER.rollSeconds;
    this.setState("roll");
    this.stateTime = 0;
    evRoll.fromAir = fromAir;
    this.ctx.bus.emit("player:roll", evRoll);
  }

  private fastFall(): void {
    this.vy = Math.min(this.vy, -PLAYER.fastFallSpeed);
    this.fastFalling = true;
    this.rollOnLand = PLAYER.fastFallRolls >= 0.5;
    this.jumpBuffer = 0;
    evFast.vy = this.vy;
    this.ctx.bus.emit("player:fastFall", evFast);
  }

  private integrateVertical(dt: number): void {
    let g = this.gravity();
    if (this.vy < 0) g *= PLAYER.fallGravityScale;
    if (this.fastFalling) g *= PLAYER.fastFallGravityScale;
    this.y += this.vy * dt - 0.5 * g * dt * dt;
    this.vy -= g * dt;
    this.airTime += dt;
    if (this.y <= this.groundY) this.land();
  }

  private land(): void {
    const wasFast = this.fastFalling;
    this.y = this.groundY;
    this.vy = 0;
    this.grounded = true;
    this.fastFalling = false;
    this.sinceLand = 0;
    evLand.fastFall = wasFast;
    evLand.airTime = this.airTime;
    if (this.state === "crash") return;
    this.ctx.bus.emit("player:land", evLand);
    if (this.jumpBuffer > 0) {
      this.jump(true);
    } else if (this.rollOnLand) {
      this.rollOnLand = false;
      this.roll(true);
    } else {
      this.setState(this.rolling ? "roll" : "run");
    }
  }
}
