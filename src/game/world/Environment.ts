/**
 * Environment chunks beside the track. Chunk c covers s ∈ [c·L, (c+1)·L); its layout is a pure
 * function of (run seed, c), so chunks "scroll in" deterministically with no stored state and no
 * allocation: each frame the visible chunk range is recomposed into two InstancedMeshes.
 */
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { defineTuning } from "../../core/tuning";
import { Rng, hash32 } from "../../core/rng";
import { LANES, renderZ } from "./coords";
import { TRACK } from "./Track";
import { curveObject } from "./curve";
import type { RunContext, RunSystem } from "../types";

export const ENV = defineTuning("env", "Environment", {
  chunkLength: { default: 40, min: 10, max: 200, step: 1, label: "Chunk length", unit: "m" },
  sideMargin: { default: 2.6, min: 0, max: 20, step: 0.1, label: "Gap between track and buildings", unit: "m" },
  minWidth: { default: 5, min: 1, max: 40, step: 0.5, label: "Building width min", unit: "m" },
  maxWidth: { default: 12, min: 1, max: 60, step: 0.5, label: "Building width max", unit: "m" },
  minHeight: { default: 3.5, min: 1, max: 60, step: 0.5, label: "Building height min", unit: "m" },
  maxHeight: { default: 15, min: 1, max: 80, step: 0.5, label: "Building height max", unit: "m" },
  minLength: { default: 8, min: 2, max: 60, step: 0.5, label: "Building length min", unit: "m" },
  maxLength: { default: 22, min: 2, max: 100, step: 0.5, label: "Building length max", unit: "m" },
  gapChance: { default: 0.22, min: 0, max: 1, step: 0.01, label: "Gap chance" },
  poleSpacing: { default: 20, min: 4, max: 100, step: 1, label: "Pole spacing", unit: "m" },
  poleHeight: { default: 6.5, min: 1, max: 20, step: 0.1, label: "Pole height", unit: "m" },
});

const BLOCK_CAP = 220;
const POLE_CAP = 80;

const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpC = new Color();

export class Environment implements RunSystem {
  readonly id = "environment";
  readonly order = 101;
  private blocks!: InstancedMesh;
  private poles!: InstancedMesh;
  private readonly rng = new Rng(1);

  init(ctx: RunContext): void {
    const parts = ctx.assets.getMeshParts("env.building.block");
    this.blocks = new InstancedMesh(parts.geometry, parts.material, BLOCK_CAP);
    this.blocks.name = "env-blocks";
    this.poles = new InstancedMesh(parts.geometry, parts.material, POLE_CAP);
    this.poles.name = "env-poles";
    // make sure instanceColor exists
    this.blocks.setColorAt(0, tmpC.set(0xffffff));
    this.poles.setColorAt(0, tmpC.set(0x3b4252));
    curveObject(this.blocks);
    curveObject(this.poles);
    ctx.scene.add(this.blocks, this.poles);
  }

  render(ctx: RunContext): void {
    const d = ctx.renderDistance;
    const seed = ctx.state.seed;
    const L = ENV.chunkLength;
    const trackHalf = LANES.spacing * 1.5 + TRACK.ballastMargin;
    const from = d - TRACK.behind;
    const to = d + TRACK.ahead;
    const c0 = Math.floor(from / L);
    const c1 = Math.floor(to / L);
    const rng = this.rng;
    tmpQ.identity();
    let k = 0;
    for (let c = c0; c <= c1 && k < BLOCK_CAP; c++) {
      for (let side = -1; side <= 1; side += 2) {
        rng.reseed(hash32((seed ^ Math.imul(c, 0x27d4eb2d)) + side * 7919));
        let s = c * L + rng.range(0, 3);
        const end = (c + 1) * L;
        let guard = 0;
        while (s < end && k < BLOCK_CAP && guard++ < 12) {
          const len = Math.min(rng.range(ENV.minLength, ENV.maxLength), end - s);
          if (len < 1.5) break;
          const gap = rng.chance(ENV.gapChance);
          const w = rng.range(ENV.minWidth, ENV.maxWidth);
          const h = rng.range(ENV.minHeight, ENV.maxHeight);
          const tint = rng.range(0.72, 1);
          const hue = rng.next();
          if (!gap) {
            const x = side * (trackHalf + ENV.sideMargin + w / 2);
            tmpP.set(x, TRACK.groundY, renderZ(s + len / 2, d));
            tmpS.set(w, h, len - 0.4);
            tmpM.compose(tmpP, tmpQ, tmpS);
            this.blocks.setMatrixAt(k, tmpM);
            tmpC.setHSL(0.55 + hue * 0.5, 0.18, 0.5 * tint + 0.2);
            this.blocks.setColorAt(k, tmpC);
            k++;
          }
          s += len + rng.range(0.4, 2.5);
        }
      }
    }
    this.blocks.count = k;
    this.blocks.instanceMatrix.needsUpdate = true;
    if (this.blocks.instanceColor) this.blocks.instanceColor.needsUpdate = true;

    // lighting/catenary poles either side — strong speed cue
    let p = 0;
    const sp = ENV.poleSpacing;
    tmpC.set(0x3b4252);
    for (let s = Math.ceil(from / sp) * sp; s < to && p < POLE_CAP - 1; s += sp) {
      for (let side = -1; side <= 1; side += 2) {
        tmpP.set(side * (trackHalf + 0.9), TRACK.groundY, renderZ(s, d));
        tmpS.set(0.22, ENV.poleHeight, 0.22);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.poles.setMatrixAt(p, tmpM);
        this.poles.setColorAt(p, tmpC);
        p++;
      }
    }
    this.poles.count = p;
    this.poles.instanceMatrix.needsUpdate = true;
    if (this.poles.instanceColor) this.poles.instanceColor.needsUpdate = true;
  }
}
