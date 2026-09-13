/** Pooled obstacle instances + their views. */
import type { Object3D } from "three";
import { defineTuning } from "../../core/tuning";
import { laneX, renderZ } from "../world/coords";
import { curveObject } from "../world/curve";
import type { Aabb, RunContext, RunSystem } from "../types";
import { getObstacleType, listObstacleTypes, type ObstacleType } from "./registry";

export const OBSTACLES = defineTuning("obstacles", "Obstacles", {
  despawnBehind: { default: 16, min: 2, max: 100, step: 1, label: "Despawn distance behind runner", unit: "m" },
});

export interface ObstacleInstance {
  readonly uid: number;
  type: ObstacleType;
  active: boolean;
  lane: number;
  /** Near edge along the track (smallest s). */
  s: number;
  prevS: number;
  length: number;
  /** Movement toward the runner in m/s (0 = stationary). */
  speed: number;
  /** Free slot for type-specific data. */
  variant: number;
  readonly view: Object3D;
}

export class ObstacleSystem implements RunSystem {
  readonly id = "obstacles";
  readonly order = 40;
  /** Dense list of active instances (order not stable). */
  readonly active: ObstacleInstance[] = [];
  private readonly free = new Map<string, ObstacleInstance[]>();
  private readonly warned = new Set<string>();
  private ctx!: RunContext;
  private uid = 1;

  init(ctx: RunContext): void {
    this.ctx = ctx;
    for (const t of listObstacleTypes()) {
      const list = this.freeList(t.id);
      for (let i = 0; i < t.poolSize; i++) list.push(this.create(t));
    }
  }

  reset(): void {
    this.clear();
  }

  spawn(typeId: string, lane: number, s: number, length?: number, speed = 0): ObstacleInstance | null {
    const type = getObstacleType(typeId);
    if (!type) {
      if (!this.warned.has(typeId)) {
        this.warned.add(typeId);
        console.warn(`[obstacles] unknown type "${typeId}"`);
      }
      return null;
    }
    const inst = this.freeList(typeId).pop() ?? this.create(type);
    inst.active = true;
    inst.lane = lane;
    inst.s = inst.prevS = s;
    inst.length = length ?? type.defaultLength();
    inst.speed = speed;
    inst.variant = 0;
    this.active.push(inst);
    return inst;
  }

  clear(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.despawnAt(i);
  }

  collider(inst: ObstacleInstance, out: Aabb): Aabb {
    inst.type.collider(inst, out);
    return out;
  }

  fixedUpdate(ctx: RunContext, dt: number): void {
    const limit = ctx.state.distance - OBSTACLES.despawnBehind;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const inst = this.active[i];
      inst.prevS = inst.s;
      if (inst.speed !== 0 && ctx.state.mode !== "crashed") inst.s -= inst.speed * dt;
      if (inst.s + inst.length < limit) this.despawnAt(i);
    }
  }

  render(ctx: RunContext, alpha: number): void {
    const d = ctx.renderDistance;
    for (let i = 0; i < this.active.length; i++) {
      const inst = this.active[i];
      const s = inst.prevS + (inst.s - inst.prevS) * alpha;
      const v = inst.view;
      v.position.set(laneX(inst.lane), 0, renderZ(s + inst.length / 2, d));
      v.scale.z = inst.type.modelLength > 0 ? inst.length / inst.type.modelLength : 1;
      v.visible = true;
    }
  }

  private despawnAt(i: number): void {
    const inst = this.active[i];
    const last = this.active.pop()!;
    if (i < this.active.length) this.active[i] = last;
    inst.active = false;
    inst.view.visible = false;
    this.freeList(inst.type.id).push(inst);
  }

  private freeList(id: string): ObstacleInstance[] {
    let l = this.free.get(id);
    if (!l) {
      l = [];
      this.free.set(id, l);
    }
    return l;
  }

  private create(type: ObstacleType): ObstacleInstance {
    const view = this.ctx.assets.getModel(type.assetId);
    view.name = `obstacle:${type.id}`;
    view.visible = false;
    curveObject(view);
    this.ctx.scene.add(view);
    return { uid: this.uid++, type, active: false, lane: 0, s: 0, prevS: 0, length: 0, speed: 0, variant: 0, view };
  }
}
