/**
 * Ghosts. The recorder samples the runner at GHOST_HZ of run time into preallocated arrays; the
 * runner replays someone else's track (format in src/shared/ghost.ts) as a translucent figure on
 * the same road. A ghost only makes sense where everybody meets the same road, so the App loads a
 * track for the daily run only; the determinism work (layout as a function of seed and distance)
 * is what keeps the two runs on the same obstacles.
 */
import { Group, MeshBasicMaterial, type Mesh } from "three";
import { defineTuning } from "../../core/tuning";
import { GHOST_HZ, GHOST_MAX_SAMPLES, sampleGhost, type GhostTrack } from "../../shared/ghost";
import { HumanoidRig, type RigPose } from "../player/PlayerAnimator";
import { PLAYER } from "../player/PlayerController";
import { registerRunSystem } from "../systems";
import type { RunContext, RunSystem } from "../types";
import { renderZ } from "../world/coords";
import { curveObject } from "../world/curve";

export const GHOST = defineTuning("ghost", "Ghost", {
  opacity: { default: 0.38, min: 0, max: 1, step: 0.01, label: "Opacity" },
  fadeSeconds: { default: 1.5, min: 0, max: 10, step: 0.1, label: "Fade out after the ghost's run ended", unit: "s" },
});

export class GhostRecorder implements RunSystem {
  readonly id = "ghostRecorder";
  /** After the player (20) has moved this tick. */
  readonly order = 25;
  readonly dist = new Float32Array(GHOST_MAX_SAMPLES);
  readonly x = new Float32Array(GHOST_MAX_SAMPLES);
  readonly y = new Float32Array(GHOST_MAX_SAMPLES);
  count = 0;

  reset(): void {
    this.count = 0;
  }

  fixedUpdate(ctx: RunContext): void {
    const st = ctx.state;
    if (st.mode !== "running" && st.mode !== "intro") return;
    // sample i holds the position at run time i / GHOST_HZ; a pause in the clock (crash, revive
    // offer) repeats the current position so the index always matches run time
    while (this.count < GHOST_MAX_SAMPLES && this.count <= st.time * GHOST_HZ) {
      this.dist[this.count] = st.distance;
      this.x[this.count] = ctx.player.x;
      this.y[this.count] = ctx.player.y;
      this.count++;
    }
  }
}

export class GhostRunner implements RunSystem {
  readonly id = "ghost";
  /** After the player's view (110). */
  readonly order = 111;
  /** Whose ghost it is ("" without one). */
  name = "";
  /** Metres the ghost is ahead of the runner (negative = behind); NaN without a ghost. */
  lead = Number.NaN;
  private track: GhostTrack | null = null;
  private readonly root = new Group();
  private rig: HumanoidRig | null = null;
  private readonly material = new MeshBasicMaterial({ color: 0xa8d8ff, transparent: true, opacity: 0.38, depthWrite: false });
  private readonly at = { dist: 0, x: 0, y: 0 };
  private readonly pose: RigPose = { mode: "run", phase: 0, lean: 0, tuck: 0, roll: 0, squash: 0, crashT: 0, time: 0 };
  private lastY = 0;
  private endedFor = 0;

  init(ctx: RunContext): void {
    const model = ctx.assets.getModel("char.runner.default");
    model.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).material = this.material;
    });
    this.root.name = "ghost";
    this.root.add(model);
    this.rig = new HumanoidRig(model);
    curveObject(this.root);
    this.root.visible = false;
    ctx.scene.add(this.root);
  }

  /** The track to race against (null clears it). Tracks run on run time, so it may arrive late. */
  setTrack(track: GhostTrack | null, name = ""): void {
    this.track = track;
    this.name = track ? name : "";
    this.lead = Number.NaN;
    this.endedFor = 0;
    if (!track) this.root.visible = false;
  }

  reset(): void {
    this.setTrack(null);
  }

  render(ctx: RunContext, _alpha: number, frameDt: number): void {
    const track = this.track;
    const st = ctx.state;
    if (!track || st.mode === "idle") {
      this.root.visible = false;
      return;
    }
    const alive = sampleGhost(track, st.time, this.at);
    this.lead = this.at.dist - ctx.renderDistance;
    // the ghost's run ended there (it crashed): it lingers a moment, then fades
    this.endedFor = alive ? 0 : this.endedFor + frameDt;
    const fade = GHOST.fadeSeconds > 0 ? Math.max(0, 1 - this.endedFor / GHOST.fadeSeconds) : alive ? 1 : 0;
    this.material.opacity = GHOST.opacity * fade;
    this.root.visible = this.material.opacity > 0.01;
    if (!this.root.visible) return;
    this.root.position.set(this.at.x, this.at.y, renderZ(this.at.dist, ctx.renderDistance));

    const dy = this.at.y - this.lastY;
    this.lastY = this.at.y;
    const pose = this.pose;
    pose.mode = !alive ? "idle" : Math.abs(dy) > 0.004 ? "jump" : "run";
    pose.tuck = pose.mode === "jump" ? 0.6 : 0;
    pose.phase = (this.at.dist * (PLAYER.runCyclesPerSecond / PLAYER.runCycleRefSpeed)) % 1;
    pose.time += frameDt;
    this.rig?.pose(pose);
  }
}

registerRunSystem(() => new GhostRecorder());
registerRunSystem(() => new GhostRunner());
