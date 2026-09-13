/**
 * RunCamera — follows the runner from behind/above in portrait framing.
 * Pose is computed in the fixed step (deterministic) and interpolated at render.
 *
 * `fov` is the vertical FOV at the 9:16 design aspect; on narrower (taller) screens the vertical
 * FOV widens so the horizontal framing of the lanes is preserved.
 */
import { Vector3 } from "three";
import { defineTuning } from "../../core/tuning";
import type { ResolvedRunOptions, RunContext, RunSystem } from "../types";

export const CAMERA = defineTuning("camera", "Run camera", {
  height: { default: 4.1, min: 0.5, max: 15, step: 0.05, label: "Height above runner's ground", unit: "m" },
  distance: { default: 7.4, min: 1, max: 25, step: 0.05, label: "Distance behind runner", unit: "m" },
  lookHeight: { default: 1.3, min: -5, max: 10, step: 0.05, label: "Look-at height", unit: "m" },
  lookAhead: { default: 20, min: 0, max: 80, step: 0.5, label: "Look-at distance ahead", unit: "m" },
  fov: { default: 60, min: 25, max: 100, step: 0.5, label: "Vertical FOV at 9:16", unit: "°" },
  followX: { default: 0.8, min: 0, max: 1, step: 0.01, label: "Lateral follow amount" },
  lookFollowX: { default: 0.65, min: 0, max: 1, step: 0.01, label: "Look-at lateral follow" },
  followXSharpness: { default: 10, min: 0.5, max: 60, step: 0.5, label: "Lateral follow sharpness", unit: "1/s" },
  followY: { default: 0.4, min: 0, max: 1, step: 0.01, label: "Vertical follow amount" },
  followYSharpness: { default: 6, min: 0.5, max: 60, step: 0.5, label: "Vertical follow sharpness", unit: "1/s" },
  homeHeight: { default: 2.6, min: 0.2, max: 10, step: 0.05, label: "Home: height", unit: "m" },
  homeDistance: { default: 6.2, min: 0.5, max: 20, step: 0.05, label: "Home: distance behind", unit: "m" },
  homeLookHeight: { default: 1.9, min: -2, max: 5, step: 0.05, label: "Home: look-at height", unit: "m" },
  homeLookAhead: { default: 8, min: -10, max: 40, step: 0.5, label: "Home: look-at ahead", unit: "m" },
  homeFov: { default: 55, min: 25, max: 100, step: 0.5, label: "Home: FOV", unit: "°" },
  shakeAmplitude: { default: 0.22, min: 0, max: 2, step: 0.01, label: "Crash shake amplitude", unit: "m" },
  shakeDecay: { default: 6, min: 0.5, max: 30, step: 0.5, label: "Crash shake decay", unit: "1/s" },
  shakeFrequency: { default: 18, min: 1, max: 60, step: 0.5, label: "Crash shake frequency", unit: "Hz" },
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
  private shakeT = -1;
  private viewportAspect = DESIGN_ASPECT;
  private appliedFov = -1;
  private appliedAspect = -1;

  init(ctx: RunContext): void {
    ctx.bus.on("player:crash", () => {
      this.shakeT = 0;
    });
  }

  reset(ctx: RunContext, opts: ResolvedRunOptions): void {
    const px = ctx.player.x;
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
    const kx = 1 - Math.exp(-CAMERA.followXSharpness * dt);
    const ky = 1 - Math.exp(-CAMERA.followYSharpness * dt);
    this.followX += (p.x * CAMERA.followX - this.followX) * kx;
    this.lookX += (p.x * CAMERA.lookFollowX - this.lookX) * kx;
    this.followYv += ((p.y - p.groundY) * CAMERA.followY + p.groundY - this.followYv) * ky;
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
    this.fov = CAMERA.homeFov + (CAMERA.fov - CAMERA.homeFov) * b;
    if (this.shakeT >= 0) {
      const t = this.shakeT;
      const a = CAMERA.shakeAmplitude * Math.exp(-CAMERA.shakeDecay * t);
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
