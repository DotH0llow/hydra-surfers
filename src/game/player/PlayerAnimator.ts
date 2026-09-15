/**
 * PlayerAnimator — visual only. Places the runner model at the interpolated sim position and
 * poses it: glTF clips through AnimationMixer when the model has them, otherwise a procedural
 * rig driving the placeholder's named nodes (body, torso, head, armL/R, legL/R, ball).
 */
import {
  AnimationMixer,
  Group,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type AnimationAction,
  type Camera,
  type Object3D,
} from "three";
import { defineTuning } from "../../core/tuning";
import { curveObject } from "../world/curve";
import { PLAYER } from "./PlayerController";
import { SWITCH_FEEL } from "./switchMotion";
import type { RunContext, RunSystem } from "../types";

export const ANIM = defineTuning("anim", "Runner animation", {
  legSwing: { default: 0.95, min: 0, max: 2, step: 0.01, label: "Leg swing", unit: "rad" },
  armSwing: { default: 0.85, min: 0, max: 2, step: 0.01, label: "Arm swing", unit: "rad" },
  bob: { default: 0.07, min: 0, max: 0.4, step: 0.005, label: "Run bob", unit: "m" },
  forwardLean: { default: 0.2, min: -0.5, max: 0.8, step: 0.01, label: "Run forward lean", unit: "rad" },
  switchLean: { default: 0.5, min: 0, max: 1.2, step: 0.01, label: "Lane-switch lean", unit: "rad" },
  switchLeanPivot: { default: 0.75, min: 0, max: 1.7, step: 0.01, label: "Lane-switch lean pivot height", help: "tilt pivot above the feet; > 0 swings the legs out behind the lean", unit: "m" },
  switchYaw: { default: 0.22, min: 0, max: 1, step: 0.01, label: "Lane-switch yaw", unit: "rad" },
  jumpTuck: { default: 1.2, min: 0, max: 2.5, step: 0.01, label: "Jump knee tuck", unit: "rad" },
  rollTurns: { default: 1.6, min: 0, max: 5, step: 0.1, label: "Roll ball turns" },
  landSquash: { default: 0.14, min: 0, max: 0.5, step: 0.01, label: "Landing squash" },
  crashTilt: { default: 1.3, min: 0, max: 2, step: 0.01, label: "Crash fall-back tilt", unit: "rad" },
  shadowOpacity: { default: 0.45, min: 0, max: 1, step: 0.01, label: "Blob shadow opacity" },
  shadowSize: { default: 1.1, min: 0.2, max: 3, step: 0.05, label: "Blob shadow size", unit: "m" },
});

const TAU = Math.PI * 2;

export type RigMode = "idle" | "run" | "jump" | "roll" | "crash";

export interface RigPose {
  mode: RigMode;
  phase: number;
  /** -1..1 lateral lean (lane switch). */
  lean: number;
  /** 0..1 knee tuck while airborne. */
  tuck: number;
  /** 0..1 roll progress. */
  roll: number;
  /** 0..1 landing squash amount. */
  squash: number;
  /** Seconds in crash. */
  crashT: number;
  time: number;
}

/** Procedural pose driver for the greybox humanoid placeholder. */
export class HumanoidRig {
  readonly ok: boolean;
  private readonly body: Object3D | undefined;
  private readonly torso: Object3D | undefined;
  private readonly armL: Object3D | undefined;
  private readonly armR: Object3D | undefined;
  private readonly legL: Object3D | undefined;
  private readonly legR: Object3D | undefined;
  private readonly ball: Object3D | undefined;

  constructor(root: Object3D) {
    this.body = root.getObjectByName("body");
    this.torso = root.getObjectByName("torso");
    this.armL = root.getObjectByName("armL");
    this.armR = root.getObjectByName("armR");
    this.legL = root.getObjectByName("legL");
    this.legR = root.getObjectByName("legR");
    this.ball = root.getObjectByName("ball");
    this.ok = !!(this.body && this.armL && this.armR && this.legL && this.legR);
  }

  pose(p: RigPose): void {
    const { body, torso, armL, armR, legL, legR, ball } = this;
    if (!this.ok || !body || !armL || !armR || !legL || !legR) return;
    body.visible = true;
    if (ball) ball.visible = false;
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    if (torso) torso.rotation.set(0, 0, 0);

    const lean = p.lean;
    const tilt = -lean * ANIM.switchLean;
    body.rotation.z = tilt;
    body.rotation.y = -lean * ANIM.switchYaw;
    // tilt about a point above the feet: position = P - R·P for P = (0, pivot)
    const pivot = ANIM.switchLeanPivot;
    body.position.x = pivot * Math.sin(tilt);
    body.position.y = pivot * (1 - Math.cos(tilt));
    const baseY = body.position.y;

    switch (p.mode) {
      case "idle": {
        const b = Math.sin(p.time * 2.2);
        legL.rotation.x = legR.rotation.x = 0;
        armL.rotation.set(0, 0, 0.12 + b * 0.03);
        armR.rotation.set(0, 0, -0.12 - b * 0.03);
        body.position.y = baseY + b * 0.01;
        break;
      }
      case "run": {
        const s = Math.sin(p.phase * TAU);
        legL.rotation.set(s * ANIM.legSwing, 0, 0);
        legR.rotation.set(-s * ANIM.legSwing, 0, 0);
        armL.rotation.set(-s * ANIM.armSwing, 0, 0.1);
        armR.rotation.set(s * ANIM.armSwing, 0, -0.1);
        body.position.y = baseY + Math.abs(Math.cos(p.phase * TAU)) * ANIM.bob;
        if (torso) torso.rotation.x = -ANIM.forwardLean;
        body.scale.y = 1 - p.squash * ANIM.landSquash;
        break;
      }
      case "jump": {
        const t = p.tuck;
        legL.rotation.set(t * ANIM.jumpTuck, 0, 0);
        legR.rotation.set(t * ANIM.jumpTuck * 0.7, 0, 0);
        armL.rotation.set(-t * 2.4, 0, 0.35 * t);
        armR.rotation.set(-t * 2.4, 0, -0.35 * t);
        if (torso) torso.rotation.x = -ANIM.forwardLean * 0.5;
        break;
      }
      case "roll": {
        body.visible = false;
        if (ball) {
          ball.visible = true;
          ball.rotation.x = -p.roll * TAU * ANIM.rollTurns;
          ball.rotation.z = -lean * 0.4;
        }
        break;
      }
      case "crash": {
        const k = Math.min(1, p.crashT / 0.25);
        const e = 1 - (1 - k) * (1 - k);
        body.rotation.x = e * ANIM.crashTilt;
        armL.rotation.set(-1.8 * e, 0, 0.6 * e);
        armR.rotation.set(-1.8 * e, 0, -0.6 * e);
        legL.rotation.set(0.5 * e, 0, 0);
        legR.rotation.set(-0.2 * e, 0, 0);
        break;
      }
    }
  }
}

const pose: RigPose = { mode: "idle", phase: 0, lean: 0, tuck: 0, roll: 0, squash: 0, crashT: 0, time: 0 };

export class PlayerAnimator implements RunSystem {
  readonly id = "playerView";
  readonly order = 110;
  readonly root = new Group();
  private model!: Object3D;
  private rig!: HumanoidRig;
  private shadow!: Mesh;
  private mixer: AnimationMixer | null = null;
  private readonly clipActions = new Map<string, AnimationAction>();
  private currentClip = "";
  private time = 0;

  init(ctx: RunContext): void {
    this.root.name = "runner";
    this.model = ctx.assets.getModel("char.runner.default");
    this.root.add(this.model);
    this.rig = new HumanoidRig(this.model);
    const clips = ctx.assets.getClips("char.runner.default");
    if (clips.length) {
      this.mixer = new AnimationMixer(this.model);
      const map = ctx.assets.entry("char.runner.default")?.animations ?? {};
      for (const logical of Object.keys(map)) {
        const clip = clips.find((c) => c.name === map[logical]);
        if (clip) this.clipActions.set(logical, this.mixer.clipAction(clip));
      }
    }
    const shadowTex = ctx.assets.getTexture("fx.shadow.blob");
    this.shadow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTex, transparent: true, depthWrite: false, opacity: ANIM.shadowOpacity }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    curveObject(this.root);
    curveObject(this.shadow);
    ctx.scene.add(this.root, this.shadow);
  }

  render(ctx: RunContext, alpha: number, frameDt: number): void {
    const p = ctx.player;
    this.time += frameDt;
    const x = p.prevX + (p.x - p.prevX) * alpha;
    const y = p.prevY + (p.y - p.prevY) * alpha;
    const hop = p.state === "crash" ? 0 : p.hopAt() * SWITCH_FEEL.hopHeight;
    this.root.position.set(x, y + hop, 0);

    const mode = ctx.state.mode;
    pose.mode = mode === "idle" ? "idle" : p.state === "crash" ? "crash" : p.rolling ? "roll" : p.grounded ? (p.state === "idle" ? "idle" : "run") : "jump";
    if (mode === "ended" && p.state !== "crash") pose.mode = "idle";
    pose.phase = p.runPhase;
    pose.lean = p.state === "crash" ? 0 : p.leanAt();
    const v0 = p.jumpVelocity();
    pose.tuck = p.grounded ? 0 : Math.min(1, p.airTime / 0.1) * (1 - 0.6 * Math.min(1, Math.max(0, -p.vy) / v0));
    pose.roll = p.rolling ? 1 - p.rollTimer / PLAYER.rollSeconds : 0;
    pose.squash = p.grounded ? Math.max(0, 1 - p.sinceLand / 0.12) : 0;
    pose.crashT = p.state === "crash" ? p.stateTime : 0;
    pose.time = this.time;

    if (this.mixer) this.animateClips(pose.mode, frameDt);
    else this.rig.pose(pose);

    // contact shadow shrinks with height
    const h = Math.max(0, y + hop - p.groundY);
    const k = 1 / (1 + h * 0.6);
    this.shadow.position.set(x, p.groundY + 0.02, 0);
    this.shadow.scale.set(ANIM.shadowSize * k, ANIM.shadowSize * k, 1);
    (this.shadow.material as MeshBasicMaterial).opacity = ANIM.shadowOpacity * k;
  }

  /** Debug/capture only (allocates): head centre on screen as a viewport fraction (0..1, y down). */
  headScreen(camera: Camera): { sx: number; sy: number } | null {
    const head = this.model?.getObjectByName("head");
    if (!head) return null;
    const v = head.getWorldPosition(new Vector3()).project(camera);
    return { sx: (v.x + 1) / 2, sy: (1 - v.y) / 2 };
  }

  private animateClips(mode: RigMode, dt: number): void {
    const logical = mode === "crash" ? "death" : mode;
    if (logical !== this.currentClip) {
      const next = this.clipActions.get(logical);
      const prev = this.clipActions.get(this.currentClip);
      if (next) {
        next.reset();
        if (logical === "death" || logical === "jump" || logical === "roll") {
          next.setLoop(LoopOnce, 1);
          next.clampWhenFinished = true;
        }
        next.play();
        if (prev) prev.crossFadeTo(next, 0.12, false);
      }
      this.currentClip = logical;
    }
    this.mixer?.update(dt);
  }
}
