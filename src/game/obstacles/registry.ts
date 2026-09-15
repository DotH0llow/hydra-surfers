/**
 * Obstacle type registry. Each type = {id, assetId, collider, rules}. Register new types from
 * their own module (imported by Run.ts or main.ts); ObstacleSystem pools views per type.
 */
import type { Object3D } from "three";
import type { Aabb } from "../types";
import type { ObstacleInstance } from "./ObstacleSystem";

export interface ObstacleRules {
  /** Can be cleared by jumping over it. */
  jumpable: boolean;
  /** Can be cleared by rolling under it. */
  rollable: boolean;
  /** Blocks the whole lane for its full length (trains). */
  solid: boolean;
}

export interface ObstacleType {
  id: string;
  label: string;
  /** Manifest id of the visual. */
  assetId: string;
  rules: ObstacleRules;
  /** Views pre-created at init (avoids hitches on first spawn). */
  poolSize: number;
  /** Default length along s when spawn() gets none (read live from tuning). */
  defaultLength(): number;
  /** If > 0, the view is scaled along Z by length / modelLength. */
  modelLength: number;
  /** Writes the sim-space collider for an instance (write `noCollider` for scenery). */
  collider(inst: ObstacleInstance, out: Aabb): void;
  /**
   * Walkable top surface (roofs, ramps): height at track position `s`, or `NO_SURFACE` when `s`
   * is outside it. Read by SurfaceSystem to set the runner's ground height.
   */
  surface?(inst: ObstacleInstance, s: number): number;
  /** Surface is climbed from any height (ramps); otherwise only within the step-up height. */
  snapSurface?: boolean;
  /** After the default placement each frame: variant visuals / lateral offsets. Must not allocate. */
  renderView?(inst: ObstacleInstance, view: Object3D): void;
}

export const NO_SURFACE = -1e9;

/** Collider for non-colliding scenery (tunnels, signals, ramps): an empty box below the ground. */
export function noCollider(inst: ObstacleInstance, out: Aabb): void {
  out.minX = out.maxX = 0;
  out.minY = out.maxY = -10;
  out.minS = inst.s;
  out.maxS = inst.s;
}

const types = new Map<string, ObstacleType>();

export function registerObstacleType(t: ObstacleType): void {
  if (types.has(t.id)) console.warn(`[obstacles] type "${t.id}" re-registered; replacing`);
  types.set(t.id, t);
}

export function getObstacleType(id: string): ObstacleType | undefined {
  return types.get(id);
}

export function listObstacleTypes(): ObstacleType[] {
  return [...types.values()];
}
