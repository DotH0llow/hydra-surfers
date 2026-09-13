/**
 * Greybox chaser. Starts right behind the runner and falls back. A light stumble brings him on
 * screen (`stumbleGap`) for `nearSeconds`; a stumble while he is near = caught. After a crash he
 * closes in to `catchGap`. `gap` (metres behind the runner) is reported as getState().chaser.dist.
 * All numbers provisional (reference dossier marks on-screen duration as "measure").
 */
import { Group, type Object3D } from "three";
import { defineTuning } from "../../core/tuning";
import { curveObject } from "../world/curve";
import { HumanoidRig, type RigPose } from "../player/PlayerAnimator";
import type { ResolvedRunOptions, RunContext, RunSystem } from "../types";

export const CHASER = defineTuning("chaser", "Chaser", {
  startGap: { default: 2.2, min: 0.5, max: 20, step: 0.1, label: "Gap at run start", unit: "m" },
  startNearSeconds: { default: 2.5, min: 0, max: 10, step: 0.1, label: "Counts as near after run start", unit: "s" },
  farGap: { default: 18, min: 2, max: 60, step: 0.5, label: "Gap when not chasing (off screen)", unit: "m" },
  retreatSharpness: { default: 0.9, min: 0.05, max: 20, step: 0.05, label: "Fall-back sharpness", unit: "1/s" },
  stumbleGap: { default: 1.6, min: 0.5, max: 20, step: 0.1, label: "Gap while on screen after a stumble", unit: "m" },
  approachSharpness: { default: 4, min: 0.1, max: 40, step: 0.1, label: "Approach sharpness after a stumble", unit: "1/s" },
  nearSeconds: { default: 4, min: 0.2, max: 20, step: 0.1, label: "Stays near after a stumble (2nd stumble = caught)", unit: "s" },
  catchGap: { default: 0.7, min: 0, max: 10, step: 0.1, label: "Gap when catching", unit: "m" },
  closeSpeed: { default: 9, min: 0, max: 40, step: 0.5, label: "Closing speed after crash", unit: "m/s" },
  followSharpness: { default: 5, min: 0.5, max: 40, step: 0.5, label: "Lateral follow sharpness", unit: "1/s" },
  runCyclesPerSecond: { default: 1.7, min: 0.5, max: 4, step: 0.05, label: "Run cycles/s", unit: "Hz" },
});

const pose: RigPose = { mode: "run", phase: 0, lean: 0, tuck: 0, roll: 0, squash: 0, crashT: 0, time: 0 };

export class Chaser implements RunSystem {
  readonly id = "chaser";
  readonly order = 70;
  gap = 0;
  x = 0;
  /** Seconds left during which a stumble means caught. */
  nearT = 0;
  private prevGap = 0;
  private prevX = 0;
  private phase = 0;
  private root = new Group();
  private model!: Object3D;
  private rig!: HumanoidRig;

  get near(): boolean {
    return this.nearT > 0;
  }

  init(ctx: RunContext): void {
    this.model = ctx.assets.getModel("char.chaser.guard");
    this.root.add(this.model);
    this.root.name = "chaser";
    this.rig = new HumanoidRig(this.model);
    curveObject(this.root);
    ctx.scene.add(this.root);
  }

  reset(ctx: RunContext, opts: ResolvedRunOptions): void {
    const far = opts.skipIntro || ctx.state.mode === "idle";
    this.gap = this.prevGap = far ? CHASER.farGap : CHASER.startGap;
    this.nearT = far ? 0 : CHASER.startNearSeconds;
    this.x = this.prevX = ctx.player.x;
    this.phase = 0;
  }

  /** Called by Run on an accepted stumble. Returns true when this stumble means caught. */
  onStumble(): boolean {
    if (this.nearT > 0) return true;
    this.nearT = CHASER.nearSeconds;
    return false;
  }

  fixedUpdate(ctx: RunContext, dt: number): void {
    this.prevGap = this.gap;
    this.prevX = this.x;
    const st = ctx.state;
    if (st.mode === "idle") return;
    if (st.mode === "intro" || st.mode === "running") {
      let target: number;
      let k: number;
      if (this.nearT > 0) {
        this.nearT = Math.max(0, this.nearT - dt);
        target = CHASER.stumbleGap;
        k = this.gap > target ? CHASER.approachSharpness : CHASER.retreatSharpness;
      } else {
        target = CHASER.farGap;
        k = CHASER.retreatSharpness;
      }
      this.gap += (target - this.gap) * (1 - Math.exp(-k * dt));
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
