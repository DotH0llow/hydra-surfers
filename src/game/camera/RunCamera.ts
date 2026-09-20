/**
 * RunCamera — follows the runner from behind/above in portrait framing.
 * Pose is computed in the fixed step (deterministic) and interpolated at render.
 *
 * `fov` is the vertical FOV at the 9:16 design aspect; on narrower (taller) screens the vertical
 * FOV widens so the horizontal framing of the lanes is preserved.
 */
import { Vector3 } from "three";
import { defineTuning } from "../../core/tuning";
import { easeHermite, easeHermiteVel, switchTimeScale } from "../player/switchMotion";
import { laneX } from "../world/coords";
import { SPEED } from "../spawn/difficulty";
import type { ResolvedRunOptions, RunContext, RunSystem } from "../types";

export const CAMERA = defineTuning("camera", "Run camera", {
  height: { default: 4.1, min: 0.5, max: 15, step: 0.05, label: "Height above runner's ground", unit: "m" },
  distance: { default: 7.4, min: 1, max: 25, step: 0.05, label: "Distance behind runner", unit: "m" },
  lookHeight: { default: 1.3, min: -5, max: 10, step: 0.05, label: "Look-at height", unit: "m" },
  lookAhead: { default: 20, min: 0, max: 80, step: 0.5, label: "Look-at distance ahead", unit: "m" },
  fov: { default: 60, min: 25, max: 100, step: 0.5, label: "Vertical FOV at 9:16", unit: "°" },
  followX: { default: 0.8, min: 0, max: 1, step: 0.01, label: "Lateral follow amount" },
  lookFollowX: { default: 0.65, min: 0, max: 1, step: 0.01, label: "Look-at lateral follow" },
  laneFollowSeconds: { default: 0.33, min: 0.02, max: 1.5, step: 0.01, label: "Lateral follow: time to reach a new lane", help: "C1 cubic ease, retargets smoothly; scaled by switchFeel timing", unit: "s" },
  followY: { default: 0.4, min: 0, max: 1, step: 0.01, label: "Vertical follow amount" },
  followYSharpness: { default: 6, min: 0.5, max: 60, step: 0.5, label: "Vertical follow sharpness", unit: "1/s" },
  flyFollowY: { default: 0.85, min: 0, max: 1, step: 0.01, label: "Vertical follow amount while flying (jetpack)" },
  homeHeight: { default: 2.6, min: 0.2, max: 10, step: 0.05, label: "Home: height", unit: "m" },
  homeDistance: { default: 6.2, min: 0.5, max: 20, step: 0.05, label: "Home: distance behind", unit: "m" },
  homeLookHeight: { default: 1.9, min: -2, max: 5, step: 0.05, label: "Home: look-at height", unit: "m" },
  homeLookAhead: { default: 8, min: -10, max: 40, step: 0.5, label: "Home: look-at ahead", unit: "m" },
  homeFov: { default: 55, min: 25, max: 100, step: 0.5, label: "Home: FOV", unit: "°" },
  shakeAmplitude: { default: 0.22, min: 0, max: 2, step: 0.01, label: "Crash shake amplitude", unit: "m" },
  eventShakeScale: { default: 0.35, min: 0, max: 2, step: 0.05, label: "Road event shake (x crash amplitude)" },
  perfectShakeScale: { default: 0.16, min: 0, max: 2, step: 0.02, label: "Perfect dodge kick (x crash amplitude)" },
  shakeDecay: { default: 6, min: 0.5, max: 30, step: 0.5, label: "Crash shake decay", unit: "1/s" },
  shakeFrequency: { default: 18, min: 1, max: 60, step: 0.5, label: "Crash shake frequency", unit: "Hz" },
  speedFov: { default: 5, min: 0, max: 20, step: 0.5, label: "Extra FOV at top speed (0 with reduced motion)", unit: "°" },
});

export const DESIGN_ASPECT = 9 / 16;
const tmpLook = new Vector3();
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class RunCamera implements RunSystem {
  readonly id = "camera";
  readonly order = 90;

  x = 0;
  y = 0;
  z = 0;
  lx = 0;
  ly = 0;
  lz = 0;
  fov = 60;
  private px = 0;
  private py = 0;
  private pz = 0;
  private plx = 0;
  private ply = 0;
  private plz = 0;
  private pfov = 60;
  private followX = 0;
  private lookX = 0;
  private followYv = 0;
  /** Lateral follow ease state, in lane-x metres (feel-time units, see switchMotion.ts). */
  private laneX = 0;
  private laneV = 0;
  private laneFrom = 0;
  private laneV0 = 0;
  private laneTo = 0;
  private laneT = 0;
  private shakeT = -1;
  /** Amplitude of the shake running now, as a fraction of CAMERA.shakeAmplitude. */
  private shakeScale = 1;
  private viewportAspect = DESIGN_ASPECT;
  private appliedFov = -1;
  private appliedAspect = -1;

  init(ctx: RunContext): void {
    // a horn in the distance and a dodge by a hair both move the camera, far less than a crash
    ctx.bus.on("event:start", () => this.shake(CAMERA.eventShakeScale));
    ctx.bus.on("skill:perfect", () => this.shake(CAMERA.perfectShakeScale));
    ctx.bus.on("player:crash", () => {
      this.shakeScale = 1;
      this.shakeT = 0;
    });
  }

  /** Starts a shake at `scale` of the crash amplitude, unless a stronger one is still running. */
  private shake(scale: number): void {
    if (this.shakeT >= 0 && this.shakeScale > scale) return;
    this.shakeScale = scale;
    this.shakeT = 0;
  }

  reset(ctx: RunContext, opts: ResolvedRunOptions): void {
    const px = laneX(ctx.player.lane);
    this.laneX = this.laneFrom = this.laneTo = px;
    this.laneV = this.laneV0 = 0;
    this.laneT = CAMERA.laneFollowSeconds;
    this.followX = px * CAMERA.followX;
    this.lookX = px * CAMERA.lookFollowX;
    this.followYv = 0;
    this.shakeT = -1;
    this.compute(ctx, ctx.state.mode === "idle" ? 0 : opts.skipIntro ? 1 : 0, 0);
    this.snap();
  }

  setViewportAspect(aspect: number): void {
    this.viewportAspect = aspect;
  }

  /** Effective vertical FOV (degrees) for the current viewport aspect. */
  effectiveFov(fov = this.fov): number {
    const a = this.viewportAspect;
    if (a >= DESIGN_ASPECT) return fov;
    const half = (fov * Math.PI) / 360;
    return (Math.atan((Math.tan(half) * DESIGN_ASPECT) / a) * 360) / Math.PI;
  }

  /** Pitch in degrees (negative = looking down). */
  pitch(): number {
    const dy = this.ly - this.y;
    const dh = Math.hypot(this.lx - this.x, this.lz - this.z);
    return (Math.atan2(dy, dh) * 180) / Math.PI;
  }

  fixedUpdate(ctx: RunContext, dt: number): void {
    this.snap();
    const st = ctx.state;
    const p = ctx.player;
    const ky = 1 - Math.exp(-CAMERA.followYSharpness * dt);
    // lateral: C1 cubic ease toward the target lane's centre, restarted (velocity kept) on every retarget
    const target = laneX(p.lane);
    if (target !== this.laneTo) {
      this.laneFrom = this.laneX;
      this.laneV0 = this.laneV;
      this.laneTo = target;
      this.laneT = 0;
    }
    const dur = CAMERA.laneFollowSeconds;
    if (this.laneT < dur) {
      this.laneT = Math.min(dur, this.laneT + dt / switchTimeScale(st.speed));
      const s = this.laneT / dur;
      this.laneX = easeHermite(this.laneFrom, this.laneV0, this.laneTo, s);
      this.laneV = easeHermiteVel(this.laneFrom, this.laneV0, this.laneTo, s);
    } else {
      this.laneX = this.laneTo;
      this.laneV = 0;
    }
    this.followX = this.laneX * CAMERA.followX;
    this.lookX = this.laneX * CAMERA.lookFollowX;
    const followY = p.flying ? CAMERA.flyFollowY : CAMERA.followY;
    this.followYv += ((p.y - p.groundY) * followY + p.groundY - this.followYv) * ky;
    const blend = st.mode === "idle" ? 0 : st.mode === "intro" ? smooth(st.introT) : 1;
    if (this.shakeT >= 0) this.shakeT += dt;
    this.compute(ctx, blend, dt);
  }

  private compute(ctx: RunContext, blend: number, _dt: number): void {
    const p = ctx.player;
    // run pose
    const rx = this.followX;
    const ry = CAMERA.height + this.followYv;
    const rz = CAMERA.distance;
    const rlx = this.lookX;
    const rly = CAMERA.lookHeight + this.followYv;
    const rlz = -CAMERA.lookAhead;
    // home pose
    const hx = p.x;
    const hy = CAMERA.homeHeight;
    const hz = CAMERA.homeDistance;
    const hlx = p.x;
    const hly = CAMERA.homeLookHeight;
    const hlz = -CAMERA.homeLookAhead;
    const b = blend;
    this.x = hx + (rx - hx) * b;
    this.y = hy + (ry - hy) * b;
    this.z = hz + (rz - hz) * b;
    this.lx = hlx + (rlx - hlx) * b;
    this.ly = hly + (rly - hly) * b;
    this.lz = hlz + (rlz - hlz) * b;
    // widen slightly as the road speeds up: a cheap, strong sense of speed (off with reduced motion)
    const span = Math.max(1e-6, SPEED.max - SPEED.start);
    const fast = Math.min(1, Math.max(0, (ctx.state.speed - SPEED.start) / span));
    this.fov = CAMERA.homeFov + (CAMERA.fov - CAMERA.homeFov) * b + CAMERA.speedFov * fast * b;
    if (this.shakeT >= 0) {
      const t = this.shakeT;
      const a = CAMERA.shakeAmplitude * this.shakeScale * Math.exp(-CAMERA.shakeDecay * t);
      if (a < 0.002) this.shakeT = -1;
      else {
        const w = Math.PI * 2 * CAMERA.shakeFrequency * t;
        this.x += a * Math.sin(w);
        this.y += a * 0.7 * Math.sin(w * 1.37 + 1.1);
      }
    }
  }

  private snap(): void {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.plx = this.lx;
    this.ply = this.ly;
    this.plz = this.lz;
    this.pfov = this.fov;
  }

  render(ctx: RunContext, alpha: number): void {
    const cam = ctx.camera3;
    const a = alpha;
    cam.position.set(this.px + (this.x - this.px) * a, this.py + (this.y - this.py) * a, this.pz + (this.z - this.pz) * a);
    tmpLook.set(this.plx + (this.lx - this.plx) * a, this.ply + (this.ly - this.ply) * a, this.plz + (this.lz - this.plz) * a);
    cam.lookAt(tmpLook);
    const fov = this.effectiveFov(this.pfov + (this.fov - this.pfov) * a);
    if (fov !== this.appliedFov || this.viewportAspect !== this.appliedAspect) {
      cam.fov = fov;
      cam.aspect = this.viewportAspect;
      cam.updateProjectionMatrix();
      this.appliedFov = fov;
      this.appliedAspect = this.viewportAspect;
    }
  }
}
