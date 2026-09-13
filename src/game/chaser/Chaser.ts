/**
 * Greybox chaser: starts right behind the runner, falls back over `retreatSeconds`, closes in
 * after a crash. `gap` (metres behind the runner) is reported as getState().chaser.dist.
 */
import { Group, type Object3D } from "three";
import { defineTuning } from "../../core/tuning";
import { curveObject } from "../world/curve";
import { HumanoidRig, type RigPose } from "../player/PlayerAnimator";
import type { ResolvedRunOptions, RunContext, RunSystem } from "../types";

export const CHASER = defineTuning("chaser", "Chaser", {
  startGap: { default: 2.2, min: 0.5, max: 20, step: 0.1, label: "Gap at run start", unit: "m" },
  farGap: { default: 18, min: 2, max: 60, step: 0.5, label: "Gap after retreating", unit: "m" },
  retreatSeconds: { default: 3.5, min: 0.1, max: 30, step: 0.1, label: "Retreat duration", unit: "s" },
  catchGap: { default: 1.1, min: 0, max: 10, step: 0.1, label: "Gap when catching", unit: "m" },
  closeSpeed: { default: 9, min: 0, max: 40, step: 0.5, label: "Closing speed after crash", unit: "m/s" },
  followSharpness: { default: 5, min: 0.5, max: 40, step: 0.5, label: "Lateral follow sharpness", unit: "1/s" },
  runCyclesPerSecond: { default: 1.7, min: 0.5, max: 4, step: 0.05, label: "Run cycles/s", unit: "Hz" },
});

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const pose: RigPose = { mode: "run", phase: 0, lean: 0, tuck: 0, roll: 0, squash: 0, crashT: 0, time: 0 };

export class Chaser implements RunSystem {
  readonly id = "chaser";
  readonly order = 70;
  gap = 0;
  x = 0;
  private prevGap = 0;
  private prevX = 0;
  private phase = 0;
  private root = new Group();
  private model!: Object3D;
  private rig!: HumanoidRig;

  init(ctx: RunContext): void {
    this.model = ctx.assets.getModel("char.chaser.guard");
    this.root.add(this.model);
    this.root.name = "chaser";
    this.rig = new HumanoidRig(this.model);
    curveObject(this.root);
    ctx.scene.add(this.root);
  }

  reset(ctx: RunContext, opts: ResolvedRunOptions): void {
    this.gap = this.prevGap = opts.skipIntro || ctx.state.mode === "idle" ? CHASER.farGap : CHASER.startGap;
    this.x = this.prevX = ctx.player.x;
    this.phase = 0;
  }

  fixedUpdate(ctx: RunContext, dt: number): void {
    this.prevGap = this.gap;
    this.prevX = this.x;
    const st = ctx.state;
    if (st.mode === "idle") return;
    if (st.mode === "intro" || st.mode === "running") {
      const target = CHASER.startGap + (CHASER.farGap - CHASER.startGap) * smooth(st.time / CHASER.retreatSeconds);
      this.gap = Math.max(this.gap, target);
    } else if (st.mode === "crashed") {
      this.gap = Math.max(CHASER.catchGap, this.gap - CHASER.closeSpeed * dt);
    }
    this.x += (ctx.player.x - this.x) * (1 - Math.exp(-CHASER.followSharpness * dt));
    if (st.mode !== "ended" && this.gap > CHASER.catchGap + 0.01) this.phase += dt * CHASER.runCyclesPerSecond;
  }

  render(ctx: RunContext, alpha: number): void {
    const gap = this.prevGap + (this.gap - this.prevGap) * alpha;
    const visible = ctx.state.mode !== "idle" && gap < CHASER.farGap - 0.25;
    this.root.visible = visible;
    if (!visible) return;
    this.root.position.set(this.prevX + (this.x - this.prevX) * alpha, 0, gap);
    pose.phase = this.phase;
    pose.mode = ctx.state.mode === "ended" ? "idle" : "run";
    pose.time = ctx.state.time;
    this.rig.pose(pose);
  }
}
